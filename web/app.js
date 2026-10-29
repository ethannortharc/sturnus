// Sturnus — the page.
// Home (#/): the way in (what needs you, ordered by how much attention it takes: sessions, mail to you, stuck push
// locks), something to get done (the assistant says who should take it), then a workspace's projects as lanes with the
// sessions working on them as cards (the ones without a stir for a day folded once more), its quiet projects, the sessions
// on the workspace itself. A project (#/p/<key>): its work items (worktrees and branches) with their sessions, its
// channel, its sessions. Channels (#/boards, one: #/b/<key>), a group's terminal (#/term/<group>[/<pane>]), mail
// (#/talk), reports (#/reports), the queue (#/queue). A session (#/s/<id>): overview (what it needs, words for it),
// report, conversation, terminal, messages.
'use strict';
const $ = s => document.querySelector(s);
const store = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} },
};
const FULL = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor' };
let S = null, loaded = null, lastOk = 0, firstTalk = true, route = { name: 'home' };
let railTab = store.get('deck.rail', 'talk'), sessTab = 'overview';
const seenTalk = new Set(), openMsgs = new Set();
const sig = {};

// ---------- small things ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function ago(t) {
  if (!t) return '';
  const s = Math.max(0, Date.now() / 1000 - t);
  if (s < 45) return '刚刚';
  if (s < 3600) return `${Math.round(s / 60)} 分钟`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时`;
  return `${Math.floor(s / 86400)} 天`;
}
// Markdown, as agents write it: escaped first, then formatted (no HTML of theirs runs; links only http(s))
function mdInline(t) {
  return String(t).split(/(`[^`\n]+`)/).map((part, i) => {
    if (i % 2) return `<code>${esc(part.slice(1, -1))}</code>`;
    let h = esc(part);
    h = h.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    h = h.replace(/(^|[\s(（])(https?:\/\/[^\s<)）]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
    h = h.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<i>$2</i>').replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
    return h;
  }).join('');
}
function md(src) {
  const lines = String(src ?? '').replace(/\r/g, '').split('\n'), out = [];
  let i = 0;
  const isList = l => /^\s*([-*+]|\d+[.)])\s+/.test(l), isRow = l => /^\s*\|.*\|\s*$/.test(l);
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*```/.test(l)) {
      const code = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      i++;
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
    } else if (/^\s*#{1,6}\s+/.test(l)) {
      out.push(`<h6>${mdInline(l.replace(/^\s*#{1,6}\s+/, ''))}</h6>`); i++;
    } else if (isList(l)) {
      const ordered = /^\s*\d/.test(l), items = [];
      for (; i < lines.length && (isList(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length)); i++) {
        if (isList(lines[i])) items.push(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '')); else items[items.length - 1] += ' ' + lines[i].trim();
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map(x => `<li>${mdInline(x)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
    } else if (/^\s*>/.test(l)) {
      const q = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) q.push(lines[i].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${md(q.join('\n'))}</blockquote>`);
    } else if (isRow(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => mdInline(c.trim()));
      const head = cells(l), rows = [];
      for (i += 2; i < lines.length && isRow(lines[i]); i++) rows.push(cells(lines[i]));
      out.push(`<table><thead><tr>${head.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    } else if (!l.trim()) {
      i++;
    } else {
      const para = [];
      for (; i < lines.length && lines[i].trim() && !/^\s*(```|#{1,6}\s|>)/.test(lines[i]) && !isList(lines[i]) && !(isRow(lines[i]) && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || '')); i++) para.push(mdInline(lines[i]));
      out.push(`<p>${para.join('<br>')}</p>`);
    }
  }
  return `<div class="md">${out.join('')}</div>`;
}
const clock = t => {
  if (typeof t === 'string') t = Date.parse(t) / 1000;
  if (!t) return '';
  const d = new Date(t * 1000), today = new Date().toDateString() === d.toDateString();
  return (today ? '' : `${d.getMonth() + 1}/${d.getDate()} `) + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
};
const who = n => (n === 'user' ? '你' : n);
const folder = p => (p || '').replace(/\/+$/, '').split('/').pop() || '~';
const home = p => (p || '').replace(/^\/(home|Users)\/[^/]+/, '~');
const toolName = t => String(t || '').replace(/^mcp__(plugin_)?[^_]+(_[^_]+)*?__/, '').replace(/^mcp__/, '');
function tone(name) { let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `hsl(${h % 360} 52% 52%)`; }
const tick = () => Math.floor(Date.now() / 30000);
function draw(key, data, fn) { const k = JSON.stringify(data); if (sig[key] === k) return false; sig[key] = k; fn(); return true; }

const I = {
  enter: '<svg viewBox="0 0 16 16"><rect x="1.8" y="2.6" width="12.4" height="10.8" rx="2.2"/><path d="m4.6 6.2 2 1.8-2 1.8M8.6 10h2.8"/></svg>',
  jump: '<svg viewBox="0 0 16 16"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5"/></svg>',
  reply: '<svg viewBox="0 0 16 16"><path d="M6.5 4 2.8 7.5 6.5 11M3 7.5h6.5a4 4 0 0 1 4 4v.5"/></svg>',
  mail: '<svg viewBox="0 0 16 16"><rect x="2" y="3.5" width="12" height="9" rx="1.6"/><path d="m2.6 4.6 5.4 4 5.4-4"/></svg>',
  plus: '<svg viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9"/></svg>',
  arrow: '<svg viewBox="0 0 16 16"><path d="M3.5 8h8.5M9 5l3 3-3 3"/></svg>',
  back: '<svg viewBox="0 0 16 16"><path d="M12.5 8H4M7 5 4 8l3 3"/></svg>',
  chev: '<svg viewBox="0 0 16 16"><path d="m6 4 4 4-4 4"/></svg>',
  check: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="m5.5 8.2 1.8 1.8 3.4-3.6"/></svg>',
  term: '<svg viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="11" rx="2.2"/><path d="m4.5 6 2 2-2 2M8.5 10h3"/></svg>',
  spark: '<svg viewBox="0 0 16 16"><path d="M8 2.5v3M8 10.5v3M2.5 8h3M10.5 8h3M4.2 4.2l2 2M9.8 9.8l2 2M4.2 11.8l2-2M9.8 6.2l2-2"/></svg>',
  sun: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="3.4"/><path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7 6 6M14 14l1.3 1.3M4.7 15.3 6 14M14 6l1.3-1.3"/></svg>',
  moon: '<svg viewBox="0 0 20 20"><path d="M15.5 12.2A6.2 6.2 0 0 1 7.8 4.5a6.2 6.2 0 1 0 7.7 7.7z"/></svg>',
  mic: '<svg viewBox="0 0 16 16"><rect x="5.5" y="1.8" width="5" height="8.4" rx="2.5"/><path d="M3.2 7.6a4.8 4.8 0 0 0 9.6 0M8 12.4v2"/></svg>',
  folder: '<svg viewBox="0 0 16 16"><path d="M2 4.5a1 1 0 0 1 1-1h3.2l1.4 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/></svg>',
  lock: '<svg viewBox="0 0 16 16"><rect x="3" y="7" width="10" height="7" rx="1.6"/><path d="M5.3 7V5.2a2.7 2.7 0 0 1 5.4 0V7"/></svg>',
  doc: '<svg viewBox="0 0 16 16"><path d="M4.5 1.8h4.8l2.9 2.9v9a.5.5 0 0 1-.5.5h-7.2a.5.5 0 0 1-.5-.5V2.3a.5.5 0 0 1 .5-.5z"/><path d="M6.3 8h4M6.3 10.6h4"/></svg>',
  auto: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.5"/><path d="M10 3.5v13a6.5 6.5 0 0 0 0-13z" fill="currentColor" stroke="none"/></svg>',
  grid: '<svg viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="4.6" height="4.6" rx="1.2"/><rect x="8.9" y="2.5" width="4.6" height="4.6" rx="1.2"/><rect x="2.5" y="8.9" width="4.6" height="4.6" rx="1.2"/><rect x="8.9" y="8.9" width="4.6" height="4.6" rx="1.2"/></svg>',
  list: '<svg viewBox="0 0 16 16"><path d="M3 4.5h10M3 8h10M3 11.5h6"/></svg>',
  panel: '<svg viewBox="0 0 16 16"><rect x="2" y="2.8" width="12" height="10.4" rx="2"/><path d="M6.3 2.8v10.4"/></svg>',
  chat: '<svg viewBox="0 0 16 16"><path d="M3.2 3.2h9.6a1.2 1.2 0 0 1 1.2 1.2v5.8a1.2 1.2 0 0 1-1.2 1.2H7.4L4.2 13.8v-2.4h-1A1.2 1.2 0 0 1 2 10.2V4.4a1.2 1.2 0 0 1 1.2-1.2z"/></svg>',
  branch: '<svg viewBox="0 0 16 16"><circle cx="4.5" cy="3.6" r="1.6"/><circle cx="4.5" cy="12.4" r="1.6"/><circle cx="11.5" cy="5.6" r="1.6"/><path d="M4.5 5.2v5.6M11.5 7.2c0 2.7-3.2 2.4-6.3 3.8"/></svg>',
};
const RAYS = Array.from({ length: 12 }, (_, i) => {
  const r = (i * 30 - 90) * Math.PI / 180, l = i % 2 ? 4.4 : 6.6;
  return `M12 12L${(12 + Math.cos(r) * l).toFixed(2)} ${(12 + Math.sin(r) * l).toFixed(2)}`;
}).join('');
const MARK = {  // (each agent's mark, drawn here: evocative of each, not the makers' artwork)
  claude: `<path d="${RAYS}" stroke-width="2.1"/>`,
  codex: '<path d="m6.5 8 4 4-4 4M12.5 16.5h5" stroke-width="2.2"/>',
  cursor: '<path d="M12 4.5 18.5 8.25v7.5L12 19.5l-6.5-3.75v-7.5zM5.5 8.25 12 12l6.5-3.75M12 12v7.5" stroke-width="1.7"/>',
  shell: '<rect x="3.5" y="5" width="17" height="14" rx="2.5" stroke-width="1.8"/><path d="m7.5 10 2.5 2-2.5 2M12.5 15h4" stroke-width="1.8"/>',
  user: '<circle cx="12" cy="9" r="3.5" stroke-width="2"/><path d="M5.5 19c1.2-3.3 3.6-5 6.5-5s5.3 1.7 6.5 5" stroke-width="2"/>',
};
function mark(kind, state, size = '') {
  const k = MARK[kind] ? kind : 'other';
  const spin = kind === 'claude' && state === 'working' ? ' class="spin"' : '';
  return `<span class="mark ${k === 'shell' ? 'sh' : k} ${size}" title="${esc(FULL[kind] || (kind === 'user' ? '你' : kind || ''))}"><svg viewBox="0 0 24 24"${spin}>${MARK[kind] || ''}</svg>${state ? `<i class="sd ${state}"></i>` : ''}</span>`;
}
const byName = n => (S && S.sessions.find(s => s.name === n)) || null;
const kindOf = n => (n === 'user' ? 'user' : (byName(n) || {}).kind || '');
function face(n) {
  if (n === 'user') return mark('user', '', 'sm');
  const k = kindOf(n);
  return k ? mark(k, '', 'sm') : `<span class="mark sm" style="background:${tone(n)}"></span>`;
}

// what a session asks of the person, and how it stands, in one word each
function attention(s) {
  if (['gone', 'ended'].includes(s.state) || s.stale || (s.unknown && !s.starting && !s.summary)) return null;
  if (s.state === 'waiting' || s.status === 'waiting_user') return 'decide';
  if (s.status === 'blocked') return 'blocked';
  if (s.status === 'review') return 'review';
  if (s.needs_you) return 'decide';
  return null;
}
const ATT = { decide: ['等你决定', 'waiting'], blocked: ['卡住了', 'blocked'], review: ['可以验收', 'review'] };
function standing(s) {
  if (s.state === 'gone') return ['gone', '已离开'];
  if (s.state === 'ended') return ['ended', '已结束'];
  const a = attention(s);
  if (a === 'decide') return ['waiting', '等你'];
  if (a === 'blocked') return ['blocked', '卡住'];
  if (a === 'review') return ['review', '待验收'];
  if (s.state === 'working') return ['working', '工作中'];
  return ['idle', '空闲'];
}
const titleOf = s => s.title || (s.summary ? s.summary.split(/[，。；,;：:]/)[0].slice(0, 18) : '') || (s.unknown ? '还认不出在做什么' : s.name);
// how words for a session get there (as the deck's say_how): typed when idle, held while it works, never into a prompt
const asking = s => ['AskUserQuestion', 'ExitPlanMode'].includes(s.tool) && s.state === 'working' && (s.tool_at || 0) > (s.tool_end || 0);
const sayHow = s => (['gone', 'ended'].includes(s.state) ? 'gone' : s.prompting || asking(s) ? 'menu' : !s.loc ? 'mail' : s.state === 'working' ? 'queue' : 'type');
const projOf = k => (S.projects || {})[k] || null;
const wsOf = k => (S.workspaces || []).find(w => w.key === k) || null;
const boardOf = k => (S.boards || {})[k] || null;
const live = s => !s.stale && !['gone', 'ended'].includes(s.state);

// ---------- theme ----------
function applyTheme() {
  const t = store.get('deck.theme', 'auto');
  document.documentElement.dataset.theme = t === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
  $('#themeBtn').innerHTML = I[t === 'auto' ? 'auto' : t === 'dark' ? 'moon' : 'sun'];
  $('#themeBtn').title = { auto: '主题：跟随系统', light: '主题：浅色', dark: '主题：深色' }[t];
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// ---------- data ----------
async function load() {
  try {
    const r = await fetch('/api/state', { cache: 'no-store' });
    if (r.status === 401) return location.reload();
    S = await r.json(); lastOk = Date.now();
    if (S.version !== (loaded = loaded || S.version)) return location.reload();  // (the deck was upgraded: this page too)
    render();
  } catch {}
  conn();
}
function conn() {
  const off = Date.now() - lastOk > 6000;
  $('#conn').classList.toggle('off', off);
  $('#conn span').textContent = off ? '连接中断，重试中' : '实时';
}
async function api(what, body) {
  const r = await fetch('/api/' + what, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Deck': '1' }, body: JSON.stringify(body || {}) });
  if (r.status === 401) location.reload();  // (signed out: the sign-in page)
  return r.json();
}
async function post(what, body) {
  try { const j = await api(what, body); if (j.msg) toast(j.msg, j.ok); load(); return j; }
  catch (e) { toast('没连上 sturnus 服务：' + e.message, false); }
}
function toast(text, ok = true) {
  const el = document.createElement('div');
  el.className = 'toast' + (ok ? '' : ' bad');
  el.innerHTML = `<i>${ok ? '✓' : '!'}</i><span>${esc(text)}</span>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = 0; setTimeout(() => el.remove(), 300); }, ok ? 3200 : 6500);
}

// ---------- routes ----------
function parseRoute() {
  const h = location.hash.replace(/^#/, '');
  if (h === '/queue') return { name: 'queue' };
  if (h === '/talk') return { name: 'talk' };
  let t = h.match(/^\/term\/([^/]+)(?:\/([^/]+))?$/);
  if (t) return { name: 'gterm', group: decodeURIComponent(t[1]), pane: t[2] ? decodeURIComponent(t[2]) : '' };
  if (h === '/reports') return { name: 'reports' };
  if (h === '/boards') return { name: 'boards' };
  if (h === '/workspaces') return { name: 'workspaces' };
  t = h.match(/^\/boards\/([^/]+)$/);
  if (t) return { name: 'boards', key: decodeURIComponent(t[1]) };
  t = h.match(/^\/w\/([^/]+)(?:\/(projects|works))?$/);
  if (t) return { name: 'ws', key: decodeURIComponent(t[1]), tab: t[2] || 'dash' };
  t = h.match(/^\/p\/([^/]+)(?:\/(overview|board|sessions))?$/);
  if (t) return { name: 'project', key: decodeURIComponent(t[1]), tab: t[2] || 'overview' };
  t = h.match(/^\/b\/([^/]+)$/);
  if (t) return { name: 'board', key: decodeURIComponent(t[1]) };
  const m = h.match(/^\/s\/(.+?)(?:\/(overview|report|chat|term|msgs))?$/);
  return m ? { name: 'session', id: decodeURIComponent(m[1]), tab: m[2] || 'overview' } : { name: 'home' };
}
window.addEventListener('hashchange', () => { route = parseRoute(); if (!(route.name === 'session' && route.tab === 'term') && route.name !== 'gterm') closeTerm(); for (const k in sig) delete sig[k]; build(); render(); });
const go = (id, tab) => { location.hash = `#/s/${encodeURIComponent(id)}${tab && tab !== 'overview' ? '/' + tab : ''}`; };

function build() {  // (the frame of a view; render() fills it)
  closeOverlays();
  const crumb = t => { $('#crumbs').innerHTML = t ? `${I.chev}<b>${esc(t)}</b>` : ''; };
  const todo = `<section class="todo-sec"><form class="q-new todo" id="todo" autocomplete="off"><textarea id="tText" rows="2" placeholder="有件事要做？写下来，选个项目，助手按各会话在做的事帮你挑交给谁，或者新开一个"></textarea>
        <div class="row"><label class="hint">项目</label><select id="tProj"></select><span id="tMic"></span><span class="sp"></span><a class="btn" id="qlink" href="#/queue">排队</a><button class="btn primary" type="submit">${I.spark}交给谁</button></div></form><div id="tRec"></div></section>`;
  const wireTodo = () => {
    $('#todo').addEventListener('submit', e => { e.preventDefault(); todoAsk(); });
    $('#tText').addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); todoAsk(); } });
  };
  if (route.name === 'home') {  // (all workspaces)
    crumb('总览');
    $('#view').innerHTML = `<div class="page">
      <section class="entry"><div class="h-title"><h2>需要你</h2><span class="sub" id="attnSub"></span></div><div id="attn"></div></section>
      ${todo}<section class="sec-block"><div class="h-title"><h2>工作区</h2><span class="sub" id="wsSub"></span><a class="right lnk" href="#/workspaces">所有工作区</a></div><div id="wsCards"></div></section>
      <section class="sec-block" id="looseSec"></section></div>`;
    wireTodo();
  } else if (route.name === 'ws') {  // (one workspace: its dashboard, its projects, its work items)
    $('#view').innerHTML = `<div class="page"><div class="ws-head" id="wsHead"></div><div id="wsBody"></div></div>`;
    if (route.tab === 'dash' && route.key !== '~') {
      $('#wsBody').innerHTML = `<section class="entry"><div class="h-title"><h2>需要你</h2><span class="sub" id="attnSub"></span></div><div id="attn"></div></section>${todo}
        <section class="sec-block"><div class="h-title"><h2>进行中的工作</h2><span class="sub">有会话在上面、或者还没合进 main 的工作项</span><a class="right lnk" href="#/w/${encodeURIComponent(route.key)}/works">全部工作项</a></div><div id="wsWorks"></div></section>
        <section class="sec-block"><div class="h-title"><h2>会话在做什么</h2><span class="sub" id="wsCardsSub"></span></div><div id="wsSess"></div></section>
        <section class="sec-block"><div class="h-title"><h2>项目</h2><span class="sub" id="wsProjSub"></span><a class="right lnk" href="#/w/${encodeURIComponent(route.key)}/projects">全部项目</a></div><div id="wsProj"></div></section>
        <section class="sec-block"><div class="h-title"><h2>最近</h2><span class="sub">讨论区的新帖、记下的决定、产出</span></div><div id="wsFeed"></div></section>`;
      wireTodo();
    }
  } else if (route.name === 'workspaces') {
    crumb('所有工作区');
    $('#view').innerHTML = `<div class="page"><div class="h-title"><h2>所有工作区</h2><span class="sub">最左边只放有会话的和刚打开的；其余的在这里，⌘K 也能搜到</span></div><div id="wsCards"></div></div>`;
  } else if (route.name === 'project') {
    $('#view').innerHTML = `<div class="sess" id="sess"><div id="hero"></div><div id="tabBody"></div></div>`;
  } else if (route.name === 'board') {
    $('#view').innerHTML = `<div class="sess" id="sess"><div id="hero"></div><div id="tabBody"><div class="s-body wide" id="boardBox"></div></div></div>`;
  } else if (route.name === 'boards' && route.key) {
    $('#view').innerHTML = `<div class="sess" id="sess"><div id="hero"></div><div id="tabBody"><div class="s-body wide" id="boardBox"></div></div></div>`;
  } else if (route.name === 'boards') {
    crumb('讨论');
    $('#view').innerHTML = `<div class="page narrow"><div class="h-title"><h2>讨论</h2><span class="sub">每个项目一个讨论区，在这个项目上工作的会话都会收到；每个工作区也有一个</span></div><div id="bList"></div></div>`;
  } else if (route.name === 'gterm') {
    crumb(`${groupName(route.group)} · 终端`);
    $('#view').innerHTML = `<div class="sess"><div id="tabBody"></div></div>`;
  } else if (route.name === 'talk') {
    crumb('消息');
    if (!['talk', 'mine'].includes(railTab)) railTab = 'talk';
    $('#view').innerHTML = `<div class="page narrow">
      <div class="h-title"><h2>消息</h2><span class="sub" id="talkSub"></span><div class="right seg">${[['talk', '会话之间'], ['mine', '与你有关']].map(([k, l]) => `<button data-rail="${k}" class="${railTab === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <form class="composer" id="composer" autocomplete="off">
        <div class="composer-top">发给 <select id="composeTo"></select></div>
        <div class="composer-box"><textarea id="composeText" rows="1" placeholder="写给会话……  Enter 发送"></textarea><span id="cMic"></span><button class="send" type="submit" title="发送">${I.arrow}</button></div>
      </form>
      <div class="talk-list" id="railList"></div></div>`;
    const ta = $('#composeText');
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; });
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); } });
    $('#composer').addEventListener('submit', async e => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text) return;
      const j = await post('send', { to: $('#composeTo').value, text });
      if (j && j.ok) { ta.value = ''; ta.style.height = 'auto'; }
    });
  } else if (route.name === 'reports') {
    crumb('报告');
    $('#view').innerHTML = `<div class="page"><div class="h-title"><h2>报告</h2><span class="sub" id="repSub"></span></div><div id="repList"></div></div>`;
  } else if (route.name === 'queue') {
    crumb('排队');
    $('#view').innerHTML = `<div class="q-page"><div class="q-head"><h2>排队</h2><p>先把要交给会话的事写下来；会话空了，助手先看还要不要做、适不适合，再替你发，或者提醒你。</p></div>
      <form class="q-new" id="qNew" autocomplete="off"><textarea id="qText" placeholder="要做的事……（比如：等它把测试跑完，让它把结论写进 PR 描述）"></textarea>
        <div class="row"><label class="hint">交给</label><select id="qTo"></select>
          <div class="seg" id="qMode"><button type="button" data-qmode="auto" class="on">助手确认后自动发</button><button type="button" data-qmode="remind">空了提醒我</button></div>
          <span id="qMic"></span><button type="button" class="btn" id="qRecBtn" title="助手按各会话负责的事，推荐交给谁，或新开一个">${I.spark}帮我选</button>
          <span class="sp"></span><button class="btn primary" type="submit">${I.plus}排上</button></div></form>
      <div id="qRec"></div>
      <div id="qList"></div></div>`;
    $('#qRecBtn').onclick = recommend;
    $('#qNew').addEventListener('submit', async e => {
      e.preventDefault();
      const text = $('#qText').value.trim(), v = $('#qTo').value;
      if (!text) { $('#qText').focus(); return; }
      const [kind, val] = v.split(':');
      const j = await post('queue', { do: 'add', text, to: kind === 's' ? val : '', group: kind === 'g' ? val : '', mode: qMode });
      if (j && j.ok) $('#qText').value = '';
    });
  } else {
    sessTab = route.tab;
    $('#view').innerHTML = `<div class="sess" id="sess"><div id="hero"></div><div id="tabBody"></div></div>`;
  }
}

function render() {
  if (!S) return;
  if (ASST.open) draw('asst-head', [S.models && S.models.assist && S.models.assist.label, S.voice && S.voice.on], () => drawAsst(true));
  draw('status', [S.summarizer, S.about && S.about.model, Math.floor(Date.now() / 5000), S.version], drawStatus);
  drawRail();
  drawSide();
  ({ home: renderHome, ws: renderWs, workspaces: renderWorkspaces, gterm: () => drawTerm({ id: `g:${route.group}:${route.pane}`, group: route.group, pane: route.pane, loc: (S.groups || {})[route.group] }), talk: renderTalk, reports: renderReports, queue: renderQueue,
     project: renderProject, board: renderBoardPage, boards: () => (route.key ? renderBoardPage() : renderBoards()) }[route.name] || renderSession)();
  if (!$('#palette').hidden) drawPalette();
}

// groups (Zellij or tmux sessions): where the agents' panes are
const groupName = k => (k === '~none' ? '未托管' : k.replace(/^tmux:/, ''));
const roots = list => list.filter(s => !s.parent_id);  // (sessions others started are shown with their parent)
const kidsOf = s => S.sessions.filter(c => c.parent_id === s.id);
const parentOf = s => s.parent_id && S.sessions.find(p => p.id === s.parent_id);
const muxOf = k => (k.startsWith('tmux:') ? 'tmux' : 'zellij');
const attachCmd = k => (muxOf(k) === 'tmux' ? `tmux attach -t ${groupName(k)}` : `zellij attach ${k}`);
const muxTag = k => (k !== '~none' && muxOf(k) === 'tmux' ? '<span class="mux">tmux</span>' : '');
const webOk = s => !!s.loc;  // (the terminal in the page: Zellij or tmux)
const ORDER = s => ({ waiting: 0, blocked: 1, review: 2, working: 3, idle: 4, ended: 5, gone: 6 }[standing(s)[0]] ?? 9);
const isToday = t => new Date(t * 1000).toDateString() === new Date().toDateString();

// ---------- the rail and the column beside it ----------
// The rail: the global places (all workspaces, discussions, messages, reports, the queue) and the workspaces — the ones
// with sessions on them, the one open, the ones opened lately; the quiet rest under "+N". The column beside it shows what
// the rail has selected: a workspace's pages and its sessions, or a global place's own list.
function space() {
  const r = route;
  if (r.name === 'ws') return { t: 'ws', key: r.key };
  if (r.name === 'project') { const p = projOf(r.key); return p && p.workspace ? { t: 'ws', key: p.workspace, page: 'projects' } : { t: 'home' }; }
  if (r.name === 'session') { const s = S.sessions.find(x => x.id === r.id); return s ? { t: 'ws', key: s.workspace || '~' } : { t: 'home' }; }
  if (r.name === 'board') return wsOf(r.key) ? { t: 'ws', key: r.key, page: 'board' } : { t: 'boards' };
  if (['boards', 'talk', 'reports', 'queue', 'workspaces'].includes(r.name)) return { t: r.name };
  if (r.name === 'gterm') {  // (a group's terminal: in the workspace most of its sessions are in)
    const n = {};
    for (const s of S.sessions) if (s.loc && s.loc.session === r.group && s.workspace) n[s.workspace] = (n[s.workspace] || 0) + 1;
    const k = Object.keys(n).sort((a, b) => n[b] - n[a])[0];
    return k ? { t: 'ws', key: k, page: 'term' } : { t: 'home' };
  }
  return { t: 'home' };
}
// (a workspace's own color, muted, by its key; shown only in the 暗彩 and 色条 looks)
const MUTED = ['#5d6b85', '#6b6a4a', '#7a6650', '#6c5f84', '#4f7569', '#86604f', '#7b5566', '#5a6f80', '#5f7550', '#80704a'];
const wsColor = w => { let h = 0; for (const c of String(w.key)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return MUTED[h % MUTED.length]; };
const WSC = { graphite: '石墨', muted: '暗彩', stripe: '石墨加色条' };
function applyWsColor() { const v = store.get('deck.wsColor', 'graphite'); document.documentElement.dataset.wsColor = WSC[v] ? v : 'graphite'; }
const wsNeed = w => S.sessions.filter(s => s.workspace === w.key && attention(s)).length;
const wsWorking = w => S.sessions.some(s => s.workspace === w.key && s.state === 'working');
function railWs() {  // (the workspaces on the rail, in order)
  const sp = space(), seen = store.get('deck.wsSeen', []), ws = S.workspaces || [];
  return ws.filter(w => w.live || wsNeed(w) || (sp.t === 'ws' && sp.key === w.key) || seen.includes(w.key));
}
// (the column beside the rail folds: the rail's selected place clicked again, a handle at its edge, or ⌘B; the rail stays)
let sideOff = store.get('deck.sideOff', ['rail', 'none'].includes(store.get('deck.lay', '')));
function applyFold() {
  const app = document.querySelector('.app');
  app.classList.toggle('side-off', sideOff);
  const h = $('#sideHandle');
  if (h) { h.title = `${sideOff ? '展开' : '收起'}旁边那栏（⌘B）`; h.setAttribute('aria-label', h.title); h.innerHTML = sideOff ? I.chev : I.chev.replace('<svg', '<svg style="transform:scaleX(-1)"'); }
  fitTerm();
}
function setSide(off) { sideOff = off; store.set('deck.sideOff', off); applyFold(); }
function drawRail() {
  const sp = space(), ws = S.workspaces || [], on = railWs(), rest = ws.length - on.length;
  const loose = roots(S.sessions).filter(s => !s.workspace && live(s)).length;
  const need = S.sessions.filter(attention).length + (S.inbox || []).length + (S.lock_issues || []).length;
  const boards = Object.values(S.boards || {}), bNew = boards.reduce((n, b) => n + (b.unread || 0), 0), bCalls = boards.reduce((n, b) => n + (b.calls || 0), 0);
  const today = (S.talk || []).filter(m => isToday(m.at)).length, q = S.queue || [], qReady = q.filter(i => i.status === 'ready').length;
  if (sp.t === 'ws' && sp.key !== '~') {  // (a quiet workspace opened stays on the rail a while)
    const w = wsOf(sp.key), seen = store.get('deck.wsSeen', []);
    if (w && !w.live && !seen.includes(w.key)) store.set('deck.wsSeen', [w.key, ...seen].slice(0, 3));
  }
  draw('railnav', [sp, on.map(w => [w.key, w.name, wsNeed(w), wsWorking(w)]), rest, loose, need, bNew, bCalls, today, qReady], () => {
    const g = (href, on, icon, label, n, hot) => `<a class="tile g${on ? ' on' : ''}" href="${href}" title="${label}${on ? '（再点一下：收起或展开旁边那栏）' : ''}" aria-label="${label}">${icon}${n ? `<span class="badge${hot ? ' hot' : ''}">${n}</span>` : ''}</a>`;
    $('#rail').innerHTML = g('#/', sp.t === 'home', I.grid, '总览：所有工作区', need, true) + '<hr>'
      + on.map((w, i) => `<a class="tile ws${sp.t === 'ws' && sp.key === w.key ? ' on' : ''}${w.live ? '' : ' quiet'}" href="#/w/${encodeURIComponent(w.key)}" style="--t:${wsColor(w)}" title="${esc(w.name)} · ${esc(home(w.path))}${i < 9 ? ` （⌘${i + 1}）` : ''}" aria-label="${esc(w.name)}">${esc(w.name.slice(0, 1).toUpperCase())}${wsNeed(w) ? `<span class="badge hot">${wsNeed(w)}</span>` : wsWorking(w) ? '<i class="pulse"></i>' : ''}</a>`).join('')
      + (rest > 0 ? g('#/workspaces', sp.t === 'workspaces', `<b>+${rest}</b>`, `所有工作区（还有 ${rest} 个安静的）`) : g('#/workspaces', sp.t === 'workspaces', I.plus, '所有工作区'))
      + (loose ? `<a class="tile g${sp.t === 'ws' && sp.key === '~' ? ' on' : ''}" href="#/w/~" title="不在工作区里的会话" aria-label="不在工作区里"><b>…</b><span class="badge">${loose}</span></a>` : '')
      + '<span class="push"></span>'
      + g('#/boards', sp.t === 'boards', I.chat, '讨论：所有讨论区', bCalls || bNew, bCalls > 0)
      + g('#/talk', sp.t === 'talk', I.mail, '消息：会话之间的信', today)
      + g('#/reports', sp.t === 'reports', I.doc, '报告：每个会话的简报', '')
      + g('#/queue', sp.t === 'queue', I.list, '排队：等会话空了再发', qReady, true);
  });
}
function drawSide() {
  const sp = space(), cur = route.name === 'session' ? S.sessions.find(x => x.id === route.id) : null, tops = roots(S.sessions);
  draw('side', [sp, route, S.sessions.map(s => [s.id, s.title, s.state, s.status, s.needs_you && 1, s.stale, s.kind, s.project, s.workspace, s.branch]), (S.workspaces || []).map(w => [w.key, w.live, w.projects.length]),
    Object.values(S.boards || {}).map(b => [b.key, b.unread]), Object.entries(S.groups || {}).map(([g, z]) => [g, z.clients.length, z.agents]), (S.queue || []).map(i => i.status), railTab, [...quietOpen],
    Object.values(S.projects || {}).map(p => [p.key, p.facts && p.facts.at]), (S.workspaces || []).map(w => w.groups)], () => {
    const head = (t, sub, extra = '') => `<div class="sp-head"><b>${t}</b>${sub ? `<span>${sub}</span>` : ''}${extra}</div>`;
    const item = (href, on, icon, label, n, hot) => `<a class="nav-item${on ? ' on' : ''}" href="${href}">${icon}${label}${n ? `<span class="n${hot ? ' hot' : ''}">${n}</span>` : ''}</a>`;
    const row = (s, pre) => { const [st, label] = standing(s), p = projOf(s.project); return `<div class="side-s${cur && cur.id === s.id ? ' on' : ''}${s.stale ? ' quiet' : ''}" data-go="${esc(s.id)}" title="${esc(s.name)}">${mark(FULL[s.kind] ? s.kind : 'codex', st, 'sm')}<b>${esc(titleOf(s))}</b><span><em class="${st}">${label}</em> · ${pre ? esc(pre) + ' · ' : ''}${p ? esc(p.name) + (s.branch && s.work !== p.path ? ' · ' + esc(s.branch) : '') : s.workspace ? '工作区顶层' : esc(s.name)}</span></div>`; };
    const byState = (list, k, pre) => {
      const act = list.filter(s => !s.stale && !['gone', 'ended'].includes(s.state)), quiet = list.filter(s => s.stale), qOpen = quietOpen.has(k);
      const groups = [['等你', act.filter(s => ['waiting', 'blocked', 'review'].includes(standing(s)[0]))], ['工作中', act.filter(s => standing(s)[0] === 'working')], ['空闲', act.filter(s => standing(s)[0] === 'idle')]];
      return groups.filter(([, l]) => l.length).map(([t, l]) => `<div class="side-gh"><span>${t} · ${l.length}</span></div>${l.map(s => row(s, pre && pre(s))).join('')}`).join('')
        + (quiet.length ? `<div class="side-quiet" data-quiet="${esc(k)}">${chev(qOpen)}一天以上没动静 ${quiet.length} 个</div>${qOpen ? quiet.map(s => row(s, pre && pre(s))).join('') : ''}` : '')
        + (!act.length && !quiet.length ? '<div class="side-empty">现在没有会话</div>' : '');
    };
    let html = '';
    if (sp.t === 'ws' && sp.key === '~') {
      html = head('不在工作区里', '目录不在任何工作区里的会话') + byState(tops.filter(s => !s.workspace), 'loose');
    } else if (sp.t === 'ws' && wsOf(sp.key)) {
      const w = wsOf(sp.key), mine = tops.filter(s => s.workspace === w.key), b = boardOf(w.key);
      const works = workRows(w).length, groups = w.groups || [];
      const page = route.name === 'ws' ? route.tab : sp.page || '';
      html = head(esc(w.name), esc(home(w.path)))
        + item(`#/w/${encodeURIComponent(w.key)}`, route.name === 'ws' && page === 'dash', I.grid, '仪表盘')
        + item(`#/w/${encodeURIComponent(w.key)}/projects`, page === 'projects', I.folder, '项目', w.projects.length)
        + item(`#/w/${encodeURIComponent(w.key)}/works`, page === 'works', I.branch, '工作项', works)
        + item(`#/b/${encodeURIComponent(w.key)}`, page === 'board', I.chat, '讨论区', b && b.unread, b && b.calls)
        + byState(mine, 'ws:' + w.key)
        + (groups.length ? `<div class="side-gh"><span>终端</span></div>${groups.map(g => `<a class="side-g sm${route.name === 'gterm' && route.group === g ? ' on' : ''}" href="#/term/${encodeURIComponent(g)}" title="${esc(attachCmd(g))}"><i class="${((S.groups || {})[g] || {}).clients && S.groups[g].clients.length ? 'live' : ''}"></i><span class="nm">${esc(groupName(g))}</span>${muxTag(g)}</a>`).join('')}` : '');
    } else if (sp.t === 'boards') {
      html = head('讨论', '每个工作区、每个项目一个讨论区') + (S.workspaces || []).map(w => {
        const keys = [w.key, ...w.projects.filter(k => boardOf(k) || S.sessions.some(s => s.project === k))];
        return `<div class="side-gh"><span>${esc(w.name)}</span></div>` + keys.map(k => { const b = boardOf(k), isW = k === w.key;
          return item(`#/boards/${encodeURIComponent(k)}`, route.key === k, isW ? I.chat : I.folder, isW ? `${esc(w.name)} 工作区` : esc(projOf(k).name), b && (b.calls || b.unread), b && b.calls); }).join('');
      }).join('');
    } else if (sp.t === 'talk') {
      html = head('消息', '会话之间的信，和写给你的') + [['talk', '会话之间'], ['mine', '与你有关']].map(([k, l]) => `<a class="nav-item${railTab === k ? ' on' : ''}" data-rail="${k}" href="#/talk">${I.mail}${l}</a>`).join('');
    } else if (sp.t === 'reports') {
      html = head('报告', '每个会话的简报') + (S.workspaces || []).map(w => { const l = tops.filter(s => s.workspace === w.key && !['gone', 'ended'].includes(s.state));
        return l.length ? `<div class="side-gh"><span>${esc(w.name)}</span></div>${l.map(s => row(s)).join('')}` : ''; }).join('');
    } else if (sp.t === 'queue') {
      const q = S.queue || [], c = st => q.filter(i => st.includes(i.status)).length;
      html = head('排队', '等会话空了再发的事') + [['可以发了', ['ready']], ['排着', ['waiting', 'checking', 'held']], ['已发出', ['sent']], ['不用发了', ['dropped']]]
        .map(([l, st]) => `<div class="nav-item static">${I.list}${l}<span class="n${st[0] === 'ready' && c(st) ? ' hot' : ''}">${c(st) || ''}</span></div>`).join('');
    } else if (sp.t === 'workspaces') {
      if ($('#wsFilter') && $('#wsList')) { $('#wsList').innerHTML = wsListHtml(); return; }  // (the filter stays as it is: typing in it is never cut)
      html = head('所有工作区', `${(S.workspaces || []).length} 个 · 有会话的在前`, `<input class="field side-filter" id="wsFilter" placeholder="筛选工作区" value="${esc(sig.wsFilter || '')}" autocomplete="off">`)
        + `<div id="wsList">${wsListHtml()}</div>`;
    } else {  // (all workspaces: every session, with the workspace it is in)
      const gs = Object.keys(S.groups || {});
      html = head('所有工作区', `${(S.workspaces || []).length} 个工作区 · ${tops.filter(live).length} 个会话`) + byState(tops, 'home', s => (wsOf(s.workspace) || { name: '不在工作区里' }).name)
        + (gs.length ? `<div class="side-gh"><span>终端</span></div>${gs.map(g => `<a class="side-g sm" href="#/term/${encodeURIComponent(g)}" title="${esc(attachCmd(g))}"><i class="${S.groups[g].clients.length ? 'live' : ''}"></i><span class="nm">${esc(groupName(g))}</span>${muxTag(g)}<span class="n">${S.groups[g].agents || ''}</span></a>`).join('')}` : '');
    }
    $('#side').innerHTML = html;
  });
}
function wsListHtml() {
  const f = (sig.wsFilter || '').toLowerCase(), ws = (S.workspaces || []).filter(w => !f || (w.name + ' ' + w.path).toLowerCase().includes(f));
  return [['有会话', ws.filter(w => w.live)], ['安静', ws.filter(w => !w.live)]].filter(([, l]) => l.length).map(([t, l]) => `<div class="side-gh"><span>${t} · ${l.length}</span></div>`
    + l.map(w => `<a class="nav-item" href="#/w/${encodeURIComponent(w.key)}"><span class="wsdot" style="--t:${wsColor(w)}">${esc(w.name.slice(0, 1).toUpperCase())}</span>${esc(w.name)}<span class="n">${w.live ? w.live + ' 个会话' : w.at ? ago(w.at) + '前' : ''}</span></a>`).join('')).join('')
    || '<div class="side-empty">没有这个名字的工作区</div>';
}

