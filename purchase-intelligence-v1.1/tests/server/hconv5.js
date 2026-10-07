const vm=require('vm'),fs=require('fs');
function mkSheet(name){const s={name,data:[],maxRows:1000,getLastRow(){return this.data.length;},getMaxRows(){return this.maxRows;},getLastColumn(){return Math.max(0,...this.data.map(r=>r.length));},
  getSheetId(){return 1;},getMaxColumns(){return 26;},insertColumnsAfter(){},clear(){this.data=[];},getDataRange(){const sh=this;return {getValues(){return sh.data.map(r=>r.slice());}};},getName(){return name;},setFrozenRows(){},deleteRow(r){this.data.splice(r-1,1);},appendRow(v){this.data.push(v.slice());},clearContents(){this.data=[];},
  getRange(r,c,nr,nc){nr=nr||1;nc=nc||1;const sh=this;const rg={getValues(){const o=[];for(let i=0;i<nr;i++){const row=sh.data[r-1+i]||[];const x=[];for(let j=0;j<nc;j++){const v=row[c-1+j];x.push(v===undefined?'':v);}o.push(x);}return o;},
    setValues(v){for(let i=0;i<nr;i++){while(sh.data.length<r+i)sh.data.push([]);const row=sh.data[r-1+i];for(let j=0;j<nc;j++)row[c-1+j]=v[i][j];}return rg;},
    setValue(v){return rg.setValues([[v]]);},getValue(){return rg.getValues()[0][0];},setFontWeight(){return rg;},setBackground(){return rg;},setFontColor(){return rg;},setNumberFormat(){return rg;},clearContent(){for(let i=0;i<nr;i++){const row=sh.data[r-1+i];if(row)for(let j=0;j<nc;j++)row[c-1+j]='';}while(sh.data.length&&sh.data[sh.data.length-1].every(x=>x===''||x==null))sh.data.pop();return rg;},getFormulas(){return rg.getValues().map(r=>r.map(()=>''));}};return rg;}};return s;}
const sheets={};const add=n=>(sheets[n]=mkSheet(n));const P={VT_API_TOKEN:'x'};
const ss={getSheetByName:n=>sheets[n]||null,insertSheet:add,getSheets:()=>Object.values(sheets),getId:()=>'1ojAFR5wv6tKt94CB0EwoEs14iCp7lPeRbnhBvjm6XX8',getName:()=>'mock',getSpreadsheetTimeZone:()=>'Asia/Kolkata'};
const ctx={SpreadsheetApp:{getActiveSpreadsheet:()=>ss,openById:()=>ss},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 Utilities:{formatDate:(d,tz,f)=>f==='yyyyMMdd'?d.toISOString().slice(0,10).replace(/-/g,''):d.toISOString().slice(0,16).replace('T',' ')},Logger:{log(){}},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>P[k]||null,setProperty:(k,v)=>{P[k]=v;}})},
 ContentService:{createTextOutput:t=>({setMimeType(){return t;}}),MimeType:{JSON:1}},console,Date,JSON,Math,Object,String,Number,isFinite,parseInt};
