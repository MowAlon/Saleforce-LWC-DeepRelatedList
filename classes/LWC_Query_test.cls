@isTest
public class LWC_Query_test {

    @isTest static void test_safe_records() {
        String[] fields = new String[]{'Id', 'Name', 'CreatedBy.Name'};

        Account account = new Account(Name = 'Test Account');
        insert account;

        Account expected_account = Database.queryWithBinds('SELECT ' + String.join(fields, ', ') + ' FROM Account WHERE Id = :account_id', new Map<String, Object>{'account_id' => account.Id}, AccessLevel.SYSTEM_MODE);

        Account actual_account = (Account)LWC_Query.safe_records_cached(fields, 'Account', new String[]{'Id', '=', account.Id}, null, null, null, null)[0];

        Assert.areEqual(expected_account.Id, actual_account.Id);
        Assert.areEqual(expected_account.Name, actual_account.Name);
        Assert.areEqual(expected_account.CreatedBy.Name, actual_account.CreatedBy.Name);
    }

}