// the ones without a stir for a day fold away (until opened)
const quietOpen = new Set(store.get('deck.quietOpen', []));
function toggle(set, key, k) { set.has(k) ? set.delete(k) : set.add(k); store.set(key, [...set]); for (const x in sig) delete sig[x]; render(); }
const chev = open => `<span class="chev${open ? ' open' : ''}">${I.chev}</span>`;

// ---------- what needs the person (all workspaces, or one) ----------
function drawAttn(wkey) {
  const mine = s => !wkey || s.workspace === wkey || (wkey === '~' && !s.workspace);
  const need = S.sessions.filter(mine).map(s => [s, attention(s)]).filter(([, a]) => a).sort((a, b) => ['decide', 'blocked', 'review'].indexOf(a[1]) - ['decide', 'blocked', 'review'].indexOf(b[1]) || (b[0].at || 0) - (a[0].at || 0));
  const inbox = wkey ? [] : S.inbox || [];
  const locks = (S.lock_issues || []).filter(l => !wkey || ((projOf('p-' + l.key) || {}).workspace === wkey)), n = need.length + inbox.length + locks.length;
  const typing = document.activeElement && document.activeElement.closest && document.activeElement.closest('#attn');
  if (!typing) draw('attn', [wkey, need.map(([s, a]) => [s.id, a, s.title, s.summary, s.needs_you, s.waiting_for, s.name, s.kind]), inbox.map(m => m.id), locks.map(l => [l.key, l.why, l.waiters]), tick()], () => {
    $('#attnSub').textContent = n ? `${n} 件，按要你花的心思排` : '';
    $('#attn').innerHTML = n ? `<div class="attn">${inbox.map(m => `
      <div class="attn-row mail">
        <span class="bar4"></span>${face(m.from)}
        <div class="t"><div class="k">找你<span>${esc(m.from)} · ${clock(m.at)}</span></div><div class="full">${md(m.text)}</div>
          <form class="m-reply" data-mid="${esc(m.id)}" hidden><input class="field" id="mr-${esc(m.id)}" placeholder="回复 ${esc(m.from)}……" autocomplete="off">${micBtn('mr-' + m.id)}<button class="btn primary" type="submit">发送</button></form></div>
        <div class="acts"><button class="btn" data-mreply="${esc(m.id)}">${I.reply}回复</button><button class="btn" data-mread="${esc(m.id)}">知道了</button></div>
      </div>`).join('')}${locks.map(l => `
      <div class="attn-row blocked">
        <span class="bar4"></span><span class="mark sm lk">${I.lock}</span>
        <div class="t"><div class="k">推送锁<span>${esc(l.holder)} · ${ago(l.since)}前锁上</span></div>
          <b>${esc(l.branch)} · ${esc(folder(l.repo))}</b><p>${esc(l.why)}${(l.waiters || []).length ? `；${esc(l.waiters.join('、'))} 在等它` : ''}</p></div>
        <div class="acts"><button class="btn" data-unlock="${esc(l.key)}">释放</button></div>
      </div>`).join('')}${need.map(([s, a]) => `
      <div class="attn-row ${ATT[a][1]}" data-go="${esc(s.id)}">
        <span class="bar4"></span>${mark(s.kind, ATT[a][1], 'sm')}
        <div class="t"><div class="k">${ATT[a][0]}<span>${esc(s.name)}${!wkey && wsOf(s.workspace) ? ` · ${esc(wsOf(s.workspace).name)}` : ''}${projOf(s.project) ? ` · ${esc(projOf(s.project).name)}` : ''}${parentOf(s) ? ` · ${esc(parentOf(s).name)} 启动的` : ''} · ${ago(s.since)}</span></div>
          <b>${esc(titleOf(s))}</b><p>${esc(s.state === 'waiting' && s.waiting_for ? '在等你批准：' + s.waiting_for : s.needs_you || s.summary || '')}</p></div>
        <div class="acts"><button class="btn" data-go="${esc(s.id)}" data-tab="overview">${I.reply}回复</button><button class="btn dark" data-go="${esc(s.id)}" data-tab="term" ${webOk(s) ? '' : 'disabled'}>${I.enter}进入</button></div>
      </div>`).join('')}</div>` : `<div class="calm">${I.check}现在没有要你决定或验收的事，它们都在各自干活。</div>`;
  });
  const q = S.queue || [], qReady = q.filter(i => i.status === 'ready'), qWait = q.filter(i => ['waiting', 'held', 'checking'].includes(i.status));
  if (!wkey) draw('qline', [qReady.length, qWait.length], () => {
    let el = $('#qline');
    if (!el) { el = document.createElement('a'); el.id = 'qline'; el.className = 'q-line'; el.href = '#/queue'; $('.entry').appendChild(el); }
    el.innerHTML = `${I.plus}<span>${qReady.length ? `<b>${qReady.length} 件排队的事可以发了</b> · ` : ''}${qWait.length ? `排队中 ${qWait.length} 件，等会话空了由助手确认再发` : '有事要交代？写下来，助手帮你挑交给哪个会话，或排到它空了再发'}</span>`;
  });
}
function drawTodoProjects(keys) {
  draw('tproj', [keys], () => {
    const sel = $('#tProj');
    if (!sel) return;
    const keep = sel.value || store.get('deck.todoProj', '');
    const byWs = new Map();
    for (const k of keys) { const w = (wsOf((projOf(k) || {}).workspace) || {}).name || ''; if (!byWs.has(w)) byWs.set(w, []); byWs.get(w).push(k); }
    sel.innerHTML = `<option value="">不限项目</option>` + [...byWs.entries()].map(([w, ks]) => `<optgroup label="${esc(w)}">${ks.map(k => `<option value="${esc(k)}">${esc(projOf(k).name)}</option>`).join('')}</optgroup>`).join('');
    if (keys.includes(keep)) sel.value = keep;
  });
  draw('tmic', [S.voice && S.voice.on], () => { if ($('#tMic')) $('#tMic').innerHTML = micBtn('tText'); });
}

