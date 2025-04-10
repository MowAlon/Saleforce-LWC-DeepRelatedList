/**
 * @File Name          : datatable.js
 * @Description        : Methods supporting functionalities of datatable
 * @Author             : Sasank Subrahmanyam V
 * @Group              :
 * @Last Modified By   : Sasank Subrahmanyam V
 * @Last Modified On   : 8/3/2019, 3:17:35 PM
 * @Modification Log   :
 *==============================================================================
 * Ver         Date                     Author      		      Modification
 *==============================================================================
 * 1.0    8/1/2019, 11:08:28 AM   Sasank Subrahmanyam V     Initial Version
 * Alon Waisman, 2/24/2023: Added support for sorting by related fields
 * Alon Waisman, 2/27/2023: Added support for live fetching of field labels and type (so they don't need to be added in the table config)
 * Alon Waisman, 3/27/2024: Added support for linked relationship fields (and setting what is used as the label, instead of just showing the Id)
 *                          Improved async management
 *
 * EXAMPLE CONFIG IN CUSTOM LWC:
 *
 *     --- JAVASCRIPT ---
 *     connectedCallback() {
 *         this.config = {objectName: 'Some_SObject__c',
 *                        queryFilters: <entire string WHERE Clause (excluding the actual WHERE word)>,
 *                        pageSize: 5000,
 *                        hidePagination: true,
 *                        defaultSortField: 'Id', // This runs the client-side sorting as if a user clicked it right after fetching records. It's different than 'sortBy' which sets the SOQL "ORDER BY" statement and can thereforce apply more complex sorting. Uses the standard sortAsc property to assign direction. In the case of a url field, this must be the API Name of the underlying field, not the displayed field
 *                        tableConfig: {columns: [{sortable: true, api: 'Id', label: 'Link to Record', linkToRecord: true, type: 'url', typeAttributes: {label: {fieldName: 'Name'}, target: '_blank'}},
 *                                                {sortable: true, api: 'Parent_Relationship_Field__c', label: 'Link to Related Parent Record', linkToRecord: true, type: 'url', typeAttributes: {label: {fieldName: 'Relationship_Field__r.Name'}, target: '_blank'}},
 *                                                {sortable: true, api: 'Parent_Relationship_Field__r.Parent_Relationship_Field__c', label: 'Link to Related Grandparent Record', linkToRecord: true, type: 'url', typeAttributes: {label: {fieldName: 'Parent_Relationship_Field__r.Parent_Relationship_Field__r.Something_Other_Than_Name__c'}, target: '_blank'}},
 *                                                {sortable: true, api: 'Field_on_Primary_Record_A__c', label: 'Custom Column Header'},
 *                                                {api: 'Field_on_Primary_Record_B__c'}, <- not including the label will default to the fields ordinary label
 *                                                {sortable: true, api: 'Text__c'}]}
 *                     };
 *     }
 *
 *     Note: you can replace "linkToRecord" with "contentDownload" if the field is a ContentDocument record and you want to provide a download link instead of linking to the record page
 *     Note: when linking to a record, you can customize the path by adding "pathBeforeId" to the typeAttributes object. By default, the path is simply "/"
 *     Note: you can also add parameters at the end of the URL by adding "urlParameters" to the typeAttributes object.
 *
 *     --- HTML ---
 *     <c-datatable config={config}></c-datatable>
**/

import { LightningElement, api, track } from 'lwc';
import fetchDataMap       from '@salesforce/apex/DatatableController.fetchDataMap';
import fetchDataMapCached from '@salesforce/apex/DatatableController.fetchDataMapCached';
import getFieldInfo       from '@salesforce/apex/DatatableController.fieldInfo';

export default class Datatable extends LightningElement {
    // this will have all the configuration for table
    @api config = {};

    // Name of the object from from records have to be queried
    @track objectName;

    // All the attributes of lightning-datatable should be mentioned in this attribute (tableConfig).
    // It should be either kebab casing or camel casing
    @track tableConfig = {};

    // By which field should the query sort the records from database
    @track sortBy;

    // For the field mentioned above, should it be ascending (true) or descending (false)
    @track sortAsc;

    // What is the limit of number of records to be fetched from database
    @track limit;

