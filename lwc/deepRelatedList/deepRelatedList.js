import { LightningElement, api } from 'lwc';
import getRecords                from '@salesforce/apex/LWC_Query.safe_records';
import { popToast }              from 'c/utilities';

export default class DeepRelatedList extends LightningElement {
    @api recordId;
    @api objectApiName;

    @api title;
    @api iconName;
    @api parentRecordRelationship; // If parent record isn't the current record, this is the relationship from current record to the parent
    @api objectName;               // API Name of the Related List Object
    @api relationship;             // Relationship from the Related List Object to the Parent record (whether the parent is the current record or another ancestor)
    @api columnInfo;
    @api filtersCSV;
    @api recordPageFilter;
    @api defaultSortField;
    @api defaultSortOrder;
    @api pageSize;
    @api showRowNumbers = false;
    @api hidePagination = false;

    parentRecordId; // The parent record of the Related List - could be the current record ID or some ancestor
    queryFilters;
    config;

    connectedCallback() {
        if (!this.parentRecordRelationship) {this.prepareData(this.recordId);}
        else {
            getRecords({ fields: [this.parentRecordRelationship], sobject_name: this.objectApiName, and_filters: ['Id', '=', this.recordId], query_limit: 1 })
                .then(records => {
                    if (records.length && records[0][this.parentRecordRelationship]) { this.prepareData(records[0][this.parentRecordRelationship]); }
                    else                                                             { popToast(this, 'error', error, 'Parent Record Not Found'); }
                })
                .catch(error => {popToast(this, 'error', error, 'Deep Related List');})
        }
    }
        prepareData(parentId) {
            this.parentRecordId = parentId;

            this.queryFilters = this.filters();

            this.config = {objectName:       this.objectName,
                           limit:            500,
                           cacheable:        true,
                           defaultSortField: this.defaultSortField,
                           sortAsc:          this.defaultSortOrder != 'Descending',
                           hidePagination:   this.hidePagination,
                           pageSize:         !this.hidePagination ? this.pageSize : 500,
                           tableConfig:      {hideCheckboxColumn:  true,
                                              showRowNumberColumn: this.showRowNumbers,
                                              columns:             this.columnsData(),
                                              columnWidthsMode:    'auto'}
             };
        }

    filters() {
        let hasExtraFilters = !!(this.filtersCSV?.trim());
        let filters = hasExtraFilters ? this.filtersCSV.split(',').map(filter => '(' + filter.trim().replaceAll("'$recordId'", `'${this.parentRecordId}'`).replaceAll("$recordId", `'${this.parentRecordId}'`) + ')') : [];
        if (this.recordPageFilter) {filters.push(`(${this.relationship} = '${this.parentRecordId}')`);}
        let filterString = filters.join(' AND ');

        console.log('Final SOQL Filter: ', filterString);

        return filterString;
    }

    columnsData() {
        let columnsData = [];

        let columns = this.columnInfo.split(',').map(filter => filter.trim());

        columns.forEach(column => {
            columnsData.push(this.singleColumnObject(column));
        });

        return columnsData;
    }
        singleColumnObject(column) {
            // Each column can have up to three elements, separated by double-colons
            // Example: API_Name::Label::URL_Masking_Field_API_Name
            // If the Label is "**", don't use a custom label

            let elements = column.split('::').map(filter => filter.trim());

            let columnData = {api: elements[0], hideDefaultActions: true, sortable: true};
            if (elements[1] != null && elements[1] != '**') {columnData.label = elements[1];}
            if (elements[2]) {
                columnData.linkToRecord = true;
                columnData.type = "url";
                columnData.typeAttributes = {label: {fieldName: elements[2]}, target: "_blank"};
            }

            return columnData;
        }

}