// ---------- all workspaces ----------
function wsCard(w) {
  const mine = roots(S.sessions).filter(s => s.workspace === w.key && live(s)), c = k => mine.filter(s => standing(s)[0] === k).length, need = wsNeed(w), b = boardOf(w.key);
  const works = workRows(w).length;
  return `<a class="ws-card${w.live ? '' : ' quiet'}" href="#/w/${encodeURIComponent(w.key)}"><div class="top"><span class="wsdot lg" style="--t:${wsColor(w)}">${esc(w.name.slice(0, 1).toUpperCase())}</span><div><b>${esc(w.name)}</b><span class="path">${esc(home(w.path))}</span></div>${need ? `<span class="n hot">${need}</span>` : ''}</div>
    <div class="stats">${w.live ? [['waiting', '等你', c('waiting') + c('blocked') + c('review')], ['working', '工作中', c('working')], ['idle', '空闲', c('idle')]].filter(x => x[2]).map(([k, l, v]) => `<span class="chip"><span class="dot ${k}"></span><b>${v}</b>${l}</span>`).join('') : `<span class="chip">${w.at ? ago(w.at) + '前动过' : '安静'}</span>`}
      <span class="chip"><b>${w.projects.length}</b>个项目</span>${works ? `<span class="chip"><b>${works}</b>个工作项在进行</span>` : ''}${b && b.unread ? `<span class="chip">${I.chat}<b>${b.unread}</b>条新讨论</span>` : ''}</div></a>`;
}
function renderHome() {
  drawAttn('');
  drawTodoProjects((S.workspaces || []).flatMap(w => w.projects.filter(k => S.sessions.some(s => s.project === k))));
  const ws = S.workspaces || [], loose = roots(S.sessions).filter(s => !s.workspace && live(s));
  draw('wscards', [ws.map(w => [w.key, w.live, w.at, w.projects.length, wsNeed(w)]), S.sessions.map(s => [s.id, s.state, s.status, s.workspace]), Object.values(S.boards || {}).map(b => [b.key, b.unread]), tick()], () => {
    const on = ws.filter(w => w.live || wsNeed(w)), quiet = ws.length - on.length;
    $('#wsSub').textContent = `${ws.length} 个 · ${on.length} 个有会话在动${quiet ? `，${quiet} 个安静` : ''}`;
    $('#wsCards').innerHTML = `<div class="ws-grid">${on.map(wsCard).join('')}${quiet ? `<a class="ws-card more" href="#/workspaces"><b>还有 ${quiet} 个安静的工作区</b><span>在「所有工作区」里</span></a>` : ''}</div>`;
  });
  draw('loose', [loose.map(s => [s.id, s.state, s.title, s.summary])], () => {
    $('#looseSec').innerHTML = loose.length ? `<div class="h-title"><h2>不在工作区里</h2><span class="sub">目录不在任何工作区里的会话</span></div><div class="cards">${loose.map(card).join('')}</div>` : '';
  });
}
function renderWorkspaces() {
  const ws = S.workspaces || [];
  draw('wscards', [ws.map(w => [w.key, w.live, w.at, w.projects.length, wsNeed(w)]), S.sessions.map(s => [s.id, s.state, s.status, s.workspace, s.stale]), Object.values(S.boards || {}).map(b => [b.key, b.unread]), tick()], () => {
    $('#wsCards').innerHTML = ws.length ? `<div class="ws-grid">${ws.map(wsCard).join('')}</div>` : '<div class="calm">还没有工作区：会话在某个 git 仓库里干活后，它上面的文件夹就是一个工作区。</div>';
  });
}