    // what query type should be used? SOQL or SOSL?
    @track queryType = "SOQL";

    // should the pagination be hidden?
    @track hidePagination = false;

    // Do you want to hide the spinner in table and handle it yourself outside table?
    @track hideTableSpinner = false;

    // will set the apex method cacheable
    @track cacheable = false;

    // set height of table
    @track height = '10rem';

    // internally used tracked variables for data processing
    @track tableProps = {};
    @track recordsListInPage = [];
    @track selectedRowsMap = {};
    @track selectedRowsPagesMap = {};
    @track hideSpinner = false;
    @track userMessage = "Please wait...";
    @track error;
    extraFieldsToQuery = []; // May be needed for expanded functionality in parent LWC

    // internally used non-tracked variables for initialization
    _recordsListInAllPages = [];
    _startFromIndex = 0;
    _paginationInfo = {
        currentPage: 0,
        totalPages: 0
    };
    _initDone = false;
    _soslMinCharsError = "Please enter at least 2 characters to search";

    // exposed api methods ----------------------------------------------------------------------------------------

    // for setting custom messages in different contexts
    @api
    get userMessages() {
        if (this.isNotBlank(this._userMessages)) return this._userMessages;
        return {
            init: 'Please wait...',
            noRecords: 'NO RECORDS FOUND',
            maxRecords: `Maximum number of records (${this.limit}) retrieved. You are probably not seeing them all. Try applying more filters.`,
            search: 'Searching...'
        };
    }
    set userMessages(value) {
        this._userMessages = value;
    }

    get noRecords() {
        return this.userMessage == this.userMessages.noRecords;
    }

    get showPagination() {
        return !this.hidePagination && !this.noRecords;
    }

    get showTable() {
        return !this.userMessage || this.userMessage == this.userMessages.maxRecords;
    }

    // invoked when sosl search term is changed
    @api
    get soslSearchTerm() {
        return this._soslSearchTerm;
    }
    set soslSearchTerm(value) {
        this._soslSearchTerm = value;
        this.doDataReset();
        if (typeof value === "string" && (value.length > 1) && this._initDone) this.fetchRecords();
        else this.handleSpinner(false, this._soslMinCharsError);
    }

    // invoked when page size is changed
    @api
    get pageSize() {
        if (!this.isNotBlank(this._pageSize)) this._pageSize = 10;
        return parseInt(this._pageSize, 10);
    }
    set pageSize(value) {
        this._pageSize = value;
    }

    // for dynamically filtering data
    @api
    get queryFilters() {
        if (this._queryFilters) return this._queryFilters;
        return "";
    }
    set queryFilters(value) {
        this._queryFilters = value;
        if (this._initDone) {
            this._startFromIndex = 0;
            this.doDataReset();
            this.fetchRecords();
        }
    }

    // for manually refreshing table
    @api
    refresh() {
        this._startFromIndex = 0;
        this.doDataReset(true);
        return this.fetchRecords();
    }
    @api
    refreshRecordsOnly() {
        return this.fetchRecords();
    }

    // for doing sosl search
    @api
    doSoslSearch(searchTerm) {
        this.soslSearchTerm = searchTerm;
    }

    // for getting selected rows
    @api
    getSelectedRows() {
        return this.selectedRowsMap;
    }

    // initialization of component
    connectedCallback() {
        this.setPropertiesFromConfig();

        if (this.config.hasOwnProperty("tableConfig") || this.config.hasOwnProperty("table-config")) {
            this.tableConfig = this.config.tableConfig || this.config["table-config"];

            let columnsClone = JSON.parse(JSON.stringify(this.tableConfig.columns));
            let apiNames     = this.apiNames(columnsClone, this.extraFieldsToQuery);
            this.fields      = apiNames.join();

            getFieldInfo({ objectName: this.objectName, fieldNames: apiNames })
                .then(fieldInfo => {
                    this.setTableProperties(fieldInfo, columnsClone);
                    this.dispatchEvent(new CustomEvent('field_info_fetched', { detail: fieldInfo }));
                    this.fetchRecords();
                });
        }
        else {
            this.fetchRecords();
        }

        this.userMessage                 = this.userMessages.init; // set initial user message
        this._originTagRowSelectionLocal = "LIGHTNING-DATATABLE"; // initialising to the expected source tag
        this._initDone                   = true;
    }
        apiNames(columns, extraFields) {
            let apiNames = [...extraFields];
            columns.filter(col => col.hasOwnProperty("api")).forEach(col => {
                apiNames.push(col.api);
                if (col.typeAttributes?.label?.fieldName) {
                    apiNames.push(col.typeAttributes.label.fieldName);
                }
            });

            return Array.from(new Set(apiNames));
        }

