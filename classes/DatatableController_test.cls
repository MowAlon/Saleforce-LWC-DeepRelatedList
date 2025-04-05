@isTest
public class DatatableController_test {

    @isTest static void test_fieldInfo() {
        String[] field_api_names = new String[]{'Name', 'AnnualRevenue', 'CreatedDate', 'Owner.Email'};

        Map<String, Map<String, String>> field_info_by_api_name = DatatableController.fieldInfo('Account', field_api_names);

        for (String field_api_name : field_api_names) {
            Assert.isTrue(field_info_by_api_name.containsKey(field_api_name));
            Assert.isTrue(field_info_by_api_name.get(field_api_name).containsKey('label'));
            Assert.isTrue(field_info_by_api_name.get(field_api_name).containsKey('type'));
        }

        Assert.areEqual('Account Name', field_info_by_api_name.get('Name').get('label'));
        Assert.areEqual('string',       field_info_by_api_name.get('Name').get('type'));

        Assert.areEqual('Annual Revenue', field_info_by_api_name.get('AnnualRevenue').get('label'));
        Assert.areEqual('currency',       field_info_by_api_name.get('AnnualRevenue').get('type'));

        Assert.areEqual('Created Date', field_info_by_api_name.get('CreatedDate').get('label'));
        Assert.areEqual('date',         field_info_by_api_name.get('CreatedDate').get('type'));

        Assert.areEqual('Email', field_info_by_api_name.get('Owner.Email').get('label'));
        Assert.areEqual('email', field_info_by_api_name.get('Owner.Email').get('type'));
    }

    @isTest static void test_fetchDataMap() {
        Account[] accounts = new Account[]{new Account(Name = 'Account 1'), new Account(Name = 'Account 2'), new Account(Name = 'Account 3')};
        accounts[0].AnnualRevenue = 1000;
        accounts[1].AnnualRevenue = 10000;
        accounts[2].AnnualRevenue = 100000;
        insert accounts;

        Map<String, Object> inputs_by_type = new Map<String, Object>{'objectName'   => 'Account',
                                                                     'fields'       => 'Name, AnnualRevenue',
                                                                     'queryFilters' => 'AnnualRevenue >= 10000',
                                                                     'sortBy'       => 'Name'};

        Map<String, Object> data = DatatableController.fetchDataMapCached(inputs_by_type);

        Assert.isTrue(data.containsKey('records'));

        SObject[] records = (SObject[])data.get('records');

        Assert.areEqual(2,           records.size());
        Assert.areEqual('Account 2', records[0].get('Name'));
        Assert.areEqual('Account 3', records[1].get('Name'));
        Assert.areEqual(10000,       records[0].get('AnnualRevenue'));
        Assert.areEqual(100000,      records[1].get('AnnualRevenue'));
    }
}