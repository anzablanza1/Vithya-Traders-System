-- Performance fix for FTP V2 sales-document replacement.
-- The importer locates, counts, and deletes invoice rows by invoice_id_db_id.
-- Added on live Supabase 2026-11-20 after a statement timeout on October 31 sales import.
CREATE INDEX IF NOT EXISTS idx_sales_invoice_id_db_id
ON public.sales_data (invoice_id_db_id);
