const fs=require('fs');const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync('VT_Purchase_Intelligence_V1_1.html','utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,'');
const vc=new VirtualConsole();const errs=[];vc.on('jsdomError',e=>errs.push(String(e.message||e)));
const dom=new JSDOM(html,{runScripts:'dangerously',virtualConsole:vc,url:'https://x.test/'});
const w=dom.window;setTimeout(()=>{const ev=c=>w.eval(c);
 ev(`liveSync=async()=>{};document.getElementById('btn-ops').click()`);
 console.log('after entering:',ev(`[...document.querySelectorAll('#navgroups button')].map(b=>b.textContent+(b.classList.contains('active')?'*':'')).join(' | ')`),'| sub:',ev(`[...document.querySelectorAll('#subnav button')].map(b=>b.textContent+(b.classList.contains('active')?'*':'')).join(' | ')`));
 console.log('old buttons hidden:',ev(`getComputedStyle(document.getElementById('navold')).display`),'| mode chip:',ev(`document.getElementById('mode-chip').textContent`));
 console.log('errors',errs.slice(0,3));process.exit(0);},1500);
