<?php
/**
 * Vithya Traders - Vasy FTP -> Supabase (review candidate; CLI ONLY).
 * Version-aware candidate. Not deployed to Hostinger.
 * DO NOT use the former web-facing supabase.php or start the old cron.
 * Processes ONLY *.csv; *.csv.processed are never selected.
 * All writes go through Supabase vt_ftp_replace_document_v2 RPC, one complete document at a time.
 * --check [--file=basename.csv | --prefix=SalesInvoiceData] scans without changing files/DB.
 * --apply --file=basename.csv processes exactly one named file (controlled live test).
 * --apply --all [--max-files=10] processes pending CSVs oldest first; stops on any error.
 * --root=/local/path is allowed in --check ONLY for offline tests.
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit("CLI only\n"); }
ini_set('memory_limit', '512M');
set_time_limit(0);
$cfg = require __DIR__.'/vt_ftp_schema.php';
$ftpRoot = '/home/u631621082';
$keyFile = '/home/u631621082/supabase_key.txt';
$lockFile = '/home/u631621082/vt_ftp_sync.lock';
$endpoint = 'https://kssydapdfmkfufrqhwzp.supabase.co/rest/v1/rpc/vt_ftp_replace_document_v2';
// Guardrail: don't accidentally re-import a failed multi-year bulk repush.
$maxRowsPerDailyFile = 25000;
$maxBytesPerDailyFile = 24 * 1024 * 1024;
$maxLinesPerDocument = 2000;
$stableSeconds = 300;
$earliestSafeDate = '20261013'; // Before this requires separate historical replay review.
$flags = array_slice($argv, 1);
$apply = in_array('--apply', $flags, true);
$check = in_array('--check', $flags, true);
$all = in_array('--all', $flags, true);
if ($apply === $check) { fwrite(STDERR, "Choose exactly --check or --apply\n"); exit(2); }
$fileFilter = $prefixFilter = null;
$maxFiles = PHP_INT_MAX;
foreach ($flags as $arg) {
    if (str_starts_with($arg,'--file=')) $fileFilter = substr($arg,7);
    elseif (str_starts_with($arg,'--prefix=')) $prefixFilter = substr($arg,9);
    elseif (str_starts_with($arg,'--max-files=')) $maxFiles = (int)substr($arg,12);
    elseif (str_starts_with($arg,'--root=')) {
        if ($apply) { fwrite(STDERR,"--root can only be used with --check\n"); exit(2); }
        $ftpRoot = substr($arg,7);
    } elseif (!in_array($arg,['--apply','--check','--all'],true)) {
        fwrite(STDERR,"Unknown argument $arg\n"); exit(2);
    }
}
if ($maxFiles<1) { fwrite(STDERR,"Invalid max-files\n"); exit(2); }
if ($fileFilter !== null && (basename($fileFilter)!==$fileFilter || !str_ends_with($fileFilter,'.csv'))) {
    fwrite(STDERR,"--file must be an exact CSV basename\n"); exit(2);
}
if ($prefixFilter!==null && !isset($cfg[$prefixFilter])) {
    fwrite(STDERR,"Unknown dataset prefix\n"); exit(2);
}
if ($apply && !$all && $fileFilter===null) {
    fwrite(STDERR,"APPLY requires --file=EXACT_NAME.csv for first test, or --all for backlog\n"); exit(2);
}
if ($apply && $all && ($fileFilter!==null || $prefixFilter!==null)) {
    fwrite(STDERR,"Do not mix --all with --file or --prefix\n"); exit(2);
}
if ($apply && !is_readable($keyFile)) {
    fwrite(STDERR,"Private Supabase service key file missing; no changes\n"); exit(2);
}
$secret = $apply ? trim((string)file_get_contents($keyFile)) : '';
if ($apply && strlen($secret)<40) { fwrite(STDERR,"Service key missing/invalid; no changes\n"); exit(2); }
if (!is_dir($ftpRoot)) { fwrite(STDERR,"FTP folder missing\n");exit(2); }
$lock = null;
if ($apply) {
    $lock=fopen($lockFile,'c');
    if (!$lock || !flock($lock,LOCK_EX|LOCK_NB)) { fwrite(STDERR,"Importer already running; no changes\n");exit(2); }
}
function normalise(string $name):string {
    $name=preg_replace('/^\xEF\xBB\xBF/','',$name);
    return trim(strtolower((string)preg_replace('/[^A-Za-z0-9]+/','_',trim($name))),'_');
}
function fileMeta(string $basename, array $cfg): ?array {
    foreach ($cfg as $prefix=>$spec) {
        if (!str_starts_with($basename,$prefix.'_')) continue;
        if (!preg_match('/^'.preg_quote($prefix,'/').'_21024_(\d{2})(\d{2})(\d{4})_(\d{6})\.csv$/',$basename,$m))
            throw new RuntimeException("Unrecognised Vasy filename $basename");
        $stamp = $m[3].$m[2].$m[1].$m[4];
        $dt=DateTimeImmutable::createFromFormat('!YmdHis',$stamp);
        if (!$dt || $dt->format('YmdHis')!==$stamp)
            throw new RuntimeException("Invalid Vasy timestamp $basename");
        return ['prefix'=>$prefix,'stamp'=>$dt->format('YmdHis'),'spec'=>$spec];
    }
    if (str_starts_with($basename,'ProductData_')) return ['disabled'=>true,'prefix'=>'ProductData'];
    return null;
}
function csvStage(string $path,array $spec,int $maxRows,int $maxBytes,int $maxLines,bool $check):array {
    if (!is_file($path)||filesize($path)>$maxBytes) throw new RuntimeException('File too large for safe daily importer; bulk/manual path required');
    $fh=fopen($path,'rb');if (!$fh) throw new RuntimeException('Could not open file');
    try {
        $raw=fgetcsv($fh,0,',','"','');
        if ($raw===false) throw new RuntimeException('Missing CSV header');
        $hdr=array_map('normalise',$raw);
        if (count($hdr)!==count(array_unique($hdr))) throw new RuntimeException('Duplicate normalized headers');
        $exp=$spec['columns'];
        if ($hdr!==$exp) {
            $missing=array_values(array_diff($exp,$hdr));$extra=array_values(array_diff($hdr,$exp));
            throw new RuntimeException('Unexpected Vasy columns; missing='.implode(',',$missing).' extra='.implode(',',$extra).' order='.($missing||$extra?'n/a':'changed'));
        }
        $keys=$spec['keys']; $docs=[];$lines=0;$rowNumber=1;
        while(($cells=fgetcsv($fh,0,',','"',''))!==false) {
            $rowNumber++;
            if(count($cells)!==count($hdr))throw new RuntimeException("Malformed row $rowNumber");
            $line=array_combine($hdr,$cells);
            foreach($keys as $k)if(trim($line[$k])==='')throw new RuntimeException("Empty $k row $rowNumber");
            // Only FY25-26 and FY26-27 FTP sales are authorised; FY24-25 stays in separate backfill.
            if ($spec['table']==='sales_data') {
                $d=DateTimeImmutable::createFromFormat('!d/m/Y',$line['date']);
                if(!$d||$d->format('d/m/Y')!==$line['date'] || $d < new DateTimeImmutable('2025-04-01'))
                    throw new RuntimeException("Unapproved sales date at row $rowNumber");
            }
            $key=json_encode(array_map(fn($k)=>$line[$k],$keys),JSON_THROW_ON_ERROR);
            $docs[$key][]=$line;
            if(count($docs[$key])>$maxLines)throw new RuntimeException('Document exceeds safe line threshold');
            $lines++;
            if($lines>$maxRows)throw new RuntimeException('File exceeds safe daily row threshold');
        }
        return [$docs,$lines];
    } finally {fclose($fh);}
}
function sendRpc(string $url,string $serviceKey,string $table,array $rows,string $exportStamp):void {
    $payload=json_encode(['p_table'=>$table,'p_rows'=>$rows,'p_export_stamp'=>$exportStamp],JSON_THROW_ON_ERROR|JSON_INVALID_UTF8_SUBSTITUTE);
    $c=curl_init($url);
    if(!$c)throw new RuntimeException('Could not initialize curl');
    curl_setopt_array($c,[CURLOPT_POST=>true,CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>15,CURLOPT_TIMEOUT=>120,
       CURLOPT_HTTPHEADER=>['apikey: '.$serviceKey,'Authorization: Bearer '.$serviceKey,'Content-Type: application/json'],
       CURLOPT_POSTFIELDS=>$payload]);
    $r=curl_exec($c);$code=curl_getinfo($c,CURLINFO_HTTP_CODE);$err=curl_error($c);curl_close($c);
    if ($r===false||$code<200||$code>=300)throw new RuntimeException('Supabase RPC HTTP '.$code.' '.substr((string)($r?:$err),0,250));
    $ack=json_decode((string)$r,true);
    if(!is_array($ack)||!in_array(($ack['status']??''),['committed','skipped_older','skipped_same'],true)||(int)($ack['incoming']??-1)!==count($rows))
        throw new RuntimeException('Unexpected RPC acknowledgement');
}
$files=[];
foreach(glob(rtrim($ftpRoot,'/').'/*.csv')?:[] as $path) {
    $base=basename($path);
    if($fileFilter!==null&&$fileFilter!==$base)continue;
    $info=fileMeta($base,$cfg);
    if($info===null)continue; // Do not touch unrelated files.
    if(isset($info['disabled'])){echo "DISABLED: $base (product batch identities need validation)\n";continue;}
    if($prefixFilter!==null&&$info['prefix']!==$prefixFilter)continue;
    if($info['stamp'] < $earliestSafeDate.'000000') continue; // Preserve historical exports outside automated recovery.
    $files[]=[$info['stamp'],$base,$path,$info['spec']];
}
usort($files,fn($a,$b)=>[$a[0],$a[1]]<=>[$b[0],$b[1]]);
if($fileFilter!==null && count($files)!==1){fwrite(STDERR,"Requested CSV not found or unsupported\n");exit(2);}
if(!$files){echo "No eligible unprocessed CSV files found\n";exit(0);}
// Never allow a later file to leapfrog an earlier unprocessed file during a manual APPLY.
if ($apply && $fileFilter!==null) {
    $earliest=null;
    foreach(glob(rtrim($ftpRoot,'/').'/*.csv')?:[] as $candidate) {
        $info=fileMeta(basename($candidate),$cfg);
        if($info===null||isset($info['disabled']))continue;
        if($info['stamp'] < $earliestSafeDate.'000000')continue; // legacy requires separate recovery
        if($earliest===null||$info['stamp']<$earliest['stamp'])$earliest=['stamp'=>$info['stamp'],'basename'=>basename($candidate)];
    }
    if($earliest!==null && $earliest['basename']!==$fileFilter) {
        fwrite(STDERR,"Out-of-order APPLY blocked: oldest pending eligible file is ".$earliest['basename']."\n");exit(2);
    }
}
$processed=0;$totalRows=0;
foreach($files as [$stamp,$basename,$path,$spec]) {
    if($processed>=$maxFiles)break;
    try {
        clearstatcache(true,$path);
        $before=stat($path);if($before===false)throw new RuntimeException('File disappeared');
        if($apply && $stamp < $earliestSafeDate.'000000')throw new RuntimeException('Pre-recovery historical export must be reconciled manually; not safe for unattended replay');
        if($apply && time()-(int)$before['mtime']<$stableSeconds)throw new RuntimeException('File too recently modified; may still be uploading');
        $digest=hash_file('sha256',$path);
        [$docs,$rowCount]=csvStage($path,$spec,$maxRowsPerDailyFile,$maxBytesPerDailyFile,$maxLinesPerDocument,$check);
        clearstatcache(true,$path);$after=stat($path);
        if($after===false||$before['size']!==$after['size']||$before['mtime']!==$after['mtime']||hash_file('sha256',$path)!==$digest)
            throw new RuntimeException('Source CSV changed while being read');
        echo ($apply?'APPLY ':'CHECK ').$basename.' rows='.$rowCount.' documents='.count($docs).' sha256='.$digest."\n";
        if ($apply) {
            // Every RPC is atomic; on interruption, replaying the SAME file is idempotent.
            // Stop entirely on first failure, so a later Vasy revision cannot be applied out of order.
            foreach($docs as $rows)sendRpc($endpoint,$secret,$spec['table'],$rows,$stamp);
            if(!rename($path,$path.'.processed'))throw new RuntimeException('All rows committed, but rename failed. Keep file for controlled retry.');
            echo "PROCESSED $basename\n";
        }
        $processed++;$totalRows+=$rowCount;
    } catch(Throwable $e) {
        fwrite(STDERR,"STOPPED $basename: ".$e->getMessage()."\n");
        exit(1);
    }
}
echo "SUCCESS files=$processed lines=$totalRows mode=".($apply?'APPLY':'CHECK')."\n";
