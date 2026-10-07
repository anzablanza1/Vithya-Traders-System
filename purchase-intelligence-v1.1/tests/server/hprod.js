const vm=require('vm'),fs=require('fs');
let src=fs.readFileSync('harness.js','utf8');
src=src.replace("['Code.js','gc.js','LiveApi.js','ShipmentApi.js','BillApi.js']","['Code.js','gc.js','LiveApi.js','ShipmentApi.js','BillApi.js','ProductsApi.js','RegisterApi.js']");
src=src.split('\n[ctx.v11SelfTest')[0];src=src.replace('getRange(r,c,nr,nc){','getRange(r,c,nr,nc){if(typeof r==="string"){const m=r.match(/([A-Z])(\\d+):([A-Z])(\\d+)/);c=m[1].charCodeAt(0)-64;nc=m[3].charCodeAt(0)-63-c;nr=+m[4]-+m[2]+1;r=+m[2];}');
// mock sheets: getMaxColumns, insertColumnsAfter, clear
src=src.replace("getSheetId(){return 1;}","getSheetId(){return 2046213878;},getMaxColumns(){return 26;},insertColumnsAfter(){},clear(){this.data=[];},getDataRange(){const sh=this;return {getValues(){return sh.data.map(r=>r.slice());}};}");
eval(src+`
P.VT_SB_KEY='k';P.V11_PRODUCTS_SB='on';
// master sheet = a tab named 'MASTER' returned by openById — reuse ss; put master data in first sheet? readMasterByCanon_ picks gid 2046213878 → all mock sheets share id, so first sheet is used.
const M=mkSheet('M');M.data=[['description','code no','brand','category','subcategory','no tax','mrp'],
 ['V4 BEARING TUFLON','BG04VTF','GEN','BEARING','V4',40,60],['V4 BEARING TUFLON /','BG04VTF/','GEN','BEARING','V4',38,58],
 ['OLD MASTER ONLY ITEM','OLD1','GEN','X','Y',10,15]];
ctx.SpreadsheetApp.openById=()=>({getSheets:()=>[M]});
const sku=[{parent_sku:'BG04VTF',product_name:'V4 BEARING TUFLON',category:'BEARING',sub_category:'V4 BRG',brand:'GENERAL',uom:'NOS',gst_item_code:'BG04VTF',nongst_item_code:'BG04VTF/'},
 {parent_sku:'NEW2',product_name:'SB ONLY /',category:'C',sub_category:'S',brand:'B',uom:null,gst_item_code:null,nongst_item_code:'NEW2/'}];
const erp=[{item_code:'BG04VTF',data:JSON.stringify({productName:'V4 BEARING TUFLON',mrp:70,sellingPrice:58.1,taxRate:18,measurement:'NUMBERS'})},
 {item_code:'BG04VTF/',data:JSON.stringify({productName:'V4 BEARING TUFLON /',mrp:59,sellingPrice:49,taxRate:0,measurement:'NUMBERS'})},
 {item_code:'NEW2/',data:JSON.stringify({productName:'SB ONLY /',mrp:12,sellingPrice:12,taxRate:0,measurement:'KILOGRAMS'})}];
let calls=0;ctx.UrlFetchApp={fetchAll:reqs=>reqs.map(r=>{calls++;const u=r.url;const off=+u.match(/offset=(\\d+)/)[1];const all=u.includes('sku_master')?sku:erp;
  return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(off?[]:all)};})};
console.log('synced',ctx.syncProducts(),'fetches',calls);
console.log(sheets['Products'].data.map(r=>r.join(' | ')).join('\\n'));
console.log(sheets['V1.1 Product Sync Report'].data.map(r=>r.filter(x=>x!==''&&x!=null).join(' | ')).join('\\n'));
console.log(JSON.stringify(ctx.getProducts()[0]));
add('Settings');ctx.UrlFetchApp={fetchAll:reqs=>reqs.map(()=>({getResponseCode:()=>500,getContentText:()=>'down'}))};
console.log('fallback synced',ctx.syncProducts(), sheets['Products'].data.length-1, sheets['V1.1 Product Sync Report'].data[3]);
`);
