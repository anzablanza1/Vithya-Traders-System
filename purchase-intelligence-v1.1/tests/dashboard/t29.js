const fs=require('fs');const src=fs.readFileSync('VT_Purchase_Intelligence_V1_1.html','utf8');
function grab(name){const i=src.indexOf('function '+name+'(');let d=0,j=src.indexOf('{',i);for(let k=j;k<src.length;k++){if(src[k]=='{')d++;else if(src[k]=='}'){d--;if(!d)return src.slice(i,k+1);}}}
const names=['sCompact','sRev','sTokens','sDimPhrase','sDimNorm','sWords','sChain','sMatch','sFuzzy','sFuzzyScore','sScore','sRun'];
eval('var SEARCH_FUZZY=false;'+names.map(grab).join('\n')+';global.sRun=sRun;');
const names2=['R3 H2 IMP&DIFF N 86 OD AP','R3 H1 IMP&DIFF 70 OD','BRF 10N IMP&DIFF N CUP TYPE NEW PP','BRF 10N (OLD KH) IMP&DIFF N PP','BRF 10 N NEW WITH RING PP /','BRF 12N IMP PP','V4 BOWL 262 REGULAR','ELBOW 20MM','BOWL 20','RH3 BEARING','PP ROPE 10MM'];
const list=names2.map((n,i)=>{const c=sCompact(n);return {t:n,c,r:sRev(c),raw:n,nameLen:n.length,code:'C'+i}});
for(const q of ['r3h','brf10npp','brf 10n','bowl 262','262 bowl','bow','r3 h2','brf10n','pp','elbow','rh3','brfpp','ab']) console.log(q.padEnd(10),'→',sRun(list,q,20).map(e=>e.t).join(' | '));