// ---------- one workspace ----------
// (its work items in progress: a worktree with a session on it, or not merged into main, or with files not committed)
function workRows(w, all = false) {
  const out = [];
  for (const k of w.projects) {
    const p = projOf(k), f = (p && p.facts) || {}, ss = roots(S.sessions).filter(s => s.project === k && !['gone', 'ended'].includes(s.state));
    for (const x of f.works || []) {
      const on = ss.filter(s => s.work === x.path), open = on.length || (!x.main && (x.ahead > 0 || x.dirty > 0)) || (x.main && x.dirty > 0);
      if (all || open) out.push({ p, x, ss: on, main: x.main, at: Math.max(x.at || 0, ...on.map(s => s.at || 0)) });
    }
    const loose = ss.filter(s => !(f.works || []).some(x => x.path === s.work));
    if (loose.length) out.push({ p, x: null, ss: loose, at: Math.max(...loose.map(s => s.at || 0)) });
  }
  return out.sort((a, b) => (b.ss.length > 0) - (a.ss.length > 0) || Math.min(9, ...a.ss.map(ORDER)) - Math.min(9, ...b.ss.map(ORDER)) || b.at - a.at);
}
function worksTable(rows) {
  if (!rows.length) return `<div class="calm">${I.check}现在没有进行中的工作项。</div>`;
  const now = Date.now() / 1000;
  return `<div class="tbl"><table class="works"><thead><tr><th>项目</th><th>工作项</th><th>会话</th><th>进度</th><th class="r">最近</th></tr></thead><tbody>${rows.map(({ p, x, ss, at }) => {
    const f = p.facts || {}, stale = !ss.length && x && !x.main && x.ahead > 0 && !x.dirty && at && now - at > 3 * 86400;  // (unmerged commits, last one days ago)
    const chips = x ? [x.ahead ? `比 ${esc(f.main)} 多 ${x.ahead} 个提交` : '', x.behind ? `落后 ${x.behind} 个` : '', x.dirty ? `${x.dirty} 个文件没提交` : '',
      !x.main && x.ahead === 0 && !x.dirty ? `已在 ${esc(f.main)} 里` : '', x.main && !x.dirty ? (f.ahead ? `比远端多 ${f.ahead} 个` : f.behind ? `比远端少 ${f.behind} 个` : f.ahead === 0 ? '和远端一致' : '') : ''].filter(Boolean) : [p.git ? '看不出在哪个工作项' : '文件夹'];
    return `<tr data-href="#/p/${encodeURIComponent(p.key)}"><td><a href="#/p/${encodeURIComponent(p.key)}">${esc(p.name)}</a></td>
      <td>${x ? `<span class="br">${esc(x.branch || '（没有分支）')}</span><span class="wt">${x.main ? '主工作区' : 'worktree'}</span>` : '—'}</td>
      <td>${ss.length ? `<span class="who">${ss.map(s => `<span data-go="${esc(s.id)}" title="${esc(s.name)} · ${esc(titleOf(s))}">${mark(s.kind, standing(s)[0], 'xs')}</span>`).join('')}</span>` : '<span class="none">没有会话</span>'}</td>
      <td>${chips.map(c => `<span class="wchip">${c}</span>`).join(' ')}${stale ? ` <span class="wchip stale">停了 ${Math.floor((now - at) / 86400)} 天</span>` : ''}</td><td class="r when">${at ? ago(at) : ''}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function projGrid(keys) {
  return `<div class="pgrid">${keys.map(k => { const p = projOf(k), f = p.facts || {}, n = roots(S.sessions).filter(s => s.project === k && live(s)).length, b = boardOf(k);
    return `<a class="pcard${n ? '' : ' quiet'}" href="#/p/${encodeURIComponent(k)}"><b>${esc(p.name)}</b><span>${n ? `<em>● ${n} 个会话</em> · ` : ''}${p.git ? esc(f.tag || f.main || '') : '文件夹'}${p.at ? ` · ${ago(p.at)}前` : ''}</span>${b && b.unread ? '<i class="bdot" title="讨论区有新消息"></i>' : ''}</a>`; }).join('')}</div>`;
}
function wsFeed(w) {
  const ids = new Set(S.sessions.filter(s => s.workspace === w.key).map(s => s.id)), items = [];
  for (const k of [w.key, ...w.projects]) { const b = boardOf(k); if (b && b.last) items.push({ at: b.last.at, kind: '讨论区', where: k === w.key ? '工作区' : projOf(k).name, who: who(b.last.from), text: b.last.text, href: k === w.key ? `#/b/${encodeURIComponent(k)}` : `#/p/${encodeURIComponent(k)}/board` }); }
  for (const d of S.decisions || []) if (ids.has(d.sid)) items.push({ at: d.at, kind: '决定', who: d.by === 'user' ? '你' : d.name, text: d.what, href: `#/s/${encodeURIComponent(d.sid)}` });
  for (const [sid, r] of Object.entries(S.reports || {})) if (ids.has(sid) && r.r) for (const x of (r.r.refs || []).slice(0, 2)) items.push({ at: r.at, kind: '产出', who: r.name, text: x, href: `#/s/${encodeURIComponent(sid)}/report` });
  items.sort((a, b) => b.at - a.at);
  return items.length ? `<div class="feed">${items.slice(0, 12).map(i => `<a class="fi" href="${i.href}"><span class="k">${i.kind}${i.where ? ' · ' + esc(i.where) : ''}</span><span class="t"><b>${esc(i.who)}</b>：${esc(String(i.text).replace(/\s+/g, ' ').slice(0, 160))}</span><time>${clock(i.at)}</time></a>`).join('')}</div>`
    : '<div class="calm">这个工作区还没有讨论、决定或产出。</div>';
}
function renderWs() {
  const key = route.key;
  if (key === '~') {
    const loose = roots(S.sessions).filter(s => !s.workspace);
    $('#crumbs').innerHTML = `${I.chev}<b>不在工作区里</b>`;
    draw('wshead', ['~'], () => { $('#wsHead').innerHTML = `<div class="t"><h2>不在工作区里</h2><div class="sub"><span>目录不在任何工作区里的会话</span></div></div>`; });
    draw('wsbody', [loose.map(s => [s.id, s.state, s.title, s.summary, s.status])], () => { $('#wsBody').innerHTML = loose.length ? `<div class="cards">${loose.map(card).join('')}</div>` : '<div class="calm">现在没有这样的会话。</div>'; });
    return;
  }
  const w = wsOf(key);
  if (!w) { draw('wshead', ['none', key], () => { $('#wsHead').innerHTML = `<div class="t"><h2>没有这个工作区</h2></div>`; $('#wsBody').innerHTML = `<a class="btn" href="#/">${I.back}回到总览</a>`; }); return; }
  const mine = roots(S.sessions).filter(s => s.workspace === w.key), on = mine.filter(live), c = k => on.filter(s => standing(s)[0] === k).length, b = boardOf(w.key);
  $('#crumbs').innerHTML = `${I.chev}<a href="#/w/${encodeURIComponent(w.key)}">${esc(w.name)}</a>${route.tab !== 'dash' ? `${I.chev}<b>${route.tab === 'projects' ? '项目' : '工作项'}</b>` : `${I.chev}<b>仪表盘</b>`}`;
  draw('wshead', [w.key, w.name, w.path, w.projects.length, c('working'), c('waiting') + c('blocked'), c('review'), c('idle'), b && b.unread], () => {
    $('#wsHead').innerHTML = `<span class="wsdot xl" style="--t:${wsColor(w)}">${esc(w.name.slice(0, 1).toUpperCase())}</span><div class="t"><h2>${esc(w.name)}<em>工作区</em></h2>
        <div class="sub"><span class="nm">${esc(home(w.path))}</span><span>${w.projects.length} 个项目</span><span>${workRows(w).length} 个工作项在进行</span></div></div>
      <div class="right"><span class="legend">${[['waiting', '等你', c('waiting') + c('blocked') + c('review')], ['working', '工作中', c('working')], ['idle', '空闲', c('idle')]]
        .map(([k, l, v]) => `<span class="chip"><span class="dot ${k}"></span><b>${v}</b>${l}</span>`).join('')}</span>
        <a class="btn" href="#/b/${encodeURIComponent(w.key)}" title="这个工作区里所有会话都收得到">${I.chat}讨论区${b && b.unread ? ` · ${b.unread}` : ''}</a><button class="btn" data-newp-ws="${esc(w.key)}">${I.plus}新建会话</button></div>`;
  });
  const sig_ = [w.key, route.tab, w.projects, Object.values(S.projects || {}).filter(p => p.workspace === w.key).map(p => [p.key, p.facts && p.facts.at, p.at]),
    mine.map(s => [s.id, s.state, s.status, s.title, s.summary, s.work, s.project, s.stale, s.needs_you, s.tool]), Object.values(S.boards || {}).map(b => [b.key, b.unread, b.last && b.last.at]), (S.decisions || []).length, Object.keys(S.reports || {}).length, tick(), sig.worksAll];
  if (route.tab === 'projects') {
    draw('wsbody', sig_, () => { $('#wsBody').innerHTML = `<div class="h-title"><h2>项目</h2><span class="sub">${w.projects.length} 个 · 有会话的在前</span></div>${projGrid(w.projects)}`; });
    return;
  }
  if (route.tab === 'works') {
    draw('wsbody', sig_, () => {
      const rows = workRows(w, !!sig.worksAll);
      $('#wsBody').innerHTML = `<div class="h-title"><h2>工作项</h2><span class="sub">一个工作项就是一个 worktree 和它的分支；合进 main、删掉 worktree 就不再出现</span><div class="right seg"><button data-works-all="" class="${sig.worksAll ? '' : 'on'}">进行中</button><button data-works-all="1" class="${sig.worksAll ? 'on' : ''}">全部</button></div></div>${worksTable(rows)}`;
    });
    return;
  }
  drawAttn(w.key);
  drawTodoProjects(w.projects);
  draw('wsbody', sig_, () => {
    $('#wsWorks').innerHTML = worksTable(workRows(w));
    const act = on.filter(s => !s.stale);
    $('#wsCardsSub').textContent = act.length ? `${act.length} 个` : '';
    $('#wsSess').innerHTML = act.length ? `<div class="cards">${act.sort((a, b) => ORDER(a) - ORDER(b)).map(card).join('')}</div>` : '<div class="calm">这个工作区现在没有会话。点「新建会话」开一个。</div>';
    $('#wsProjSub').textContent = `${w.projects.length} 个`;
    $('#wsProj').innerHTML = projGrid(w.projects.slice(0, 12));
    $('#wsFeed').innerHTML = wsFeed(w);
  });
}

// something to get done: the assistant says who of the project's sessions should take it, or to open a new one there
let TREC = null;
async function todoAsk() {
  const text = $('#tText').value.trim();
  if (!text) { $('#tText').focus(); return; }
  const project = $('#tProj').value;
  store.set('deck.todoProj', project);
  $('#tRec').innerHTML = `<div class="rec"><p class="hint">助手在看${project ? ` ${esc(projOf(project).name)} 上` : ''}各个会话在做什么……</p></div>`;
  const j = await api('recommend', { text, project }).catch(e => ({ ok: false, msg: e.message }));
  if (!j.ok) { $('#tRec').innerHTML = `<div class="rec"><p class="hint">${esc(j.msg || '助手没给出建议')}</p></div>`; return; }
  TREC = { ...j, text };
  const to = j.to && S.sessions.find(x => x.id === j.to.id);
  $('#tRec').innerHTML = `<div class="rec"><h4>助手的建议</h4>
    ${to ? `<div class="rec-opt"><div><b>交给「${esc(j.to.title || j.to.name)}」</b><span>${esc(j.to.name)} · ${esc(standing(to)[1])}</span><p>${esc(j.why)}</p></div><button class="btn" data-trec="queue" title="排队：等它空了，助手再看一遍还要不要做">排队</button><button class="btn primary" data-trec="say">${sayHow(to) === 'queue' ? '它这一轮做完就发' : '发给它'}</button></div>` : ''}
    ${j.new ? `<div class="rec-opt"><div><b>新开一个 ${FULL[j.new.kind]} 会话</b><span>${esc(home(j.new.cwd))}${j.new.group ? ' · ' + esc(groupName(j.new.group)) : ''}${j.new.name ? ' · ' + esc(j.new.name) : ''}</span><p>${esc(j.new.why)}</p></div><button class="btn${to ? '' : ' primary'}" data-trec="new">新开并交给它</button></div>` : ''}
    ${!to && !j.new ? `<p class="hint">${esc(j.why || '没找到合适的会话')}</p>` : ''}</div>`;
}
async function takeTodo(which) {
  const r = TREC;
  if (!r) return;
  const j = which === 'say' ? await post('say', { id: r.to.id, text: r.text })
    : which === 'queue' ? await post('queue', { do: 'add', text: r.text, to: r.to.name, mode: 'auto' })
      : await post('new', { kind: r.new.kind, group: r.new.group, mux: muxOf(r.new.group || ''), cwd: r.new.cwd, name: r.new.name, prompt: r.text, jump: false });
  if (j && j.ok) { $('#tText').value = ''; $('#tRec').innerHTML = ''; TREC = null; }
}

function kidRows(s, all) {
  const kids = kidsOf(s);
  if (!kids.length) return '';
  const shown = all ? kids : kids.slice(0, 3);
  return `<div class="kids">${shown.map(c => { const [st, label] = standing(c); return `<div class="kid" data-go="${esc(c.id)}">${mark(c.kind, st, 'xs')}<b>${esc(titleOf(c))}</b><span>${label} ${ago(c.since)}</span></div>`; }).join('')}${kids.length > shown.length ? `<div class="kid more">还有 ${kids.length - shown.length} 个子 agent</div>` : ''}</div>`;
}
function card(s) {
  const [st, label] = standing(s), a = attention(s);
  const k = FULL[s.kind] ? s.kind : 'codex';
  const decs = (S.decisions || []).filter(d => d.sid === s.id).length;
  const tool = s.state === 'working' && s.tool ? `<span class="tool">${esc(toolName(s.tool))}</span>` : '';
  const desc = s.summary || s.said || '';
  const br = s.branch && s.work && (projOf(s.project) || {}).path !== s.work;  // (its own worktree's branch, in place of the decision count)
  return `<article class="card ${k} ${st}" data-go="${esc(s.id)}" data-name="${esc(s.name)}">
    <div class="mk-col">${mark(k, st)}</div>
    <div class="ttl"><b>${esc(titleOf(s))}</b></div>
    <div class="desc${desc ? '' : ' none'}">${esc(desc || (s.unknown ? '这个窗口开得比 amail 早，它下次干活就能认出来' : '还没有总结'))}</div>
    ${s.origin ? `<div class="origin">${I.term}${esc(s.origin)}</div>` : ''}
    ${kidRows(s)}
    ${a && (s.needs_you || s.waiting_for) ? `<div class="need ${ATT[a][1]}"><span><b>${ATT[a][0]}</b>${esc(s.state === 'waiting' && s.waiting_for ? '批准：' + s.waiting_for : s.needs_you)}</span></div>` : ''}
    <div class="foot"><span class="st ${st}"><i></i>${label} ${ago(s.since)}</span>${tool}${br ? `<span class="br" title="${esc(home(s.work))}">${I.branch}${esc(s.branch)}</span>` : decs ? `<span>${decs} 个决定</span>` : ''}<span class="nm" title="${esc((s.loc ? `${groupName(s.loc.session)} › 窗格 ${s.loc.pane} · ` : '') + home(s.cwd))}">${esc(s.name)}</span></div>
    ${s.unread ? `<span class="unread" title="还没读的消息">${s.unread}</span>` : ''}
    <div class="hover-acts">${webOk(s) ? `<button data-go="${esc(s.id)}" data-tab="term" title="进入它的终端">${I.enter}</button>` : ''}<button data-go="${esc(s.id)}" data-tab="report" title="它的报告">${I.doc}</button><button data-go="${esc(s.id)}" data-tab="overview" title="回复它">${I.reply}</button></div>
  </article>`;
}

// ---------- messages: what the sessions say to each other, and to the person ----------
function renderTalk() {
  draw('cmic', [S.voice && S.voice.on], () => { if ($('#cMic')) $('#cMic').innerHTML = micBtn('composeText'); });
  const talk = S.talk || [], fresh = [];
  for (const m of talk) if (!seenTalk.has(m.key)) { seenTalk.add(m.key); if (!firstTalk) fresh.push(m); }
  firstTalk = false;
  $('#talkSub').textContent = `今天 ${talk.filter(m => isToday(m.at)).length} 条`;
  const list = talk.filter(m => railTab === 'talk' || m.from === 'user' || m.to === 'user');
  draw('rail', [railTab, list.map(m => m.key), tick()], () => {
    $('#railList').innerHTML = list.length ? list.slice(0, 200).map(m => `
      <div class="m${fresh.includes(m) ? ' fresh' : ''}${m.from === 'user' || m.to === 'user' ? ' mine' : ''}${openMsgs.has(m.key) ? ' open' : ''}" data-msg="${esc(m.key)}" title="${m.via === 'claude' ? '经 Claude 自带的会话消息' : '经 amail'}">
        ${face(m.from)}<div><div class="route"><b>${esc(who(m.from))}</b>${I.arrow}<b>${esc(who(m.to))}</b><time>${clock(m.at)}</time></div><div class="txt">${md(m.text)}</div></div>
      </div>`).join('') : `<div class="empty-line">${railTab === 'mine' ? '还没有和你有关的消息' : '会话之间还没有说过话'}</div>`;
  });
  const sel = $('#composeTo');
  const opts = ['all', ...S.sessions.filter(s => !['gone', 'ended'].includes(s.state) && !s.unknown).map(s => s.name).sort()];
  if (sel && sel.dataset.opts !== opts.join()) {
    const cur = sel.value;
    sel.innerHTML = opts.map(n => `<option value="${esc(n)}">${n === 'all' ? '所有会话' : esc(n)}</option>`).join('');
    sel.dataset.opts = opts.join();
    if (opts.includes(cur)) sel.value = cur;
  }
}

// ---------- reports: each session in a few lines (what for, what got done, what was decided, where it stands) ----------
function refLabel(x) {
  let m = x.match(/\/([^/]+)\/-\/merge_requests\/(\d+)/);
  if (m) return `${m[1]} !${m[2]}`;
  if ((m = x.match(/github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/))) return `${m[1]} #${m[2]}`;
  return x.replace(/^https?:\/\//, '').slice(0, 48);
}
function repCard(s, rep) {
  const k = FULL[s.kind] ? s.kind : 'codex', [st] = standing(s), r = rep && rep.r;
  const busy = (S.reporting || []).includes(s.id);
  const list = (h, xs) => xs && xs.length ? `<h5>${h}</h5><ul>${xs.map(x => `<li>${mdInline(x)}</li>`).join('')}</ul>` : '';
  return `<article class="rep">
    <header>${mark(k, st, 'sm')}<div class="h"><b data-go="${esc(s.id)}" data-tab="report">${esc(titleOf(s))}</b><span>${esc(s.name)}${rep && rep.at ? ` · ${ago(rep.at)}前更新` : ''}</span></div>
      <button class="btn" data-report="${esc(s.id)}" ${busy ? 'disabled' : ''}>${busy ? '正在写…' : r ? '更新' : '写报告'}</button></header>
    ${r ? `${r.goal ? `<p class="goal">${mdInline(r.goal)}</p>` : ''}
      ${list('做成了', r.done)}
      ${r.decisions && r.decisions.length ? `<h5>决定</h5><ul class="decs">${r.decisions.map(d => `<li><span class="by ${d.by}">${d.by === 'user' ? '你' : 'AI'}</span><span>${mdInline(d.what)}</span></li>`).join('')}</ul>` : ''}
      ${r.now ? `<h5>现在</h5><p>${mdInline(r.now)}</p>` : ''}
      ${list('接下来', r.next)}
      ${r.refs && r.refs.length ? `<h5>产出</h5><div class="refs">${r.refs.map(x => /^https?:\/\//.test(x) ? `<a href="${esc(x)}" target="_blank" rel="noopener noreferrer">${esc(refLabel(x))}</a>` : `<code>${esc(x)}</code>`).join('')}</div>` : ''}`
    : `<p class="hint">${busy ? '正在读它的对话，大约半分钟。' : '还没有报告。'}</p>`}
  </article>`;
}
function renderReports() {
  const reps = S.reports || {};
  const list = roots(S.sessions).filter(s => !s.stale && (reps[s.id] || (!['gone', 'ended'].includes(s.state) && !(s.unknown && !s.summary))));
  draw('reports', [Object.entries(reps).map(([k, v]) => [k, v.at]), S.reporting, list.map(s => [s.id, s.title, s.state, s.status]), tick()], () => {
    const by = new Map();
    for (const s of list) { const k = s.project || (s.workspace ? 'self:' + s.workspace : '~'); if (!by.has(k)) by.set(k, []); by.get(k).push(s); }
    const name = k => k.startsWith('self:') ? `${(wsOf(k.slice(5)) || {}).name || ''} · 工作区本身` : k === '~' ? '不在工作区里' : (projOf(k) || {}).name || k;
    $('#repSub').textContent = `${list.filter(s => reps[s.id]).length} 份 · 会话有新进展时自动更新，最多半小时一次`;
    $('#repList').innerHTML = [...by.keys()].map(k => `<section class="grp"><div class="grp-head"><h3>${projOf(k) ? `<a href="#/p/${encodeURIComponent(k)}">${esc(name(k))}</a>` : esc(name(k))}</h3></div>
      <div class="reps">${by.get(k).map(s => repCard(s, reps[s.id])).join('')}</div></section>`).join('') || '<div class="empty-line">还没有会话</div>';
  });
}

// ---------- a session ----------
function renderSession() {
  const s = S.sessions.find(x => x.id === route.id);
  if (!s) {
    draw('hero', ['missing', route.id], () => { $('#hero').innerHTML = `<div class="s-hero"><div class="row"><h1>这个会话已经不在了</h1></div><div class="tabs"></div></div>`; $('#tabBody').innerHTML = `<div class="s-body"><a class="btn" href="#/">${I.back}回到总览</a></div>`; });
    return;
  }
  const k = FULL[s.kind] ? s.kind : 'codex', [st, label] = standing(s);
  { const w = wsOf(s.workspace), p = projOf(s.project);
    $('#crumbs').innerHTML = (w ? `${I.chev}<a href="#/w/${encodeURIComponent(w.key)}">${esc(w.name)}</a>` : '') + (p ? `${I.chev}<a href="#/p/${encodeURIComponent(p.key)}">${esc(p.name)}</a>` : '')
      + (p && s.work && s.work !== p.path && s.branch ? `${I.chev}<span>${I.branch}${esc(s.branch)}</span>` : '') + `${I.chev}<b>${esc(titleOf(s))}</b>`; }
  draw('hero', [s.id, s.name, st, s.title, s.summary, s.loc, s.cwd, s.project, s.branch, sessTab, tick()], () => {
    $('#hero').innerHTML = `<div class="s-hero ${k}">
      <div class="row">${mark(k, st, 'lg')}<div style="min-width:0"><h1>${esc(titleOf(s))}</h1>
        <div class="sub"><span class="nm">${esc(s.name)}</span>${projOf(s.project) ? `<a class="pj-link" href="#/p/${encodeURIComponent(s.project)}">${I.folder}${esc(projOf(s.project).name)}${s.branch && s.work !== projOf(s.project).path ? ` / ${esc(s.branch)}` : ''}</a>` : ''}${parentOf(s) ? `<span>由 <a data-go="${esc(parentOf(s).id)}">${esc(parentOf(s).name)}</a> 启动</span>` : s.origin && !s.loc ? `<span>${esc(s.origin)}</span>` : ''}<span>${FULL[s.kind] || esc(s.kind)}</span><span>${label} · ${ago(s.since)}</span>${s.loc ? `<span>${esc(groupName(s.loc.session))} › 窗格 ${esc(s.loc.pane)}</span>` : ''}<span title="${esc(s.cwd || '')}">${esc(home(s.cwd))}</span></div></div>
      </div>
      <nav class="tabs">${[['overview', '概览'], ['report', '报告'], ['chat', '对话'], ['term', '终端'], ['msgs', '消息']].map(([t, l]) => `<button data-tab-go="${t}" class="${sessTab === t ? 'on' : ''}">${l}</button>`).join('')}
        <div class="acts"><button class="hbtn" data-act="jump" ${s.loc ? '' : 'disabled'} title="让连着这个组的终端切到它">${I.jump}在终端里打开</button><button class="hbtn primary" data-tab-go="term" ${webOk(s) ? '' : 'disabled'}>${I.enter}进入</button></div></nav></div>`;
  });
  if (sessTab === 'overview') drawOverview(s, k);
  else if (sessTab === 'report') draw('tab', ['report', s.id, (S.reports || {})[s.id], S.reporting, s.title, s.state, tick()], () => { $('#tabBody').innerHTML = `<div class="s-body"><div class="rep-one">${repCard(s, (S.reports || {})[s.id])}</div></div>`; });
  else if (sessTab === 'chat') drawChat(s, k);
  else if (sessTab === 'term') drawTerm(s);
  else drawMsgs(s);
}

function drawOverview(s, k) {
  const a = attention(s);
  const decs = (S.decisions || []).filter(d => d.sid === s.id);
  const typing = document.activeElement && ['rText', 'rName'].includes(document.activeElement.id);
  if (typing && sig.ov) return drawSay(s);
  draw('ov', [s.id, s.summary, s.needs_you, s.waiting_for, a, s.said, s.loc, s.cwd, s.session, decs.length, s.summary_at && Math.floor(s.summary_at / 30), tick(), kidsOf(s).map(c => [c.id, c.state, c.status, c.summary]),
    s.project, s.workspace, s.attrib, s.work, s.branch, Object.keys(S.projects || {}).length], () => {
    const keep = $('#rText') ? $('#rText').value : '';
    $('#tabBody').innerHTML = `<div class="s-body"><div class="s-grid"><div>
      ${a ? `<div class="need-box ${ATT[a][1]}"><div class="k">${ATT[a][0]}</div><p>${esc(s.state === 'waiting' && s.waiting_for ? '在等你批准：' + s.waiting_for : s.needs_you || s.summary || '')}</p>${replyBox(s)}</div>`
        : `<div class="panel"><h4>写给它</h4>${replyBox(s)}</div>`}
      <div class="panel"><h4>现在在做<span class="r hint">${s.summary_at ? '总结于 ' + ago(s.summary_at) + '前' : ''}</span></h4><div class="now ${k === 'claude' ? 'serif' : k === 'codex' ? 'mono' : ''}">${esc(s.summary || '还没有总结')}</div></div>
      ${s.said ? `<div class="panel"><h4>它最后说的话</h4><div class="said">${md(s.said)}</div></div>` : ''}
      ${kidsOf(s).length ? `<div class="panel"><h4>它启动的子 agent<span class="r hint">${kidsOf(s).length} 个</span></h4><div class="kid-list">${kidsOf(s).map(c => { const [st, label] = standing(c); return `
        <div class="kid-row">${mark(c.kind, st, 'sm')}<div data-go="${esc(c.id)}"><b>${esc(titleOf(c))}</b><p>${esc(label)} ${ago(c.since)} · ${esc(c.name)}${c.summary ? ' · ' + esc(c.summary) : ''}</p></div>
          ${['gone', 'ended'].includes(c.state) ? '' : `<button class="btn" data-stop="${esc(c.id)}">停止</button>`}</div>`; }).join('')}</div></div>` : ''}
    </div><div>
      <div class="panel"><h4>决定<span class="r hint">${decs.length} 条</span></h4><div class="d-list">${decs.length ? decs.map(d => `<div class="dec"><span class="by ${d.by}">${d.by === 'user' ? '你' : 'AI'}</span><div class="w">${esc(d.what)}</div><time>${clock(d.at)}</time></div>`).join('') : '<div class="hint">还没有记下决定。会话里拍板的事会自动记在这里。</div>'}</div></div>
      <div class="panel"><h4>在哪里</h4><dl class="kv">${parentOf(s) ? `<dt>启动者</dt><dd><a data-go="${esc(parentOf(s).id)}">${esc(parentOf(s).name)}</a></dd>` : s.origin ? `<dt>启动方式</dt><dd>${esc(s.origin)}</dd>` : ''}
        <dt>项目</dt><dd>${projSelect(s)}</dd><dt>工作项</dt><dd>${s.work ? esc(home(s.work)) + (s.branch ? `（${esc(s.branch)}）` : '') : '—'}</dd>
        <dt>组</dt><dd>${s.loc ? esc(groupName(s.loc.session)) + (s.loc.mux === 'tmux' ? '（tmux）' : '') : groupName('~none')}</dd><dt>窗格</dt><dd>${s.loc ? esc(s.loc.pane) : '—'}</dd>
        <dt>目录</dt><dd>${esc(home(s.cwd) || '—')}</dd><dt>会话 ID</dt><dd>${esc(s.session || '—')}</dd>${s.loc ? `<dt>命令行</dt><dd>${esc(attachCmd(s.loc.session))}</dd>` : ''}</dl></div>
      <div class="panel"><h4>名字</h4>${s.kind === 'claude' ? `<div class="hint">Claude 会话的名字由它自己定：在那个会话里输入 <code>/rename 新名字</code>，这里、amail 和窗格标题会跟着变。</div>`
        : `<div class="inline"><input class="field" id="rName" placeholder="新名字（字母、数字、_ . -）"><button class="btn" data-act="rename">改名</button></div>`}</div>
    </div></div></div>`;
    if ($('#rText')) $('#rText').value = keep;
  });
  drawSay(s);
}
function drawSay(s) { draw('say', [s.id, sayHow(s), S.voice && S.voice.on, sig.ov], () => { if ($('#sayRow')) $('#sayRow').innerHTML = sayRow(s); }); }
// words for it: one way to send, which follows how it stands (as the deck's say_how)
const SAY = {
  type: ['发到它的终端', '它空着：像你在它终端里敲一样，马上送到。'],
  queue: ['等它这一轮做完再发', '它正在做事：你的原话会在它这一轮做完时送到。急的话「现在就插进去」，它自己的命令行会接着处理。'],
  mail: ['放进它的信箱', '它不在 Zellij 或 tmux 里：放进它的 amail 信箱，它下一步就会看到。'],
  menu: ['先进终端处理', '它停在一个授权或选择提示上，这时打进去的字会被当成对提示的回答：先进终端处理它。'],
  gone: ['已经退出了', '它已经退出了。'],
};
function replyBox(s) {
  return `<div class="reply"><textarea id="rText" placeholder="对 ${esc(s.name)} 说……  ⌘/Ctrl+Enter 发送"></textarea><div class="row" id="sayRow">${sayRow(s)}</div></div>`;
}
function sayRow(s) {
  const how = sayHow(s), [label, hint] = SAY[how];
  return `${micBtn('rText')}<button class="btn" data-act="draft">${I.spark}帮我起草</button><span class="sp"></span>
    ${how === 'queue' ? '<button class="btn" data-act="say-now" title="不等了：现在就打进它的终端">现在就插进去</button>' : ''}
    ${how === 'menu' ? `<button class="btn dark" data-tab-go="term" ${webOk(s) ? '' : 'disabled'}>${I.enter}${label}</button>` : `<button class="btn primary" data-act="say" ${how === 'gone' ? 'disabled' : ''}>${how === 'type' ? I.enter : how === 'mail' ? I.mail : I.arrow}${label}</button>`}
    <div class="say-hint">${hint}</div>`;
}
// which project it counts as: as found (its folder, the files it works on), or the person's word
function projSelect(s) {
  const w = wsOf(s.workspace), keys = w ? w.projects : Object.keys(S.projects || {});
  const found = { cwd: '按它的目录', files: '按它改的文件', workspace: '它在工作区顶层', manual: '', '': '看不出' }[s.attrib || ''] ?? '';
  const cur = s.attrib === 'manual' ? (s.project || (s.workspace ? 'w:' + s.workspace : '')) : '';
  return `<select class="sel" data-attrib="${esc(s.id)}"><option value="">${s.attrib === 'manual' ? '改回自动判断' : `${found}：${s.project ? esc(projOf(s.project).name) : '没有项目'}`}</option>
    ${keys.map(k => `<option value="${esc(k)}"${cur === k ? ' selected' : ''}>${esc(projOf(k).name)}</option>`).join('')}${w ? `<option value="w:${esc(w.key)}"${cur === 'w:' + w.key ? ' selected' : ''}>工作区本身</option>` : ''}</select>`;
}

// ---------- a project: its work items and their sessions, its channel, its sessions ----------
function renderProject() {
  const p = projOf(route.key);
  if (!p) {
    draw('hero', ['missing', route.key], () => { $('#hero').innerHTML = `<div class="s-hero"><div class="row"><h1>没有这个项目</h1></div><div class="tabs"></div></div>`; $('#tabBody').innerHTML = `<div class="s-body"><a class="btn" href="#/">${I.back}回到总览</a></div>`; });
    return;
  }
  const w = wsOf(p.workspace), f = p.facts || {}, b = boardOf(p.key), ss = S.sessions.filter(x => x.project === p.key), tab = route.tab;
  $('#crumbs').innerHTML = `${w ? `${I.chev}<a href="#/w/${encodeURIComponent(w.key)}">${esc(w.name)}</a>` : ''}${I.chev}<b>${esc(p.name)}</b>`;
  draw('hero', [p.key, p.name, f.main, f.tag, f.url, f.ahead, f.behind, b && b.unread, ss.length, tab], () => {
    const up = f.ahead || f.behind ? ` · 比远端${f.ahead ? `多 ${f.ahead} 个提交` : ''}${f.ahead && f.behind ? '、' : ''}${f.behind ? `少 ${f.behind} 个` : ''}` : f.ahead === 0 ? ' · 和远端一致' : '';
    $('#hero').innerHTML = `<div class="s-hero proj"><div class="row"><span class="mark lg pj">${I.folder}</span><div style="min-width:0"><h1>${esc(p.name)}</h1>
        <div class="sub">${w ? `<span>工作区 ${esc(w.name)}</span>` : ''}<span class="nm">${esc(home(p.path))}</span>${p.git ? `<span>${I.branch}${esc(f.main || '')}${f.tag ? ' · ' + esc(f.tag) : ''}${up}</span>` : '<span>文件夹，不是 git 仓库</span>'}${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.url.replace(/^https:\/\//, ''))}</a>` : ''}</div></div>
      </div>
      <nav class="tabs">${[['overview', '概览'], ['board', '讨论' + (b && b.unread ? ` · ${b.unread} 条新` : '')], ['sessions', `会话 · ${ss.length}`]].map(([t, l]) => `<button data-ptab="${t}" class="${tab === t ? 'on' : ''}">${esc(l)}</button>`).join('')}
        <div class="acts"><button class="hbtn primary" data-newp="${esc(p.key)}">${I.plus}在这里新建会话</button></div></nav></div>`;
  });
  if (tab === 'board') {
    if (!$('#boardBox')) { $('#tabBody').innerHTML = `<div class="s-body wide" id="boardBox"></div>`; BD.key = null; }
    drawBoard(p.key, $('#boardBox'));
  } else if (tab === 'sessions') {
    draw('tab', ['psess', p.key, ss.map(x => [x.id, x.state, x.status, x.title, x.summary, x.stale, x.needs_you, x.tool]), tick()], () => {
      $('#tabBody').innerHTML = `<div class="s-body wide">${ss.length ? `<div class="cards">${ss.map(card).join('')}</div>` : '<div class="calm">现在没有会话在这个项目上。</div>'}</div>`;
    });
  } else drawProjOverview(p, ss);
}
function drawProjOverview(p, ss) {
  const f = p.facts || {}, b = boardOf(p.key);
  const decs = (S.decisions || []).filter(d => ss.some(x => x.id === d.sid)).slice(0, 14);
  const lock = (S.locks || []).find(l => 'p-' + l.key === p.key);
  const refs = [...new Set(ss.flatMap(x => (((S.reports || {})[x.id] || {}).r || {}).refs || []))].slice(0, 10);
  draw('tab', ['pov', p.key, f.at, ss.map(x => [x.id, x.state, x.status, x.title, x.work, x.stale, x.attrib]), b && [b.unread, b.last && b.last.at, b.topics.map(t => [t.id, t.closed])], decs.length, lock && [lock.holder, lock.branch], refs, tick(), [...quietOpen]], () => {
    const works = (f.works || []).map(w => ({ ...w, ss: ss.filter(x => x.work === w.path) }));
    const loose = ss.filter(x => !works.some(w => w.ss.includes(x)));
    const busy = works.filter(w => w.ss.length || w.main).sort((a, c) => c.ss.length - a.ss.length || a.main - c.main || c.at - a.at), idle = works.filter(w => !w.ss.length && !w.main);
    const sRow = x => { const [st, label] = standing(x); return `<div class="wi-s" data-go="${esc(x.id)}">${mark(x.kind, st, 'sm')}<b>${esc(titleOf(x))}</b><span><em class="${st}">${label}</em> · ${esc(x.name)}${x.attrib === 'files' ? ' · 按它改的文件' : x.attrib === 'manual' ? ' · 你指定的' : ''}</span></div>`; };
    const chips = w => [w.ahead ? `比 ${esc(f.main)} 多 ${w.ahead} 个提交` : '', w.behind ? `落后 ${w.behind} 个` : '', w.dirty ? `${w.dirty} 个文件没提交` : '', !w.main && w.ahead === 0 ? '已经在 ' + esc(f.main) + ' 里' : '']
      .filter(Boolean).map(c => `<span class="wchip">${c}</span>`).join('');
    const wi = w => `<div class="wi${w.main ? ' main' : ''}"><div class="wi-head">${I.branch}<b>${esc(w.branch || '（没有分支）')}</b>${w.main ? '<span class="tag">主工作区</span>' : ''}<span class="sp"></span>${chips(w)}</div>
      <div class="wi-path">${esc(home(w.path))}${w.subject ? ` · <code>${esc(w.head)}</code> ${esc(w.subject)} · ${ago(w.at)}前` : ''}</div>
      ${w.ss.length ? `<div class="wi-ss">${w.ss.map(sRow).join('')}</div>` : ''}</div>`;
    const qk = 'wi:' + p.key;
    const left = `<div class="panel"><h4>工作项<span class="r hint">${works.length ? `${works.length} 个 worktree · 一个工作项就是一个 worktree 和它的分支` : ''}</span></h4>
      ${p.git ? busy.map(wi).join('') : '<div class="hint">这个项目是个文件夹，没有分支和 worktree。</div>'}
      ${loose.length ? `<div class="wi loose"><div class="wi-head"><b>看不出在哪个工作项</b></div><div class="wi-ss">${loose.map(sRow).join('')}</div></div>` : ''}
      ${idle.length ? `<button class="quiet-tg" data-quiet="${esc(qk)}">${chev(quietOpen.has(qk))}没有会话的 ${idle.length} 个工作项</button>${quietOpen.has(qk) ? idle.map(wi).join('') : ''}` : ''}
      ${!ss.length ? '<div class="hint" style="margin-top:10px">现在没有会话在这个项目上。</div>' : ''}</div>`;
    const open = b ? b.topics.filter(t => !t.closed) : [];
    const right = `<div class="panel"><h4>讨论区<span class="r"><a class="lnk" href="#/p/${encodeURIComponent(p.key)}/board">打开</a></span></h4>
        ${b && b.last ? `<div class="m">${face(b.last.from)}<div><div class="route"><b>${esc(who(b.last.from))}</b><time>${clock(b.last.at)}</time></div><div class="txt">${md(b.last.text)}</div></div></div>${b.unread ? `<div class="hint">${b.unread} 条新消息</div>` : ''}`
          : '<div class="hint">还没有人在这里说过话。发在这里的话，在这个项目上工作的会话都会收到。</div>'}
        ${open.map(t => `<a class="topic-line" href="#/p/${encodeURIComponent(p.key)}/board" data-topic-open="${esc(t.id)}">${I.chat}<b>${esc(t.title)}</b><span>${t.members.length} 方在谈</span></a>`).join('')}</div>
      ${lock ? `<div class="panel"><h4>推送锁</h4><div class="hint">${I.lock} ${esc(lock.branch)} 被 ${esc(lock.holder)} 锁着，${ago(lock.since)}前锁上${lock.note ? '：' + esc(lock.note) : ''}</div></div>` : ''}
      <div class="panel"><h4>决定<span class="r hint">${decs.length} 条</span></h4><div class="d-list">${decs.length ? decs.map(d => `<div class="dec"><span class="by ${d.by}">${d.by === 'user' ? '你' : 'AI'}</span><div class="w">${esc(d.what)}<div class="src">${esc(d.name)}</div></div><time>${clock(d.at)}</time></div>`).join('') : '<div class="hint">这个项目上的会话还没记下决定。</div>'}</div></div>
      ${refs.length ? `<div class="panel"><h4>产出</h4><div class="refs">${refs.map(x => /^https?:\/\//.test(x) ? `<a href="${esc(x)}" target="_blank" rel="noopener noreferrer">${esc(refLabel(x))}</a>` : `<code>${esc(x)}</code>`).join('')}</div></div>` : ''}`;
    $('#tabBody').innerHTML = `<div class="s-body wide"><div class="s-grid">${left}<div>${right}</div></div></div>`;
  });
}

// ---------- a channel: a project's (or a workspace's) room, its discussions ----------
let BD = { key: null }, OPEN_TOPIC = '';
function drawBoard(key, box) {
  if (!box) return;
  if (BD.key !== key || !$('#bPosts')) {
    BD = { key, topic: OPEN_TOPIC, data: null, sig: '', at: 0, form: false, seen: 0, drawn: false };
    OPEN_TOPIC = '';
    box.innerHTML = `<div class="board"><aside class="b-side" id="bSide"></aside><section class="b-main"><div id="bForm"></div><div id="bHead"></div><div class="b-posts" id="bPosts"><div class="hint">读取中……</div></div>
      <form class="composer b-comp" id="bComp" autocomplete="off"><div class="composer-box"><textarea id="bText" rows="1"></textarea><span id="bMic"></span><button class="send" type="submit" title="发送">${I.arrow}</button></div><div class="b-calls" id="bCalls"></div></form></section></div>`;
    const ta = $('#bText');
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; });
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#bComp').requestSubmit(); } });
    $('#bComp').addEventListener('submit', async e => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text) return;
      const j = await post('board_post', { key, text, topic: BD.topic || '' });
      if (j && j.ok) { ta.value = ''; ta.style.height = 'auto'; BD.drawn = false; boardFetch(); }
    });
  }
  const b = boardOf(key), sg = JSON.stringify(b ? [b.last && b.last.at, b.topics.map(t => [t.id, t.closed, t.members.length]), b.members] : null);
  if (sg !== BD.sig || Date.now() - BD.at > 20000) { BD.sig = sg; boardFetch(); }
  if (b && b.unread && BD.seen !== (b.last && b.last.at)) { BD.seen = b.last && b.last.at; api('board_seen', { key }).catch(() => {}); }
  draw('bmic', [S.voice && S.voice.on, key], () => { if ($('#bMic')) $('#bMic').innerHTML = micBtn('bText'); });
}
async function boardFetch() {
  const key = BD.key;
  BD.at = Date.now();
  let j = null;
  try { j = await (await fetch('/api/board?key=' + encodeURIComponent(key), { cache: 'no-store' })).json(); } catch {}
  if (!j || BD.key !== key) return;
  BD.data = j;
  drawBoardBody();
}
const atLinks = h => { let inA = false; return h.split(/(<[^>]*>)/).map(x => {
  if (x.startsWith('<')) { if (/^<a[\s>]/.test(x)) inA = true; else if (x === '</a>') inA = false; return x; }
  return inA ? x : x.replace(/(^|[^A-Za-z0-9_.@\/-])@([A-Za-z0-9][A-Za-z0-9_.-]{0,40}[A-Za-z0-9_]|[A-Za-z0-9])/g, '$1<span class="at">@$2</span>');
}).join(''); };
function drawBoardBody() {
  const d = BD.data || { posts: [], topics: [], members: [] }, key = BD.key;
  let t = BD.topic && d.topics.find(x => x.id === BD.topic);
  if (BD.topic && !t) { BD.topic = ''; t = null; }
  const count = id => d.posts.filter(p => p.topic === id).length, closed = d.topics.filter(x => x.closed);
  $('#bSide').innerHTML = `<button class="btn b-new" data-bform>${I.plus}发起讨论</button>
    <div class="b-t${!t ? ' on' : ''}" data-btopic="">${I.chat}<b>全部</b><span>${d.posts.length}</span></div>
    ${d.topics.filter(x => !x.closed).map(x => `<div class="b-t${t && t.id === x.id ? ' on' : ''}" data-btopic="${esc(x.id)}"><i class="live"></i><b>${esc(x.title)}</b><span>${count(x.id)}/${x.max}</span></div>`).join('')}
    ${closed.length ? `<div class="b-sub">结束了的</div>${closed.map(x => `<div class="b-t done${t && t.id === x.id ? ' on' : ''}" data-btopic="${esc(x.id)}"><i></i><b>${esc(x.title)}</b><span>${count(x.id)}</span></div>`).join('')}` : ''}
    <div class="b-sub">收得到这里的会话</div><div class="b-members">${d.members.length ? d.members.map(n => `<span class="b-mem" title="${esc(n)}">${face(n)}<span>${esc(n)}</span></span>`).join('') : '<span class="hint">还没有。在这个项目上工作的会话下一轮开始时加入。</span>'}</div>`;
  $('#bHead').innerHTML = t ? `<div class="b-topic"><div><b>${esc(t.title)}</b><span>${t.members.map(n => esc(who(n))).join('、')} · ${count(t.id)}/${t.max} 条${t.closed ? ' · 已结束' : ''}</span></div>${t.closed ? '' : `<button class="btn" data-bclose="${esc(t.id)}">结束讨论</button>`}</div>` : '';
  const list = t ? d.posts.filter(p => p.topic === t.id) : d.posts, box = $('#bPosts'), atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.innerHTML = list.length ? list.map(p => postHtml(p, d, t)).join('') : `<div class="b-empty">${t ? '这场讨论还没有人发言。' : '还没有人在这里说过话。<br>发在这里的话，收得到这里的会话下一轮开始时都会看到；写 @名字 叫某个会话马上来看，@all 叫所有人。'}</div>`;
  if (atEnd || !BD.drawn) box.scrollTop = box.scrollHeight;
  BD.drawn = true;
  const ta = $('#bText'), shut = !!(t && t.closed), b = boardOf(key);
  ta.disabled = shut;
  ta.placeholder = shut ? '这场讨论已经结束了' : t ? `在「${t.title}」里说……  参加的会话马上会看到` : `写到${(b && b.kind === 'workspace') || wsOf(key) ? '工作区' : '项目'}的讨论区……  Enter 发送，@名字 叫某个会话`;
  const callable = S.sessions.filter(x => live(x) && !x.unknown && (x.project === key || x.workspace === key || d.members.includes(x.name)));
  $('#bCalls').innerHTML = callable.length && !shut ? `<span>叫：</span>${callable.map(x => `<button type="button" class="b-call" data-bcall="${esc(x.name)}" title="${esc(titleOf(x))}">${mark(x.kind, standing(x)[0], 'xs')}${esc(x.name)}</button>`).join('')}` : '';
}
function postHtml(p, d, cur) {
  const t = p.topic && d.topics.find(x => x.id === p.topic), sys = ['amail', 'sturnus'].includes(p.from);
  const tag = t && !cur ? `<a class="ptag" data-btopic="${esc(t.id)}">${p.title ? '发起 · ' : ''}${esc(t.title)}</a>` : p.title ? '<span class="ptag">发起</span>' : '';
  return `<div class="post${p.from === 'user' ? ' mine' : ''}${sys ? ' sys' : ''}">${p.from === 'user' ? mark('user', '', 'sm') : MARK[p.kind] ? mark(p.kind, '', 'sm') : face(p.from)}
    <div class="pb"><div class="ph"><b>${esc(who(p.from))}</b>${FULL[p.kind] ? `<span>${FULL[p.kind]}</span>` : ''}${tag}<time>${clock(p.at)}</time></div><div class="pt">${atLinks(md(p.text))}</div></div></div>`;
}
function drawTopicForm() {
  const key = BD.key, el = $('#bForm');
  if (!el) return;
  if (!BD.form) { el.innerHTML = ''; return; }
  const cands = S.sessions.filter(x => live(x) && !x.unknown).sort((a, c) => (c.project === key) - (a.project === key) || ORDER(a) - ORDER(c));
  el.innerHTML = `<div class="b-form"><h4>发起讨论</h4>
    <input class="field" id="tfTitle" placeholder="题目，比如：辩论——留言板要不要按话题分">
    <div class="b-sub">请谁来（Claude、Codex、Cursor 都可以，不在这个项目上的也行）</div>
    <div class="b-pick">${cands.map(x => `<label class="pk"><input type="checkbox" value="${esc(x.name)}">${mark(x.kind, standing(x)[0], 'xs')}<b>${esc(x.name)}</b><span>${esc(titleOf(x))}${x.project && x.project !== key ? ' · ' + esc((projOf(x.project) || {}).name || '') : ''}</span></label>`).join('') || '<span class="hint">现在没有在跑的会话</span>'}</div>
    <textarea class="area" id="tfText" rows="3" placeholder="开场：要讨论什么、各自的角色（比如谁是正方、谁是反方）、要得出什么"></textarea>
    <div class="row"><span class="hint">最多</span><input class="field num" id="tfMax" type="number" min="2" max="200" value="24"><span class="hint">条后自动结束 · 请来的会话马上会被叫来</span><span class="sp"></span><button type="button" class="btn" data-bform>取消</button><button type="button" class="btn primary" data-tfgo>发起</button></div></div>`;
  setTimeout(() => $('#tfTitle') && $('#tfTitle').focus(), 20);
}
async function topicGo() {
  const title = $('#tfTitle').value.trim();
  if (!title) { $('#tfTitle').focus(); return; }
  const invite = [...document.querySelectorAll('.b-pick input:checked')].map(x => x.value);
  const j = await post('topic_new', { key: BD.key, title, text: $('#tfText').value.trim(), invite, max: +$('#tfMax').value || 24 });
  if (j && j.ok) { BD.form = false; drawTopicForm(); BD.topic = j.topic || ''; BD.drawn = false; boardFetch(); }
}
function renderBoardPage() {  // (a workspace's channel; under 讨论, any channel, staying in that list)
  if (route.name === 'board' && projOf(route.key)) { location.replace(`#/p/${encodeURIComponent(route.key)}/board`); return; }
  const b = boardOf(route.key), w = wsOf(route.key), p = projOf(route.key), name = w ? w.name : p ? p.name : b ? b.name : route.key;
  $('#crumbs').innerHTML = route.name === 'boards' ? `${I.chev}<a href="#/boards">讨论</a>${I.chev}<b>${esc(name)}</b>` : `${I.chev}<a href="#/w/${encodeURIComponent(route.key)}">${esc(name)}</a>${I.chev}<b>讨论区</b>`;
  draw('hero', ['b', route.key, name], () => {
    $('#hero').innerHTML = `<div class="s-hero proj"><div class="row"><span class="mark lg pj">${I.chat}</span><div style="min-width:0"><h1>${esc(name)}${w ? ' 工作区' : ''}</h1>
      <div class="sub"><span>${w ? '这个工作区里所有的会话都收得到这里的消息' : p ? `项目 ${esc(p.name)} 的讨论区：在这个项目上工作的会话都收得到` : '讨论区'}</span>${w ? `<span class="nm">${esc(home(w.path))}</span>` : ''}</div></div></div><div class="tabs"></div></div>`;
  });
  drawBoard(route.key, $('#boardBox'));
}
function renderBoards() {
  draw('blist', [(S.workspaces || []).map(w => [w.key, w.projects]), Object.values(S.boards || {}).map(b => [b.key, b.unread, b.last && b.last.at, b.topics.length]), S.sessions.map(x => x.project), tick()], () => {
    const row = (k, name, kind, href) => {
      const b = boardOf(k), open = b ? b.topics.filter(t => !t.closed).length : 0;
      return `<a class="b-row" href="${href}"><span class="mark sm pj">${kind === 'workspace' ? I.chat : I.folder}</span><div class="t"><b>${esc(name)}</b>${b && b.last ? `<p><em>${esc(who(b.last.from))}</em>：${esc(b.last.text.replace(/\s+/g, ' ').slice(0, 120))}</p>` : '<p class="none">还没有人说过话</p>'}</div>
        <div class="r">${open ? `<span class="hint">${open} 场讨论</span>` : ''}${b && b.unread ? `<span class="n hot">${b.unread}</span>` : ''}${b && b.last ? `<time>${ago(b.last.at)}</time>` : ''}</div></a>`;
    };
    $('#bList').innerHTML = (S.workspaces || []).map(w => `<section class="grp"><div class="grp-head"><h3>${esc(w.name)}</h3><span class="meta"><span>${esc(home(w.path))}</span></span></div><div class="b-rows">
      ${row(w.key, `${w.name} 工作区`, 'workspace', `#/b/${encodeURIComponent(w.key)}`)}
      ${w.projects.filter(k => boardOf(k) || S.sessions.some(x => x.project === k)).map(k => row(k, projOf(k).name, 'project', `#/p/${encodeURIComponent(k)}/board`)).join('')}</div></section>`).join('') || '<div class="empty-line">还没有工作区</div>';
  });
}

let chatTimer = null;
async function drawChat(s, k) {
  if (sig.chatFor !== s.id) {
    sig.chatFor = s.id;
    $('#tabBody').innerHTML = `<div class="s-body"><div class="convo" id="convo"><div class="hint">读取对话……</div></div><div class="chat-say">${replyBox(s)}</div></div>`;
  }
  drawSay(s);
  if (chatTimer && Date.now() - chatTimer < 5000) return;
  chatTimer = Date.now();
  try {
    const j = await (await fetch('/api/transcript?id=' + encodeURIComponent(s.id), { cache: 'no-store' })).json();
    const items = j.items || [];
    if (!draw('chat', [items.length, items.length && items[items.length - 1].text.slice(0, 50)], () => {
      const box = $('#convo'); if (!box) return;
      const sess = $('#sess'), atEnd = sess.scrollHeight - sess.scrollTop - sess.clientHeight < 80;
      box.innerHTML = items.length ? items.map(it => `<div class="bub ${it.who}${it.who === 'assistant' ? ' ' + k : ''}">${it.who === 'tool' ? esc(it.text) : md(it.text)}${it.at && it.who !== 'tool' ? `<time>${clock(it.at)}</time>` : ''}</div>`).join('') : '<div class="hint">读不到它的对话记录。</div>';
      if (atEnd || sig.chatFirst !== s.id) { sig.chatFirst = s.id; sess.scrollTop = sess.scrollHeight; }
    })) return;
  } catch {}
}

// the terminal in the page: xterm.js, a websocket to a client of the agent's group (Zellij or tmux) on its pane
let termFor = null, xt = null;
function loadXterm() {
  if (window.Terminal && window.FitAddon) return Promise.resolve();
  const add = (tag, attrs) => new Promise((ok, bad) => { const e = Object.assign(document.createElement(tag), attrs); e.onload = ok; e.onerror = bad; document.head.appendChild(e); });
  return add('link', { rel: 'stylesheet', href: 'vendor/xterm.css' }).then(() => add('script', { src: 'vendor/xterm.js' }))
    .then(() => Promise.all([add('script', { src: 'vendor/addon-fit.js' }), add('script', { src: 'vendor/addon-webgl.js' })]));
}
function closeTerm() { if (xt) { const t = xt; xt = null; t.ro.disconnect(); try { t.ws.close(); } catch {} t.term.dispose(); } termFor = null; }
function termNote(title, text, retry) {
  const n = $('#termNote');
  if (n) { n.hidden = false; n.innerHTML = `<div class="box"><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${retry ? `<p><button class="btn" data-act="retry-term">重新连接</button></p>` : ''}</div>`; }
}
async function drawTerm(s) {
  if (termFor === s.id && $('#xterm')) return;
  closeTerm();
  termFor = s.id;
  $('#tabBody').innerHTML = `<div class="s-body full"><div class="term-wrap"><div id="xterm"></div><div class="term-note" id="termNote" hidden></div></div></div>`;
  fitTerm();
  if (!s.loc) return termNote('进不去', s.group ? '这个组已经不在了。' : '这个会话不在 Zellij 或 tmux 里。');
  try { await loadXterm(); } catch { return termNote('终端组件没加载出来', '刷新页面再试一次。', true); }
  if (termFor !== s.id || !$('#xterm')) return;
  const term = new Terminal({ fontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace', fontSize: 13, lineHeight: 1.15, cursorBlink: true, scrollback: 5000,
    theme: { background: '#0b0b0d', foreground: '#e6e6ea', cursor: '#e6e6ea', selectionBackground: 'rgba(255,255,250,.22)' } });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open($('#xterm'));
  try { term.loadAddon(new WebglAddon.WebglAddon()); } catch {}  // (draws box and powerline glyphs itself; the plain renderer stays without WebGL)
  try { fit.fit(); } catch {}
  const at = s.group ? `group=${encodeURIComponent(s.group)}&pane=${encodeURIComponent(s.pane || '')}` : `id=${encodeURIComponent(s.id)}`;
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/term?${at}&cols=${term.cols}&rows=${term.rows}`);
  ws.binaryType = 'arraybuffer';
  const enc = new TextEncoder(), send = b => ws.readyState === 1 && ws.send(b);
  ws.onmessage = e => term.write(new Uint8Array(e.data));
  ws.onclose = e => {
    if (!xt || xt.ws !== ws) return;
    if (e.code !== 4001) return termNote('连接断开了', '它的会话还在，只是这个网页终端断了。', true);
    let r = {}; try { r = JSON.parse(e.reason); } catch {}
    termNote('没有接上，免得 Zellij 崩掉', `这个 Zellij 已经开着 ${r.held} 个文件，上限 ${r.limit}。网页终端是它的又一个客户端，要再开约 ${r.need} 个；超过上限 Zellij 会崩掉，里面的会话全部结束。先关掉一个连着它的终端再试；要多连几个，调高上限后重启 Zellij（见 README）。`, true);
  };
  term.onData(d => send(enc.encode(d)));
  term.onBinary(d => send(Uint8Array.from(d, c => c.charCodeAt(0) & 255)));
  term.onResize(({ cols, rows }) => send(JSON.stringify({ cols, rows })));
  const ro = new ResizeObserver(() => { try { fit.fit(); } catch {} });
  ro.observe($('#xterm'));
  document.fonts.ready.then(() => { try { fit.fit(); } catch {} });  // (measured again in its own font)
  xt = { term, ws, ro };
  term.focus();
}
function fitTerm() { const b = $('.s-body.full'); if (b) { const top = b.getBoundingClientRect().top; b.style.height = `calc(100vh - ${top}px - 30px)`; } }
window.addEventListener('resize', fitTerm);

function drawMsgs(s) {
  const thread = (S.talk || []).filter(m => m.from === s.name || m.to === s.name);
  draw('msgs', [s.id, thread.map(m => m.key)], () => {
    $('#tabBody').innerHTML = `<div class="s-body"><div class="panel" style="max-width:820px"><h4>和它有关的消息<span class="r hint">${thread.length} 条</span></h4>${thread.length ? thread.map(m => `
      <div class="m${openMsgs.has(m.key) ? ' open' : ''}" data-msg="${esc(m.key)}">${face(m.from)}<div><div class="route"><b>${esc(who(m.from))}</b>${I.arrow}<b>${esc(who(m.to))}</b><time>${clock(m.at)}</time></div><div class="txt">${md(m.text)}</div></div></div>`).join('') : '<div class="hint">还没有。</div>'}</div></div>`;
  });
}

// ---------- the queue ----------
let qMode = 'auto';
const QST = { ready: '可以发了', waiting: '在等', checking: '助手在看', held: '先等等', sent: '已发出', dropped: '不用发了' };
// who should take it: the assistant picks within the group (or offers a new session there)
let REC = null;
async function recommend() {
  const text = $('#qText').value.trim();
  if (!text) { $('#qText').focus(); return; }
  const [kind, val] = $('#qTo').value.split(':');
  const group = kind === 'g' ? val : kind === 's' ? ((S.sessions.find(s => s.name === val) || {}).loc || {}).session || '' : '';
  $('#qRec').innerHTML = `<div class="rec"><p class="hint">助手在看${group ? ` ${esc(groupName(group))} 组里` : ''}各个会话在做什么……</p></div>`;
  const j = await api('recommend', { text, group }).catch(e => ({ ok: false, msg: e.message }));
  if (!j.ok) { $('#qRec').innerHTML = `<div class="rec"><p class="hint">${esc(j.msg || '助手没给出建议')}</p></div>`; return; }
  REC = { ...j, text };
  $('#qRec').innerHTML = `<div class="rec"><h4>助手的建议</h4>
    ${j.to ? `<div class="rec-opt"><div><b>交给「${esc(j.to.title || j.to.name)}」</b><span>${esc(j.to.name)} · ${esc(groupName(j.to.group || '~none'))}</span><p>${esc(j.why)}</p></div><button class="btn primary" data-rec="to">交给它</button></div>` : ''}
    ${j.new ? `<div class="rec-opt"><div><b>新开一个 ${FULL[j.new.kind]} 会话</b><span>${esc(groupName(j.new.group))} · ${esc(home(j.new.cwd))}${j.new.name ? ' · ' + esc(j.new.name) : ''}</span><p>${esc(j.new.why)}</p></div><button class="btn${j.to ? '' : ' primary'}" data-rec="new">新建并交给它</button></div>` : ''}
    ${!j.to && !j.new ? `<p class="hint">${esc(j.why || '没找到合适的会话')}</p>` : ''}</div>`;
}
async function takeRec(which) {
  const r = REC;
  if (!r) return;
  const j = which === 'to'
    ? await post('queue', { do: 'add', text: r.text, to: r.to.name, mode: qMode })
    : await post('new', { kind: r.new.kind, group: r.new.group, mux: muxOf(r.new.group || ''), cwd: r.new.cwd, name: r.new.name, prompt: r.text, jump: false });
  if (j && j.ok) { $('#qText').value = ''; $('#qRec').innerHTML = ''; REC = null; }
}
function renderQueue() {
  draw('qmic', [S.voice && S.voice.on], () => { if ($('#qMic')) $('#qMic').innerHTML = micBtn('qText'); });
  const sel = $('#qTo');
  if (sel) {
    const live = S.sessions.filter(s => !s.unknown && !['gone', 'ended'].includes(s.state));
    const opts = [...Object.keys(S.groups || {}).map(g => [`g:${g}`, `${g} 组里先空下来的会话`]), ['g:', '任何一个先空下来的会话'], ...live.map(s => [`s:${s.name}`, `${titleOf(s)} · ${s.name}`])];
    const key = opts.map(o => o[0]).join();
    if (sel.dataset.opts !== key) { const cur = sel.value; sel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join(''); sel.dataset.opts = key; if (cur) sel.value = cur; }
  }
  const q = S.queue || [];
  const sec = (title, list) => list.length ? `<div class="q-sec"><h3>${title} · ${list.length}</h3>${list.map(qItem).join('')}</div>` : '';
  draw('queue', [q, tick()], () => {
    $('#qList').innerHTML = (sec('可以发了', q.filter(i => i.status === 'ready')) + sec('排着', q.filter(i => ['waiting', 'checking', 'held'].includes(i.status))) +
      sec('已发出', q.filter(i => i.status === 'sent').slice(0, 20)) + sec('不用发了', q.filter(i => i.status === 'dropped').slice(0, 20))) || '<div class="hint">还没有排队的事。</div>';
  });
}
function qItem(i) {
  const target = i.to ? i.to : i.group ? `${i.group} 组里先空下来的` : '任何一个先空下来的';
  const acts = i.status === 'ready' ? `<button class="btn primary" data-q="send" data-id="${i.id}">发给 ${esc(i.ready_to || i.to)}</button><button class="btn" data-q="drop" data-id="${i.id}">不发了</button>`
    : ['waiting', 'held', 'checking'].includes(i.status) ? `${i.to ? `<button class="btn" data-q="send" data-id="${i.id}" title="不等了，现在就发">现在就发</button>` : ''}<button class="btn" data-q="drop" data-id="${i.id}">不发了</button>`
      : i.status === 'dropped' ? `<button class="btn" data-q="restore" data-id="${i.id}">重新排上</button><button class="btn" data-q="delete" data-id="${i.id}">删除</button>`
        : `<button class="btn" data-q="delete" data-id="${i.id}">删除</button>`;
  return `<div class="q-item ${i.status}"><span class="bar4"></span><div>
    <div class="txt">${esc(i.sent_text || i.text)}</div>
    <div class="meta"><span>交给 <b>${esc(target)}</b></span><span>${QST[i.status] || i.status}${i.status === 'sent' && i.sent_to ? ' → ' + esc(i.sent_to) : ''}</span><span>${i.mode === 'auto' ? '助手确认后自动发' : '空了提醒我'}</span><span>${ago(i.created)}前写的</span></div>
    ${i.note ? `<div class="note">${esc(i.note)}</div>` : ''}</div><div class="acts">${acts}</div></div>`;
}

// ---------- status bar ----------
function drawStatus() {
  const sm = S.summarizer || {}, a = S.about || {};
  $('#status').innerHTML = `<span>${sm.error ? `<span class="warn">总结模型出错，去设置里看看</span>` : `总结：${esc(a.model || '')}${sm.busy ? ' · 正在更新' : ''}`}</span>
    <span class="r">刷新于 ${ago(lastOk / 1000) === '刚刚' ? '刚刚' : ago(lastOk / 1000) + '前'}</span><span>Sturnus ${esc(S.version)}</span>`;
}

// ---------- palette ----------
let palIndex = 0;
function openPalette() { closeOverlays(); $('#palette').hidden = false; $('#paletteQ').value = ''; palIndex = 0; drawPalette(); setTimeout(() => $('#paletteQ').focus(), 20); }
function palPlaces() {  // (workspaces and projects whose name matches: before the sessions)
  const q = $('#paletteQ').value.trim().toLowerCase();
  if (!q) return [];
  return [...(S.workspaces || []).filter(w => w.name.toLowerCase().includes(q)).map(w => ({ href: `#/w/${encodeURIComponent(w.key)}`, label: w.name, sub: `工作区 · ${home(w.path)}`, ws: w })),
    ...Object.values(S.projects || {}).filter(p => p.name.toLowerCase().includes(q)).slice(0, 6).map(p => ({ href: `#/p/${encodeURIComponent(p.key)}`, label: p.name, sub: `项目 · ${(wsOf(p.workspace) || {}).name || ''}` }))].slice(0, 8);
}
function palItems() {
  const q = $('#paletteQ').value.trim().toLowerCase();
  const order = s => ({ waiting: 0, blocked: 1, review: 2, working: 3, idle: 4 }[standing(s)[0]] ?? 9);
  return S.sessions.filter(s => !q || [s.name, s.title, s.summary, s.cwd, FULL[s.kind], s.loc && s.loc.session].some(x => String(x || '').toLowerCase().includes(q)))
    .sort((a, b) => order(a) - order(b) || (b.at || 0) - (a.at || 0));
}
const palAll = () => [...palPlaces(), ...palItems()];
const palOpen = x => { closeOverlays(); if (!x) return; if (x.href) location.hash = x.href; else go(x.id); };
function drawPalette() {
  const items = palAll();
  palIndex = Math.min(palIndex, Math.max(0, items.length - 1));
  $('#paletteList').innerHTML = items.length ? items.map((s, i) => s.href ? `
    <div class="p-row${i === palIndex ? ' on' : ''}" data-pal="${i}">${s.ws ? `<span class="wsdot lg" style="--t:${wsColor(s.ws)}">${esc(s.label.slice(0, 1).toUpperCase())}</span>` : `<span class="mark sm pj">${I.folder}</span>`}
      <div class="t"><b>${esc(s.label)}</b><div>${esc(s.sub)}</div></div><span class="loc"></span></div>` : `
    <div class="p-row${i === palIndex ? ' on' : ''}" data-pal="${i}">${mark(s.kind, standing(s)[0], 'sm')}
      <div class="t"><b>${esc(titleOf(s))}</b><div>${esc(s.name)} · ${esc(s.summary || standing(s)[1])}</div></div>
      <span class="loc">${s.loc ? `${esc(groupName(s.loc.session))}:${esc(s.loc.pane)}` : esc(folder(s.cwd))}</span></div>`).join('') : '<div class="p-sec">没有匹配的工作区、项目或会话</div>';
}
function closeOverlays() { for (const id of ['#palette', '#settings', '#newSess']) $(id).hidden = true; }

// ---------- new session ----------
let NS = null;
function openNew(group, opts = {}) {
  closeOverlays();
  const groups = Object.keys(S.groups || {});
  const withClient = groups.filter(g => S.groups[g].clients.length);
  let g = group || store.get('deck.newGroup', '');
  if (!groups.includes(g)) g = withClient[0] || groups[0] || '+';
  NS = { kind: store.get('deck.newKind', 'claude'), group: g, newGroup: '', mux: store.get('deck.newMux', 'zellij'), cwd: opts.cwd || store.get('deck.newCwd', '~/projects'), name: '', prompt: '', jump: store.get('deck.newJump', true) };
  $('#newSess').hidden = false;
  drawNew();
  setTimeout(() => $('#nsCwd') && $('#nsCwd').focus(), 60);
}
function cliText() {
  const launch = NS.kind === 'shell' ? ['$SHELL', '-l'] : (S.launch || {})[NS.kind] || [];
  const cmd = [...launch, ...(NS.kind === 'claude' && NS.name ? ['--name', NS.name] : []), ...(NS.prompt.trim() && NS.kind !== 'shell' ? [JSON.stringify(NS.prompt.trim())] : [])].join(' ');
  const isNew = NS.group === '+', g = isNew ? NS.newGroup || '<新组名>' : groupName(NS.group);
  if ((isNew ? NS.mux : muxOf(NS.group)) === 'tmux') return `tmux ${isNew ? `new-session -d -s ${g}` : `new-window -t ${g}:`} -c ${NS.cwd} -- ${cmd}`;
  return `zellij --session ${g} action new-tab  →  cd ${NS.cwd} && ${cmd}`;
}
function drawNew() {
  const groups = Object.keys(S.groups || {}), isNew = NS.group === '+';
  const muxes = S.muxes || ['zellij'];
  $('#newBody').innerHTML = `<h3>新建会话</h3><p class="lead">在一个组（Zellij 或 tmux 会话）里开一个新标签页或窗口，把 agent 跑起来。之后在这里和在终端里都能管理它。</p>
    <div class="f-row"><label>开什么</label><div class="choice">${['claude', 'codex', 'cursor', 'shell'].map(k => `
      <button type="button" class="${NS.kind === k ? 'on' : ''}" data-kind="${k}">${mark(k, '', 'sm')}<div><b>${k === 'shell' ? '终端' : FULL[k]}</b><span>${{ claude: '对话与长任务', codex: '终端里的编码', cursor: '编辑器风格的 agent', shell: '组里的一个 shell' }[k]}</span></div></button>`).join('')}</div></div>
    <div class="f-row top"><label>组</label><div class="choice groups">${groups.map(n => `
      <button type="button" class="${NS.group === n ? 'on' : ''}" data-group="${esc(n)}"><b>${esc(groupName(n))}${muxTag(n)}</b><span>${S.groups[n].agents} 个会话 · ${S.groups[n].clients.length ? '有终端连着' : '后台'}</span></button>`).join('')}
      <button type="button" class="newg ${isNew ? 'on' : ''}" data-group="+"><b>+ 新组</b><span>新建一个 ${muxes.length > 1 ? 'Zellij 或 tmux' : muxes[0] === 'tmux' ? 'tmux' : 'Zellij'} 会话</span></button></div></div>
    ${isNew ? `<div class="f-row"><label>新组名</label><input class="field" id="nsGroup" value="${esc(NS.newGroup)}" placeholder="比如 release、envhub、review"></div>
      ${muxes.length > 1 ? `<div class="f-row"><label>用</label><div class="seg">${muxes.map(m => `<button type="button" data-mux="${m}" class="${NS.mux === m ? 'on' : ''}">${m === 'tmux' ? 'tmux' : 'Zellij'}</button>`).join('')}</div></div>` : ''}` : ''}
    <div class="f-row"><label>目录</label><div class="inline"><input class="field" id="nsCwd" list="nsDirs" value="${esc(NS.cwd)}" placeholder="~/projects/..."><datalist id="nsDirs">${(S.dirs || []).map(d => `<option value="${esc(d)}">`).join('')}</datalist>
      <button type="button" class="btn" data-browse>${I.folder}浏览</button></div></div>
    ${NS.tree ? `<div class="f-row top"><label></label><div class="tree" id="nsTree"></div></div>` : ''}
    <div class="f-row"><label>名字</label><input class="field" id="nsName" value="${esc(NS.name)}" placeholder="可选：会话、amail 和窗格标题都用这个名字"></div>
    ${NS.kind === 'shell' ? '' : `<div class="f-row top"><label>初始任务</label><div class="with-mic"><textarea class="area" id="nsPrompt" rows="3" placeholder="可选：开起来就交给它的第一件事">${esc(NS.prompt)}</textarea>${micBtn('nsPrompt')}</div></div>`}
    <div class="f-row top"><label>等同于</label><div class="code" id="nsCli">${esc(cliText())}</div></div>
    <div class="f-foot"><label class="check"><input type="checkbox" id="nsJump" ${NS.jump ? 'checked' : ''}> 建好后打开它</label><button class="btn" data-close>取消</button><button class="btn primary" id="nsGo">${I.plus}新建</button></div>`;
  if (NS.tree) drawTree(NS.treeAt || NS.cwd || '~');
}
// the folders of the machine the deck runs on (the page may be on another computer: not the browser's file picker)
async function drawTree(path) {
  const box = $('#nsTree');
  if (!box) return;
  const j = await api('dirs', { path }).catch(e => ({ ok: false, msg: e.message }));
  if (!j.ok) { box.insertAdjacentHTML('afterbegin', `<p class="hint">${esc(j.msg)}</p>`); return; }
  NS.treeAt = j.path; NS.treeShow = j.show;
  const parts = j.path.split('/').filter(Boolean);
  const crumbs = `<a data-dir="/">/</a>` + parts.map((p, i) => `${i ? '<span>/</span>' : ''}<a data-dir="${esc('/' + parts.slice(0, i + 1).join('/'))}">${esc(p)}</a>`).join('');
  box.innerHTML = `<div class="tree-top"><div class="crumb">${crumbs}</div>
      <input class="field" id="treeQ" placeholder="筛选" autocomplete="off"></div>
    <div class="tree-list">${j.dirs.map(n => `<div class="tree-d" data-dir="${esc(j.path.replace(/\/$/, '') + '/' + n)}">${I.folder}${esc(n)}</div>`).join('') || '<p class="hint">这里没有子目录</p>'}${j.more ? `<p class="hint">还有 ${j.more} 个没列出，用筛选找</p>` : ''}</div>
    <div class="tree-foot"><span class="hint">${esc(j.show)}</span><button type="button" class="btn primary" data-pick>选这个目录</button></div>`;
  $('#treeQ').addEventListener('input', e => { const v = e.target.value.toLowerCase(); document.querySelectorAll('.tree-d').forEach(d => { d.hidden = !d.textContent.toLowerCase().includes(v); }); });
}

function readNew() {
  if (!NS) return;
  const v = id => ($(id) ? $(id).value : null);
  NS.cwd = v('#nsCwd') ?? NS.cwd; NS.name = (v('#nsName') ?? NS.name).trim(); NS.prompt = v('#nsPrompt') ?? NS.prompt;
  if ($('#nsGroup')) NS.newGroup = $('#nsGroup').value.trim();
  if ($('#nsJump')) NS.jump = $('#nsJump').checked;
}
async function submitNew() {
  readNew();
  const isNew = NS.group === '+', mux = isNew ? ((S.muxes || []).includes(NS.mux) ? NS.mux : (S.muxes || ['zellij'])[0]) : muxOf(NS.group);
  const group = isNew ? (NS.newGroup && mux === 'tmux' ? 'tmux:' + NS.newGroup : NS.newGroup) : NS.group;
  if (!group) { toast('先选一个组，或给新组起个名字', false); return; }
  $('#nsGo').disabled = true;
  const j = await post('new', { kind: NS.kind, group, mux, cwd: NS.cwd, name: NS.name, prompt: NS.prompt.trim(), jump: false });
  if ($('#nsGo')) $('#nsGo').disabled = false;
  if (j && j.ok) {
    store.set('deck.newKind', NS.kind); store.set('deck.newGroup', group); store.set('deck.newMux', mux); store.set('deck.newCwd', NS.cwd); store.set('deck.newJump', NS.jump);
    closeOverlays();
    if (j.term) { if (NS.jump) location.hash = `#/term/${encodeURIComponent(j.term.group)}/${encodeURIComponent(j.term.pane)}`; return; }
    if (NS.jump) { const want = NS.name; setTimeout(() => { const s = S.sessions.find(x => (want && x.name === want) || (x.starting && x.loc && x.loc.session === group)); if (s) go(s.id); }, 2500); }
  }
}

// ---------- settings ----------
let pane = 'models';
const MODEL_HINTS = { claude: ['haiku', 'sonnet', 'opus'], codex: ['', 'gpt-5.1-codex-mini', 'gpt-5.1-codex'], pi: [''], api: [] };
function openSettings() { closeOverlays(); VE = null; $('#settings').hidden = false; drawSettings(); }
function modelBlock(role, title, what) {
  const m = (S.models || {})[role] || { source: 'claude' };
  const src = (MB[role] && MB[role].source) || m.source;
  return `<div class="mblock" data-role="${role}"><h4>${title}</h4><div class="what">${what} · 现在：${esc(m.label || '')}</div>
    <div class="f-row"><label>运行在</label><div class="seg">${[['claude', 'Claude Code'], ['codex', 'Codex'], ['pi', 'pi'], ['api', 'API']].map(([k, l]) => `<button type="button" data-src="${k}" class="${src === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="f-row"><label>模型</label><input class="field" data-f="model" list="ml-${role}" value="${esc(src === m.source ? m.model : (MODEL_HINTS[src] || [''])[0])}" placeholder="${src === 'codex' || src === 'pi' ? '留空用它自己的默认模型' : '模型名'}"><datalist id="ml-${role}">${(MODEL_HINTS[src] || []).filter(Boolean).map(x => `<option value="${x}">`).join('')}</datalist></div>
    ${src === 'api' ? `<div class="f-row"><label>接口地址</label><input class="field" data-f="url" value="${esc(m.url || '')}" placeholder="https://api.example.com/v1"></div>
      <div class="f-row"><label>API Key</label><input class="field" data-f="key" type="password" value="${esc(m.key || '')}" placeholder="只存在本机（权限 600）"></div>` : ''}
    <div class="f-row"><label></label><div class="inline"><button class="btn" data-mact="test">测试</button><button class="btn primary" data-mact="save">保存并使用</button></div></div>
    <div class="result" id="res-${role}"></div></div>`;
}
const MB = {};
function drawSettings() {
  document.querySelectorAll('#settingsNav button').forEach(b => b.classList.toggle('on', b.dataset.pane === pane));
  const a = S.about || {}, t = store.get('deck.theme', 'auto');
  $('#settingsBody').innerHTML = {
    models: `<h3>助手与模型</h3><p class="lead">可以用本机装的任何 agent 运行时（Claude Code、Codex、pi，用它们自己的登录），也可以接一个 API。保存后马上生效。</p>
      ${modelBlock('assist', '助手 agent', '替你看排队的事还要不要做、发给谁；帮你起草回复')}
      ${modelBlock('summary', '总结模型', '给每个会话起任务名、写进展、判断要不要你处理、记下决定（用小而快的模型就好）')}
      ${S.summarizer && S.summarizer.error ? `<div class="code">最近一次总结出错：${esc(S.summarizer.error)}</div>` : ''}`,
    look: `<h3>显示</h3><p class="lead">这台机器上的显示偏好。</p>
      <div class="opt"><div><h4>主题</h4><p>跟随系统，或固定浅色、深色。</p></div><div class="seg">${[['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(([k, l]) => `<button data-theme-set="${k}" class="${t === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="opt col"><div><h4>工作区图标</h4><p>最左边那条栏里工作区的颜色。</p></div>
        <div class="wsc-pick">${Object.entries(WSC).map(([k, l]) => `<button class="wsc-card${store.get('deck.wsColor', 'graphite') === k ? ' on' : ''}" data-wscolor="${k}" aria-pressed="${store.get('deck.wsColor', 'graphite') === k}">
          <span class="wsc-prev" data-look="${k}">${[['S', 0], ['N', 1], ['D', 3]].map(([c, i]) => `<i style="--t:${MUTED[i]}">${c}</i>`).join('')}</span><b>${l}</b></button>`).join('')}</div></div>
      <div class="opt"><div><h4>窗格标题</h4><p>用「状态 · 会话名 · 在做的事」做每个 agent 窗格的标题，在 Zellij 或 tmux 里一眼认出是哪个（tmux 要开 pane-border-status 才看得到）。</p></div><label class="switch"><input type="checkbox" id="paneTitles" ${S.pane_titles ? 'checked' : ''}></label></div>`,
    voice: voicePane(),
    access: `<h3>访问</h3><div id="accessBody"></div>`,
    about: `<h3>Sturnus</h3><p class="lead">这台机器上所有 Claude Code、Codex、Cursor 会话的入口和状态。</p>
      <dl class="kv"><dt>版本</dt><dd>${esc(S.version)}</dd><dt>地址</dt><dd>http://${esc(a.listen || '')}</dd><dt>运行自</dt><dd>${a.started ? new Date(a.started * 1000).toLocaleString('zh-CN') : ''}</dd>
        <dt>程序</dt><dd>${esc(home(a.app))}</dd><dt>源码</dt><dd>${esc(home(a.source || ''))}</dd><dt>设置</dt><dd>${esc(home(a.config))}</dd></dl>
      <h4 style="margin-top:20px">命令行</h4><div class="code">sturnus status | upgrade | uninstall [--purge]
amail status | send | ask
zellij attach &lt;组名&gt;  |  tmux attach -t &lt;组名&gt;</div>
      <p class="lead" style="margin-top:20px">© 2026 Ethan H.B. Zhou</p>`,
  }[pane];
  if (pane === 'access') drawAccess();
}
// ---------- the assistant: questions about the sessions, answered from what the deck knows ----------
const ASST = { open: store.get('deck.asstOpen', false), msgs: store.get('deck.asstMsgs', []), busy: false };
const ASK_SAMPLES = ['现在谁在等我？各要我做什么', '哪个会话在改登录页？', '今天定了哪些事？', '有哪些 MR 已经提了还没合？'];
function asstToggle(open = !ASST.open) {
  ASST.open = open; store.set('deck.asstOpen', open);
  $('#asst').hidden = !open; $('#asstBtn').classList.toggle('on', open);
  if (open) { $('#asstBtn').classList.remove('new'); drawAsst(true); setTimeout(() => $('#asstQ') && $('#asstQ').focus(), 30); }
}
function asstText(t) {  // (the answer as Markdown; [[open|report|term:name]] become links to the session)
  const links = [];
  const held = String(t).replace(/\[\[(open|report|term):([^\]]+)\]\]/g, (m, kind, name) => {
    const s = S && S.sessions.find(x => x.name === name.trim());
    links.push(s ? `<a class="s-link" data-go="${esc(s.id)}" data-tab="${kind === 'open' ? 'overview' : kind}">${mark(s.kind, standing(s)[0], 'xs')}<b>${esc(titleOf(s))}</b><em>${kind === 'report' ? '报告' : kind === 'term' ? '终端' : esc(s.name)}</em></a>` : esc(name.trim()));
    return `@@L${links.length - 1}@@`;
  });
  return md(held).replace(/@@L(\d+)@@/g, (m, n) => links[+n]);
}
function drawAsst(frame) {
  const box = $('#asst');
  if (!box || box.hidden || !S) return;
  if (frame || !$('#asstList')) {
    const keep = $('#asstQ') ? $('#asstQ').value : '';
    box.innerHTML = `<div class="asst-head">${I.spark}<b>助手</b><span class="hint">${esc(((S.models || {}).assist || {}).label || '')}</span>
        <button class="lnk" data-asst-clear title="清空这段对话">清空</button><button class="lnk x" data-asst-close title="收起（⌘/Ctrl+J）">收起</button></div>
      <div class="asst-list" id="asstList"></div>
      <form class="asst-in" id="asstForm" autocomplete="off"><textarea id="asstQ" rows="2" placeholder="问各个会话的事：谁在等我、哪个在做什么、定过什么……  Enter 发送"></textarea>
        <div class="asst-row">${micBtn('asstQ')}<span class="sp"></span><button class="send" type="submit" title="发送">${I.arrow}</button></div></form>`;
    const ta = $('#asstQ');
    ta.value = keep;
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#asstForm').requestSubmit(); } });
    $('#asstForm').addEventListener('submit', e => { e.preventDefault(); const q = ta.value.trim(); if (q && !ASST.busy) { ta.value = ''; asstAsk(q); } });
  }
  const list = $('#asstList');
  list.innerHTML = ASST.msgs.length ? ASST.msgs.map(m => m.who === 'user' ? `<div class="a-q">${esc(m.text)}</div>` : `<div class="a-a${m.bad ? ' bad' : ''}">${asstText(m.text)}</div>`).join('')
      + (ASST.busy ? `<div class="a-a busy"><i></i><i></i><i></i>在翻各个会话……</div>` : '')
    : `<div class="a-empty"><p>问我各个会话的事：我看得到每个会话在做什么、到哪了、定过什么、谁在等你，也能帮你找到它。</p>${ASK_SAMPLES.map(x => `<button class="a-sample" data-asst-ask="${esc(x)}">${esc(x)}</button>`).join('')}</div>`;
  list.scrollTop = list.scrollHeight;
}
async function asstAsk(q) {
  ASST.msgs.push({ who: 'user', text: q }); ASST.busy = true; drawAsst(); $('#asstBtn').classList.add('busy');
  const j = await api('assistant', { q, history: ASST.msgs.slice(-7, -1) }).catch(e => ({ ok: false, msg: e.message }));
  ASST.busy = false;
  ASST.msgs.push({ who: 'assistant', text: j.ok ? j.answer : (j.msg || '没答上来'), bad: !j.ok });
  ASST.msgs = ASST.msgs.slice(-30); store.set('deck.asstMsgs', ASST.msgs);
  $('#asstBtn').classList.remove('busy');
  if (!ASST.open) $('#asstBtn').classList.add('new');  // (answered while folded: a dot on the button)
  drawAsst();
}

// voice input: on or off, and the service that turns speech into text
const VS = { soniox: 'Soniox', elevenlabs: 'ElevenLabs', assemblyai: 'AssemblyAI', openai: 'OpenAI 兼容' };
const VMODEL = { soniox: 'stt-async-v3', elevenlabs: 'scribe_v1', assemblyai: 'universal', openai: 'gpt-4o-mini-transcribe' };
let VE = null;  // (the voice form being edited)
function voicePane() {
  const sv = S.voice || {}, keys = sv.keys || {};
  const v = VE || (VE = { provider: sv.provider || 'openai', model: sv.model || (sv.defaults || VMODEL)[sv.provider || 'openai'], url: sv.url || '', lang: sv.lang || '', key: keys[sv.provider] || '' });
  return `<h3>语音输入</h3><p class="lead">开启后，写字的地方会多一个麦克风：点一下开始说，再点一下停，转出来的文字放到光标处。录音只转给你选的服务。</p>
    <div class="v-now"><span class="dot ${sv.on && keys[sv.provider] ? 'working' : ''}"></span>现在用的：<b>${esc(sv.label || '')}</b>${keys[sv.provider] ? '' : ' · <em>还没填 key</em>'}${sv.on ? '' : ' · 关着'}</div>
    <div class="opt"><div><h4>开启语音输入</h4><p>${window.isSecureContext ? '这个页面可以用麦克风。' : '这个地址不是 https，浏览器不让网页用麦克风：本机用 http://127.0.0.1:7788，或给 tailnet 开 https。'}</p></div><label class="switch"><input type="checkbox" id="vOn" ${sv.on ? 'checked' : ''}></label></div>
    <div class="mblock"><h4>接入方式</h4>
      <div class="f-row"><label>服务</label><div class="seg">${Object.entries(VS).map(([k, l]) => `<button type="button" data-vs="${k}" class="${v.provider === k ? 'on' : ''}">${l}${k === sv.provider ? ' ·' : ''}</button>`).join('')}</div></div>
      <div class="f-row"><label>模型</label><input class="field" id="vModel" value="${esc(v.model || '')}" placeholder="${esc((sv.defaults || VMODEL)[v.provider] || '')}"></div>
      ${v.provider === 'openai' ? `<div class="f-row"><label>接口地址</label><input class="field" id="vUrl" value="${esc(v.url || '')}" placeholder="https://api.openai.com/v1（也可以是 Groq 等兼容的）"></div>` : ''}
      <div class="f-row"><label>API Key</label><input class="field" id="vKey" type="password" value="${esc(v.key || '')}" placeholder="${esc(VS[v.provider])} 的 key，只存在本机（权限 600）"></div>
      <div class="f-row"><label>语言</label><div class="seg">${[['', '自动（中英混说）'], ['zh', '中文'], ['en', 'English']].map(([k, l]) => `<button type="button" data-vl="${k}" class="${(v.lang || '') === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="f-row"><label></label><div class="inline"><button class="btn" data-vact="voice_test">测试</button><button class="btn primary" data-vact="voice">保存并使用</button></div></div>
      <div class="result" id="vRes"></div></div>`;
}
function readVoice() { VE = { ...VE, model: $('#vModel').value.trim(), url: $('#vUrl') ? $('#vUrl').value.trim() : VE.url, key: $('#vKey').value.trim() }; return { ...VE, on: !!(S.voice && S.voice.on) }; }

// the microphone next to a text box: record, stop, the text at the cursor
let rec = null;
const micBtn = id => (S && S.voice && S.voice.on ? `<button type="button" class="mic${rec && rec.id === id ? ' on' : ''}" data-mic="${id}" title="语音输入（${esc(S.voice.label)}）：点一下开始，再点一下停">${I.mic}</button>` : '');
async function micToggle(id) {
  if (rec) { rec.mr.stop(); return; }
  if (!window.isSecureContext || !navigator.mediaDevices) { toast('这个地址不是 https，浏览器不让网页用麦克风：本机用 http://127.0.0.1:7788，或给 tailnet 开 https', false); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { toast('拿不到麦克风：' + e.message, false); return; }
  const mr = new MediaRecorder(stream), chunks = [];
  mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  mr.onstop = async () => {
    stream.getTracks().forEach(t => t.stop());
    rec = null;
    document.querySelectorAll('.mic').forEach(b => { b.classList.remove('on'); if (b.dataset.mic === id) b.classList.add('busy'); });
    const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
    try {
      const r = await fetch('/api/stt', { method: 'POST', headers: { 'X-Deck': '1', 'Content-Type': blob.type }, body: blob });
      const j = await r.json(), el = document.getElementById(id);
      if (j.ok && j.text && el) {
        toast(`${j.via} 转好了`);
        const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
        el.value = el.value.slice(0, a) + j.text + el.value.slice(b);
        el.focus(); el.selectionStart = el.selectionEnd = a + j.text.length;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else toast(j.msg || '没听清', false);
    } catch (e) { toast('没连上 sturnus 服务：' + e.message, false); }
    document.querySelectorAll('.mic.busy').forEach(b => b.classList.remove('busy'));
  };
  mr.start();
  rec = { mr, id };
  document.querySelectorAll(`.mic[data-mic="${CSS.escape(id)}"]`).forEach(b => b.classList.add('on'));
}

async function drawAccess() {
  const j = await api('access', {}).catch(() => null), b = $('#accessBody');
  if (!b || !j || !j.ok) return;
  b.innerHTML = `<p class="lead">每个浏览器第一次打开都要登录令牌：在这台机器的终端里运行 <code>sturnus token</code>；<code>sturnus token --rotate</code> 换一个，所有浏览器都会退出。</p>
    <dl class="kv"><dt>本机</dt><dd>${esc(j.local)}</dd>${j.tailnet ? `<dt>Tailnet</dt><dd>${esc(j.tailnet)}</dd>` : ''}</dl>
    ${j.tailnet ? '<p class="hint" style="margin-top:8px">Tailnet 地址只放行你自己账号下的设备。</p>' : ''}
    <h4 style="margin-top:22px">已登录的浏览器</h4>
    <div class="acc-list">${j.sessions.map(x => `<div class="acc-row"><div><div><b>${esc(x.who)}</b>${x.me ? '<span class="acc-me">这个浏览器</span>' : ''}</div><div class="hint">登录于 ${new Date(x.at * 1000).toLocaleString('zh-CN')}</div></div>
      <button class="btn" data-acc="${x.me ? 'me' : esc(x.key)}">${x.me ? '退出登录' : '移出'}</button></div>`).join('')}</div>`;
}
function readModel(role) {
  const b = document.querySelector(`.mblock[data-role="${role}"]`);
  const v = f => { const e = b.querySelector(`[data-f="${f}"]`); return e ? e.value.trim() : undefined; };
  return { role, source: (MB[role] && MB[role].source) || (S.models[role] || {}).source, model: v('model'), url: v('url'), key: v('key') };
}

// ---------- events ----------
document.addEventListener('click', async e => {
  const q = sel => e.target.closest(sel);
  let el;
  if (q('[data-close]')) { closeOverlays(); return; }
  if ((el = q('[data-new]'))) { e.stopPropagation(); openNew(el.dataset.new); return; }
  if (q('#sideHandle')) { setSide(!sideOff); return; }
  if ((el = q('.rail .tile')) && !e.metaKey && !e.ctrlKey && !e.shiftKey) {  // (the place already selected: folds or unfolds its column; another one: opens it)
    if (el.classList.contains('on')) { e.preventDefault(); setSide(!sideOff); } else if (sideOff) setSide(false);
    return;
  }
  if ((el = q('[data-newp-ws]'))) { const w = wsOf(el.dataset.newpWs); if (w) openNew(w.groups[0] || '', { cwd: home(w.path) }); return; }
  if ((el = q('[data-works-all]'))) { sig.worksAll = el.dataset.worksAll; delete sig.wsbody; render(); return; }
  if ((el = q('tr[data-href]')) && !q('a, [data-go]')) { location.hash = el.dataset.href; return; }
  if ((el = q('[data-newp]'))) { e.stopPropagation(); const p = projOf(el.dataset.newp), w = p && wsOf(p.workspace); if (p) openNew((w && w.groups[0]) || '', { cwd: home(p.path) }); return; }
  if ((el = q('[data-ptab]'))) { location.hash = `#/p/${encodeURIComponent(route.key)}${el.dataset.ptab === 'overview' ? '' : '/' + el.dataset.ptab}`; return; }
  if ((el = q('[data-trec]'))) { takeTodo(el.dataset.trec); return; }
  if ((el = q('[data-topic-open]'))) { OPEN_TOPIC = el.dataset.topicOpen; return; }
  if ((el = q('[data-btopic]'))) { BD.topic = el.dataset.btopic; BD.drawn = false; drawBoardBody(); return; }
  if (q('[data-bform]')) { BD.form = !BD.form; drawTopicForm(); return; }
  if (q('[data-tfgo]')) { topicGo(); return; }
  if ((el = q('[data-bclose]'))) { if (confirm('结束这场讨论？之后就不能再往里发言了。')) { await post('topic_close', { key: BD.key, topic: el.dataset.bclose }); boardFetch(); } return; }
  if ((el = q('[data-bcall]'))) { const ta = $('#bText'), at = ta.selectionStart ?? ta.value.length, w = `@${el.dataset.bcall} `; ta.value = ta.value.slice(0, at) + w + ta.value.slice(at); ta.focus(); ta.selectionStart = ta.selectionEnd = at + w.length; return; }
  if ((el = q('[data-tab-go]'))) { go(route.id, el.dataset.tabGo); return; }
  if ((el = q('[data-rail]'))) { railTab = el.dataset.rail; store.set('deck.rail', railTab); document.querySelectorAll('[data-rail]').forEach(b => b.classList.toggle('on', b === el)); sig.rail = ''; render(); return; }
  if ((el = q('[data-q]'))) { const b = { do: el.dataset.q, id: el.dataset.id }; if (b.do === 'delete' && !confirm('删掉这件排队的事？')) return; post('queue', b); return; }
  if ((el = q('[data-qmode]'))) { qMode = el.dataset.qmode; document.querySelectorAll('[data-qmode]').forEach(b => b.classList.toggle('on', b === el)); return; }
  if ((el = q('[data-old]'))) { const k = el.dataset.old; openOld.has(k) ? openOld.delete(k) : openOld.add(k); render(); return; }
  if ((el = q('[data-msg]'))) { const k = el.dataset.msg; openMsgs.has(k) ? openMsgs.delete(k) : openMsgs.add(k); el.classList.toggle('open'); return; }
  if ((el = q('[data-pal]'))) { palOpen(palAll()[+el.dataset.pal]); return; }
  if ((el = q('[data-act]'))) {
    const act = el.dataset.act, s = route.name === 'session' && S.sessions.find(x => x.id === route.id);
    if (act === 'jump' && s) post('jump', { id: s.id });
    if (act === 'retry-term') { closeTerm(); render(); }
    if (act === 'rename' && s) { const name = $('#rName').value.trim(); if (name) post('rename', { id: s.id, name }); }
    if (act === 'draft' && s) { el.disabled = true; el.innerHTML = `${I.spark}起草中…`; const j = await api('draft', { id: s.id }).catch(() => ({ ok: false, msg: '没连上服务' })); el.disabled = false; el.innerHTML = `${I.spark}帮我起草`; if (j.ok) { $('#rText').value = j.draft; $('#rText').focus(); } else toast(j.msg, false); }
    if ((act === 'say' || act === 'say-now') && s) {
      const text = $('#rText').value.trim();
      if (!text) { $('#rText').focus(); return; }
      const j = await post('say', { id: s.id, text, now: act === 'say-now' });
      if (j && j.ok) { $('#rText').value = ''; if (sessTab === 'chat') { chatTimer = 0; setTimeout(() => { chatTimer = 0; render(); }, 1500); } }
    }
    return;
  }
  if ((el = q('[data-go]'))) { go(el.dataset.go, el.dataset.tab); return; }
  if ((el = q('[data-kind]'))) { readNew(); NS.kind = el.dataset.kind; drawNew(); return; }
  if (q('[data-browse]')) { readNew(); NS.tree = !NS.tree; NS.treeAt = ''; drawNew(); return; }
  if ((el = q('[data-dir]'))) { drawTree(el.dataset.dir); return; }
  if (q('[data-pick]')) { readNew(); NS.cwd = NS.treeShow || NS.treeAt; NS.tree = false; drawNew(); return; }
  if ((el = q('[data-mux]'))) { readNew(); NS.mux = el.dataset.mux; drawNew(); return; }
  if ((el = q('[data-group]'))) { readNew(); NS.group = el.dataset.group; drawNew(); if (NS.group === '+') setTimeout(() => $('#nsGroup') && $('#nsGroup').focus(), 30); return; }
  if (q('#nsGo')) { submitNew(); return; }
  if ((el = q('#settingsNav [data-pane]'))) { pane = el.dataset.pane; drawSettings(); return; }
  if (q('[data-asst-close]')) { asstToggle(false); return; }
  if (q('[data-asst-clear]')) { ASST.msgs = []; store.set('deck.asstMsgs', []); drawAsst(true); return; }
  if ((el = q('[data-asst-ask]'))) { asstAsk(el.dataset.asstAsk); return; }
  if ((el = q('[data-mic]'))) { e.preventDefault(); micToggle(el.dataset.mic); return; }
  if ((el = q('[data-vs]'))) {  // (another service: its own saved model and key, or its defaults)
    readVoice(); const p = el.dataset.vs, sv = S.voice || {};
    VE = { ...VE, provider: p, model: p === sv.provider ? (sv.model || sv.defaults[p]) : (sv.defaults || VMODEL)[p], key: (sv.keys || {})[p] || '' };
    drawSettings(); return;
  }
  if ((el = q('[data-vl]'))) { readVoice(); VE.lang = el.dataset.vl; drawSettings(); return; }
  if ((el = q('[data-vact]'))) {
    const body = readVoice(), res = $('#vRes');
    res.className = 'result'; res.textContent = el.dataset.vact === 'voice' ? '保存中……' : '测试中：送一秒静音过去……';
    const j = await api(el.dataset.vact, body).catch(e => ({ ok: false, msg: e.message }));
    if (j.ok && el.dataset.vact === 'voice') { VE = null; await load(); drawSettings(); }
    const r2 = $('#vRes'); r2.className = 'result ' + (j.ok ? 'ok' : 'bad'); r2.textContent = j.msg;
    return;
  }
  if ((el = q('[data-rec]'))) { takeRec(el.dataset.rec); return; }
  if ((el = q('[data-stop]'))) { if (confirm('停止这个子 agent？它和它启动的进程都会被结束。')) post('stop', { id: el.dataset.stop }); return; }
  if ((el = q('[data-mreply]'))) { const f = document.querySelector(`.m-reply[data-mid="${CSS.escape(el.dataset.mreply)}"]`); if (f) { f.hidden = !f.hidden; if (!f.hidden) f.querySelector('input').focus(); } return; }
  if ((el = q('[data-mread]'))) { post('mail_read', { mid: el.dataset.mread }); return; }
  if ((el = q('[data-unlock]'))) { if (confirm('释放这把推送锁？在等它的会话会收到通知。')) post('unlock', { key: el.dataset.unlock }); return; }
  if ((el = q('[data-quiet]'))) { toggle(quietOpen, 'deck.quietOpen', el.dataset.quiet); return; }
  if ((el = q('[data-report]'))) { e.stopPropagation(); el.disabled = true; el.textContent = '正在写…'; post('report', { id: el.dataset.report }); return; }
  if ((el = q('[data-acc]'))) { const key = el.dataset.acc; await api('access', { do: 'drop', key }); if (key === 'me') location.reload(); else drawAccess(); return; }
  if ((el = q('[data-wscolor]'))) { store.set('deck.wsColor', el.dataset.wscolor); applyWsColor(); drawSettings(); return; }
  if ((el = q('[data-theme-set]'))) { store.set('deck.theme', el.dataset.themeSet); applyTheme(); drawSettings(); return; }
  if ((el = q('[data-src]'))) { const role = el.closest('.mblock').dataset.role; MB[role] = { source: el.dataset.src }; drawSettings(); return; }
  if ((el = q('[data-mact]'))) {
    const role = el.closest('.mblock').dataset.role, body = readModel(role), res = $('#res-' + role);
    res.className = 'result'; res.textContent = el.dataset.mact === 'test' ? '测试中……' : '保存中……';
    const j = await api(el.dataset.mact === 'test' ? 'models_test' : 'models', body).catch(e => ({ ok: false, msg: e.message }));
    res.className = 'result ' + (j.ok ? 'ok' : 'bad'); res.textContent = j.msg;
    if (j.ok && el.dataset.mact === 'save') { delete MB[role]; await load(); drawSettings(); $('#res-' + role).className = 'result ok'; $('#res-' + role).textContent = j.msg; }
    return;
  }
});
document.addEventListener('submit', async e => {
  const f = e.target.closest('.m-reply');
  if (!f) return;
  e.preventDefault();
  const text = f.querySelector('input').value.trim();
  if (!text) return;
  const j = await post('mail_reply', { mid: f.dataset.mid, text });
  if (j && j.ok) f.hidden = true;
});
document.addEventListener('input', e => {
  if (e.target.id === 'wsFilter') { if (!e.isComposing) { sig.wsFilter = e.target.value; if ($('#wsList')) $('#wsList').innerHTML = wsListHtml(); } return; } if (e.target.closest('#newBody') && NS) { readNew(); const c = $('#nsCli'); if (c) c.textContent = cliText(); } });
document.addEventListener('compositionend', e => { if (e.target.id === 'wsFilter') { sig.wsFilter = e.target.value; if ($('#wsList')) $('#wsList').innerHTML = wsListHtml(); } });
document.addEventListener('change', async e => {
  if (e.target.id === 'paneTitles') post('titles', { on: e.target.checked });
  if (e.target.dataset.attrib) post('attribute', { id: e.target.dataset.attrib, project: e.target.value });
  if (e.target.id === 'vOn') {  // (the switch takes effect at once)
    const j = await api('voice', { only_on: e.target.checked }).catch(x => ({ ok: false, msg: x.message }));
    toast(j.msg, j.ok); await load(); VE = null; drawSettings();
  }
});
$('#searchBtn').onclick = openPalette;
$('#asstBtn').onclick = () => asstToggle();
$('#newBtn').onclick = () => openNew('');
$('#settingsBtn').onclick = openSettings;
$('#themeBtn').onclick = () => { const o = ['auto', 'light', 'dark'], t = store.get('deck.theme', 'auto'); store.set('deck.theme', o[(o.indexOf(t) + 1) % 3]); applyTheme(); };
$('#paletteQ').addEventListener('input', () => { palIndex = 0; drawPalette(); });
$('#paletteQ').addEventListener('keydown', e => {
  const items = palAll();
  if (e.key === 'ArrowDown') { palIndex = Math.min(items.length - 1, palIndex + 1); drawPalette(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { palIndex = Math.max(0, palIndex - 1); drawPalette(); e.preventDefault(); }
  else if (e.key === 'Enter' && items[palIndex]) palOpen(items[palIndex]);
});
document.addEventListener('keydown', e => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
  const overlay = ['#palette', '#settings', '#newSess'].some(id => !$(id).hidden);
  if (e.key === 'Escape') { if (overlay) closeOverlays(); else if (route.name === 'session' && !typing) location.hash = '#/'; return; }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && document.activeElement.id === 'rText') { const b = document.querySelector('[data-act="say"]:not([disabled])'); if (b) b.click(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); asstToggle(); return; }
  if (!typing && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); setSide(!sideOff); return; }
  if (!typing && (e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key) && S) { const w = railWs()[+e.key - 1]; if (w) { e.preventDefault(); location.hash = `#/w/${encodeURIComponent(w.key)}`; } return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === '/') { e.preventDefault(); openPalette(); }
  else if (e.key.toLowerCase() === 'n') { e.preventDefault(); openNew(''); }
});

route = parseRoute();
applyTheme();
applyFold();
applyWsColor();
// (a session's or project's head stays at the top while its page scrolls, folded to one line)
document.addEventListener('scroll', e => {
  const h = e.target && e.target.id === 'sess' && $('#hero');
  if (h) { if (e.target.scrollTop > 60) h.classList.add('compact'); else if (e.target.scrollTop < 8) h.classList.remove('compact'); }  // (two thresholds: folding changes the height)
}, true);
build();
load().then(() => asstToggle(ASST.open));
setInterval(load, 2000);
setInterval(conn, 1000);
