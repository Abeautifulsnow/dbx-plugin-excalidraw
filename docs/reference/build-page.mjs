import fs from 'node:fs'
import path from 'node:path'

const SRC = 'docs/reference/dbx-plugin-capabilities.md'
const OUT = 'docs/reference/dbx-plugin-capabilities.html'

let marked
try {
  ;({ marked } = await import('file:///E:/work/git/github/dbx/node_modules/marked/lib/marked.esm.js'))
} catch (e) {
  const m = await import('E:/work/git/github/dbx/node_modules/marked')
  marked = m.marked
}

const raw = fs.readFileSync(SRC, 'utf8')

// Split off the generated header (H1 + meta blockquote) so the page can own its masthead.
const lines = raw.split('\n')
let body = raw
const h1 = lines.findIndex((l) => l.startsWith('# '))
if (h1 === 0) {
  let i = 1
  while (i < lines.length && (lines[i].trim() === '' || lines[i].startsWith('>'))) i++
  body = lines.slice(i).join('\n')
}

let html = marked.parse(body, { gfm: true, breaks: false })

// --- table wrappers -------------------------------------------------------
html = html.replace(/<table>/g, '<div class="tw"><table>').replace(/<\/table>/g, '</table></div>')

// --- heading ids + table of contents -------------------------------------
const toc = []
let h2n = 0
let h3n = 0
let last = null
html = html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_all, depth, inner) => {
  const text = inner.replace(/<[^>]+>/g, '').trim()
  const id = depth === '2' ? `s${++h2n}` : `s${h2n}-${++h3n}`
  if (depth === '2') toc.push({ id, text, children: [] })
  else if (last) last.children.push({ id, text })
  last = depth === '2' ? toc[toc.length - 1] : last
  return `<h${depth} id="${id}">${inner}<a class="anchor" href="#${id}" aria-label="链接到此节">#</a></h${depth}>`
})

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const tocHtml = toc
  .map(
    (s, i) => `<details class="tocsec"${i === 0 ? ' open' : ''} data-id="${s.id}">
<summary><span class="tocnum">${String(i + 1).padStart(2, '0')}</span><span class="toctext">${esc(s.text.replace(/^\d+\.\s*/, ''))}</span></summary>
${s.children.length ? `<ul>${s.children.map((c) => `<li><a href="#${c.id}">${esc(c.text)}</a></li>`).join('')}</ul>` : ''}
</details>`,
  )
  .join('\n')

const stats = [
  ['609', '已核验条目'],
  ['9', '勘察维度'],
  ['5', '贡献点类型'],
  ['54', '跨维度矛盾'],
  ['0', '被证伪剔除'],
]

