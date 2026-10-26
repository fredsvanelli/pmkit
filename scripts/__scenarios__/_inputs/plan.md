Plan for ISS-4M2S:

1. Define the column order once, as the finance template lists it: date, invoice, customer, total.
2. Make the CSV writer of the billing export read that list for the header and for each row.
3. Add a test that exports two invoices and checks the header and the first row.