    // for developer purpose, errors are logged in console
    handleError(err) {
        console.error("error => ", err);
        this.error = err + ". Please check console for details.";
        return err;
    }

    // datatable events are processed and then dispatched to parent component ----------------------------------
    handleRowAction = event => {
        this.dispatchEvent(new CustomEvent('rowaction', {
            detail: {
                action: event.detail.action,
                row: event.detail.row
            }
        }));
    }
    handleCancel = event => this.dispatchEvent(new CustomEvent('cancel', { detail: event.detail }));
    handleResize = event => this.dispatchEvent(new CustomEvent('resize', { detail: event.detail }))
    handleRowSelection = event => {
        if (this._originTagRowSelectionLocal === "LIGHTNING-DATATABLE") {
            this.selectedRowsMap = {};
            this.selectedRowsPagesMap[this._paginationInfo.currentPage] = event.detail.selectedRows;
            Object.values(this.selectedRowsPagesMap).forEach(rowsList => {
                rowsList.forEach(row => {
                    this.selectedRowsMap[row.Id] = row;
                });
            });

            let detail = {
                selectedRows: Object.values(this.selectedRowsMap),
                selectedRowsMap: this.selectedRowsMap
            };

            this.dispatchEvent(new CustomEvent('rowselection', {
                detail: detail
            }));
        } else {
            this._originTagRowSelectionLocal = event.target.tagName;
        }
    }
    handleSave = event => this.dispatchEvent(new CustomEvent('save', { detail: event.detail }));
    handleSort = event => {
        this.sort(event.detail.fieldName, event.detail.sortDirection, true);
    }
        sort(sortField, sortDirection, resetPosition) {
            if (sortField) {
                this.selectedRowsMap      = {};
                this.selectedRowsPagesMap = {};

                this.tableProps.sortedBy        = sortField;
                this.tableProps.sortedDirection = sortDirection || (this.sortAsc == false ? 'desc' : 'asc');

                // For the standard LWC datatabe component to correctly report the desired sort direction, we must set 'sortedBy' to the underlying field being sorted...
                // But we actually wanted to sort by the field displayed (which may be different), so the code below that actually sorts the data uses fieldDisplayed instead of FieldName
                let fieldDisplayed = this.tableProps.columnsByFieldName[sortField].fieldDisplayed;

                this._recordsListInAllPages.sort((a, b) => {
                    let aFieldValue = this.relatedFieldValue(a, fieldDisplayed);
                    let bFieldValue = this.relatedFieldValue(b, fieldDisplayed);
                    if (!aFieldValue) return 1;
                    if (!bFieldValue) return -1;
                    if (this.tableProps.sortedDirection === "asc") {
                        if (aFieldValue < bFieldValue) return -1;
                        else if (aFieldValue > bFieldValue) return 1;
                        if (a.Id < b.Id) return -1;
                        return 1;
                    }
                    if (aFieldValue < bFieldValue) return 1;
                    else if (aFieldValue > bFieldValue) return -1;
                    if (a.Id > b.Id) return -1;
                    return 1;
                });

                if (resetPosition) {this._startFromIndex = 0;}
                this.processRecordsListPagination();
            }
        }
            relatedFieldValue(anObject, relatedField) {
                return relatedField.split('.').reduce(function (previous, current) {
                    return previous ? previous[current] : null
                }, anObject || self);
            }

