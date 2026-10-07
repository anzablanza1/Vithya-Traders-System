const vm=require('vm'),fs=require('fs');
function mkSheet(name){const s={name,data:[],maxRows:1000,getLastRow(){return this.data.length;},getMaxRows(){return this.maxRows;},getLastColumn(){return Math.max(0,...this.data.map(r=>r.length));},
  getSheetId(){return 1;},getName(){return name;},setFrozenRows(){},deleteRow(r){this.data.splice(r-1,1);},appendRow(v){this.data.push(v.slice());},clearContents(){this.data=[];},
  getRange(r,c,nr,nc){nr=nr||1;nc=nc||1;const sh=this;const rg={getValues(){const o=[];for(let i=0;i<nr;i++){const row=sh.data[r-1+i]||[];const x=[];for(let j=0;j<nc;j++){const v=row[c-1+j];x.push(v===undefined?'':v);}o.push(x);}return o;},
    setValues(v){for(let i=0;i<nr;i++){while(sh.data.length<r+i)sh.data.push([]);const row=sh.data[r-1+i];for(let j=0;j<nc;j++)row[c-1+j]=v[i][j];}return rg;},
    setValue(v){return rg.setValues([[v]]);},getValue(){return rg.getValues()[0][0];},setFontWeight(){return rg;},setBackground(){return rg;},setFontColor(){return rg;},setNumberFormat(){return rg;},clearContent(){return rg;}};return rg;}};return s;}
const sheets={};const add=n=>(sheets[n]=mkSheet(n));const P={VT_API_TOKEN:'x'};
const ss={getSheetByName:n=>sheets[n]||null,insertSheet:add,getSheets:()=>Object.values(sheets),getId:()=>'1ojAFR5wv6tKt94CB0EwoEs14iCp7lPeRbnhBvjm6XX8',getName:()=>'mock',getSpreadsheetTimeZone:()=>'Asia/Kolkata'};
const ctx={SpreadsheetApp:{getActiveSpreadsheet:()=>ss,openById:()=>ss},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 Utilities:{formatDate:(d,tz,f)=>f==='yyyyMMdd'?d.toISOString().slice(0,10).replace(/-/g,''):d.toISOString().slice(0,16).replace('T',' ')},Logger:{log(){}},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>P[k]||null,setProperty:(k,v)=>{P[k]=v;}})},
 ContentService:{createTextOutput:t=>({setMimeType(){return t;}}),MimeType:{JSON:1}},console,Date,JSON,Math,Object,String,Number,isFinite,parseInt};
vm.createContext(ctx);['Code.js','gc.js','LiveApi.js','ShipmentApi.js','BillApi.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),ctx,{filename:f}));
ctx.setupLiveApi();add('PO Requests');add('Products');
const T=sheets['PO Tracking'];const tr=(po,lid,code,qty,st)=>T.data.push([new Date(),po+'|'+lid,lid,'PR-1',code,'n','GST',po,'',qty,st||'PO Created','','','','x','Sup','','']);
tr('PO-A','L1','111',50);tr('PO-A','L3','222/',20);tr('PO-B','L4','333',30);
sheets['Lots'].data.push(['lot1','PO-A','01','2026-09-01','','','','','','2026-09-05','','',new Date(),'x','','',0,0,'','']);
sheets['Lot Lines'].data.push(['lot1','PO-A',0,'111','n',20,'','',1,18,false,'','',2,'',new Date(),'x']);
[ctx.v11SelfTest(),ctx.v11BillSelfTest()].forEach(o=>console.log(o.split('\n').filter(l=>/FAIL|RESULT|STOP/.test(l)).join('\n')));
const H=(api,b)=>JSON.parse(ctx.handleApi_(api,{},Object.assign({token:'x'},b||{})));
console.log('ping',H('ping').v11,'| v11data keys',Object.keys(H('v11data')).join(','));
P.V11_LOT_LOCK='on';console.log('lock new lot:',H('lot',{lot:{lotId:'Lz',poNumber:'PO-A',lines:[]}}).locked,'| edit existing:',H('lot',{lot:{lotId:'lot1',poNumber:'PO-A',lotNo:'01',lines:[]}}).ok);
console.log('goods check ok:',Array.isArray(ctx.getGoodsCheck()),'| progress ok:',typeof ctx.getLineProgress());
