import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ACCESS_TOKEN = "<REDACTED_PRE_V2_TOKEN>";
const AS_OF = "2026-09-04";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const publishable = (() => {
  try { return JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}")["default"] || Deno.env.get("SUPABASE_ANON_KEY") || ""; }
  catch { return Deno.env.get("SUPABASE_ANON_KEY") || ""; }
})();

const num = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
const baseSku = (s: string) => (s || "").replace(/\/+$/, "").trim();

async function fetchPaged(table: string, select: string, filters: [string,string][]) {
  const out: any[] = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const q = new URLSearchParams();
    q.set("select", select);
    q.set("limit", String(limit));
    q.set("offset", String(offset));
    for (const [k,v] of filters) q.append(k,v);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${q}`, {
      headers: { apikey: publishable, Authorization: `Bearer ${publishable}` }
    });
    if (!r.ok) throw new Error(`${table} ${r.status}: ${await r.text()}`);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < limit) break;
    offset += limit;
  }
  return out;
}

function buildProducts(sales: any[], purchases: any[]) {
  const map = new Map<string, any>();
  const get = (sku: string, name = "", uom = "", category = "", subCategory = "") => {
    const k = baseSku(sku);
    if (!k) return null;
    if (!map.has(k)) map.set(k, {
      sku:k, name:(name||"").replace(/\s*\/\s*$/, "").replace(/&amp;/g,"&"),
      uom:uom||"", category:category||"", subCategory:subCategory||"",
      salesSkus:new Set<string>(), purchaseSkus:new Set<string>(), firstSale:null, lastSale:null,
      fy25:0, fy26:0, priorSame:0, six:0, three:0, prevThree:0,
      activeMonths:new Set<string>(), purchase:0, purchaseValue:0, lastPurchase:null
    });
    const p = map.get(k);
    if (!p.name && name) p.name = name;
    if (!p.uom && uom) p.uom = uom;
    if (!p.category && category) p.category = category;
    if (!p.subCategory && subCategory) p.subCategory = subCategory;
    return p;
  };

  for (const r of sales) {
    const p = get(r.item_code_base || r.item_code, r.product_name, "", r.category_name, r.sub_category_name);
    if (!p) continue;
    p.salesSkus.add(r.item_code);
    const d = r.sales_date, q = num(r.qty_num), ym = d?.slice(0,7);
    if (!p.firstSale || d < p.firstSale) p.firstSale = d;
    if (!p.lastSale || d > p.lastSale) p.lastSale = d;
    if (d >= "2025-04-01" && d <= "2026-03-31") p.fy25 += q;
    if (d >= "2026-04-01" && d <= AS_OF) p.fy26 += q;
    if (d >= "2025-04-01" && d <= "2025-09-04") p.priorSame += q;
    if (d >= "2026-03-01" && d <= "2026-08-31") { p.six += q; if (q > 0) p.activeMonths.add(ym); }
    if (d >= "2026-06-01" && d <= "2026-08-31") p.three += q;
    if (d >= "2026-03-01" && d <= "2026-05-31") p.prevThree += q;
  }

  for (const r of purchases) {
    const p = get(r.item_code_base || r.item_code, r.product_name, r.uom, r.category, r.sub_category);
    if (!p) continue;
    p.purchaseSkus.add(r.item_code);
    const q = num(r.qty_num) + num(r.free_qty_num);
    p.purchase += q;
    p.purchaseValue += num(r.total_amount_num);
    if (!p.lastPurchase || r.bill_dt > p.lastPurchase) p.lastPurchase = r.bill_dt;
  }

  return [...map.values()].filter(p => p.fy25 || p.fy26 || p.purchase).map(p => {
    const avg6 = p.six / 6, avg3 = p.three / 3;
    const daily = avg3 > avg6 ? (0.70*avg3 + 0.30*avg6)/30.4375 : (0.50*avg3 + 0.50*avg6)/30.4375;
    let trend = "Stable", arrow = "→";
    if (p.firstSale && p.firstSale >= "2026-06-01" && p.three > 0) { trend = "New Product"; arrow = "↑"; }
    else if (p.six === 0) trend = "Insufficient Data";
    else if (p.activeMonths.size <= 2) trend = "Irregular / Sporadic";
    else {
      const rr = p.prevThree === 0 ? (p.three > 0 ? 99 : 1) : p.three / p.prevThree;
      if (rr >= 1.50) { trend = "Rapidly Increasing"; arrow = "↑"; }
      else if (rr >= 1.15) { trend = "Increasing"; arrow = "↑"; }
      else if (rr < 0.50) { trend = "Rapidly Decreasing"; arrow = "↓"; }
      else if (rr < 0.85) { trend = "Decreasing"; arrow = "↓"; }
    }
    const daysSinceSale = p.lastSale ? Math.floor((new Date(AS_OF+"T00:00:00Z").getTime() - new Date(p.lastSale+"T00:00:00Z").getTime())/86400000) : null;
    return {...p, salesSkus:[...p.salesSkus], purchaseSkus:[...p.purchaseSkus], activeMonths:p.activeMonths.size, avg6, avg3, daily, trend, arrow, daysSinceSale};
  }).sort((a,b) => b.fy26-a.fy26 || b.six-a.six || a.sku.localeCompare(b.sku));
}

function page(products:any[]) {
  const data = JSON.stringify(products).replace(/</g,"\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PP Purchase Planning List</title><style>
  :root{--bg:#f6f7f9;--card:#fff;--ink:#16181c;--mut:#6b7280;--line:#e5e7eb;--gold:#9a6f0b;--green:#177245;--red:#b42318}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}.wrap{max-width:1200px;margin:auto;padding:12px}.top{position:sticky;top:0;z-index:20;background:rgba(246,247,249,.97);backdrop-filter:blur(10px);padding:4px 0 10px}.title{display:flex;justify-content:space-between;gap:12px}.title h1{font-size:19px;margin:0}.sub{font-size:11px;color:var(--mut);margin-top:4px}.badge{display:inline-block;background:#fff1c7;color:#745500;font-size:10px;font-weight:850;border-radius:999px;padding:5px 8px;height:max-content}.searchbox{position:relative;margin-top:12px}.searchbox input{width:100%;border:1px solid var(--line);background:#fff;border-radius:12px;padding:14px;font-size:15px;outline:none}.suggest{display:none;position:absolute;left:0;right:0;top:50px;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 15px 35px rgba(0,0,0,.14);max-height:330px;overflow:auto}.srow{padding:10px 12px;border-bottom:1px solid var(--line);cursor:pointer}.srow b{font-size:11px}.srow span{display:block;font-size:10px;color:var(--mut);margin-top:2px}.controls{display:grid;grid-template-columns:1.4fr 1fr repeat(3,.7fr);gap:8px;margin-top:8px}.ctl{background:#fff;border:1px solid var(--line);border-radius:10px;padding:7px 9px}.ctl label{display:block;font-size:8px;color:var(--mut);font-weight:850;text-transform:uppercase}.ctl select,.ctl input{width:100%;border:0;background:transparent;outline:0;font:inherit}.summary{font-size:10px;color:var(--mut);padding:8px 2px 0}.note{background:#fff8e6;border:1px solid #ecd28f;border-radius:11px;padding:10px;font-size:10px;margin:2px 0 10px}.list{display:grid;gap:9px}.card{background:#fff;border:1px solid var(--line);border-radius:13px;padding:12px}.head{display:flex;justify-content:space-between;gap:10px}.sku{font-size:12px;font-weight:900}.name{font-size:12px;margin-top:3px}.meta{font-size:9px;color:var(--mut);margin-top:4px}.pill{font-size:9px;font-weight:850;border-radius:999px;padding:4px 7px;background:#eef2f6;white-space:nowrap}.pill.up{background:#e8f7ee;color:var(--green)}.pill.down{background:#fdecec;color:var(--red)}.metrics{display:grid;grid-template-columns:repeat(7,1fr);gap:7px;margin-top:10px}.m{background:#fafafa;border-radius:9px;padding:8px;min-width:0}.m b{display:block;font-size:14px}.m span{font-size:8px;color:var(--mut);text-transform:uppercase}.m.target{background:#fffaf0;border:1px solid #e5cf91}.m.target b{color:#6d5100}.toggle{border:0;background:none;color:var(--gold);font-weight:850;font-size:10px;padding:8px 0 0}.extra{display:none;border-top:1px solid var(--line);padding-top:9px;margin-top:9px;font-size:10px;line-height:1.55}.card.open .extra{display:block}
  @media(max-width:760px){.title{display:block}.badge{margin-top:6px}.controls{grid-template-columns:1fr 1fr}.controls .wide{grid-column:1/-1}.metrics{grid-template-columns:repeat(2,1fr)}.wrap{padding:9px}}
  </style></head><body><div class="wrap"><div class="top"><div class="title"><div><h1>PP Purchase Planning — Full List</h1><div class="sub">134 normalized PP products • data through ${AS_OF} • GST/non-GST combined</div></div><span class="badge">No stock assumptions</span></div><div class="searchbox"><input id="q" autocomplete="off" placeholder="Search product, SKU, series, size or number…"><div id="suggest" class="suggest"></div></div><div class="controls"><div class="ctl wide"><label>View</label><select id="view"><option value="all">All products</option><option value="active">FY26 sales only</option><option value="nopur">FY26 sales + no FY26 purchase</option><option value="slow">No sale > 60 days</option></select></div><div class="ctl"><label>Category</label><select id="cat"><option value="">All categories</option></select></div><div class="ctl"><label>Lead days</label><input id="lead" type="number" value="30" min="0"></div><div class="ctl"><label>Safety days</label><input id="safety" type="number" value="15" min="0"></div><div class="ctl"><label>Coverage days</label><input id="coverage" type="number" value="30" min="0"></div></div><div id="summary" class="summary"></div></div><div class="note"><strong>Stock is ignored.</strong> Gross target = demand requirement only. ERP stock and ledger-estimated stock are not used.</div><div id="list" class="list"></div></div><script>
  const P=${data};
  const nf=new Intl.NumberFormat('en-IN',{maximumFractionDigits:1});
  const q=document.getElementById('q'), sug=document.getElementById('suggest'), list=document.getElementById('list'), view=document.getElementById('view'), cat=document.getElementById('cat'), lead=document.getElementById('lead'), safety=document.getElementById('safety'), coverage=document.getElementById('coverage');
  const norm=s=>String(s||'').toLowerCase().replace(/\s+/g,'');
  [...new Set(P.map(p=>p.category).filter(Boolean))].sort().forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;cat.appendChild(o)});
  const hay=p=>norm(p.sku+' '+p.name+' '+p.salesSkus.join(' ')+' '+p.purchaseSkus.join(' '));
  function filtered(){const z=norm(q.value);return P.filter(p=>{if(z&&!hay(p).includes(z))return false;if(cat.value&&p.category!==cat.value)return false;if(view.value==='active'&&p.fy26<=0)return false;if(view.value==='nopur'&&!(p.fy26>0&&p.purchase===0))return false;if(view.value==='slow'&&!(p.daysSinceSale!==null&&p.daysSinceSale>60))return false;return true})}
  function pill(p){const c=p.arrow==='↑'?'up':p.arrow==='↓'?'down':'';return '<span class="pill '+c+'">'+p.arrow+' '+p.trend+'</span>'}
  function render(){const a=filtered(),L=+lead.value||0,S=+safety.value||0,C=+coverage.value||0;document.getElementById('summary').textContent=a.length+' products shown of '+P.length;list.innerHTML=a.map((p,i)=>{const target=p.daily*(L+S+C),yoy=p.priorSame?((p.fy26/p.priorSame-1)*100):null,ratio=p.fy26?p.purchase/p.fy26:null;return '<div class="card"><div class="head"><div><div class="sku">'+p.sku+'</div><div class="name">'+p.name+'</div><div class="meta">'+(p.category||'—')+(p.subCategory?' • '+p.subCategory:'')+' • Last sale '+(p.lastSale||'—')+'</div></div>'+pill(p)+'</div><div class="metrics"><div class="m"><b>'+nf.format(p.fy26)+'</b><span>FY26 YTD sales</span></div><div class="m"><b>'+nf.format(p.fy25)+'</b><span>FY25 sales</span></div><div class="m"><b>'+nf.format(p.avg6)+'</b><span>6M avg/mo</span></div><div class="m"><b>'+nf.format(p.avg3)+'</b><span>3M avg/mo</span></div><div class="m"><b>'+nf.format(p.purchase)+'</b><span>FY26 purchase</span></div><div class="m"><b>'+(yoy===null?'—':(yoy>=0?'+':'')+yoy.toFixed(0)+'%')+'</b><span>YoY same period</span></div><div class="m target"><b>'+nf.format(target)+'</b><span>Gross target</span></div></div><button class="toggle" onclick="this.closest(\'.card\').classList.toggle(\'open\')">Show details</button><div class="extra"><strong>Sales SKUs:</strong> '+(p.salesSkus.join(', ')||'—')+'<br><strong>Purchase SKUs:</strong> '+(p.purchaseSkus.join(', ')||'—')+'<br><strong>6M sales:</strong> '+nf.format(p.six)+' | <strong>3M sales:</strong> '+nf.format(p.three)+' | <strong>Previous 3M:</strong> '+nf.format(p.prevThree)+'<br><strong>Planning daily demand:</strong> '+nf.format(p.daily)+' | <strong>Purchase / sales:</strong> '+(ratio===null?'—':ratio.toFixed(2)+'×')+'<br><strong>Last purchase:</strong> '+(p.lastPurchase||'—')+' | <strong>Days since last sale:</strong> '+(p.daysSinceSale??'—')+'<br><strong>Current formula:</strong> '+nf.format(p.daily)+' × ('+L+' lead + '+S+' safety + '+C+' coverage) = <strong>'+nf.format(target)+' units</strong>.</div></div>'}).join('')}
  function showSuggest(){const z=norm(q.value);if(!z){sug.style.display='none';return}const a=P.filter(p=>hay(p).includes(z)).slice(0,12);sug.innerHTML=a.map(p=>'<div class="srow" data-sku="'+p.sku+'"><b>'+p.sku+'</b><span>'+p.name+'</span></div>').join('');sug.style.display=a.length?'block':'none';sug.querySelectorAll('.srow').forEach(el=>el.onclick=()=>{q.value=el.dataset.sku;sug.style.display='none';render()})}
  q.addEventListener('input',()=>{showSuggest();render()});[view,cat,lead,safety,coverage].forEach(el=>el.addEventListener('input',render));document.addEventListener('click',e=>{if(!e.target.closest('.searchbox'))sug.style.display='none'});render();
  </script></body></html>`;
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("k") !== ACCESS_TOKEN) return new Response("Not found", {status:404});
    const [sales,purchases] = await Promise.all([
      fetchPaged("v_sales_all", "sales_date,item_code,item_code_base,product_name,category_name,sub_category_name,qty_num", [["brand_name","eq.PP"],["sales_date","gte.2025-04-01"],["sales_date","lte.2026-09-04"],["order","sales_date.asc"]]),
      fetchPaged("v_purchase", "bill_dt,item_code,item_code_base,product_name,category,sub_category,uom,qty_num,free_qty_num,total_amount_num", [["brand","eq.PP"],["bill_dt","gte.2026-04-01"],["bill_dt","lte.2026-09-04"],["order","bill_dt.asc"]])
    ]);
    const products = buildProducts(sales,purchases);
    return new Response(page(products), {headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
  } catch (e) {
    return new Response(`Dashboard error: ${e instanceof Error ? e.message : String(e)}`, {status:500,headers:{"content-type":"text/plain"}});
  }
});