    // init processing ------------------------------------------------------------------------------------
    setPropertiesFromConfig() {
        this.setPropertyFromConfig('objectName', 'object-name');
        this.setPropertyFromConfig('sortBy', 'sort-by');
        this.setPropertyFromConfig('sortAsc', 'sort-asc');
        this.setPropertyFromConfig('queryType', 'query-type');
        this.setPropertyFromConfig('hidePagination', 'hide-pagination');
        this.setPropertyFromConfig('hideTableSpinner', 'hide-table-spinner');
        this.setPropertyFromConfig('userMessages', 'user-messages');
        this.setPropertyFromConfig('pageSize', 'page-size');
        this.setPropertyFromConfig('queryFilters', 'query-filters');
        this.setPropertyFromConfig('extraFieldsToQuery', 'extra-fields-to-query', []);
        this.setPropertyFromConfig('soslSearchTerm', 'sosl-search-term');
        this.setPropertyFromConfig('limit', 'limit');
        this.setPropertyFromConfig('cacheable', 'cacheable');
        this.setPropertyFromConfig('height', 'height');
        this.setPropertyFromConfig('defaultSortField', 'default-sort-field');
    }
        setPropertyFromConfig(camelCaseProperty, kebabCaseProperty, defaultValue) {
            if (this.config.hasOwnProperty(camelCaseProperty) || this.config.hasOwnProperty(kebabCaseProperty)) {
                if (this.config[camelCaseProperty] == false || this.config[kebabCaseProperty] == false)
                     {this[camelCaseProperty] = false;}
                else {this[camelCaseProperty] = this.config[camelCaseProperty] || this.config[kebabCaseProperty] || defaultValue;}
            }
        }

    // get datatable attributes --------------------------------------------------------------------------
    setTableProperties(fieldInfo, columns) {
        columns.forEach(column => {
            if (fieldInfo.hasOwnProperty(column.api)) {
                if (!column.hasOwnProperty('fieldName')) { column.fieldName = column.api; }
                if (!column.hasOwnProperty('label'))     { column.label     = fieldInfo[column.api].label; }
                if (!column.hasOwnProperty('type'))      { column.type      = fieldInfo[column.api].type; }

                column.fieldDisplayed = column.typeAttributes?.label?.fieldName || column.fieldName;
            }
        });

        this.buildColumnsByFieldName(columns);

        this.tableProps.columns         = columns;
        this.tableProps.sortedBy        = "";
        this.tableProps.sortedDirection = "";

        this.setTableProperty("hideCheckboxColumn", "hide-checkbox-column", false);
        this.setTableProperty("showRowNumberColumn", "show-row-number-column", false);
        this.setTableProperty("rowNumberOffset", "row-number-offset", 0);
        this.setTableProperty("resizeColumnDisabled", "resize-column-disabled", false);
        this.setTableProperty("columnWidthsMode", "column-widths-mode", "fixed");
        this.setTableProperty("minColumnWidth", "min-column-width", "50px");
        this.setTableProperty("maxColumnWidth", "max-column-width", "1000px");
        this.setTableProperty("resizeStep", "resize-step", "10px");
        this.setTableProperty("defaultSortDirection", "default-sort-direction", "asc");
        this.setTableProperty("enableInfiniteLoading", "enable-infinite-loading", false);
        this.setTableProperty("loadMoreOffset", "load-more-offset", false);
        this.setTableProperty("isLoading", "is-loading", false);
        this.setTableProperty("maxRowSelection", "max-row-selection", 1000);
        this.setTableProperty("selectedRows", "selected-rows", []);
        this.setTableProperty("errors", "errors", null);
        this.setTableProperty("draftValues", "draft-values", null);
        this.setTableProperty("hideTableHeader", "hide-table-header", false);
        this.setTableProperty("suppressBottomBar", "suppress-bottom-bar", false);
    }
        buildColumnsByFieldName(columns) {
            this.tableProps.columnsByFieldName = columns.reduce((acc, column) => (acc[column.fieldName] = column, acc), {});
        }
        setTableProperty(camelCaseProperty, kebabCaseProperty, defaultValue) {
            if (this.tableConfig.hasOwnProperty(camelCaseProperty) || this.tableConfig.hasOwnProperty(kebabCaseProperty)) {
                this.tableProps[camelCaseProperty] = this.tableConfig[camelCaseProperty] || this.tableConfig[kebabCaseProperty];
            }
            else {this.tableProps[camelCaseProperty] = defaultValue;}
        }

