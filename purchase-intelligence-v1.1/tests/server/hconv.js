const vm=require('vm'),fs=require('fs');
let src=fs.readFileSync('harness.js','utf8');
src=src.replace("['Code.js','gc.js','LiveApi.js','ShipmentApi.js','BillApi.js']","['Code.js','gc.js','LiveApi.js','ShipmentApi.js','BillApi.js','ShipmentTools.js','ProductsApi.js']");
src=src.split('\n[ctx.v11SelfTest')[0];
src=src.replace("getSheetId(){return 1;}","getSheetId(){return 1;},getMaxColumns(){return 26;},insertColumnsAfter(){},clear(){this.data=[];},getDataRange(){const sh=this;return {getValues(){return sh.data.map(r=>r.slice());}};}");
src=src.replace("clearContent(){return rg;}","clearContent(){for(let i=0;i<nr;i++){const row=sh.data[r-1+i];if(row)for(let j=0;j<nc;j++)row[c-1+j]='';}while(sh.data.length&&sh.data[sh.data.length-1].every(x=>x===''||x==null))sh.data.pop();return rg;},getFormulas(){return rg.getValues().map(r=>r.map(()=>''));}");
eval(src+`
console.log('--- self-tests (with 2.6 changes) ---');
[ctx.v11SelfTest(),ctx.v11BillSelfTest()].forEach(o=>console.log(o.split('\\n').filter(l=>/FAIL|RESULT|STOP/.test(l)).join('\\n')));
`);
