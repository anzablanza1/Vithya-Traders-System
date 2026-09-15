


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "api";


ALTER SCHEMA "api" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vt_date"("t" "text") RETURNS "date"
    LANGUAGE "plpgsql" IMMUTABLE PARALLEL SAFE
    AS $$
declare v date;
begin
  if t is null or btrim(t) = '' then return null; end if;
  begin
    -- Vasy exports DD/MM/YYYY throughout. Verified: 100% of populated
    -- date cells across sales, purchase, inward and stock match this.
    v := to_date(btrim(t), 'DD/MM/YYYY');
  exception when others then
    return null;
  end;
  return v;
end $$;


ALTER FUNCTION "public"."vt_date"("t" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."vt_date"("t" "text") IS 'VT-DW-014. DD/MM/YYYY text to date, NULL on failure. Output is a real date
   type, so PostgREST serialises it as unambiguous ISO - this is what removes
   the dd/mm vs mm/dd misreading in Google Sheets.';



CREATE OR REPLACE FUNCTION "public"."vt_doc_no"("p_prefix" "text", "p_sales_no" "text", "p_order_no" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select coalesce(nullif(trim(p_order_no),''),
                  nullif(trim(coalesce(p_prefix,'') || coalesce(p_sales_no,'')),''))
$$;


ALTER FUNCTION "public"."vt_doc_no"("p_prefix" "text", "p_sales_no" "text", "p_order_no" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vt_month"("t" "text") RETURNS "date"
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    AS $$
  select date_trunc('month', public.vt_date(t)::timestamp)::date;
$$;


ALTER FUNCTION "public"."vt_month"("t" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."vt_month"("t" "text") IS 'VT-DW-014c. First day of the month for a DD/MM/YYYY string. IMMUTABLE so it
   can back an index - unlike date_trunc over timestamptz.';



CREATE OR REPLACE FUNCTION "public"."vt_num"("t" "text") RETURNS numeric
    LANGUAGE "plpgsql" IMMUTABLE PARALLEL SAFE
    AS $$
declare v numeric;
begin
  if t is null then return null; end if;
  begin
    v := replace(replace(btrim(t), ',', ''), ' ', '')::numeric;
  exception when others then
    return null;
  end;
  return v;
end $$;


ALTER FUNCTION "public"."vt_num"("t" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."vt_num"("t" "text") IS 'VT-DW-014. Text to numeric, NULL on failure. Strips commas and spaces.';



CREATE OR REPLACE FUNCTION "public"."vt_party_name"("p_contact_id" bigint, "p_invoice_name" "text") RETURNS "text"
    LANGUAGE "sql" STABLE
    AS $$
  select coalesce(
    (select nullif(trim(c.display_name),'')
       from public.customer_master c
      where c.contact_id = p_contact_id
        and length(regexp_replace(coalesce(c.display_name,''),'^[.\s-]+','')) > 1),
    (select nullif(trim(c.company_name),'')
       from public.customer_master c
      where c.contact_id = p_contact_id),
    nullif(trim(p_invoice_name),''),
    case when p_contact_id is null then 'WALK-IN (no account)' end,
    'UNNAMED #' || p_contact_id::text
  )
$$;


ALTER FUNCTION "public"."vt_party_name"("p_contact_id" bigint, "p_invoice_name" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."bank_receipt_data" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "date" "text",
    "location" "text",
    "branch_id" "text",
    "particulars_id_db" "text",
    "particulars" "text",
    "voucher_type" "text",
    "db_invoiceno" "text",
    "voucher_id_db" "text",
    "voucher_no" "text",
    "description" "text",
    "currency" "text",
    "debit" "text",
    "credit" "text",
    "closing" "text",
    "voucher_created_on" "text",
    "source" "text" DEFAULT 'FTP'::"text",
    "loaded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."bank_receipt_data" OWNER TO "postgres";


COMMENT ON TABLE "public"."bank_receipt_data" IS 'RAW FTP. 416 rows from 17 Aug 2026 only. Same as cash: carries
   db_invoiceno. PARTIAL.';



ALTER TABLE "public"."bank_receipt_data" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."bank_receipt_data_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."cash_payment_data" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "date" "text",
    "location" "text",
    "branch_id" "text",
    "particulars_id_db" "text",
    "particulars" "text",
    "voucher_type" "text",
    "db_invoiceno" "text",
    "voucher_id_db" "text",
    "voucher_no" "text",
    "description" "text",
    "currency" "text",
    "debit" "text",
    "credit" "text",
    "closing" "text",
    "voucher_created_on" "text",
    "source" "text" DEFAULT 'FTP'::"text",
    "loaded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."cash_payment_data" OWNER TO "postgres";


COMMENT ON TABLE "public"."cash_payment_data" IS 'RAW FTP. 38 rows. Payments out.';



ALTER TABLE "public"."cash_payment_data" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."cash_payment_data_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."cash_receipt_data" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "date" "text",
    "location" "text",
    "branch_id" "text",
    "particulars_id_db" "text",
    "particulars" "text",
    "voucher_type" "text",
    "db_invoiceno" "text",
    "voucher_id_db" "text",
    "voucher_no" "text",
    "description" "text",
    "currency" "text",
    "debit" "text",
    "credit" "text",
    "closing" "text",
    "voucher_created_on" "text",
    "source" "text" DEFAULT 'FTP'::"text",
    "loaded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."cash_receipt_data" OWNER TO "postgres";


COMMENT ON TABLE "public"."cash_receipt_data" IS 'RAW FTP. 989 rows from 17 Aug 2026 only. Carries db_invoiceno, which is
   the ONLY reliable link from a receipt to an invoice. PARTIAL — history
   before 17 Aug does not exist here.';



ALTER TABLE "public"."cash_receipt_data" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."cash_receipt_data_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."credit_note_data" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "date" "text",
    "voucher_no" "text",
    "sale_type" "text",
    "voucher_type" "text",
    "order_type" "text",
    "branch_id_db_id" "text",
    "customer_id_db_id" "text",
    "customer_name" "text",
    "mobile_no" "text",
    "gstin" "text",
    "department_name" "text",
    "category_name" "text",
    "sub_category_name" "text",
    "brand_name" "text",
    "sub_brand_name" "text",
    "hsn" "text",
    "product_type" "text",
    "product_id_db_id" "text",
    "varient_id_db_id" "text",
    "item_code" "text",
    "product_name" "text",
    "batch_no" "text",
    "purchase_price" "text",
    "landing_cost" "text",
    "mrp" "text",
    "unit_price" "text",
    "selling_price" "text",
    "qty" "text",
    "uom" "text",
    "taxable_amount" "text",
    "discount" "text",
    "tax_inclusive_discount" "text",
    "other_discount" "text",
    "tax_rate" "text",
    "tax_amount" "text",
    "cgst" "text",
    "sgst" "text",
    "igst" "text",
    "cess_rate" "text",
    "cess_amount" "text",
    "net_amount" "text",
    "sales_man" "text",
    "total_bill_amount" "text",
    "receipt_data" "text",
    "created_by" "text",
    "address" "text",
    "state_name" "text",
    "total_mrp" "text",
    "total_cart_discount" "text",
    "coupon_discount_tax_inclusive" "text",
    "invoice_id_db_id" "text",
    "invoice_no" "text",
    "source" "text" DEFAULT 'FTP'::"text",
    "loaded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."credit_note_data" OWNER TO "postgres";


COMMENT ON TABLE "public"."credit_note_data" IS 'RAW FTP. 10 rows.';



ALTER TABLE "public"."credit_note_data" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."credit_note_data_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."customer_invoice_outstanding" (
    "customer_name" "text" NOT NULL,
    "as_at" "date" NOT NULL,
    "outstanding" numeric DEFAULT 0,
    "d30" numeric DEFAULT 0,
    "d45" numeric DEFAULT 0,
    "d60" numeric DEFAULT 0,
    "d90" numeric DEFAULT 0,
    "d120" numeric DEFAULT 0,
    "d120plus" numeric DEFAULT 0,
    "unpaid_bills" integer DEFAULT 0,
    "source" "text" DEFAULT 'VASY-INVOICE-OUTSTANDING'::"text",
    "loaded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."customer_invoice_outstanding" OWNER TO "postgres";


COMMENT ON TABLE "public"."customer_invoice_outstanding" IS 'Vasy Customer Invoice Outstanding report, uploaded. 468 customers,
   2,383 unpaid bills, Rs 1,91,40,442. Snapshot per as_at date.';



CREATE TABLE IF NOT EXISTS "public"."customer_ledger_snapshot" (
    "party_name" "text" NOT NULL,
    "as_at" "date" NOT NULL,
    "contact_no" "text",
    "opening_balance" numeric DEFAULT 0,
    "debit" numeric DEFAULT 0,
    "credit" numeric DEFAULT 0,
    "closing" numeric DEFAULT 0,
    "source" "text" DEFAULT 'VASY-CUSTOMER-OUTSTANDING'::"text",
    "loaded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."customer_ledger_snapshot" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_master" (
    "contact_id" bigint NOT NULL,
    "first_name" "text",
    "last_name" "text",
    "company_name" "text",
    "display_name" "text",
    "lane" "text",
    "party_key" "text",
    "mobile_no" "text",
    "whatsapp_no" "text",
    "telephone" "text",
    "email" "text",
    "gst_type" "text",
    "gstin" "text",
    "pan" "text",
    "city_name" "text",
    "state_name" "text",
    "country_name" "text",
    "contact_type" "text",
    "branch_id" bigint,
    "branch_name" "text",
    "account_custom_id" bigint,
    "is_active" boolean,
    "last_modified_on" timestamp with time zone,
    "last_modified_by" "text",
    "source" "text" DEFAULT 'API'::"text" NOT NULL,
    "loaded_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."customer_master" OWNER TO "postgres";


COMMENT ON TABLE "public"."customer_master" IS 'Vasy contacts, pulled by API. 1,784. contact_id joins to sales_invoice
   and sales_data.customer_id_db_id. COMPLETE.';



CREATE TABLE IF NOT EXISTS "public"."customer_opening_balance" (
    "customer_name" "text" NOT NULL,
    "as_at" "date" DEFAULT '2026-04-01'::"date" NOT NULL,
    "opening_agreed" numeric,
    "opening_per_vasy" numeric,
    "status" "text" DEFAULT 'NOT CHECKED'::"text" NOT NULL,
    "verified_by" "text",
    "verified_on" "date",
    "method" "text",
    "note" "text",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."customer_opening_balance" OWNER TO "postgres";


COMMENT ON TABLE "public"."customer_opening_balance" IS 'Where you record that an opening balance has been checked with the
   customer. Until status changes from NOT CHECKED, that customer is still
   on the list.';



CREATE TABLE IF NOT EXISTS "public"."erp_snapshot" (
    "item_code" "text" NOT NULL,
    "product_name" "text",
    "selling_w" numeric,
    "selling_wo" numeric,
    "mrp_w" numeric,
    "mrp_wo" numeric,
    "gst_rate" numeric,
    "qty" numeric,
    "data" "jsonb",
    "source" "text" DEFAULT 'API'::"text",
    "loaded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."erp_snapshot" OWNER TO "postgres";


COMMENT ON TABLE "public"."erp_snapshot" IS 'ERP product snapshot (cost/price/qty as Vasy holds it), pushed by API.
   Full row kept in data jsonb so a Vasy schema change does not lose fields.';



CREATE TABLE IF NOT EXISTS "public"."material_inward_data" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "status" "text",
    "branch_id_db_ref_id" "text",
    "inward_no" "text",
    "vendordb_id" "text",
    "supplier_name" "text",
    "inward_date" "text",
    "item_code" "text",
    "product_id_db" "text",
    "product_varient_id_db" "text",
    "po_date" "text",
    "po_no" "text",
    "po_amount" "text",
    "po_qty" "text",
    "po_uom" "text",
    "inward_amount" "text",
    "tax_amount" "text",
    "inward_qty" "text",
    "uom" "text",
    "received_by_employee_db_id" "text",
    "created_by_employee_db_id" "text",
    "additional_charge_taxable_amount" "text",
    "additional_charge_tax_amount" "text",
    "additional_charge_total_amount" "text",
    "location" "text",
    "notes" "text",
    "source" "text" DEFAULT 'FTP'::"text",
    "loaded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."material_inward_data" OWNER TO "postgres";


COMMENT ON TABLE "public"."material_inward_data" IS 'RAW FTP. 10,305 rows.';



ALTER TABLE "public"."material_inward_data" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."material_inward_data_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."ops_pipeline_snapshots" (
    "snapshot_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "payload" "jsonb" NOT NULL
);


ALTER TABLE "public"."ops_pipeline_snapshots" OWNER TO "postgres";


COMMENT ON TABLE "public"."ops_pipeline_snapshots" IS 'Old scaffolding from the early data-warehouse work. 5 rows. Nothing reads
   it — safe to drop once you are sure.';



CREATE TABLE IF NOT EXISTS "public"."product_consumption_data" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "branch_id_db_ref_id" "text",
    "product_id" "text",
    "product_variant_id" "text",
    "consumption_date" "text",
    "location" "text",
    "consumption_no" "text",
    "consumption_type" "text",
    "item_code" "text",
    "department" "text",
    "category" "text",
    "sub_category" "text",
    "brand" "text",
    "sub_brand" "text",
    "product_name_varient_name" "text",
    "hsn_code" "text",
    "batch_no" "text",
    "uom" "text",
    "batch_purchase_price" "text",
    "purchase_tax_rate" "text",
    "batch_landing_cost" "text",
    "sales_tax_rate" "text",
    "batch_mrp" "text",
    "qty" "text",
    "stock_value" "text",
    "source" "text" DEFAULT 'FTP'::"text",
    "loaded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."product_consumption_data" OWNER TO "postgres";


COMMENT ON TABLE "public"."product_consumption_data" IS 'RAW FTP. Empty so far.';



ALTER TABLE "public"."product_consumption_data" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."product_consumption_data_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."product_data" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "branch_id_db_ref_id" "text",
    "departments" "text",
    "category" "text",
    "sub_category" "text",
    "brand" "text",
    "sub_brand" "text",
    "product_id" "text",
    "item_code" "text",
    "batch_no" "text",
    "product_name" "text",
    "print_name" "text",
    "short_description" "text",
    "description" "text",
    "measurement_name" "text",
    "measurement_code" "text",
    "hsn_code" "text",
    "sales_tax_name" "text",
    "sales_tax_rate" "text",
    "purchase_tax_name" "text",
    "purchase_tax_rate" "text",
    "sales_taxincludeing_yes_no" "text",
    "purchase_tax_includeing_yes_no" "text",
    "have_variant_yes_no" "text",
    "variant_name_seprated_by" "text",
    "mrp" "text",
    "purchase_price" "text",
    "discount_type_amount_percentage_default_percentage" "text",
    "discount_default_zero" "text",
    "qty" "text",
    "net_weight" "text",
    "ingredients_seprated_by_pipe_sign" "text",
    "membership_margin" "text",
    "membership_margin_type_amount_percentage" "text",
    "normal_margin" "text",
    "normal_margin_type_amount_percentage" "text",
    "product_type_finished_semifinished_packaging_raw" "text",
    "wholesale_price" "text",
    "retailer_price" "text",
    "online_price" "text",
    "minimum_qty" "text",
    "image_link" "text",
    "cess_yes_no" "text",
    "cess_rate" "text",
    "stock_limit" "text",
    "po_qty_po_qty_must_be_greater_than_stock_limit" "text",
    "manage_multiple_batch_yes_no" "text",
    "has_expiry_yes_no_default_no" "text",
    "add_expiry_days" "text",
    "mfg_date_dd_mm_yyyy" "text",
    "exp_date_dd_mm_yyyy" "text",
    "is_expiry_product_saleable_yes_no" "text",
    "source" "text" DEFAULT 'FTP'::"text",
    "loaded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."product_data" OWNER TO "postgres";


COMMENT ON TABLE "public"."product_data" IS 'RAW FTP. 97 rows against ~13,685 products. The FTP product export is a
   DELTA — only products that changed — so this fills slowly and may never
   be complete. Do not use it as a product master. Pull products by API.';



ALTER TABLE "public"."product_data" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."product_data_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."purchase_bill_data" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "status" "text",
    "branch_id_db_ref_id" "text",
    "bill_date" "text",
    "bill_no" "text",
    "voucher_no" "text",
    "inward_no" "text",
    "po_no" "text",
    "vendordb_id" "text",
    "party_name" "text",
    "address" "text",
    "gst_no" "text",
    "pan_no" "text",
    "department" "text",
    "category" "text",
    "sub_category" "text",
    "brand" "text",
    "sub_brand" "text",
    "uom" "text",
    "hsn" "text",
    "product_type" "text",
    "product_name" "text",
    "short_description" "text",
    "product_id_db" "text",
    "product_varient_id_db" "text",
    "item_code" "text",
    "rate" "text",
    "qty" "text",
    "free_qty" "text",
    "discount_1" "text",
    "discount_2" "text",
    "flat_discount_amount" "text",
    "cgst" "text",
    "igst" "text",
    "sgst" "text",
    "cess_rate" "text",
    "cess_amount" "text",
    "total_amount" "text",
    "tax_rate" "text",
    "tax_amount" "text",
    "tcs_amount" "text",
    "tds_amount" "text",
    "additional_charge_taxable_amount" "text",
    "additional_charge_tax_amount" "text",
    "additional_charge_total_amount" "text",
    "location" "text",
    "total_bill_amount" "text",
    "created_by_employee_db_id" "text",
    "source" "text" DEFAULT 'FTP'::"text",
    "loaded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."purchase_bill_data" OWNER TO "postgres";


COMMENT ON TABLE "public"."purchase_bill_data" IS 'RAW FTP. 10,353 rows. Proper data entry only began this financial year,
   so anything before Apr 2026 is sparse by nature, not by fault.';



ALTER TABLE "public"."purchase_bill_data" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."purchase_bill_data_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."purchase_return_data" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "status" "text",
    "branch_id_db_ref_id" "text",
    "bill_date" "text",
    "bill_no" "text",
    "voucher_no" "text",
    "vendordb_id" "text",
    "party_name" "text",
    "address" "text",
    "gst_no" "text",
    "pan_no" "text",
    "department" "text",
    "category" "text",
    "sub_category" "text",
    "brand" "text",
    "sub_brand" "text",
    "uom" "text",
    "hsn" "text",
    "product_type" "text",
    "product_name" "text",
    "short_description" "text",
    "product_id_db" "text",
    "product_varient_id_db" "text",
    "item_code" "text",
    "rate" "text",
    "qty" "text",
    "free_qty" "text",
    "discount_1" "text",
    "discount_2" "text",
    "flat_discount_amount" "text",
    "cgst" "text",
    "igst" "text",
    "sgst" "text",
    "cess_rate" "text",
    "cess_amount" "text",
    "total_amount" "text",
    "tax_rate" "text",
    "tax_amount" "text",
    "tcs_amount" "text",
    "tds_amount" "text",
    "additional_charge_taxable_amount" "text",
    "additional_charge_tax_amount" "text",
    "additional_charge_total_amount" "text",
    "location" "text",
    "total_bill_amount" "text",
    "created_by_employee_db_id" "text",
    "source" "text" DEFAULT 'FTP'::"text",
    "loaded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."purchase_return_data" OWNER TO "postgres";


COMMENT ON TABLE "public"."purchase_return_data" IS 'RAW FTP. 3 rows.';



ALTER TABLE "public"."purchase_return_data" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."purchase_return_data_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."receipt_register" (
    "receipt_no" "text" NOT NULL,
    "party_name" "text",
    "mode" "text",
    "receipt_type" "text",
    "receipt_date" "date",
    "amount" numeric,
    "status" "text",
    "created_by" "text",
    "fy" "text",
    "source" "text" DEFAULT 'VASY-EXPORT'::"text",
    "loaded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."receipt_register" OWNER TO "postgres";


COMMENT ON TABLE "public"."receipt_register" IS 'Receipts exported from Vasy. Carries the receipt number but NOT the
   invoice db id, so it cannot be joined to invoices — it answers "how much
   came in" for history, not "against what".';



CREATE TABLE IF NOT EXISTS "public"."sales_data" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "date" "text",
    "voucher_no" "text",
    "sale_type" "text",
    "voucher_type" "text",
    "order_type" "text",
    "branch_id_db_id" "text",
    "customer_id_db_id" "text",
    "customer_name" "text",
    "mobile_no" "text",
    "gstin" "text",
    "department_name" "text",
    "category_name" "text",
    "sub_category_name" "text",
    "brand_name" "text",
    "sub_brand_name" "text",
    "hsn" "text",
    "product_type" "text",
    "product_id_db_id" "text",
    "varient_id_db_id" "text",
    "item_code" "text",
    "product_name" "text",
    "batch_no" "text",
    "purchase_price" "text",
    "landing_cost" "text",
    "mrp" "text",
    "unit_price" "text",
    "selling_price" "text",
    "qty" "text",
    "uom" "text",
    "taxable_amount" "text",
    "discount" "text",
    "tax_inclusive_discount" "text",
    "other_discount" "text",
    "tax_rate" "text",
    "tax_amount" "text",
    "cgst" "text",
    "sgst" "text",
    "igst" "text",
    "cess_rate" "text",
    "cess_amount" "text",
    "net_amount" "text",
    "sales_man" "text",
    "total_bill_amount" "text",
    "receipt_data" "text",
    "created_by" "text",
    "address" "text",
    "state_name" "text",
    "total_mrp" "text",
    "total_cart_discount" "text",
    "coupon_discount_tax_inclusive" "text",
    "invoice_id_db_id" "text",
    "invoice_no" "text",
    "source" "text" DEFAULT 'FTP'::"text",
    "loaded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sales_data" OWNER TO "postgres";


COMMENT ON TABLE "public"."sales_data" IS 'RAW. What the FTP sent, nothing else writes here. Rolling ~14-day window,
   so it holds recent documents plus any older one that was edited. 13,070
   rows. NOT the full history — read v_sales_all for that.';



ALTER TABLE "public"."sales_data" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."sales_data_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sales_ftp_gap" (
    "id" bigint NOT NULL,
    "voucher_no" "text" NOT NULL,
    "sales_date" "date",
    "sale_month" "text",
    "item_code" "text",
    "product_name" "text",
    "category_name" "text",
    "sub_category_name" "text",
    "brand_name" "text",
    "department_name" "text",
    "qty" numeric,
    "mrp" numeric,
    "unit_price" numeric,
    "selling_price" numeric,
    "purchase_price" numeric,
    "landing_cost" numeric,
    "net_amount" numeric,
    "tax_rate" numeric,
    "tax_amount" numeric,
    "customer_name" "text",
    "contact_id" bigint,
    "sale_type" "text",
    "sales_man" "text",
    "pulled_for_day" "date",
    "source" "text" DEFAULT 'API-FTPGAP'::"text",
    "loaded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sales_ftp_gap" OWNER TO "postgres";


COMMENT ON TABLE "public"."sales_ftp_gap" IS 'Sales the API pulled while the FTP feed was down. Separate table so it can
   be TRUNCATEd once FTP has re-sent those documents. v_sales_all reads it
   below FTP and below sales_history.';



CREATE SEQUENCE IF NOT EXISTS "public"."sales_ftp_gap_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."sales_ftp_gap_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."sales_ftp_gap_id_seq" OWNED BY "public"."sales_ftp_gap"."id";



CREATE TABLE IF NOT EXISTS "public"."sales_history" (
    "id" bigint NOT NULL,
    "voucher_no" "text" NOT NULL,
    "sales_date" "date",
    "item_code" "text",
    "product_name" "text",
    "category_name" "text",
    "brand_name" "text",
    "qty" numeric,
    "mrp" numeric,
    "unit_price" numeric,
    "selling_price" numeric,
    "purchase_price" numeric,
    "landing_cost" numeric,
    "net_amount" numeric,
    "discount" numeric,
    "tax_rate" numeric,
    "tax_amount" numeric,
    "customer_name" "text",
    "contact_id" bigint,
    "mobile_no" "text",
    "sale_type" "text",
    "hsn" "text",
    "uom" "text",
    "batch_no" "text",
    "sales_man" "text",
    "receipt_data" "text",
    "sale_month" "text",
    "fy" "text",
    "source" "text" NOT NULL,
    "loaded_at" timestamp with time zone DEFAULT "now"(),
    "product_type" "text",
    "sub_category_name" "text",
    "sub_brand_name" "text",
    "department_name" "text",
    "src_row" "text"
);


ALTER TABLE "public"."sales_history" OWNER TO "postgres";


COMMENT ON TABLE "public"."sales_history" IS 'Backfilled sales lines from the year workbooks and the API. NEVER written
   by the FTP pipeline. sales_data stays raw; read v_sales_all for both.';



COMMENT ON COLUMN "public"."sales_history"."src_row" IS 'Unique row key within a source. Integers for sheet backfills; strings like
   "Sales_Items_2627:1234" for API-FAILOVER rows.';



CREATE SEQUENCE IF NOT EXISTS "public"."sales_history_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."sales_history_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."sales_history_id_seq" OWNED BY "public"."sales_history"."id";



CREATE TABLE IF NOT EXISTS "public"."sales_invoice" (
    "sales_id" bigint NOT NULL,
    "prefix" "text",
    "sales_no" "text",
    "order_no" "text",
    "sales_date" "date",
    "due_date" "date",
    "inv_type" "text",
    "channel_name" "text",
    "status" "text",
    "payment_type" "text",
    "contact_id" bigint,
    "customer_name" "text",
    "total" numeric,
    "paid_amount" numeric,
    "balance" numeric,
    "fy" "text",
    "source" "text" DEFAULT 'API'::"text",
    "loaded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sales_invoice" OWNER TO "postgres";


COMMENT ON TABLE "public"."sales_invoice" IS 'Vasy sales invoice register, pulled via API. sales_id is the invoice db id
   that cash_receipt_data.db_invoiceno and bank_receipt_data.db_invoiceno
   reference — this table is what makes receipts joinable to invoices.';



CREATE TABLE IF NOT EXISTS "public"."stock_adjustment_data" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "created_on" "text",
    "stock_transaction_date" "text",
    "location" "text",
    "branch_id_db_ref_id" "text",
    "type" "text",
    "product_id" "text",
    "product_variant_id" "text",
    "item_name" "text",
    "item_code" "text",
    "batch" "text",
    "in_qty" "text",
    "out_qty" "text",
    "unit" "text",
    "adjusted_qty" "text",
    "user" "text",
    "source" "text" DEFAULT 'FTP'::"text",
    "loaded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."stock_adjustment_data" OWNER TO "postgres";


COMMENT ON TABLE "public"."stock_adjustment_data" IS 'RAW FTP. 24,749 rows. Replaced by transaction DATE, not document number —
   it has no document number.';



ALTER TABLE "public"."stock_adjustment_data" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."stock_adjustment_data_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."stock_live" (
    "item_code" "text" NOT NULL,
    "product_name" "text",
    "qty_w" numeric,
    "qty_wo" numeric,
    "qty_total" numeric,
    "category" "text",
    "brand" "text",
    "source" "text" DEFAULT 'API'::"text",
    "loaded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."stock_live" OWNER TO "postgres";


COMMENT ON TABLE "public"."stock_live" IS 'Current stock, pushed from the Stock_Live sheet by API. Live figure the
   counter needs; refreshed nightly and on demand. COMPLETE.';



CREATE OR REPLACE VIEW "public"."v_purchase" AS
 SELECT "id",
    "created_at",
    "status",
    "branch_id_db_ref_id",
    "bill_date",
    "bill_no",
    "voucher_no",
    "inward_no",
    "po_no",
    "vendordb_id",
    "party_name",
    "address",
    "gst_no",
    "pan_no",
    "department",
    "category",
    "sub_category",
    "brand",
    "sub_brand",
    "uom",
    "hsn",
    "product_type",
    "product_name",
    "short_description",
    "product_id_db",
    "product_varient_id_db",
    "item_code",
    "rate",
    "qty",
    "free_qty",
    "discount_1",
    "discount_2",
    "flat_discount_amount",
    "cgst",
    "igst",
    "sgst",
    "cess_rate",
    "cess_amount",
    "total_amount",
    "tax_rate",
    "tax_amount",
    "tcs_amount",
    "tds_amount",
    "additional_charge_taxable_amount",
    "additional_charge_tax_amount",
    "additional_charge_total_amount",
    "location",
    "total_bill_amount",
    "created_by_employee_db_id",
    "source",
    "loaded_at",
    "public"."vt_date"("bill_date") AS "bill_dt",
    ("date_trunc"('month'::"text", ("public"."vt_date"("bill_date"))::timestamp with time zone))::"date" AS "bill_month",
    "public"."vt_num"("qty") AS "qty_num",
    "public"."vt_num"("free_qty") AS "free_qty_num",
    "public"."vt_num"("rate") AS "rate_num",
    "public"."vt_num"("discount_1") AS "discount_1_num",
    "public"."vt_num"("discount_2") AS "discount_2_num",
    "public"."vt_num"("tax_rate") AS "tax_rate_num",
    "public"."vt_num"("tax_amount") AS "tax_amount_num",
    "public"."vt_num"("total_amount") AS "total_amount_num",
    "public"."vt_num"("total_bill_amount") AS "total_bill_amount_num",
        CASE
            WHEN ("item_code" ~~ '%/'::"text") THEN 'NON_GST'::"text"
            ELSE 'GST'::"text"
        END AS "sku_lane",
    "rtrim"("item_code", '/'::"text") AS "item_code_base",
        CASE
            WHEN ("left"(COALESCE("party_name", ''::"text"), 1) = '.'::"text") THEN 'NON_GST'::"text"
            ELSE 'GST'::"text"
        END AS "supplier_lane"
   FROM "public"."purchase_bill_data" "p";


ALTER VIEW "public"."v_purchase" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_purchase" IS 'VT-DW-014. purchase_bill_data typed. supplier_lane from leading dot.';



CREATE OR REPLACE VIEW "public"."v_agg_purchase_month_item" AS
 SELECT "bill_month",
    "item_code_base",
    "max"("product_name") AS "product_name",
    "sku_lane",
    "supplier_lane",
    "count"(DISTINCT "voucher_no") AS "bills",
    "count"(DISTINCT "vendordb_id") AS "suppliers",
    "sum"("qty_num") AS "qty",
    "sum"("total_amount_num") AS "total_value",
    "round"(("sum"("total_amount_num") / NULLIF("sum"("qty_num"), (0)::numeric)), 3) AS "wavg_rate"
   FROM "public"."v_purchase"
  WHERE ("bill_month" IS NOT NULL)
  GROUP BY "bill_month", "item_code_base", "sku_lane", "supplier_lane";


ALTER VIEW "public"."v_agg_purchase_month_item" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_agg_purchase_month_item" IS 'VT-DW-015. Purchases by month x base product.';



CREATE OR REPLACE VIEW "public"."v_sales_all" AS
 WITH "unioned" AS (
         SELECT 'FTP'::"text" AS "src",
            1 AS "src_rank",
            "s"."voucher_no",
            "public"."vt_date"("s"."date") AS "sales_date",
            "to_char"(("public"."vt_date"("s"."date"))::timestamp with time zone, 'YYYY-MM'::"text") AS "sale_month",
            "s"."item_code",
            "s"."product_name",
            "s"."category_name",
            "s"."sub_category_name",
            "s"."brand_name",
            "s"."department_name",
            "public"."vt_num"("s"."qty") AS "qty",
            "public"."vt_num"("s"."mrp") AS "mrp",
            "public"."vt_num"("s"."unit_price") AS "unit_price",
            "public"."vt_num"("s"."selling_price") AS "selling_price",
            "public"."vt_num"("s"."purchase_price") AS "purchase_price",
            "public"."vt_num"("s"."landing_cost") AS "landing_cost",
            "public"."vt_num"("s"."net_amount") AS "net_amount",
            "public"."vt_num"("s"."taxable_amount") AS "taxable_amount",
            "public"."vt_num"("s"."tax_rate") AS "tax_rate",
            "public"."vt_num"("s"."tax_amount") AS "tax_amount",
            (NULLIF("s"."customer_id_db_id", '0'::"text"))::bigint AS "contact_id",
            "s"."customer_name",
            "s"."sale_type",
            "s"."sales_man",
            "s"."loaded_at"
           FROM "public"."sales_data" "s"
          WHERE ("s"."date" ~ '^\d{2}/\d{2}/\d{4}$'::"text")
        UNION ALL
         SELECT 'API-FTPGAP'::"text" AS "text",
            2,
            "g"."voucher_no",
            "g"."sales_date",
            "g"."sale_month",
            "g"."item_code",
            "g"."product_name",
            "g"."category_name",
            "g"."sub_category_name",
            "g"."brand_name",
            "g"."department_name",
            "g"."qty",
            "g"."mrp",
            "g"."unit_price",
            "g"."selling_price",
            "g"."purchase_price",
            "g"."landing_cost",
            "g"."net_amount",
                CASE
                    WHEN (("g"."tax_rate" IS NOT NULL) AND ("g"."tax_rate" <> (0)::numeric)) THEN "round"(("g"."net_amount" / ((1)::numeric + ("g"."tax_rate" / 100.0))), 2)
                    ELSE "g"."net_amount"
                END AS "net_amount",
            "g"."tax_rate",
            "g"."tax_amount",
            "g"."contact_id",
            "g"."customer_name",
            "g"."sale_type",
            "g"."sales_man",
            "g"."loaded_at"
           FROM "public"."sales_ftp_gap" "g"
        UNION ALL
         SELECT "h"."source",
                CASE
                    WHEN ("h"."source" ~~ 'API-%'::"text") THEN 2
                    ELSE 3
                END AS "case",
            "h"."voucher_no",
            "h"."sales_date",
            "h"."sale_month",
            "h"."item_code",
            "h"."product_name",
            "h"."category_name",
            "h"."sub_category_name",
            "h"."brand_name",
            "h"."department_name",
            "h"."qty",
            "h"."mrp",
            "h"."unit_price",
            "h"."selling_price",
            "h"."purchase_price",
            "h"."landing_cost",
            "h"."net_amount",
                CASE
                    WHEN (("h"."tax_rate" IS NOT NULL) AND ("h"."tax_rate" <> (0)::numeric)) THEN "round"(("h"."net_amount" / ((1)::numeric + ("h"."tax_rate" / 100.0))), 2)
                    ELSE "h"."net_amount"
                END AS "net_amount",
            "h"."tax_rate",
            "h"."tax_amount",
            "h"."contact_id",
            "h"."customer_name",
            "h"."sale_type",
            "h"."sales_man",
            "h"."loaded_at"
           FROM "public"."sales_history" "h"
        ), "best" AS (
         SELECT "unioned"."voucher_no",
            "min"("unioned"."src_rank") AS "keep_rank"
           FROM "unioned"
          GROUP BY "unioned"."voucher_no"
        )
 SELECT "u"."src",
    "u"."voucher_no",
    "u"."sales_date",
    "u"."sale_month",
    "u"."item_code",
    "regexp_replace"(COALESCE("u"."item_code", ''::"text"), '/+\s*$'::"text", ''::"text") AS "item_code_base",
        CASE
            WHEN ("u"."item_code" ~~ '%/'::"text") THEN 'WO'::"text"
            ELSE 'W'::"text"
        END AS "sku_lane",
    "u"."product_name",
    "u"."category_name",
    "u"."sub_category_name",
    "u"."brand_name",
    "u"."department_name",
    "u"."qty" AS "qty_num",
    "u"."mrp" AS "mrp_num",
    "u"."unit_price" AS "unit_price_num",
    "u"."selling_price" AS "selling_price_num",
    "u"."purchase_price" AS "purchase_price_num",
    "u"."landing_cost" AS "landing_cost_num",
    "u"."net_amount" AS "net_amount_num",
    "u"."taxable_amount" AS "taxable_amount_num",
    "u"."tax_rate",
    "u"."tax_amount" AS "tax_amount_num",
    "u"."contact_id",
    "u"."contact_id" AS "customer_id_db_id",
    "public"."vt_party_name"("u"."contact_id", "u"."customer_name") AS "customer_name_final",
    "u"."customer_name" AS "customer_name_raw",
        CASE
            WHEN (COALESCE("u"."customer_name", ''::"text") ~~ '.%'::"text") THEN 'WO'::"text"
            ELSE 'W'::"text"
        END AS "customer_lane",
        CASE
            WHEN ("u"."contact_id" IS NULL) THEN 'UNKNOWN'::"text"
            WHEN (COALESCE("m"."gstin", ''::"text") <> ''::"text") THEN 'REGISTERED'::"text"
            ELSE 'UNREGISTERED'::"text"
        END AS "gst_registration",
    "m"."gstin" AS "customer_gstin",
    "m"."mobile_no" AS "customer_mobile",
    "m"."city_name" AS "customer_city",
    "m"."party_key" AS "customer_party_key",
        CASE
            WHEN ("upper"(COALESCE("u"."sale_type", ''::"text")) ~~ 'INVOICE%'::"text") THEN 'GST'::"text"
            WHEN ("upper"(COALESCE("u"."sale_type", ''::"text")) ~~ 'POS%'::"text") THEN 'NON_GST'::"text"
            ELSE 'UNKNOWN'::"text"
        END AS "voucher_lane",
    "u"."sale_type",
    "u"."sales_man",
    "u"."loaded_at"
   FROM (("unioned" "u"
     JOIN "best" "b" ON ((("b"."voucher_no" = "u"."voucher_no") AND ("b"."keep_rank" = "u"."src_rank"))))
     LEFT JOIN "public"."customer_master" "m" ON (("m"."contact_id" = "u"."contact_id")));


ALTER VIEW "public"."v_sales_all" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_sales_all" IS 'Every sales line, one source per voucher (FTP > API > SHEET), with the
   same derived columns v_sales has. The aggregates read THIS.';



CREATE OR REPLACE VIEW "public"."v_agg_sales_daily" AS
 SELECT "sales_date" AS "sale_date",
    "voucher_lane",
    "count"(DISTINCT "voucher_no") AS "bills",
    "count"(*) AS "lines",
    "sum"("net_amount_num") AS "net_value"
   FROM "public"."v_sales_all"
  WHERE ("sales_date" IS NOT NULL)
  GROUP BY "sales_date", "voucher_lane";


ALTER VIEW "public"."v_agg_sales_daily" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_agg_sales_daily" IS 'Sales per day per lane. Reads v_sales_all, so it sees ALL 266,177 lines.
   Was reading v_sales (13,070) until 5 Sep, which is why daily figures
   looked far too small.';



CREATE OR REPLACE VIEW "public"."v_agg_sales_month_customer" AS
 SELECT "sale_month",
    "contact_id" AS "customer_id_db_id",
    "max"("customer_name_final") AS "customer",
    "max"("customer_lane") AS "customer_lane",
    "max"("gst_registration") AS "gst_registration",
    "voucher_lane",
    "count"(DISTINCT "voucher_no") AS "bills",
    "sum"("qty_num") AS "qty",
    "sum"("net_amount_num") AS "net_value"
   FROM "public"."v_sales_all"
  WHERE ("sale_month" IS NOT NULL)
  GROUP BY "sale_month", "contact_id", "voucher_lane";


ALTER VIEW "public"."v_agg_sales_month_customer" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_agg_sales_month_customer" IS 'Sales per month per customer per lane. Reads v_sales_all.';



CREATE OR REPLACE VIEW "public"."v_agg_sales_month_item" AS
 SELECT "sale_month",
    "item_code_base",
    "max"("product_name") AS "product_name",
    "sku_lane",
    "count"(DISTINCT "voucher_no") AS "bills",
    "sum"("qty_num") AS "qty",
    "sum"("net_amount_num") AS "net_value",
    "sum"("taxable_amount_num") AS "taxable_value",
    "sum"("tax_amount_num") AS "tax_value",
    "round"("avg"("unit_price_num"), 3) AS "avg_unit_price",
    "sum"(("qty_num" * COALESCE("landing_cost_num", (0)::numeric))) AS "est_cost_at_landing"
   FROM "public"."v_sales_all"
  WHERE ("sale_month" IS NOT NULL)
  GROUP BY "sale_month", "item_code_base", "sku_lane";


ALTER VIEW "public"."v_agg_sales_month_item" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_agg_sales_month_item" IS 'Sales per month per base product per lane. Reads v_sales_all.';



CREATE OR REPLACE VIEW "public"."v_stock_moves" AS
 SELECT "id",
    "created_at",
    "created_on",
    "stock_transaction_date",
    "location",
    "branch_id_db_ref_id",
    "type",
    "product_id",
    "product_variant_id",
    "item_name",
    "item_code",
    "batch",
    "in_qty",
    "out_qty",
    "unit",
    "adjusted_qty",
    "user",
    "source",
    "loaded_at",
    "public"."vt_date"("stock_transaction_date") AS "move_dt",
    ("date_trunc"('month'::"text", ("public"."vt_date"("stock_transaction_date"))::timestamp with time zone))::"date" AS "move_month",
    "public"."vt_num"("in_qty") AS "in_qty_num",
    "public"."vt_num"("out_qty") AS "out_qty_num",
    "public"."vt_num"("adjusted_qty") AS "adjusted_qty_num",
    (COALESCE("public"."vt_num"("in_qty"), (0)::numeric) - COALESCE("public"."vt_num"("out_qty"), (0)::numeric)) AS "net_move_num",
        CASE
            WHEN ("item_code" ~~ '%/'::"text") THEN 'NON_GST'::"text"
            ELSE 'GST'::"text"
        END AS "sku_lane",
    "rtrim"("item_code", '/'::"text") AS "item_code_base"
   FROM "public"."stock_adjustment_data" "a";


ALTER VIEW "public"."v_stock_moves" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_stock_moves" IS 'VT-DW-014. stock_adjustment_data typed. net_move_num = in - out.';



CREATE OR REPLACE VIEW "public"."v_agg_stock_position" AS
 SELECT "item_code_base",
    "max"("item_name") AS "item_name",
    "sku_lane",
    "round"("sum"("net_move_num"), 3) AS "net_movement",
    "max"("move_dt") AS "last_movement",
    "count"(*) AS "movements"
   FROM "public"."v_stock_moves"
  GROUP BY "item_code_base", "sku_lane";


ALTER VIEW "public"."v_agg_stock_position" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_agg_stock_position" IS 'VT-DW-015. Net stock movement per base product from the adjustment ledger.';



CREATE OR REPLACE VIEW "public"."v_sales_data_all" AS
 SELECT "to_char"(("sales_date")::timestamp with time zone, 'DD/MM/YYYY'::"text") AS "date",
    "voucher_no",
    "sale_type",
    "item_code",
    "product_name",
    "category_name",
    "sub_category_name",
    "brand_name",
    "department_name",
    ("qty_num")::"text" AS "qty",
    ("mrp_num")::"text" AS "mrp",
    ("unit_price_num")::"text" AS "unit_price",
    ("selling_price_num")::"text" AS "selling_price",
    ("purchase_price_num")::"text" AS "purchase_price",
    ("landing_cost_num")::"text" AS "landing_cost",
    ("net_amount_num")::"text" AS "net_amount",
    ("taxable_amount_num")::"text" AS "taxable_amount",
    ("tax_rate")::"text" AS "tax_rate",
    ("tax_amount_num")::"text" AS "tax_amount",
    COALESCE(("contact_id")::"text", '0'::"text") AS "customer_id_db_id",
    "customer_name_raw" AS "customer_name",
    "customer_mobile" AS "mobile_no",
    "customer_gstin" AS "gstin",
    "customer_city" AS "city_name",
    NULL::"text" AS "address",
    NULL::"text" AS "state_name",
    "sales_man",
    "src" AS "source",
    "loaded_at"
   FROM "public"."v_sales_all" "a";


ALTER VIEW "public"."v_sales_data_all" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_sales_data_all" IS 'sales_data''s shape, every source''s data. Drop-in replacement for
   "FROM sales_data" in views that must see history as well as the FTP feed.';



CREATE OR REPLACE VIEW "public"."v_customer_360" AS
 WITH "base" AS (
         SELECT "customer_master"."contact_id",
            NULLIF("split_part"("customer_master"."party_key", ':'::"text", 2), ''::"text") AS "stem",
            "customer_master"."lane",
            "customer_master"."branch_id",
            COALESCE(NULLIF(TRIM(BOTH FROM "customer_master"."display_name"), ''::"text"), NULLIF(TRIM(BOTH FROM "customer_master"."company_name"), ''::"text"), NULLIF(TRIM(BOTH FROM (("customer_master"."first_name" || ' '::"text") || COALESCE("customer_master"."last_name", ''::"text"))), ''::"text")) AS "raw_name",
            NULLIF(TRIM(BOTH FROM "customer_master"."city_name"), ''::"text") AS "city",
            NULLIF(TRIM(BOTH FROM "customer_master"."state_name"), ''::"text") AS "state",
            NULLIF(TRIM(BOTH FROM "customer_master"."gstin"), ''::"text") AS "gstin",
            NULLIF(TRIM(BOTH FROM "customer_master"."pan"), ''::"text") AS "pan",
            NULLIF(TRIM(BOTH FROM "customer_master"."contact_type"), ''::"text") AS "contact_type",
            "customer_master"."is_active",
            "customer_master"."last_modified_on",
            COALESCE(
                CASE
                    WHEN ("regexp_replace"(COALESCE("customer_master"."mobile_no", ''::"text"), '[^0-9]'::"text", ''::"text", 'g'::"text") ~ '^[6-9][0-9]{9}$'::"text") THEN "regexp_replace"("customer_master"."mobile_no", '[^0-9]'::"text", ''::"text", 'g'::"text")
                    ELSE NULL::"text"
                END,
                CASE
                    WHEN ("regexp_replace"(COALESCE("customer_master"."whatsapp_no", ''::"text"), '[^0-9]'::"text", ''::"text", 'g'::"text") ~ '^[6-9][0-9]{9}$'::"text") THEN "regexp_replace"("customer_master"."whatsapp_no", '[^0-9]'::"text", ''::"text", 'g'::"text")
                    ELSE NULL::"text"
                END,
                CASE
                    WHEN ("regexp_replace"(COALESCE("customer_master"."telephone", ''::"text"), '[^0-9]'::"text", ''::"text", 'g'::"text") ~ '^[6-9][0-9]{9}$'::"text") THEN "regexp_replace"("customer_master"."telephone", '[^0-9]'::"text", ''::"text", 'g'::"text")
                    ELSE NULL::"text"
                END) AS "own_phone",
                CASE
                    WHEN ("regexp_replace"(COALESCE("customer_master"."whatsapp_no", ''::"text"), '[^0-9]'::"text", ''::"text", 'g'::"text") ~ '^[6-9][0-9]{9}$'::"text") THEN "regexp_replace"("customer_master"."whatsapp_no", '[^0-9]'::"text", ''::"text", 'g'::"text")
                    ELSE NULL::"text"
                END AS "own_whatsapp"
           FROM "public"."customer_master"
          WHERE ("customer_master"."lane" = ANY (ARRAY['W'::"text", 'WO'::"text"]))
        ), "feed" AS (
         SELECT ("v_sales_data_all"."customer_id_db_id")::bigint AS "contact_id",
            "max"(
                CASE
                    WHEN ("regexp_replace"(COALESCE("v_sales_data_all"."mobile_no", ''::"text"), '[^0-9]'::"text", ''::"text", 'g'::"text") ~ '^[6-9][0-9]{9}$'::"text") THEN "regexp_replace"("v_sales_data_all"."mobile_no", '[^0-9]'::"text", ''::"text", 'g'::"text")
                    ELSE NULL::"text"
                END) AS "feed_phone",
            "max"(NULLIF("v_sales_data_all"."address", ''::"text")) AS "address",
            "min"("to_date"("v_sales_data_all"."date", 'DD/MM/YYYY'::"text")) AS "first_order",
            "max"("to_date"("v_sales_data_all"."date", 'DD/MM/YYYY'::"text")) AS "last_order",
            "count"(DISTINCT "v_sales_data_all"."voucher_no") AS "orders_total",
            "count"(DISTINCT "v_sales_data_all"."voucher_no") FILTER (WHERE ("to_date"("v_sales_data_all"."date", 'DD/MM/YYYY'::"text") >= (CURRENT_DATE - 30))) AS "orders_30d",
            "count"(DISTINCT "v_sales_data_all"."voucher_no") FILTER (WHERE ("to_date"("v_sales_data_all"."date", 'DD/MM/YYYY'::"text") >= (CURRENT_DATE - 90))) AS "orders_90d",
            "round"("sum"((NULLIF("regexp_replace"("v_sales_data_all"."net_amount", '[^0-9.\-]'::"text", ''::"text", 'g'::"text"), ''::"text"))::numeric)) AS "value_total",
            "round"("sum"((NULLIF("regexp_replace"("v_sales_data_all"."net_amount", '[^0-9.\-]'::"text", ''::"text", 'g'::"text"), ''::"text"))::numeric) FILTER (WHERE ("to_date"("v_sales_data_all"."date", 'DD/MM/YYYY'::"text") >= (CURRENT_DATE - 90)))) AS "value_90d",
            "count"(DISTINCT "v_sales_data_all"."category_name") AS "categories_bought",
            ("max"(
                CASE
                    WHEN ("upper"(COALESCE("v_sales_data_all"."category_name", ''::"text")) ~~ '%WINDING WIRE%'::"text") THEN 1
                    ELSE 0
                END) = 1) AS "buys_winding_wire"
           FROM "public"."v_sales_data_all"
          WHERE (("v_sales_data_all"."customer_id_db_id" ~ '^[0-9]+$'::"text") AND ("v_sales_data_all"."customer_id_db_id" <> '0'::"text"))
          GROUP BY ("v_sales_data_all"."customer_id_db_id")::bigint
        ), "addr_phone" AS (
         SELECT "f_1"."contact_id",
            ( SELECT "regexp_replace"("m"."m"[1], '[^0-9]'::"text", ''::"text", 'g'::"text") AS "regexp_replace"
                   FROM "regexp_matches"("f_1"."address", '(?<![0-9])([6-9][0-9]{4}[ \-]?[0-9]{5})(?![0-9])'::"text") "m"("m")
                 LIMIT 1) AS "address_phone"
           FROM "feed" "f_1"
          WHERE ("f_1"."address" IS NOT NULL)
        ), "ledger" AS (
         SELECT "b"."contact_id",
            "b"."stem",
            "b"."lane",
            "b"."branch_id",
            "b"."raw_name",
            "b"."city",
            "b"."state",
            "b"."gstin",
            "b"."pan",
            "b"."contact_type",
            "b"."is_active",
            "b"."last_modified_on",
            "b"."own_phone",
            "b"."own_whatsapp",
            "f_1"."feed_phone",
            "f_1"."address",
            "ap"."address_phone",
            "f_1"."first_order",
            "f_1"."last_order",
            "f_1"."orders_total",
            "f_1"."orders_30d",
            "f_1"."orders_90d",
            "f_1"."value_total",
            "f_1"."value_90d",
            "f_1"."categories_bought",
            "f_1"."buys_winding_wire"
           FROM (("base" "b"
             LEFT JOIN "feed" "f_1" ON (("f_1"."contact_id" = "b"."contact_id")))
             LEFT JOIN "addr_phone" "ap" ON (("ap"."contact_id" = "b"."contact_id")))
        ), "grp" AS (
         SELECT COALESCE("ledger"."stem", ('ID#'::"text" || ("min"("ledger"."contact_id"))::"text")) AS "party_stem",
            "count"(*) AS "ledger_count",
            "string_agg"(DISTINCT ("ledger"."contact_id")::"text", ', '::"text" ORDER BY ("ledger"."contact_id")::"text") AS "contact_ids",
            "max"("ledger"."contact_id") FILTER (WHERE ("ledger"."lane" = 'W'::"text")) AS "gst_contact_id",
            "max"("ledger"."contact_id") FILTER (WHERE ("ledger"."lane" = 'WO'::"text")) AS "nongst_contact_id",
            "bool_or"(("ledger"."lane" = 'W'::"text")) AS "has_gst_ledger",
            "bool_or"(("ledger"."lane" = 'WO'::"text")) AS "has_nongst_ledger",
            "bool_or"(("ledger"."branch_id" = 31373)) AS "is_cri_entity",
            ("array_agg"("regexp_replace"("ledger"."raw_name", '^\s*\.\s*'::"text", ''::"text") ORDER BY
                CASE
                    WHEN ("ledger"."lane" = 'W'::"text") THEN 0
                    ELSE 1
                END, ("length"("ledger"."raw_name")) DESC))[1] AS "business_name",
            ("array_agg"("ledger"."city" ORDER BY
                CASE
                    WHEN ("ledger"."city" IS NULL) THEN 1
                    ELSE 0
                END,
                CASE
                    WHEN ("ledger"."lane" = 'W'::"text") THEN 0
                    ELSE 1
                END))[1] AS "city",
            ("array_agg"("ledger"."state" ORDER BY
                CASE
                    WHEN ("ledger"."state" IS NULL) THEN 1
                    ELSE 0
                END))[1] AS "state",
            "count"(DISTINCT "ledger"."city") AS "city_variants",
            "string_agg"(DISTINCT "ledger"."city", ' / '::"text" ORDER BY "ledger"."city") AS "city_list",
            "max"("ledger"."gstin") AS "gstin",
            "max"("ledger"."pan") AS "pan",
            "max"("ledger"."contact_type") AS "contact_type",
            "bool_or"(COALESCE("ledger"."is_active", true)) AS "is_active",
            "max"("ledger"."last_modified_on") AS "last_modified_on",
            ("array_agg"("ledger"."own_phone" ORDER BY "ledger"."own_phone") FILTER (WHERE ("ledger"."own_phone" IS NOT NULL)))[1] AS "p_master",
            ("array_agg"("ledger"."own_whatsapp" ORDER BY "ledger"."own_whatsapp") FILTER (WHERE ("ledger"."own_whatsapp" IS NOT NULL)))[1] AS "p_whatsapp",
            ("array_agg"("ledger"."feed_phone" ORDER BY "ledger"."feed_phone") FILTER (WHERE ("ledger"."feed_phone" IS NOT NULL)))[1] AS "p_feed",
            ("array_agg"("ledger"."address_phone" ORDER BY "ledger"."address_phone") FILTER (WHERE ("ledger"."address_phone" IS NOT NULL)))[1] AS "p_address",
            "count"(*) FILTER (WHERE ("ledger"."own_phone" IS NULL)) AS "ledgers_missing_phone",
            "string_agg"(DISTINCT ("ledger"."contact_id")::"text", ', '::"text") FILTER (WHERE ("ledger"."own_phone" IS NULL)) AS "ledger_ids_missing_phone",
            "min"("ledger"."first_order") AS "first_order",
            "max"("ledger"."last_order") AS "last_order",
            COALESCE("sum"("ledger"."orders_total"), (0)::numeric) AS "orders_total",
            COALESCE("sum"("ledger"."orders_30d"), (0)::numeric) AS "orders_30d",
            COALESCE("sum"("ledger"."orders_90d"), (0)::numeric) AS "orders_90d",
            COALESCE("sum"("ledger"."value_total"), (0)::numeric) AS "value_total",
            COALESCE("sum"("ledger"."value_90d"), (0)::numeric) AS "value_90d",
            "max"("ledger"."categories_bought") AS "categories_bought",
            "bool_or"(COALESCE("ledger"."buys_winding_wire", false)) AS "buys_winding_wire"
           FROM "ledger"
          GROUP BY COALESCE("ledger"."stem", ('ID#'::"text" || ("ledger"."contact_id")::"text")), "ledger"."stem"
        ), "final" AS (
         SELECT "grp"."party_stem",
            "grp"."business_name",
                CASE
                    WHEN "grp"."is_cri_entity" THEN 'B - CRI entity'::"text"
                    ELSE 'A - Core'::"text"
                END AS "entity",
                CASE
                    WHEN ("upper"("grp"."business_name") ~ 'REWIND|WINDING WORK'::"text") THEN 'Rewinding / service'::"text"
                    WHEN ("upper"("grp"."business_name") ~ 'SERVICE'::"text") THEN 'Service centre'::"text"
                    WHEN ("upper"("grp"."business_name") ~ 'BORE ?WELL|BOREWELL|DRILLING|RIG'::"text") THEN 'Borewell / installer'::"text"
                    WHEN ("upper"("grp"."business_name") ~ 'PUMP|MOTOR'::"text") THEN 'Pump trade'::"text"
                    WHEN ("upper"("grp"."business_name") ~ 'ENGINEER|ENGG|WORKS|INDUSTR|MFG|MANUFACT'::"text") THEN 'Engineering / manufacturer'::"text"
                    WHEN ("upper"("grp"."business_name") ~ 'TRADER|AGENC|ENTERPRIS|STORE|MARKETING|DISTRIBUT|CORPORATION|TRADING'::"text") THEN 'Trader / dealer'::"text"
                    WHEN ("upper"("grp"."business_name") ~ 'ELECTRIC|ELECTRO'::"text") THEN 'Electrical'::"text"
                    ELSE 'Unclassified'::"text"
                END AS "segment",
            "grp"."city",
            "grp"."state",
            "grp"."city_variants",
            "grp"."city_list",
            "grp"."ledger_count",
            "grp"."contact_ids",
            "grp"."gst_contact_id",
            "grp"."nongst_contact_id",
            "grp"."has_gst_ledger",
            "grp"."has_nongst_ledger",
                CASE
                    WHEN ("grp"."has_gst_ledger" AND "grp"."has_nongst_ledger") THEN 'BOTH'::"text"
                    WHEN "grp"."has_gst_ledger" THEN 'GST only'::"text"
                    ELSE 'Non-GST only'::"text"
                END AS "lane_coverage",
            "grp"."gstin",
            "grp"."pan",
            "grp"."contact_type",
            "grp"."is_active",
            "grp"."last_modified_on",
            COALESCE("grp"."p_master", "grp"."p_feed", "grp"."p_address") AS "phone",
            "grp"."p_whatsapp" AS "whatsapp",
                CASE
                    WHEN ("grp"."p_master" IS NOT NULL) THEN 'MASTER'::"text"
                    WHEN ("grp"."p_feed" IS NOT NULL) THEN 'SALES_FEED'::"text"
                    WHEN ("grp"."p_address" IS NOT NULL) THEN 'ADDRESS_TEXT'::"text"
                    ELSE 'NONE'::"text"
                END AS "phone_source",
            (("grp"."p_master" IS NOT NULL) OR ("grp"."p_feed" IS NOT NULL)) AS "phone_verified",
            "grp"."ledgers_missing_phone",
            "grp"."ledger_ids_missing_phone",
                CASE
                    WHEN (("grp"."ledger_count" > 1) AND ("grp"."city_variants" > 1)) THEN true
                    ELSE false
                END AS "city_conflict",
                CASE
                    WHEN ("grp"."ledger_count" <= 1) THEN 'HIGH - single ledger'::"text"
                    WHEN (("upper"("grp"."business_name") !~ 'PUMP|MOTOR|ELECTRIC|ENGINEER|ENGG|WORKS|INDUSTR|TRADER|AGENC|ENTERPRIS|STORE|SERVICE|REWIND|CORPORAT|TRADING|MARKETING|DISTRIBUT|WIRE|TECH|BORE|MACHIN|STEEL|COIL|COMPANY|AQUA'::"text") AND ("grp"."city_variants" > 1)) THEN 'REVIEW - personal name and different cities, confirm before merging'::"text"
                    WHEN ("upper"("grp"."business_name") !~ 'PUMP|MOTOR|ELECTRIC|ENGINEER|ENGG|WORKS|INDUSTR|TRADER|AGENC|ENTERPRIS|STORE|SERVICE|REWIND|CORPORAT|TRADING|MARKETING|DISTRIBUT|WIRE|TECH|BORE|MACHIN|STEEL|COIL|COMPANY|AQUA'::"text") THEN 'MEDIUM - personal name, same city'::"text"
                    ELSE 'HIGH'::"text"
                END AS "link_confidence",
            "grp"."first_order",
            "grp"."last_order",
                CASE
                    WHEN ("grp"."last_order" IS NULL) THEN NULL::integer
                    ELSE (CURRENT_DATE - "grp"."last_order")
                END AS "days_since_last_order",
            "grp"."orders_total",
            "grp"."orders_30d",
            "grp"."orders_90d",
            "grp"."value_total",
            "grp"."value_90d",
            "grp"."categories_bought",
            "grp"."buys_winding_wire",
                CASE
                    WHEN ("grp"."last_order" IS NULL) THEN 'NO ORDERS IN FEED'::"text"
                    WHEN ((CURRENT_DATE - "grp"."last_order") <= 30) THEN 'ACTIVE'::"text"
                    WHEN ((CURRENT_DATE - "grp"."last_order") <= 60) THEN 'SLIPPING'::"text"
                    WHEN ((CURRENT_DATE - "grp"."last_order") <= 120) THEN 'AT RISK'::"text"
                    ELSE 'DORMANT'::"text"
                END AS "lifecycle"
           FROM "grp"
        )
 SELECT "party_stem",
    "business_name",
    "entity",
    "segment",
    "city",
    "state",
    "city_variants",
    "city_list",
    "ledger_count",
    "contact_ids",
    "gst_contact_id",
    "nongst_contact_id",
    "has_gst_ledger",
    "has_nongst_ledger",
    "lane_coverage",
    "gstin",
    "pan",
    "contact_type",
    "is_active",
    "last_modified_on",
    "phone",
    "whatsapp",
    "phone_source",
    "phone_verified",
    "ledgers_missing_phone",
    "ledger_ids_missing_phone",
    "city_conflict",
    "link_confidence",
    "first_order",
    "last_order",
    "days_since_last_order",
    "orders_total",
    "orders_30d",
    "orders_90d",
    "value_total",
    "value_90d",
    "categories_bought",
    "buys_winding_wire",
    "lifecycle",
        CASE
            WHEN ("phone_source" = 'NONE'::"text") THEN '1. CALL TO COLLECT NUMBER'::"text"
            WHEN ("phone_source" = 'ADDRESS_TEXT'::"text") THEN '2. VERIFY ADDRESS-DERIVED NUMBER'::"text"
            WHEN ("ledgers_missing_phone" > 0) THEN '3. PUSH NUMBER TO VASY LEDGER'::"text"
            WHEN ("city" IS NULL) THEN '4. ADD CITY'::"text"
            WHEN "city_conflict" THEN '5. RESOLVE CITY VARIANT'::"text"
            ELSE '6. OK'::"text"
        END AS "next_data_action"
   FROM "final" "f";


ALTER VIEW "public"."v_customer_360" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_customer_360" IS 'One row per business. Merges GST (W) and non-GST (WO) Vasy ledgers on the party_key stem, resolves the best available phone (own ledger > twin ledger > sales feed > address text), and attaches activity from sales_data. Read only; no raw table is modified. ADDRESS_TEXT phones are unverified. Sales activity only covers the period present in sales_data - "NO ORDERS IN FEED" does not mean the customer never bought.';



CREATE OR REPLACE VIEW "public"."v_customer_fy2627" AS
 SELECT COALESCE("public"."vt_party_name"("contact_id", "customer_name"), 'WALK-IN (no account)'::"text") AS "customer",
    "contact_id",
    "count"(*) AS "invoices",
    "round"("sum"("total")) AS "billed",
    "round"("sum"("paid_amount")) AS "received",
    "round"("sum"("balance")) AS "still_open",
    "count"(*) FILTER (WHERE ("balance" > 0.01)) AS "open_invoices",
    "min"("sales_date") AS "first_invoice",
    "max"("sales_date") AS "last_invoice"
   FROM "public"."sales_invoice" "i"
  WHERE ("sales_date" >= '2026-04-01'::"date")
  GROUP BY COALESCE("public"."vt_party_name"("contact_id", "customer_name"), 'WALK-IN (no account)'::"text"), "contact_id";


ALTER VIEW "public"."v_customer_fy2627" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_customer_fy2627" IS 'This financial year per customer: billed, received, still open. FY2026-27
   data is reliable; earlier years are not.';



CREATE OR REPLACE VIEW "public"."v_receipts" AS
 WITH "raw" AS (
         SELECT 'CASH'::"text" AS "src",
            "cash_receipt_data"."voucher_no",
            "cash_receipt_data"."db_invoiceno",
            "cash_receipt_data"."date",
            "cash_receipt_data"."particulars",
            "cash_receipt_data"."debit",
            "cash_receipt_data"."branch_id",
            "cash_receipt_data"."loaded_at"
           FROM "public"."cash_receipt_data"
          WHERE (TRIM(BOTH FROM COALESCE("cash_receipt_data"."db_invoiceno", ''::"text")) <> ALL (ARRAY[''::"text", '0'::"text"]))
        UNION ALL
         SELECT 'BANK'::"text",
            "bank_receipt_data"."voucher_no",
            "bank_receipt_data"."db_invoiceno",
            "bank_receipt_data"."date",
            "bank_receipt_data"."particulars",
            "bank_receipt_data"."debit",
            "bank_receipt_data"."branch_id",
            "bank_receipt_data"."loaded_at"
           FROM "public"."bank_receipt_data"
          WHERE (TRIM(BOTH FROM COALESCE("bank_receipt_data"."db_invoiceno", ''::"text")) <> ALL (ARRAY[''::"text", '0'::"text"]))
        ), "split" AS (
         SELECT "r"."src",
            "r"."voucher_no",
            "r"."db_invoiceno",
            "r"."date",
            "r"."particulars",
            "r"."debit",
            "r"."branch_id",
            "r"."loaded_at",
            TRIM(BOTH FROM "x"."piece") AS "one_id",
            "array_length"("string_to_array"("r"."db_invoiceno", '|'::"text"), 1) AS "invoices_named"
           FROM ("raw" "r"
             CROSS JOIN LATERAL "unnest"("string_to_array"("r"."db_invoiceno", '|'::"text")) "x"("piece"))
        )
 SELECT "s"."src" AS "mode",
    "s"."voucher_no" AS "receipt_no",
        CASE
            WHEN ("s"."one_id" ~ '^[0-9]+$'::"text") THEN ("s"."one_id")::bigint
            ELSE NULL::bigint
        END AS "invoice_db_id",
    "i"."order_no",
    "public"."vt_doc_no"("i"."prefix", "i"."sales_no", "i"."order_no") AS "invoice_no",
    "i"."inv_type",
    "i"."sales_date" AS "invoice_date",
    "i"."total" AS "invoice_total",
    "i"."balance" AS "invoice_balance",
    "public"."vt_party_name"("i"."contact_id", "i"."customer_name") AS "customer",
    "i"."contact_id",
    "public"."vt_date"("s"."date") AS "receipt_date",
    NULLIF(TRIM(BOTH FROM "s"."particulars"), ''::"text") AS "particulars",
    COALESCE("public"."vt_num"("s"."debit"), (0)::numeric) AS "amount",
    "s"."invoices_named",
    ("s"."invoices_named" > 1) AS "split_receipt",
    "s"."branch_id",
    "s"."loaded_at"
   FROM ("split" "s"
     LEFT JOIN "public"."sales_invoice" "i" ON ((("s"."one_id" ~ '^[0-9]+$'::"text") AND ("i"."sales_id" = ("s"."one_id")::bigint))))
  WHERE ("s"."one_id" ~ '^[0-9]+$'::"text");


ALTER VIEW "public"."v_receipts" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_receipts" IS 'Cash and bank receipts that carry an invoice db id, one row per invoice
   named. A receipt naming several invoices is split out and flagged
   split_receipt. PARTIAL — 17 Aug 2026 onward only.';



CREATE OR REPLACE VIEW "public"."v_customer_invoices" AS
 WITH "rc" AS (
         SELECT "v_receipts"."invoice_db_id",
            "string_agg"(DISTINCT "v_receipts"."receipt_no", ', '::"text") AS "receipts",
            "sum"("v_receipts"."amount") FILTER (WHERE (NOT "v_receipts"."split_receipt")) AS "receipted_here"
           FROM "public"."v_receipts"
          GROUP BY "v_receipts"."invoice_db_id"
        )
 SELECT "public"."vt_party_name"("i"."contact_id", "i"."customer_name") AS "customer",
    "i"."contact_id",
    "i"."sales_id",
    "public"."vt_doc_no"("i"."prefix", "i"."sales_no", "i"."order_no") AS "invoice_no",
    "i"."order_no",
    "i"."sales_date",
    (CURRENT_DATE - "i"."sales_date") AS "age_days",
    "i"."inv_type",
    "i"."payment_type",
    "i"."total",
    "i"."paid_amount",
    "i"."balance",
        CASE
            WHEN ("i"."balance" > 0.01) THEN 'OPEN'::"text"
            ELSE 'CLOSED'::"text"
        END AS "status",
        CASE
            WHEN ("i"."sales_date" < '2026-04-01'::"date") THEN 'PRIOR'::"text"
            ELSE 'FY2627'::"text"
        END AS "period",
    "rc"."receipts",
    COALESCE("rc"."receipted_here", (0)::numeric) AS "receipted_here"
   FROM ("public"."sales_invoice" "i"
     LEFT JOIN "rc" ON (("rc"."invoice_db_id" = "i"."sales_id")));


ALTER VIEW "public"."v_customer_invoices" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_customer_invoices" IS 'Every invoice per customer, open or closed, with the receipts that name
   it. The full picture before deciding a write-off.';



CREATE OR REPLACE VIEW "public"."v_customer_lane_anomalies" AS
 WITH "billing" AS (
         SELECT ("v_sales_data_all"."customer_id_db_id")::bigint AS "cid",
            "count"(*) FILTER (WHERE ("v_sales_data_all"."sale_type" = 'Invoice'::"text")) AS "inv_rows",
            "count"(*) FILTER (WHERE ("v_sales_data_all"."sale_type" = 'POS'::"text")) AS "pos_rows",
            "count"(*) AS "total_rows",
            "round"("sum"((NULLIF("regexp_replace"("v_sales_data_all"."net_amount", '[^0-9.\-]'::"text", ''::"text", 'g'::"text"), ''::"text"))::numeric)) AS "sales_value"
           FROM "public"."v_sales_data_all"
          WHERE (("v_sales_data_all"."customer_id_db_id" ~ '^[0-9]+$'::"text") AND ("v_sales_data_all"."customer_id_db_id" <> '0'::"text"))
          GROUP BY ("v_sales_data_all"."customer_id_db_id")::bigint
        )
 SELECT "m"."contact_id",
    "m"."display_name",
    "m"."lane",
    NULLIF("m"."gstin", ''::"text") AS "gstin",
    "b"."inv_rows",
    "b"."pos_rows",
    "b"."total_rows",
    "b"."sales_value",
        CASE
            WHEN (("m"."lane" = 'WO'::"text") AND ("b"."inv_rows" > 0)) THEN 'Non-GST marked (dot) but billed on GST invoice'::"text"
            WHEN (("m"."lane" = 'W'::"text") AND (COALESCE("m"."gstin", ''::"text") <> ''::"text") AND ("b"."pos_rows" > 0)) THEN 'GSTIN holder billed through POS'::"text"
            WHEN (("m"."lane" = 'W'::"text") AND (COALESCE("m"."gstin", ''::"text") = ''::"text") AND ("b"."inv_rows" = 0)) THEN 'No dot marker but billed only through POS - missing dot?'::"text"
            ELSE NULL::"text"
        END AS "issue"
   FROM ("billing" "b"
     JOIN "public"."customer_master" "m" ON (("m"."contact_id" = "b"."cid")))
  WHERE ((("m"."lane" = 'WO'::"text") AND ("b"."inv_rows" > 0)) OR (("m"."lane" = 'W'::"text") AND (COALESCE("m"."gstin", ''::"text") <> ''::"text") AND ("b"."pos_rows" > 0)) OR (("m"."lane" = 'W'::"text") AND (COALESCE("m"."gstin", ''::"text") = ''::"text") AND ("b"."inv_rows" = 0)))
  ORDER BY "b"."sales_value" DESC NULLS LAST;


ALTER VIEW "public"."v_customer_lane_anomalies" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_customer_lane_anomalies" IS 'VT-DW-041. Customers whose billing channel contradicts their lane marker. For human review - no rule is applied automatically.';



CREATE OR REPLACE VIEW "public"."v_customer_master_sheet" AS
 SELECT "row_number"() OVER (ORDER BY
        CASE
            WHEN ("phone" IS NULL) THEN 1
            WHEN ("phone_source" = 'ADDRESS_TEXT'::"text") THEN 2
            WHEN ("ledgers_missing_phone" > 0) THEN 3
            WHEN ("city" IS NULL) THEN 4
            WHEN "city_conflict" THEN 5
            ELSE 6
        END,
        CASE "lifecycle"
            WHEN 'ACTIVE'::"text" THEN 1
            WHEN 'SLIPPING'::"text" THEN 2
            WHEN 'AT RISK'::"text" THEN 3
            WHEN 'DORMANT'::"text" THEN 4
            ELSE 5
        END, "value_90d" DESC NULLS LAST, "business_name") AS "work_order",
    "left"("next_data_action", 1) AS "action_rank",
    "next_data_action" AS "action_needed",
    "business_name",
    "entity",
    "segment",
    COALESCE("city", ''::"text") AS "city",
    COALESCE("state", ''::"text") AS "state",
    "lifecycle",
    COALESCE("phone", ''::"text") AS "phone",
    "phone_source",
        CASE
            WHEN "phone_verified" THEN 'Yes'::"text"
            ELSE 'No'::"text"
        END AS "phone_verified",
    COALESCE("whatsapp", ''::"text") AS "whatsapp",
    ''::"text" AS "phone_collected_by_staff",
    ''::"text" AS "collected_on",
    ''::"text" AS "notes",
    "lane_coverage",
    "ledger_count",
    "contact_ids",
    COALESCE(("gst_contact_id")::"text", ''::"text") AS "gst_contact_id",
    COALESCE(("nongst_contact_id")::"text", ''::"text") AS "nongst_contact_id",
    COALESCE("ledger_ids_missing_phone", ''::"text") AS "ledger_ids_missing_phone",
        CASE
            WHEN "city_conflict" THEN 'Yes'::"text"
            ELSE 'No'::"text"
        END AS "city_conflict",
    COALESCE("city_list", ''::"text") AS "city_variants_seen",
    "link_confidence",
    COALESCE("gstin", ''::"text") AS "gstin",
    "to_char"(("last_order")::timestamp with time zone, 'YYYY-MM-DD'::"text") AS "last_order_date",
    COALESCE(("days_since_last_order")::"text", ''::"text") AS "days_since_last_order",
    "orders_90d",
    "orders_total",
    "value_90d",
    "value_total",
    "categories_bought",
        CASE
            WHEN "buys_winding_wire" THEN 'Yes'::"text"
            ELSE 'No'::"text"
        END AS "buys_winding_wire",
        CASE
            WHEN (("segment" = ANY (ARRAY['Rewinding / service'::"text", 'Service centre'::"text", 'Electrical'::"text"])) AND (NOT "buys_winding_wire")) THEN 'Yes'::"text"
            ELSE 'No'::"text"
        END AS "winding_wire_target",
    "party_stem"
   FROM "public"."v_customer_360";


ALTER VIEW "public"."v_customer_master_sheet" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_customer_master_sheet" IS 'Flat Sheets-safe export of v_customer_360. One row per business, sorted so row 1 is the highest-priority data-collection job. Columns phone_collected_by_staff / collected_on / notes are intentionally blank for staff entry in Sheets - they are not written back to Supabase.';



CREATE OR REPLACE VIEW "public"."v_receipt_allocation" AS
 WITH "g" AS (
         SELECT "v_receipts"."receipt_no",
            "v_receipts"."mode",
            "v_receipts"."receipt_date",
            "v_receipts"."amount",
            "v_receipts"."invoices_named",
            "count"(*) AS "ids_found",
            "sum"("v_receipts"."invoice_total") AS "sum_total",
            "sum"("v_receipts"."invoice_balance") AS "sum_balance",
            "sum"(("v_receipts"."invoice_total" - "v_receipts"."invoice_balance")) AS "sum_settled"
           FROM "public"."v_receipts"
          WHERE "v_receipts"."split_receipt"
          GROUP BY "v_receipts"."receipt_no", "v_receipts"."mode", "v_receipts"."receipt_date", "v_receipts"."amount", "v_receipts"."invoices_named"
        )
 SELECT "r"."receipt_no",
    "r"."mode",
    "r"."receipt_date",
    "r"."invoice_db_id",
    "r"."invoice_no",
    "r"."order_no",
    "r"."customer",
    "r"."invoice_total",
    "r"."invoice_balance",
    ("r"."invoice_total" - "r"."invoice_balance") AS "invoice_settled",
    "g"."amount" AS "receipt_amount",
    "g"."invoices_named",
    "g"."ids_found",
        CASE
            WHEN ("abs"(("g"."amount" - "g"."sum_settled")) <= (1)::numeric) THEN 'BY AMOUNT SETTLED'::"text"
            WHEN ("abs"(("g"."amount" - "g"."sum_total")) <= (1)::numeric) THEN 'BY INVOICE TOTAL'::"text"
            WHEN ("abs"(("g"."amount" - "g"."sum_balance")) <= (1)::numeric) THEN 'BY OPEN BALANCE'::"text"
            WHEN ("g"."ids_found" < "g"."invoices_named") THEN 'INVOICE MISSING FROM REGISTER'::"text"
            ELSE 'UNRESOLVED — amounts do not add up'::"text"
        END AS "basis",
        CASE
            WHEN ("abs"(("g"."amount" - "g"."sum_settled")) <= (1)::numeric) THEN ("r"."invoice_total" - "r"."invoice_balance")
            WHEN ("abs"(("g"."amount" - "g"."sum_total")) <= (1)::numeric) THEN "r"."invoice_total"
            WHEN ("abs"(("g"."amount" - "g"."sum_balance")) <= (1)::numeric) THEN "r"."invoice_balance"
            ELSE NULL::numeric
        END AS "allocated",
    "round"(("g"."amount" - "g"."sum_settled"), 2) AS "gap_vs_settled"
   FROM ("public"."v_receipts" "r"
     JOIN "g" ON ((("g"."receipt_no" = "r"."receipt_no") AND ("g"."mode" = "r"."mode"))))
  WHERE "r"."split_receipt";


ALTER VIEW "public"."v_receipt_allocation" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_receipt_allocation" IS 'For receipts naming several invoices: whether the amounts can be
   attributed, and on what basis. 9 of 38 resolve exactly; the rest are left
   alone rather than guessed.';



CREATE OR REPLACE VIEW "public"."v_invoice_settlement" AS
 SELECT "i"."sales_id",
    "i"."order_no",
    "public"."vt_doc_no"("i"."prefix", "i"."sales_no", "i"."order_no") AS "invoice_no",
    "i"."sales_date",
    "i"."contact_id",
    "public"."vt_party_name"("i"."contact_id", "i"."customer_name") AS "customer",
    "i"."customer_name" AS "customer_name_raw",
    "i"."inv_type",
    "i"."payment_type",
    "i"."status",
    "i"."total",
    "i"."paid_amount",
    "i"."balance" AS "open_amount",
    ("i"."balance" > 0.01) AS "is_open",
    (("i"."paid_amount" > 0.01) AND ("i"."balance" > 0.01)) AS "part_paid",
    (CURRENT_DATE - "i"."sales_date") AS "age_days",
    "count"("r"."receipt_no") AS "receipts",
    "round"((COALESCE("sum"("r"."amount") FILTER (WHERE (NOT "r"."split_receipt")), (0)::numeric) + COALESCE("sum"("a"."allocated"), (0)::numeric)), 2) AS "receipted_traced",
    "count"("a"."receipt_no") FILTER (WHERE ("a"."allocated" IS NULL)) AS "unresolved_splits",
    "max"("r"."receipt_date") AS "last_receipt",
    "string_agg"(DISTINCT "r"."receipt_no", ', '::"text") AS "receipt_nos"
   FROM (("public"."sales_invoice" "i"
     LEFT JOIN "public"."v_receipts" "r" ON (("r"."invoice_db_id" = "i"."sales_id")))
     LEFT JOIN "public"."v_receipt_allocation" "a" ON (("a"."invoice_db_id" = "i"."sales_id")))
  GROUP BY "i"."sales_id", "i"."order_no", "i"."prefix", "i"."sales_no", "i"."sales_date", "i"."contact_id", "i"."customer_name", "i"."inv_type", "i"."payment_type", "i"."status", "i"."total", "i"."paid_amount", "i"."balance";


ALTER VIEW "public"."v_invoice_settlement" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_invoice_settlement" IS 'One row per invoice: what Vasy says is open, plus any receipt that names
   it. open_amount is Vasy''s balance and is the number to trust —
   receipted_traced only covers 17 Aug 2026 onward.';



CREATE OR REPLACE VIEW "public"."v_customer_open" AS
 SELECT "customer",
    "contact_id",
    "count"(*) AS "open_invoices",
    "round"("sum"("open_amount")) AS "open_amount",
    "round"("sum"("open_amount") FILTER (WHERE ("age_days" > 90))) AS "over_90",
    "count"(*) FILTER (WHERE "part_paid") AS "part_paid",
    "min"("sales_date") AS "oldest_invoice",
    "max"("age_days") AS "oldest_days",
    "string_agg"(DISTINCT "inv_type", '/'::"text") AS "doc_types"
   FROM "public"."v_invoice_settlement"
  WHERE "is_open"
  GROUP BY "customer", "contact_id";


ALTER VIEW "public"."v_customer_open" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_customer_open" IS 'What each customer owes, with ageing.';



CREATE OR REPLACE VIEW "public"."v_customer_receipts" AS
 WITH "per_customer" AS (
         SELECT "r"."receipt_no",
            "r"."mode",
            "r"."receipt_date",
            "r"."amount",
            "r"."split_receipt",
            "r"."invoices_named",
            "public"."vt_party_name"("i"."contact_id", "i"."customer_name") AS "customer",
            "i"."contact_id",
            "string_agg"(DISTINCT "public"."vt_doc_no"("i"."prefix", "i"."sales_no", "i"."order_no"), ', '::"text") AS "against_invoices"
           FROM ("public"."v_receipts" "r"
             LEFT JOIN "public"."sales_invoice" "i" ON (("i"."sales_id" = "r"."invoice_db_id")))
          GROUP BY "r"."receipt_no", "r"."mode", "r"."receipt_date", "r"."amount", "r"."split_receipt", "r"."invoices_named", "i"."contact_id", "i"."customer_name"
        )
 SELECT "customer",
    "contact_id",
    "receipt_no",
    "mode",
    "receipt_date",
    "amount",
    "split_receipt",
    "invoices_named",
    "against_invoices",
        CASE
            WHEN (("against_invoices" IS NULL) OR ("against_invoices" = ''::"text")) THEN 'UNAPPLIED — on account'::"text"
            WHEN "split_receipt" THEN (('SPLIT across '::"text" || "invoices_named") || ' invoices'::"text")
            ELSE ('applied to '::"text" || "against_invoices")
        END AS "applied_to"
   FROM "per_customer";


ALTER VIEW "public"."v_customer_receipts" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_customer_receipts" IS 'Every receipt per customer and what it was applied to. UNAPPLIED = kept
   on account with no bill — these can be assigned to open invoices.';



CREATE OR REPLACE VIEW "public"."v_customer_recovery_queue" AS
 WITH "agg" AS (
         SELECT ("v_sales_data_all"."customer_id_db_id")::bigint AS "contact_id",
            "max"("v_sales_data_all"."customer_name") AS "feed_name",
            "max"("v_sales_data_all"."mobile_no") AS "feed_mobile",
            "max"("v_sales_data_all"."gstin") AS "feed_gstin",
            "max"("v_sales_data_all"."address") AS "address",
            "max"("v_sales_data_all"."state_name") AS "state_name",
            "max"("v_sales_data_all"."sale_type") AS "billed_via",
            "count"(*) AS "sales_rows",
            "round"("sum"((NULLIF("regexp_replace"("v_sales_data_all"."net_amount", '[^0-9.\-]'::"text", ''::"text", 'g'::"text"), ''::"text"))::numeric)) AS "sales_value"
           FROM "public"."v_sales_data_all"
          WHERE (("v_sales_data_all"."customer_id_db_id" ~ '^[0-9]+$'::"text") AND ("v_sales_data_all"."customer_id_db_id" <> '0'::"text"))
          GROUP BY ("v_sales_data_all"."customer_id_db_id")::bigint
        ), "scored" AS (
         SELECT "a"."contact_id",
            "a"."feed_name",
            "a"."feed_mobile",
            "a"."feed_gstin",
            "a"."address",
            "a"."state_name",
            "a"."billed_via",
            "a"."sales_rows",
            "a"."sales_value",
                CASE
                    WHEN ("a"."feed_mobile" ~ '^[6-9][0-9]{9}$'::"text") THEN "a"."feed_mobile"
                    ELSE NULL::"text"
                END AS "clean_feed_mobile",
            ( SELECT "regexp_replace"("x"."x"[1], '[^0-9]'::"text", ''::"text", 'g'::"text") AS "regexp_replace"
                   FROM "regexp_matches"("a"."address", '(?<![0-9])([6-9][0-9]{4}[ \-]?[0-9]{5})(?![0-9])'::"text") "x"("x")
                 LIMIT 1) AS "address_phone",
            ( SELECT "btrim"("t"."seg") AS "btrim"
                   FROM "unnest"("string_to_array"("a"."address", '|'::"text")) WITH ORDINALITY "t"("seg", "ord")
                  WHERE (("btrim"("t"."seg") <> ''::"text") AND ("btrim"("t"."seg") !~* '^ph\s*\.?\s*(no|nu)'::"text") AND ("btrim"("t"."seg") !~ '^[0-9\s\-/,\.]+$'::"text") AND ("btrim"("t"."seg") ~ '[A-Za-z]{3}'::"text"))
                  ORDER BY "t"."ord" DESC
                 LIMIT 1) AS "locality"
           FROM "agg" "a"
        )
 SELECT "contact_id",
    NULLIF("btrim"("feed_name"), ''::"text") AS "feed_name",
    "regexp_replace"(COALESCE("locality", ''::"text"), '\s*-\s*[0-9]{6}\s*$'::"text", ''::"text") AS "locality",
    "state_name",
    NULLIF("feed_gstin", ''::"text") AS "feed_gstin",
    "billed_via",
    "clean_feed_mobile" AS "lookup_phone",
        CASE
            WHEN ("clean_feed_mobile" IS NOT NULL) THEN 'FEED'::"text"
            ELSE 'NONE'::"text"
        END AS "phone_source",
    "address_phone" AS "address_phone_unverified",
    "sales_rows",
    "sales_value",
    "address"
   FROM "scored" "s"
  WHERE (NOT (EXISTS ( SELECT 1
           FROM "public"."customer_master" "m"
          WHERE ("m"."contact_id" = "s"."contact_id"))))
  ORDER BY "sales_value" DESC NULLS LAST;


ALTER VIEW "public"."v_customer_recovery_queue" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_customer_recovery_queue" IS 'VT-DW-033/043. Missing customers with identifying detail for eyeball recognition. address_phone_unverified is scraped from free-text address - VT-DW-042 proved these usually belong to a DIFFERENT customer, so it is displayed but never used for lookup.';



CREATE OR REPLACE VIEW "public"."v_receivable_exceptions" AS
 SELECT "sales_id",
    "invoice_no",
    "order_no",
    "sales_date",
    "age_days",
    "customer",
    "contact_id",
    "inv_type",
    "payment_type",
    "status",
    "total",
    "paid_amount",
    "open_amount",
    "part_paid",
    "receipts",
    "receipt_nos",
        CASE
            WHEN (("open_amount" > 0.01) AND ("contact_id" IS NULL)) THEN 'NO CUSTOMER ON THE INVOICE — nobody to chase'::"text"
            WHEN (("open_amount" > 0.01) AND ("receipted_traced" >= ("open_amount" - 0.01))) THEN 'ALREADY PAID — a receipt covers it'::"text"
            WHEN (("open_amount" > 0.01) AND ("paid_amount" <= 0.01) AND ("age_days" > 365)) THEN 'NOTHING PAID, OVER A YEAR'::"text"
            WHEN (("open_amount" > 0.01) AND ("paid_amount" <= 0.01) AND ("age_days" > 90)) THEN 'NOTHING PAID, OVER 90 DAYS'::"text"
            WHEN ("part_paid" AND ("age_days" > 90)) THEN 'PART PAID, STALLED OVER 90 DAYS'::"text"
            WHEN "part_paid" THEN 'PART PAID'::"text"
            WHEN (("open_amount" > 0.01) AND ("age_days" > 90)) THEN 'OVER 90 DAYS'::"text"
            WHEN ("open_amount" < '-0.01'::numeric) THEN 'NEGATIVE BALANCE — overpaid or a credit note'::"text"
            WHEN ("unresolved_splits" > 0) THEN 'RECEIPT COVERS SEVERAL INVOICES — split it by hand'::"text"
            ELSE NULL::"text"
        END AS "issue"
   FROM "public"."v_invoice_settlement" "s"
  WHERE (("open_amount" > 0.01) OR ("open_amount" < '-0.01'::numeric) OR ("unresolved_splits" > 0));


ALTER VIEW "public"."v_receivable_exceptions" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_receivable_exceptions" IS 'The working list. issue says why each invoice is here. 3,016 have had
   nothing paid at all, Rs 1.92 crore.';



CREATE OR REPLACE VIEW "public"."v_exception_summary" AS
 SELECT "issue",
    "count"(*) AS "invoices",
    "round"("sum"("open_amount")) AS "value",
    "round"("sum"("paid_amount")) AS "already_paid",
    "min"("sales_date") AS "oldest",
    "max"("age_days") AS "oldest_days"
   FROM "public"."v_receivable_exceptions"
  WHERE ("issue" IS NOT NULL)
  GROUP BY "issue"
  ORDER BY ("sum"("open_amount")) DESC;


ALTER VIEW "public"."v_exception_summary" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_exception_summary" IS 'v_receivable_exceptions, counted by issue.';



CREATE OR REPLACE VIEW "public"."v_inventory" AS
 WITH "sales12" AS (
         SELECT "v_sales_all"."item_code_base" AS "code",
            "sum"("v_sales_all"."qty_num") AS "units_12m",
            "sum"("v_sales_all"."net_amount_num") AS "rev_12m",
            "count"(DISTINCT "v_sales_all"."sale_month") AS "active_months",
            "max"("v_sales_all"."sales_date") AS "last_sale",
            "sum"("v_sales_all"."qty_num") FILTER (WHERE ("v_sales_all"."sales_date" >= (CURRENT_DATE - 90))) AS "units_90d"
           FROM "public"."v_sales_all"
          WHERE ("v_sales_all"."sales_date" >= (CURRENT_DATE - 365))
          GROUP BY "v_sales_all"."item_code_base"
        ), "ranked" AS (
         SELECT "sales12"."code",
            "sales12"."rev_12m",
            "sum"("sales12"."rev_12m") OVER () AS "tot_rev",
            "sum"("sales12"."rev_12m") OVER (ORDER BY "sales12"."rev_12m" DESC) AS "running_rev"
           FROM "sales12"
          WHERE ("sales12"."rev_12m" > (0)::numeric)
        ), "abc" AS (
         SELECT "ranked"."code",
                CASE
                    WHEN ("ranked"."running_rev" <= ("ranked"."tot_rev" * 0.80)) THEN 'A'::"text"
                    WHEN ("ranked"."running_rev" <= ("ranked"."tot_rev" * 0.95)) THEN 'B'::"text"
                    ELSE 'C'::"text"
                END AS "abc"
           FROM "ranked"
        )
 SELECT "st"."item_code",
    "st"."product_name",
    "st"."category",
    "st"."brand",
    "st"."qty_w",
    "st"."qty_wo",
    "st"."qty_total",
    COALESCE("s"."units_12m", (0)::numeric) AS "units_12m",
    COALESCE("s"."rev_12m", (0)::numeric) AS "revenue_12m",
    COALESCE("s"."units_90d", (0)::numeric) AS "units_90d",
    "s"."last_sale",
        CASE
            WHEN ("s"."last_sale" IS NOT NULL) THEN (CURRENT_DATE - "s"."last_sale")
            ELSE NULL::integer
        END AS "days_since_sale",
    "round"((COALESCE("s"."units_90d", (0)::numeric) / 90.0), 3) AS "daily_rate",
        CASE
            WHEN ((COALESCE("s"."units_90d", (0)::numeric) > (0)::numeric) AND ("st"."qty_total" > (0)::numeric)) THEN "round"(("st"."qty_total" / ("s"."units_90d" / 90.0)))
            ELSE NULL::numeric
        END AS "days_cover",
    COALESCE("a"."abc", 'C'::"text") AS "abc",
        CASE
            WHEN ("s"."active_months" >= 9) THEN 'X'::"text"
            WHEN ("s"."active_months" >= 4) THEN 'Y'::"text"
            ELSE 'Z'::"text"
        END AS "xyz",
        CASE
            WHEN ("st"."qty_total" < (0)::numeric) THEN 'NEGATIVE'::"text"
            WHEN (("st"."qty_total" = (0)::numeric) AND (COALESCE("s"."units_90d", (0)::numeric) > (0)::numeric)) THEN 'STOCKOUT'::"text"
            WHEN (("st"."qty_total" > (0)::numeric) AND (("s"."last_sale" IS NULL) OR ("s"."last_sale" < (CURRENT_DATE - 180)))) THEN 'DEAD'::"text"
            WHEN ((COALESCE("s"."units_90d", (0)::numeric) > (0)::numeric) AND ("st"."qty_total" > (0)::numeric) AND (("st"."qty_total" / ("s"."units_90d" / 90.0)) < (15)::numeric)) THEN 'LOW'::"text"
            WHEN ((COALESCE("s"."units_90d", (0)::numeric) > (0)::numeric) AND ("st"."qty_total" > (0)::numeric) AND (("st"."qty_total" / ("s"."units_90d" / 90.0)) > (180)::numeric)) THEN 'EXCESS'::"text"
            ELSE 'OK'::"text"
        END AS "flag"
   FROM (("public"."stock_live" "st"
     LEFT JOIN "sales12" "s" ON (("s"."code" = "st"."item_code")))
     LEFT JOIN "abc" "a" ON (("a"."code" = "st"."item_code")));


ALTER VIEW "public"."v_inventory" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_inventory" IS 'One row per product: live stock + 12-month velocity + ABC/XYZ + cover +
   a flag (NEGATIVE/STOCKOUT/DEAD/LOW/EXCESS/OK). Powers the inventory
   dashboard. Needs stock_live populated (run pushStockToSupabase).';



CREATE OR REPLACE VIEW "public"."v_inventory_summary" AS
 SELECT "count"(*) AS "products",
    "count"(*) FILTER (WHERE ("qty_total" > (0)::numeric)) AS "in_stock",
    "count"(*) FILTER (WHERE ("flag" = 'NEGATIVE'::"text")) AS "negative",
    "count"(*) FILTER (WHERE ("flag" = 'STOCKOUT'::"text")) AS "stockout",
    "count"(*) FILTER (WHERE ("flag" = 'DEAD'::"text")) AS "dead",
    "count"(*) FILTER (WHERE ("flag" = 'LOW'::"text")) AS "low",
    "count"(*) FILTER (WHERE ("flag" = 'EXCESS'::"text")) AS "excess",
    "round"("sum"("revenue_12m")) AS "revenue_12m",
    "count"(*) FILTER (WHERE ("abc" = 'A'::"text")) AS "a_items",
    "round"("sum"("revenue_12m") FILTER (WHERE ("abc" = 'A'::"text"))) AS "a_revenue"
   FROM "public"."v_inventory";


ALTER VIEW "public"."v_inventory_summary" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_inward" AS
 SELECT "id",
    "created_at",
    "status",
    "branch_id_db_ref_id",
    "inward_no",
    "vendordb_id",
    "supplier_name",
    "inward_date",
    "item_code",
    "product_id_db",
    "product_varient_id_db",
    "po_date",
    "po_no",
    "po_amount",
    "po_qty",
    "po_uom",
    "inward_amount",
    "tax_amount",
    "inward_qty",
    "uom",
    "received_by_employee_db_id",
    "created_by_employee_db_id",
    "additional_charge_taxable_amount",
    "additional_charge_tax_amount",
    "additional_charge_total_amount",
    "location",
    "notes",
    "source",
    "loaded_at",
    "public"."vt_date"("inward_date") AS "inward_dt",
    ("date_trunc"('month'::"text", ("public"."vt_date"("inward_date"))::timestamp with time zone))::"date" AS "inward_month",
    "public"."vt_date"("po_date") AS "po_dt",
    "public"."vt_num"("inward_qty") AS "inward_qty_num",
    "public"."vt_num"("inward_amount") AS "inward_amount_num",
    "public"."vt_num"("tax_amount") AS "tax_amount_num",
    "public"."vt_num"("po_qty") AS "po_qty_num",
    "public"."vt_num"("po_amount") AS "po_amount_num",
        CASE
            WHEN ("item_code" ~~ '%/'::"text") THEN 'NON_GST'::"text"
            ELSE 'GST'::"text"
        END AS "sku_lane",
    "rtrim"("item_code", '/'::"text") AS "item_code_base",
        CASE
            WHEN ("left"(COALESCE("supplier_name", ''::"text"), 1) = '.'::"text") THEN 'NON_GST'::"text"
            ELSE 'GST'::"text"
        END AS "supplier_lane"
   FROM "public"."material_inward_data" "i";


ALTER VIEW "public"."v_inward" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_inward" IS 'VT-DW-014. material_inward_data typed.';



CREATE OR REPLACE VIEW "public"."v_item_latest_cost" AS
 SELECT DISTINCT ON ("item_code_base") "item_code_base",
    "item_code",
    "product_name",
    "bill_dt" AS "last_purchase_date",
    "rate_num" AS "last_rate",
    "party_name" AS "last_supplier",
    "supplier_lane"
   FROM "public"."v_purchase"
  WHERE (("rate_num" IS NOT NULL) AND ("rate_num" > (0)::numeric))
  ORDER BY "item_code_base", "bill_dt" DESC, "id" DESC;


ALTER VIEW "public"."v_item_latest_cost" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_item_latest_cost" IS 'VT-DW-015. Most recent purchase rate per base product. Use this for margin, NOT Vasy landing cost.';



CREATE OR REPLACE VIEW "public"."v_lane_violations" AS
 SELECT "v"."date",
    "v"."voucher_no",
    "v"."sale_type",
    COALESCE("m"."display_name", NULLIF("btrim"("v"."customer_name"), '.'::"text"), 'Walk-in / Cash'::"text") AS "customer",
    "v"."item_code",
    "v"."product_name",
    "v"."qty",
    "round"((NULLIF("regexp_replace"("v"."net_amount", '[^0-9.\-]'::"text", ''::"text", 'g'::"text"), ''::"text"))::numeric) AS "net_amount",
        CASE
            WHEN ("v"."sale_type" = 'Invoice'::"text") THEN 'Non-GST SKU billed on a GST invoice'::"text"
            ELSE 'GST SKU billed through POS'::"text"
        END AS "issue",
    "v"."sales_man",
    "v"."source"
   FROM ("public"."v_sales_data_all" "v"
     LEFT JOIN "public"."customer_master" "m" ON ((("v"."customer_id_db_id" ~ '^[0-9]+$'::"text") AND ("m"."contact_id" = ("v"."customer_id_db_id")::bigint))))
  WHERE ((("v"."sale_type" = 'Invoice'::"text") AND ("v"."item_code" ~~ '%/'::"text")) OR (("v"."sale_type" = 'POS'::"text") AND ("v"."item_code" !~~ '%/'::"text")));


ALTER VIEW "public"."v_lane_violations" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_lane_violations" IS 'VT-DW-054. LINE-level check: SKU lane vs voucher lane. Ongoing operational check - rerun any time. Distinct from v_customer_lane_anomalies, which is a one-time MASTER-DATA check on customer ledger markers.';



CREATE OR REPLACE VIEW "public"."v_receivables_summary" AS
 SELECT "count"(*) AS "invoices",
    "round"("sum"("total")) AS "billed",
    "round"("sum"("paid_amount")) AS "paid",
    "round"("sum"("open_amount")) AS "open_amount",
    "count"(*) FILTER (WHERE "is_open") AS "open_invoices",
    "count"(*) FILTER (WHERE "part_paid") AS "part_paid_invoices",
    "round"("sum"("open_amount") FILTER (WHERE ("age_days" <= 30))) AS "open_0_30",
    "round"("sum"("open_amount") FILTER (WHERE (("age_days" >= 31) AND ("age_days" <= 60)))) AS "open_31_60",
    "round"("sum"("open_amount") FILTER (WHERE (("age_days" >= 61) AND ("age_days" <= 90)))) AS "open_61_90",
    "round"("sum"("open_amount") FILTER (WHERE ("age_days" > 90))) AS "open_90_plus",
    "count"(*) FILTER (WHERE ("is_open" AND ("contact_id" IS NULL))) AS "open_no_customer",
    "count"(*) FILTER (WHERE ("unresolved_splits" > 0)) AS "unresolved_splits",
    ( SELECT "min"("v_receipts"."receipt_date") AS "min"
           FROM "public"."v_receipts") AS "receipts_from"
   FROM "public"."v_invoice_settlement";


ALTER VIEW "public"."v_receivables_summary" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_receivables_summary" IS 'The one-line receivables position, with ageing.';



CREATE OR REPLACE VIEW "public"."v_reconciliation" AS
 WITH "led" AS (
         SELECT "customer_ledger_snapshot"."party_name",
            "customer_ledger_snapshot"."contact_no",
            "customer_ledger_snapshot"."opening_balance",
            "customer_ledger_snapshot"."debit",
            "customer_ledger_snapshot"."credit",
            "customer_ledger_snapshot"."closing"
           FROM "public"."customer_ledger_snapshot"
          WHERE ("customer_ledger_snapshot"."as_at" = ( SELECT "max"("customer_ledger_snapshot_1"."as_at") AS "max"
                   FROM "public"."customer_ledger_snapshot" "customer_ledger_snapshot_1"))
        ), "inv" AS (
         SELECT "customer_invoice_outstanding"."customer_name",
            "customer_invoice_outstanding"."outstanding",
            "customer_invoice_outstanding"."unpaid_bills",
            "customer_invoice_outstanding"."d120plus"
           FROM "public"."customer_invoice_outstanding"
          WHERE ("customer_invoice_outstanding"."as_at" = ( SELECT "max"("customer_invoice_outstanding_1"."as_at") AS "max"
                   FROM "public"."customer_invoice_outstanding" "customer_invoice_outstanding_1"))
        ), "ours" AS (
         SELECT COALESCE("public"."vt_party_name"("i"."contact_id", "i"."customer_name"), 'WALK-IN (no account)'::"text") AS "customer",
            "round"("sum"("i"."balance") FILTER (WHERE ("i"."sales_date" < '2026-04-01'::"date"))) AS "prior_open",
            "round"("sum"("i"."balance") FILTER (WHERE ("i"."sales_date" >= '2026-04-01'::"date"))) AS "fy2627_open",
            "count"(*) FILTER (WHERE (("i"."balance" > 0.01) AND ("i"."sales_date" < '2026-04-01'::"date"))) AS "prior_bills",
            "count"(*) FILTER (WHERE (("i"."balance" > 0.01) AND ("i"."sales_date" >= '2026-04-01'::"date"))) AS "fy2627_bills"
           FROM "public"."sales_invoice" "i"
          GROUP BY COALESCE("public"."vt_party_name"("i"."contact_id", "i"."customer_name"), 'WALK-IN (no account)'::"text")
        )
 SELECT COALESCE("l"."party_name", "v"."customer_name", "o"."customer", "b"."customer_name") AS "customer",
    "l"."contact_no",
    "l"."opening_balance" AS "ledger_opening",
    "l"."debit" AS "ledger_debit",
    "l"."credit" AS "ledger_credit",
    "l"."closing" AS "ledger_closing",
        CASE
            WHEN ("l"."closing" < ('-1'::integer)::numeric) THEN 'IN CREDIT'::"text"
            WHEN ("l"."closing" > (1)::numeric) THEN 'OWES'::"text"
            WHEN ("l"."closing" IS NULL) THEN 'NOT IN LEDGER'::"text"
            ELSE 'NIL'::"text"
        END AS "ledger_position",
    GREATEST(COALESCE("l"."closing", (0)::numeric), (0)::numeric) AS "owes",
    GREATEST((- COALESCE("l"."closing", (0)::numeric)), (0)::numeric) AS "in_credit",
    "v"."outstanding" AS "invoice_outstanding",
    "v"."unpaid_bills",
    "v"."d120plus" AS "over_120",
    "o"."prior_open",
    "o"."prior_bills",
    "o"."fy2627_open",
    "o"."fy2627_bills",
        CASE
            WHEN (COALESCE("l"."closing", (0)::numeric) > (1)::numeric) THEN "round"((COALESCE("v"."outstanding", (0)::numeric) - "l"."closing"), 2)
            ELSE NULL::numeric
        END AS "to_write_off",
    "b"."status",
    "b"."opening_agreed",
    "b"."verified_by",
    "b"."verified_on",
    "b"."method",
    "b"."note",
        CASE
            WHEN ("b"."status" = ANY (ARRAY['CONFIRMED WITH CUSTOMER'::"text", 'WRITTEN OFF'::"text"])) THEN '5. DONE'::"text"
            WHEN ("b"."status" = 'DISPUTED'::"text") THEN '4. DISPUTED'::"text"
            WHEN ("l"."closing" < ('-1'::integer)::numeric) THEN '3. IN CREDIT — refund or apply'::"text"
            WHEN (("l"."closing" IS NULL) AND (COALESCE("v"."outstanding", (0)::numeric) > (0)::numeric)) THEN '4. NOT IN THE LEDGER — check'::"text"
            WHEN ("abs"((COALESCE("v"."outstanding", (0)::numeric) - COALESCE("l"."closing", (0)::numeric))) <= (1)::numeric) THEN '1. AGREES — just confirm'::"text"
            WHEN ((COALESCE("o"."prior_open", (0)::numeric) = (0)::numeric) AND (COALESCE("l"."opening_balance", (0)::numeric) = (0)::numeric)) THEN '2. NO HISTORY — confirm and close'::"text"
            ELSE '4. CHECK WITH CUSTOMER'::"text"
        END AS "next_step"
   FROM ((("led" "l"
     FULL JOIN "inv" "v" ON (("v"."customer_name" = "l"."party_name")))
     FULL JOIN "ours" "o" ON (("o"."customer" = COALESCE("l"."party_name", "v"."customer_name"))))
     FULL JOIN "public"."customer_opening_balance" "b" ON (("b"."customer_name" = COALESCE("l"."party_name", "v"."customer_name", "o"."customer"))));


ALTER VIEW "public"."v_reconciliation" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_reconciliation" IS 'THE reconciliation screen. Ledger vs invoice detail vs our own copy, per
   customer, with next_step telling you what to do. Customers IN CREDIT are
   separated from those who owe — netting them hid Rs 62 lakh of credit.';



CREATE OR REPLACE VIEW "public"."v_reconciliation_summary" AS
 SELECT "next_step",
    "count"(*) AS "customers",
    "round"("sum"("owes")) AS "owed",
    "round"("sum"("in_credit")) AS "in_credit",
    "round"("sum"("invoice_outstanding")) AS "invoices",
    "round"("sum"("to_write_off")) AS "to_close"
   FROM "public"."v_reconciliation"
  WHERE ((COALESCE("ledger_closing", (0)::numeric) <> (0)::numeric) OR (COALESCE("invoice_outstanding", (0)::numeric) <> (0)::numeric))
  GROUP BY "next_step"
  ORDER BY "next_step";


ALTER VIEW "public"."v_reconciliation_summary" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_reconciliation_summary" IS 'v_reconciliation, counted by next_step.';



CREATE OR REPLACE VIEW "public"."v_sales" AS
 SELECT "s"."id",
    "s"."created_at",
    "s"."date",
    "s"."voucher_no",
    "s"."sale_type",
    "s"."voucher_type",
    "s"."order_type",
    "s"."branch_id_db_id",
    "s"."customer_id_db_id",
    "s"."customer_name",
    "s"."mobile_no",
    "s"."gstin",
    "s"."department_name",
    "s"."category_name",
    "s"."sub_category_name",
    "s"."brand_name",
    "s"."sub_brand_name",
    "s"."hsn",
    "s"."product_type",
    "s"."product_id_db_id",
    "s"."varient_id_db_id",
    "s"."item_code",
    "s"."product_name",
    "s"."batch_no",
    "s"."purchase_price",
    "s"."landing_cost",
    "s"."mrp",
    "s"."unit_price",
    "s"."selling_price",
    "s"."qty",
    "s"."uom",
    "s"."taxable_amount",
    "s"."discount",
    "s"."tax_inclusive_discount",
    "s"."other_discount",
    "s"."tax_rate",
    "s"."tax_amount",
    "s"."cgst",
    "s"."sgst",
    "s"."igst",
    "s"."cess_rate",
    "s"."cess_amount",
    "s"."net_amount",
    "s"."sales_man",
    "s"."total_bill_amount",
    "s"."receipt_data",
    "s"."created_by",
    "s"."address",
    "s"."state_name",
    "s"."total_mrp",
    "s"."total_cart_discount",
    "s"."coupon_discount_tax_inclusive",
    "s"."invoice_id_db_id",
    "s"."invoice_no",
    "s"."source",
    "s"."loaded_at",
        CASE
            WHEN ("s"."customer_id_db_id" = '0'::"text") THEN 'Walk-in / Cash'::"text"
            WHEN ("m"."display_name" IS NOT NULL) THEN "m"."display_name"
            WHEN ("btrim"(COALESCE("s"."customer_name", ''::"text")) = ANY (ARRAY[''::"text", '.'::"text", '-'::"text"])) THEN NULL::"text"
            ELSE "s"."customer_name"
        END AS "customer_name_final",
        CASE
            WHEN ("s"."customer_id_db_id" = '0'::"text") THEN 'WALKIN'::"text"
            WHEN ("m"."display_name" IS NOT NULL) THEN 'MASTER'::"text"
            WHEN ("btrim"(COALESCE("s"."customer_name", ''::"text")) = ANY (ARRAY[''::"text", '.'::"text", '-'::"text"])) THEN 'UNRESOLVED'::"text"
            ELSE 'FEED'::"text"
        END AS "customer_name_source",
    ("s"."customer_id_db_id" = '0'::"text") AS "is_walkin",
        CASE
            WHEN ("s"."customer_id_db_id" = '0'::"text") THEN 'WALKIN'::"text"
            WHEN ("m"."lane" = 'WO'::"text") THEN 'NON_GST'::"text"
            WHEN ("m"."lane" = 'W'::"text") THEN 'GST'::"text"
            ELSE 'UNKNOWN'::"text"
        END AS "customer_lane",
        CASE
            WHEN ("s"."customer_id_db_id" = '0'::"text") THEN 'UNKNOWN'::"text"
            WHEN ("m"."contact_id" IS NULL) THEN 'UNKNOWN'::"text"
            WHEN (COALESCE("m"."gstin", ''::"text") <> ''::"text") THEN 'REGISTERED'::"text"
            ELSE 'UNREGISTERED'::"text"
        END AS "gst_registration",
        CASE
            WHEN ("s"."sale_type" = 'Invoice'::"text") THEN 'GST'::"text"
            WHEN ("s"."sale_type" = 'POS'::"text") THEN 'NON_GST'::"text"
            ELSE 'UNKNOWN'::"text"
        END AS "voucher_lane",
    "m"."gstin" AS "customer_gstin",
    "m"."mobile_no" AS "customer_mobile",
    "m"."whatsapp_no" AS "customer_whatsapp",
    "m"."city_name" AS "customer_city",
    "m"."contact_type" AS "customer_type",
    "m"."party_key" AS "customer_party_key",
    "public"."vt_date"("s"."date") AS "sale_date",
    "public"."vt_month"("s"."date") AS "sale_month",
    "public"."vt_num"("s"."qty") AS "qty_num",
    "public"."vt_num"("s"."unit_price") AS "unit_price_num",
    "public"."vt_num"("s"."selling_price") AS "selling_price_num",
    "public"."vt_num"("s"."mrp") AS "mrp_num",
    "public"."vt_num"("s"."taxable_amount") AS "taxable_amount_num",
    "public"."vt_num"("s"."discount") AS "discount_num",
    "public"."vt_num"("s"."tax_rate") AS "tax_rate_num",
    "public"."vt_num"("s"."tax_amount") AS "tax_amount_num",
    "public"."vt_num"("s"."net_amount") AS "net_amount_num",
    "public"."vt_num"("s"."total_bill_amount") AS "total_bill_amount_num",
    "public"."vt_num"("s"."landing_cost") AS "landing_cost_num",
    "public"."vt_num"("s"."purchase_price") AS "purchase_price_num",
        CASE
            WHEN ("s"."item_code" ~~ '%/'::"text") THEN 'NON_GST'::"text"
            ELSE 'GST'::"text"
        END AS "sku_lane",
    "rtrim"("s"."item_code", '/'::"text") AS "item_code_base"
   FROM ("public"."sales_data" "s"
     LEFT JOIN "public"."customer_master" "m" ON ((("s"."customer_id_db_id" ~ '^[0-9]+$'::"text") AND ("m"."contact_id" = ("s"."customer_id_db_id")::bigint))));


ALTER VIEW "public"."v_sales" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_sales" IS 'VT-DW-003/004/005b/014. sales_data with customer names resolved, lanes
   derived, and typed date/numeric columns (suffix _num, plus sale_date and
   sale_month). Raw text columns are retained unchanged. item_code_base strips
   the trailing / so GST and non-GST variants merge for unified analytics.';



CREATE OR REPLACE VIEW "public"."v_sales_month" AS
 SELECT "sale_month",
    "count"(*) AS "lines",
    "count"(DISTINCT "voucher_no") AS "invoices",
    "round"("sum"("qty_num")) AS "units",
    "round"("sum"("net_amount_num")) AS "revenue",
    "round"("sum"(("net_amount_num" - COALESCE("landing_cost_num", (0)::numeric)))) AS "margin",
    "count"(DISTINCT "item_code_base") AS "products",
    "count"(DISTINCT "contact_id") AS "customers"
   FROM "public"."v_sales_all"
  WHERE ("sale_month" IS NOT NULL)
  GROUP BY "sale_month";


ALTER VIEW "public"."v_sales_month" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_sales_month" IS 'Monthly rollup — lines, invoices, units, revenue, margin. What
   buildSalesMonthly should read instead of grinding through the sheets.';



CREATE OR REPLACE VIEW "public"."v_sales_monthly_rollup" AS
 SELECT "item_code_base" AS "code",
    "sale_month" AS "month",
    "max"("product_name") AS "name",
    "max"("category_name") AS "category",
    "max"("brand_name") AS "brand",
    "round"("sum"("qty_num"), 2) AS "qty",
    "round"("sum"("net_amount_num"), 2) AS "revenue",
    "round"("sum"(COALESCE("landing_cost_num", (0)::numeric)), 2) AS "cost",
    "round"("sum"(("net_amount_num" - COALESCE("landing_cost_num", (0)::numeric))), 2) AS "profit",
        CASE
            WHEN ("sum"("net_amount_num") > (0)::numeric) THEN "round"((("sum"(("net_amount_num" - COALESCE("landing_cost_num", (0)::numeric))) / "sum"("net_amount_num")) * (100)::numeric), 2)
            ELSE NULL::numeric
        END AS "margin_pct",
    (0)::numeric AS "discount",
    "round"("sum"("qty_num") FILTER (WHERE ("sku_lane" = 'W'::"text")), 2) AS "qty_w",
    "round"("sum"("qty_num") FILTER (WHERE ("sku_lane" = 'WO'::"text")), 2) AS "qty_wo",
    "count"(DISTINCT "voucher_no") AS "invoices",
    "count"(DISTINCT "contact_id") AS "customers"
   FROM "public"."v_sales_all"
  WHERE (("sale_month" IS NOT NULL) AND ("item_code_base" <> ''::"text"))
  GROUP BY "item_code_base", "sale_month";


ALTER VIEW "public"."v_sales_monthly_rollup" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_sales_monthly_rollup" IS 'Sales_Monthly in view form, 15 columns matching ROLL_COLS. Read by
   buildSalesMonthly so the rollup is one query instead of a 285s grind.';



CREATE OR REPLACE VIEW "public"."v_unapplied_receipts" AS
 SELECT "party_name" AS "customer",
    "receipt_no",
    "mode",
    "receipt_type",
    "receipt_date",
    "amount"
   FROM "public"."receipt_register" "rr"
  WHERE (("upper"(COALESCE("receipt_type", ''::"text")) ~~ '%ON ACCOUNT%'::"text") OR ("upper"(COALESCE("receipt_type", ''::"text")) ~~ '%ADVANCE%'::"text"));


ALTER VIEW "public"."v_unapplied_receipts" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_unapplied_receipts" IS 'Receipts booked On Account or as Advance in the Vasy export — money in,
   no invoice named. Candidates to assign against open invoices.';



CREATE OR REPLACE VIEW "public"."v_writeoff_candidates" AS
 SELECT COALESCE("public"."vt_party_name"("contact_id", "customer_name"), 'WALK-IN (no account)'::"text") AS "customer",
    "sales_id",
    "public"."vt_doc_no"("prefix", "sales_no", "order_no") AS "invoice_no",
    "order_no",
    "sales_date",
    (CURRENT_DATE - "sales_date") AS "age_days",
    "total",
    "paid_amount",
    "balance" AS "still_open",
    "inv_type",
    "payment_type",
        CASE
            WHEN ("sales_date" < '2026-04-01'::"date") THEN 'BEFORE APR 2026 — likely paid, not recorded'::"text"
            ELSE 'THIS YEAR — check before writing off'::"text"
        END AS "verdict"
   FROM "public"."sales_invoice" "i"
  WHERE ("balance" > 0.01)
  ORDER BY COALESCE("public"."vt_party_name"("contact_id", "customer_name"), 'WALK-IN (no account)'::"text"), "sales_date";


ALTER VIEW "public"."v_writeoff_candidates" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_writeoff_candidates" IS 'Every open invoice per customer, with a verdict on whether it is safe to
   close. Use after agreeing that customer''s opening balance.';



CREATE TABLE IF NOT EXISTS "public"."vendor_data" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "branch_id_db_ref_id" "text",
    "supplier_id" "text",
    "supplier_first_name" "text",
    "supplier_last_name" "text",
    "company_name" "text",
    "mobile_number" "text",
    "whatsapp_number" "text",
    "email_id" "text",
    "telephone_number" "text",
    "gst_type_unregistered_registered_regular" "text",
    "gstin" "text",
    "pan_no" "text",
    "type_manufacturer_stockiest_trader_other" "text",
    "bank_name" "text",
    "branch_name" "text",
    "bank_account_no" "text",
    "ifsc_code" "text",
    "adressline_1" "text",
    "adressline_2" "text",
    "pincode" "text",
    "city_name" "text",
    "state_name" "text",
    "country_name" "text",
    "dob_dd_mm_yyyy" "text",
    "opening_balance" "text",
    "cr_dr" "text",
    "source" "text" DEFAULT 'FTP'::"text",
    "loaded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."vendor_data" OWNER TO "postgres";


COMMENT ON TABLE "public"."vendor_data" IS 'RAW FTP. 716 suppliers.';



ALTER TABLE "public"."vendor_data" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."vendor_data_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."sales_ftp_gap" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."sales_ftp_gap_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."sales_history" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."sales_history_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."bank_receipt_data"
    ADD CONSTRAINT "bank_receipt_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bank_receipt_data"
    ADD CONSTRAINT "bank_receipt_data_voucher_id_db_key" UNIQUE ("voucher_id_db");



ALTER TABLE ONLY "public"."cash_payment_data"
    ADD CONSTRAINT "cash_payment_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cash_payment_data"
    ADD CONSTRAINT "cash_payment_data_voucher_id_db_key" UNIQUE ("voucher_id_db");



ALTER TABLE ONLY "public"."cash_receipt_data"
    ADD CONSTRAINT "cash_receipt_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cash_receipt_data"
    ADD CONSTRAINT "cash_receipt_data_voucher_id_db_key" UNIQUE ("voucher_id_db");



ALTER TABLE ONLY "public"."credit_note_data"
    ADD CONSTRAINT "credit_note_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_invoice_outstanding"
    ADD CONSTRAINT "customer_invoice_outstanding_pkey" PRIMARY KEY ("customer_name", "as_at");



ALTER TABLE ONLY "public"."customer_ledger_snapshot"
    ADD CONSTRAINT "customer_ledger_snapshot_pkey" PRIMARY KEY ("party_name", "as_at");



ALTER TABLE ONLY "public"."customer_master"
    ADD CONSTRAINT "customer_master_pkey" PRIMARY KEY ("contact_id");



ALTER TABLE ONLY "public"."customer_opening_balance"
    ADD CONSTRAINT "customer_opening_balance_pkey" PRIMARY KEY ("customer_name");



ALTER TABLE ONLY "public"."erp_snapshot"
    ADD CONSTRAINT "erp_snapshot_pkey" PRIMARY KEY ("item_code");



ALTER TABLE ONLY "public"."material_inward_data"
    ADD CONSTRAINT "material_inward_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ops_pipeline_snapshots"
    ADD CONSTRAINT "ops_pipeline_snapshots_pkey" PRIMARY KEY ("snapshot_date");



ALTER TABLE ONLY "public"."product_consumption_data"
    ADD CONSTRAINT "product_consumption_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_data"
    ADD CONSTRAINT "product_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_data"
    ADD CONSTRAINT "product_data_product_id_key" UNIQUE ("product_id");



ALTER TABLE ONLY "public"."purchase_bill_data"
    ADD CONSTRAINT "purchase_bill_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_return_data"
    ADD CONSTRAINT "purchase_return_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."receipt_register"
    ADD CONSTRAINT "receipt_register_pkey" PRIMARY KEY ("receipt_no");



ALTER TABLE ONLY "public"."sales_data"
    ADD CONSTRAINT "sales_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_ftp_gap"
    ADD CONSTRAINT "sales_ftp_gap_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_ftp_gap"
    ADD CONSTRAINT "sales_ftp_gap_voucher_no_item_code_qty_net_amount_key" UNIQUE ("voucher_no", "item_code", "qty", "net_amount");



ALTER TABLE ONLY "public"."sales_history"
    ADD CONSTRAINT "sales_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_invoice"
    ADD CONSTRAINT "sales_invoice_pkey" PRIMARY KEY ("sales_id");



ALTER TABLE ONLY "public"."stock_adjustment_data"
    ADD CONSTRAINT "stock_adjustment_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_live"
    ADD CONSTRAINT "stock_live_pkey" PRIMARY KEY ("item_code");



ALTER TABLE ONLY "public"."vendor_data"
    ADD CONSTRAINT "vendor_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_data"
    ADD CONSTRAINT "vendor_data_supplier_id_key" UNIQUE ("supplier_id");



CREATE INDEX "idx_cm_branch" ON "public"."customer_master" USING "btree" ("branch_id");



CREATE INDEX "idx_cm_lane" ON "public"."customer_master" USING "btree" ("lane");



CREATE INDEX "idx_cm_mobile" ON "public"."customer_master" USING "btree" ("mobile_no");



CREATE INDEX "idx_cm_party_key" ON "public"."customer_master" USING "btree" ("party_key");



CREATE INDEX "idx_mi_date" ON "public"."material_inward_data" USING "btree" ("inward_date");



CREATE INDEX "idx_mi_inwarddt" ON "public"."material_inward_data" USING "btree" ("public"."vt_date"("inward_date"));



CREATE INDEX "idx_mi_item" ON "public"."material_inward_data" USING "btree" ("item_code");



CREATE INDEX "idx_pb_billdt" ON "public"."purchase_bill_data" USING "btree" ("public"."vt_date"("bill_date"));



CREATE INDEX "idx_pb_billmonth" ON "public"."purchase_bill_data" USING "btree" ("public"."vt_month"("bill_date"));



CREATE INDEX "idx_pb_date" ON "public"."purchase_bill_data" USING "btree" ("bill_date");



CREATE INDEX "idx_pb_item" ON "public"."purchase_bill_data" USING "btree" ("item_code");



CREATE INDEX "idx_pb_itembase" ON "public"."purchase_bill_data" USING "btree" ("rtrim"("item_code", '/'::"text"));



CREATE INDEX "idx_pb_voucher" ON "public"."purchase_bill_data" USING "btree" ("voucher_no");



CREATE INDEX "idx_rr_date" ON "public"."receipt_register" USING "btree" ("receipt_date");



CREATE INDEX "idx_rr_mode" ON "public"."receipt_register" USING "btree" ("mode");



CREATE INDEX "idx_sa_date" ON "public"."stock_adjustment_data" USING "btree" ("stock_transaction_date");



CREATE INDEX "idx_sa_item" ON "public"."stock_adjustment_data" USING "btree" ("item_code");



CREATE INDEX "idx_sa_itembase" ON "public"."stock_adjustment_data" USING "btree" ("rtrim"("item_code", '/'::"text"));



CREATE INDEX "idx_sa_movedt" ON "public"."stock_adjustment_data" USING "btree" ("public"."vt_date"("stock_transaction_date"));



CREATE INDEX "idx_sa_movemonth" ON "public"."stock_adjustment_data" USING "btree" ("public"."vt_month"("stock_transaction_date"));



CREATE INDEX "idx_sales_customer" ON "public"."sales_data" USING "btree" ("customer_id_db_id");



CREATE INDEX "idx_sales_date" ON "public"."sales_data" USING "btree" ("date");



CREATE INDEX "idx_sales_item" ON "public"."sales_data" USING "btree" ("item_code");



CREATE INDEX "idx_sales_itembase" ON "public"."sales_data" USING "btree" ("rtrim"("item_code", '/'::"text"));



CREATE INDEX "idx_sales_saledate" ON "public"."sales_data" USING "btree" ("public"."vt_date"("date"));



CREATE INDEX "idx_sales_salemonth" ON "public"."sales_data" USING "btree" ("public"."vt_month"("date"));



CREATE INDEX "idx_sales_saletype" ON "public"."sales_data" USING "btree" ("sale_type");



CREATE INDEX "idx_sales_voucher" ON "public"."sales_data" USING "btree" ("voucher_no");



CREATE INDEX "idx_sfg_date" ON "public"."sales_ftp_gap" USING "btree" ("sales_date");



CREATE INDEX "idx_sfg_month" ON "public"."sales_ftp_gap" USING "btree" ("sale_month");



CREATE INDEX "idx_sfg_voucher" ON "public"."sales_ftp_gap" USING "btree" ("voucher_no");



CREATE INDEX "idx_sh_contact" ON "public"."sales_history" USING "btree" ("contact_id");



CREATE INDEX "idx_sh_date" ON "public"."sales_history" USING "btree" ("sales_date");



CREATE INDEX "idx_sh_item" ON "public"."sales_history" USING "btree" ("item_code");



CREATE INDEX "idx_sh_month" ON "public"."sales_history" USING "btree" ("sale_month");



CREATE INDEX "idx_sh_voucher" ON "public"."sales_history" USING "btree" ("voucher_no");



CREATE INDEX "idx_si_balance" ON "public"."sales_invoice" USING "btree" ("balance");



CREATE INDEX "idx_si_contact" ON "public"."sales_invoice" USING "btree" ("contact_id");



CREATE INDEX "idx_si_date" ON "public"."sales_invoice" USING "btree" ("sales_date");



CREATE INDEX "idx_si_orderno" ON "public"."sales_invoice" USING "btree" ("order_no");



CREATE UNIQUE INDEX "ux_sales_history_src" ON "public"."sales_history" USING "btree" ("source", "src_row");



ALTER TABLE "public"."bank_receipt_data" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cash_payment_data" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cash_receipt_data" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."credit_note_data" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_invoice_outstanding" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_ledger_snapshot" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_master" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_opening_balance" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_snapshot" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."material_inward_data" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ops_pipeline_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_consumption_data" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_data" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_bill_data" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_return_data" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."receipt_register" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sales_data" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sales_ftp_gap" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sales_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sales_invoice" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stock_adjustment_data" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stock_live" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vendor_data" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "api" TO "anon";
GRANT USAGE ON SCHEMA "api" TO "authenticated";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."vt_date"("t" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."vt_date"("t" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vt_date"("t" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."vt_doc_no"("p_prefix" "text", "p_sales_no" "text", "p_order_no" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."vt_doc_no"("p_prefix" "text", "p_sales_no" "text", "p_order_no" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vt_doc_no"("p_prefix" "text", "p_sales_no" "text", "p_order_no" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."vt_month"("t" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."vt_month"("t" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vt_month"("t" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."vt_num"("t" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."vt_num"("t" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vt_num"("t" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."vt_party_name"("p_contact_id" bigint, "p_invoice_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."vt_party_name"("p_contact_id" bigint, "p_invoice_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vt_party_name"("p_contact_id" bigint, "p_invoice_name" "text") TO "service_role";


















GRANT ALL ON TABLE "public"."bank_receipt_data" TO "anon";
GRANT ALL ON TABLE "public"."bank_receipt_data" TO "authenticated";
GRANT ALL ON TABLE "public"."bank_receipt_data" TO "service_role";



GRANT ALL ON SEQUENCE "public"."bank_receipt_data_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."bank_receipt_data_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."bank_receipt_data_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cash_payment_data" TO "anon";
GRANT ALL ON TABLE "public"."cash_payment_data" TO "authenticated";
GRANT ALL ON TABLE "public"."cash_payment_data" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cash_payment_data_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cash_payment_data_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cash_payment_data_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cash_receipt_data" TO "anon";
GRANT ALL ON TABLE "public"."cash_receipt_data" TO "authenticated";
GRANT ALL ON TABLE "public"."cash_receipt_data" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cash_receipt_data_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cash_receipt_data_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cash_receipt_data_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."credit_note_data" TO "anon";
GRANT ALL ON TABLE "public"."credit_note_data" TO "authenticated";
GRANT ALL ON TABLE "public"."credit_note_data" TO "service_role";



GRANT ALL ON SEQUENCE "public"."credit_note_data_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."credit_note_data_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."credit_note_data_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."customer_invoice_outstanding" TO "anon";
GRANT ALL ON TABLE "public"."customer_invoice_outstanding" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_invoice_outstanding" TO "service_role";



GRANT ALL ON TABLE "public"."customer_ledger_snapshot" TO "anon";
GRANT ALL ON TABLE "public"."customer_ledger_snapshot" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_ledger_snapshot" TO "service_role";



GRANT ALL ON TABLE "public"."customer_master" TO "anon";
GRANT ALL ON TABLE "public"."customer_master" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_master" TO "service_role";



GRANT ALL ON TABLE "public"."customer_opening_balance" TO "anon";
GRANT ALL ON TABLE "public"."customer_opening_balance" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_opening_balance" TO "service_role";



GRANT ALL ON TABLE "public"."erp_snapshot" TO "anon";
GRANT ALL ON TABLE "public"."erp_snapshot" TO "authenticated";
GRANT ALL ON TABLE "public"."erp_snapshot" TO "service_role";



GRANT ALL ON TABLE "public"."material_inward_data" TO "anon";
GRANT ALL ON TABLE "public"."material_inward_data" TO "authenticated";
GRANT ALL ON TABLE "public"."material_inward_data" TO "service_role";



GRANT ALL ON SEQUENCE "public"."material_inward_data_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."material_inward_data_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."material_inward_data_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ops_pipeline_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."ops_pipeline_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."ops_pipeline_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."product_consumption_data" TO "anon";
GRANT ALL ON TABLE "public"."product_consumption_data" TO "authenticated";
GRANT ALL ON TABLE "public"."product_consumption_data" TO "service_role";



GRANT ALL ON SEQUENCE "public"."product_consumption_data_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."product_consumption_data_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."product_consumption_data_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."product_data" TO "anon";
GRANT ALL ON TABLE "public"."product_data" TO "authenticated";
GRANT ALL ON TABLE "public"."product_data" TO "service_role";



GRANT ALL ON SEQUENCE "public"."product_data_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."product_data_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."product_data_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."purchase_bill_data" TO "anon";
GRANT ALL ON TABLE "public"."purchase_bill_data" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_bill_data" TO "service_role";



GRANT ALL ON SEQUENCE "public"."purchase_bill_data_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."purchase_bill_data_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."purchase_bill_data_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."purchase_return_data" TO "anon";
GRANT ALL ON TABLE "public"."purchase_return_data" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_return_data" TO "service_role";



GRANT ALL ON SEQUENCE "public"."purchase_return_data_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."purchase_return_data_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."purchase_return_data_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."receipt_register" TO "anon";
GRANT ALL ON TABLE "public"."receipt_register" TO "authenticated";
GRANT ALL ON TABLE "public"."receipt_register" TO "service_role";



GRANT ALL ON TABLE "public"."sales_data" TO "anon";
GRANT ALL ON TABLE "public"."sales_data" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_data" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sales_data_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sales_data_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sales_data_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sales_ftp_gap" TO "anon";
GRANT ALL ON TABLE "public"."sales_ftp_gap" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_ftp_gap" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sales_ftp_gap_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sales_ftp_gap_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sales_ftp_gap_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sales_history" TO "anon";
GRANT ALL ON TABLE "public"."sales_history" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_history" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sales_history_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sales_history_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sales_history_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sales_invoice" TO "anon";
GRANT ALL ON TABLE "public"."sales_invoice" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_invoice" TO "service_role";



GRANT ALL ON TABLE "public"."stock_adjustment_data" TO "anon";
GRANT ALL ON TABLE "public"."stock_adjustment_data" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_adjustment_data" TO "service_role";



GRANT ALL ON SEQUENCE "public"."stock_adjustment_data_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."stock_adjustment_data_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."stock_adjustment_data_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."stock_live" TO "anon";
GRANT ALL ON TABLE "public"."stock_live" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_live" TO "service_role";



GRANT ALL ON TABLE "public"."v_purchase" TO "anon";
GRANT ALL ON TABLE "public"."v_purchase" TO "authenticated";
GRANT ALL ON TABLE "public"."v_purchase" TO "service_role";



GRANT ALL ON TABLE "public"."v_agg_purchase_month_item" TO "anon";
GRANT ALL ON TABLE "public"."v_agg_purchase_month_item" TO "authenticated";
GRANT ALL ON TABLE "public"."v_agg_purchase_month_item" TO "service_role";



GRANT ALL ON TABLE "public"."v_sales_all" TO "anon";
GRANT ALL ON TABLE "public"."v_sales_all" TO "authenticated";
GRANT ALL ON TABLE "public"."v_sales_all" TO "service_role";



GRANT ALL ON TABLE "public"."v_agg_sales_daily" TO "anon";
GRANT ALL ON TABLE "public"."v_agg_sales_daily" TO "authenticated";
GRANT ALL ON TABLE "public"."v_agg_sales_daily" TO "service_role";



GRANT ALL ON TABLE "public"."v_agg_sales_month_customer" TO "anon";
GRANT ALL ON TABLE "public"."v_agg_sales_month_customer" TO "authenticated";
GRANT ALL ON TABLE "public"."v_agg_sales_month_customer" TO "service_role";



GRANT ALL ON TABLE "public"."v_agg_sales_month_item" TO "anon";
GRANT ALL ON TABLE "public"."v_agg_sales_month_item" TO "authenticated";
GRANT ALL ON TABLE "public"."v_agg_sales_month_item" TO "service_role";



GRANT ALL ON TABLE "public"."v_stock_moves" TO "anon";
GRANT ALL ON TABLE "public"."v_stock_moves" TO "authenticated";
GRANT ALL ON TABLE "public"."v_stock_moves" TO "service_role";



GRANT ALL ON TABLE "public"."v_agg_stock_position" TO "anon";
GRANT ALL ON TABLE "public"."v_agg_stock_position" TO "authenticated";
GRANT ALL ON TABLE "public"."v_agg_stock_position" TO "service_role";



GRANT ALL ON TABLE "public"."v_sales_data_all" TO "anon";
GRANT ALL ON TABLE "public"."v_sales_data_all" TO "authenticated";
GRANT ALL ON TABLE "public"."v_sales_data_all" TO "service_role";



GRANT ALL ON TABLE "public"."v_customer_360" TO "anon";
GRANT ALL ON TABLE "public"."v_customer_360" TO "authenticated";
GRANT ALL ON TABLE "public"."v_customer_360" TO "service_role";



GRANT ALL ON TABLE "public"."v_customer_fy2627" TO "anon";
GRANT ALL ON TABLE "public"."v_customer_fy2627" TO "authenticated";
GRANT ALL ON TABLE "public"."v_customer_fy2627" TO "service_role";



GRANT ALL ON TABLE "public"."v_receipts" TO "anon";
GRANT ALL ON TABLE "public"."v_receipts" TO "authenticated";
GRANT ALL ON TABLE "public"."v_receipts" TO "service_role";



GRANT ALL ON TABLE "public"."v_customer_invoices" TO "anon";
GRANT ALL ON TABLE "public"."v_customer_invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."v_customer_invoices" TO "service_role";



GRANT ALL ON TABLE "public"."v_customer_lane_anomalies" TO "anon";
GRANT ALL ON TABLE "public"."v_customer_lane_anomalies" TO "authenticated";
GRANT ALL ON TABLE "public"."v_customer_lane_anomalies" TO "service_role";



GRANT ALL ON TABLE "public"."v_customer_master_sheet" TO "anon";
GRANT ALL ON TABLE "public"."v_customer_master_sheet" TO "authenticated";
GRANT ALL ON TABLE "public"."v_customer_master_sheet" TO "service_role";



GRANT ALL ON TABLE "public"."v_receipt_allocation" TO "anon";
GRANT ALL ON TABLE "public"."v_receipt_allocation" TO "authenticated";
GRANT ALL ON TABLE "public"."v_receipt_allocation" TO "service_role";



GRANT ALL ON TABLE "public"."v_invoice_settlement" TO "anon";
GRANT ALL ON TABLE "public"."v_invoice_settlement" TO "authenticated";
GRANT ALL ON TABLE "public"."v_invoice_settlement" TO "service_role";



GRANT ALL ON TABLE "public"."v_customer_open" TO "anon";
GRANT ALL ON TABLE "public"."v_customer_open" TO "authenticated";
GRANT ALL ON TABLE "public"."v_customer_open" TO "service_role";



GRANT ALL ON TABLE "public"."v_customer_receipts" TO "anon";
GRANT ALL ON TABLE "public"."v_customer_receipts" TO "authenticated";
GRANT ALL ON TABLE "public"."v_customer_receipts" TO "service_role";



GRANT ALL ON TABLE "public"."v_customer_recovery_queue" TO "anon";
GRANT ALL ON TABLE "public"."v_customer_recovery_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."v_customer_recovery_queue" TO "service_role";



GRANT ALL ON TABLE "public"."v_receivable_exceptions" TO "anon";
GRANT ALL ON TABLE "public"."v_receivable_exceptions" TO "authenticated";
GRANT ALL ON TABLE "public"."v_receivable_exceptions" TO "service_role";



GRANT ALL ON TABLE "public"."v_exception_summary" TO "anon";
GRANT ALL ON TABLE "public"."v_exception_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."v_exception_summary" TO "service_role";



GRANT ALL ON TABLE "public"."v_inventory" TO "anon";
GRANT ALL ON TABLE "public"."v_inventory" TO "authenticated";
GRANT ALL ON TABLE "public"."v_inventory" TO "service_role";



GRANT ALL ON TABLE "public"."v_inventory_summary" TO "anon";
GRANT ALL ON TABLE "public"."v_inventory_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."v_inventory_summary" TO "service_role";



GRANT ALL ON TABLE "public"."v_inward" TO "anon";
GRANT ALL ON TABLE "public"."v_inward" TO "authenticated";
GRANT ALL ON TABLE "public"."v_inward" TO "service_role";



GRANT ALL ON TABLE "public"."v_item_latest_cost" TO "anon";
GRANT ALL ON TABLE "public"."v_item_latest_cost" TO "authenticated";
GRANT ALL ON TABLE "public"."v_item_latest_cost" TO "service_role";



GRANT ALL ON TABLE "public"."v_lane_violations" TO "anon";
GRANT ALL ON TABLE "public"."v_lane_violations" TO "authenticated";
GRANT ALL ON TABLE "public"."v_lane_violations" TO "service_role";



GRANT ALL ON TABLE "public"."v_receivables_summary" TO "anon";
GRANT ALL ON TABLE "public"."v_receivables_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."v_receivables_summary" TO "service_role";



GRANT ALL ON TABLE "public"."v_reconciliation" TO "anon";
GRANT ALL ON TABLE "public"."v_reconciliation" TO "authenticated";
GRANT ALL ON TABLE "public"."v_reconciliation" TO "service_role";



GRANT ALL ON TABLE "public"."v_reconciliation_summary" TO "anon";
GRANT ALL ON TABLE "public"."v_reconciliation_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."v_reconciliation_summary" TO "service_role";



GRANT ALL ON TABLE "public"."v_sales" TO "anon";
GRANT ALL ON TABLE "public"."v_sales" TO "authenticated";
GRANT ALL ON TABLE "public"."v_sales" TO "service_role";



GRANT ALL ON TABLE "public"."v_sales_month" TO "anon";
GRANT ALL ON TABLE "public"."v_sales_month" TO "authenticated";
GRANT ALL ON TABLE "public"."v_sales_month" TO "service_role";



GRANT ALL ON TABLE "public"."v_sales_monthly_rollup" TO "anon";
GRANT ALL ON TABLE "public"."v_sales_monthly_rollup" TO "authenticated";
GRANT ALL ON TABLE "public"."v_sales_monthly_rollup" TO "service_role";



GRANT ALL ON TABLE "public"."v_unapplied_receipts" TO "anon";
GRANT ALL ON TABLE "public"."v_unapplied_receipts" TO "authenticated";
GRANT ALL ON TABLE "public"."v_unapplied_receipts" TO "service_role";



GRANT ALL ON TABLE "public"."v_writeoff_candidates" TO "anon";
GRANT ALL ON TABLE "public"."v_writeoff_candidates" TO "authenticated";
GRANT ALL ON TABLE "public"."v_writeoff_candidates" TO "service_role";



GRANT ALL ON TABLE "public"."vendor_data" TO "anon";
GRANT ALL ON TABLE "public"."vendor_data" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_data" TO "service_role";



GRANT ALL ON SEQUENCE "public"."vendor_data_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."vendor_data_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."vendor_data_id_seq" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



































