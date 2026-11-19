// Sturnus — the page's frame since sessions last (the deck's kept.py): loaded after app.js, whose pages it keeps.
// One sidebar: a new session, search, the places (what needs you, tasks, discussions, …), then the sessions — the
// person's own, running or stopped — by workspace, or as one list. Beside it: the new-session page, which is also the
// first page (#/); a session (#/k/<id>): its conversations one after another with a line where its terminal changed,
// words for it, and what it is and has run in on the right; a workspace (#/w/<id>): its sessions, tasks, discussions
// and folders; every session, the archived too (#/all). A phone keeps the pages app.js draws for it.
'use strict';
const OLD = { parseRoute, build, render, drawRail, drawSide, palPlaces, palItems, drawSettings };
const KV = { view: store.get('deck.kView', 'space'), open: new Set(store.get('deck.kOpen', [])), places: store.get('deck.kPlaces', false), info: store.get('deck.kInfo', true),
  full: {}, all: null, allAt: 0, chatAt: 0, menu: false, rename: false, blind: !S, spTab: {}, allShow: 'open', allQ: '', hand: null, hits: [], hitsQ: '', hitsT: 0, side: 'info', diff: { id: '', at: 0, data: null, files: {} } };
KV.shut = new Set(store.get('deck.kShut', []));  // (the workspaces folded shut in the sidebar: each shows its name and its counts only)
const KNEED = ['waiting', 'asking', 'blocked', 'review'];
// (how the sidebar's sessions are grouped, and how they are ordered inside a group: each the person's choice, kept in this browser)
const KGROUP = { space: ['工作区', 'Workspace'], state: ['状态', 'Status'], kind: ['Agent', 'Agent'], day: ['时间', 'Date'], flat: ['不分组', 'No groups'] };
const KSORT = { state: ['等你的在前', 'Needs you first'], at: ['最近活动', 'Last active'], made: ['创建时间', 'Created'], name: ['名字', 'Name'] };
if (!KGROUP[KV.view]) KV.view = 'space';
KV.sort = store.get('deck.kSort', 'state');
if (!KSORT[KV.sort]) KV.sort = 'state';
KV.arr = false;  // (the menu of those two, open)
// (what the person sent from a session's page and its conversation does not show yet: shown at once, under the conversation)
Object.assign(KV, { sent: {}, sentN: 0, chatBusy: false, chatFast: 0, take: '' });
const KSENT = { sending: ['发送中……', 'Sending…'], type: ['已送到它的终端', 'In its terminal'], wait: ['已送到它的终端，它做完手上这一步就读', 'In its terminal: read once it is through with the step in hand'],
  mail: ['已放进它的信箱，它下一步就会看到', 'In its mailbox: it sees it next'], start: ['终端起来后送到', 'Delivered once its terminal is up'] };
const KN = { kind: store.get('deck.newKind', 'claude'), space: store.get('deck.kSpace', null), dir: '', wt: store.get('deck.kWt', false) };  // (space: null until the person has picked one, or none)
const KI = {
  side: '<svg viewBox="0 0 20 20"><rect x="3.5" y="4.5" width="13" height="11" rx="2"/><path d="M8 4.5v11"/></svg>',
  find: '<svg viewBox="0 0 20 20"><circle cx="8.8" cy="8.8" r="5.6"/><path d="m13 13 4 4"/></svg>',
  bell: '<svg viewBox="0 0 20 20"><path d="M5 8.2a5 5 0 0 1 10 0c0 3.6 1.6 4.8 1.6 4.8H3.4S5 11.8 5 8.2M8.4 15.5a1.7 1.7 0 0 0 3.2 0"/></svg>',
  pin: '<svg viewBox="0 0 20 20"><path d="M7.5 3.5h5l-.8 5 2.5 2.5H5.8l2.5-2.5zM10 11v5.5"/></svg>',
  dots: '<svg viewBox="0 0 20 20"><path d="M5 10h.01M10 10h.01M15 10h.01" stroke-width="2.6"/></svg>',
  copy: '<svg viewBox="0 0 20 20"><rect x="7.5" y="7.5" width="8" height="8" rx="1.6"/><path d="M4.5 12.5V6A1.5 1.5 0 0 1 6 4.5h6.5"/></svg>',
  pen: '<svg viewBox="0 0 20 20"><path d="M4.5 15.5l.7-3.2 7.9-7.9a1.4 1.4 0 0 1 2 0l.5.5a1.4 1.4 0 0 1 0 2l-7.9 7.9zM11.8 5.7l2.5 2.5"/></svg>',
  play: '<svg viewBox="0 0 20 20"><path d="M7.5 5v10l8-5z"/></svg>',
  gear: '<svg viewBox="0 0 20 20"><path d="M8.6 2.8h2.8l.4 2 1.6.9 1.9-.7 1.4 2.4-1.5 1.3v1.8l1.5 1.3-1.4 2.4-1.9-.7-1.6.9-.4 2H8.6l-.4-2-1.6-.9-1.9.7-1.4-2.4 1.5-1.3V9.1L3.3 7.8l1.4-2.4 1.9.7 1.6-.9z"/><circle cx="10" cy="10" r="2.3"/></svg>',
  x: '<svg viewBox="0 0 20 20"><path d="m5.5 5.5 9 9M14.5 5.5l-9 9"/></svg>',
  clock: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.5"/><path d="M10 6.5V10l2.5 1.5"/></svg>',
  shut: '<svg viewBox="0 0 20 20"><path d="m6.5 4 3.5 3 3.5-3M6.5 16l3.5-3 3.5 3"/></svg>',
  unshut: '<svg viewBox="0 0 20 20"><path d="m6.5 7.5 3.5-3 3.5 3M6.5 12.5l3.5 3 3.5-3"/></svg>',
};
const KNOT = { on: store.get('deck.kNotify', false), sound: store.get('deck.kSound', false), was: null };
const KWAY = { 'zellij-tab': ['Zellij：工作区那一组里的一个标签', 'Zellij: a tab in the workspace’s group'], 'tmux-window': ['tmux：工作区那一组里的一个窗口', 'tmux: a window in the workspace’s group'],
  'tmux-own': ['tmux：每条会话一个自己的 tmux 会话', 'tmux: a tmux session of its own for each session'] };
const KWHY = { restart: ['机器重启', 'the machine restarted'], closed: ['它的终端被关掉了', 'its terminal was closed'], exited: ['agent 退出了，窗格还在', 'the agent quit, its pane is still there'],
  moved: ['换到了另一个窗格', 'it moved to another pane'], stopped: ['你停了它', 'you stopped it'], ended: ['终端结束了', 'its terminal ended'],
  rested: ['很久没用，Sturnus 关了它的终端', 'unused for long, so Sturnus closed its terminal'] };
// (what a session's page held when it was left — its conversation as read, how far it was scrolled, the steps opened, the
// words begun in its boxes, its changes as read — kept in memory for the forty sessions last looked at: coming back shows
// it at once and reads on from there)
KV.pages = new Map();
function kPage(id) {
  let p = KV.pages.get(id);
  if (p) KV.pages.delete(id);
  else p = { items: null, sig: '', n: 200, more: false, moreBusy: false, hold: null, top: 0, atEnd: true, tools: new Set(), draft: '', diffDraft: '', diff: { at: 0, data: null, files: {}, filesAt: 0, open: new Set(), busy: false } };
  KV.pages.set(id, p);
  if (KV.pages.size > 40) KV.pages.delete(KV.pages.keys().next().value);
  return p;
}

// ---------- what the record holds, as the page reads it ----------
const kSpace = id => (S.spaces || []).find(w => w.id === id) || null;
const kOf = id => (S.kept || []).find(k => k.id === id) || (KV.full[id] || {}).kept || (KV.all || []).find(k => k.id === id) || null;
const kLive = k => (k && k.live && S.sessions.find(s => s.id === k.live)) || null;
const kTitle = k => { const s = kLive(k); return k.title || (s && !s.starting ? s.title : '') || k.name || (s && s.name) || tt('还没有名字', 'Not named yet'); };
const kStand = k => { const s = kLive(k); return s ? standing(s) : ['stopped', tt('已停止', 'Stopped')]; };
const kHref = k => `#/k/${encodeURIComponent(k.id)}`;
const kRank = st => SIDE_RANK[st] ?? (st === 'stopped' ? 8 : 9);
// (the running ones in the order they began, so the list holds still while they work; the stopped ones, the latest first)
const kOrder = (a, b) => { const x = kStand(a)[0], y = kStand(b)[0]; return kRank(x) - kRank(y) || (x === 'stopped' ? b.at - a.at : ((kLive(a) || {}).born || 0) - ((kLive(b) || {}).born || 0)); };
const kAt = k => { const s = kLive(k); return (s && (s.at || s.since)) || k.at || 0; };  // (when a session last did something)
const kSorter = () => (KV.sort === 'at' ? (a, b) => kAt(b) - kAt(a) : KV.sort === 'made' ? (a, b) => (b.made || 0) - (a.made || 0)
  : KV.sort === 'name' ? (a, b) => kTitle(a).localeCompare(kTitle(b), LANG === 'zh' ? 'zh-Hans-CN' : 'en', { numeric: true, sensitivity: 'base' }) : kOrder);
const kDay = ts => { const d = new Date(ts * 1000); return tt(`${d.getMonth() + 1}月${d.getDate()}日 `, `${d.getMonth() + 1}/${d.getDate()} `) + d.toLocaleTimeString(LANG === 'en' ? 'en-GB' : 'zh-CN', { hour: '2-digit', minute: '2-digit' }); };
const kWhere = t => (t.mux ? `${t.mux} ${t.grp.replace(/^tmux:/, '')}${tt(`，窗格 ${t.pane}`, `, pane ${t.pane}`)}` : (t.origin ? originT(t.origin) : tt('不在 Zellij 或 tmux 里', 'not in Zellij or tmux')));
const kMux = t => (t.mux === 'tmux' ? 'tmux' : t.mux === 'zellij' ? 'Zellij' : tt('别处', 'elsewhere'));
// (the keys under which a workspace's tasks and channels are kept: its own, and those of the projects in its folders)
const kInside = (sp, p) => !!p && sp.places.some(x => p === x.path || p.startsWith(x.path.replace(/\/$/, '') + '/'));
const kScopes = sp => new Set([sp.id, ...Object.values(S.projects || {}).filter(p => kInside(sp, p.path)).map(p => p.key), ...(S.workspaces || []).filter(w => kInside(sp, w.path)).map(w => w.key)]);

async function kFull(id, k) {  // (a session with its conversations and terminals: read again when it has more of them, or now and then)
  const f = KV.full[id], sigf = k ? [k.nsegs, k.nterms, k.live, k.archived].join() : '';
  if (f && (f.busy || (f.sig === sigf && Date.now() - f.at < 20000))) return;
  KV.full[id] = { ...(f || {}), busy: true };
  try {
    const j = await (await fetch('/api/kept?id=' + encodeURIComponent(id), { cache: 'no-store' })).json();
    KV.full[id] = { kept: j.ok ? j.kept : null, missing: !j.ok, at: Date.now(), sig: sigf };
  } catch { KV.full[id] = { ...(f || {}), busy: false, at: Date.now(), sig: sigf }; }
  render();
}
async function kAll(force) {  // (every session, the archived too: for the page that lists them all)
  if (!force && Date.now() - KV.allAt < 8000) return;
  KV.allAt = Date.now();
  try { KV.all = (await (await fetch('/api/kept', { cache: 'no-store' })).json()).kept || []; render(); } catch {}
}
const kDo = async (what, body) => { const j = await api(what, body).catch(e => ({ ok: false, msg: e.message })); if (j.msg) toast(j.msg, j.ok); await load(); return j; };