vm.createContext(ctx);['Code.js','gc.js','LiveApi.js','ShipmentApi.js','BillApi.js','ShipmentTools.js','ProductsApi.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),ctx,{filename:f}));
ctx.setupLiveApi();add('PO Requests');add('Products');
const T=sheets['PO Tracking'];const tr=(po,lid,code,qty,st)=>T.data.push([new Date(),po+'|'+lid,lid,'PR-1',code,'n','GST',po,'',qty,st||'PO Created','','','','x','Sup','','']);
tr('PO-A','L1','111',50);tr('PO-A','L3','222/',20);tr('PO-B','L4','333',30);
sheets['Lots'].data.push(['lot1','PO-A','01','2026-09-01','','','','','','2026-09-05','','',new Date(),'x','','',0,0,'','']);
sheets['Lot Lines'].data.push(['lot1','PO-A',0,'111','n',20,'','',1,18,false,'','',2,'',new Date(),'x']);
const L=sheets['Lots'],LL=sheets['Lot Lines'];
L.data.push(['lot2','PO-A','02','2026-09-10','VRL','LR9','GB-1','','2026-09-11','','2026-09-12','x',new Date(),'x','2026-09-15','VB-77',0.5,0,JSON.stringify([{name:'Freight',amt:100,gstPct:18,lane:'g'}]),'']);
LL.data.push(['lot2','PO-A',0,'111','n',15,10,5,12.5,18,false,80,70,0,'',new Date(),'x']);
LL.data.push(['lot2','PO-A',-1,'999','extra',3,null,null,4,18,false,'','',0,'not-in-PO',new Date(),'x']);
LL.data[0][13]=2; // lot1 line: return 2
L.data.push(['lot3','PO-Z','01','2026-09-01','','','','','','','','',new Date(),'x','','',0,0,'','']);
LL.data.push(['lot3','PO-Z',0,'555','n',4,'','',1,18,false,'','',0,'',new Date(),'x']);

// [a] code mismatch: PO-C tracked with temp code, lot has the real code
tr('PO-C','L9','tempcode1/',30);sheets['Products'].data=[['Canonical Code','Product Name'],['REAL1','Real product one'],['111','b']];
L.data.push(['lotC','PO-C','01','2026-09-20','','','','','','2026-09-21','','',new Date(),'x','','',0,0,'','']);
LL.data.push(['lotC','PO-C',0,'REAL1','Real product one',30,'','',5,18,false,'','',0,'',new Date(),'x']);
const q=()=>JSON.stringify(ctx.shpQtyByPoCode_());
const before=q();console.log('before',before);
console.log(ctx.v11LotConvertDryRun());
console.log(sheets['V1.1 Conversion Report'].data.slice(0,30).map(r=>r.filter(x=>x!=='').join(' | ')).join('\n'));
console.log(ctx.v11LotConvertApply());
const after=q();console.log('after ',after);console.log('tracking PO-C:',T.data.filter(r=>r[7]==='PO-C').map(r=>r[4]+' '+r[5]).join(','),'| prop:',P.V11_CONV_CODEFIX);
console.log('shipments',sheets['Shipments'].data.slice(1).map(r=>r.slice(0,8).join(',')).join(' ; '));
console.log('allocs',sheets['Shipment Allocations'].data.slice(1).map(r=>[r[1],r[2],r[3],r[4],r[7],r[13]].join(',')).join(' ; '));
console.log('bills',(sheets['Bills']||{data:[[]]}).data.slice(1).map(r=>[r[0],r[1],r[10],r[12],r[17],r[8]].join(',')).join(' ; '));
console.log('billLines',sheets['Bill Lines'].data.slice(1).map(r=>[r[1],r[3],r[7],r[8],r[9],r[14],r[15],r[16]].join(',')).join(' ; '));
const H=(api,b)=>JSON.parse(ctx.handleApi_(api,{},Object.assign({token:'x'},b||{})));
const D=H('data');console.log('apiData lots now:',D.lots.map(l=>l.lotId).join(','),'| lines:',D.lotLines.length);
console.log('edit converted lot:',H('lot',{lot:{lotId:'lot1',poNumber:'PO-A',lotNo:'01',lines:[]}}).error);
console.log('delete converted lot:',H('lotDelete',{lotId:'lot1'}).error);
console.log('second apply:',ctx.v11LotConvertApply());
console.log('goods check ok:',Array.isArray(ctx.getGoodsCheck()),'progress:',typeof ctx.getLineProgress());
// undo: bill was edited (by stays 'V1.1 conversion' since direct edit) -> undo all
console.log(ctx.v11LotUnconvert());
console.log('after undo',q()===before?'IDENTICAL to before ✔':q());
console.log('tracking after undo:',T.data.filter(r=>r[7]==='PO-C').map(r=>r[4]).join(','));console.log('lots back:',H('data').lots.map(l=>l.lotId).join(','));
console.log(ctx.v11SpeedCheck());console.log(sheets['V1.1 Speed Check'].data.slice(0,14).map(r=>r.join(' | ')).join('\n'));
