// Sturnus — the page's frame since sessions last (the deck's kept.py): loaded after app.js, whose pages it keeps.
// One sidebar: a new session, search, the places (what needs you, tasks, discussions, …), then the sessions — the
// person's own, running or stopped — by workspace, or as one list. Beside it: the new-session page, which is also the
// first page (#/); a session (#/k/<id>): its conversations one after another with a line where its terminal changed,
// words for it, and what it is and has run in on the right; a workspace (#/w/<id>): its sessions, tasks, discussions
// and folders; every session, the archived too (#/all). A phone keeps the pages app.js draws for it.
'use strict';
const OLD = { parseRoute, build, render, drawRail, drawSide, palPlaces, palItems, drawSettings };
const KV = { view: store.get('deck.kView', 'space'), open: new Set(store.get('deck.kOpen', [])), places: store.get('deck.kPlaces', false), info: store.get('deck.kInfo', true),
  full: {}, all: null, allAt: 0, chatAt: 0, menu: false, rename: false, blind: !S, spTab: {}, allShow: 'open', allQ: '', hand: null, hits: [], hitsQ: '', hitsT: 0 };
const KN = { kind: store.get('deck.newKind', 'claude'), space: store.get('deck.kSpace', null), dir: '' };  // (space: null until the person has picked one, or none)
const KI = {
  side: '<svg viewBox="0 0 20 20"><rect x="3.5" y="4.5" width="13" height="11" rx="2"/><path d="M8 4.5v11"/></svg>',
  find: '<svg viewBox="0 0 20 20"><circle cx="8.8" cy="8.8" r="5.6"/><path d="m13 13 4 4"/></svg>',
  bell: '<svg viewBox="0 0 20 20"><path d="M5 8.2a5 5 0 0 1 10 0c0 3.6 1.6 4.8 1.6 4.8H3.4S5 11.8 5 8.2M8.4 15.5a1.7 1.7 0 0 0 3.2 0"/></svg>',
  pin: '<svg viewBox="0 0 20 20"><path d="M7.5 3.5h5l-.8 5 2.5 2.5H5.8l2.5-2.5zM10 11v5.5"/></svg>',
  dots: '<svg viewBox="0 0 20 20"><path d="M5 10h.01M10 10h.01M15 10h.01" stroke-width="2.6"/></svg>',
  copy: '<svg viewBox="0 0 20 20"><rect x="7.5" y="7.5" width="8" height="8" rx="1.6"/><path d="M4.5 12.5V6A1.5 1.5 0 0 1 6 4.5h6.5"/></svg>',
  play: '<svg viewBox="0 0 20 20"><path d="M7.5 5v10l8-5z"/></svg>',
  gear: '<svg viewBox="0 0 20 20"><path d="M8.6 2.8h2.8l.4 2 1.6.9 1.9-.7 1.4 2.4-1.5 1.3v1.8l1.5 1.3-1.4 2.4-1.9-.7-1.6.9-.4 2H8.6l-.4-2-1.6-.9-1.9.7-1.4-2.4 1.5-1.3V9.1L3.3 7.8l1.4-2.4 1.9.7 1.6-.9z"/><circle cx="10" cy="10" r="2.3"/></svg>',
  x: '<svg viewBox="0 0 20 20"><path d="m5.5 5.5 9 9M14.5 5.5l-9 9"/></svg>',
};
const KWAY = { 'zellij-tab': ['Zellij：工作区那一组里的一个标签', 'Zellij: a tab in the workspace’s group'], 'tmux-window': ['tmux：工作区那一组里的一个窗口', 'tmux: a window in the workspace’s group'],
  'tmux-own': ['tmux：每条会话一个自己的 tmux 会话', 'tmux: a tmux session of its own for each session'] };