// ---------- addresses ----------
// (a session's report is part of its overview now: an address that says report still leads there)
function kRoute(kid, tab, lid) { return { name: 'session', kept: kid, id: lid || '', tab: tab === 'report' ? 'overview' : tab || 'chat' }; }
window.parseRoute = function () {
  const h = location.hash.replace(/^#/, '');
  KV.blind = !S;  // (read before the first look at the deck: read again once it is there)
  let m;
  if (phone()) return OLD.parseRoute();
  if (h === '/need') return { name: 'need' };
  if (h === '/all') return { name: 'all' };
  if (h === '/plans') return { name: 'plans' };
  if ((m = h.match(/^\/k\/([^/]+)(?:\/(chat|overview|report|term|msgs))?$/))) return kRoute(decodeURIComponent(m[1]), m[2]);
  if ((m = h.match(/^\/w\/([^/]+)(?:\/(sessions|dash|tasks|boards|folders|projects|works))?$/))) {
    const key = decodeURIComponent(m[1]);
    if (key === '+') return { name: 'space', key: '+', tab: 'new' };
    if (S && kSpace(key)) return { name: 'space', key, tab: { projects: 'folders', works: 'folders' }[m[2]] || m[2] || 'sessions' };
  }
  const r = OLD.parseRoute();
  if (r.name === 'session' && r.tab !== 'sub' && S) {  // (an address by the row that runs it: the session's own page)
    const s = S.sessions.find(x => x.id === r.id);
    if (s && s.kept && !s.parent_id) return kRoute(s.kept, /\/(overview|report|chat|term|msgs)$/.test(h) ? r.tab : 'chat', s.id);
  }
  return r;
};

// ---------- the sidebar ----------
function kRow(k, two) {
  const [st] = kStand(k), s = kLive(k), on = route.kept === k.id, sp = kSpace(k.space);
  const need = ['waiting', 'asking', 'blocked', 'review'].includes(st);
  const when = need ? { blocked: tt('卡住', 'Stuck'), review: tt('待验收', 'Review') }[st] || tt('等你', 'You') : st === 'working' ? tt('工作中', 'Working') : ago(s ? s.at || s.since : k.at);
  return `<a class="ks-row${on ? ' on' : ''}${two ? ' two' : ''}" href="${kHref(k)}" title="${esc(kTitle(k))} · ${esc(FULL[k.kind] || k.kind)} · ${esc(kStand(k)[1])}">${mark(k.kind, st, 'xs')}
    <span class="t"><span>${esc(kTitle(k))}</span>${two ? `<small>${esc(sp ? sp.name : tt('未归入工作区', 'In no workspace'))}</small>` : ''}</span><span class="w${need ? ' need' : st === 'working' ? ' work' : ''}">${esc(when)}</span></a>`;
}
function kGroup(key, label, lead, rows, plus = '', two = false) {
  rows = rows.slice().sort(kSorter());
  const shut = KV.shut.has(key), liveN = rows.filter(k => k.live).length, open = KV.open.has(key);
  const need = rows.filter(k => KNEED.includes(kStand(k)[0])).length;
  const few = rows.filter((k, i) => i < 6 || k.live || k.id === route.kept);  // (not opened out: the first six as ordered, and whatever runs or is being looked at)
  const shown = shut ? rows.filter(k => k.id === route.kept) : open ? rows : few;  // (shut: only the one being looked at stays in sight)
  const say = shut ? tt(`展开 ${label}`, `Unfold ${label}`) : tt(`折叠 ${label}`, `Fold ${label}`);
  return `<div class="ks-g${shut ? ' shut' : ''}"><div class="ks-gh" data-kshut="${esc(key)}"><button class="ks-cv" aria-expanded="${!shut}" title="${esc(say)}" aria-label="${esc(say)}">${chev(!shut)}</button>${lead}
      ${shut ? `<span class="ks-cnt">${need ? `<span class="n hot" title="${tt('等你的', 'Need you')}">${big(need)}</span>` : ''}<span class="n" title="${liveN ? tt(`${rows.length} 条会话，${liveN} 条在跑`, `${rows.length} sessions, ${liveN} running`) : tt(`${rows.length} 条会话`, `${rows.length} sessions`)}">${big(rows.length)}</span></span>` : ''}${plus}</div>
    ${shown.map(k => kRow(k, two)).join('')}${!shut && rows.length > few.length ? `<button class="ks-more" data-kopen="${esc(key)}">${chev(open)}${open ? tt('收起', 'Fold') : tt(`还有 ${rows.length - few.length} 条`, `${rows.length - few.length} more`)}</button>` : ''}</div>`;
}
// (a workspace's mark where there is room for no name: two letters of a Latin name, one character of any other)
const kAbbr = name => { const n = String(name || '').trim(), m = n.match(/^[A-Za-z0-9][A-Za-z0-9]?/); return m ? m[0][0].toUpperCase() + m[0].slice(1).toLowerCase() : [...n][0] || '?'; };
function kDrawSide() {
  const kept = (S.kept || []).filter(k => !k.archived), spaces = (S.spaces || []).filter(w => !w.archived);
  const need = S.sessions.filter(attention).length + (S.inbox || []).length + (S.lock_issues || []).length;
  const boards = Object.values(S.boards || {}), bNew = boards.reduce((n, b) => n + (b.unread || 0), 0), bCalls = boards.reduce((n, b) => n + (b.calls || 0), 0);
  const tNeed = (S.tasks || []).filter(x => x.shown === 'needs').length, qReady = (S.queue || []).filter(i => i.status === 'ready').length;
  const off = Date.now() - lastOk > 6000;
  const narrow = sideOff && !phone();
  $('#ks').classList.toggle('strip', narrow);  // (not 'rail': that is the old frame's, and hidden here)
  draw('ks', [route, narrow, KV.view, KV.sort, KV.arr, KV.sort === 'at' && kept.map(kAt), [...KV.open], [...KV.shut], KV.places, kept.map(k => [k.id, kTitle(k), k.space, k.pinned, k.live, k.kind, kStand(k)[0]]), spaces.map(w => [w.id, w.name, w.places.length]),
    need, bNew, bCalls, tNeed, qReady, off, S.version, Math.floor(Date.now() / 60000), LANG, document.documentElement.dataset.theme], () => {
    const at = route.name, more = ['talk', 'reports', 'queue', 'plans'], plans = (S.plans || []).filter(x => x.live).length;
    const here = at === 'space' ? route.key : at === 'session' ? ((kOf(route.kept) || {}).space || '~none') : '';
    const none = kept.filter(k => !kSpace(k.space) || kSpace(k.space).archived);
    // (the workspaces in the order chosen for sessions: the one with the latest, or the newest, session first; by name; or those that need the person, then those at work)
    const mineOf = w => kept.filter(k => k.space === w.id), byName = (a, b) => a.name.localeCompare(b.name);
    const lead = new Map(spaces.map(w => [w.id, KV.sort === 'at' ? Math.max(0, ...mineOf(w).map(kAt)) : KV.sort === 'made' ? Math.max(0, ...mineOf(w).map(k => k.made || 0))
      : KV.sort === 'name' ? 0 : (mineOf(w).some(k => KNEED.includes(kStand(k)[0])) ? 2 : 0) + (w.live > 0 ? 1 : 0)]));
    const byLive = spaces.slice().sort((a, b) => lead.get(b.id) - lead.get(a.id) || byName(a, b));
    if (narrow) {  // (folded to a strip of marks: every place still one click away, each workspace a tile that says whether it needs the person)
      const rb = (href, on, icon, label, n, hot) => `<a href="${href}" class="kr-b${on ? ' on' : ''}" title="${esc(label)}" aria-label="${esc(label)}">${icon}${n ? `<span class="n${hot ? ' hot' : ''}">${big(n)}</span>` : ''}</a>`;
      const tile = (id, name, mine, href, cls = '') => {
        const n = mine.filter(k => KNEED.includes(kStand(k)[0])).length, live = mine.filter(k => k.live).length;
        const say = `${name}${n ? tt(`：${n} 条等你`, `: ${n} need you`) : live ? tt(`：${live} 条在跑`, `: ${live} running`) : ''}`;
        return `<a class="kr-b kr-w${here === id ? ' on' : ''}" href="${href}" title="${esc(say)}" aria-label="${esc(say)}"><span class="ks-tile${cls}">${cls ? '' : esc(kAbbr(name))}</span>${n ? `<span class="n hot">${big(n)}</span>` : live ? '<i></i>' : ''}</a>`;
      };
      $('#ks').innerHTML = `<button class="kr-b" id="ksShow" title="${tt('展开侧栏（⌘B）', 'Show the sidebar (⌘B)')}" aria-label="${tt('展开侧栏', 'Show the sidebar')}">${KI.side}</button>
        <a class="kr-b kr-new" href="#/" title="${tt('新会话（N）', 'New session (N)')}" aria-label="${tt('新会话', 'New session')}">${I.plus}</a>
        <button class="kr-b" id="ksFind" title="${tt('搜索会话、工作区（⌘K）', 'Search sessions, workspaces (⌘K)')}" aria-label="${tt('搜索', 'Search')}">${KI.find}</button>
        <span class="kr-sep"></span>
        ${rb('#/need', at === 'need', KI.bell, tt('等你处理', 'Needs you'), need, true)}${rb('#/tasks', at === 'tasks', I.check, tt('任务', 'Tasks'), tNeed, true)}${rb('#/boards', at === 'boards' || at === 'board', I.chat, tt('讨论', 'Discussions'), bCalls || bNew, bCalls > 0)}
        ${at === 'talk' ? rb('#/talk', true, I.mail, tt('消息', 'Messages')) : at === 'reports' ? rb('#/reports', true, I.doc, tt('报告', 'Reports')) : at === 'queue' ? rb('#/queue', true, I.list, tt('排队', 'Queue'), qReady, true) : at === 'plans' ? rb('#/plans', true, KI.clock, tt('定时', 'By the clock'), plans) : ''}
        <span class="kr-sep"></span>
        <div class="kr-list">${byLive.map(w => tile(w.id, w.name, kept.filter(k => k.space === w.id), `#/w/${encodeURIComponent(w.id)}`)).join('')}${none.length ? tile('~none', tt('未归入工作区', 'In no workspace'), none, '#/all', ' none') : ''}</div>
        <div class="kr-foot"><span class="ks-conn${off ? ' off' : ''}" title="${off ? tt('连接中断，重试中', 'Reconnecting') : tt('实时', 'Live')} · Sturnus ${esc(S.version || '')}"><i></i></span>
          <button class="kr-b" id="ksAsst" title="${tt('助手：问各个会话的事（⌘J）', 'Assistant: ask about the sessions (⌘J)')}" aria-label="${tt('助手', 'Assistant')}">${I.spark}</button>
          <button class="kr-b" id="ksSet" title="${tt('设置', 'Settings')}" aria-label="${tt('设置', 'Settings')}">${KI.gear}</button></div>`;
      return;
    }
    // (a place in one line of the sidebar: its word where words are two characters long, its mark where they are not — three English words and their counts do not fit a line)
    const chip = (href, on, icon, label, n, hot, full) => `<a href="${href}" class="ks-chip${on ? ' on' : ''}" title="${full || label}"${LANG === 'zh' ? '' : ` aria-label="${full || label}"`}>${LANG === 'zh' ? `<span>${label}</span>` : icon}${n ? `<span class="n${hot ? ' hot' : ''}">${big(n)}</span>` : ''}</a>`;
    const pinned = kept.filter(k => k.pinned), rest = kept.filter(k => !k.pinned);
    const two = KV.view !== 'space', plain = x => `<span class="nm">${esc(x)}</span>`;
    let groups = [];  // ([key, its name, what its head shows, its sessions, what follows its head])
    if (KV.view === 'space') {
      const loose = rest.filter(k => !kSpace(k.space) || kSpace(k.space).archived);
      groups = byLive.map(w => [w.id, w.name, `<span class="ks-tile">${esc(w.name.slice(0, 1).toUpperCase())}</span>
            <a class="nm" href="#/w/${encodeURIComponent(w.id)}" title="${esc(w.places.map(p => p.show).join('\n'))}">${esc(w.name)}</a>`, rest.filter(k => k.space === w.id),
            `<a class="ks-ib" href="#/" data-knew="${esc(w.id)}" title="${esc(tt(`在 ${w.name} 里开新会话`, `New session in ${w.name}`))}" aria-label="${esc(tt(`在 ${w.name} 里开新会话`, `New session in ${w.name}`))}">${I.plus}</a>`]);
      if (loose.length) groups.push(['~none', tt('未归入工作区', 'In no workspace'), `<span class="ks-tile none"></span>${plain(tt('未归入工作区', 'In no workspace'))}`, loose, '']);
    } else if (KV.view === 'state') {
      const of = k => { const st = kStand(k)[0]; return KNEED.includes(st) ? 'need' : st === 'stopped' ? 'stopped' : st === 'idle' ? 'idle' : 'working'; };
      groups = [['need', tt('等你', 'Needs you')], ['working', tt('工作中', 'Working')], ['idle', tt('空闲', 'Idle')], ['stopped', tt('已停止', 'Stopped')]].map(([x, name]) => [`~st:${x}`, name, plain(name), rest.filter(k => of(k) === x), '']);
    } else if (KV.view === 'kind') {
      const kinds = [...new Set(['claude', 'codex', 'cursor', ...rest.map(k => k.kind)])];
      groups = kinds.map(x => [`~k:${x}`, FULL[x] || x, `${mark(x, '', 'xs')}${plain(FULL[x] || x)}`, rest.filter(k => k.kind === x), '']);
    } else if (KV.view === 'day') {  // (by the day of what the order goes by: when it was made, else when it last did something)
      const d0 = new Date(); d0.setHours(0, 0, 0, 0);
      const t0 = d0 / 1000, when = k => (KV.sort === 'made' ? k.made || 0 : kAt(k));
      const of = k => { const t = when(k); return t >= t0 ? 'today' : t >= t0 - 86400 ? 'yday' : t >= t0 - 6 * 86400 ? 'week' : t >= t0 - 29 * 86400 ? 'month' : 'old'; };
      groups = [['today', tt('今天', 'Today')], ['yday', tt('昨天', 'Yesterday')], ['week', tt('最近 7 天', 'Last 7 days')], ['month', tt('最近 30 天', 'Last 30 days')], ['old', tt('更早', 'Earlier')]].map(([x, name]) => [`~d:${x}`, name, plain(name), rest.filter(k => of(k) === x), '']);
    }
    if (KV.view !== 'space') groups = groups.filter(g => g[3].length);
    if (pinned.length) groups.unshift(['~pin', tt('置顶', 'Pinned'), `<span class="nm sub">${tt('置顶', 'Pinned')}</span>`, pinned, '']);
    const keys = KV.view === 'flat' ? [] : groups.map(g => g[0]);
    let list = groups.map(g => kGroup(g[0], g[1], g[2], g[3], g[4], two)).join('');
    if (KV.view === 'flat') {
      const all = rest.slice().sort(kSorter()), wide = KV.open.has('~flat');
      list += `<div class="ks-g">${all.slice(0, wide ? 400 : 40).map(k => kRow(k, true)).join('')}
          ${all.length > 40 ? `<button class="ks-more" data-kopen="~flat">${chev(wide)}${wide ? tt('收起', 'Fold') : tt(`还有 ${all.length - 40} 条`, `${all.length - 40} more`)}</button>` : ''}</div>`;
    }
    const allShut = keys.length > 0 && keys.every(x => KV.shut.has(x));
    $('#ks').innerHTML = `<div class="ks-top"><a href="#/" class="ks-logo" title="Sturnus" aria-label="Sturnus"><img class="logo" src="icon.svg" alt=""></a>
        <a class="ks-new${at === 'home' ? ' on' : ''}" href="#/">${I.plus}<span>${tt('新会话', 'New session')}</span><kbd>N</kbd></a>
        <button class="ks-ib" id="ksFind" title="${tt('搜索会话、工作区（⌘K）', 'Search sessions, workspaces (⌘K)')}" aria-label="${tt('搜索', 'Search')}">${KI.find}</button>
        <button class="ks-ib" id="ksFold" title="${tt('收成一条图标栏（⌘B）', 'Fold to a strip of icons (⌘B)')}" aria-label="${tt('收起侧栏', 'Fold the sidebar')}">${KI.side}</button></div>
      <nav class="ks-nav">${chip('#/need', at === 'need', KI.bell, tt('等你', 'Needs you'), need, true, tt('等你处理', 'Needs you'))}${chip('#/tasks', at === 'tasks', I.check, tt('任务', 'Tasks'), tNeed, true)}${chip('#/boards', at === 'boards' || at === 'board', I.chat, tt('讨论', 'Discussions'), bCalls || bNew, bCalls > 0)}
        <button class="ks-chip ic${KV.places ? ' on' : ''}" data-kplaces aria-expanded="${KV.places || more.includes(at)}" title="${tt('消息、报告、排队、定时', 'Messages, reports, queue, by the clock')}" aria-label="${tt('更多：消息、报告、排队、定时', 'More: messages, reports, queue, by the clock')}">${KI.dots}</button>
        ${KV.places || more.includes(at) ? `<span class="ks-br"></span>${chip('#/talk', at === 'talk', I.mail, tt('消息', 'Messages'))}${chip('#/reports', at === 'reports', I.doc, tt('报告', 'Reports'))}${chip('#/queue', at === 'queue', I.list, tt('排队', 'Queue'), qReady, true)}${chip('#/plans', at === 'plans', KI.clock, tt('定时', 'By the clock'), plans)}` : ''}</nav>
      <div class="ks-h"><span>${tt('会话', 'Sessions')}</span>${keys.length ? `<button class="ks-ib" data-kshutall="${allShut ? 0 : 1}" data-keys="${esc(keys.join(' '))}" title="${allShut ? tt('全部展开', 'Unfold all') : tt('全部折叠', 'Fold all')}" aria-label="${allShut ? tt('全部展开', 'Unfold all') : tt('全部折叠', 'Fold all')}">${allShut ? KI.unshut : KI.shut}</button>` : ''}
        <div class="ks-arr"><button class="ks-arrb" data-karr aria-haspopup="menu" aria-expanded="${KV.arr}" title="${tt('分组和排序', 'Grouping and order')}">${tt(...KGROUP[KV.view])}<i>·</i>${tt(...KSORT[KV.sort])}${chev(true)}</button>
          ${KV.arr ? `<div class="ks-menu" role="menu" aria-label="${tt('分组和排序', 'Grouping and order')}"><div class="ks-mh">${tt('分组', 'Group by')}</div>${Object.keys(KGROUP).map(x => `<button role="menuitemradio" aria-checked="${KV.view === x}" data-kview="${x}">${KV.view === x ? I.check : '<span class="no"></span>'}${tt(...KGROUP[x])}</button>`).join('')}
            <div class="ks-mh">${tt('排序', 'Order')}</div>${Object.keys(KSORT).map(x => `<button role="menuitemradio" aria-checked="${KV.sort === x}" data-ksort="${x}">${KV.sort === x ? I.check : '<span class="no"></span>'}${tt(...KSORT[x])}</button>`).join('')}</div>` : ''}</div></div>
      <div class="ks-list" id="ksList">${list}
        <a class="ks-more" href="#/w/+">${I.plus}${tt('新建工作区', 'New workspace')}</a>
        <a class="ks-more${at === 'all' ? ' on' : ''}" href="#/all">${I.list}${tt('查看全部会话和已归档的', 'All sessions, and the archived')}</a></div>
      <div class="ks-foot"><span class="ks-conn${off ? ' off' : ''}"><i></i>${off ? tt('连接中断，重试中', 'Reconnecting') : tt('实时', 'Live')}</span><span class="v">Sturnus ${esc(S.version || '')}</span>
        <button class="ks-ib" id="ksAsst" title="${tt('助手：问各个会话的事（⌘J）', 'Assistant: ask about the sessions (⌘J)')}" aria-label="${tt('助手', 'Assistant')}">${I.spark}</button>
        <button class="ks-ib" id="ksTheme" title="${tt('主题', 'Theme')}" aria-label="${tt('主题', 'Theme')}">${document.documentElement.dataset.theme === 'dark' ? I.moon : I.sun}</button>
        <button class="ks-ib" id="ksSet" title="${tt('设置', 'Settings')}" aria-label="${tt('设置', 'Settings')}">${KI.gear}</button></div>`;
  }) || 0;
  const cur = $('#ks .ks-row.on');
  if (cur && sig.ksAt !== route.kept) { sig.ksAt = route.kept; cur.scrollIntoView({ block: 'nearest' }); }
}

// ---------- the new session page: also the first page ----------
function kBuildHome() {
  $('#view').innerHTML = `<div class="kn"><div class="kn-in">
    <h1>${tt('要做什么？', 'What needs doing?')}</h1>
    <form class="kn-box" id="knForm" autocomplete="off"><textarea id="knText" rows="3" aria-label="${tt('这条会话要做的事', 'What this session is to do')}" placeholder="${tt('说说这条会话要做的事（也可以先不说，开起来再讲）。Enter 发送，Shift+Enter 换行', 'Say what this session is to do (or leave it empty and say it once it is up). Enter sends, Shift+Enter for a new line')}"></textarea>
      <div class="kn-row" id="knRow"></div></form>
    <div class="kn-opts" id="knOpts"></div><div id="knRecover"></div>
    <section class="entry"><div class="h-title"><h2>${tt('等你处理', 'Needs you')}</h2><span class="sub" id="attnSub"></span></div><div id="attn"></div></section>
  </div></div>`;
  $('#knForm').addEventListener('submit', e => { e.preventDefault(); kStart(); });
  // (Enter starts it once something is written; an empty box, which this page opens on, starts one only by ⌘/Ctrl+Enter or the button)
  $('#knText').addEventListener('keydown', e => { if (kEnter(e)) { e.preventDefault(); if (e.target.value.trim() || e.metaKey || e.ctrlKey) kStart(); } });
  setTimeout(() => $('#knText') && $('#knText').focus(), 40);
}
function kDrawHome() {
  const spaces = (S.spaces || []).filter(w => !w.archived);
  if (KN.space === null || (KN.space && !spaces.some(w => w.id === KN.space))) KN.space = (spaces.slice().sort((a, b) => b.live - a.live || b.n - a.n)[0] || { id: '' }).id;  // (not picked yet: the busiest one)
  const sp = kSpace(KN.space), kinds = Object.keys(S.launch || {}).filter(k => FULL[k]);
  if (sp && KN.dir !== '+' && !sp.places.some(p => p.path === KN.dir)) KN.dir = (sp.places.find(p => p.main) || sp.places[0] || {}).path || '+';
  const other = !sp || KN.dir === '+';
  if (!document.activeElement || !document.activeElement.closest || !document.activeElement.closest('#knRow')) draw('knrow', [KN, spaces.map(w => [w.id, w.name, w.places.map(p => p.path)]), (S.dirs || []).length, LANG, S.voice && S.voice.on], () => {
    const keep = $('#knCwd') ? $('#knCwd').value : store.get('deck.newCwd', '');
    $('#knRow').innerHTML = `<label class="kn-pick"><span>${tt('工作区', 'Workspace')}</span><select id="knSpace">${spaces.map(w => `<option value="${esc(w.id)}"${w.id === KN.space ? ' selected' : ''}>${esc(w.name)}</option>`).join('')}<option value=""${sp ? '' : ' selected'}>${tt('不归入工作区', 'No workspace')}</option></select></label>
      ${sp ? `<label class="kn-pick"><span>${tt('目录', 'Folder')}</span><select id="knDir">${sp.places.map(p => `<option value="${esc(p.path)}"${p.path === KN.dir ? ' selected' : ''}>${esc(p.show)}</option>`).join('')}<option value="+"${KN.dir === '+' ? ' selected' : ''}>${tt('其他目录…', 'Another folder…')}</option></select></label>` : ''}
      ${other ? `<input class="field" id="knCwd" list="knDirs" value="${esc(keep)}" placeholder="~/projects/…" aria-label="${tt('目录', 'Folder')}"><datalist id="knDirs">${(S.dirs || []).map(d => `<option value="${esc(d)}">`).join('')}</datalist>` : ''}
      <span id="knMic">${micBtn('knText')}</span><span class="sp"></span><button class="btn primary" type="submit" id="knGo">${tt('开始', 'Start')}${I.arrow}</button>`;
  });
  draw('knopts', [KN.kind, KN.wt, kinds, S.terminal, LANG], () => {
    const way = (S.terminal || {}).way;
    $('#knOpts').innerHTML = `<span class="l">${tt('用哪个', 'With')}</span><div class="kn-ch">${kinds.map(k => `<button type="button" data-knkind="${k}" aria-pressed="${KN.kind === k}" class="${KN.kind === k ? 'on' : ''}">${mark(k, '', 'xs')}${FULL[k]}</button>`).join('')}
        <span class="hint">${tt('各自用自己的命令行和登录，Sturnus 不代它们说话', 'Each runs its own CLI with its own sign-in; Sturnus never speaks for them')}</span></div>
      <span class="l">${tt('在哪改', 'Where')}</span><div class="kn-ch"><button type="button" data-knwt="0" aria-pressed="${!KN.wt}" class="${KN.wt ? '' : 'on'}">${tt('直接在这个目录里', 'Right in this folder')}</button><button type="button" data-knwt="1" aria-pressed="${!!KN.wt}" class="${KN.wt ? 'on' : ''}">${tt('新开一个 worktree', 'A worktree of its own')}</button>
        <span class="hint">${tt('worktree：在仓库的 .claude/worktrees/ 下给这条会话单开一个分支和目录，它只改自己的那份；做完在会话页的「改动」里合并进 main 并清掉。目录要在 git 仓库里。', 'A worktree: a branch and folder of its own under the repository’s .claude/worktrees/, so it changes only its own copy; when done, merge it into main and clear it away from the session’s Changes. The folder must be in a git repository.')}</span></div>
      <span class="l">${tt('终端', 'Terminal')}</span><div class="kn-term"><b>${esc(tt(...(KWAY[way] || [way, way])))}</b><button type="button" class="lnk" data-kset="terminal">${tt('换一种', 'Change')}</button>
        <span class="hint">${tt('会话在自己的终端里跑，在这台机器上随时能进去：sturnus open。终端关了、机器重启了，会话都还在，继续的时候换一个新终端。', 'A session runs in a terminal of its own; get to it on this machine at any time: sturnus open. Closed, or the machine restarted, the session stays, and goes on in a new terminal.')}</span></div>`;
  });
  draw('knrec', [S.recover, (S.recover || []).map(id => (kOf(id) || {}).title), LANG], () => {
    const ids = (S.recover || []).filter(kOf);
    $('#knRecover').innerHTML = ids.length ? `<div class="kstop"><div><b>${tt(`机器重启前有 ${ids.length} 条会话在跑`, `${ids.length} session${ids.length > 1 ? 's were' : ' was'} running before the machine restarted`)}</b>
      <span>${ids.slice(0, 6).map(id => esc(kTitle(kOf(id)))).join(tt('、', ', '))}${ids.length > 6 ? tt(' 等', ' and more') : ''}</span></div>
      <button class="btn" data-krecover="off">${tt('不用', 'No need')}</button><button class="btn primary" data-krecover="all">${KI.play}${tt('全部继续', 'Go on with all')}</button></div>` : '';
  });
  drawAttn('');
}
async function kStart() {
  const sp = kSpace(KN.space), other = !sp || KN.dir === '+';
  const cwd = other ? ($('#knCwd') ? $('#knCwd').value.trim() : '') : KN.dir;
  if (!cwd) { toast(tt('先选一个目录', 'Pick a folder first'), false); if ($('#knCwd')) $('#knCwd').focus(); return; }
  $('#knGo').disabled = true;
  const words = $('#knText').value.trim();
  const j = await kDo('new', { kind: KN.kind, cwd, prompt: words, space: sp ? sp.id : '', worktree: !!KN.wt });
  if ($('#knGo')) $('#knGo').disabled = false;
  if (!j.ok) return;
  if (j.kept && words) kSent({ id: j.kept }, words, 'start');
  store.set('deck.newKind', KN.kind); store.set('deck.kSpace', KN.space); store.set('deck.kWt', !!KN.wt); if (other) store.set('deck.newCwd', cwd);
  if ($('#knText')) $('#knText').value = '';
  if (j.kept) location.hash = `#/k/${encodeURIComponent(j.kept)}`;
}

// ---------- what needs the person, on a page of its own (with the box for something to get done) ----------
function kBuildNeed() {
  const was = route;
  route = { name: 'home' };  // (the frame app.js builds for its first page: what needs you, and something to get done)
  OLD.build();
  route = was;
  for (const el of document.querySelectorAll('#view .sec-block')) el.remove();
}

// ---------- a session ----------
function kBuildKept() {
  sessTab = route.tab === 'overview' ? 'report' : route.tab;  // (the timeline is on the overview: app.js goes to one of its turns in place when it reads 'report')
  KV.menu = KV.rename = KV.model = KV.nameEd = KV.kidsAll = false;
  KV.chatAt = 0;
  $('#view').innerHTML = `<div class="kp${KV.info ? '' : ' no-info'}" id="kp"><section class="kp-main"><header class="kp-head" id="kpHead"></header>
    <div class="kp-scroll" id="sess"><div id="hero" hidden></div><div id="tabBody"></div></div><footer class="kp-foot" id="kpFoot"></footer></section>
    <div class="kp-edge" id="kpEdge" role="separator" aria-orientation="vertical" title="${tt('拖动调整宽度，双击恢复', 'Drag to resize, double-click to reset')}"></div>
    <aside class="kp-info" id="kpInfo" aria-label="${tt('会话信息', 'About this session')}"></aside></div>`;
  kInfoW();
}
// (the side panel's width: the person's own, within what leaves the conversation room; kept in this browser)
function kInfoW(w) {
  const kp = $('#kp');
  if (!kp) return;
  if (w !== undefined) store.set('deck.kInfoW', Math.round(w));
  const v = store.get('deck.kInfoW', 0);
  kp.style.setProperty('--kinfo-w', v ? `${Math.round(Math.min(Math.max(v, 280), Math.max(300, kp.clientWidth - 420)))}px` : '');
}
// (a session that runs where the page cannot reach — a terminal window outside Zellij and tmux, the Codex app — has no terminal to show: said plainly, with the way to bring it here)
function kDrawNoTerm(k, s) {
  if (!$('#kNoTerm')) delete sig.knoterm;
  const app = s.kind === 'codex' && !s.proc, busy = KV.take === k.id, where = originT(s.origin || '');
  draw('knoterm', [k.id, s.origin, s.kind, !!s.proc, s.state, busy, LANG], () => {
    $('#tabBody').innerHTML = `<div class="knt" id="kNoTerm"><h3>${tt('这条会话没有能在这里打开的终端', 'This session has no terminal that can be opened here')}</h3>
      <p>${app ? tt('它是在 Codex 桌面应用里开的，一直在那个应用里跑，不在终端里。', 'It was started in the Codex desktop app and runs inside that app, not in a terminal.')
        : esc(tt(`它跑在${where || '一个终端窗口'}里，不在 Zellij 或 tmux 里，页面接不进去。`, `It runs in ${where ? where.charAt(0).toLowerCase() + where.slice(1) : 'a terminal window'}, outside Zellij and tmux, where the page cannot get in.`))}
        ${tt('在这里仍然能看它的对话；发给它的话会放进它的信箱，它下一步才看到。', 'Its conversation can still be read here; words sent to it go to its mailbox, and it sees them at its next step.')}</p>
      <p>${app ? tt('要在终端里用它：把它搬过来，会在 Sturnus 的终端里用 codex resume 接上同一段对话。搬过来以后只在一处接着说（这里，或者 Codex 应用）：两边同时用，记录会混在一起。', 'To use it in a terminal: bring it here, and a Sturnus terminal goes on with the same conversation by codex resume. After that, go on in one place only (here, or the Codex app): used in both, the record gets mixed.')
        : tt('要在这里用它的终端：把它搬过来。会先结束它现在的进程，再在 Sturnus 的终端里接上同一段对话。', 'To use its terminal here: bring it here. Its present process is ended first, then a Sturnus terminal goes on with the same conversation.')}</p>
      <button class="btn primary" data-ktake ${busy || s.state === 'working' ? 'disabled' : ''}>${I.term}${busy ? tt('正在搬……', 'Bringing it here…') : tt('搬到这里的终端', 'Bring it to a terminal here')}</button>
      ${s.state === 'working' ? `<p class="hint">${tt('它正在工作：等它停下来再搬。', 'It is at work: bring it here once it has come to rest.')}</p>` : ''}</div>`;
  });
}
function kDrawKept() {
  const k = kOf(route.kept), f = KV.full[route.kept];
  if (!k) {
    if (!f || (!f.missing && !f.kept)) kFull(route.kept);
    draw('khead', ['none', f && f.missing], () => { $('#kpHead').innerHTML = `<div class="kh-l"><h1>${f && f.missing ? tt('找不到这条会话', 'Session not found') : tt('读取中……', 'Loading…')}</h1></div>`; $('#tabBody').innerHTML = f && f.missing ? `<div class="s-body"><a class="btn" href="#/">${I.back}${tt('回到首页', 'Back to the first page')}</a></div>` : ''; });
    return;
  }
  kFull(k.id, k);
  const s = kLive(k), up = s && !s.starting, past = up ? null : kPast(k), tab = up ? route.tab : past && route.tab === 'overview' ? 'overview' : 'chat';
  route.id = s ? s.id : past ? past.id : '';
  $('#kp').className = `kp tab-${tab}${KV.info ? '' : ' no-info'}`;
  kDrawHead(k, s, tab);
  if (tab === 'chat') kDrawChat(k, s);
  else if (tab === 'overview') kDrawOver(k, up ? s : past, up);
  else if (tab === 'term') (s.loc ? drawTerm(s) : kDrawNoTerm(k, s));
  else drawMsgs(s);
  kDrawFoot(k, s, tab);
  kDrawInfo(k, s);
}
// (a stopped session's report and timeline were kept under its last conversation: a row to read them by, when there is either)
function kPast(k) {
  const id = k && k.conv ? `${k.kind}:${k.conv}` : '';
  return id && ((S.reports || {})[id] || (S.stories || {})[id]) ? { id, kind: k.kind, name: k.name || '', title: kTitle(k), state: 'ended', past: true } : null;
}
// (a session at a glance, on one page: what it is doing, its report, what was settled by topic, its timeline. What it
// is and where it runs are beside it, under About it; words for it go from its conversation)
function kRepHtml(s, rep, live) {
  const r = rep && rep.r, busy = (S.reporting || []).includes(s.id);
  const list = (h, xs) => (xs && xs.length ? `<h5>${h}</h5><ul>${xs.map(x => `<li>${mdInline(x)}</li>`).join('')}</ul>` : '');
  return `<div class="panel rep kov-rep"><h4>${tt('报告', 'Report')}<span class="r">${rep && rep.at ? `<span class="hint">${t('{t}前更新', { t: ago(rep.at) })}</span>` : ''}
      ${live ? `<button class="btn" data-report="${esc(s.id)}" ${busy ? 'disabled' : ''}>${busy ? t('正在写…') : r ? t('更新') : t('写报告')}</button>` : ''}</span></h4>
    ${r ? `${r.goal ? `<p class="goal">${mdInline(r.goal)}</p>` : ''}${list(t('做成了'), r.done)}${r.now ? `<h5>${t('现在')}</h5><p>${mdInline(r.now)}</p>` : ''}${list(t('接下来'), r.next)}
        ${r.refs && r.refs.length ? `<h5>${t('产出')}</h5><div class="refs">${r.refs.map(refChip).join('')}</div>` : ''}`
      : `<p class="hint">${busy ? t('正在读它的对话，大约半分钟。') : live ? tt('还没有报告。点「写报告」，会读它的对话写一份：目标、做成了什么、现在到哪了、接下来做什么。', 'No report yet. Write one reads its conversation and says what it is for, what got done, where it stands and what is next.') : t('还没有报告。')}</p>`}</div>`;
}
function kDrawOver(k, s, live) {
  const st = storyOf(s), rep = (S.reports || {})[s.id], now = live ? s.summary : k.note;
  draw('tab', ['over', k.id, s.id, live, now, live && s.summary_at && Math.floor(s.summary_at / 30), rep && rep.at, S.reporting, S.storying, st && [st.at, st.left, st.busy, st.asked, st.loading], tlAll, tick(), LANG], () => {
    $('#tabBody').innerHTML = `<div class="s-body kov">
      ${now ? `<div class="kov-now"><b>${live ? tt('现在在做', 'Doing now') : tt('停下时在做', 'Doing when it stopped')}</b><p>${esc(now)}</p>${live && s.summary_at ? `<time>${t('总结于 {t}前', { t: ago(s.summary_at) })}</time>` : ''}</div>` : ''}
      <div class="kov-grid"><div class="kov-a">${kRepHtml(s, rep, live)}</div><div class="kov-b">${decPanel(s, st, true)}</div><div class="kov-c">${timeline(s, st)}</div></div></div>`;
  });
  const el = wantTurn && $('#turn-' + wantTurn);
  if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); wantTurn = 0; }
}
// (the model a session runs on, said the way its maker says it: claude-fable-5-2 is Fable 5.2; any other name stays as it is)
const kModelName = id => { const m = String(id || '').match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{6,8})?(\[1m\])?$/); return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? '.' + m[3] : ''}${m[4] ? ' 1M' : ''}` : String(id || ''); };
const kFast = md => ['fast', 'priority'].includes((md || {}).speed);
// (the choice of model, effort and speed for a Claude Code session: each is a command typed into its terminal, so only
// while it sits at its prompt; Claude Code keeps a model and an effort set this way as the person's default, and bills
// fast answers from usage credits — said in the menu, not found out afterwards)
function kModelMenu(k, s, md) {
  const fast = kFast(md), fam = (String(md.model || '').match(/^claude-([a-z]+)/) || [])[1];
  const can = !!s && !s.starting && k.kind === 'claude' && sayHow(s) === 'type';
  const why = k.kind !== 'claude' ? tt('这里只能给 Claude Code 换。Codex 和 Cursor 的模型在它们自己的终端里用 /model 换。', 'Only a Claude Code session can be changed from here. Codex and Cursor change theirs with /model in their own terminal.')
    : !s ? tt('它现在没有在跑：点「继续」之后才能换。', 'It is not running now: Go on first, then change it.')
      : !can ? tt('它现在不在提示符前（在工作、停在一个提示上，或不在 Zellij / tmux 里）：等它空下来再换。', 'It is not at its prompt now (at work, stopped at a question, or outside Zellij and tmux): change it once it is at rest.') : '';
  const opt = (what, v, label, on) => `<button role="menuitemradio" aria-checked="${!!on}" data-kmset="${what}:${v}" ${can && !on ? '' : 'disabled'} class="${on ? 'on' : ''}">${on ? I.check : '<span class="no"></span>'}${label}</button>`;
  return `<div class="ks-menu kmodel-menu" role="menu" aria-label="${tt('模型、思考强度、速度', 'Model, effort, speed')}">
    <div class="ks-mh">${tt('模型', 'Model')}</div>${[['fable', 'Fable'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']].map(([v, l]) => opt('model', v, l, fam === v)).join('')}
    <div class="ks-mh">${tt('思考强度', 'Effort')}</div><div class="kmodel-row">${['low', 'medium', 'high', 'xhigh', 'max'].map(v => opt('effort', v, v, md.effort === v)).join('')}</div>
    <div class="ks-mh">${tt('速度', 'Speed')}</div>${opt('fast', 'off', tt('标准', 'Standard'), !fast)}${opt('fast', 'on', tt('快速（不在订阅额度里，按用量另外计费）', 'Fast (outside the plan: billed from usage credits)'), fast)}
    <p class="kmodel-note">${why || tt('会在它的终端里输入 /model、/effort 或 /fast。Claude Code 会把这样设的模型和强度存成你的默认设置；这里从它的下一次回复起显示新的。', 'This types /model, /effort or /fast into its terminal. Claude Code keeps a model and an effort set this way as your default; what is shown here follows from its next answer.')}</p></div>`;
}
function kDrawHead(k, s, tab) {
  if (document.activeElement && document.activeElement.id === 'kTitle') return;
  const [st, label] = kStand(k), sp = kSpace(k.space), up = s && !s.starting, past = !up && !!kPast(k);
  const md = k.model || {};
  draw('khead', [k.id, kTitle(k), st, label, k.pinned, k.archived, tab, up, past, sp && [sp.id, sp.name], k.kind, k.folder, k.branch, KV.info, KV.menu, KV.rename, [md.model, md.effort, md.speed], KV.model, KV.model && s && sayHow(s), LANG], () => {
    const tabs = up ? [['chat', tt('对话', 'Conversation')], ['overview', tt('概览', 'Overview')], ['term', tt('终端', 'Terminal')], ['msgs', tt('消息', 'Messages')]]
      : past ? [['chat', tt('对话', 'Conversation')], ['overview', tt('概览', 'Overview')]] : [];
    $('#kpHead').innerHTML = `<div class="kh-l">${KV.rename ? `<input class="field" id="kTitle" value="${esc(k.title || kTitle(k))}" aria-label="${tt('会话的名字', 'Session title')}" placeholder="${tt('留空：回到自动起的名字', 'Empty: back to the name it is given')}">`
        : `<h1 data-krename title="${tt('点一下改名', 'Click to rename')}">${esc(kTitle(k))}</h1>`}
        <div class="sub">${mark(k.kind, '', 'xs')}<span>${esc(FULL[k.kind] || k.kind)}</span>${md.model ? `<button class="kh-model" data-kmodel aria-haspopup="menu" aria-expanded="${!!KV.model}" title="${tt('它用的模型、思考强度和速度；点开可以换', 'Its model, effort and speed; open to change them')}">${esc(kModelName(md.model))}${md.effort ? `<em>${esc(md.effort)}</em>` : ''}${kFast(md) ? `<em class="fast">↯ ${tt('快速', 'fast')}</em>` : ''}${chev(true)}</button>` : ''}<i>·</i>${sp ? `<a href="#/w/${encodeURIComponent(sp.id)}">${esc(sp.name)}</a>` : `<span>${tt('未归入工作区', 'In no workspace')}</span>`}<i>·</i><span class="mono" title="${esc(k.show)}">${esc(folder(k.folder))}${k.branch ? ' / ' + esc(k.branch) : ''}</span></div>${KV.model && md.model ? kModelMenu(k, s, md) : ''}</div>
      <div class="r"><span class="kchip ${st}"><i></i>${esc(k.archived ? tt('已归档', 'Archived') : label)}</span>
        ${!s && !k.archived ? `<button class="btn primary" data-kresume>${KI.play}${tt('继续', 'Go on')}</button>` : ''}
        ${tabs.length ? `<nav class="seg ktabs">${tabs.map(([x, l]) => `<a href="${kHref(k)}${x === 'chat' ? '' : '/' + x}" class="${tab === x ? 'on' : ''}">${l}</a>`).join('')}</nav>` : ''}
        <button class="ks-ib${k.pinned ? ' on' : ''}" data-kpin aria-pressed="${!!k.pinned}" title="${k.pinned ? tt('取消置顶', 'Unpin') : tt('置顶', 'Pin')}" aria-label="${k.pinned ? tt('取消置顶', 'Unpin') : tt('置顶', 'Pin')}">${KI.pin}</button>
        <button class="ks-ib${KV.info ? ' on' : ''}" data-kinfo aria-pressed="${KV.info}" title="${tt('会话信息', 'About this session')}" aria-label="${tt('会话信息', 'About this session')}">${I.panel}</button>
        <div class="kmenu"><button class="ks-ib" data-kmenu aria-expanded="${KV.menu}" title="${tt('更多', 'More')}" aria-label="${tt('更多', 'More')}">${KI.dots}</button>${KV.menu ? `<div class="kmenu-list" role="menu">
          <button role="menuitem" data-krename>${tt('改名', 'Rename')}</button>
          ${up ? `<button role="menuitem" data-kdo="stop">${tt('停止（终端里的 agent 会结束）', 'Stop (its agent ends)')}</button>` : ''}
${!s && !k.archived ? `<button role="menuitem" data-khand>${tt('换一个 agent 继续…', 'Go on with another agent…')}</button>` : ''}
          <button role="menuitem" data-kdo="${k.archived ? 'unarchive' : 'archive'}">${k.archived ? tt('取消归档', 'Unarchive') : tt('归档', 'Archive')}</button>
          ${k.archived ? `<button role="menuitem" class="bad" data-kdo="delete">${tt('删除', 'Delete')}</button>` : ''}</div>` : ''}</div></div>`;
    if (KV.rename && $('#kTitle')) { $('#kTitle').focus(); $('#kTitle').select(); }
  });
}
// (a line across the conversation where the session's terminal changed, and where another conversation began)
function kTermLine(terms, i) {
  const t0 = terms[i], prev = terms[i - 1];
  return `<div class="kdiv"><span><b>${tt('换了终端', 'Another terminal')}</b>${esc(kDay(t0.began))}${prev && prev.why ? esc(tt(`，${KWHY[prev.why] ? KWHY[prev.why][0] : prev.why}`, `, ${KWHY[prev.why] ? KWHY[prev.why][1] : prev.why}`)) : ''}${tt(`；在第 ${t0.n} 个终端（${kMux(t0)}）里接着做`, `; going on in terminal ${t0.n} (${kMux(t0)})`)}</span></div>`;
}
function kSegLine(seg) {
  if (!seg || !['clear', 'handover'].includes(seg.how)) return '';
  return `<div class="kdiv"><span>${seg.how === 'clear' ? `<b>${tt('清空了对话', 'Conversation cleared')}</b>${tt('上面的不再在它的上下文里，记录都还在', 'What is above is out of its context; the record is all here')}` : `<b>${esc(tt(`换成 ${FULL[seg.kind] || seg.kind} 继续`, `${FULL[seg.kind] || seg.kind} takes it on`))}</b>`}</span></div>`;
}
function kChatHtml(k, items, full) {
  const terms = (full.terms || []).slice().sort((a, b) => a.n - b.n), segs = full.segs || [];
  const at = it => (it.at ? (typeof it.at === 'string' ? Date.parse(it.at) / 1000 : it.at) : 0);
  let out = '', ti = 0, seg = null, tools = [];
  const first = items.length ? at(items[0]) : 0;
  while (ti < terms.length && (terms[ti].n === 1 || (first && terms[ti].began <= first))) ti++;  // (the first terminal changed nothing; one from before what is shown is above it)
  // (the steps between two things said are folded into one line, which says how many they were and how many pictures they showed the agent)
  const flush = () => {
    if (!tools.length) return;
    const steps = tools.filter(x => x.text).length, pics = picsCount(tools);
    out += `<details class="ktools"><summary>${chev(false)}${steps ? tt(`做了 ${steps} 步`, `${steps} step${steps > 1 ? 's' : ''}`) : ''}${pics ? `<b class="np">${steps ? ' · ' : ''}${tt(`${pics} 张图`, `${pics} picture${pics > 1 ? 's' : ''}`)}</b>` : ''}</summary>${tools.map(x => (x.text ? `<div class="bub tool">${esc(x.text)}</div>` : '') + picsHtml(k.id, x)).join('')}</details>`;
    tools = [];
  };
  for (const it of items) {
    const a = at(it);
    while (ti < terms.length && a && terms[ti].began <= a) { flush(); out += kTermLine(terms, ti++); }
    if (seg !== null && it.seg !== seg) { flush(); out += kSegLine(segs.find(x => x.n === it.seg)); }
    seg = it.seg;
    if (it.who === 'tool') { tools.push(it); continue; }
    flush();
    out += `<div class="bub ${it.who}${it.who === 'assistant' ? ' ' + (it.kind || k.kind) : ''}">${md(it.text)}${picsHtml(k.id, it)}${it.at ? `<time>${clock(it.at)}</time>` : ''}</div>`;
  }
  flush();
  while (ti < terms.length) out += kTermLine(terms, ti++);
  const last = terms[terms.length - 1];
  if (last && last.ended && !k.live) out += `<div class="kdiv"><span><b>${tt('终端结束了', 'Its terminal ended')}</b>${esc(kDay(last.ended))}${tt(`，${(KWHY[last.why] || KWHY.ended)[0]}。对话都还在`, `, ${(KWHY[last.why] || KWHY.ended)[1]}. The conversation is all here`)}</span></div>`;
  return out || `<div class="hint">${k.live ? tt('还没有说过话。', 'Nothing said yet.') : tt('读不到它的对话记录。', 'Its conversation cannot be read.')}</div>`;
}
// (what was sent from this page and the conversation does not show yet. One is let go once its words are there — once
// more often than when it was sent, so the same words said twice count — or once it has waited as long as its way takes)
const kNorm = x => String(x || '').replace(/\s+/g, ' ').trim().slice(0, 300);
const kSaidN = (items, text) => { const n = kNorm(text); return items.filter(it => it.who === 'user' && kNorm(it.text) === n).length; };
function kPending(k) {
  const items = kPage(k.id).items || [], now = Date.now();
  const list = (KV.sent[k.id] || []).filter(p => p.state === 'sending' || (kSaidN(items, p.text) <= p.seen && now - p.t < ({ queue: 900000, wait: 900000, start: 180000 }[p.how] || 45000)));
  if (list.length) KV.sent[k.id] = list; else delete KV.sent[k.id];
  return list;
}
function kSent(k, text, how, state = 'sent') {
  const p = { n: ++KV.sentN, text, how, state, t: Date.now(), seen: kSaidN(kPage(k.id).items || [], text) };
  (KV.sent[k.id] = KV.sent[k.id] || []).push(p);
  KV.chatFast = Date.now() + 30000;
  return p;
}
// (its agent is at work: said under the conversation with what it is doing and for how long, so words just sent are seen to have arrived)
const kSpan = n => (n < 60 ? tt(`${n} 秒`, `${n}s`) : n < 3600 ? tt(`${Math.floor(n / 60)} 分 ${n % 60} 秒`, `${Math.floor(n / 60)}m ${n % 60}s`) : tt(`${Math.floor(n / 3600)} 小时 ${Math.floor(n % 3600 / 60)} 分`, `${Math.floor(n / 3600)}h ${Math.floor(n % 3600 / 60)}m`));
const kWorking = s => !!s && !s.starting && s.state === 'working';
function kWorkHtml(s) {
  if (!kWorking(s)) return '';
  const tool = s.tool && (s.tool_at || 0) > (s.tool_end || 0) ? toolName(s.tool) : '';
  return `<div class="kwork" role="status"><i class="kspin"></i><b>${tt('工作中', 'Working')}</b><span id="kWorkT" data-since="${s.since || 0}"></span>${tool ? `<span class="tool">${esc(tool)}</span>` : ''}</div>`;
}
function kWorkTick() { const el = $('#kWorkT'); if (el && +el.dataset.since) el.textContent = kSpan(Math.max(0, Math.round(Date.now() / 1000 - el.dataset.since))); }
function kChatPaint(k, stick) {
  if (!$('#convo')) return;
  const pg = kPage(k.id), full = (KV.full[k.id] || {}).kept || {}, items = pg.items || [], pend = kPending(k), s = kLive(k);
  if (!pg.items && !pend.length) return;  // (not read yet, and nothing to show meanwhile: the line that says so stays)
  draw('kc', [k.id, items.length, items.length && items[items.length - 1].text.slice(0, 60), picsCount(items), (full.terms || []).map(t => [t.n, t.ended, t.why]), (full.segs || []).length, k.live, pend.map(p => [p.n, p.state, p.how]),
    kWorking(s) && [s.since, s.tool, (s.tool_at || 0) > (s.tool_end || 0)], pg.more, pg.moreBusy, pg.n, LANG], () => {
    const sess = $('#sess'), first = sig.kcFirst !== k.id, atEnd = sess.scrollHeight - sess.scrollTop - sess.clientHeight < 80;
    // (what is shown is the last of it: the words before are a click away, and where the session begins is said once it is reached)
    const top = !items.length ? '' : pg.more ? `<div class="kmore">${pg.moreBusy ? `<span class="hint"><i class="kspin sm"></i>${tt('正在读更早的对话……', 'Reading earlier words…')}</span>` : `<button class="btn" data-kearlier>${tt('显示更早的对话', 'Show earlier words')}</button>`}</div>`
      : pg.n > 200 ? `<div class="kdiv"><span>${tt('这条会话从这里开始', 'This session begins here')}</span></div>` : '';
    $('#convo').innerHTML = top + (items.length || !pend.length ? kChatHtml(k, items, full) : '')
      + pend.map(p => `<div class="bub user pend${p.state === 'sending' ? ' going' : ''}">${md(p.text)}<time>${p.state === 'sending' ? '<i class="kspin sm"></i>' : ''}${esc(tt(...KSENT[p.state === 'sending' ? 'sending' : p.how] || KSENT.type))}</time></div>`).join('')
      + kWorkHtml(s);
    document.querySelectorAll('#convo .ktools').forEach((d, i) => { if (pg.tools.has(i)) d.open = true; });
    kWorkTick();
    if (pg.hold != null && !pg.moreBusy) { sess.scrollTop = Math.max(0, sess.scrollHeight - pg.hold); pg.hold = null; sig.kcFirst = k.id; }  // (earlier words came in above: what was being read stays where it was)
    else if (first) { sig.kcFirst = k.id; sess.scrollTop = pg.atEnd || stick ? sess.scrollHeight : pg.top; }  // (back where it was left, or at its end)
    else if (atEnd || stick) sess.scrollTop = sess.scrollHeight;
  });
}
async function kDrawChat(k, s) {
  const pg = kPage(k.id);
  if (sig.kcFor !== k.id) {
    sig.kcFor = k.id; sig.kc = null; KV.chatAt = 0;
    $('#tabBody').innerHTML = `<div class="kc convo" id="convo">${pg.items ? '' : `<div class="hint">${tt('读取对话……', 'Reading the conversation…')}</div>`}</div>`;
  }
  kChatPaint(k);  // (what is held is shown at once, and again when how it stands changes; what is new is read below)
  kWorkTick();
  // (how soon it is read again: at once while something sent is still on its way, soon while it works, now and then at rest)
  const soon = (KV.sent[k.id] || []).length || Date.now() < KV.chatFast;
  if (KV.chatBusy || Date.now() - KV.chatAt < (soon ? 650 : s && s.state === 'working' ? 1400 : 4000)) return;
  KV.chatAt = Date.now(); KV.chatBusy = true;
  try {
    const n = pg.n;
    const j = await (await fetch(`/api/transcript?kept=${encodeURIComponent(k.id)}&n=${n}${pg.items && pg.sig ? '&have=' + pg.sig : ''}`, { cache: 'no-store' })).json();
    if (!j.same) { pg.items = j.items || []; pg.sig = j.sig || ''; }
    pg.more = !!j.more;
    if (n === pg.n) pg.moreBusy = false;
    if (route.kept === k.id && $('#convo')) kChatPaint(k);
  } catch { pg.moreBusy = false; } finally { KV.chatBusy = false; }
}
// (words for a session, from its page. They are under its conversation before they have left; how they went is said
// beside them; if they could not be sent they are back in the box)
async function kSay(k, s, text, now) {
  const box = $('#rText'), how = now ? 'type' : sayHow(s), p = kSent(k, text, how === 'type' && s.state === 'working' ? 'wait' : how, 'sending');
  if (box) { box.value = ''; box.focus(); }
  kPage(k.id).draft = '';
  kChatPaint(k, true);
  const j = await api('say', { id: s.id, text, now }).catch(() => ({ ok: false, msg: tt('没连上服务', 'The service could not be reached') }));
  if (!j.ok) {
    KV.sent[k.id] = (KV.sent[k.id] || []).filter(x => x !== p);
    if ($('#rText') && !$('#rText').value) { $('#rText').value = text; kPage(k.id).draft = text; }
    toast(j.msg || tt('没发出去', 'Not sent'), false);
  } else {
    p.state = 'sent'; p.t = Date.now();
    if (j.how && j.how !== 'type') p.how = j.how;
  }
  KV.chatAt = 0;
  kChatPaint(k, true);
  load();
}
function kDrawFoot(k, s, tab) {
  const mode = tab !== 'chat' ? 'none' : !s ? (k.archived ? 'archived' : KV.hand ? 'hand' : 'stopped') : s.starting ? 'starting' : 'live';
  if (mode !== 'hand') KV.hand = null;
  draw('kfoot', [k.id, mode, s && s.id, mode === 'starting' && [s.summary, s.needs_you, s.loc], KV.hand && [KV.hand.kind, KV.hand.busy, KV.hand.file], LANG], () => {
    $('#kpFoot').innerHTML = mode === 'none' ? ''
      : mode === 'hand' ? `<div class="khand"><div class="kn-ch"><b>${tt('换谁来接着做', 'Who takes it on')}</b>${Object.keys(S.launch || {}).filter(x => FULL[x] && x !== k.kind).map(x => `<button type="button" data-khandkind="${x}" aria-pressed="${KV.hand.kind === x}" class="${KV.hand.kind === x ? 'on' : ''}">${mark(x, '', 'xs')}${FULL[x]}</button>`).join('')}</div>
          <textarea id="kNote" aria-label="${tt('交接说明', 'The handover')}" placeholder="${KV.hand.busy ? tt('正在写交接说明……', 'Writing the handover…') : tt('先选一个 agent', 'Pick an agent first')}">${esc(KV.hand.note || '')}</textarea>
          <div class="row"><span class="hint">${tt('这是新 agent 开头读到的话，可以改。它换不走原来那个 agent 的上下文，只能靠这份说明和完整记录文件接上；之前的对话仍然留在这条会话里。', 'This is what the new agent reads first; change it as you like. It cannot take over the other agent’s context: this note and the full record file are how it picks up. What was said before stays in this session.')}</span>
            <button class="btn" data-khandoff>${tt('取消', 'Cancel')}</button><button class="btn primary" data-khandgo ${KV.hand.kind && !KV.hand.busy ? '' : 'disabled'}>${KI.play}${KV.hand.kind ? tt(`用 ${FULL[KV.hand.kind]} 继续`, `Go on with ${FULL[KV.hand.kind]}`) : tt('继续', 'Go on')}</button></div></div>`
      : mode === 'live' ? `<div class="chat-say kp-say">${replyBox(s)}</div>`
      : mode === 'starting' ? `<div class="kstop"><div><b>${esc(s.summary || tt('正在启动……', 'Starting…'))}</b><span>${esc(s.needs_you || tt('它的 agent 起来以后，这里就能说话了。', 'Once its agent is up, you can talk to it here.'))}</span></div>${s.loc ? `<a class="btn dark" href="#/term/${encodeURIComponent(s.loc.session)}/${encodeURIComponent(s.loc.pane)}">${I.term}${tt('看它的终端', 'See its terminal')}</a>` : ''}</div>`
      : mode === 'archived' ? `<div class="kstop"><div><b>${tt('这条会话已经归档', 'This session is archived')}</b><span>${tt('对话都还在。取消归档后可以继续。', 'The conversation is all here. Unarchive it to go on.')}</span></div><button class="btn" data-kdo="unarchive">${tt('取消归档', 'Unarchive')}</button></div>`
      : `<div class="kstop"><div><b>${tt('这条会话现在没有终端在跑', 'No terminal is running this session now')}</b><span>${tt('点「继续」，会新开一个终端，接着上面的对话往下做。', 'Go on opens a new terminal and picks the conversation up where it stopped.')}</span></div><button class="btn primary" data-kresume>${KI.play}${tt('继续', 'Go on')}</button></div>
        <div class="reply"><textarea id="kText" aria-label="${tt('对这条会话说话', 'Words for this session')}" placeholder="${tt('直接说下一步也行：发送后先新开终端，再接着做。Enter 发送，Shift+Enter 换行', 'Or just say what is next: it gets a new terminal first, then goes on. Enter sends, Shift+Enter for a new line')}"></textarea>
          <div class="row">${micBtn('kText')}<span class="sp"></span><button class="btn primary" data-kresume="say">${I.arrow}${tt('发送并继续', 'Send and go on')}</button></div></div>`;
  });
  if (mode === 'live') drawSay(s);
  const box = $('#rText') || $('#kText'), draft = kPage(k.id).draft;
  if (box && draft && !box.value && document.activeElement !== box) box.value = draft;
}
// (what a session changed in its folder: the files against where its branch left main, each one's diff on asking)
const kDiffHtml = d => esc(d).split('\n').map(l => `<span class="${l.startsWith('+') && !l.startsWith('+++') ? 'a' : l.startsWith('-') && !l.startsWith('---') ? 'd' : l.startsWith('@@') ? 'h' : ''}">${l || ' '}</span>`).join('');
async function kDiffLoad(k, force) {
  const D = kPage(k.id).diff;
  if (D.busy || (!force && Date.now() - D.at < 8000)) return;
  D.busy = true;
  try { D.data = await (await fetch('/api/diff?kept=' + encodeURIComponent(k.id), { cache: 'no-store' })).json(); } catch { }
  D.busy = false; D.at = Date.now();
  if (route.kept === k.id) render();
}
function kDrawDiff(k, s, box) {
  kDiffLoad(k);
  const pg = kPage(k.id), D = pg.diff, d = D.data;
  draw('kinfo', ['diff', k.id, d && [d.ok, d.branch, d.ahead, d.own, (d.files || []).map(f => [f.path, f.add, f.del, f.state, f.loose])], !!s, LANG], () => {
    const open = D.open, keep = pg.diffDraft;
    const files = (d && d.files) || [], add = files.reduce((n, f) => n + f.add, 0), del = files.reduce((n, f) => n + f.del, 0);
    box.innerHTML = kSideTabs() + (!d ? `<p class="hint">${tt('读取中……', 'Loading…')}</p>` : !d.ok ? `<p class="hint">${esc(d.msg || '')}</p>` : `
      <section><h3>${esc(d.branch === d.main ? tt(`${d.branch} 上还没提交的改动`, `Changes not committed on ${d.branch}`) : tt(`分支 ${d.branch} 相对 ${d.main} 的改动`, `Branch ${d.branch} against ${d.main}`))}</h3>
        <p class="hint">${files.length ? tt(`${files.length} 个文件`, `${files.length} file${files.length > 1 ? 's' : ''}`) + ` <b class="ka">+${add}</b> <b class="kd">−${del}</b>` + (d.ahead ? tt(`，${d.ahead} 个提交`, `, ${d.ahead} commit${d.ahead > 1 ? 's' : ''}`) : '') : tt('没有改动。', 'No changes.')}</p>
        ${files.map(f => `<details class="kdf" data-kdf="${esc(f.path)}"${open.has(f.path) ? ' open' : ''}><summary>${chev(false)}<span class="p" title="${esc(f.path)}">${esc(f.path)}</span>${f.state === 'new' ? `<em>${tt('新文件', 'new')}</em>` : `<b class="ka">+${f.add}</b><b class="kd">−${f.del}</b>`}${f.loose ? `<em title="${tt('上次提交后又改过', 'Changed again since its last commit')}">${tt('未提交', 'loose')}</em>` : ''}</summary>
          <pre class="kdiffp">${D.files[f.path] !== undefined ? kDiffHtml(D.files[f.path]) : tt('读取中……', 'Loading…')}</pre></details>`).join('')}${d.more ? `<p class="hint">${tt(`还有 ${d.more} 个文件没列出`, `${d.more} more files not listed`)}</p>` : ''}</section>
      <section><h3>${tt('对这些改动有话说', 'Something to say about these')}</h3><textarea id="kDiffSay" class="area" rows="3" aria-label="${tt('对改动的意见', 'Words about the changes')}" placeholder="${s ? tt('写下来，发给这条会话', 'Write it down and send it to this session') : tt('写下来：发送后它先新开终端，再接着做', 'Write it down: it gets a new terminal first, then goes on')}">${esc(keep)}</textarea>
        <button class="btn" data-kdiffsay>${I.arrow}${tt('发给它', 'Send to it')}</button></section>
      ${d.own ? `<section><h3>${tt('它自己的 worktree', 'Its own worktree')}</h3><p class="hint mono">${esc(d.show)}</p>
        <p class="hint">${esc(tt(`做完以后：把 ${d.branch} 合进 ${d.main}（只做快进合并），再把这个 worktree 和分支清掉。要先停止会话，改动要都提交了。`, `When it is done: merge ${d.branch} into ${d.main} (fast-forward only), then clear this worktree and branch away. Stop the session first, with everything committed.`))}</p>
        <button class="btn" data-kmerge ${s ? 'disabled' : ''}>${I.branch}${esc(tt(`合并进 ${d.main} 并清理`, `Merge into ${d.main} and clear`))}</button></section>` : ''}`);
    for (const el of box.querySelectorAll('details.kdf[open]')) kDiffFile(k, el);
  });
}
async function kDiffFile(k, el) {
  const path = el.dataset.kdf, D = kPage(k.id).diff;
  if (D.files[path] !== undefined && Date.now() - (D.filesAt || 0) < 8000) return;
  try { const j = await (await fetch(`/api/diff?kept=${encodeURIComponent(k.id)}&file=${encodeURIComponent(path)}`, { cache: 'no-store' })).json(); D.files[path] = j.ok ? j.diff + (j.cut ? tt('\n……太长，后面的没显示', '\n… too long, the rest is not shown') : '') : (j.msg || ''); D.filesAt = Date.now(); } catch { return; }
  const pre = el.querySelector('pre');
  if (pre && route.kept === k.id) pre.innerHTML = kDiffHtml(D.files[path]);
}
const kSideTabs = () => `<div class="seg kside" role="group"><button data-kside="info" class="${KV.side === 'info' ? 'on' : ''}">${tt('会话信息', 'About it')}</button><button data-kside="diff" class="${KV.side === 'diff' ? 'on' : ''}">${tt('改动', 'Changes')}</button></div>`;
function kDrawInfo(k, s) {
  const box = $('#kpInfo');
  if (!box || !KV.info || (document.activeElement && box.contains(document.activeElement))) return;
  if (KV.side === 'diff') return kDrawDiff(k, s, box);
  const full = (KV.full[k.id] || {}).kept, sp = kSpace(k.space), a = s && attention(s);
  const up = s && !s.starting, tasks = (S.tasks || []).filter(x => taskOpen(x) && x.sessions.some(l => (s && l.sid === s.id) || (k.name && l.name === k.name)));
  // (tasks of its project it could be linked to: picked here, as its overview had it)
  const scope = up ? s.project || s.workspace || '' : '', pick = up ? (S.tasks || []).filter(x => taskOpen(x) && !tasks.includes(x) && (x.scope === scope || (s.workspace && taskIn(x, s.workspace)))).sort(taskOrder) : [];
  // (what it started: Claude Code's own sub-agents and the sessions it launched, those still running first)
  const subs = up ? (s.subs || []).slice().sort((x, y) => (y.state === 'working') - (x.state === 'working') || (y.at || 0) - (x.at || 0)) : [], kids = up ? kidsOf(s) : [], nkids = subs.length + kids.length;
  const par = up && parentOf(s), terms = full ? (full.terms || []).slice().sort((x, y) => y.n - x.n) : [];
  draw('kinfo', ['info', k.id, k.space, k.spaced, k.kind, k.show, k.branch, k.name, k.note, k.conv, a, s && [s.id, s.summary, needOf(s), asksSig(s), s.loc, s.origin, par && [par.id, par.name], s.project, s.workspace, s.attrib],
    tasks.map(x => [x.id, x.title, x.shown, x.now, x.next]), pick.map(x => [x.id, x.title]), subs.map(x => [x.id, x.state, x.at]), kids.map(c => [c.id, c.state, c.status, c.summary, c.title]), KV.kidsAll, KV.nameEd, Object.keys(S.projects || {}).length,
    (S.spaces || []).map(w => [w.id, w.name]), terms.map(t => [t.n, t.ended, t.why, t.pane]), full && (full.segs || []).length, Math.floor(Date.now() / 60000), LANG], () => {
    const title = kTitle(k), cmd = `sturnus open ${/^[^\s"'$`\\!]+$/.test(title) ? title : /["$`\\!]/.test(title) ? k.id : `"${title}"`}`;
    const open = terms.find(t => !t.ended);
    box.innerHTML = kSideTabs() + (a ? `<div class="need-box ${ATT[a][1]}"><div class="k">${standing(s)[0] === 'asking' ? t('工作中 · 等你确认') : t(ATT[a][0])}</div><p>${esc(needOf(s) || s.summary || (s.prompting ? tt('它停在终端里的一个提示上：进终端看一眼。', 'It is stopped at a prompt in its terminal: take a look there.') : ''))}</p></div>` : '')
      + `<section><h3>${tt('这条会话', 'This session')}</h3><dl class="kv">
          <dt>${tt('工作区', 'Workspace')}</dt><dd><select class="sel" data-kspace="${esc(k.id)}" aria-label="${tt('它在哪个工作区', 'Which workspace it is in')}"><option value="">${k.spaced ? tt('改回按目录归', 'Back to where its folder puts it') : esc(sp ? sp.name : tt('未归入（目录不在任何工作区里）', 'None (its folder is in no workspace)'))}</option>
            ${(S.spaces || []).filter(w => !w.archived).map(w => `<option value="${esc(w.id)}"${k.spaced && k.space === w.id ? ' selected' : ''}>${tt('放到 ', 'Put in ')}${esc(w.name)}</option>`).join('')}</select></dd>
          ${up && Object.keys(S.projects || {}).length ? `<dt>${tt('项目', 'Project')}</dt><dd>${projSelect(s)}</dd>` : ''}
          <dt>Agent</dt><dd>${esc(FULL[k.kind] || k.kind)}</dd>
          <dt>${tt('目录', 'Folder')}</dt><dd class="mono">${esc(k.show)}</dd>
          ${k.branch ? `<dt>${tt('分支', 'Branch')}</dt><dd class="mono">${esc(k.branch)}</dd>` : ''}
          ${par ? `<dt>${tt('启动者', 'Started by')}</dt><dd><a data-go="${esc(par.id)}">${esc(titleOf(par))}</a></dd>` : up && s.origin ? `<dt>${tt('启动方式', 'Started from')}</dt><dd>${esc(originT(s.origin))}</dd>` : ''}
          ${k.name ? `<dt>${tt('名字', 'Name')}</dt><dd class="mono kname" title="${tt('会话之间写信用的名字', 'Its name when sessions write to each other')}">${KV.nameEd === k.id && up ? `<span class="inline"><input class="field" id="rName" value="${esc(k.name)}" aria-label="${tt('新名字', 'New name')}" placeholder="${t('新名字（字母、数字、_ . -）')}"><button class="btn" data-act="rename">${t('改名')}</button></span>`
            : `${esc(k.name)}${up ? `<button class="kv-ed" data-kname title="${k.kind === 'claude' ? tt('Claude 会话的名字由它自己定：点一下看怎么改', 'A Claude session names itself: click to see how') : tt('改这个名字', 'Change this name')}" aria-label="${tt('改名字', 'Change the name')}">${KI.pen}</button>` : ''}`}</dd>` : ''}
          ${k.conv ? `<dt>${tt('对话 ID', 'Conversation')}</dt><dd class="mono kconv"><span title="${esc(k.conv)}">${esc(k.conv)}</span><button class="kv-ed" data-kcopy="${esc(k.conv)}" title="${tt('复制', 'Copy')}" aria-label="${tt('复制对话 ID', 'Copy the conversation id')}">${KI.copy}</button></dd>` : ''}</dl></section>`
      + (s && s.summary ? `<section><h3>${tt('现在在做', 'Doing now')}</h3><p class="now">${esc(s.summary)}</p></section>` : !s && k.note ? `<section><h3>${tt('停下时在做', 'Doing when it stopped')}</h3><p class="now">${esc(k.note)}</p></section>` : '')
      + (s && ((s.asks || []).length || (S.inbox || []).some(m => m.from === s.name)) ? asksPanel(s) : '')
      + (tasks.length || pick.length ? `<section><h3>${tt('任务', 'Tasks')}<a class="lnk" href="#/tasks${scope ? '/' + encodeURIComponent(scope) : ''}">${tt('全部', 'All')}</a></h3>
          ${tasks.length ? `<div class="ktasks">${tasks.map(taskMini).join('')}</div>` : `<p class="hint">${tt('还没关联任务。它自己可以用 amail task 记，助手也会从总结里补上。', 'No task linked yet. It can note its own with amail task, and the assistant fills in from its summaries.')}</p>`}
          ${pick.length ? `<div class="inline tkp-pick"><select class="sel" id="stPick" aria-label="${tt('选一个任务', 'Pick a task')}">${pick.map(x => `<option value="${esc(x.id)}">${esc(x.title)}</option>`).join('')}</select><button type="button" class="btn" data-st-link="${esc(s.id)}">${tt('关联', 'Link')}</button></div>` : ''}</section>` : '')
      + (nkids ? `<section><h3>${tt(`它启动的子 agent，共 ${nkids} 个`, `Sub-agents it started: ${nkids}`)}</h3><div class="kid-list">${[...subs.map(x => `
          <div class="kid-row"><span class="mark sm sub ${x.state}">${I.spark}</span><div data-go="${esc(s.id)}" data-tab="sub/${esc(x.id)}"><b>${esc(x.task || x.type)}</b><p>${subWho(x)} · ${subLabel(x)}</p></div></div>`), ...kids.map(c => { const [cst, cl] = standing(c); return `
          <div class="kid-row">${mark(c.kind, cst, 'sm')}<div data-go="${esc(c.id)}"><b>${esc(titleOf(c))}</b><p>${esc(cl)} ${ago(c.since)}${c.summary ? ' · ' + esc(c.summary) : ''}</p></div>
            ${['gone', 'ended'].includes(c.state) ? '' : `<button class="btn" data-stop="${esc(c.id)}">${t('停止')}</button>`}</div>`; })].slice(0, KV.kidsAll ? nkids : 6).join('')}</div>
          ${nkids > 6 ? `<button class="lnk" data-kkids>${KV.kidsAll ? tt('只看前 6 个', 'First 6 only') : tt(`还有 ${nkids - 6} 个`, `${nkids - 6} more`)}</button>` : ''}</section>` : '')
      + `<section><h3>${terms.length ? tt(`用过的终端，共 ${terms.length} 个`, `Terminals it has run in: ${terms.length}`) : tt('用过的终端', 'Terminals it has run in')}</h3>${terms.length ? terms.map((t, i) => `
          <div class="kt${t.ended ? '' : ' on'}"><div class="rail2"><i></i>${i < terms.length - 1 ? '<span></span>' : ''}</div><div class="kt-b"><div><b>${tt(`第 ${t.n} 个`, `No. ${t.n}`)}</b>${t.ended ? '' : `<em>${tt('正在用', 'in use')}</em>`}</div>
            <div class="kt-m">${esc(kWhere(t))}</div><div class="kt-d">${t.ended ? tt(`${kDay(t.began)} 到 ${kDay(t.ended)}`, `${kDay(t.began)} to ${kDay(t.ended)}`) : tt(`${kDay(t.began)} 起`, `since ${kDay(t.began)}`)}</div>
            ${t.ended ? `<div class="kt-d">${tt('结束原因：', 'Ended: ')}${esc(tt(...(KWHY[t.why] || KWHY.ended)))}</div>` : ''}</div></div>`).join('') : `<p class="hint">${full ? tt('还没有在终端里跑过。', 'It has not run in a terminal yet.') : tt('读取中……', 'Loading…')}</p>`}
          ${full && (full.segs || []).length > 1 ? `<p class="hint">${tt(`先后有 ${full.segs.length} 段对话（清空或换 agent 时另起一段），都在左边按顺序连着。`, `${full.segs.length} conversations in a row (a new one at each clear or change of agent), all joined in order on the left.`)}</p>` : ''}</section>`
      + `<section><h3>${tt('在机器的终端里打开', 'Open it in a terminal on the machine')}</h3><div class="kcmd"><i>$</i><span id="kCmd">${esc(cmd)}</span><button data-kcopy="${esc(cmd)}" title="${tt('复制这条命令', 'Copy this command')}" aria-label="${tt('复制这条命令', 'Copy this command')}">${KI.copy}</button></div>
          <p class="hint">${open ? tt('在这台机器的任何一个终端里运行，就进到这条会话正在用的终端：看到的和这里是同一场对话。', 'Run it in any terminal on this machine to get to the terminal this session is in: the same conversation as here.') : tt('这条会话没有终端在跑时，这条命令会先新开一个终端，接着上次的对话，再进去。', 'While no terminal runs this session, the command opens a new one first, on with its conversation, then goes in.')}</p>
          ${open && open.words ? `<p class="hint">${tt('或者直接进它那一组：', 'Or straight to its group: ')}<code>${esc(open.words)}</code></p>` : ''}
          ${s && s.loc ? `<button class="btn" data-act="jump">${I.jump}${tt('让本机终端切过去', 'Switch my terminal to it')}</button>` : ''}</section>`;
  });
}
async function kResume(k, withText) {
  const text = withText && $('#kText') ? $('#kText').value.trim() : '';
  if (withText && !text) { $('#kText').focus(); return; }
  for (const b of document.querySelectorAll('[data-kresume]')) b.disabled = true;
  const j = await kDo('resume', { id: k.id, text });
  for (const b of document.querySelectorAll('[data-kresume]')) b.disabled = false;
  if (j.ok && $('#kText')) $('#kText').value = '';
  if (j.ok) kPage(k.id).draft = '';
  if (j.ok && text) { kSent(k, text, 'start'); kChatPaint(k, true); }
  KV.chatAt = 0;
}

// ---------- a workspace ----------
function kBuildSpace() {
  if (route.key === '+') {
    // (a name and a folder, as one card in the middle of the page; folders sessions already run in, and not yet in a workspace, are offered to pick)
    const taken = d => (S.spaces || []).some(w => (w.places || []).some(p => d === p.show || d.startsWith(p.show + '/')));
    const dirs = ((S && S.dirs) || []).filter(d => !taken(d)), base = d => d.replace(/\/+$/, '').split('/').pop() || '';
    $('#view').innerHTML = `<div class="kn"><div class="kn-in wkn"><div class="wkn-h"><h1>${tt('新建工作区', 'New workspace')}</h1>
        <p>${tt('一个名字，加上它管的目录。在这个目录（包括子目录）里开的会话，自动归到它下面。', 'A name, and the folder it covers. Sessions opened in that folder, or below it, are in it.')}</p></div>
      <form class="wkn-card" id="spNew" autocomplete="off">
        <div class="wkn-f"><label for="spName">${tt('名字', 'Name')}</label><input class="field" id="spName" maxlength="60" placeholder="${tt('比如 Sturnus', 'Sturnus, say')}"></div>
        <div class="wkn-f"><label for="spPath">${tt('目录', 'Folder')}</label><input class="field mono" id="spPath" list="spDirs" spellcheck="false" placeholder="~/projects/…"><datalist id="spDirs">${dirs.map(d => `<option value="${esc(d)}">`).join('')}</datalist>
          ${dirs.length ? `<div class="wkn-dirs" role="group" aria-label="${tt('这台机器上用过的目录', 'Folders used on this machine')}">${dirs.slice(0, 8).map(d => `<button type="button" data-spdir="${esc(d)}" title="${esc(d)}">${I.folder}<span>${esc(d)}</span></button>`).join('')}</div>` : ''}
          <p class="hint">${tt('建好以后还能再加目录，也能拿掉。', 'More folders can be added later, and taken out.')}</p></div>
        <div class="wkn-foot"><a class="btn" href="#/">${tt('取消', 'Cancel')}</a><button class="btn primary" type="submit">${tt('建好工作区', 'Create workspace')}</button></div></form></div></div>`;
    const name = $('#spName'), path = $('#spPath'), hint = () => { name.placeholder = base(path.value.trim()) || tt('比如 Sturnus', 'Sturnus, say'); };
    path.addEventListener('input', hint);
    $('#spNew').addEventListener('click', e => {
      const el = e.target.closest('[data-spdir]');
      if (!el) return;
      path.value = el.dataset.spdir; hint();
      for (const b of document.querySelectorAll('[data-spdir]')) b.classList.toggle('on', b === el);
      name.focus();
    });
    $('#spNew').addEventListener('submit', async e => {
      e.preventDefault();
      const p = path.value.trim(), n = name.value.trim() || base(p);  // (no name given: the folder's own)
      if (!n) { name.focus(); return; }
      const go = e.target.querySelector('[type=submit]');
      go.disabled = true;
      const j = await kDo('space', { do: 'add', name: n, paths: [p].filter(Boolean) });
      go.disabled = false;
      if (j.ok) location.hash = `#/w/${encodeURIComponent(j.id)}/folders`;
    });
    setTimeout(() => $('#spName') && $('#spName').focus(), 40);
    return;
  }
  if (route.tab === 'dash' && wsOf(route.key)) {  // (the dashboard app.js draws for the workspace of this key, under this page's own head)
    const was = route;
    route = { name: 'ws', key: was.key, tab: 'dash' };
    OLD.build();
    route = was;
    $('#view .page').classList.add('wk-dash');
    $('#view .page').insertAdjacentHTML('afterbegin', '<div class="wk-head" id="spHead"></div>');
    return;
  }
  $('#view').innerHTML = `<div class="page"><div class="wk-head" id="spHead"></div><div id="spBody"></div></div>`;
}
function kDrawSpace() {
  if (route.key === '+') return;
  const sp = kSpace(route.key);
  if (!sp) { $('#view').innerHTML = `<div class="page"><div class="h-title"><h2>${tt('没有这个工作区了', 'That workspace is gone')}</h2></div><a class="btn" href="#/">${I.back}${tt('回到首页', 'Back to the first page')}</a></div>`; return; }
  const tab = route.tab, mine = (S.kept || []).filter(k => k.space === sp.id), scopes = kScopes(sp);
  const tasks = (S.tasks || []).filter(x => scopes.has(x.scope)), boards = Object.values(S.boards || {}).filter(b => scopes.has(b.key));
  if (!(document.activeElement && document.activeElement.id === 'spRename')) draw('sphead', [sp, tab, mine.length, tasks.filter(taskOpen).length, boards.reduce((n, b) => n + (b.unread || 0), 0), !!wsOf(sp.id), KV.rename, LANG], () => {
    const tabs = [['sessions', tt('会话', 'Sessions'), sp.n], ...(wsOf(sp.id) ? [['dash', tt('仪表盘', 'Dashboard'), '']] : []), ['tasks', tt('任务', 'Tasks'), tasks.filter(taskOpen).length], ['boards', tt('讨论', 'Discussions'), boards.reduce((n, b) => n + (b.unread || 0), 0)], ['folders', tt('目录', 'Folders'), sp.places.length]];
    $('#spHead').innerHTML = `<div class="wk-top"><span class="ks-tile lg">${esc(sp.name.slice(0, 1).toUpperCase())}</span>
        ${KV.rename ? `<input class="field" id="spRename" value="${esc(sp.name)}" aria-label="${tt('工作区的名字', 'Workspace name')}">` : `<h1 data-sprename title="${tt('点一下改名', 'Click to rename')}">${esc(sp.name)}</h1>`}
        <span class="sub">${tt(`${sp.places.length} 个目录，${sp.n} 条会话${sp.live ? `，${sp.live} 条在跑` : ''}`, `${sp.places.length} folder${sp.places.length === 1 ? '' : 's'}, ${sp.n} session${sp.n === 1 ? '' : 's'}${sp.live ? `, ${sp.live} running` : ''}`)}</span>
        <span class="sp"></span><a class="btn primary" href="#/" data-knew="${esc(sp.id)}">${I.plus}${tt('新会话', 'New session')}</a></div>
      <nav class="wk-tabs">${tabs.map(([x, l, n]) => `<a href="#/w/${encodeURIComponent(sp.id)}${x === 'sessions' ? '' : '/' + x}" class="${tab === x ? 'on' : ''}">${l}${n ? `<em>${big(n)}</em>` : ''}</a>`).join('')}</nav>`;
    if (KV.rename && $('#spRename')) { $('#spRename').focus(); $('#spRename').select(); }
  });
  if (tab === 'dash' && wsOf(sp.id)) { const was = route; route = { name: 'ws', key: sp.id, tab: 'dash' }; try { renderWs(); } finally { route = was; } return; }
  const body = $('#spBody');
  if (!body || (document.activeElement && body.contains(document.activeElement) && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName))) return;
  if (tab === 'tasks') {
    const main = Object.values(S.projects || {}).find(p => p.path === (sp.places.find(x => x.main) || {}).path), scope = (main && main.key) || [...scopes].find(x => projOf(x)) || (wsOf(sp.id) ? sp.id : '');
    draw('spbody', ['tasks', sp.id, taskSig(tasks), scope, LANG], () => {
      const open = tasks.filter(taskOpen).sort(taskOrder);
      body.innerHTML = `${scope ? taskNewForm(scope) : `<p class="hint">${tt('这个工作区的目录里还没有项目（git 仓库），任务先记不到它名下。', 'There is no project (a git repository) in this workspace’s folders yet, so a task cannot be kept under it.')}</p>`}
        ${open.length ? `<div class="task-list">${open.map(taskRow).join('')}</div>` : `<div class="calm">${I.check}${tt('这个工作区现在没有没做完的任务。', 'No open tasks in this workspace now.')}</div>`}
        <p class="hint"><a class="lnk" href="#/tasks">${tt('所有工作区的任务，和已经结束的', 'Tasks of every workspace, and the ended ones')}</a></p>`;
    });
  } else if (tab === 'boards') {
    draw('spbody', ['boards', sp.id, boards.map(b => [b.key, b.unread, b.calls, b.last && b.last.at, b.name]), LANG], () => {
      body.innerHTML = boards.length ? `<div class="wk-rows">${boards.sort((a, b) => ((b.last || {}).at || 0) - ((a.last || {}).at || 0)).map(b => `<a class="wk-row" href="#/boards/${encodeURIComponent(b.key)}">
          <span class="mark sm pj">${I.chat}</span><span class="t"><b>${esc(b.name)}</b><small>${b.last ? `${esc(b.last.from)}：${esc(b.last.text.slice(0, 80))}` : tt('还没有人发言', 'Nothing posted yet')}</small></span>
          ${b.unread ? `<span class="n hot">${big(b.unread)}</span>` : ''}<span class="w">${b.last ? ago(b.last.at) : ''}</span></a>`).join('')}</div>`
        : `<div class="calm">${I.chat}${tt('这个工作区的目录里还没有讨论区：有会话在一个项目里发言后，那个项目的讨论区会出现在这里。', 'No discussions in this workspace’s folders yet: once a session posts in a project, its channel shows up here.')}</div>`;
    });
  } else if (tab === 'folders') {
    const projs = Object.values(S.projects || {}).filter(p => kInside(sp, p.path));
    draw('spbody', ['folders', sp, projs.map(p => [p.key, p.name, p.live, p.facts && [p.facts.main, (p.facts.works || []).length]]), LANG], () => {
      body.innerHTML = `<div class="h-title"><h2>${tt('关联的位置', 'What it covers')}</h2><span class="sub">${tt('在这些目录里开的会话（包括子目录），自动归到这个工作区；开新会话时也从这里选目录。', 'Sessions opened in these folders (or below them) are in this workspace; a new session picks its folder from here.')}</span></div>
        <div class="wk-rows">${sp.places.map(p => `<div class="wk-row"><span class="mark sm pj">${I.folder}</span><span class="t"><b class="mono">${esc(p.show)}</b><small>${tt('本机目录', 'A folder on this machine')}${p.there ? '' : tt('，现在不在了', ', no longer there')}</small></span>
            ${p.main ? `<span class="tag">${tt('新会话默认开在这里', 'New sessions open here')}</span>` : `<button class="btn" data-spmain="${esc(p.path)}">${tt('设为默认', 'Make default')}</button>`}
            <button class="ks-ib" data-spdrop="${esc(p.path)}" title="${tt('把这个目录从工作区里拿掉', 'Take this folder out of the workspace')}" aria-label="${esc(tt(`把 ${p.show} 从工作区里拿掉`, `Take ${p.show} out of the workspace`))}">${KI.x}</button></div>`).join('')}
          <form class="wk-row add" id="spAdd" autocomplete="off"><input class="field" id="spAddPath" list="spDirs" placeholder="${tt('再加一个本机目录：~/projects/…', 'Another folder on this machine: ~/projects/…')}" aria-label="${tt('要加的目录', 'Folder to add')}"><datalist id="spDirs">${(S.dirs || []).map(d => `<option value="${esc(d)}">`).join('')}</datalist>
            <button class="btn" type="submit">${I.plus}${tt('添加', 'Add')}</button><span class="hint">${tt('远程存储以后再支持', 'Remote storage comes later')}</span></form></div>
        <p class="hint">${tt('拿掉一个目录不会动磁盘上的任何东西；开在里面的会话会变成「未归入工作区」。', 'Taking a folder out touches nothing on disk; sessions opened in it are then in no workspace.')}</p>
        ${projs.length ? `<div class="h-title"><h2>${tt('这些目录里的项目', 'Projects in these folders')}</h2><span class="sub">${tt('git 仓库，和它们的分支', 'Git repositories and their branches')}</span></div>
          <div class="wk-rows">${projs.sort((a, b) => b.live - a.live || (b.at || 0) - (a.at || 0)).map(p => `<a class="wk-row" href="#/p/${encodeURIComponent(p.key)}"><span class="mark sm pj">${I.branch}</span><span class="t"><b>${esc(p.name)}</b><small class="mono">${esc(home(p.path))}</small></span>
            <span class="w">${p.facts && !p.facts.none ? tt(`${esc(p.facts.main || '')}，${(p.facts.works || []).length} 个 worktree`, `${esc(p.facts.main || '')}, ${(p.facts.works || []).length} worktree${(p.facts.works || []).length === 1 ? '' : 's'}`) : ''}</span></a>`).join('')}</div>` : ''}
        <div class="wk-danger"><button class="btn" data-spdel>${tt('删除这个工作区', 'Delete this workspace')}</button><span class="hint">${tt('只删这个分组：目录、会话和对话都留着，会话变成「未归入工作区」。', 'Only the grouping goes: folders, sessions and conversations stay; its sessions are then in no workspace.')}</span></div>`;
      $('#spAdd').addEventListener('submit', async e => { e.preventDefault(); const j = await kDo('space', { do: 'place_add', id: sp.id, path: $('#spAddPath').value.trim() }); if (j.ok) { delete sig.spbody; render(); } });
    });
  } else {
    draw('spbody', ['sessions', sp.id, mine.map(k => [k.id, kTitle(k), kStand(k)[0], k.at, k.pinned, k.branch, k.kind]), Math.floor(Date.now() / 60000), LANG], () => {
      body.innerHTML = mine.length ? `<div class="wk-rows">${mine.slice().sort(kOrder).map(kLine).join('')}</div><p class="hint"><a class="lnk" href="#/all">${tt('已归档的在「全部会话」里', 'The archived ones are under All sessions')}</a></p>`
        : `<div class="calm">${I.plus}${tt('这个工作区还没有会话。点右上角「新会话」开一个，或者在它的目录里直接运行 claude / codex。', 'No sessions in this workspace yet. Start one with New session, or just run claude / codex in one of its folders.')}</div>`;
    });
  }
}
// (a session as a row of a page's list: what it is, how it stands, where, when; and what can be done with it at once)
function kLine(k) {
  const [st, label] = kStand(k), s = kLive(k), sp = kSpace(k.space);
  return `<div class="wk-row">${mark(k.kind, st, 'sm')}<a class="t" href="${kHref(k)}"><b>${esc(kTitle(k))}</b><small>${esc(s && s.summary ? s.summary : k.note || '')}</small></a>
    <span class="w where">${route.name === 'all' ? esc(sp ? sp.name : tt('未归入', 'None')) + ' · ' : ''}<span class="mono">${esc(folder(k.folder))}${k.branch ? ' / ' + esc(k.branch) : ''}</span></span>
    <span class="kchip ${st}"><i></i>${esc(k.archived ? tt('已归档', 'Archived') : label)}</span><span class="w">${ago(s ? s.at || s.since : k.at)}</span>
    ${k.archived ? `<button class="btn" data-kdo="unarchive" data-kid="${esc(k.id)}">${tt('取消归档', 'Unarchive')}</button><button class="btn" data-kdo="delete" data-kid="${esc(k.id)}">${tt('删除', 'Delete')}</button>` : !s ? `<button class="btn" data-kresume data-kid="${esc(k.id)}">${KI.play}${tt('继续', 'Go on')}</button>` : ''}</div>`;
}

// ---------- every session, the archived too ----------
function kBuildAll() {
  $('#view').innerHTML = `<div class="page"><div class="h-title"><h2>${tt('全部会话', 'All sessions')}</h2><span class="sub" id="allSub"></span>
    <div class="right"><div class="seg" id="allShow"></div></div></div>
    <input class="field" id="allQ" type="search" value="${esc(KV.allQ)}" placeholder="${tt('按名字、工作区、目录找', 'Find by title, workspace, folder')}" aria-label="${tt('找会话', 'Find a session')}" autocomplete="off"><div id="allList"></div></div>`;
  $('#allQ').addEventListener('input', e => { KV.allQ = e.target.value; delete sig.all; render(); });
  kAll(true);
}
function kDrawAll() {
  kAll();
  const all = KV.all || S.kept || [], q = KV.allQ.trim().toLowerCase();
  const hit = k => !q || [kTitle(k), k.name, k.show, (kSpace(k.space) || {}).name, FULL[k.kind]].some(x => String(x || '').toLowerCase().includes(q));
  const rows = all.filter(k => (KV.allShow === 'archived' ? k.archived : !k.archived) && hit(k));
  draw('all', [KV.allShow, q, rows.map(k => [k.id, kTitle(k), kStand(k)[0], k.at, k.archived]), all.length, LANG, Math.floor(Date.now() / 60000)], () => {
    $('#allSub').textContent = tt(`${all.filter(k => !k.archived).length} 条在用，${all.filter(k => k.archived).length} 条已归档`, `${all.filter(k => !k.archived).length} open, ${all.filter(k => k.archived).length} archived`);
    $('#allShow').innerHTML = [['open', tt('在用的', 'Open')], ['archived', tt('已归档', 'Archived')]].map(([x, l]) => `<button data-allshow="${x}" class="${KV.allShow === x ? 'on' : ''}">${l}</button>`).join('');
    $('#allList').innerHTML = rows.length ? `<div class="wk-rows">${rows.slice().sort(kOrder).slice(0, 400).map(kLine).join('')}</div>`
      : `<div class="calm">${I.check}${KV.allShow === 'archived' ? tt('没有归档的会话。归档是你自己点的，不会按时间自动归档。', 'Nothing archived. Archiving is your own doing; nothing is archived by time.') : tt('没有找到。', 'Nothing found.')}</div>`;
  });
}

// ---------- what runs by the clock ----------
const kEvery = e => { const m = String(e).match(/^(daily|weekdays|hours) (.+)$/) || []; return m[1] === 'hours' ? tt(`每隔 ${m[2]} 小时`, `every ${m[2]} h`) : m[1] === 'weekdays' ? tt(`工作日 ${m[2]}`, `weekdays at ${m[2]}`) : tt(`每天 ${m[2]}`, `every day at ${m[2]}`); };
function kBuildPlans() {
  const spaces = (S && S.spaces || []).filter(w => !w.archived), kinds = Object.keys((S && S.launch) || {}).filter(k => FULL[k]);
  $('#view').innerHTML = `<div class="page narrow"><div class="h-title"><h2>${tt('定时', 'By the clock')}</h2></div><p class="pl-lead">${tt('到点就开一条新会话去做一件事。做完后空闲半小时，它的终端会自动停掉；会话留着，随时能看、能继续。你在里面说过话、或者把它置顶了，就不会自动停。', 'When its time comes, a new session is started to do one thing. Half an hour after it comes to rest its terminal is stopped; the session stays, to read and to go on with. One you have spoken in, or pinned, is not stopped.')}</p>
    <form class="pl-new" id="plNew" autocomplete="off"><input class="field" id="plTitle" aria-label="${tt('名字', 'Name')}" placeholder="${tt('名字，比如：每天早上看一眼构建', 'A name: Look at the build every morning, say')}">
      <textarea class="area" id="plPrompt" rows="3" aria-label="${tt('到点时交给它的话', 'What it is told when the time comes')}" placeholder="${tt('到点时交给它的话', 'What it is told when the time comes')}"></textarea>
      <div class="row"><select class="sel" id="plWhere" aria-label="${tt('在哪个目录做', 'In which folder')}">${spaces.flatMap(w => w.places.map(p => `<option value="${esc(w.id)}|${esc(p.path)}">${esc(w.name)} · ${esc(p.show)}</option>`)).join('') || `<option value="">${tt('先建一个工作区', 'Make a workspace first')}</option>`}</select>
        <select class="sel" id="plKind" aria-label="Agent">${kinds.map(k => `<option value="${k}">${FULL[k]}</option>`).join('')}</select>
        <select class="sel" id="plType" aria-label="${tt('什么时候做', 'When')}"><option value="daily">${tt('每天', 'Every day')}</option><option value="weekdays">${tt('工作日', 'Weekdays')}</option><option value="hours">${tt('每隔几小时', 'Every few hours')}</option></select>
        <input class="field" id="plTime" type="time" value="09:00" aria-label="${tt('几点', 'At')}"><input class="field" id="plHours" type="number" min="1" max="999" value="6" hidden aria-label="${tt('几小时一次', 'Hours between')}">
        <span class="sp"></span><button class="btn primary" type="submit">${I.plus}${tt('加上', 'Add')}</button></div></form>
    <div id="plList"></div></div>`;
  $('#plType').addEventListener('change', e => { $('#plHours').hidden = e.target.value !== 'hours'; $('#plTime').hidden = e.target.value === 'hours'; });
  $('#plNew').addEventListener('submit', async e => {
    e.preventDefault();
    const [space, folder] = ($('#plWhere').value || '|').split('|'), type = $('#plType').value;
    const j = await kDo('plan', { do: 'add', title: $('#plTitle').value.trim(), prompt: $('#plPrompt').value.trim(), kind: $('#plKind').value, space, folder, every: type === 'hours' ? `hours ${parseInt($('#plHours').value, 10) || 0}` : `${type} ${$('#plTime').value}` });
    if (j.ok) { $('#plTitle').value = ''; $('#plPrompt').value = ''; }
  });
}
function kDrawPlans() {
  const plans = S.plans || [];
  draw('plans', [plans, (S.kept || []).map(k => [k.id, k.title]), LANG, Math.floor(Date.now() / 60000)], () => {
    $('#plList').innerHTML = plans.length ? `<div class="wk-rows">${plans.map(p => `<div class="wk-row pl${p.live ? '' : ' off'}"><span class="mark sm pj">${KI.clock}</span>
      <div class="t"><b>${esc(p.title)}</b><small>${esc(kEvery(p.every))} · ${esc(FULL[p.kind] || p.kind)} · <span class="mono">${esc(home(p.folder))}</span></small>
        <small>${p.live && p.next ? tt('下一次：', 'Next: ') + esc(kDay(p.next)) : tt('已关掉', 'Switched off')}${p.runs.length ? tt('；做过的：', '; runs: ') + p.runs.slice(0, 5).map(r => kOf(r.kept) ? `<a class="lnk" href="#/k/${encodeURIComponent(r.kept)}">${esc(kDay(r.at))}</a>` : esc(kDay(r.at))).join(tt('、', ', ')) : ''}</small></div>
      <label class="check"><input type="checkbox" data-plon="${esc(p.id)}" ${p.live ? 'checked' : ''}> ${tt('开着', 'On')}</label>
      <button class="btn" data-plrun="${esc(p.id)}">${KI.play}${tt('现在做一次', 'Run now')}</button>
      <button class="ks-ib" data-pldel="${esc(p.id)}" title="${tt('删除', 'Delete')}" aria-label="${esc(tt(`删除「${p.title}」`, `Delete “${p.title}”`))}">${KI.x}</button></div>`).join('')}</div>`
      : `<div class="calm">${KI.clock}${tt('还没有定时的事。', 'Nothing is set by the clock yet.')}</div>`;
  });
}

// ---------- telling the person, when the page is not in front: a session needs them, or has finished its turn ----------
function kBeep() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)(), o = ac.createOscillator(), g = ac.createGain();
    o.connect(g); g.connect(ac.destination); o.frequency.value = 660; g.gain.setValueAtTime(.0001, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(.12, ac.currentTime + .02); g.gain.exponentialRampToValueAtTime(.0001, ac.currentTime + .35);
    o.start(); o.stop(ac.currentTime + .4); o.onended = () => ac.close();
  } catch {}
}
function kNotify() {
  const now = {}, first = !KNOT.was;
  for (const k of S.kept || []) now[k.id] = kStand(k)[0];
  const was = KNOT.was || {};
  KNOT.was = now;
  if (first || !KNOT.on || !('Notification' in window) || Notification.permission !== 'granted') return;
  const NEED = ['waiting', 'asking', 'blocked', 'review'];
  for (const k of S.kept || []) {
    const a = was[k.id], b = now[k.id], s = kLive(k);
    if (!a || a === b || (document.hasFocus() && route.kept === k.id)) continue;
    const title = NEED.includes(b) && !NEED.includes(a) ? tt(`${kTitle(k)}：等你`, `${kTitle(k)}: needs you`) : a === 'working' && b === 'idle' ? tt(`${kTitle(k)}：这一轮做完了`, `${kTitle(k)}: finished its turn`) : '';
    if (!title) continue;
    try {
      const n = new Notification(title, { body: (s && (needOf(s) || s.summary)) || '', tag: k.id, icon: 'icon-180.png' });
      n.onclick = () => { window.focus(); location.hash = kHref(k); n.close(); };
    } catch {}
    if (KNOT.sound) kBeep();
  }
}

