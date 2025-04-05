public without sharing class LWC_Query {

    @AuraEnabled(cacheable=true)
    public static SObject[] safe_records_cached(String[] fields, String sobject_name, String[] and_filters, String[] or_filters, String and_or_between_filters, String order_by, Integer query_limit) {
        return safe_records(fields, sobject_name, and_filters, or_filters, and_or_between_filters, order_by, query_limit);
    }

    @AuraEnabled(cacheable=false)
    public static SObject[] safe_records(String[] fields, String sobject_name, String[] and_filters, String[] or_filters, String and_or_between_filters, String order_by, Integer query_limit) {
        /* Protects against SOQL injection by clearing out apostrophes from the SOQL input

            Note: This does support querying related fields. It does NOT support child records or sub-select queries

            Filters should be a lists of Strings with a size that is a multiple of three.
            For each triplet of strings, the first is the field name, the second is the operator, and the third is the value.
            and_filters will all use AND to join them. or_filters will use OR between them.
            and_or_between_filters determines how to join the two sets of filters

            Example of and_filters:
                ['AnnualRevenue', '>', '100000', 'CreatedDate', '=', 'THIS_YEAR'] -> (AnnualRevenue > 100000 AND CreatedDate = THIS_YEAR)

            Complex example:
                and_filters: ['AnnualRevenue', '>', '100000', 'CreatedDate', '=', 'THIS_YEAR']
                or_filters: ['CALENDAR_MONTH(CreatedDate)', '=', '1', 'CALENDAR_MONTH(CreatedDate)', '=', '4']
                and_or_between_filters: 'AND'
                    -> (AnnualRevenue > 100000 AND CreatedDate = THIS_YEAR) AND (CALENDAR_MONTH(CreatedDate) = 1 OR CALENDAR_MONTH(CreatedDate) = 4)
        */

        String query = 'SELECT ' + String.join(safe_strings(fields), ', ') + ' ' +
                         'FROM ' + sobject_name + ' ' +
                        all_filters_string(sobject_name, and_filters, or_filters, and_or_between_filters) + ' ' +
                        (String.isNotBlank(order_by) ? 'ORDER BY ' + order_by.remove('\'') + ' ' : '' ) +
                        (query_limit != null ? 'LIMIT ' + query_limit : '');

        System.debug('LWC Utilities.safe records | query: ' + query);
        return Database.query(query);
    }

        private static String[] safe_strings(String[] strings) {
            String[] safe_strings = new String[]{};
            for (String original : strings) {safe_strings.add(original.remove('\''));}
            return safe_strings;
        }
        public static String all_filters_string(String sobject_name, String[] and_filters, String[] or_filters, String and_or_between_filters) {
            String[] filter_strings = new String[]{};

            String and_filter_string = filter_string(and_filters, sobject_name, ' AND ');
            String or_filter_string  = filter_string(or_filters,  sobject_name, ' OR ');
            if (and_filter_string != null) {filter_strings.add(and_filter_string);}
            if (or_filter_string  != null) {filter_strings.add(or_filter_string);}

            return filter_strings.isEmpty() ? '' : 'WHERE ' + String.join(filter_strings, ' ' + (and_or_between_filters != null ? and_or_between_filters : 'AND') + ' ');
        }
        private static String filter_string(String[] filter_data, String sobject_name, String and_or) {
            if (filter_data == null || filter_data.isEmpty()) {return null;}

            Assert.areEqual(0, Math.mod(filter_data.size(), 3));
            String[] safe_data = safe_strings(filter_data);

            Integer filter_count = filter_data.size() / 3;

            String[] filters = new String[]{};
            for (Integer i = 0; i < filter_count; i++) {
                Integer this_filter_start = i * 3;
                filters.add(single_filter_string(sobject_name, safe_data[this_filter_start], safe_data[this_filter_start + 1], safe_data[this_filter_start + 2]));
            }

            return '(' + String.join(filters, and_or) + ')';
        }
            private static String single_filter_string(String sobject_name, String field, String operator, String value) {
                // 'field' can actually be something more complicated than a field, like a SOQL function. For example, CALENDAR_MONTH(CreatedDate)
                // So, we have to extract the real field before checking the SOAP Type.
                String base_field = field.contains('(') ? field.substringBetween('(', ')') : field;

                Set<String> string_types = new Set<String>{String.valueOf(SOAPType.STRING), String.valueOf(SOAPType.ID)};
                system.debug('LWC Utilities.single filter string | sobject_name: ' + sobject_name);
                system.debug('LWC Utilities.single filter string | base_field: ' + base_field);
                if (string_types.contains(Utilities.related_field_type(sobject_name, base_field))) {value = '\'' + value + '\'';}
                return String.join(new String[]{field, operator, value}, ' ');
            }
}