    // retrieve the records form database
    fetchRecords() {
        return new Promise((resolve, reject) => {
            this.handleSpinner(true, this.userMessages.search);

            const params = {
                objectName: this.objectName,
                fields: this.fields,
                sortBy: this.sortBy,
                sortAsc: this.sortAsc,
                queryFilters: this.queryFilters,
                limitRecords: this.limit,
                queryType: this.queryType,
                soslSearchTerm: this.soslSearchTerm
            };

            if (this.cacheable) {
                fetchDataMapCached({ params })
                    .then(DataMap => resolve(this.getResolve(DataMap.records)))
                    .catch(error => reject(this.getReject(error)));
            } else {
                fetchDataMap({ params })
                    .then(DataMap => resolve(this.getResolve(DataMap.records)))
                    .catch(error => reject(this.getReject(error)));
            }
        });
    }

    // invoked on success
    getResolve(records) {
        this.error = undefined;
        this.processRecordsResult(records);
        this.sort(this.tableProps.sortedBy || this.defaultSortField, this.tableProps.sortedDirection, false);
        return "SUCCESS";
    }

    // invoked on error
    getReject(error) {
        this.handleSpinner(false, "");
        if (error.body && error.body.message) this.handleError(error.body.message);
        else this.handleError(error);
        this._recordsListInAllPages = undefined;
        return "ERROR";
    }

    // process the records returned from database
    processRecordsResult(recordsListResult) {
        this.handleSpinner(false, recordsListResult.length == this.limit ? this.userMessages.maxRecords : "");

        if (recordsListResult && recordsListResult.length > 0) {
            let allRecordsWithAllProperties = this.tableProps.columns ? this.recordsWithRelatedFieldsAndLinks(recordsListResult) : recordsListResult;
            this._recordsListInAllPages = allRecordsWithAllProperties;
            this.dispatchEvent(new CustomEvent('records_fetched', { detail: allRecordsWithAllProperties }));
            this._paginationInfo.totalPages = (((this._recordsListInAllPages.length / this.pageSize) - ((this._recordsListInAllPages.length % this.pageSize) / this.pageSize)) + (((this._recordsListInAllPages.length % this.pageSize) === 0) ? 0 : 1));
            this.processRecordsListPagination();
        } else {
            this.doDataReset();
            this.handleSpinner(false, this.userMessages.noRecords);
        }
    }
        recordsWithRelatedFieldsAndLinks(records) {
            return records.map(thisRow => {
                let currentRow = Object.assign({}, thisRow);

                this.tableProps.columns.forEach(col => {
                    if (col.hasOwnProperty("api")) {
                        currentRow[col.fieldName] = this.getFieldValueFromObject(currentRow, col.api);
                        if (currentRow[col.fieldName] && (col.linkToRecord || col.contentDownload) && col.typeAttributes.label.fieldName) {
                            currentRow[col.fieldName] = this.linkValue(currentRow, col);
                            currentRow[col.typeAttributes.label.fieldName] = this.relatedFieldValue(currentRow, col.typeAttributes.label.fieldName);
                        }
                    }
                });

                return currentRow;
            });
        }
            linkValue(currentRow, col) {
                let path       = col.typeAttributes.pathBeforeId ?? (col.contentDownload ? '/sfc/servlet.shepherd/document/download/' : '/');
                let recordId   = currentRow[col.fieldName];
                let parameters = col.typeAttributes.urlParameters ?? '';

                return path + recordId + parameters;
            }

    // paginate the records
    processRecordsListPagination(lastSetOfRecords = null, lastNumberOfRecords = null) {
        if (lastSetOfRecords) {
            this.recordsListInPage = this._recordsListInAllPages.slice(lastNumberOfRecords);
        } else {
            this.recordsListInPage = this._recordsListInAllPages.slice(this._startFromIndex, this.pageSize + this._startFromIndex);
        }

        this.processTableRows();
    }

    // process each row to get direct and relationship fields
    processTableRows() {
        this.tableProps.selectedRows = [];
        this.recordsListInPage = this.recordsListInPage.map(thisRow => {
            let currentRow = Object.assign({}, thisRow);
            if (this.selectedRowsMap.hasOwnProperty(currentRow.Id)) {this.tableProps.selectedRows.push(currentRow.Id);}

            return currentRow;
        });
    }