// ---------- the frame ----------
window.drawRail = function () { if (phone()) OLD.drawRail(); };
window.drawSide = function () { if (phone()) OLD.drawSide(); };
window.build = function () {
  if (phone()) return OLD.build();
  closeOverlays();
  const r = route;
  if (r.name === 'home') kBuildHome();
  else if (r.name === 'need') kBuildNeed();
  else if (r.name === 'session' && r.kept) kBuildKept();
  else if (r.name === 'space') kBuildSpace();
  else if (r.name === 'all') kBuildAll();
  else if (r.name === 'plans') kBuildPlans();
  else OLD.build();
};
window.render = function () {
  if (!S) return;
  if (phone()) return OLD.render();
  if (KV.blind) { KV.blind = false; for (const k in sig) delete sig[k]; route = parseRoute(); build(); }
  kDrawSide();
  kNotify();
  const r = route;
  if (r.name === 'home') kDrawHome();
  else if (r.name === 'need') { drawAttn(''); drawTodoProjects((S.workspaces || []).flatMap(w => w.projects.filter(k => S.sessions.some(s => s.project === k)))); }
  else if (r.name === 'session' && r.kept) kDrawKept();
  else if (r.name === 'space') kDrawSpace();
  else if (r.name === 'all') kDrawAll();
  else if (r.name === 'plans') kDrawPlans();
  else return OLD.render();
  if (ASST.open) draw('asst-head', [S.models && S.models.assist && S.models.assist.label, S.voice && S.voice.on], () => drawAsst(true));
  if (!$('#palette').hidden) drawPalette();
};
// (search: the workspaces and the sessions that last, the stopped ones too; then app.js's own places)
window.palPlaces = function () {
  if (phone()) return OLD.palPlaces();
  const q = $('#paletteQ').value.trim().toLowerCase();
  const hit = (...x) => !q || x.some(v => String(v || '').toLowerCase().includes(q));
  return [...(q ? (S.spaces || []).filter(w => !w.archived && hit(w.name, ...w.places.map(p => p.show))).map(w => ({ href: `#/w/${encodeURIComponent(w.id)}`, label: w.name, sub: tt('工作区 · ', 'Workspace · ') + w.places.map(p => p.show).join('、'), ws: { key: w.id } })) : []),
    ...(S.kept || []).filter(k => !k.archived && hit(kTitle(k), k.name, k.show, (kSpace(k.space) || {}).name, FULL[k.kind], (kLive(k) || {}).summary)).sort(kOrder).slice(0, 30)
      .map(k => ({ href: kHref(k), label: kTitle(k), sub: `${(kSpace(k.space) || {}).name || tt('未归入工作区', 'In no workspace')} · ${kStand(k)[1]} · ${FULL[k.kind] || k.kind}` })),
    ...(q ? Object.values(S.projects || {}).filter(p => p.name.toLowerCase().includes(q)).slice(0, 5).map(p => ({ href: `#/p/${encodeURIComponent(p.key)}`, label: p.name, sub: tt('项目 · ', 'Project · ') + home(p.path) })) : []),
    ...(q && KV.hitsQ === q ? KV.hits.slice(0, 14).map(h => ({ href: `#/k/${encodeURIComponent(h.kept)}`, label: h.title || tt('没有名字的会话', 'Unnamed session'), sub: `${h.archived ? tt('已归档 · ', 'Archived · ') : ''}${h.who === 'user' ? tt('你说过', 'You said') : tt('它说过', 'It said')}：${h.line}` })) : [])];
};
$('#paletteQ').addEventListener('input', () => {  // (what was said in any session's conversations: looked up a moment after the typing stops)
  clearTimeout(KV.hitsT);
  const q = $('#paletteQ').value.trim().toLowerCase();
  if (q.length < 2 || phone()) { KV.hits = []; KV.hitsQ = ''; return; }
  KV.hitsT = setTimeout(async () => {
    try {
      const j = await (await fetch('/api/search?q=' + encodeURIComponent(q), { cache: 'no-store' })).json();
      if ($('#paletteQ').value.trim().toLowerCase() !== q) return;
      KV.hitsQ = q; KV.hits = j.hits || [];
      if (!$('#palette').hidden) drawPalette();
    } catch {}
  }, 260);
});
window.palItems = function () { return phone() ? OLD.palItems() : []; };
// (settings: the way new terminals are opened, a pane of its own)
window.drawSettings = function () {
  for (const [x, zh, en] of [['terminal', '终端', 'Terminals'], ['notify', '通知', 'Notifications']]) { const b = document.querySelector(`#settingsNav [data-pane="${x}"]`); if (b) b.textContent = tt(zh, en); }
  if (pane !== 'terminal' && pane !== 'notify') return OLD.drawSettings();
  document.querySelectorAll('#settingsNav button').forEach(b => b.classList.toggle('on', b.dataset.pane === pane));
  if (pane === 'notify') {
    const can = 'Notification' in window, perm = can ? Notification.permission : 'denied';
    $('#settingsBody').innerHTML = `<h3>${tt('通知', 'Notifications')}</h3>
      <p class="lead">${tt('这个页面不在眼前时，有会话等你、或者做完了一轮，浏览器会弹一条通知；点它就回到那条会话。只对这一个浏览器生效。', 'While this page is not in front of you, the browser tells you when a session needs you or has finished its turn; clicking it takes you to that session. This browser only.')}</p>
      <div class="kset-col"><label class="check"><input type="checkbox" id="kNotOn" ${KNOT.on && perm === 'granted' ? 'checked' : ''} ${can && perm !== 'denied' ? '' : 'disabled'}> ${tt('弹通知', 'Show notifications')}</label>
      <label class="check"><input type="checkbox" id="kNotSound" ${KNOT.sound ? 'checked' : ''}> ${tt('同时响一声', 'With a sound')}</label></div>
      <p class="hint">${!can ? tt('这个浏览器不支持通知。', 'This browser has no notifications.') : perm === 'denied' ? tt('浏览器里已经拒绝了这个页面的通知：在浏览器的网站设置里改回来。', 'Notifications are blocked for this page in the browser: allow them in its site settings.') : !window.isSecureContext ? tt('通知要在 https 或本机（127.0.0.1）打开的页面上才有。', 'Notifications need the page opened over https or on this machine (127.0.0.1).') : ''}</p>`;
    return;
  }
  const cur = (S.terminal || {}).way, usable = (S.terminal || {}).usable || [], rest = +((S.terminal || {}).rest_days ?? 7);
  $('#settingsBody').innerHTML = `<h3>${tt('终端', 'Terminals')}</h3>
    <p class="lead">${tt('一条会话在自己的终端里跑。这里定的是新终端怎么开：新会话、和停下的会话「继续」时，都按这个来。会话比终端活得久，所以随时可以换：已经开着的不动，下一个终端起按新的方式。', 'A session runs in a terminal of its own. This is how a new one is opened, for a new session and when a stopped one goes on. A session outlasts its terminals, so this can change at any time: those open stay as they are, and the next one opens the new way.')}</p>
    <div class="choice kway">${Object.keys(KWAY).map(w => `<button type="button" data-kway="${w}" class="${cur === w ? 'on' : ''}" ${usable.includes(w) ? '' : 'disabled'}><div><b>${esc(tt(...KWAY[w]))}</b>
      <span>${usable.includes(w) ? { 'zellij-tab': tt('组的名字取自工作区；zellij attach <组> 能看到这个工作区的所有会话', 'The group is named after the workspace; zellij attach <group> shows all its sessions'), 'tmux-window': tt('组的名字取自工作区；tmux attach -t <组> 能看到这个工作区的所有会话', 'The group is named after the workspace; tmux attach -t <group> shows all its sessions'), 'tmux-own': tt('每条会话自己一个 tmux 会话（st-…），进出互不影响', 'Each session has a tmux session to itself (st-…)') }[w] : tt('这台机器上没装它', 'Not installed on this machine')}</span></div></button>`).join('')}</div>
    <p class="hint">${tt('在这台机器的终端里：sturnus ls 列出会话，sturnus open 编号或名字 进到那条会话的终端。', 'In a terminal on this machine: sturnus ls lists the sessions, sturnus open NUMBER or TITLE goes to that session’s terminal.')}</p>
    <h3 class="kset-h">${tt('很久没用的会话', 'Sessions not used for long')}</h3>
    <p class="lead">${tt('一条会话空闲太久，就自动关掉它的终端：agent 进程退出，不再占内存和窗格。会话和对话都留着，下次点「继续」（或直接发一句话）会新开终端接上。只关空闲、没有提示等着回答、没人正在看的；置顶的不关。', 'A session idle for too long has its terminal closed: its agent quits and no longer holds memory and a pane. The session and its conversation stay, and Go on (or just sending words) takes it up in a new terminal. Only one that is idle, with no prompt waiting and nobody looking at it; a pinned one is left alone.')}</p>
    <label class="kset-row">${tt('空闲多久后关掉终端', 'Close its terminal after')} <select class="sel" id="kRestDays">${[[0, tt('从不', 'Never')], [1, tt('1 天', '1 day')], [3, tt('3 天', '3 days')], [7, tt('7 天', '7 days')], [14, tt('14 天', '14 days')], [30, tt('30 天', '30 days')]]
      .concat([0, 1, 3, 7, 14, 30].includes(rest) ? [] : [[rest, tt(`${rest} 天`, `${rest} days`)]]).map(([v, l]) => `<option value="${v}" ${v === rest ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
};

// ---------- what is clicked, typed, changed ----------
// (in a box of words to send, Enter sends and Shift+Enter makes a new line — ⌘/Ctrl+Enter sends as it always did; an
// Enter that only ends an input method's composing sends nothing)
const kEnter = e => e.key === 'Enter' && (e.metaKey || e.ctrlKey || (!e.shiftKey && !e.altKey && !e.isComposing && e.keyCode !== 229));
document.addEventListener('click', async e => {
  if (phone()) return;
  const q = sel => e.target.closest(sel);
  let el;
  const cur = () => kOf((el && el.dataset.kid) || route.kept);
  if (KV.menu && !q('.kmenu')) { KV.menu = false; delete sig.khead; render(); }
  if (KV.arr && !q('.ks-arr')) { KV.arr = false; render(); }
  if (KV.model && !q('.kmodel-menu, [data-kmodel]')) { KV.model = false; render(); }
  if (q('[data-kmodel]')) { KV.model = !KV.model; render(); return; }
  if ((el = q('[data-kmset]'))) {  // (a model, an effort or a speed for a Claude Code session: the command for it, typed into its terminal)
    const k = cur(), s = k && kLive(k), [what, v] = el.dataset.kmset.split(':');
    if (!k || !s || sayHow(s) !== 'type') return;
    if (what === 'fast' && v === 'on' && !confirm(tt('快速模式不在订阅额度里，按用量额度另外计费。给这条会话打开？', 'Fast mode is not part of the plan: it is billed from usage credits. Turn it on for this session?'))) return;
    const text = `/${what === 'fast' ? 'fast' : what} ${v}`;
    KV.model = false; render();
    const j = await api('type', { id: s.id, text, enter: true }).catch(() => ({ ok: false, msg: tt('没连上服务', 'The service could not be reached') }));
    toast(j.ok ? tt(`已在它的终端里输入 ${text}`, `Typed ${text} into its terminal`) : (j.msg || tt('没发出去', 'Not sent')), !!j.ok);
    return;
  }
  if ((el = q('[data-act="say"], [data-act="say-now"]')) && route.kept) {  // (words for a session, from its page: shown in its conversation at once)
    const k = kOf(route.kept), s = kLive(k), text = $('#rText') ? $('#rText').value.trim() : '';
    if (k && s && text) { e.stopPropagation(); e.preventDefault(); kSay(k, s, text, el.dataset.act === 'say-now'); return; }
  }
  if (q('#ksFold')) { setSide(true); render(); return; }
  if (q('#ksShow')) { setSide(false); render(); return; }
  if (q('#ksFind')) { openPalette(); return; }
  if (q('#ksAsst')) { asstToggle(); return; }
  if (q('#ksSet')) { openSettings(); return; }
  if (q('#ksTheme')) { const o = ['auto', 'light', 'dark'], v = store.get('deck.theme', 'auto'); store.set('deck.theme', o[(o.indexOf(v) + 1) % 3]); applyTheme(); render(); return; }
  if (q('[data-karr]')) { KV.arr = !KV.arr; render(); return; }
  if (q('[data-ktake]')) {
    const k = cur(), s = k && kLive(k);
    if (!k || !s || KV.take) return;
    if (s.proc && !confirm(tt(`结束「${kTitle(k)}」现在的进程，搬到这里的终端接着做？`, `End the present process of “${kTitle(k)}” and go on in a terminal here?`))) return;
    KV.take = k.id; render();
    await kDo('kept', { id: k.id, do: 'take' });
    KV.take = ''; render();
    return;
  }
  if ((el = q('[data-kview]'))) { KV.view = el.dataset.kview; store.set('deck.kView', KV.view); render(); return; }
  if ((el = q('[data-ksort]'))) { KV.sort = el.dataset.ksort; store.set('deck.kSort', KV.sort); render(); return; }
  if ((el = q('[data-kopen]'))) { const x = el.dataset.kopen; KV.open.has(x) ? KV.open.delete(x) : KV.open.add(x); store.set('deck.kOpen', [...KV.open]); render(); return; }
  if (q('[data-kplaces]')) { KV.places = !KV.places; store.set('deck.kPlaces', KV.places); render(); return; }
  if ((el = q('[data-kshutall]'))) {  // (every group folded shut at once, or all open again)
    for (const x of el.dataset.keys.split(' ')) el.dataset.kshutall === '1' ? KV.shut.add(x) : KV.shut.delete(x);
    store.set('deck.kShut', [...KV.shut]); render(); return;
  }
  if ((el = q('[data-kshut]')) && !q('.ks-gh a')) {  // (a group's head: anywhere on it but its name and its + folds it or opens it)
    const x = el.dataset.kshut; KV.shut.has(x) ? KV.shut.delete(x) : KV.shut.add(x); store.set('deck.kShut', [...KV.shut]); render(); return;
  }
  if ((el = q('[data-knew]'))) { KN.space = el.dataset.knew; KN.dir = ''; delete sig.knrow; setTimeout(render, 0); return; }  // (its link goes to the new-session page)
  if ((el = q('[data-kway]'))) { const w = el.dataset.kway, j = await kDo('terminal', { way: w }); if (j.ok && S.terminal) S.terminal.way = w; drawSettings(); return; }
  if ((el = q('[data-knkind]'))) { KN.kind = el.dataset.knkind; render(); return; }
  if ((el = q('[data-kset]'))) { pane = el.dataset.kset; openSettings(); return; }
  if ((el = q('[data-kcopy]'))) { toClipboard(el.dataset.kcopy); toast(tt('已复制', 'Copied')); return; }
  if (q('[data-kkids]')) { KV.kidsAll = !KV.kidsAll; if (document.activeElement) document.activeElement.blur(); render(); return; }  // (the side is not drawn again while something in it has the focus)
  if (q('[data-kearlier]')) {  // (more of the conversation, from before what is shown)
    const k = cur(), sess = $('#sess');
    if (!k || !sess) return;
    const pg = kPage(k.id);
    pg.n += 400; pg.moreBusy = true; pg.hold = sess.scrollHeight - sess.scrollTop; pg.tools.clear();  // (the steps opened are counted from the top, which moves)
    KV.chatAt = 0; render();
    return;
  }
  if (q('[data-kname]')) {  // (its name among the sessions: Claude Code names its own, any other is renamed here)
    const k = cur();
    if (k && k.kind === 'claude') { toast(tt('Claude 会话的名字由它自己定：在它的对话里输入 /rename 新名字，这里和 amail 会跟着变。', 'A Claude session names itself: type /rename and a new name into its conversation; this page and amail follow.')); return; }
    KV.nameEd = k ? k.id : false;
    if (document.activeElement) document.activeElement.blur();
    render();
    setTimeout(() => { if ($('#rName')) { $('#rName').focus(); $('#rName').select(); } }, 30);
    return;
  }
  if (q('[data-act="rename"]')) { KV.nameEd = false; setTimeout(() => { if (document.activeElement) document.activeElement.blur(); render(); }, 60); }  // (app.js sends the new name; the row folds back)
  if ((el = q('[data-kresume]'))) { e.preventDefault(); const k = cur(); if (k) kResume(k, el.dataset.kresume === 'say'); return; }
  if (q('[data-kpin]')) { const k = cur(); if (k) await kDo('kept', { id: k.id, do: 'pin', on: !k.pinned }); return; }
  if (q('[data-kinfo]')) { KV.info = !KV.info; store.set('deck.kInfo', KV.info); delete sig.khead; delete sig.kinfo; render(); fitTerm(); return; }
  if (q('[data-kmenu]')) { KV.menu = !KV.menu; delete sig.khead; render(); return; }
  if (q('[data-krename]')) { KV.menu = false; KV.rename = true; delete sig.khead; render(); return; }
  if (q('[data-sprename]')) { KV.rename = true; delete sig.sphead; render(); return; }
  if ((el = q('[data-kdo]'))) {
    e.preventDefault();
    const k = cur(), what = el.dataset.kdo;
    if (!k) return;
    KV.menu = false;
    if (what === 'stop' && !confirm(tt(`停止「${kTitle(k)}」？终端里的 agent 会结束，正在做的那一步会断掉。会话和对话都留着，之后可以继续。`, `Stop “${kTitle(k)}”? Its agent ends and the step it is on is cut off. The session and its conversation stay, and it can go on later.`))) return;
    if (what === 'archive' && k.live && !confirm(tt(`归档「${kTitle(k)}」？它正在跑：归档会先停掉它。`, `Archive “${kTitle(k)}”? It is running: archiving stops it first.`))) return;
    if (what === 'delete' && !confirm(tt(`删除「${kTitle(k)}」？这条会话在 Sturnus 里的记录会删掉，不能恢复（agent 自己存的对话文件不动）。`, `Delete “${kTitle(k)}”? Its record in Sturnus is removed for good (the agent’s own conversation files are left alone).`))) return;
    const j = await kDo('kept', { id: k.id, do: what === 'unarchive' ? 'archive' : what, on: what !== 'unarchive' });
    delete KV.full[k.id]; delete sig.khead; delete sig.kfoot;
    if (route.name === 'all') kAll(true);
    if (j.ok && what === 'delete' && route.kept === k.id) location.hash = '#/all';
    return;
  }
  if ((el = q('[data-allshow]'))) { KV.allShow = el.dataset.allshow; render(); return; }
  if (q('[data-khand]')) { KV.menu = false; KV.hand = { kind: '', note: '', busy: false }; delete sig.khead; render(); return; }
  if (q('[data-khandoff]')) { KV.hand = null; render(); return; }
  if ((el = q('[data-khandkind]'))) {
    const k = cur(), kind = el.dataset.khandkind;
    if (!k) return;
    KV.hand = { kind, note: '', busy: true }; render();
    const j = await api('handover', { id: k.id, kind }).catch(x => ({ ok: false, msg: x.message }));
    if (!KV.hand || KV.hand.kind !== kind) return;
    if (!j.ok) toast(j.msg, false);
    KV.hand = { kind, note: j.note || '', file: j.file || '', busy: false }; render();
    return;
  }
  if (q('[data-khandgo]')) {
    const k = cur(), note = $('#kNote') ? $('#kNote').value.trim() : '';
    if (!k || !KV.hand || !KV.hand.kind) return;
    const j = await kDo('resume', { id: k.id, kind: KV.hand.kind, text: note });
    if (j.ok) { KV.hand = null; KV.chatAt = 0; render(); }
    return;
  }
  if ((el = q('[data-krecover]'))) { await kDo('recover', { do: el.dataset.krecover }); return; }
  if ((el = q('[data-knwt]'))) { KN.wt = el.dataset.knwt === '1'; render(); return; }
  if ((el = q('[data-plrun]'))) { const j = await kDo('plan', { do: 'run', id: el.dataset.plrun }); if (j.ok && j.kept) location.hash = `#/k/${encodeURIComponent(j.kept)}`; return; }
  if ((el = q('[data-pldel]'))) { if (confirm(tt('删除这一项？它开过的会话都留着。', 'Delete this one? The sessions it started all stay.'))) await kDo('plan', { do: 'delete', id: el.dataset.pldel }); return; }
  if ((el = q('[data-kside]'))) { KV.side = el.dataset.kside; delete sig.kinfo; if (document.activeElement) document.activeElement.blur(); render(); return; }
  if (q('[data-kdiffsay]')) {
    const k = cur(), text = $('#kDiffSay') ? $('#kDiffSay').value.trim() : '', s = k && kLive(k);
    if (!k || !text) { if ($('#kDiffSay')) $('#kDiffSay').focus(); return; }
    const j = s ? await kDo('say', { id: s.id, text }) : await kDo('resume', { id: k.id, text });
    if (j.ok && $('#kDiffSay')) { $('#kDiffSay').value = ''; $('#kDiffSay').blur(); kPage(k.id).diffDraft = ''; }
    return;
  }
  if (q('[data-kmerge]')) {
    const k = cur(), d = (k && kPage(k.id).diff.data) || {};
    if (!k || !confirm(tt(`把分支 ${d.branch} 合进 ${d.main}（只做快进合并），然后清掉这条会话的 worktree 和分支？`, `Merge branch ${d.branch} into ${d.main} (fast-forward only), then clear this session’s worktree and branch away?`))) return;
    let j = await kDo('kept', { id: k.id, do: 'merge' });
    if (!j.ok && j.ask === 'ignored') {  // (files git ignores would go with the folder: only on the person's word)
      const names = j.files.join('\n') + (j.more ? tt(`\n……还有 ${j.more} 个`, `\n… and ${j.more} more`) : '');
      if (confirm(tt(`这个 worktree 里还有 git 不管的文件，目录清掉后它们就没了：\n\n${names}\n\n确定合并并清掉？`, `This worktree still holds files git ignores; they go with the folder:\n\n${names}\n\nMerge and clear it away all the same?`))) j = await kDo('kept', { id: k.id, do: 'merge', drop: true });
    }
    kDiffLoad(k, true);
    return;
  }
  if ((el = q('[data-spmain]'))) { await kDo('space', { do: 'place_main', id: route.key, path: el.dataset.spmain }); return; }
  if ((el = q('[data-spdrop]'))) { if (confirm(tt('把这个目录从工作区里拿掉？磁盘上什么都不动；开在里面的会话会变成「未归入工作区」。', 'Take this folder out of the workspace? Nothing on disk is touched; sessions opened in it are then in no workspace.'))) await kDo('space', { do: 'place_drop', id: route.key, path: el.dataset.spdrop }); return; }
  if (q('[data-spdel]')) { const sp = kSpace(route.key); if (sp && confirm(tt(`删除工作区「${sp.name}」？只删这个分组：目录、会话和对话都留着。`, `Delete workspace “${sp.name}”? Only the grouping goes: folders, sessions and conversations stay.`))) { const j = await kDo('space', { do: 'delete', id: sp.id }); if (j.ok) location.hash = '#/'; } return; }
}, true);
document.addEventListener('change', async e => {
  if (phone()) return;
  if (e.target.id === 'knSpace') { KN.space = e.target.value; KN.dir = ''; delete sig.knrow; render(); if ($('#knText')) $('#knText').focus(); }
  if (e.target.id === 'knDir') { KN.dir = e.target.value; delete sig.knrow; render(); }
  if (e.target.dataset.plon) { await kDo('plan', { do: 'set', id: e.target.dataset.plon, on: e.target.checked }); return; }
  if (e.target.id === 'kRestDays') { const v = +e.target.value, j = await kDo('terminal', { rest_days: v }); if (j.ok && S.terminal) S.terminal.rest_days = v; drawSettings(); return; }  // (shown as set, whether or not the deck's next word is in yet)
  if (e.target.id === 'kNotOn') {
    if (e.target.checked && Notification.permission !== 'granted') await Notification.requestPermission();
    KNOT.on = e.target.checked && Notification.permission === 'granted'; store.set('deck.kNotify', KNOT.on); drawSettings(); return;
  }
  if (e.target.id === 'kNotSound') { KNOT.sound = e.target.checked; store.set('deck.kSound', KNOT.sound); if (KNOT.sound) kBeep(); return; }
  if (e.target.dataset.kspace) { await kDo('kept', { id: e.target.dataset.kspace, do: 'space', space: e.target.value }); delete sig.kinfo; e.target.blur(); render(); }
});
const kRenameDone = async (el, save) => {
  if (!KV.rename) return;
  KV.rename = false;
  const v = el.value.trim();
  if (save && el.id === 'kTitle') await kDo('kept', { id: route.kept, do: 'title', title: v });
  if (save && el.id === 'spRename' && v) await kDo('space', { do: 'rename', id: route.key, name: v });
  delete sig.khead; delete sig.sphead; el.blur(); render();
};
document.addEventListener('keydown', e => {
  if (phone()) return;
  const el = document.activeElement, typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
  if (el.id === 'kTitle' || el.id === 'spRename') { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); kRenameDone(el, e.key === 'Enter'); } return; }
  if (el.id === 'kText' && kEnter(e)) { e.preventDefault(); const k = kOf(route.kept); if (k) kResume(k, true); return; }
  if (e.key === 'Escape' && KV.menu) { KV.menu = false; delete sig.khead; render(); e.stopImmediatePropagation(); return; }
  if (e.key === 'Escape' && KV.arr) { KV.arr = false; render(); e.stopImmediatePropagation(); return; }
  if (e.key === 'Escape' && KV.model) { KV.model = false; render(); e.stopImmediatePropagation(); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  const overlay = ['#palette', '#settings', '#newSess', '#taskPanel'].some(id => !$(id).hidden);
  if (overlay) return;
  if (e.key.toLowerCase() === 'n') { e.preventDefault(); e.stopImmediatePropagation(); if (route.name === 'home') { if ($('#knText')) $('#knText').focus(); } else location.hash = '#/'; return; }
  if (route.name === 'session' && route.kept && { t: 'term', c: 'chat', o: 'overview' }[e.key.toLowerCase()]) {  // (its tabs by a key: only while it runs)
    e.preventDefault(); e.stopImmediatePropagation();
    const k = kOf(route.kept), tab = { t: 'term', c: 'chat', o: 'overview' }[e.key.toLowerCase()];
    if (k && kLive(k)) location.hash = kHref(k) + (tab === 'chat' ? '' : '/' + tab);
  }
}, true);
document.addEventListener('focusout', e => { if (e.target.id === 'kTitle' || e.target.id === 'spRename') kRenameDone(e.target, true); });
document.addEventListener('toggle', e => {  // (a file's diff opened, a run of steps opened: remembered with the session, and read when it is a diff)
  const el = e.target, k = el.matches && kOf(route.kept);
  if (!k) return;
  if (el.matches('details.kdf')) { const D = kPage(k.id).diff; if (el.open) { D.open.add(el.dataset.kdf); kDiffFile(k, el); } else D.open.delete(el.dataset.kdf); }
  else if (el.matches('#convo details.ktools')) { const i = [...document.querySelectorAll('#convo .ktools')].indexOf(el), t = kPage(k.id).tools; if (el.open) t.add(i); else t.delete(i); }
}, true);
document.addEventListener('input', e => {  // (words begun in a session's boxes stay with the session)
  if (phone() || !route.kept) return;
  if (e.target.id === 'rText' || e.target.id === 'kText') kPage(route.kept).draft = e.target.value;
  else if (e.target.id === 'kDiffSay') kPage(route.kept).diffDraft = e.target.value;
}, true);
document.addEventListener('scroll', e => {  // (how far a conversation was read: where one finds it again)
  if (e.target.id !== 'sess' || phone() || !route.kept || !$('#convo') || sig.kcFirst !== route.kept) return;
  const el = e.target, pg = kPage(route.kept);
  pg.top = el.scrollTop; pg.atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}, true);
