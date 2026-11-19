-- FTP V2 systematic sales correction handling.
-- Vasy's newer complete sales documents replace earlier versions even when item count drops.
-- Every shrinking sales document is recorded for post-import audit; other datasets still block dramatic shrink.
CREATE TABLE IF NOT EXISTS public.vt_ftp_document_shrink_audit (
  table_name text NOT NULL,
  document_key text NOT NULL,
  export_stamp text NOT NULL,
  previous_lines integer NOT NULL,
  incoming_lines integer NOT NULL,
  voucher_no text,
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','reviewed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(table_name,document_key,export_stamp)
);
ALTER TABLE public.vt_ftp_document_shrink_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vt_ftp_document_shrink_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT, INSERT, UPDATE ON public.vt_ftp_document_shrink_audit TO service_role;

CREATE OR REPLACE FUNCTION public.vt_ftp_replace_document_v2(p_table text, p_rows jsonb, p_export_stamp text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  kcols text[]; key_values text[] := ARRAY[]::text[];
  col text; val text; idx integer := 0; where_clause text := '';
  incoming integer; existing integer; bad_columns integer; invalid_rows integer;
  insert_columns text; source_columns text; table_record regclass;
  document_identity text; prior_stamp text; prior_hash text; incoming_hash text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role required'; END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Expected an array'; END IF;
  IF jsonb_array_length(p_rows)=0 OR jsonb_array_length(p_rows)>2000 THEN RAISE EXCEPTION 'Expected 1..2000 complete lines'; END IF;
  kcols := CASE p_table
    WHEN 'sales_data' THEN ARRAY['invoice_id_db_id']
    WHEN 'purchase_bill_data' THEN ARRAY['voucher_no']
    WHEN 'material_inward_data' THEN ARRAY['inward_no','inward_date']
    WHEN 'stock_adjustment_data' THEN ARRAY['stock_transaction_date','created_on','item_code']
    WHEN 'bank_receipt_data' THEN ARRAY['voucher_id_db']
    WHEN 'cash_receipt_data' THEN ARRAY['voucher_id_db']
    WHEN 'cash_payment_data' THEN ARRAY['voucher_id_db']
    WHEN 'expense_register_data' THEN ARRAY['expense_no']
    WHEN 'credit_note_data' THEN ARRAY['invoice_id_db_id']
    WHEN 'purchase_return_data' THEN ARRAY['voucher_no']
    WHEN 'product_consumption_data' THEN ARRAY['consumption_no']
    WHEN 'vendor_data' THEN ARRAY['supplier_id']
    WHEN 'product_data' THEN ARRAY['product_id']
    ELSE NULL END;
  IF kcols IS NULL THEN RAISE EXCEPTION 'Unsupported table'; END IF;
  table_record := to_regclass(format('public.%I',p_table));
  IF table_record IS NULL THEN RAISE EXCEPTION 'Target table not found'; END IF;
  IF p_export_stamp IS NULL OR p_export_stamp !~ '^[0-9]{14}$' THEN RAISE EXCEPTION 'Invalid export timestamp'; END IF;
  incoming := jsonb_array_length(p_rows);
  SELECT count(*) INTO invalid_rows FROM jsonb_array_elements(p_rows) v WHERE jsonb_typeof(v)<>'object';
  IF invalid_rows>0 THEN RAISE EXCEPTION 'Each line must be a JSON object'; END IF;
  SELECT count(*) INTO bad_columns
  FROM (SELECT DISTINCT key FROM jsonb_array_elements(p_rows) v CROSS JOIN LATERAL jsonb_object_keys(v) key) x
  WHERE key IN ('id','created_at','loaded_at','source') OR NOT EXISTS
    (SELECT 1 FROM pg_attribute a WHERE a.attrelid=table_record AND a.attname=x.key AND a.attnum>0 AND NOT a.attisdropped);
  IF bad_columns>0 THEN RAISE EXCEPTION 'Unknown or protected CSV column'; END IF;
  FOREACH col IN ARRAY kcols LOOP
    idx:=idx+1; val:=p_rows->0->>col;
    IF val IS NULL OR btrim(val)='' THEN RAISE EXCEPTION 'Blank document identity: %',col; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE r->>col IS DISTINCT FROM val)
    THEN RAISE EXCEPTION 'Mixed document identities for %',col; END IF;
    key_values:=array_append(key_values,val);
    IF idx>1 THEN where_clause:=where_clause||' AND '; END IF;
    where_clause:=where_clause||format('%I = %L',col,val);
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtext(p_table),hashtext(array_to_string(key_values,'|')));
  document_identity := to_jsonb(key_values)::text;
  incoming_hash := md5(p_rows::text);
  SELECT export_stamp, payload_hash INTO prior_stamp, prior_hash
  FROM public.vt_ftp_document_versions
  WHERE table_name=p_table AND document_key=document_identity FOR UPDATE;
  IF FOUND THEN
    IF p_export_stamp < prior_stamp THEN
      RETURN jsonb_build_object('table',p_table,'incoming',incoming,'status','skipped_older','current_stamp',prior_stamp);
    ELSIF p_export_stamp = prior_stamp THEN
      IF incoming_hash <> prior_hash THEN RAISE EXCEPTION 'Same export timestamp has different content'; END IF;
      RETURN jsonb_build_object('table',p_table,'incoming',incoming,'status','skipped_same');
    END IF;
  END IF;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %s',p_table,where_clause) INTO existing;
  -- Sales documents may legitimately shrink after a Vasy correction. Log and accept
  -- complete newer exports; preserve the conservative shrink guard elsewhere.
  IF p_table='sales_data' AND existing>incoming THEN
    INSERT INTO public.vt_ftp_document_shrink_audit
      (table_name,document_key,export_stamp,previous_lines,incoming_lines,voucher_no,review_status)
    VALUES
      (p_table,document_identity,p_export_stamp,existing,incoming,p_rows->0->>'voucher_no','pending')
    ON CONFLICT (table_name,document_key,export_stamp) DO NOTHING;
  ELSIF existing>0 AND incoming<existing*0.4 THEN
    RAISE EXCEPTION 'Shrink guard: % incoming against % live',incoming,existing;
  END IF;
  SELECT string_agg(format('%I',a.attname),',' ORDER BY a.attnum),
         string_agg(format('r.%I',a.attname),',' ORDER BY a.attnum)
  INTO insert_columns,source_columns
  FROM pg_attribute a WHERE a.attrelid=table_record AND a.attnum>0 AND NOT a.attisdropped
  AND a.attname NOT IN ('id','created_at','loaded_at','source');
  IF insert_columns IS NULL THEN RAISE EXCEPTION 'No target columns'; END IF;
  EXECUTE format('DELETE FROM public.%I WHERE %s',p_table,where_clause);
  EXECUTE format('INSERT INTO public.%I (%s,source,loaded_at) SELECT %s,%L,now() FROM jsonb_populate_recordset(NULL::public.%I,$1) r',
    p_table,insert_columns,source_columns,'FTP',p_table) USING p_rows;
  INSERT INTO public.vt_ftp_document_versions(table_name,document_key,export_stamp,payload_hash)
  VALUES(p_table,document_identity,p_export_stamp,incoming_hash)
  ON CONFLICT(table_name,document_key) DO UPDATE
  SET export_stamp=EXCLUDED.export_stamp,payload_hash=EXCLUDED.payload_hash,updated_at=now();
  RETURN jsonb_build_object('table',p_table,'incoming',incoming,'previous',existing,'status','committed');
END $function$;
REVOKE ALL ON FUNCTION public.vt_ftp_replace_document_v2(text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vt_ftp_replace_document_v2(text,jsonb,text) TO service_role;