    // reset of data
    doDataReset(forgetSortSelection) {
        if (forgetSortSelection) {
            this.tableProps.sortedBy = "";
            this.tableProps.sortedDirection = "";
        }
        this._recordsListInAllPages = [];
        this.recordsListInPage = [];
    }

    isNotBlank(checkString) {
        return (checkString !== '' && checkString !== null && checkString !== undefined);
    }

    //GET THE FIELD VALUE IN GIVEN OBJECT
    getFieldValueFromObject(thisObject, fieldRelation) {
        let fieldRelationArray = fieldRelation.split(".");
        let objectFieldValue = thisObject;
        for (let f in fieldRelationArray) {
            if (objectFieldValue) {
                objectFieldValue = objectFieldValue[fieldRelationArray[f].trim()];
            }
        }
        return objectFieldValue;
    }

    // invoked for all the async operations
    handleSpinner(showSpinner, userMessage) {
        if (!this.hideTableSpinner) {
            this.showSpinner = showSpinner;
            this.tableProps.isLoading = showSpinner;
        }

        this.userMessage = userMessage;

        this.dispatchEvent(new CustomEvent('tableloading', {
            detail: {
                showSpinner: showSpinner,
                userMessage: userMessage
            },
            bubbles: true,
            composed: true
        }));
    }

    //PAGINATION - SHOW PREVIOUS PAGE
    showPreviousPage(event) {
        if (this._startFromIndex > 0) {
            if (this.selectedRowsPagesMap.hasOwnProperty(this._paginationInfo.currentPage) && this.selectedRowsPagesMap[this._paginationInfo.currentPage].length > 0)
                this._originTagRowSelectionLocal = event.target.tagName;
            this._startFromIndex = this._startFromIndex - this.pageSize;
            this.processRecordsListPagination();
        }
    }

    //PAGINATION - SHOW NEXT PAGE
    showNextPage(event) {
        if (this._startFromIndex + this.pageSize < this._recordsListInAllPages.length) {
            if (this.selectedRowsPagesMap.hasOwnProperty(this._paginationInfo.currentPage) && this.selectedRowsPagesMap[this._paginationInfo.currentPage].length > 0)
                this._originTagRowSelectionLocal = event.target.tagName;
            this._startFromIndex = this._startFromIndex + this.pageSize;
            this.processRecordsListPagination();
        }
    }

    showLastPage = () => {
        let result = this._recordsListInAllPages.length % this.pageSize;
        if (this._startFromIndex >= 0) {
            if (result === 0) {
                this._startFromIndex = this._recordsListInAllPages.length - this.pageSize;
                this.processRecordsListPagination();
            } else {
                this._startFromIndex = this._recordsListInAllPages.length - result;
                this.processRecordsListPagination(true, -result);
            }
        }
    }

    //PAGINATION - INVOKED WHEN PAGE SIZE IS CHANGED
    pageSizeChanged = () => {
        this.doTableRefresh();
        this.processRecordsListPagination();
    }

    doTableRefresh = () => {
        this._startFromIndex = 0;
    }

    get showMessage() {
        return this.isNotBlank(this.userMessage) || this.showSpinner;
    }

    get pagesInfo() {
        if (this._recordsListInAllPages?.length > 0) {
            this._paginationInfo.currentPage = (((this._startFromIndex + 1) / this.pageSize) - (((this._startFromIndex + 1) % this.pageSize) / this.pageSize) + ((((this._startFromIndex + 1) % this.pageSize) === 0) ? 0 : 1));
            return 'Page ' + this._paginationInfo.currentPage + ' of ' + this._paginationInfo.totalPages;
        }
        return 'Page 0 of 0';
    }

    get recordsInfo() {
        if (this._recordsListInAllPages?.length > 0) {
            this._endIndex = this._startFromIndex + this.pageSize;
            return 'Showing ' + (this._startFromIndex + 1) + " to " + ((this._endIndex > this._recordsListInAllPages.length) ? this._recordsListInAllPages.length : this._endIndex) + " of " + this._recordsListInAllPages.length + " records";
        }
        return 'Showing 0 of 0';
    }

    get tableStyle() {
        return `height:${this.height};`;
    }
}