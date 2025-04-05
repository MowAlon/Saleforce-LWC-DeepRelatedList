@isTest
public class Utilities_test extends Utilities {

   @isTest static void test_related_field() {
      Account parent_account = new Account(Name = 'Parent');
      Account child_account  = new Account(Name = 'Child');
      parent_account.AnnualRevenue = 666;
      insert parent_account;

      child_account.ParentId = parent_account.Id;
      insert child_account;

      Opportunity opp = new Opportunity(AccountId = child_account.Id, Name = 'Test Opp', StageName = 'New', CloseDate = Date.today());
      insert opp;

      opp = [SELECT Account.Parent.AnnualRevenue FROM Opportunity WHERE Id = :opp.Id];
      Assert.areEqual(666, opp.Account.Parent.AnnualRevenue);

      Assert.areEqual(666,              (Decimal)related_field(opp, 'Account.Parent.AnnualRevenue'));
      Assert.areEqual('Annual Revenue', related_field_label(opp, 'Account.Parent.AnnualRevenue'));
      Assert.areEqual('DOUBLE',         related_field_type(opp, 'Account.Parent.AnnualRevenue'));
   }

}