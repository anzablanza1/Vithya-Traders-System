-- Vithya Traders — READ-ONLY FTP audit after backlog (2026-11-19)
-- Never mistake a zero-activity day for proof of a failed import.
-- Verify Vasy export filenames and the business holiday calendar separately.

-- 1. Freshness and table row counts for FTP-owned datasets.
SELECT 'sales_data' AS dataset,count(*) AS lines,max(loaded_at) AS latest_load FROM public.sales_data
UNION ALL SELECT 'purchase_bill_data',count(*),max(loaded_at) FROM public.purchase_bill_data
UNION ALL SELECT 'material_inward_data',count(*),max(loaded_at) FROM public.material_inward_data
UNION ALL SELECT 'stock_adjustment_data',count(*),max(loaded_at) FROM public.stock_adjustment_data
UNION ALL SELECT 'bank_receipt_data',count(*),max(loaded_at) FROM public.bank_receipt_data
UNION ALL SELECT 'cash_receipt_data',count(*),max(loaded_at) FROM public.cash_receipt_data
UNION ALL SELECT 'cash_payment_data',count(*),max(loaded_at) FROM public.cash_payment_data
UNION ALL SELECT 'expense_register_data',count(*),max(loaded_at) FROM public.expense_register_data
UNION ALL SELECT 'credit_note_data',count(*),max(loaded_at) FROM public.credit_note_data
UNION ALL SELECT 'purchase_return_data',count(*),max(loaded_at) FROM public.purchase_return_data
UNION ALL SELECT 'vendor_data',count(*),max(loaded_at) FROM public.vendor_data;

-- 2. Daily business-date coverage across October-November backlog.
WITH days AS (
  SELECT g::date AS day FROM generate_series(DATE '2026-10-11',CURRENT_DATE,INTERVAL '1 day') g
),
sales AS (
  SELECT to_date(date,'DD/MM/YYYY') AS day,count(*) AS lines
  FROM public.sales_data WHERE date ~ '^\d{2}/\d{2}/\d{4}$' GROUP BY 1
),
purchases AS (
  SELECT to_date(bill_date,'DD/MM/YYYY') AS day,count(*) AS lines
  FROM public.purchase_bill_data WHERE bill_date ~ '^\d{2}/\d{2}/\d{4}$' GROUP BY 1
),
inward AS (
  SELECT to_date(inward_date,'DD/MM/YYYY') AS day,count(*) AS lines
  FROM public.material_inward_data WHERE inward_date ~ '^\d{2}/\d{2}/\d{4}$' GROUP BY 1
),
stock AS (
  SELECT to_date(stock_transaction_date,'DD/MM/YYYY') AS day,count(*) AS lines
  FROM public.stock_adjustment_data WHERE stock_transaction_date ~ '^\d{2}/\d{2}/\d{4}$' GROUP BY 1
),
bank AS (
  SELECT to_date(date,'DD-MM-YYYY') AS day,count(*) AS lines
  FROM public.bank_receipt_data WHERE date ~ '^\d{2}-\d{2}-\d{4}$' GROUP BY 1
),
cash AS (
  SELECT to_date(date,'DD-MM-YYYY') AS day,count(*) AS lines
  FROM public.cash_receipt_data WHERE date ~ '^\d{2}-\d{2}-\d{4}$' GROUP BY 1
)
SELECT d.day,to_char(d.day,'Dy') AS weekday,coalesce(sales.lines,0) AS sales_lines,
 coalesce(purchases.lines,0) AS purchase_lines,coalesce(inward.lines,0) AS inward_lines,
 coalesce(stock.lines,0) AS adjustment_lines,coalesce(bank.lines,0) AS bank_lines,
 coalesce(cash.lines,0) AS cash_lines
FROM days d LEFT JOIN sales ON sales.day=d.day
 LEFT JOIN purchases ON purchases.day=d.day LEFT JOIN inward ON inward.day=d.day
 LEFT JOIN stock ON stock.day=d.day LEFT JOIN bank ON bank.day=d.day
 LEFT JOIN cash ON cash.day=d.day
ORDER BY d.day;

-- 3. Legitimate voucher number collisions across distinct invoice DB IDs.
SELECT voucher_no,count(DISTINCT invoice_id_db_id) invoice_ids,count(*) lines
FROM public.sales_data GROUP BY voucher_no
HAVING count(DISTINCT invoice_id_db_id)>1 ORDER BY voucher_no;

-- 4. API FTP fallback overlap: inspect; do not delete API records.
SELECT count(DISTINCT g.voucher_no) overlapping_vouchers
FROM public.sales_ftp_gap g
WHERE EXISTS (SELECT 1 FROM public.sales_data f WHERE f.voucher_no=g.voucher_no);

-- 5. FY2024-25 stays in history and never enters FTP sales_data.
SELECT count(*) preserved_fy2425_rows FROM public.sales_history WHERE fy='2425';
SELECT count(*) invalid_fy2425_ftp_rows FROM public.sales_data
WHERE date ~ '^\d{2}/\d{2}/\d{4}$'
  AND to_date(date,'DD/MM/YYYY')<DATE '2025-04-01';