const page = `<title>DBX 插件能力与事件全谱</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Noto+Sans+SC:wght@400;500;700&family=Noto+Serif+SC:wght@600;700&display=swap">
<style>
*,*::before,*::after{box-sizing:border-box}

:root{
  --bg:#F5F7F9; --surface:#FFFFFF; --surface-2:#EEF1F4; --code-bg:#EDF0F3;
  --ink:#14181F; --ink-2:#4C5563; --ink-3:#79828F;
  --line:#DFE4EA; --line-2:#C9D1DA;
  --accent:#0E7C86; --accent-soft:#E0F0F1; --accent-ink:#0A5B62;
  --warn:#9A5A08; --warn-soft:#FAEEDC;
  --danger:#A83A2C; --danger-soft:#FAE7E4;
  --mark:#FCE68A; --mark-ink:#3A2E05;
  --shadow:0 1px 2px rgba(16,22,30,.05), 0 6px 18px -10px rgba(16,22,30,.18);
  color-scheme:light;
  --sans:"Noto Sans SC",-apple-system,"Segoe UI",system-ui,"Microsoft YaHei",sans-serif;
  --serif:"Noto Serif SC",Georgia,"Songti SC",serif;
  --mono:"IBM Plex Mono",ui-monospace,"Cascadia Mono",Consolas,"Noto Sans SC",monospace;
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --bg:#0D1015; --surface:#141922; --surface-2:#1B212B; --code-bg:#1B212B;
    --ink:#E2E7EE; --ink-2:#A4AEBE; --ink-3:#78828F;
    --line:#242B36; --line-2:#333C49;
    --accent:#3FC4CE; --accent-soft:#10333A; --accent-ink:#7FDCE4;
    --warn:#DFA455; --warn-soft:#33260F;
    --danger:#E68C81; --danger-soft:#361C18;
    --mark:#6B5A12; --mark-ink:#FAF0C8;
    --shadow:0 1px 2px rgba(0,0,0,.4), 0 8px 22px -12px rgba(0,0,0,.7);
    color-scheme:dark;
  }
}
:root[data-theme="dark"]{
  --bg:#0D1015; --surface:#141922; --surface-2:#1B212B; --code-bg:#1B212B;
  --ink:#E2E7EE; --ink-2:#A4AEBE; --ink-3:#78828F;
  --line:#242B36; --line-2:#333C49;
  --accent:#3FC4CE; --accent-soft:#10333A; --accent-ink:#7FDCE4;
  --warn:#DFA455; --warn-soft:#33260F;
  --danger:#E68C81; --danger-soft:#361C18;
  --mark:#6B5A12; --mark-ink:#FAF0C8;
  --shadow:0 1px 2px rgba(0,0,0,.4), 0 8px 22px -12px rgba(0,0,0,.7);
    color-scheme:dark;
}

html{scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{animation:none!important;transition:none!important}}
body{
  margin:0; background:var(--bg); color:var(--ink);
  font-family:var(--sans); font-size:15px; line-height:1.72;
  -webkit-font-smoothing:antialiased;
  padding-block:0; padding-inline:0;
}

.shell{display:grid; grid-template-columns:296px minmax(0,1fr); gap:0; align-items:start}

/* ---------- sidebar ---------- */
.side{
  position:sticky; top:0; height:100vh; overflow-y:auto; overscroll-behavior:contain;
  background:var(--surface); border-right:1px solid var(--line);
  padding:22px 16px 40px;
}
.side::-webkit-scrollbar{width:9px}
.side::-webkit-scrollbar-thumb{background:var(--line-2); border-radius:9px; border:3px solid var(--surface)}
.brand{display:flex; flex-direction:column; gap:3px; margin-bottom:20px; padding-inline:6px}
.brand b{font-family:var(--serif); font-weight:700; font-size:17px; letter-spacing:-.01em; line-height:1.3}
.brand span{font-family:var(--mono); font-size:10.5px; letter-spacing:.09em; text-transform:uppercase; color:var(--ink-3)}
.tocsec{border-top:1px solid var(--line)}
.tocsec:last-of-type{border-bottom:1px solid var(--line)}
.tocsec>summary{
  display:flex; gap:9px; align-items:baseline; cursor:pointer; list-style:none;
  padding:8px 6px; border-radius:6px; color:var(--ink-2); font-size:13.5px; line-height:1.45;
}
.tocsec>summary::-webkit-details-marker{display:none}
.tocsec>summary:hover{background:var(--surface-2); color:var(--ink)}
.tocsec.active>summary{color:var(--accent-ink); font-weight:500}
.tocsec.active>summary .tocnum{color:var(--accent)}
.tocnum{font-family:var(--mono); font-size:10.5px; color:var(--ink-3); flex:0 0 auto; padding-top:2px; font-variant-numeric:tabular-nums}
.toctext{min-width:0}
.tocsec ul{list-style:none; margin:2px 0 10px; padding:0 0 0 25px; display:flex; flex-direction:column; gap:1px}
.tocsec ul a{
  display:block; padding:4px 6px; border-radius:6px; font-size:12.5px; color:var(--ink-3);
  text-decoration:none; line-height:1.5;
}
.tocsec ul a:hover{background:var(--surface-2); color:var(--ink)}
.tocsec ul a.active{color:var(--accent-ink); background:var(--accent-soft)}

/* ---------- main ---------- */
.main{min-width:0; padding:0 clamp(16px,4vw,56px) 96px}
.masthead{padding:52px 0 26px; border-bottom:1px solid var(--line); margin-bottom:26px; max-width:960px}
.eyebrow{font-family:var(--mono); font-size:11px; letter-spacing:.13em; text-transform:uppercase; color:var(--accent); margin:0 0 14px}
.masthead h1{
  font-family:var(--serif); font-weight:700; margin:0 0 14px;
  font-size:clamp(28px,4.4vw,44px); line-height:1.18; letter-spacing:-.015em; text-wrap:balance;
}
.lede{margin:0 0 22px; color:var(--ink-2); font-size:15.5px; max-width:64ch}
.metaline{
  font-family:var(--mono); font-size:12px; color:var(--ink-3);
  display:flex; flex-wrap:wrap; gap:6px 14px; margin-bottom:26px;
}
.metaline b{color:var(--ink-2); font-weight:500}

.stats{display:flex; flex-wrap:wrap; gap:0; border:1px solid var(--line); border-radius:10px; overflow:hidden; background:var(--surface)}
.stat{flex:1 1 122px; padding:13px 16px; border-right:1px solid var(--line)}
.stat:last-child{border-right:0}
.stat b{display:block; font-family:var(--mono); font-size:22px; font-weight:600; line-height:1.15; font-variant-numeric:tabular-nums; color:var(--accent-ink)}
.stat span{display:block; font-size:11.5px; color:var(--ink-3); margin-top:3px; letter-spacing:.02em}

/* ---------- search bar ---------- */
.toolbar{
  position:sticky; top:0; z-index:20; display:flex; align-items:center; gap:12px; flex-wrap:wrap;
  padding:11px 0; margin-bottom:8px;
  background:linear-gradient(var(--bg) 72%, transparent);
}
.searchbox{position:relative; flex:1 1 260px; max-width:420px}
.searchbox svg{position:absolute; left:11px; top:50%; transform:translateY(-50%); color:var(--ink-3); pointer-events:none}
#q{
  width:100%; font-family:var(--sans); font-size:14px; color:var(--ink);
  background:var(--surface); border:1px solid var(--line-2); border-radius:8px;
  padding:9px 74px 9px 34px; outline:none;
}
#q:focus{border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-soft)}
#q::placeholder{color:var(--ink-3)}
.hitcount{
  position:absolute; right:9px; top:50%; transform:translateY(-50%);
  font-family:var(--mono); font-size:11px; color:var(--ink-3); font-variant-numeric:tabular-nums;
  display:flex; align-items:center; gap:6px;
}
.hitcount .nav{
  border:1px solid var(--line-2); background:var(--surface-2); color:var(--ink-2);
  border-radius:5px; width:22px; height:22px; cursor:pointer; line-height:1; padding:0; font-size:11px;
}
.hitcount .nav:hover{border-color:var(--accent); color:var(--accent-ink)}
.hint{font-size:12px; color:var(--ink-3)}
.hint kbd{
  font-family:var(--mono); font-size:10.5px; background:var(--surface-2); border:1px solid var(--line);
  border-bottom-width:2px; border-radius:4px; padding:1px 5px; color:var(--ink-2);
}

/* ---------- document body ---------- */
#doc{max-width:1060px}
#doc h2{
  font-family:var(--serif); font-weight:700; font-size:25px; line-height:1.3; letter-spacing:-.012em;
  margin:0 0 20px; padding:34px 0 12px; border-bottom:2px solid var(--line-2);
  text-wrap:balance; scroll-margin-top:64px;
}
#doc h3{
  font-family:var(--sans); font-weight:700; font-size:16px; line-height:1.45; color:var(--ink);
  margin:30px 0 12px; padding-left:11px; border-left:3px solid var(--accent);
  scroll-margin-top:64px; text-wrap:balance;
}
#doc h4{font-family:var(--sans); font-weight:700; font-size:14.5px; margin:22px 0 10px; color:var(--ink)}
.anchor{
  font-family:var(--mono); font-size:.6em; color:var(--line-2); text-decoration:none;
  margin-left:.5em; opacity:0; transition:opacity .12s; vertical-align:middle;
}
h2:hover .anchor,h3:hover .anchor{opacity:1}
.anchor:hover{color:var(--accent)}

#doc p{margin:0 0 14px; color:var(--ink-2)}
#doc strong{color:var(--ink); font-weight:700}
#doc ul,#doc ol{margin:0 0 16px; padding-left:22px; color:var(--ink-2)}
#doc li{margin:3px 0}
#doc li::marker{color:var(--ink-3)}
#doc hr{border:0; border-top:1px solid var(--line); margin:34px 0}
#doc blockquote{
  margin:0 0 18px; padding:12px 18px; border-left:3px solid var(--accent);
  background:var(--accent-soft); border-radius:0 8px 8px 0; color:var(--ink-2);
}
#doc blockquote p:last-child{margin-bottom:0}
#doc a{color:var(--accent-ink); text-underline-offset:2px}

#doc code{
  font-family:var(--mono); font-size:.855em; background:var(--code-bg); color:var(--ink);
  padding:.1em .38em; border-radius:4px; word-break:break-word;
}
#doc pre{
  background:var(--surface); border:1px solid var(--line); border-radius:9px;
  padding:14px 16px; overflow-x:auto; margin:0 0 18px; box-shadow:var(--shadow);
}
#doc pre code{background:none; padding:0; font-size:12.5px; line-height:1.62; color:var(--ink-2)}

/* tables: the bulk of this document */
.tw{
  overflow-x:auto; margin:0 0 22px; border:1px solid var(--line);
  border-radius:9px; background:var(--surface); box-shadow:var(--shadow);
}
#doc table{border-collapse:collapse; width:100%; font-size:13.2px; line-height:1.6}
#doc thead th{
  background:var(--surface-2); text-align:left; font-weight:700; font-size:11.5px;
  letter-spacing:.045em; color:var(--ink-2); white-space:nowrap;
  padding:9px 13px; border-bottom:1px solid var(--line-2);
}
#doc tbody td{padding:9px 13px; border-bottom:1px solid var(--line); color:var(--ink-2); vertical-align:top}
#doc tbody tr:last-child td{border-bottom:0}
#doc tbody tr:nth-child(even){background:color-mix(in srgb, var(--surface-2) 42%, transparent)}
#doc tbody tr:hover{background:var(--accent-soft)}
#doc td:first-child{color:var(--ink); font-weight:500}
#doc td code{font-size:12.4px}
#doc td, #doc th{overflow-wrap:anywhere}

mark.hit{background:var(--mark); color:var(--mark-ink); border-radius:3px; padding:0 2px}
mark.hit.cur{background:var(--accent); color:var(--surface); outline:2px solid var(--accent); outline-offset:1px}
mark.hitmark-off{background:none}

/* ---------- footer ---------- */
.foot{
  max-width:1060px; margin-top:56px; padding-top:20px; border-top:1px solid var(--line);
  font-family:var(--mono); font-size:11.5px; color:var(--ink-3); line-height:1.9;
}

/* ---------- mobile ---------- */
.mobtoggle{display:none}
@media (max-width:980px){
  .shell{grid-template-columns:minmax(0,1fr)}
  .side{position:static; height:auto; max-height:none; border-right:0; border-bottom:1px solid var(--line); padding-bottom:18px}
  .side.collapsed .tocsec{display:none}
  .side.collapsed .brand{margin-bottom:0}
  .mobtoggle{
    display:block; width:100%; text-align:left; font-family:var(--mono); font-size:11px;
    letter-spacing:.09em; text-transform:uppercase; color:var(--accent);
    background:none; border:0; border-top:1px solid var(--line); padding:10px 6px; cursor:pointer; margin-top:8px;
  }
  .main{padding-bottom:64px}
  .masthead{padding-top:30px}
  .toolbar{position:static; background:none; padding-bottom:14px}
  .hint{display:none}
}
@media (max-width:560px){
  .stat{flex-basis:50%; border-bottom:1px solid var(--line)}
  .stat:nth-child(2n){border-right:0}
  .stats{border-radius:9px}
}
</style>

<div class="shell">
  <aside class="side" id="side">
    <div class="brand">
      <b>DBX 插件能力与事件全谱</b>
      <span>audit · host api 1.2.0</span>
    </div>
    <button class="mobtoggle" id="mobtoggle" type="button" aria-expanded="true">目录</button>
    <nav aria-label="目录">
${tocHtml}
    </nav>
  </aside>

  <main class="main">
    <header class="masthead">
      <p class="eyebrow">DBX Plugin System</p>
      <h1>DBX 插件能力与事件全谱</h1>
      <p class="lede">DBX 宿主向插件露出的全部面：清单贡献点、<code>window.dbxPlugin</code> 前端 API、宿主↔sidecar 的 JSON-RPC 协议、事件通道、权限闸门、SDK 工具链，以及各处尺寸与版本门槛。每一条都带 <code>file:line</code> 锚点。</p>
      <div class="metaline">
        <span><b>host_api</b> 1.2.0</span>
        <span><b>protocol_version</b> 1</span>
        <span><b>manifest_version</b> 1</span>
        <span><b>方法</b> 8 维并行勘察 + 对抗式校验</span>
      </div>
      <div class="stats">
        ${stats.map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('\n        ')}
      </div>
    </header>

    <div class="toolbar">
      <div class="searchbox">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>
        <input id="q" type="search" placeholder="搜索方法、权限、常量、事件…" autocomplete="off" spellcheck="false" aria-label="搜索文档">
        <span class="hitcount" id="hc"></span>
      </div>
      <p class="hint"><kbd>Enter</kbd> 下一个 · <kbd>Shift</kbd>+<kbd>Enter</kbd> 上一个</p>
    </div>

    <article id="doc">
${html}
    </article>

    <footer class="foot">
      生成方式：8 个维度并行勘察 → 每维度一个对抗式校验 agent 回到 <code>file:line</code> 逐条证伪 → 分章节撰写。<br>
      条目数 609 · 被证伪剔除 0 · 校验更正 4 · 跨维度矛盾 54 · 未覆盖缺口已补（第 12 节）。
    </footer>
  </main>
</div>

<script>
(function(){
  var doc = document.getElementById('doc');
  var q = document.getElementById('q');
  var hc = document.getElementById('hc');
  var hits = [], cur = -1, timer = null, MAXHITS = 4000;

  function clearHits(){
    var marks = doc.querySelectorAll('mark.hit');
    for (var i=0;i<marks.length;i++){
      var m = marks[i], p = m.parentNode;
      p.replaceChild(document.createTextNode(m.textContent), m);
      p.normalize();
    }
    hits = []; cur = -1;
  }

  function mark(term){
    var needle = term.toLowerCase();
    var walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT, {
      acceptNode: function(n){
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        var p = n.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        var tag = p.nodeName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'MARK') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    for (var i=0;i<nodes.length && hits.length<MAXHITS;i++){
      var node = nodes[i];
      var hay = node.nodeValue.toLowerCase();
      var from = 0, idx;
      var frag = null;
      while ((idx = hay.indexOf(needle, from)) !== -1){
        if (!frag) frag = document.createDocumentFragment();
        if (idx > from) frag.appendChild(document.createTextNode(node.nodeValue.slice(from, idx)));
        var mk = document.createElement('mark');
        mk.className = 'hit';
        mk.textContent = node.nodeValue.slice(idx, idx + needle.length);
        frag.appendChild(mk);
        hits.push(mk);
        from = idx + needle.length;
        if (hits.length >= MAXHITS) break;
      }
      if (frag){
        if (from < node.nodeValue.length) frag.appendChild(document.createTextNode(node.nodeValue.slice(from)));
        node.parentNode.replaceChild(frag, node);
      }
    }
  }

  function focusHit(i){
    if (!hits.length) return;
    if (cur >= 0 && hits[cur]) hits[cur].classList.remove('cur');
    cur = (i + hits.length) % hits.length;
    hits[cur].classList.add('cur');
    hits[cur].scrollIntoView({block:'center', behavior:'smooth'});
    hc.textContent = (cur+1) + '/' + hits.length;
  }

  function render(){
    var term = q.value.trim();
    clearHits();
    if (!term){ hc.innerHTML = ''; return; }
    mark(term);
    if (!hits.length){ hc.textContent = '无匹配'; return; }
    var label = document.createElement('span');
    label.textContent = '1/' + hits.length;
    var up = document.createElement('button'); up.type='button'; up.className='nav'; up.textContent='↑'; up.setAttribute('aria-label','上一个匹配');
    var dn = document.createElement('button'); dn.type='button'; dn.className='nav'; dn.textContent='↓'; dn.setAttribute('aria-label','下一个匹配');
    up.addEventListener('click', function(){ focusHit(cur-1); });
    dn.addEventListener('click', function(){ focusHit(cur+1); });
    var total = document.createElement('span'); total.textContent = hits.length;
    hc.innerHTML = '';
    hc.appendChild(up); hc.appendChild(dn); hc.appendChild(total);
    focusHit(0);
  }

  q.addEventListener('input', function(){
    clearTimeout(timer);
    timer = setTimeout(render, 180);
  });
  q.addEventListener('keydown', function(e){
    if (e.key === 'Enter'){
      e.preventDefault();
      if (!hits.length && q.value.trim()){ clearTimeout(timer); render(); return; }
      focusHit(e.shiftKey ? cur-1 : cur+1);
    } else if (e.key === 'Escape'){ q.value=''; clearHits(); hc.innerHTML=''; }
  });
  document.addEventListener('keydown', function(e){
    if ((e.ctrlKey||e.metaKey) && e.key === 'k'){ e.preventDefault(); q.focus(); q.select(); }
  });

  // --- scroll spy ---------------------------------------------------------
  var secs = [].slice.call(document.querySelectorAll('.tocsec'));
  var byId = {};
  secs.forEach(function(s){ byId[s.dataset.id] = s; });
  var subLinks = [].slice.call(document.querySelectorAll('.tocsec ul a'));
  var subById = {};
  subLinks.forEach(function(a){ subById[a.getAttribute('href').slice(1)] = a; });

  function setActive(id){
    secs.forEach(function(s){ s.classList.remove('active'); });
    subLinks.forEach(function(a){ a.classList.remove('active'); });
    var sec = byId[id], sub = subById[id];
    var target = sub ? sub.closest('.tocsec') : sec;
    if (target){
      target.classList.add('active');
      target.open = true;
      if (sub) sub.classList.add('active');
    }
  }

  var heads = [].slice.call(doc.querySelectorAll('h2[id], h3[id]'));
  if ('IntersectionObserver' in window){
    var visible = {};
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(en){ visible[en.target.id] = en.isIntersecting; });
      for (var i=0;i<heads.length;i++){
        if (visible[heads[i].id]){ setActive(heads[i].id); return; }
      }
    }, { rootMargin: '-70px 0px -70% 0px', threshold: 0 });
    heads.forEach(function(h){ io.observe(h); });
  }

  document.querySelectorAll('.anchor').forEach(function(a){
    a.addEventListener('click', function(e){
      e.preventDefault();
      var h = document.getElementById(a.getAttribute('href').slice(1));
      if (h) h.scrollIntoView({block:'start', behavior:'smooth'});
      history.replaceState(null, '', a.getAttribute('href'));
    });
  });

  // --- mobile TOC ---------------------------------------------------------
  var mt = document.getElementById('mobtoggle'), side = document.getElementById('side');
  if (mt){
    mt.addEventListener('click', function(){
      var collapsed = side.classList.toggle('collapsed');
      mt.setAttribute('aria-expanded', String(!collapsed));
    });
  }
})();
</script>
`

fs.writeFileSync(OUT, page, 'utf8')
console.log('wrote', OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + 'KB')
console.log('sections:', toc.length, 'subsections:', toc.reduce((a, s) => a + s.children.length, 0))
console.log('toc order:', toc.map((s) => s.text).join(' | '))