const KWHY = { restart: ['机器重启', 'the machine restarted'], closed: ['它的终端被关掉了', 'its terminal was closed'], exited: ['agent 退出了，窗格还在', 'the agent quit, its pane is still there'],
  moved: ['换到了另一个窗格', 'it moved to another pane'], stopped: ['你停了它', 'you stopped it'], ended: ['终端结束了', 'its terminal ended'] };

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
function kRoute(kid, tab, lid) { return { name: 'session', kept: kid, id: lid || '', tab: tab || 'chat' }; }
window.parseRoute = function () {
  const h = location.hash.replace(/^#/, '');
  KV.blind = !S;  // (read before the first look at the deck: read again once it is there)
  let m;
  if (phone()) return OLD.parseRoute();
  if (h === '/need') return { name: 'need' };
  if (h === '/all') return { name: 'all' };
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
  const when = need ? { blocked: tt('卡住', 'Stuck'), review: tt('待验收', 'Review') }[st] || tt('等你', 'You') : ago(s ? s.at || s.since : k.at);
  return `<a class="ks-row${on ? ' on' : ''}${two ? ' two' : ''}" href="${kHref(k)}" title="${esc(kTitle(k))} · ${esc(FULL[k.kind] || k.kind)} · ${esc(kStand(k)[1])}">${mark(k.kind, st, 'xs')}
    <span class="t"><span>${esc(kTitle(k))}</span>${two ? `<small>${esc(sp ? sp.name : tt('未归入工作区', 'In no workspace'))}</small>` : ''}</span><span class="w${need ? ' need' : ''}">${esc(when)}</span></a>`;
}
function kGroup(key, head, rows) {
  rows = rows.slice().sort(kOrder);
  const liveN = rows.filter(k => k.live).length, cap = Math.max(liveN, 6), open = KV.open.has(key);
  const shown = open ? rows : rows.slice(0, cap);
  return `<div class="ks-g">${head}${shown.map(k => kRow(k)).join('')}${rows.length > cap ? `<button class="ks-more" data-kopen="${esc(key)}">${chev(open)}${open ? tt('收起', 'Fold') : tt(`还有 ${rows.length - cap} 条`, `${rows.length - cap} more`)}</button>` : ''}</div>`;
}
function kDrawSide() {
  const kept = (S.kept || []).filter(k => !k.archived), spaces = (S.spaces || []).filter(w => !w.archived);
  const need = S.sessions.filter(attention).length + (S.inbox || []).length + (S.lock_issues || []).length;
  const boards = Object.values(S.boards || {}), bNew = boards.reduce((n, b) => n + (b.unread || 0), 0), bCalls = boards.reduce((n, b) => n + (b.calls || 0), 0);
  const tNeed = (S.tasks || []).filter(x => x.shown === 'needs').length, qReady = (S.queue || []).filter(i => i.status === 'ready').length;
  const off = Date.now() - lastOk > 6000;
  draw('ks', [route, KV.view, [...KV.open], KV.places, kept.map(k => [k.id, kTitle(k), k.space, k.pinned, k.live, k.kind, kStand(k)[0]]), spaces.map(w => [w.id, w.name, w.places.length]),
    need, bNew, bCalls, tNeed, qReady, off, S.version, Math.floor(Date.now() / 60000), LANG, document.documentElement.dataset.theme], () => {
    const at = route.name, nav = (href, on, icon, label, n, hot) => `<a href="${href}" class="${on ? 'on' : ''}">${icon}<span>${label}</span>${n ? `<span class="n${hot ? ' hot' : ''}">${big(n)}</span>` : ''}</a>`;
    const pinned = kept.filter(k => k.pinned).sort(kOrder), rest = kept.filter(k => !k.pinned);
    let list;
    if (KV.view === 'flat') {
      list = (pinned.length ? `<div class="ks-g"><div class="ks-sub">${tt('置顶', 'Pinned')}</div>${pinned.map(k => kRow(k, true)).join('')}</div>` : '')
        + `<div class="ks-g"><div class="ks-sub">${tt('运行中的在前，其余按最近', 'Running first, then the latest')}</div>${rest.slice().sort(kOrder).slice(0, KV.open.has('~flat') ? 400 : 40).map(k => kRow(k, true)).join('')}
          ${rest.length > 40 ? `<button class="ks-more" data-kopen="~flat">${chev(KV.open.has('~flat'))}${KV.open.has('~flat') ? tt('收起', 'Fold') : tt(`还有 ${rest.length - 40} 条`, `${rest.length - 40} more`)}</button>` : ''}</div>`;
    } else {
      const none = rest.filter(k => !kSpace(k.space) || kSpace(k.space).archived);
      list = (pinned.length ? `<div class="ks-g"><div class="ks-sub">${tt('置顶', 'Pinned')}</div>${pinned.map(k => kRow(k)).join('')}</div>` : '')
        + spaces.slice().sort((a, b) => (b.live > 0) - (a.live > 0) || a.name.localeCompare(b.name)).map(w => kGroup(w.id, `<div class="ks-gh"><span class="ks-tile">${esc(w.name.slice(0, 1).toUpperCase())}</span>
            <a class="nm" href="#/w/${encodeURIComponent(w.id)}" title="${esc(w.places.map(p => p.show).join('\n'))}">${esc(w.name)}</a>
            <a class="ks-ib" href="#/" data-knew="${esc(w.id)}" title="${tt(`在 ${w.name} 里开新会话`, `New session in ${w.name}`)}" aria-label="${tt(`在 ${w.name} 里开新会话`, `New session in ${w.name}`)}">${I.plus}</a></div>`, rest.filter(k => k.space === w.id))).join('')
        + (none.length ? kGroup('~none', `<div class="ks-gh"><span class="ks-tile none"></span><span class="nm">${tt('未归入工作区', 'In no workspace')}</span></div>`, none) : '');
    }
    $('#ks').innerHTML = `<div class="ks-brand"><a href="#/" class="ks-logo" aria-label="Sturnus"><img class="logo" src="icon.svg" alt=""><b>Sturnus</b></a>
        <button class="ks-ib" id="ksFold" title="${tt('收起侧栏（⌘B）', 'Hide the sidebar (⌘B)')}" aria-label="${tt('收起侧栏', 'Hide the sidebar')}">${KI.side}</button></div>
      <div class="ks-top"><a class="ks-new${at === 'home' ? ' on' : ''}" href="#/">${I.plus}<span>${tt('新会话', 'New session')}</span><kbd>N</kbd></a>
        <button class="ks-find" id="ksFind">${KI.find}<span>${tt('搜索会话、工作区', 'Search sessions, workspaces')}</span><kbd>⌘K</kbd></button></div>
      <nav class="ks-nav">${nav('#/need', at === 'need', KI.bell, tt('等你处理', 'Needs you'), need, true)}${nav('#/tasks', at === 'tasks', I.check, tt('任务', 'Tasks'), tNeed, true)}${nav('#/boards', at === 'boards' || at === 'board', I.chat, tt('讨论', 'Discussions'), bCalls || bNew, bCalls > 0)}
        ${KV.places || ['talk', 'reports', 'queue'].includes(at) ? nav('#/talk', at === 'talk', I.mail, tt('消息', 'Messages')) + nav('#/reports', at === 'reports', I.doc, tt('报告', 'Reports')) + nav('#/queue', at === 'queue', I.list, tt('排队', 'Queue'), qReady, true) : ''}
        <button class="ks-more" data-kplaces>${chev(KV.places)}${KV.places ? tt('收起', 'Fold') : tt('消息、报告、排队', 'Messages, reports, queue')}</button></nav>
      <div class="ks-h"><span>${tt('会话', 'Sessions')}</span><div class="ks-seg" role="group" aria-label="${tt('会话怎么排', 'How sessions are listed')}"><button data-kview="space" class="${KV.view === 'space' ? 'on' : ''}">${tt('按工作区', 'By workspace')}</button><button data-kview="flat" class="${KV.view === 'flat' ? 'on' : ''}">${tt('不分组', 'One list')}</button></div></div>
      <div class="ks-list" id="ksList">${list}
        <a class="ks-more" href="#/w/+">${I.plus}${tt('新建工作区', 'New workspace')}</a>
        <a class="ks-more${at === 'all' ? ' on' : ''}" href="#/all">${I.list}${tt('查看全部会话和已归档的', 'All sessions, and the archived')}</a></div>
      <div class="ks-foot"><span class="ks-conn${off ? ' off' : ''}"><i></i>${off ? tt('连接中断，重试中', 'Reconnecting') : tt('实时', 'Live')}</span><span class="v">${esc(S.version || '')}</span>
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
    <form class="kn-box" id="knForm" autocomplete="off"><textarea id="knText" rows="3" aria-label="${tt('这条会话要做的事', 'What this session is to do')}" placeholder="${tt('说说这条会话要做的事（也可以先不说，开起来再讲）', 'Say what this session is to do (or leave it empty and say it once it is up)')}"></textarea>
      <div class="kn-row" id="knRow"></div></form>
    <div class="kn-opts" id="knOpts"></div><div id="knRecover"></div>
    <section class="entry"><div class="h-title"><h2>${tt('等你处理', 'Needs you')}</h2><span class="sub" id="attnSub"></span></div><div id="attn"></div></section>
  </div></div>`;
  $('#knForm').addEventListener('submit', e => { e.preventDefault(); kStart(); });
  $('#knText').addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); kStart(); } });
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
  draw('knopts', [KN.kind, kinds, S.terminal, LANG], () => {
    const way = (S.terminal || {}).way;
    $('#knOpts').innerHTML = `<span class="l">${tt('用哪个', 'With')}</span><div class="kn-ch">${kinds.map(k => `<button type="button" data-knkind="${k}" aria-pressed="${KN.kind === k}" class="${KN.kind === k ? 'on' : ''}">${mark(k, '', 'xs')}${FULL[k]}</button>`).join('')}
        <span class="hint">${tt('各自用自己的命令行和登录，Sturnus 不代它们说话', 'Each runs its own CLI with its own sign-in; Sturnus never speaks for them')}</span></div>
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
  const j = await kDo('new', { kind: KN.kind, cwd, prompt: $('#knText').value.trim(), space: sp ? sp.id : '' });
  if ($('#knGo')) $('#knGo').disabled = false;
  if (!j.ok) return;
  store.set('deck.newKind', KN.kind); store.set('deck.kSpace', KN.space); if (other) store.set('deck.newCwd', cwd);
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
  sessTab = route.tab;
  KV.menu = KV.rename = false;
  KV.chatAt = 0;
  $('#view').innerHTML = `<div class="kp${KV.info ? '' : ' no-info'}" id="kp"><section class="kp-main"><header class="kp-head" id="kpHead"></header>
    <div class="kp-scroll" id="sess"><div id="hero" hidden></div><div id="tabBody"></div></div><footer class="kp-foot" id="kpFoot"></footer></section>
    <aside class="kp-info" id="kpInfo" aria-label="${tt('会话信息', 'About this session')}"></aside></div>`;
}
function kDrawKept() {
  const k = kOf(route.kept), f = KV.full[route.kept];
  if (!k) {
    if (!f || (!f.missing && !f.kept)) kFull(route.kept);
    draw('khead', ['none', f && f.missing], () => { $('#kpHead').innerHTML = `<div class="kh-l"><h1>${f && f.missing ? tt('找不到这条会话', 'Session not found') : tt('读取中……', 'Loading…')}</h1></div>`; $('#tabBody').innerHTML = f && f.missing ? `<div class="s-body"><a class="btn" href="#/">${I.back}${tt('回到首页', 'Back to the first page')}</a></div>` : ''; });
    return;
  }
  kFull(k.id, k);
  const s = kLive(k), up = s && !s.starting, tab = up ? route.tab : 'chat', kind = FULL[k.kind] ? k.kind : 'codex';
  route.id = s ? s.id : '';
  $('#kp').className = `kp tab-${tab}${KV.info ? '' : ' no-info'}`;
  kDrawHead(k, s, tab);
  if (tab === 'chat') kDrawChat(k, s);
  else if (tab === 'overview') drawOverview(s, kind);
  else if (tab === 'report') drawReport(s);
  else if (tab === 'term') drawTerm(s);
  else drawMsgs(s);
  kDrawFoot(k, s, tab);
  kDrawInfo(k, s);
}
function kDrawHead(k, s, tab) {
  if (document.activeElement && document.activeElement.id === 'kTitle') return;
  const [st, label] = kStand(k), sp = kSpace(k.space), up = s && !s.starting;
  draw('khead', [k.id, kTitle(k), st, label, k.pinned, k.archived, tab, up, sp && [sp.id, sp.name], k.kind, k.folder, k.branch, KV.info, KV.menu, KV.rename, LANG], () => {
    const tabs = [['chat', tt('对话', 'Conversation')], ['overview', tt('概览', 'Overview')], ['report', tt('报告', 'Report')], ['term', tt('终端', 'Terminal')], ['msgs', tt('消息', 'Messages')]];
    $('#kpHead').innerHTML = `<div class="kh-l">${KV.rename ? `<input class="field" id="kTitle" value="${esc(k.title || kTitle(k))}" aria-label="${tt('会话的名字', 'Session title')}" placeholder="${tt('留空：回到自动起的名字', 'Empty: back to the name it is given')}">`
        : `<h1 data-krename title="${tt('点一下改名', 'Click to rename')}">${esc(kTitle(k))}</h1>`}
        <div class="sub">${mark(k.kind, '', 'xs')}<span>${esc(FULL[k.kind] || k.kind)}</span><i>·</i>${sp ? `<a href="#/w/${encodeURIComponent(sp.id)}">${esc(sp.name)}</a>` : `<span>${tt('未归入工作区', 'In no workspace')}</span>`}<i>·</i><span class="mono" title="${esc(k.show)}">${esc(folder(k.folder))}${k.branch ? ' / ' + esc(k.branch) : ''}</span></div></div>
      <div class="r"><span class="kchip ${st}"><i></i>${esc(k.archived ? tt('已归档', 'Archived') : label)}</span>
        ${!s && !k.archived ? `<button class="btn primary" data-kresume>${KI.play}${tt('继续', 'Go on')}</button>` : ''}
        ${up ? `<nav class="seg ktabs">${tabs.map(([x, l]) => `<a href="${kHref(k)}${x === 'chat' ? '' : '/' + x}" class="${tab === x ? 'on' : ''}">${l}</a>`).join('')}</nav>` : ''}
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
  return `<div class="kdiv"><span><b>${tt('换了终端', 'Another terminal')}</b>${esc(kDay(t0.began))}${prev && prev.why ? tt(`，${KWHY[prev.why] ? KWHY[prev.why][0] : prev.why}`, `, ${KWHY[prev.why] ? KWHY[prev.why][1] : prev.why}`) : ''}${tt(`；在第 ${t0.n} 个终端（${kMux(t0)}）里接着做`, `; going on in terminal ${t0.n} (${kMux(t0)})`)}</span></div>`;
}
function kSegLine(seg) {
  if (!seg || !['clear', 'handover'].includes(seg.how)) return '';
  return `<div class="kdiv"><span>${seg.how === 'clear' ? `<b>${tt('清空了对话', 'Conversation cleared')}</b>${tt('上面的不再在它的上下文里，记录都还在', 'What is above is out of its context; the record is all here')}` : `<b>${tt(`换成 ${FULL[seg.kind] || seg.kind} 继续`, `${FULL[seg.kind] || seg.kind} takes it on`)}</b>`}</span></div>`;
}
function kChatHtml(k, items, full) {
  const terms = (full.terms || []).slice().sort((a, b) => a.n - b.n), segs = full.segs || [];
  const at = it => (it.at ? (typeof it.at === 'string' ? Date.parse(it.at) / 1000 : it.at) : 0);
  let out = '', ti = 0, seg = null, tools = [];
  const first = items.length ? at(items[0]) : 0;
  while (ti < terms.length && (terms[ti].n === 1 || (first && terms[ti].began <= first))) ti++;  // (the first terminal changed nothing; one from before what is shown is above it)
  const flush = () => { if (!tools.length) return; out += `<details class="ktools"><summary>${chev(false)}${tt(`做了 ${tools.length} 步`, `${tools.length} step${tools.length > 1 ? 's' : ''}`)}</summary>${tools.map(x => `<div class="bub tool">${esc(x.text)}</div>`).join('')}</details>`; tools = []; };
  for (const it of items) {
    const a = at(it);
    while (ti < terms.length && a && terms[ti].began <= a) { flush(); out += kTermLine(terms, ti++); }
    if (seg !== null && it.seg !== seg) { flush(); out += kSegLine(segs.find(x => x.n === it.seg)); }
    seg = it.seg;
    if (it.who === 'tool') { tools.push(it); continue; }
    flush();
    out += `<div class="bub ${it.who}${it.who === 'assistant' ? ' ' + (it.kind || k.kind) : ''}">${md(it.text)}${it.at ? `<time>${clock(it.at)}</time>` : ''}</div>`;
  }
  flush();
  while (ti < terms.length) out += kTermLine(terms, ti++);
  const last = terms[terms.length - 1];
  if (last && last.ended && !k.live) out += `<div class="kdiv"><span><b>${tt('终端结束了', 'Its terminal ended')}</b>${esc(kDay(last.ended))}${tt(`，${(KWHY[last.why] || KWHY.ended)[0]}。对话都还在`, `, ${(KWHY[last.why] || KWHY.ended)[1]}. The conversation is all here`)}</span></div>`;
  return out || `<div class="hint">${k.live ? tt('还没有说过话。', 'Nothing said yet.') : tt('读不到它的对话记录。', 'Its conversation cannot be read.')}</div>`;
}
async function kDrawChat(k, s) {
  if (sig.kcFor !== k.id) { sig.kcFor = k.id; sig.kc = null; KV.chatAt = 0; $('#tabBody').innerHTML = `<div class="kc convo" id="convo"><div class="hint">${tt('读取对话……', 'Reading the conversation…')}</div></div>`; }
  if (Date.now() - KV.chatAt < (s && s.state === 'working' ? 3000 : 6000)) return;
  KV.chatAt = Date.now();
  try {
    const j = await (await fetch('/api/transcript?kept=' + encodeURIComponent(k.id), { cache: 'no-store' })).json();
    const items = j.items || [], full = (KV.full[k.id] || {}).kept || {};
    if (route.kept !== k.id || !$('#convo')) return;
    draw('kc', [k.id, items.length, items.length && items[items.length - 1].text.slice(0, 60), (full.terms || []).map(t => [t.n, t.ended, t.why]), (full.segs || []).length, k.live, LANG], () => {
      const sess = $('#sess'), atEnd = sess.scrollHeight - sess.scrollTop - sess.clientHeight < 80;
      const openTools = [...document.querySelectorAll('#convo .ktools')].map(d => d.open);
      $('#convo').innerHTML = kChatHtml(k, items, full);
      document.querySelectorAll('#convo .ktools').forEach((d, i) => { if (openTools[i]) d.open = true; });
      if (atEnd || sig.kcFirst !== k.id) { sig.kcFirst = k.id; sess.scrollTop = sess.scrollHeight; }
    });
  } catch {}
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
        <div class="reply"><textarea id="kText" aria-label="${tt('对这条会话说话', 'Words for this session')}" placeholder="${tt('直接说下一步也行：发送后先新开终端，再接着做  ⌘/Ctrl+Enter', 'Or just say what is next: it gets a new terminal first, then goes on  ⌘/Ctrl+Enter')}"></textarea>
          <div class="row">${micBtn('kText')}<span class="sp"></span><button class="btn primary" data-kresume="say">${I.arrow}${tt('发送并继续', 'Send and go on')}</button></div></div>`;
  });
  if (mode === 'live') drawSay(s);
}
function kDrawInfo(k, s) {
  const box = $('#kpInfo');
  if (!box || !KV.info || (document.activeElement && box.contains(document.activeElement))) return;
  const full = (KV.full[k.id] || {}).kept, sp = kSpace(k.space), a = s && attention(s);
  const tasks = (S.tasks || []).filter(x => taskOpen(x) && x.sessions.some(l => (s && l.sid === s.id) || (k.name && l.name === k.name)));
  const kids = s ? kidsOf(s).length + (s.subs || []).length : 0, terms = full ? (full.terms || []).slice().sort((x, y) => y.n - x.n) : [];
  draw('kinfo', [k.id, k.space, k.spaced, k.kind, k.show, k.branch, k.name, k.note, k.conv, a, s && [s.id, s.summary, needOf(s), asksSig(s), kids, s.loc], tasks.map(x => [x.id, x.title]),
    (S.spaces || []).map(w => [w.id, w.name]), terms.map(t => [t.n, t.ended, t.why, t.pane]), full && (full.segs || []).length, Math.floor(Date.now() / 60000), LANG], () => {
    const title = kTitle(k), cmd = `sturnus open ${/^[^\s"'$`\\!]+$/.test(title) ? title : /["$`\\!]/.test(title) ? k.id : `"${title}"`}`;
    const open = terms.find(t => !t.ended);
    box.innerHTML = (a ? `<div class="need-box ${ATT[a][1]}"><div class="k">${standing(s)[0] === 'asking' ? t('工作中 · 等你确认') : t(ATT[a][0])}</div><p>${esc(needOf(s) || s.summary || (s.prompting ? tt('它停在终端里的一个提示上：进终端看一眼。', 'It is stopped at a prompt in its terminal: take a look there.') : ''))}</p></div>` : '')
      + `<section><h3>${tt('这条会话', 'This session')}</h3><dl class="kv">
          <dt>${tt('工作区', 'Workspace')}</dt><dd><select class="sel" data-kspace="${esc(k.id)}" aria-label="${tt('它在哪个工作区', 'Which workspace it is in')}"><option value="">${k.spaced ? tt('改回按目录归', 'Back to where its folder puts it') : esc(sp ? sp.name : tt('未归入（目录不在任何工作区里）', 'None (its folder is in no workspace)'))}</option>
            ${(S.spaces || []).filter(w => !w.archived).map(w => `<option value="${esc(w.id)}"${k.spaced && k.space === w.id ? ' selected' : ''}>${tt('放到 ', 'Put in ')}${esc(w.name)}</option>`).join('')}</select></dd>
          <dt>Agent</dt><dd>${esc(FULL[k.kind] || k.kind)}</dd>
          <dt>${tt('目录', 'Folder')}</dt><dd class="mono">${esc(k.show)}</dd>
          ${k.branch ? `<dt>${tt('分支', 'Branch')}</dt><dd class="mono">${esc(k.branch)}</dd>` : ''}
          ${k.name ? `<dt>${tt('名字', 'Name')}</dt><dd class="mono" title="${tt('会话之间写信用的名字', 'Its name when sessions write to each other')}">${esc(k.name)}</dd>` : ''}
          ${tasks.length ? `<dt>${tt('任务', 'Tasks')}</dt><dd>${tasks.map(x => `<a data-task="${esc(x.id)}">${esc(x.title)}</a>`).join('<br>')}</dd>` : ''}</dl></section>`
      + (s && s.summary ? `<section><h3>${tt('现在在做', 'Doing now')}</h3><p class="now">${esc(s.summary)}</p></section>` : !s && k.note ? `<section><h3>${tt('停下时在做', 'Doing when it stopped')}</h3><p class="now">${esc(k.note)}</p></section>` : '')
      + (s && ((s.asks || []).length || (S.inbox || []).some(m => m.from === s.name)) ? asksPanel(s) : '')
      + (kids ? `<section><h3>${tt('它启动的子 agent', 'Sub-agents it started')}</h3><a class="lnk" href="${kHref(k)}/overview">${tt(`${kids} 个，在概览里看`, `${kids}, on the overview`)}</a></section>` : '')
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
  KV.chatAt = 0;
}

// ---------- a workspace ----------
function kBuildSpace() {
  if (route.key === '+') {
    $('#view').innerHTML = `<div class="page narrow"><div class="h-title"><h2>${tt('新建工作区', 'New workspace')}</h2><span class="sub">${tt('一个名字，加上它管的目录。在这些目录里开的会话自动归到它下面。', 'A name, and the folders it covers. Sessions opened in those folders are in it.')}</span></div>
      <form class="wk-new" id="spNew" autocomplete="off"><label><span>${tt('名字', 'Name')}</span><input class="field" id="spName" placeholder="${tt('比如 Sturnus', 'Sturnus, say')}"></label>
        <label><span>${tt('第一个目录', 'Its first folder')}</span><input class="field" id="spPath" list="spDirs" placeholder="~/projects/…"><datalist id="spDirs">${((S && S.dirs) || []).map(d => `<option value="${esc(d)}">`).join('')}</datalist></label>
        <div class="row"><span class="hint">${tt('目录以后还能加、能拿掉；远程存储以后再支持。', 'Folders can be added and taken out later; remote storage comes later.')}</span><button class="btn primary" type="submit">${tt('建好', 'Create')}</button></div></form></div>`;
    $('#spNew').addEventListener('submit', async e => {
      e.preventDefault();
      const j = await kDo('space', { do: 'add', name: $('#spName').value.trim(), paths: [$('#spPath').value.trim()].filter(Boolean) });
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
            <button class="ks-ib" data-spdrop="${esc(p.path)}" title="${tt('把这个目录从工作区里拿掉', 'Take this folder out of the workspace')}" aria-label="${tt(`把 ${p.show} 从工作区里拿掉`, `Take ${p.show} out of the workspace`)}">${KI.x}</button></div>`).join('')}
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
  else OLD.build();
};
window.render = function () {
  if (!S) return;
  if (phone()) return OLD.render();
  if (KV.blind) { KV.blind = false; for (const k in sig) delete sig[k]; route = parseRoute(); build(); }
  kDrawSide();
  const r = route;
  if (r.name === 'home') kDrawHome();
  else if (r.name === 'need') { drawAttn(''); drawTodoProjects((S.workspaces || []).flatMap(w => w.projects.filter(k => S.sessions.some(s => s.project === k)))); }
  else if (r.name === 'session' && r.kept) kDrawKept();
  else if (r.name === 'space') kDrawSpace();
  else if (r.name === 'all') kDrawAll();
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
  if (pane !== 'terminal') return OLD.drawSettings();
  document.querySelectorAll('#settingsNav button').forEach(b => b.classList.toggle('on', b.dataset.pane === pane));
  const cur = (S.terminal || {}).way, usable = (S.terminal || {}).usable || [];
  $('#settingsBody').innerHTML = `<h3>${tt('终端', 'Terminals')}</h3>
    <p class="lead">${tt('一条会话在自己的终端里跑。这里定的是新终端怎么开：新会话、和停下的会话「继续」时，都按这个来。会话比终端活得久，所以随时可以换：已经开着的不动，下一个终端起按新的方式。', 'A session runs in a terminal of its own. This is how a new one is opened, for a new session and when a stopped one goes on. A session outlasts its terminals, so this can change at any time: those open stay as they are, and the next one opens the new way.')}</p>
    <div class="choice kway">${Object.keys(KWAY).map(w => `<button type="button" data-kway="${w}" class="${cur === w ? 'on' : ''}" ${usable.includes(w) ? '' : 'disabled'}><div><b>${esc(tt(...KWAY[w]))}</b>
      <span>${usable.includes(w) ? { 'zellij-tab': tt('组的名字取自工作区；zellij attach <组> 能看到这个工作区的所有会话', 'The group is named after the workspace; zellij attach <group> shows all its sessions'), 'tmux-window': tt('组的名字取自工作区；tmux attach -t <组> 能看到这个工作区的所有会话', 'The group is named after the workspace; tmux attach -t <group> shows all its sessions'), 'tmux-own': tt('每条会话自己一个 tmux 会话（st-…），进出互不影响', 'Each session has a tmux session to itself (st-…)') }[w] : tt('这台机器上没装它', 'Not installed on this machine')}</span></div></button>`).join('')}</div>
    <p class="hint">${tt('在这台机器的终端里：sturnus ls 列出会话，sturnus open 编号或名字 进到那条会话的终端。', 'In a terminal on this machine: sturnus ls lists the sessions, sturnus open NUMBER or TITLE goes to that session’s terminal.')}</p>`;
};

// ---------- what is clicked, typed, changed ----------
document.addEventListener('click', async e => {
  if (phone()) return;
  const q = sel => e.target.closest(sel);
  let el;
  const cur = () => kOf((el && el.dataset.kid) || route.kept);
  if (KV.menu && !q('.kmenu')) { KV.menu = false; delete sig.khead; render(); }
  if (q('#ksFold')) { setSide(true); kShowBtn(); return; }
  if (q('#ksShow')) { setSide(false); kShowBtn(); return; }
  if (q('#ksFind')) { openPalette(); return; }
  if (q('#ksAsst')) { asstToggle(); return; }
  if (q('#ksSet')) { openSettings(); return; }
  if (q('#ksTheme')) { const o = ['auto', 'light', 'dark'], v = store.get('deck.theme', 'auto'); store.set('deck.theme', o[(o.indexOf(v) + 1) % 3]); applyTheme(); render(); return; }
  if ((el = q('[data-kview]'))) { KV.view = el.dataset.kview; store.set('deck.kView', KV.view); render(); return; }
  if ((el = q('[data-kopen]'))) { const x = el.dataset.kopen; KV.open.has(x) ? KV.open.delete(x) : KV.open.add(x); store.set('deck.kOpen', [...KV.open]); render(); return; }
  if (q('[data-kplaces]')) { KV.places = !KV.places; store.set('deck.kPlaces', KV.places); render(); return; }
  if ((el = q('[data-knew]'))) { KN.space = el.dataset.knew; KN.dir = ''; delete sig.knrow; setTimeout(render, 0); return; }  // (its link goes to the new-session page)
  if ((el = q('[data-kway]'))) { await kDo('terminal', { way: el.dataset.kway }); drawSettings(); return; }
  if ((el = q('[data-knkind]'))) { KN.kind = el.dataset.knkind; render(); return; }
  if ((el = q('[data-kset]'))) { pane = el.dataset.kset; openSettings(); return; }
  if ((el = q('[data-kcopy]'))) { toClipboard(el.dataset.kcopy); toast(tt('已复制', 'Copied')); return; }
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
  if ((el = q('[data-spmain]'))) { await kDo('space', { do: 'place_main', id: route.key, path: el.dataset.spmain }); return; }
  if ((el = q('[data-spdrop]'))) { if (confirm(tt('把这个目录从工作区里拿掉？磁盘上什么都不动；开在里面的会话会变成「未归入工作区」。', 'Take this folder out of the workspace? Nothing on disk is touched; sessions opened in it are then in no workspace.'))) await kDo('space', { do: 'place_drop', id: route.key, path: el.dataset.spdrop }); return; }
  if (q('[data-spdel]')) { const sp = kSpace(route.key); if (sp && confirm(tt(`删除工作区「${sp.name}」？只删这个分组：目录、会话和对话都留着。`, `Delete workspace “${sp.name}”? Only the grouping goes: folders, sessions and conversations stay.`))) { const j = await kDo('space', { do: 'delete', id: sp.id }); if (j.ok) location.hash = '#/'; } return; }
  if (q('[data-act="say"], [data-act="say-now"]')) { setTimeout(() => { KV.chatAt = 0; render(); }, 1600); }  // (app.js sends the words; what it then says is read soon)
}, true);
document.addEventListener('change', async e => {
  if (phone()) return;
  if (e.target.id === 'knSpace') { KN.space = e.target.value; KN.dir = ''; delete sig.knrow; render(); if ($('#knText')) $('#knText').focus(); }
  if (e.target.id === 'knDir') { KN.dir = e.target.value; delete sig.knrow; render(); }
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
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && el.id === 'kText') { e.preventDefault(); const k = kOf(route.kept); if (k) kResume(k, true); return; }
  if (e.key === 'Escape' && KV.menu) { KV.menu = false; delete sig.khead; render(); e.stopImmediatePropagation(); return; }
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

// (the sidebar's place in the frame; with it hidden, a button at the corner brings it back, as ⌘B does)
function kShowBtn() { const b = $('#ksShow'); if (b) b.hidden = !sideOff || phone(); }
(function () {
  const app = document.querySelector('.app');
  app.insertAdjacentHTML('afterbegin', `<nav class="ks" id="ks" aria-label="${tt('会话', 'Sessions')}"></nav>`);
  app.insertAdjacentHTML('beforeend', `<button class="ks-show" id="ksShow" hidden title="${tt('展开侧栏（⌘B）', 'Show the sidebar (⌘B)')}" aria-label="${tt('展开侧栏', 'Show the sidebar')}">${KI.side}</button>`);
  PHONE.addEventListener('change', () => { for (const k in sig) delete sig[k]; route = parseRoute(); build(); render(); kShowBtn(); });
  document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') setTimeout(kShowBtn, 0); });
  kShowBtn();
  for (const k in sig) delete sig[k];
  route = parseRoute();
  build();
  render();
})();