document.addEventListener('pointerdown', e => {  // (the side panel's edge, dragged)
  if (e.button !== 0 || !e.target.closest || !e.target.closest('#kpEdge')) return;
  e.preventDefault();
  const kp = $('#kp'), right = kp.getBoundingClientRect().right;
  const move = ev => kInfoW(right - ev.clientX);
  const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); kp.classList.remove('sizing'); if (typeof fitTerm === 'function') fitTerm(); };
  kp.classList.add('sizing');
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
});
document.addEventListener('dblclick', e => { if (e.target.closest && e.target.closest('#kpEdge')) { store.set('deck.kInfoW', 0); kInfoW(); } });
window.addEventListener('resize', () => kInfoW());

// (the sidebar's place in the frame; folded, it is a strip of marks, and ⌘B folds and opens it)
(function () {
  const app = document.querySelector('.app');
  app.insertAdjacentHTML('afterbegin', `<nav class="ks" id="ks" aria-label="${tt('会话', 'Sessions')}"></nav>`);
  PHONE.addEventListener('change', () => { for (const k in sig) delete sig[k]; route = parseRoute(); build(); render(); });
  setInterval(() => {
    if (phone() || document.hidden || route.name !== 'session' || !route.kept || (route.tab || 'chat') !== 'chat' || !$('#convo')) return;
    const k = kOf(route.kept);
    if (k) kDrawChat(k, kLive(k));
  }, 350);
  document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') setTimeout(render, 0); });
  for (const k in sig) delete sig[k];
  route = parseRoute();
  build();
  render();
})();
