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
function ago(ts) {
  if (!ts) return '';
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 45) return t('刚刚');
  if (s < 3600) return t('{n} 分钟', { n: Math.round(s / 60) });
  if (s < 86400) return t('{n} 小时', { n: Math.floor(s / 3600) });
  return t('{n} 天', { n: Math.floor(s / 86400) });
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
const clock = ts => {
  if (typeof ts === 'string') ts = Date.parse(ts) / 1000;
  if (!ts) return '';
  const d = new Date(ts * 1000), today = new Date().toDateString() === d.toDateString();
  return (today ? '' : `${d.getMonth() + 1}/${d.getDate()} `) + d.toLocaleTimeString(LANG === 'en' ? 'en-GB' : 'zh-CN', { hour: '2-digit', minute: '2-digit' });
};
const who = n => (n === 'user' ? t('你') : n);
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
  return `<span class="mark ${k === 'shell' ? 'sh' : k} ${size}" title="${esc(FULL[kind] || (kind === 'user' ? t('你') : kind || ''))}"><svg viewBox="0 0 24 24"${spin}>${MARK[kind] || ''}</svg>${state ? `<i class="sd ${state}"></i>` : ''}</span>`;
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
  if (s.state === 'gone') return ['gone', t('已离开')];
  if (s.state === 'ended') return ['ended', t('已结束')];
  const a = attention(s);
  if (a === 'decide') return ['waiting', t('等你')];
  if (a === 'blocked') return ['blocked', t('卡住')];
  if (a === 'review') return ['review', t('待验收')];
  if (s.state === 'working') return ['working', t('工作中')];
  return ['idle', t('空闲')];
}
const titleOf = s => s.title || (s.summary ? s.summary.split(/[，。；,;：:]/)[0].slice(0, 18) : '') || (s.unknown ? t('还认不出在做什么') : s.name);
// how words for a session get there (as the deck's say_how): typed when idle, held while it works, never into a prompt
const asking = s => ['AskUserQuestion', 'ExitPlanMode'].includes(s.tool) && s.state === 'working' && (s.tool_at || 0) > (s.tool_end || 0);
const sayHow = s => (['gone', 'ended'].includes(s.state) ? 'gone' : s.prompting || asking(s) ? 'menu' : !s.loc ? 'mail' : s.state === 'working' ? 'queue' : 'type');
const projOf = k => (S.projects || {})[k] || null;
const wsOf = k => (S.workspaces || []).find(w => w.key === k) || null;
const boardOf = k => (S.boards || {})[k] || null;
const live = s => !s.stale && !['gone', 'ended'].includes(s.state);

// ---------- language: the menus and navigation in Chinese or English (the Chinese is the key) ----------
const EN = { "总览": "Overview", "总览：所有工作区": "Overview: all workspaces", "讨论：所有讨论区": "Channels: all of them", "消息：会话之间的信": "Messages: mail between sessions", "报告：每个会话的简报": "Reports: a brief per session", "排队：等会话空了再发": "Queue: sent once a session is free", "所有工作区（还有 {n} 个安静的）": "All workspaces ({n} more, quiet)", "所有工作区": "All workspaces", "不在工作区里的会话": "Sessions in no workspace", "不在工作区里": "In no workspace", "（再点一下：收起或展开旁边那栏）": " (click again: fold or unfold the column)", "目录不在任何工作区里的会话": "sessions whose folder is in no workspace", "仪表盘": "Dashboard", "项目": "Projects", "工作项": "Work items", "讨论区": "Channel", "终端": "Terminal", "讨论": "Channels", "每个工作区、每个项目一个讨论区": "one per workspace and per project", "{name} 工作区": "{name} workspace", "消息": "Messages", "会话之间的信，和写给你的": "mail between sessions, and to you", "会话之间": "Between sessions", "与你有关": "To and from you", "报告": "Reports", "每个会话的简报": "a brief per session", "排队": "Queue", "等会话空了再发的事": "things to send once a session is free", "可以发了": "Ready to send", "排着": "Waiting", "已发出": "Sent", "不用发了": "Dropped", "{n} 个 · 有会话的在前": "{n} · busy ones first", "筛选工作区": "Filter workspaces", "有会话": "With sessions", "安静": "Quiet", "{n} 个会话": "{n} sessions", "没有这个名字的工作区": "No workspace by that name", "{a} 个工作区 · {b} 个会话": "{a} workspaces · {b} sessions", "等你": "Needs you", "工作中": "Working", "空闲": "Idle", "卡住": "Blocked", "待验收": "To review", "已离开": "Gone", "已结束": "Ended", "一天以上没动静 {n} 个": "{n} quiet for a day", "现在没有会话": "No sessions now", "工作区顶层": "workspace top", "概览": "Overview", "对话": "Conversation", "在终端里打开": "Open in terminal", "进入": "Enter", "让连着这个组的终端切到它": "Switch the attached terminal to it", "会话": "Sessions", "{n} 条新": "{n} new", "在这里新建会话": "New session here", "收起旁边那栏（⌘B）": "Fold the column (⌘B)", "展开旁边那栏（⌘B）": "Unfold the column (⌘B)", "设置": "Settings", "助手与模型": "Assistant & models", "语音输入": "Voice input", "显示": "Display", "访问": "Access", "关于": "About", "这台机器上的显示偏好。": "Display preferences on this machine.", "主题": "Theme", "跟随系统，或固定浅色、深色。": "Follow the system, or always light or dark.", "跟随系统": "System", "浅色": "Light", "深色": "Dark", "工作区图标": "Workspace marks", "最左边那条栏里工作区的颜色。": "The color of workspaces on the rail.", "石墨": "Graphite", "暗彩": "Muted colors", "石墨加色条": "Graphite with a stripe", "窗格标题": "Pane titles", "用「状态 · 会话名 · 在做的事」做每个 agent 窗格的标题，在 Zellij 或 tmux 里一眼认出是哪个（tmux 要开 pane-border-status 才看得到）。": "Title each agent pane \"state · name · what it does\", to tell them apart in Zellij or tmux (tmux shows them with pane-border-status).", "语言": "Language", "菜单和导航用的语言；页面内容暂时还是中文。": "The language of menus and navigation; page content is in Chinese for now.", "agent 的工作语言": "Agents’ working language", "总结、简报、助手的回答、帮你起草的话用哪种语言写。已经写好的，等它们下次更新时换过来。": "The language summaries, reports, the assistant’s answers and drafts are written in. Ones already written change at their next update.", "搜索工作区、项目、会话": "Search…", "新建会话": "New session", "新建会话（N）": "New session (N)", "实时": "Live", "连接中断，重试中": "Disconnected, retrying", "与本机 sturnus 服务的连接": "Connection to Sturnus on this machine", "主题：跟随系统": "Theme: system", "主题：浅色": "Theme: light", "主题：深色": "Theme: dark", "助手：问各个会话的事（⌘/Ctrl+J）": "Assistant: ask about the sessions (⌘/Ctrl+J)", "工作区、项目、会话的名字，任务，目录……": "Names of workspaces, projects, sessions; tasks; folders…", "选择": "select", "打开": "open", "关闭": "close", "没有匹配的工作区、项目或会话": "No matching workspace, project or session", "工作区 · {p}": "Workspace · {p}", "项目 · {w}": "Project · {w}", "总结模型出错，去设置里看看": "The summary model failed: see Settings", "总结：{m}": "Summaries: {m}", " · 正在更新": " · updating", "刷新于 {t}": "Refreshed {t}", "刚刚": "just now", "{t}前": "{t} ago", "{n} 分钟": "{n} min", "{n} 小时": "{n} h", "{n} 天": "{n} d", "工作区与全局入口": "Workspaces and global places", "Sturnus 总览": "Sturnus overview", "搜索会话": "Search" };
Object.assign(EN, {
"你": "You",
"还认不出在做什么": "Can’t tell yet what it is doing",
"在等": "Waiting",
"助手在看": "Assistant checking",
"先等等": "On hold",
"没连上 sturnus 服务：{m}": "Can’t reach the Sturnus service: {m}",
"有件事要做？写下来，选个项目，助手按各会话在做的事帮你挑交给谁，或者新开一个": "Something to get done? Write it down, pick a project, and the assistant picks who should take it from what each session is doing, or starts a new one",
"交给谁": "Who takes it",
"需要你": "Needs you",
"工作区": "Workspaces",
"进行中的工作": "Work in progress",
"有会话在上面、或者还没合进 main 的工作项": "work items with a session on them, or not yet merged into main",
"全部工作项": "All work items",
"会话在做什么": "What the sessions are doing",
"全部项目": "All projects",
"最近": "Recent",
"讨论区的新帖、记下的决定、产出": "new posts in channels, decisions noted, results",
"最左边只放有会话的和刚打开的；其余的在这里，⌘K 也能搜到": "The left rail shows only those with sessions or just opened; the rest are here, and ⌘K finds them too",
"每个项目一个讨论区，在这个项目上工作的会话都会收到；每个工作区也有一个": "One channel per project, read by every session working on it; each workspace has one too",
"发给": "To",
"写给会话……  Enter 发送": "Write to a session…  Enter to send",
"发送": "Send",
"先把要交给会话的事写下来；会话空了，助手先看还要不要做、适不适合，再替你发，或者提醒你。": "Write down what you want a session to do. When it is free, the assistant checks it is still wanted and fits, then sends it for you, or reminds you.",
"要做的事……（比如：等它把测试跑完，让它把结论写进 PR 描述）": "What to do… (for example: wait for the tests to finish, then put the result in the PR description)",
"交给": "To",
"助手确认后自动发": "Send after the assistant checks",
"空了提醒我": "Remind me when free",
"助手按各会话负责的事，推荐交给谁，或新开一个": "The assistant suggests who should take it, from what each session handles, or a new one",
"帮我选": "Pick for me",
"排上": "Queue it",
"未托管": "Not in a terminal",
"找你": "For you",
"回复 {n}……": "Reply to {n}…",
"回复": "Reply",
"知道了": "Got it",
"推送锁": "Push lock",
"{t}前锁上": "locked {t} ago",
"；{w} 在等它": "; {w} waiting for it",
"、": ", ",
"释放": "Release",
"等你决定": "Waiting for your decision",
"卡住了": "Blocked",
"可以验收": "Ready to review",
"启动自 {n}": "started by {n}",
"在等你批准：{w}": "Waiting for your approval: {w}",
"现在没有要你决定或验收的事，它们都在各自干活。": "Nothing needs your decision or review now; they are all working.",
"{n} 件，按要你花的心思排": "{n}, most demanding first",
"{n} 件排队的事可以发了": "{n} queued ready to send",
"排队中 {n} 件，等会话空了由助手确认再发": "{n} queued; the assistant checks and sends when a session is free",
"有事要交代？写下来，助手帮你挑交给哪个会话，或排到它空了再发": "Something to hand over? Write it down; the assistant picks a session, or queues it until one is free",
"不限项目": "Any project",
"{t}前动过": "active {t} ago",
"安静": "Quiet",
"个项目": " projects",
"个工作项在进行": " work items in progress",
"条新讨论": " new posts",
"{a} 个 · {b} 个有会话在动": "{a} · {b} with sessions at work",
"，{n} 个安静": ", {n} quiet",
"还有 {n} 个安静的工作区": "{n} more quiet workspaces",
"在「所有工作区」里": "in “All workspaces”",
"还没有工作区：会话在某个 git 仓库里干活后，它上面的文件夹就是一个工作区。": "No workspaces yet: once a session works in a git repository, the folder above it becomes a workspace.",
"现在没有进行中的工作项。": "No work items in progress now.",
"进度": "Progress",
"比 {m} 多 {n} 个提交": "{n} commits ahead of {m}",
"落后 {n} 个": "{n} behind",
"{n} 个文件没提交": "{n} files not committed",
"已在 {m} 里": "already in {m}",
"比远端多 {n} 个": "{n} ahead of remote",
"比远端少 {n} 个": "{n} behind remote",
"和远端一致": "same as remote",
"看不出在哪个工作项": "no work item found",
"文件夹": "Folder",
"（没有分支）": "(no branch)",
"主工作区": "main checkout",
"没有会话": "No sessions",
"停了 {n} 天": "idle {n} d",
"{n} 个会话": "{n} sessions",
"讨论区有新消息": "New posts in the channel",
"讨论区": "Channel",
"决定": "Decisions",
"产出": "Output",
"这个工作区还没有讨论、决定或产出。": "This workspace has no posts, decisions or results yet.",
"目录不在任何工作区里的会话": "sessions whose folder is in no workspace",
"现在没有这样的会话。": "No such sessions now.",
"没有这个工作区": "No such workspace",
"回到总览": "Back to overview",
"这个工作区里所有会话都收得到": "Every session in this workspace receives it",
"新建会话": "New session",
"{n} 个项目": "{n} projects",
"{n} 个工作项在进行": "{n} work items in progress",
"{n} 个 · 有会话的在前": "{n} · busy ones first",
"进行中": "In progress",
"全部": "All",
"一个工作项就是一个 worktree 和它的分支；合进 main、删掉 worktree 就不再出现": "A work item is a worktree and its branch; it disappears once merged into main and the worktree is removed",
"{n} 个": "{n}",
"这个工作区现在没有会话。点「新建会话」开一个。": "No sessions in this workspace now. Click “New session” to start one.",
"助手在看 {p} 上各个会话在做什么……": "The assistant is looking at what the sessions on {p} are doing…",
"助手在看各个会话在做什么……": "The assistant is looking at what the sessions are doing…",
"助手没给出建议": "The assistant gave no suggestion",
"助手的建议": "Assistant’s suggestion",
"交给「{n}」": "Give to “{n}”",
"排队": "Queue",
"排队：等它空了，助手再看一遍还要不要做": "Queue: when it is free, the assistant checks again whether it is still wanted",
"它这一轮做完就发": "Send when it finishes this turn",
"发给它": "Send to it",
"新开一个 {k} 会话": "Start a new {k} session",
"新开并交给它": "Start it and give it the task",
"没找到合适的会话": "No suitable session found",
"还有 {n} 个子 agent": "{n} more sub-agents",
"这个窗口开得比 amail 早，它下次干活就能认出来": "This window was opened before amail; it will be recognized the next time it works",
"还没有总结": "No summary yet",
"批准：{w}": "Approve: {w}",
"{n} 个决定": "{n} decisions",
"窗格 {n}": "pane {n}",
"还没读的消息": "Unread messages",
"进入它的终端": "Enter its terminal",
"它的报告": "Its report",
"回复它": "Reply to it",
"今天 {n} 条": "{n} today",
"经 Claude 自带的会话消息": "Via Claude’s own session messages",
"经 amail": "Via amail",
"还没有和你有关的消息": "No messages to or from you yet",
"会话之间还没有说过话": "Sessions haven’t talked yet",
"所有会话": "All sessions",
"做成了": "Done",
"接下来": "Next",
"{t}前更新": "updated {t} ago",
"正在写…": "Writing…",
"更新": "Update",
"写报告": "Write report",
"现在": "Now",
"正在读它的对话，大约半分钟。": "Reading its conversation; about half a minute.",
"还没有报告。": "No report yet.",
"工作区本身": "the workspace itself",
"{n} 份 · 会话有新进展时自动更新，最多半小时一次": "{n} · updated when a session moves on, at most every half hour",
"还没有会话": "No sessions yet",
"这个会话已经不在了": "This session is gone",
"由 {n} 启动": "started by {n}",
"写给它": "Write to it",
"总结于 {t}前": "summarized {t} ago",
"现在在做": "Doing now",
"它最后说的话": "Its last words",
"它启动的子 agent": "Sub-agents it started",
"停止": "Stop",
"{n} 条": "{n}",
"还没有记下决定。会话里拍板的事会自动记在这里。": "No decisions noted yet. What is settled in the session is recorded here automatically.",
"在哪里": "Where",
"启动者": "Started by",
"启动方式": "Started via",
"工作项": "Work items",
"组": "Group",
"窗格": "Pane",
"目录": "Folder",
"会话 ID": "Session ID",
"命令行": "Command line",
"名字": "Name",
"Claude 会话的名字由它自己定：在那个会话里输入 {c}，这里、amail 和窗格标题会跟着变。": "A Claude session names itself: type {c} in that session, and the name changes here, in amail and in the pane title.",
"新名字": "new-name",
"新名字（字母、数字、_ . -）": "New name (letters, digits, _ . -)",
"改名": "Rename",
"对 {n} 说……  ⌘/Ctrl+Enter 发送": "Say to {n}…  ⌘/Ctrl+Enter to send",
"帮我起草": "Draft for me",
"不等了：现在就打进它的终端": "Don’t wait: type it into its terminal now",
"现在就插进去": "Insert now",
"按它的目录": "by its folder",
"按它改的文件": "by the files it changes",
"它在工作区顶层": "it works at the workspace top",
"看不出": "can’t tell",
"{a}：{b}": "{a}: {b}",
"没有项目": "no project",
"改回自动判断": "Back to automatic",
"发到它的终端": "Send to its terminal",
"它空着：像你在它终端里敲一样，马上送到。": "It is idle: sent at once, as if you typed in its terminal.",
"等它这一轮做完再发": "Send when it finishes this turn",
"它正在做事：你的原话会在它这一轮做完时送到。急的话「现在就插进去」，它自己的命令行会接着处理。": "It is working: your words arrive when it finishes this turn. If it is urgent, use “Insert now” and its own command line handles it next.",
"放进它的信箱": "Put in its mailbox",
"它不在 Zellij 或 tmux 里：放进它的 amail 信箱，它下一步就会看到。": "It is not in Zellij or tmux: this goes into its amail mailbox and it sees it next.",
"先进终端处理": "Handle it in the terminal first",
"它停在一个授权或选择提示上，这时打进去的字会被当成对提示的回答：先进终端处理它。": "It is stopped at a permission or choice prompt, and typed text would answer that prompt: handle it in the terminal first.",
"已经退出了": "Exited",
"它已经退出了。": "It has exited.",
"没有这个项目": "No such project",
"比远端多 {a} 个提交、少 {b} 个": "{a} ahead of, {b} behind remote",
"比远端多 {n} 个提交": "{n} commits ahead of remote",
"工作区 {name}": "Workspace {name}",
"文件夹，不是 git 仓库": "Folder, not a git repository",
"现在没有会话在这个项目上。": "No sessions on this project now.",
"你指定的": "set by you",
"{n} 个 worktree · 一个工作项就是一个 worktree 和它的分支": "{n} worktrees · a work item is a worktree and its branch",
"这个项目是个文件夹，没有分支和 worktree。": "This project is a plain folder, with no branches or worktrees.",
"没有会话的 {n} 个工作项": "{n} work items with no session",
"{n} 条新消息": "{n} new posts",
"还没有人在这里说过话。发在这里的话，在这个项目上工作的会话都会收到。": "Nobody has posted here yet. Whatever is posted here reaches every session working on this project.",
"{n} 方在谈": "{n} taking part",
"{b} 被 {h} 锁着，{t}前锁上": "{b} is locked by {h}, {t} ago",
"：{n}": ": {n}",
"这个项目上的会话还没记下决定。": "Sessions on this project haven’t noted any decisions yet.",
"读取中……": "Loading…",
"发起讨论": "Start a discussion",
"结束了的": "Closed",
"收得到这里的会话": "Sessions that receive this",
"还没有。在这个项目上工作的会话下一轮开始时加入。": "None yet. Sessions working on this project join at the start of their next turn.",
"{a}/{b} 条": "{a}/{b} posts",
"结束讨论": "Close discussion",
"这场讨论还没有人发言。": "Nobody has spoken in this discussion yet.",
"还没有人在这里说过话。<br>发在这里的话，收得到这里的会话下一轮开始时都会看到；写 @名字 叫某个会话马上来看，@all 叫所有人。": "Nobody has posted here yet.<br>Sessions that receive this see what you post at the start of their next turn; write @name to call a session right now, @all to call everyone.",
"这场讨论已经结束了": "This discussion has ended",
"在「{n}」里说……  参加的会话马上会看到": "Say something in “{n}”…  the sessions taking part see it at once",
"写到工作区的讨论区……  Enter 发送，@名字 叫某个会话": "Write to the workspace channel…  Enter to send, @name to call a session",
"写到项目的讨论区……  Enter 发送，@名字 叫某个会话": "Write to the project channel…  Enter to send, @name to call a session",
"叫：": "Call:",
"发起": "Started",
"题目，比如：辩论——留言板要不要按话题分": "Topic, for example: debate — should the channel be split by topic",
"请谁来（Claude、Codex、Cursor 都可以，不在这个项目上的也行）": "Who to invite (Claude, Codex or Cursor; ones not on this project are fine)",
"现在没有在跑的会话": "No running sessions now",
"开场：要讨论什么、各自的角色（比如谁是正方、谁是反方）、要得出什么": "Opening: what to discuss, each one’s role (for example who argues for, who against), what to conclude",
"最多": "At most",
"条后自动结束 · 请来的会话马上会被叫来": "posts, then it ends by itself · invited sessions are called at once",
"取消": "Cancel",
"这个工作区里所有的会话都收得到这里的消息": "Every session in this workspace receives what is posted here",
"项目 {n} 的讨论区：在这个项目上工作的会话都收得到": "Channel of project {n}: every session working on it receives it",
"：": ": ",
"还没有人说过话": "Nobody has posted yet",
"{n} 场讨论": "{n} discussions",
"{name} 工作区": "{name} workspace",
"还没有工作区": "No workspaces yet",
"读取对话……": "Loading the conversation…",
"读不到它的对话记录。": "Can’t read its conversation.",
"重新连接": "Reconnect",
"进不去": "Can’t enter",
"这个组已经不在了。": "This group is gone.",
"这个会话不在 Zellij 或 tmux 里。": "This session is not in Zellij or tmux.",
"终端组件没加载出来": "The terminal component did not load",
"刷新页面再试一次。": "Reload the page and try again.",
"连接断开了": "Disconnected",
"它的会话还在，只是这个网页终端断了。": "Its session is still there; only this web terminal dropped.",
"没有接上，免得 Zellij 崩掉": "Not connected, to keep Zellij from crashing",
"这个 Zellij 已经开着 {held} 个文件，上限 {limit}。网页终端是它的又一个客户端，要再开约 {need} 个；超过上限 Zellij 会崩掉，里面的会话全部结束。先关掉一个连着它的终端再试；要多连几个，调高上限后重启 Zellij（见 README）。": "This Zellij already has {held} files open, with a limit of {limit}. A web terminal is one more client and needs about {need} more; past the limit Zellij crashes and every session in it ends. Close a terminal attached to it and try again; to attach more, raise the limit and restart Zellij (see the README).",
"和它有关的消息": "Messages about it",
"还没有。": "None yet.",
"助手在看 {p} 组里各个会话在做什么……": "The assistant is looking at what the sessions in group {p} are doing…",
"交给它": "Give it",
"新建并交给它": "Create it and give it the task",
"{g} 组里先空下来的会话": "First free session in group {g}",
"任何一个先空下来的会话": "Any session that is free first",
"还没有排队的事。": "Nothing queued yet.",
"{g} 组里先空下来的": "first free in group {g}",
"任何一个先空下来的": "any that is free first",
"发给 {n}": "Send to {n}",
"不发了": "Don’t send",
"不等了，现在就发": "Don’t wait: send now",
"现在就发": "Send now",
"重新排上": "Queue again",
"删除": "Delete",
"{t}前写的": "written {t} ago",
"<新组名>": "<new-group>",
"在一个组（Zellij 或 tmux 会话）里开一个新标签页或窗口，把 agent 跑起来。之后在这里和在终端里都能管理它。": "Opens a new tab or window in a group (a Zellij or tmux session) and starts the agent. You can manage it from here or from the terminal afterwards.",
"开什么": "What to start",
"对话与长任务": "Chat and long tasks",
"终端里的编码": "Coding in the terminal",
"编辑器风格的 agent": "Editor-style agent",
"组里的一个 shell": "A shell in the group",
"有终端连着": "terminal attached",
"后台": "background",
"新组": "New group",
"新建一个 {m} 会话": "Creates a new {m} session",
"Zellij 或 tmux": "Zellij or tmux",
"新组名": "New group name",
"比如 release、envhub、review": "For example release, envhub, review",
"用": "Use",
"浏览": "Browse",
"可选：会话、amail 和窗格标题都用这个名字": "Optional: used as the session, amail and pane title name",
"初始任务": "First task",
"可选：开起来就交给它的第一件事": "Optional: the first thing to give it when it starts",
"等同于": "Same as",
"建好后打开它": "Open it when created",
"新建": "Create",
"筛选": "Filter",
"这里没有子目录": "No subfolders here",
"还有 {n} 个没列出，用筛选找": "{n} more not listed; use the filter",
"选这个目录": "Choose this folder",
"先选一个组，或给新组起个名字": "Pick a group first, or name a new one",
"现在：{m}": "Now: {m}",
"运行在": "Runs on",
"模型": "Model",
"留空用它自己的默认模型": "Leave empty for its own default model",
"模型名": "Model name",
"接口地址": "API address",
"只存在本机（权限 600）": "Stored on this machine only (mode 600)",
"测试": "Test",
"保存并使用": "Save and use",
"可以用本机装的任何 agent 运行时（Claude Code、Codex、pi，用它们自己的登录），也可以接一个 API。保存后马上生效。": "Use any agent runtime installed on this machine (Claude Code, Codex, pi, with their own sign-in), or connect an API. Takes effect when saved.",
"助手 agent": "Assistant agent",
"替你看排队的事还要不要做、发给谁；帮你起草回复": "Checks whether queued items are still wanted and who gets them; drafts replies for you",
"总结模型": "Summary model",
"给每个会话起任务名、写进展、判断要不要你处理、记下决定（用小而快的模型就好）": "Names each session’s task, writes its progress, judges whether it needs you, notes decisions (a small, fast model is enough)",
"最近一次总结出错：{m}": "The last summary failed: {m}",
"页面用的语言。": "The language of the page.",
"这台机器上所有 Claude Code、Codex、Cursor 会话的入口和状态。": "The way in to every Claude Code, Codex and Cursor session on this machine, and how each stands.",
"版本": "Version",
"地址": "Address",
"运行自": "Running since",
"程序": "Program",
"源码": "Source",
"组名": "group",
"助手": "Assistant",
"清空这段对话": "Clear this conversation",
"清空": "Clear",
"收起（⌘/Ctrl+J）": "Fold (⌘/Ctrl+J)",
"收起": "Fold",
"问各个会话的事：谁在等我、哪个在做什么、定过什么……  Enter 发送": "Ask about the sessions: who is waiting for me, who is doing what, what was decided…  Enter to send",
"在翻各个会话……": "Looking through the sessions…",
"问我各个会话的事：我看得到每个会话在做什么、到哪了、定过什么、谁在等你，也能帮你找到它。": "Ask me about the sessions: I can see what each is doing, how far it got, what was decided and who is waiting for you, and I can help you find it.",
"现在谁在等我？各要我做什么": "Who is waiting for me now, and what do they need?",
"哪个会话在改登录页？": "Which session is working on the sign-in page?",
"今天定了哪些事？": "What was decided today?",
"有哪些 MR 已经提了还没合？": "Which MRs are open and not merged yet?",
"没答上来": "No answer",
"OpenAI 兼容": "OpenAI-compatible",
"开启后，写字的地方会多一个麦克风：点一下开始说，再点一下停，转出来的文字放到光标处。录音只转给你选的服务。": "When on, text fields get a microphone: click to start talking, click again to stop, and the text goes at the cursor. The recording goes only to the service you choose.",
"现在用的：": "In use: ",
"还没填 key": "no key yet",
"关着": "off",
"开启语音输入": "Turn on voice input",
"这个页面可以用麦克风。": "This page can use the microphone.",
"这个地址不是 https，浏览器不让网页用麦克风：本机用 http://127.0.0.1:7788，或给 tailnet 开 https。": "This address is not https, so the browser won’t let the page use the microphone: use http://127.0.0.1:7788 on this machine, or turn on https for the tailnet.",
"接入方式": "Connection",
"服务": "Service",
"https://api.openai.com/v1（也可以是 Groq 等兼容的）": "https://api.openai.com/v1 (or a compatible one such as Groq)",
"{p} 的 key，只存在本机（权限 600）": "{p} key, stays on this machine (mode 600)",
"自动（中英混说）": "Auto (mixed Chinese and English)",
"语音输入（{l}）：点一下开始，再点一下停": "Voice input ({l}): click to start, click again to stop",
"这个地址不是 https，浏览器不让网页用麦克风：本机用 http://127.0.0.1:7788，或给 tailnet 开 https": "This address is not https, so the browser won’t let the page use the microphone: use http://127.0.0.1:7788 on this machine, or turn on https for the tailnet",
"拿不到麦克风：{m}": "Can’t get the microphone: {m}",
"{v} 转好了": "{v} transcribed it",
"没听清": "Didn’t catch that",
"每个浏览器第一次打开都要登录令牌：在这台机器的终端里运行 {a}；{b} 换一个，所有浏览器都会退出。": "Every browser needs the sign-in token on first open: run {a} in a terminal on this machine; {b} makes a new one and signs every browser out.",
"本机": "This machine",
"Tailnet 地址只放行你自己账号下的设备。": "The Tailnet address lets in only devices on your own account.",
"已登录的浏览器": "Signed-in browsers",
"这个浏览器": "This browser",
"登录于 {t}": "signed in {t}",
"退出登录": "Sign out",
"移出": "Remove",
"结束这场讨论？之后就不能再往里发言了。": "Close this discussion? Nobody can post in it afterwards.",
"删掉这件排队的事？": "Delete this queued item?",
"起草中…": "Drafting…",
"没连上服务": "Can’t reach the service",
"保存中……": "Saving…",
"测试中：送一秒静音过去……": "Testing: sending a second of silence…",
"停止这个子 agent？它和它启动的进程都会被结束。": "Stop this sub-agent? It and the processes it started will be ended.",
"释放这把推送锁？在等它的会话会收到通知。": "Release this push lock? Sessions waiting for it will be told.",
"测试中……": "Testing…",
"ssh 登录的终端": "Terminal over ssh",
"screen 会话": "screen session",
"VS Code 的终端": "VS Code terminal",
"Cursor 编辑器的终端": "Cursor editor terminal",
"Codex 桌面应用": "Codex desktop app",
"cron 定时任务": "cron job",
"后台服务（systemd）": "Background service (systemd)",
"后台服务（launchd）": "Background service (launchd)",
"来源不明": "Unknown origin",
"终端窗口（{n}）": "Terminal window ({n})",
"GNOME 终端": "GNOME Terminal",
"Xfce 终端": "Xfce Terminal",
"MATE 终端": "MATE Terminal"
});
let LANG = 'zh';
const t = (s, v) => { let x = LANG === 'en' && EN[s] !== undefined ? EN[s] : s; for (const k in v || {}) x = x.split('{' + k + '}').join(v[k]); return x; };
const agoT = t0 => { const a = ago(t0); return a === t('刚刚') ? a : t('{t}前', { t: a }); };
// how a session outside Zellij and tmux was started: the deck writes it in Chinese, the page puts it in its own language
const originT = o => { if (LANG !== 'en' || !o) return o; const m = o.match(/^终端窗口（(.*)）$/) || o.match(/^由 (.*) 启动$/); const r = m ? t(o.startsWith('由') ? '由 {n} 启动' : '终端窗口（{n}）', { n: t(m[1]) }) : t(o); return r.charAt(0).toUpperCase() + r.slice(1); };
const mlabel = s => (LANG === 'en' ? String(s || '').replace('OpenAI 兼容接口', 'OpenAI-compatible API').replace('默认模型', 'default model') : String(s || ''));

function applyLang() {
  const v = store.get('deck.lang', 'auto');
  LANG = v === 'auto' ? (/^zh/i.test(navigator.language || 'zh') ? 'zh' : 'en') : v === 'en' ? 'en' : 'zh';
  document.documentElement.lang = LANG === 'en' ? 'en' : 'zh-CN';
  for (const [sel, attr, k] of [['[data-i18n]', null, 'zhText'], ['[data-i18n-title]', 'title', 'zhTitle'], ['[data-i18n-ph]', 'placeholder', 'zhPh'], ['[data-i18n-label]', 'aria-label', 'zhLabel']]) {
    document.querySelectorAll(sel).forEach(e => {
      if (e.dataset[k] === undefined) e.dataset[k] = attr ? e.getAttribute(attr) || '' : e.textContent;
      if (attr) e.setAttribute(attr, t(e.dataset[k])); else e.textContent = t(e.dataset[k]);
    });
  }
}

// ---------- theme ----------
function applyTheme() {
  const th = store.get('deck.theme', 'auto');
  document.documentElement.dataset.theme = th === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : th;
  $('#themeBtn').innerHTML = I[th === 'auto' ? 'auto' : th === 'dark' ? 'moon' : 'sun'];
  $('#themeBtn').title = { auto: t('主题：跟随系统'), light: t('主题：浅色'), dark: t('主题：深色') }[th];
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
  $('#conn span').textContent = off ? t('连接中断，重试中') : t('实时');
}
async function api(what, body) {
  const r = await fetch('/api/' + what, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Deck': '1', 'X-Lang': LANG }, body: JSON.stringify(body || {}) });
  if (r.status === 401) location.reload();  // (signed out: the sign-in page)
  return r.json();
}
async function post(what, body) {
  try { const j = await api(what, body); if (j.msg) toast(j.msg, j.ok); load(); return j; }
  catch (e) { toast(t('没连上 sturnus 服务：{m}', { m: e.message }), false); }
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
  let mt = h.match(/^\/term\/([^/]+)(?:\/([^/]+))?$/);
  if (mt) return { name: 'gterm', group: decodeURIComponent(mt[1]), pane: mt[2] ? decodeURIComponent(mt[2]) : '' };
  if (h === '/reports') return { name: 'reports' };
  if (h === '/boards') return { name: 'boards' };
  if (h === '/workspaces') return { name: 'workspaces' };
  mt = h.match(/^\/boards\/([^/]+)$/);
  if (mt) return { name: 'boards', key: decodeURIComponent(mt[1]) };
  mt = h.match(/^\/w\/([^/]+)(?:\/(projects|works))?$/);
  if (mt) return { name: 'ws', key: decodeURIComponent(mt[1]), tab: mt[2] || 'dash' };
  mt = h.match(/^\/p\/([^/]+)(?:\/(overview|board|sessions))?$/);
  if (mt) return { name: 'project', key: decodeURIComponent(mt[1]), tab: mt[2] || 'overview' };
  mt = h.match(/^\/b\/([^/]+)$/);
  if (mt) return { name: 'board', key: decodeURIComponent(mt[1]) };
  const m = h.match(/^\/s\/(.+?)(?:\/(overview|report|chat|term|msgs))?$/);
  return m ? { name: 'session', id: decodeURIComponent(m[1]), tab: m[2] || 'overview' } : { name: 'home' };
}
window.addEventListener('hashchange', () => { route = parseRoute(); if (!(route.name === 'session' && route.tab === 'term') && route.name !== 'gterm') closeTerm(); for (const k in sig) delete sig[k]; build(); render(); });
const go = (id, tab) => { location.hash = `#/s/${encodeURIComponent(id)}${tab && tab !== 'overview' ? '/' + tab : ''}`; };

function build() {  // (the frame of a view; render() fills it)
  closeOverlays();
  const crumb = x => { $('#crumbs').innerHTML = x ? `${I.chev}<b>${esc(t(x))}</b>` : ''; };
  const todo = `<section class="todo-sec"><form class="q-new todo" id="todo" autocomplete="off"><textarea id="tText" rows="2" placeholder="${t('有件事要做？写下来，选个项目，助手按各会话在做的事帮你挑交给谁，或者新开一个')}"></textarea>
        <div class="row"><label class="hint">${t('项目')}</label><select id="tProj"></select><span id="tMic"></span><span class="sp"></span><a class="btn" id="qlink" href="#/queue">${t('排队')}</a><button class="btn primary" type="submit">${I.spark}${t('交给谁')}</button></div></form><div id="tRec"></div></section>`;
  const wireTodo = () => {
    $('#todo').addEventListener('submit', e => { e.preventDefault(); todoAsk(); });
    $('#tText').addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); todoAsk(); } });
  };
  if (route.name === 'home') {  // (all workspaces)
    crumb('总览');
    $('#view').innerHTML = `<div class="page">
      <section class="entry"><div class="h-title"><h2>${t('需要你')}</h2><span class="sub" id="attnSub"></span></div><div id="attn"></div></section>
      ${todo}<section class="sec-block"><div class="h-title"><h2>${t('工作区')}</h2><span class="sub" id="wsSub"></span><a class="right lnk" href="#/workspaces">${t('所有工作区')}</a></div><div id="wsCards"></div></section>
      <section class="sec-block" id="looseSec"></section></div>`;
    wireTodo();
  } else if (route.name === 'ws') {  // (one workspace: its dashboard, its projects, its work items)
    $('#view').innerHTML = `<div class="page"><div class="ws-head" id="wsHead"></div><div id="wsBody"></div></div>`;
    if (route.tab === 'dash' && route.key !== '~') {
      $('#wsBody').innerHTML = `<section class="entry"><div class="h-title"><h2>${t('需要你')}</h2><span class="sub" id="attnSub"></span></div><div id="attn"></div></section>${todo}
        <section class="sec-block"><div class="h-title"><h2>${t('进行中的工作')}</h2><span class="sub">${t('有会话在上面、或者还没合进 main 的工作项')}</span><a class="right lnk" href="#/w/${encodeURIComponent(route.key)}/works">${t('全部工作项')}</a></div><div id="wsWorks"></div></section>
        <section class="sec-block"><div class="h-title"><h2>${t('会话在做什么')}</h2><span class="sub" id="wsCardsSub"></span></div><div id="wsSess"></div></section>
        <section class="sec-block"><div class="h-title"><h2>${t('项目')}</h2><span class="sub" id="wsProjSub"></span><a class="right lnk" href="#/w/${encodeURIComponent(route.key)}/projects">${t('全部项目')}</a></div><div id="wsProj"></div></section>
        <section class="sec-block"><div class="h-title"><h2>${t('最近')}</h2><span class="sub">${t('讨论区的新帖、记下的决定、产出')}</span></div><div id="wsFeed"></div></section>`;
      wireTodo();
    }
  } else if (route.name === 'workspaces') {
    crumb('所有工作区');
    $('#view').innerHTML = `<div class="page"><div class="h-title"><h2>${t('所有工作区')}</h2><span class="sub">${t('最左边只放有会话的和刚打开的；其余的在这里，⌘K 也能搜到')}</span></div><div id="wsCards"></div></div>`;
  } else if (route.name === 'project') {
    $('#view').innerHTML = `<div class="sess" id="sess"><div id="hero"></div><div id="tabBody"></div></div>`;
  } else if (route.name === 'board') {
    $('#view').innerHTML = `<div class="sess" id="sess"><div id="hero"></div><div id="tabBody"><div class="s-body wide" id="boardBox"></div></div></div>`;
  } else if (route.name === 'boards' && route.key) {
    $('#view').innerHTML = `<div class="sess" id="sess"><div id="hero"></div><div id="tabBody"><div class="s-body wide" id="boardBox"></div></div></div>`;
  } else if (route.name === 'boards') {
    crumb('讨论');
    $('#view').innerHTML = `<div class="page narrow"><div class="h-title"><h2>${t('讨论')}</h2><span class="sub">${t('每个项目一个讨论区，在这个项目上工作的会话都会收到；每个工作区也有一个')}</span></div><div id="bList"></div></div>`;
  } else if (route.name === 'gterm') {
    crumb(`${groupName(route.group)} · ${t('终端')}`);
    $('#view').innerHTML = `<div class="sess"><div id="tabBody"></div></div>`;
  } else if (route.name === 'talk') {
    crumb('消息');
    if (!['talk', 'mine'].includes(railTab)) railTab = 'talk';
    $('#view').innerHTML = `<div class="page narrow">
      <div class="h-title"><h2>${t('消息')}</h2><span class="sub" id="talkSub"></span><div class="right seg">${[['talk', t('会话之间')], ['mine', t('与你有关')]].map(([k, l]) => `<button data-rail="${k}" class="${railTab === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <form class="composer" id="composer" autocomplete="off">
        <div class="composer-top">${t('发给')} <select id="composeTo"></select></div>
        <div class="composer-box"><textarea id="composeText" rows="1" placeholder="${t('写给会话……  Enter 发送')}"></textarea><span id="cMic"></span><button class="send" type="submit" title="${t('发送')}">${I.arrow}</button></div>
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
    $('#view').innerHTML = `<div class="page"><div class="h-title"><h2>${t('报告')}</h2><span class="sub" id="repSub"></span></div><div id="repList"></div></div>`;
  } else if (route.name === 'queue') {
    crumb('排队');
    $('#view').innerHTML = `<div class="q-page"><div class="q-head"><h2>${t('排队')}</h2><p>${t('先把要交给会话的事写下来；会话空了，助手先看还要不要做、适不适合，再替你发，或者提醒你。')}</p></div>
      <form class="q-new" id="qNew" autocomplete="off"><textarea id="qText" placeholder="${t('要做的事……（比如：等它把测试跑完，让它把结论写进 PR 描述）')}"></textarea>
        <div class="row"><label class="hint">${t('交给')}</label><select id="qTo"></select>
          <div class="seg" id="qMode"><button type="button" data-qmode="auto" class="on">${t('助手确认后自动发')}</button><button type="button" data-qmode="remind">${t('空了提醒我')}</button></div>
          <span id="qMic"></span><button type="button" class="btn" id="qRecBtn" title="${t('助手按各会话负责的事，推荐交给谁，或新开一个')}">${I.spark}${t('帮我选')}</button>
          <span class="sp"></span><button class="btn primary" type="submit">${I.plus}${t('排上')}</button></div></form>
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
const groupName = k => (k === '~none' ? t('未托管') : k.replace(/^tmux:/, ''));
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
  if (h) { h.title = t(sideOff ? '展开旁边那栏（⌘B）' : '收起旁边那栏（⌘B）'); h.setAttribute('aria-label', h.title); h.innerHTML = sideOff ? I.chev : I.chev.replace('<svg', '<svg style="transform:scaleX(-1)"'); }
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
    const g = (href, on, icon, label, n, hot) => `<a class="tile g${on ? ' on' : ''}" href="${href}" title="${t(label, { n: rest })}${on ? t('（再点一下：收起或展开旁边那栏）') : ''}" aria-label="${t(label, { n: rest })}">${icon}${n ? `<span class="badge${hot ? ' hot' : ''}">${n}</span>` : ''}</a>`;
    $('#rail').innerHTML = g('#/', sp.t === 'home', I.grid, '总览：所有工作区', need, true) + '<hr>'
      + on.map((w, i) => `<a class="tile ws${sp.t === 'ws' && sp.key === w.key ? ' on' : ''}${w.live ? '' : ' quiet'}" href="#/w/${encodeURIComponent(w.key)}" style="--t:${wsColor(w)}" title="${esc(w.name)} · ${esc(home(w.path))}${i < 9 ? ` (⌘${i + 1})` : ''}" aria-label="${esc(w.name)}">${esc(w.name.slice(0, 1).toUpperCase())}${wsNeed(w) ? `<span class="badge hot">${wsNeed(w)}</span>` : wsWorking(w) ? '<i class="pulse"></i>' : ''}</a>`).join('')
      + (rest > 0 ? g('#/workspaces', sp.t === 'workspaces', `<b>+${rest}</b>`, '所有工作区（还有 {n} 个安静的）') : g('#/workspaces', sp.t === 'workspaces', I.plus, '所有工作区'))
      + (loose ? `<a class="tile g${sp.t === 'ws' && sp.key === '~' ? ' on' : ''}" href="#/w/~" title="${t('不在工作区里的会话')}" aria-label="${t('不在工作区里')}"><b>…</b><span class="badge">${loose}</span></a>` : '')
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
    const head = (x, sub, extra = '') => `<div class="sp-head"><b>${t(x)}</b>${sub ? `<span>${t(sub)}</span>` : ''}${extra}</div>`;
    const item = (href, on, icon, label, n, hot) => `<a class="nav-item${on ? ' on' : ''}" href="${href}">${icon}${t(label)}${n ? `<span class="n${hot ? ' hot' : ''}">${n}</span>` : ''}</a>`;
    const row = (s, pre) => { const [st, label] = standing(s), p = projOf(s.project); return `<div class="side-s${cur && cur.id === s.id ? ' on' : ''}${s.stale ? ' quiet' : ''}" data-go="${esc(s.id)}" title="${esc(s.name)}">${mark(FULL[s.kind] ? s.kind : 'codex', st, 'sm')}<b>${esc(titleOf(s))}</b><span><em class="${st}">${label}</em> · ${pre ? esc(pre) + ' · ' : ''}${p ? esc(p.name) + (s.branch && s.work !== p.path ? ' · ' + esc(s.branch) : '') : s.workspace ? t('工作区顶层') : esc(s.name)}</span></div>`; };
    const byState = (list, k, pre) => {
      const act = list.filter(s => !s.stale && !['gone', 'ended'].includes(s.state)), quiet = list.filter(s => s.stale), qOpen = quietOpen.has(k);
      const groups = [['等你', act.filter(s => ['waiting', 'blocked', 'review'].includes(standing(s)[0]))], ['工作中', act.filter(s => standing(s)[0] === 'working')], ['空闲', act.filter(s => standing(s)[0] === 'idle')]];
      return groups.filter(([, l]) => l.length).map(([x, l]) => `<div class="side-gh"><span>${t(x)} · ${l.length}</span></div>${l.map(s => row(s, pre && pre(s))).join('')}`).join('')
        + (quiet.length ? `<div class="side-quiet" data-quiet="${esc(k)}">${chev(qOpen)}${t('一天以上没动静 {n} 个', { n: quiet.length })}</div>${qOpen ? quiet.map(s => row(s, pre && pre(s))).join('') : ''}` : '')
        + (!act.length && !quiet.length ? `<div class="side-empty">${t('现在没有会话')}</div>` : '');
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
        + (groups.length ? `<div class="side-gh"><span>${t('终端')}</span></div>${groups.map(g => `<a class="side-g sm${route.name === 'gterm' && route.group === g ? ' on' : ''}" href="#/term/${encodeURIComponent(g)}" title="${esc(attachCmd(g))}"><i class="${((S.groups || {})[g] || {}).clients && S.groups[g].clients.length ? 'live' : ''}"></i><span class="nm">${esc(groupName(g))}</span>${muxTag(g)}</a>`).join('')}` : '');
    } else if (sp.t === 'boards') {
      html = head('讨论', '每个工作区、每个项目一个讨论区') + (S.workspaces || []).map(w => {
        const keys = [w.key, ...w.projects.filter(k => boardOf(k) || S.sessions.some(s => s.project === k))];
        return `<div class="side-gh"><span>${esc(w.name)}</span></div>` + keys.map(k => { const b = boardOf(k), isW = k === w.key;
          return item(`#/boards/${encodeURIComponent(k)}`, route.key === k, isW ? I.chat : I.folder, isW ? t('{name} 工作区', { name: esc(w.name) }) : esc(projOf(k).name), b && (b.calls || b.unread), b && b.calls); }).join('');
      }).join('');
    } else if (sp.t === 'talk') {
      html = head('消息', '会话之间的信，和写给你的') + [['talk', '会话之间'], ['mine', '与你有关']].map(([k, l]) => `<a class="nav-item${railTab === k ? ' on' : ''}" data-rail="${k}" href="#/talk">${I.mail}${t(l)}</a>`).join('');
    } else if (sp.t === 'reports') {
      html = head('报告', '每个会话的简报') + (S.workspaces || []).map(w => { const l = tops.filter(s => s.workspace === w.key && !['gone', 'ended'].includes(s.state));
        return l.length ? `<div class="side-gh"><span>${esc(w.name)}</span></div>${l.map(s => row(s)).join('')}` : ''; }).join('');
    } else if (sp.t === 'queue') {
      const q = S.queue || [], c = st => q.filter(i => st.includes(i.status)).length;
      html = head('排队', '等会话空了再发的事') + [['可以发了', ['ready']], ['排着', ['waiting', 'checking', 'held']], ['已发出', ['sent']], ['不用发了', ['dropped']]]
        .map(([l, st]) => `<div class="nav-item static">${I.list}${t(l)}<span class="n${st[0] === 'ready' && c(st) ? ' hot' : ''}">${c(st) || ''}</span></div>`).join('');
    } else if (sp.t === 'workspaces') {
      if ($('#wsFilter') && $('#wsList')) { $('#wsList').innerHTML = wsListHtml(); return; }  // (the filter stays as it is: typing in it is never cut)
      html = head('所有工作区', t('{n} 个 · 有会话的在前', { n: (S.workspaces || []).length }), `<input class="field side-filter" id="wsFilter" placeholder="${t('筛选工作区')}" value="${esc(sig.wsFilter || '')}" autocomplete="off">`)
        + `<div id="wsList">${wsListHtml()}</div>`;
    } else {  // (all workspaces: every session, with the workspace it is in)
      const gs = Object.keys(S.groups || {});
      html = head('所有工作区', t('{a} 个工作区 · {b} 个会话', { a: (S.workspaces || []).length, b: tops.filter(live).length })) + byState(tops, 'home', s => (wsOf(s.workspace) || { name: t('不在工作区里') }).name)
        + (gs.length ? `<div class="side-gh"><span>${t('终端')}</span></div>${gs.map(g => `<a class="side-g sm" href="#/term/${encodeURIComponent(g)}" title="${esc(attachCmd(g))}"><i class="${S.groups[g].clients.length ? 'live' : ''}"></i><span class="nm">${esc(groupName(g))}</span>${muxTag(g)}<span class="n">${S.groups[g].agents || ''}</span></a>`).join('')}` : '');
    }
    $('#side').innerHTML = html;
  });
}
function wsListHtml() {
  const f = (sig.wsFilter || '').toLowerCase(), ws = (S.workspaces || []).filter(w => !f || (w.name + ' ' + w.path).toLowerCase().includes(f));
  return [['有会话', ws.filter(w => w.live)], ['安静', ws.filter(w => !w.live)]].filter(([, l]) => l.length).map(([x, l]) => `<div class="side-gh"><span>${t(x)} · ${l.length}</span></div>`
    + l.map(w => `<a class="nav-item" href="#/w/${encodeURIComponent(w.key)}"><span class="wsdot" style="--t:${wsColor(w)}">${esc(w.name.slice(0, 1).toUpperCase())}</span>${esc(w.name)}<span class="n">${w.live ? t('{n} 个会话', { n: w.live }) : w.at ? agoT(w.at) : ''}</span></a>`).join('')).join('')
    || `<div class="side-empty">${t('没有这个名字的工作区')}</div>`;
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
    $('#attnSub').textContent = n ? t('{n} 件，按要你花的心思排', { n }) : '';
    $('#attn').innerHTML = n ? `<div class="attn">${inbox.map(m => `
      <div class="attn-row mail">
        <span class="bar4"></span>${face(m.from)}
        <div class="t"><div class="k">${t('找你')}<span>${esc(m.from)} · ${clock(m.at)}</span></div><div class="full">${md(m.text)}</div>
          <form class="m-reply" data-mid="${esc(m.id)}" hidden><input class="field" id="mr-${esc(m.id)}" placeholder="${t('回复 {n}……', { n: esc(m.from) })}" autocomplete="off">${micBtn('mr-' + m.id)}<button class="btn primary" type="submit">${t('发送')}</button></form></div>
        <div class="acts"><button class="btn" data-mreply="${esc(m.id)}">${I.reply}${t('回复')}</button><button class="btn" data-mread="${esc(m.id)}">${t('知道了')}</button></div>
      </div>`).join('')}${locks.map(l => `
      <div class="attn-row blocked">
        <span class="bar4"></span><span class="mark sm lk">${I.lock}</span>
        <div class="t"><div class="k">${t('推送锁')}<span>${esc(l.holder)} · ${t('{t}前锁上', { t: ago(l.since) })}</span></div>
          <b>${esc(l.branch)} · ${esc(folder(l.repo))}</b><p>${esc(l.why)}${(l.waiters || []).length ? t('；{w} 在等它', { w: esc(l.waiters.join(t('、'))) }) : ''}</p></div>
        <div class="acts"><button class="btn" data-unlock="${esc(l.key)}">${t('释放')}</button></div>
      </div>`).join('')}${need.map(([s, a]) => `
      <div class="attn-row ${ATT[a][1]}" data-go="${esc(s.id)}">
        <span class="bar4"></span>${mark(s.kind, ATT[a][1], 'sm')}
        <div class="t"><div class="k">${t(ATT[a][0])}<span>${esc(s.name)}${!wkey && wsOf(s.workspace) ? ` · ${esc(wsOf(s.workspace).name)}` : ''}${projOf(s.project) ? ` · ${esc(projOf(s.project).name)}` : ''}${parentOf(s) ? ` · ${t('启动自 {n}', { n: esc(parentOf(s).name) })}` : ''} · ${ago(s.since)}</span></div>
          <b>${esc(titleOf(s))}</b><p>${esc(s.state === 'waiting' && s.waiting_for ? t('在等你批准：{w}', { w: s.waiting_for }) : s.needs_you || s.summary || '')}</p></div>
        <div class="acts"><button class="btn" data-go="${esc(s.id)}" data-tab="overview">${I.reply}${t('回复')}</button><button class="btn dark" data-go="${esc(s.id)}" data-tab="term" ${webOk(s) ? '' : 'disabled'}>${I.enter}${t('进入')}</button></div>
      </div>`).join('')}</div>` : `<div class="calm">${I.check}${t('现在没有要你决定或验收的事，它们都在各自干活。')}</div>`;
  });
  const q = S.queue || [], qReady = q.filter(i => i.status === 'ready'), qWait = q.filter(i => ['waiting', 'held', 'checking'].includes(i.status));
  if (!wkey) draw('qline', [qReady.length, qWait.length], () => {
    let el = $('#qline');
    if (!el) { el = document.createElement('a'); el.id = 'qline'; el.className = 'q-line'; el.href = '#/queue'; $('.entry').appendChild(el); }
    el.innerHTML = `${I.plus}<span>${qReady.length ? `<b>${t('{n} 件排队的事可以发了', { n: qReady.length })}</b> · ` : ''}${qWait.length ? t('排队中 {n} 件，等会话空了由助手确认再发', { n: qWait.length }) : t('有事要交代？写下来，助手帮你挑交给哪个会话，或排到它空了再发')}</span>`;
  });
}
function drawTodoProjects(keys) {
  draw('tproj', [keys], () => {
    const sel = $('#tProj');
    if (!sel) return;
    const keep = sel.value || store.get('deck.todoProj', '');
    const byWs = new Map();
    for (const k of keys) { const w = (wsOf((projOf(k) || {}).workspace) || {}).name || ''; if (!byWs.has(w)) byWs.set(w, []); byWs.get(w).push(k); }
    sel.innerHTML = `<option value="">${t('不限项目')}</option>` + [...byWs.entries()].map(([w, ks]) => `<optgroup label="${esc(w)}">${ks.map(k => `<option value="${esc(k)}">${esc(projOf(k).name)}</option>`).join('')}</optgroup>`).join('');
    if (keys.includes(keep)) sel.value = keep;
  });
  draw('tmic', [S.voice && S.voice.on], () => { if ($('#tMic')) $('#tMic').innerHTML = micBtn('tText'); });
}

// ---------- all workspaces ----------
function wsCard(w) {
  const mine = roots(S.sessions).filter(s => s.workspace === w.key && live(s)), c = k => mine.filter(s => standing(s)[0] === k).length, need = wsNeed(w), b = boardOf(w.key);
  const works = workRows(w).length;
  return `<a class="ws-card${w.live ? '' : ' quiet'}" href="#/w/${encodeURIComponent(w.key)}"><div class="top"><span class="wsdot lg" style="--t:${wsColor(w)}">${esc(w.name.slice(0, 1).toUpperCase())}</span><div><b>${esc(w.name)}</b><span class="path">${esc(home(w.path))}</span></div>${need ? `<span class="n hot">${need}</span>` : ''}</div>
    <div class="stats">${w.live ? [['waiting', '等你', c('waiting') + c('blocked') + c('review')], ['working', '工作中', c('working')], ['idle', '空闲', c('idle')]].filter(x => x[2]).map(([k, l, v]) => `<span class="chip"><span class="dot ${k}"></span><b>${v}</b>${t(l)}</span>`).join('') : `<span class="chip">${w.at ? t('{t}前动过', { t: ago(w.at) }) : t('安静')}</span>`}
      <span class="chip"><b>${w.projects.length}</b>${t('个项目')}</span>${works ? `<span class="chip"><b>${works}</b>${t('个工作项在进行')}</span>` : ''}${b && b.unread ? `<span class="chip">${I.chat}<b>${b.unread}</b>${t('条新讨论')}</span>` : ''}</div></a>`;
}
function renderHome() {
  drawAttn('');
  drawTodoProjects((S.workspaces || []).flatMap(w => w.projects.filter(k => S.sessions.some(s => s.project === k))));
  const ws = S.workspaces || [], loose = roots(S.sessions).filter(s => !s.workspace && live(s));
  draw('wscards', [ws.map(w => [w.key, w.live, w.at, w.projects.length, wsNeed(w)]), S.sessions.map(s => [s.id, s.state, s.status, s.workspace]), Object.values(S.boards || {}).map(b => [b.key, b.unread]), tick()], () => {
    const on = ws.filter(w => w.live || wsNeed(w)), quiet = ws.length - on.length;
    $('#wsSub').textContent = t('{a} 个 · {b} 个有会话在动', { a: ws.length, b: on.length }) + (quiet ? t('，{n} 个安静', { n: quiet }) : '');
    $('#wsCards').innerHTML = `<div class="ws-grid">${on.map(wsCard).join('')}${quiet ? `<a class="ws-card more" href="#/workspaces"><b>${t('还有 {n} 个安静的工作区', { n: quiet })}</b><span>${t('在「所有工作区」里')}</span></a>` : ''}</div>`;
  });
  draw('loose', [loose.map(s => [s.id, s.state, s.title, s.summary])], () => {
    $('#looseSec').innerHTML = loose.length ? `<div class="h-title"><h2>${t('不在工作区里')}</h2><span class="sub">${t('目录不在任何工作区里的会话')}</span></div><div class="cards">${loose.map(card).join('')}</div>` : '';
  });
}
function renderWorkspaces() {
  const ws = S.workspaces || [];
  draw('wscards', [ws.map(w => [w.key, w.live, w.at, w.projects.length, wsNeed(w)]), S.sessions.map(s => [s.id, s.state, s.status, s.workspace, s.stale]), Object.values(S.boards || {}).map(b => [b.key, b.unread]), tick()], () => {
    $('#wsCards').innerHTML = ws.length ? `<div class="ws-grid">${ws.map(wsCard).join('')}</div>` : `<div class="calm">${t('还没有工作区：会话在某个 git 仓库里干活后，它上面的文件夹就是一个工作区。')}</div>`;
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
  if (!rows.length) return `<div class="calm">${I.check}${t('现在没有进行中的工作项。')}</div>`;
  const now = Date.now() / 1000;
  return `<div class="tbl"><table class="works"><thead><tr><th>${t('项目')}</th><th>${t('工作项')}</th><th>${t('会话')}</th><th>${t('进度')}</th><th class="r">${t('最近')}</th></tr></thead><tbody>${rows.map(({ p, x, ss, at }) => {
    const f = p.facts || {}, stale = !ss.length && x && !x.main && x.ahead > 0 && !x.dirty && at && now - at > 3 * 86400;  // (unmerged commits, last one days ago)
    const chips = x ? [x.ahead ? t('比 {m} 多 {n} 个提交', { m: esc(f.main), n: x.ahead }) : '', x.behind ? t('落后 {n} 个', { n: x.behind }) : '', x.dirty ? t('{n} 个文件没提交', { n: x.dirty }) : '',
      !x.main && x.ahead === 0 && !x.dirty ? t('已在 {m} 里', { m: esc(f.main) }) : '', x.main && !x.dirty ? (f.ahead ? t('比远端多 {n} 个', { n: f.ahead }) : f.behind ? t('比远端少 {n} 个', { n: f.behind }) : f.ahead === 0 ? t('和远端一致') : '') : ''].filter(Boolean) : [p.git ? t('看不出在哪个工作项') : t('文件夹')];
    return `<tr data-href="#/p/${encodeURIComponent(p.key)}"><td><a href="#/p/${encodeURIComponent(p.key)}">${esc(p.name)}</a></td>
      <td>${x ? `<span class="br">${esc(x.branch || t('（没有分支）'))}</span><span class="wt">${x.main ? t('主工作区') : 'worktree'}</span>` : '—'}</td>
      <td>${ss.length ? `<span class="who">${ss.map(s => `<span data-go="${esc(s.id)}" title="${esc(s.name)} · ${esc(titleOf(s))}">${mark(s.kind, standing(s)[0], 'xs')}</span>`).join('')}</span>` : `<span class="none">${t('没有会话')}</span>`}</td>
      <td>${chips.map(c => `<span class="wchip">${c}</span>`).join(' ')}${stale ? ` <span class="wchip stale">${t('停了 {n} 天', { n: Math.floor((now - at) / 86400) })}</span>` : ''}</td><td class="r when">${at ? ago(at) : ''}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function projGrid(keys) {
  return `<div class="pgrid">${keys.map(k => { const p = projOf(k), f = p.facts || {}, n = roots(S.sessions).filter(s => s.project === k && live(s)).length, b = boardOf(k);
    return `<a class="pcard${n ? '' : ' quiet'}" href="#/p/${encodeURIComponent(k)}"><b>${esc(p.name)}</b><span>${n ? `<em>● ${t('{n} 个会话', { n })}</em> · ` : ''}${p.git ? esc(f.tag || f.main || '') : t('文件夹')}${p.at ? ` · ${t('{t}前', { t: ago(p.at) })}` : ''}</span>${b && b.unread ? `<i class="bdot" title="${t('讨论区有新消息')}"></i>` : ''}</a>`; }).join('')}</div>`;
}
function wsFeed(w) {
  const ids = new Set(S.sessions.filter(s => s.workspace === w.key).map(s => s.id)), items = [];
  for (const k of [w.key, ...w.projects]) { const b = boardOf(k); if (b && b.last) items.push({ at: b.last.at, kind: t('讨论区'), where: k === w.key ? t('工作区') : projOf(k).name, who: who(b.last.from), text: b.last.text, href: k === w.key ? `#/b/${encodeURIComponent(k)}` : `#/p/${encodeURIComponent(k)}/board` }); }
  for (const d of S.decisions || []) if (ids.has(d.sid)) items.push({ at: d.at, kind: t('决定'), who: d.by === 'user' ? t('你') : d.name, text: d.what, href: `#/s/${encodeURIComponent(d.sid)}` });
  for (const [sid, r] of Object.entries(S.reports || {})) if (ids.has(sid) && r.r) for (const x of (r.r.refs || []).slice(0, 2)) items.push({ at: r.at, kind: t('产出'), who: r.name, text: x, href: `#/s/${encodeURIComponent(sid)}/report` });
  items.sort((a, b) => b.at - a.at);
  return items.length ? `<div class="feed">${items.slice(0, 12).map(i => `<a class="fi" href="${i.href}"><span class="k">${i.kind}${i.where ? ' · ' + esc(i.where) : ''}</span><span class="t"><b>${esc(i.who)}</b>${t('：')}${esc(String(i.text).replace(/\s+/g, ' ').slice(0, 160))}</span><time>${clock(i.at)}</time></a>`).join('')}</div>`
    : `<div class="calm">${t('这个工作区还没有讨论、决定或产出。')}</div>`;
}
function renderWs() {
  const key = route.key;
  if (key === '~') {
    const loose = roots(S.sessions).filter(s => !s.workspace);
    $('#crumbs').innerHTML = `${I.chev}<b>${t('不在工作区里')}</b>`;
    draw('wshead', ['~'], () => { $('#wsHead').innerHTML = `<div class="t"><h2>${t('不在工作区里')}</h2><div class="sub"><span>${t('目录不在任何工作区里的会话')}</span></div></div>`; });
    draw('wsbody', [loose.map(s => [s.id, s.state, s.title, s.summary, s.status])], () => { $('#wsBody').innerHTML = loose.length ? `<div class="cards">${loose.map(card).join('')}</div>` : `<div class="calm">${t('现在没有这样的会话。')}</div>`; });
    return;
  }
  const w = wsOf(key);
  if (!w) { draw('wshead', ['none', key], () => { $('#wsHead').innerHTML = `<div class="t"><h2>${t('没有这个工作区')}</h2></div>`; $('#wsBody').innerHTML = `<a class="btn" href="#/">${I.back}${t('回到总览')}</a>`; }); return; }
  const mine = roots(S.sessions).filter(s => s.workspace === w.key), on = mine.filter(live), c = k => on.filter(s => standing(s)[0] === k).length, b = boardOf(w.key);
  $('#crumbs').innerHTML = `${I.chev}<a href="#/w/${encodeURIComponent(w.key)}">${esc(w.name)}</a>${I.chev}<b>${t(route.tab === 'projects' ? '项目' : route.tab === 'works' ? '工作项' : '仪表盘')}</b>`;
  draw('wshead', [w.key, w.name, w.path, w.projects.length, c('working'), c('waiting') + c('blocked'), c('review'), c('idle'), b && b.unread], () => {
    $('#wsHead').innerHTML = `<span class="wsdot xl" style="--t:${wsColor(w)}">${esc(w.name.slice(0, 1).toUpperCase())}</span><div class="t"><h2>${esc(w.name)}<em>${t('{name} 工作区', { name: '' }).trim()}</em></h2>
        <div class="sub"><span class="nm">${esc(home(w.path))}</span><span>${t('{n} 个项目', { n: w.projects.length })}</span><span>${t('{n} 个工作项在进行', { n: workRows(w).length })}</span></div></div>
      <div class="right"><span class="legend">${[['waiting', '等你', c('waiting') + c('blocked') + c('review')], ['working', '工作中', c('working')], ['idle', '空闲', c('idle')]]
        .map(([k, l, v]) => `<span class="chip"><span class="dot ${k}"></span><b>${v}</b>${t(l)}</span>`).join('')}</span>
        <a class="btn" href="#/b/${encodeURIComponent(w.key)}" title="${t('这个工作区里所有会话都收得到')}">${I.chat}${t('讨论区')}${b && b.unread ? ` · ${b.unread}` : ''}</a><button class="btn" data-newp-ws="${esc(w.key)}">${I.plus}${t('新建会话')}</button></div>`;
  });
  const sig_ = [w.key, route.tab, w.projects, Object.values(S.projects || {}).filter(p => p.workspace === w.key).map(p => [p.key, p.facts && p.facts.at, p.at]),
    mine.map(s => [s.id, s.state, s.status, s.title, s.summary, s.work, s.project, s.stale, s.needs_you, s.tool]), Object.values(S.boards || {}).map(b => [b.key, b.unread, b.last && b.last.at]), (S.decisions || []).length, Object.keys(S.reports || {}).length, tick(), sig.worksAll];
  if (route.tab === 'projects') {
    draw('wsbody', sig_, () => { $('#wsBody').innerHTML = `<div class="h-title"><h2>${t('项目')}</h2><span class="sub">${t('{n} 个 · 有会话的在前', { n: w.projects.length })}</span></div>${projGrid(w.projects)}`; });
    return;
  }
  if (route.tab === 'works') {
    draw('wsbody', sig_, () => {
      const rows = workRows(w, !!sig.worksAll);
      $('#wsBody').innerHTML = `<div class="h-title"><h2>${t('工作项')}</h2><span class="sub">${t('一个工作项就是一个 worktree 和它的分支；合进 main、删掉 worktree 就不再出现')}</span><div class="right seg"><button data-works-all="" class="${sig.worksAll ? '' : 'on'}">${t('进行中')}</button><button data-works-all="1" class="${sig.worksAll ? 'on' : ''}">${t('全部')}</button></div></div>${worksTable(rows)}`;
    });
    return;
  }
  drawAttn(w.key);
  drawTodoProjects(w.projects);
  draw('wsbody', sig_, () => {
    $('#wsWorks').innerHTML = worksTable(workRows(w));
    const act = on.filter(s => !s.stale);
    $('#wsCardsSub').textContent = act.length ? t('{n} 个', { n: act.length }) : '';
    $('#wsSess').innerHTML = act.length ? `<div class="cards">${act.sort((a, b) => ORDER(a) - ORDER(b)).map(card).join('')}</div>` : `<div class="calm">${t('这个工作区现在没有会话。点「新建会话」开一个。')}</div>`;
    $('#wsProjSub').textContent = t('{n} 个', { n: w.projects.length });
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
  $('#tRec').innerHTML = `<div class="rec"><p class="hint">${project ? t('助手在看 {p} 上各个会话在做什么……', { p: esc(projOf(project).name) }) : t('助手在看各个会话在做什么……')}</p></div>`;
  const j = await api('recommend', { text, project }).catch(e => ({ ok: false, msg: e.message }));
  if (!j.ok) { $('#tRec').innerHTML = `<div class="rec"><p class="hint">${esc(j.msg || t('助手没给出建议'))}</p></div>`; return; }
  TREC = { ...j, text };
  const to = j.to && S.sessions.find(x => x.id === j.to.id);
  $('#tRec').innerHTML = `<div class="rec"><h4>${t('助手的建议')}</h4>
    ${to ? `<div class="rec-opt"><div><b>${t('交给「{n}」', { n: esc(j.to.title || j.to.name) })}</b><span>${esc(j.to.name)} · ${esc(standing(to)[1])}</span><p>${esc(j.why)}</p></div><button class="btn" data-trec="queue" title="${t('排队：等它空了，助手再看一遍还要不要做')}">${t('排队')}</button><button class="btn primary" data-trec="say">${sayHow(to) === 'queue' ? t('它这一轮做完就发') : t('发给它')}</button></div>` : ''}
    ${j.new ? `<div class="rec-opt"><div><b>${t('新开一个 {k} 会话', { k: FULL[j.new.kind] })}</b><span>${esc(home(j.new.cwd))}${j.new.group ? ' · ' + esc(groupName(j.new.group)) : ''}${j.new.name ? ' · ' + esc(j.new.name) : ''}</span><p>${esc(j.new.why)}</p></div><button class="btn${to ? '' : ' primary'}" data-trec="new">${t('新开并交给它')}</button></div>` : ''}
    ${!to && !j.new ? `<p class="hint">${esc(j.why || t('没找到合适的会话'))}</p>` : ''}</div>`;
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
  return `<div class="kids">${shown.map(c => { const [st, label] = standing(c); return `<div class="kid" data-go="${esc(c.id)}">${mark(c.kind, st, 'xs')}<b>${esc(titleOf(c))}</b><span>${label} ${ago(c.since)}</span></div>`; }).join('')}${kids.length > shown.length ? `<div class="kid more">${t('还有 {n} 个子 agent', { n: kids.length - shown.length })}</div>` : ''}</div>`;
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
    <div class="desc${desc ? '' : ' none'}">${esc(desc || (s.unknown ? t('这个窗口开得比 amail 早，它下次干活就能认出来') : t('还没有总结')))}</div>
    ${s.origin ? `<div class="origin">${I.term}${esc(originT(s.origin))}</div>` : ''}
    ${kidRows(s)}
    ${a && (s.needs_you || s.waiting_for) ? `<div class="need ${ATT[a][1]}"><span><b>${t(ATT[a][0])}</b>${esc(s.state === 'waiting' && s.waiting_for ? t('批准：{w}', { w: s.waiting_for }) : s.needs_you)}</span></div>` : ''}
    <div class="foot"><span class="st ${st}"><i></i>${label} ${ago(s.since)}</span>${tool}${br ? `<span class="br" title="${esc(home(s.work))}">${I.branch}${esc(s.branch)}</span>` : decs ? `<span>${t('{n} 个决定', { n: decs })}</span>` : ''}<span class="nm" title="${esc((s.loc ? `${groupName(s.loc.session)} › ${t('窗格 {n}', { n: s.loc.pane })} · ` : '') + home(s.cwd))}">${esc(s.name)}</span></div>
    ${s.unread ? `<span class="unread" title="${t('还没读的消息')}">${s.unread}</span>` : ''}
    <div class="hover-acts">${webOk(s) ? `<button data-go="${esc(s.id)}" data-tab="term" title="${t('进入它的终端')}">${I.enter}</button>` : ''}<button data-go="${esc(s.id)}" data-tab="report" title="${t('它的报告')}">${I.doc}</button><button data-go="${esc(s.id)}" data-tab="overview" title="${t('回复它')}">${I.reply}</button></div>
  </article>`;
}

// ---------- messages: what the sessions say to each other, and to the person ----------
function renderTalk() {
  draw('cmic', [S.voice && S.voice.on], () => { if ($('#cMic')) $('#cMic').innerHTML = micBtn('composeText'); });
  const talk = S.talk || [], fresh = [];
  for (const m of talk) if (!seenTalk.has(m.key)) { seenTalk.add(m.key); if (!firstTalk) fresh.push(m); }
  firstTalk = false;
  $('#talkSub').textContent = t('今天 {n} 条', { n: talk.filter(m => isToday(m.at)).length });
  const list = talk.filter(m => railTab === 'talk' || m.from === 'user' || m.to === 'user');
  draw('rail', [railTab, list.map(m => m.key), tick()], () => {
    $('#railList').innerHTML = list.length ? list.slice(0, 200).map(m => `
      <div class="m${fresh.includes(m) ? ' fresh' : ''}${m.from === 'user' || m.to === 'user' ? ' mine' : ''}${openMsgs.has(m.key) ? ' open' : ''}" data-msg="${esc(m.key)}" title="${m.via === 'claude' ? t('经 Claude 自带的会话消息') : t('经 amail')}">
        ${face(m.from)}<div><div class="route"><b>${esc(who(m.from))}</b>${I.arrow}<b>${esc(who(m.to))}</b><time>${clock(m.at)}</time></div><div class="txt">${md(m.text)}</div></div>
      </div>`).join('') : `<div class="empty-line">${railTab === 'mine' ? t('还没有和你有关的消息') : t('会话之间还没有说过话')}</div>`;
  });
  const sel = $('#composeTo');
  const opts = ['all', ...S.sessions.filter(s => !['gone', 'ended'].includes(s.state) && !s.unknown).map(s => s.name).sort()];
  if (sel && sel.dataset.opts !== opts.join()) {
    const cur = sel.value;
    sel.innerHTML = opts.map(n => `<option value="${esc(n)}">${n === 'all' ? t('所有会话') : esc(n)}</option>`).join('');
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
  const list = (h, xs) => xs && xs.length ? `<h5>${t(h)}</h5><ul>${xs.map(x => `<li>${mdInline(x)}</li>`).join('')}</ul>` : '';
  return `<article class="rep">
    <header>${mark(k, st, 'sm')}<div class="h"><b data-go="${esc(s.id)}" data-tab="report">${esc(titleOf(s))}</b><span>${esc(s.name)}${rep && rep.at ? ` · ${t('{t}前更新', { t: ago(rep.at) })}` : ''}</span></div>
      <button class="btn" data-report="${esc(s.id)}" ${busy ? 'disabled' : ''}>${busy ? t('正在写…') : r ? t('更新') : t('写报告')}</button></header>
    ${r ? `${r.goal ? `<p class="goal">${mdInline(r.goal)}</p>` : ''}
      ${list('做成了', r.done)}
      ${r.decisions && r.decisions.length ? `<h5>${t('决定')}</h5><ul class="decs">${r.decisions.map(d => `<li><span class="by ${d.by}">${d.by === 'user' ? t('你') : 'AI'}</span><span>${mdInline(d.what)}</span></li>`).join('')}</ul>` : ''}
      ${r.now ? `<h5>${t('现在')}</h5><p>${mdInline(r.now)}</p>` : ''}
      ${list('接下来', r.next)}
      ${r.refs && r.refs.length ? `<h5>${t('产出')}</h5><div class="refs">${r.refs.map(x => /^https?:\/\//.test(x) ? `<a href="${esc(x)}" target="_blank" rel="noopener noreferrer">${esc(refLabel(x))}</a>` : `<code>${esc(x)}</code>`).join('')}</div>` : ''}`
    : `<p class="hint">${busy ? t('正在读它的对话，大约半分钟。') : t('还没有报告。')}</p>`}
  </article>`;
}
function renderReports() {
  const reps = S.reports || {};
  const list = roots(S.sessions).filter(s => !s.stale && (reps[s.id] || (!['gone', 'ended'].includes(s.state) && !(s.unknown && !s.summary))));
  draw('reports', [Object.entries(reps).map(([k, v]) => [k, v.at]), S.reporting, list.map(s => [s.id, s.title, s.state, s.status]), tick()], () => {
    const by = new Map();
    for (const s of list) { const k = s.project || (s.workspace ? 'self:' + s.workspace : '~'); if (!by.has(k)) by.set(k, []); by.get(k).push(s); }
    const name = k => k.startsWith('self:') ? `${(wsOf(k.slice(5)) || {}).name || ''} · ${t('工作区本身')}` : k === '~' ? t('不在工作区里') : (projOf(k) || {}).name || k;
    $('#repSub').textContent = t('{n} 份 · 会话有新进展时自动更新，最多半小时一次', { n: list.filter(s => reps[s.id]).length });
    $('#repList').innerHTML = [...by.keys()].map(k => `<section class="grp"><div class="grp-head"><h3>${projOf(k) ? `<a href="#/p/${encodeURIComponent(k)}">${esc(name(k))}</a>` : esc(name(k))}</h3></div>
      <div class="reps">${by.get(k).map(s => repCard(s, reps[s.id])).join('')}</div></section>`).join('') || `<div class="empty-line">${t('还没有会话')}</div>`;
  });
}

// ---------- a session ----------
function renderSession() {
  const s = S.sessions.find(x => x.id === route.id);
  if (!s) {
    draw('hero', ['missing', route.id], () => { $('#hero').innerHTML = `<div class="s-hero"><div class="row"><h1>${t('这个会话已经不在了')}</h1></div><div class="tabs"></div></div>`; $('#tabBody').innerHTML = `<div class="s-body"><a class="btn" href="#/">${I.back}${t('回到总览')}</a></div>`; });
    return;
  }
  const k = FULL[s.kind] ? s.kind : 'codex', [st, label] = standing(s);
  { const w = wsOf(s.workspace), p = projOf(s.project);
    $('#crumbs').innerHTML = (w ? `${I.chev}<a href="#/w/${encodeURIComponent(w.key)}">${esc(w.name)}</a>` : '') + (p ? `${I.chev}<a href="#/p/${encodeURIComponent(p.key)}">${esc(p.name)}</a>` : '')
      + (p && s.work && s.work !== p.path && s.branch ? `${I.chev}<span>${I.branch}${esc(s.branch)}</span>` : '') + `${I.chev}<b>${esc(titleOf(s))}</b>`; }
  draw('hero', [s.id, s.name, st, s.title, s.summary, s.loc, s.cwd, s.project, s.branch, sessTab, tick()], () => {
    $('#hero').innerHTML = `<div class="s-hero ${k}">
      <div class="row">${mark(k, st, 'lg')}<div style="min-width:0"><h1>${esc(titleOf(s))}</h1>
        <div class="sub"><span class="nm">${esc(s.name)}</span>${projOf(s.project) ? `<a class="pj-link" href="#/p/${encodeURIComponent(s.project)}">${I.folder}${esc(projOf(s.project).name)}${s.branch && s.work !== projOf(s.project).path ? ` / ${esc(s.branch)}` : ''}</a>` : ''}${parentOf(s) ? `<span>${t('由 {n} 启动', { n: `<a data-go="${esc(parentOf(s).id)}">${esc(parentOf(s).name)}</a>` })}</span>` : s.origin && !s.loc ? `<span>${esc(originT(s.origin))}</span>` : ''}<span>${FULL[s.kind] || esc(s.kind)}</span><span>${label} · ${ago(s.since)}</span>${s.loc ? `<span>${esc(groupName(s.loc.session))} › ${t('窗格 {n}', { n: esc(s.loc.pane) })}</span>` : ''}<span title="${esc(s.cwd || '')}">${esc(home(s.cwd))}</span></div></div>
      </div>
      <nav class="tabs">${[['overview', '概览'], ['report', '报告'], ['chat', '对话'], ['term', '终端'], ['msgs', '消息']].map(([x, l]) => `<button data-tab-go="${x}" class="${sessTab === x ? 'on' : ''}">${t(l)}</button>`).join('')}
        <div class="acts"><button class="hbtn" data-act="jump" ${s.loc ? '' : 'disabled'} title="${t('让连着这个组的终端切到它')}">${I.jump}${t('在终端里打开')}</button><button class="hbtn primary" data-tab-go="term" ${webOk(s) ? '' : 'disabled'}>${I.enter}${t('进入')}</button></div></nav></div>`;
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
      ${a ? `<div class="need-box ${ATT[a][1]}"><div class="k">${t(ATT[a][0])}</div><p>${esc(s.state === 'waiting' && s.waiting_for ? t('在等你批准：{w}', { w: s.waiting_for }) : s.needs_you || s.summary || '')}</p>${replyBox(s)}</div>`
        : `<div class="panel"><h4>${t('写给它')}</h4>${replyBox(s)}</div>`}
      <div class="panel"><h4>${t('现在在做')}<span class="r hint">${s.summary_at ? t('总结于 {t}前', { t: ago(s.summary_at) }) : ''}</span></h4><div class="now ${k === 'claude' ? 'serif' : k === 'codex' ? 'mono' : ''}">${esc(s.summary || t('还没有总结'))}</div></div>
      ${s.said ? `<div class="panel"><h4>${t('它最后说的话')}</h4><div class="said">${md(s.said)}</div></div>` : ''}
      ${kidsOf(s).length ? `<div class="panel"><h4>${t('它启动的子 agent')}<span class="r hint">${t('{n} 个', { n: kidsOf(s).length })}</span></h4><div class="kid-list">${kidsOf(s).map(c => { const [st, label] = standing(c); return `
        <div class="kid-row">${mark(c.kind, st, 'sm')}<div data-go="${esc(c.id)}"><b>${esc(titleOf(c))}</b><p>${esc(label)} ${ago(c.since)} · ${esc(c.name)}${c.summary ? ' · ' + esc(c.summary) : ''}</p></div>
          ${['gone', 'ended'].includes(c.state) ? '' : `<button class="btn" data-stop="${esc(c.id)}">${t('停止')}</button>`}</div>`; }).join('')}</div></div>` : ''}
    </div><div>
      <div class="panel"><h4>${t('决定')}<span class="r hint">${t('{n} 条', { n: decs.length })}</span></h4><div class="d-list">${decs.length ? decs.map(d => `<div class="dec"><span class="by ${d.by}">${d.by === 'user' ? t('你') : 'AI'}</span><div class="w">${esc(d.what)}</div><time>${clock(d.at)}</time></div>`).join('') : `<div class="hint">${t('还没有记下决定。会话里拍板的事会自动记在这里。')}</div>`}</div></div>
      <div class="panel"><h4>${t('在哪里')}</h4><dl class="kv">${parentOf(s) ? `<dt>${t('启动者')}</dt><dd><a data-go="${esc(parentOf(s).id)}">${esc(parentOf(s).name)}</a></dd>` : s.origin ? `<dt>${t('启动方式')}</dt><dd>${esc(originT(s.origin))}</dd>` : ''}
        <dt>${t('项目')}</dt><dd>${projSelect(s)}</dd><dt>${t('工作项')}</dt><dd>${s.work ? esc(home(s.work)) + (s.branch ? ` (${esc(s.branch)})` : '') : '—'}</dd>
        <dt>${t('组')}</dt><dd>${s.loc ? esc(groupName(s.loc.session)) + (s.loc.mux === 'tmux' ? ' (tmux)' : '') : groupName('~none')}</dd><dt>${t('窗格')}</dt><dd>${s.loc ? esc(s.loc.pane) : '—'}</dd>
        <dt>${t('目录')}</dt><dd>${esc(home(s.cwd) || '—')}</dd><dt>${t('会话 ID')}</dt><dd>${esc(s.session || '—')}</dd>${s.loc ? `<dt>${t('命令行')}</dt><dd>${esc(attachCmd(s.loc.session))}</dd>` : ''}</dl></div>
      <div class="panel"><h4>${t('名字')}</h4>${s.kind === 'claude' ? `<div class="hint">${t('Claude 会话的名字由它自己定：在那个会话里输入 {c}，这里、amail 和窗格标题会跟着变。', { c: `<code>/rename ${t('新名字')}</code>` })}</div>`
        : `<div class="inline"><input class="field" id="rName" placeholder="${t('新名字（字母、数字、_ . -）')}"><button class="btn" data-act="rename">${t('改名')}</button></div>`}</div>
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
  return `<div class="reply"><textarea id="rText" placeholder="${t('对 {n} 说……  ⌘/Ctrl+Enter 发送', { n: esc(s.name) })}"></textarea><div class="row" id="sayRow">${sayRow(s)}</div></div>`;
}
function sayRow(s) {
  const how = sayHow(s), [label, hint] = SAY[how].map(x => t(x));
  return `${micBtn('rText')}<button class="btn" data-act="draft">${I.spark}${t('帮我起草')}</button><span class="sp"></span>
    ${how === 'queue' ? `<button class="btn" data-act="say-now" title="${t('不等了：现在就打进它的终端')}">${t('现在就插进去')}</button>` : ''}
    ${how === 'menu' ? `<button class="btn dark" data-tab-go="term" ${webOk(s) ? '' : 'disabled'}>${I.enter}${label}</button>` : `<button class="btn primary" data-act="say" ${how === 'gone' ? 'disabled' : ''}>${how === 'type' ? I.enter : how === 'mail' ? I.mail : I.arrow}${label}</button>`}
    <div class="say-hint">${hint}</div>`;
}
// which project it counts as: as found (its folder, the files it works on), or the person's word
function projSelect(s) {
  const w = wsOf(s.workspace), keys = w ? w.projects : Object.keys(S.projects || {});
  const found = { cwd: t('按它的目录'), files: t('按它改的文件'), workspace: t('它在工作区顶层'), manual: '', '': t('看不出') }[s.attrib || ''] ?? '';
  const cur = s.attrib === 'manual' ? (s.project || (s.workspace ? 'w:' + s.workspace : '')) : '';
  return `<select class="sel" data-attrib="${esc(s.id)}"><option value="">${s.attrib === 'manual' ? t('改回自动判断') : t('{a}：{b}', { a: found, b: s.project ? esc(projOf(s.project).name) : t('没有项目') })}</option>
    ${keys.map(k => `<option value="${esc(k)}"${cur === k ? ' selected' : ''}>${esc(projOf(k).name)}</option>`).join('')}${w ? `<option value="w:${esc(w.key)}"${cur === 'w:' + w.key ? ' selected' : ''}>${t('工作区本身')}</option>` : ''}</select>`;
}

// ---------- a project: its work items and their sessions, its channel, its sessions ----------
function renderProject() {
  const p = projOf(route.key);
  if (!p) {
    draw('hero', ['missing', route.key], () => { $('#hero').innerHTML = `<div class="s-hero"><div class="row"><h1>${t('没有这个项目')}</h1></div><div class="tabs"></div></div>`; $('#tabBody').innerHTML = `<div class="s-body"><a class="btn" href="#/">${I.back}${t('回到总览')}</a></div>`; });
    return;
  }
  const w = wsOf(p.workspace), f = p.facts || {}, b = boardOf(p.key), ss = S.sessions.filter(x => x.project === p.key), tab = route.tab;
  $('#crumbs').innerHTML = `${w ? `${I.chev}<a href="#/w/${encodeURIComponent(w.key)}">${esc(w.name)}</a>` : ''}${I.chev}<b>${esc(p.name)}</b>`;
  draw('hero', [p.key, p.name, f.main, f.tag, f.url, f.ahead, f.behind, b && b.unread, ss.length, tab], () => {
    const up = f.ahead || f.behind ? ` · ${f.ahead && f.behind ? t('比远端多 {a} 个提交、少 {b} 个', { a: f.ahead, b: f.behind }) : f.ahead ? t('比远端多 {n} 个提交', { n: f.ahead }) : t('比远端少 {n} 个', { n: f.behind })}` : f.ahead === 0 ? ` · ${t('和远端一致')}` : '';
    $('#hero').innerHTML = `<div class="s-hero proj"><div class="row"><span class="mark lg pj">${I.folder}</span><div style="min-width:0"><h1>${esc(p.name)}</h1>
        <div class="sub">${w ? `<span>${t('工作区 {name}', { name: esc(w.name) })}</span>` : ''}<span class="nm">${esc(home(p.path))}</span>${p.git ? `<span>${I.branch}${esc(f.main || '')}${f.tag ? ' · ' + esc(f.tag) : ''}${up}</span>` : `<span>${t('文件夹，不是 git 仓库')}</span>`}${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.url.replace(/^https:\/\//, ''))}</a>` : ''}</div></div>
      </div>
      <nav class="tabs">${[['overview', t('概览')], ['board', t('讨论') + (b && b.unread ? ' · ' + t('{n} 条新', { n: b.unread }) : '')], ['sessions', `${t('会话')} · ${ss.length}`]].map(([x, l]) => `<button data-ptab="${x}" class="${tab === x ? 'on' : ''}">${esc(l)}</button>`).join('')}
        <div class="acts"><button class="hbtn primary" data-newp="${esc(p.key)}">${I.plus}${t('在这里新建会话')}</button></div></nav></div>`;
  });
  if (tab === 'board') {
    if (!$('#boardBox')) { $('#tabBody').innerHTML = `<div class="s-body wide" id="boardBox"></div>`; BD.key = null; }
    drawBoard(p.key, $('#boardBox'));
  } else if (tab === 'sessions') {
    draw('tab', ['psess', p.key, ss.map(x => [x.id, x.state, x.status, x.title, x.summary, x.stale, x.needs_you, x.tool]), tick()], () => {
      $('#tabBody').innerHTML = `<div class="s-body wide">${ss.length ? `<div class="cards">${ss.map(card).join('')}</div>` : `<div class="calm">${t('现在没有会话在这个项目上。')}</div>`}</div>`;
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
    const sRow = x => { const [st, label] = standing(x); return `<div class="wi-s" data-go="${esc(x.id)}">${mark(x.kind, st, 'sm')}<b>${esc(titleOf(x))}</b><span><em class="${st}">${label}</em> · ${esc(x.name)}${x.attrib === 'files' ? ' · ' + t('按它改的文件') : x.attrib === 'manual' ? ' · ' + t('你指定的') : ''}</span></div>`; };
    const chips = w => [w.ahead ? t('比 {m} 多 {n} 个提交', { m: esc(f.main), n: w.ahead }) : '', w.behind ? t('落后 {n} 个', { n: w.behind }) : '', w.dirty ? t('{n} 个文件没提交', { n: w.dirty }) : '', !w.main && w.ahead === 0 ? t('已在 {m} 里', { m: esc(f.main) }) : '']
      .filter(Boolean).map(c => `<span class="wchip">${c}</span>`).join('');
    const wi = w => `<div class="wi${w.main ? ' main' : ''}"><div class="wi-head">${I.branch}<b>${esc(w.branch || t('（没有分支）'))}</b>${w.main ? `<span class="tag">${t('主工作区')}</span>` : ''}<span class="sp"></span>${chips(w)}</div>
      <div class="wi-path">${esc(home(w.path))}${w.subject ? ` · <code>${esc(w.head)}</code> ${esc(w.subject)} · ${t('{t}前', { t: ago(w.at) })}` : ''}</div>
      ${w.ss.length ? `<div class="wi-ss">${w.ss.map(sRow).join('')}</div>` : ''}</div>`;
    const qk = 'wi:' + p.key;
    const left = `<div class="panel"><h4>${t('工作项')}<span class="r hint">${works.length ? t('{n} 个 worktree · 一个工作项就是一个 worktree 和它的分支', { n: works.length }) : ''}</span></h4>
      ${p.git ? busy.map(wi).join('') : `<div class="hint">${t('这个项目是个文件夹，没有分支和 worktree。')}</div>`}
      ${loose.length ? `<div class="wi loose"><div class="wi-head"><b>${t('看不出在哪个工作项')}</b></div><div class="wi-ss">${loose.map(sRow).join('')}</div></div>` : ''}
      ${idle.length ? `<button class="quiet-tg" data-quiet="${esc(qk)}">${chev(quietOpen.has(qk))}${t('没有会话的 {n} 个工作项', { n: idle.length })}</button>${quietOpen.has(qk) ? idle.map(wi).join('') : ''}` : ''}
      ${!ss.length ? `<div class="hint" style="margin-top:10px">${t('现在没有会话在这个项目上。')}</div>` : ''}</div>`;
    const open = b ? b.topics.filter(t => !t.closed) : [];
    const right = `<div class="panel"><h4>${t('讨论区')}<span class="r"><a class="lnk" href="#/p/${encodeURIComponent(p.key)}/board">${t('打开')}</a></span></h4>
        ${b && b.last ? `<div class="m">${face(b.last.from)}<div><div class="route"><b>${esc(who(b.last.from))}</b><time>${clock(b.last.at)}</time></div><div class="txt">${md(b.last.text)}</div></div></div>${b.unread ? `<div class="hint">${t('{n} 条新消息', { n: b.unread })}</div>` : ''}`
          : `<div class="hint">${t('还没有人在这里说过话。发在这里的话，在这个项目上工作的会话都会收到。')}</div>`}
        ${open.map(tp => `<a class="topic-line" href="#/p/${encodeURIComponent(p.key)}/board" data-topic-open="${esc(tp.id)}">${I.chat}<b>${esc(tp.title)}</b><span>${t('{n} 方在谈', { n: tp.members.length })}</span></a>`).join('')}</div>
      ${lock ? `<div class="panel"><h4>${t('推送锁')}</h4><div class="hint">${I.lock} ${t('{b} 被 {h} 锁着，{t}前锁上', { b: esc(lock.branch), h: esc(lock.holder), t: ago(lock.since) })}${lock.note ? t('：{n}', { n: esc(lock.note) }) : ''}</div></div>` : ''}
      <div class="panel"><h4>${t('决定')}<span class="r hint">${t('{n} 条', { n: decs.length })}</span></h4><div class="d-list">${decs.length ? decs.map(d => `<div class="dec"><span class="by ${d.by}">${d.by === 'user' ? t('你') : 'AI'}</span><div class="w">${esc(d.what)}<div class="src">${esc(d.name)}</div></div><time>${clock(d.at)}</time></div>`).join('') : `<div class="hint">${t('这个项目上的会话还没记下决定。')}</div>`}</div></div>
      ${refs.length ? `<div class="panel"><h4>${t('产出')}</h4><div class="refs">${refs.map(x => /^https?:\/\//.test(x) ? `<a href="${esc(x)}" target="_blank" rel="noopener noreferrer">${esc(refLabel(x))}</a>` : `<code>${esc(x)}</code>`).join('')}</div></div>` : ''}`;
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
    box.innerHTML = `<div class="board"><aside class="b-side" id="bSide"></aside><section class="b-main"><div id="bForm"></div><div id="bHead"></div><div class="b-posts" id="bPosts"><div class="hint">${t('读取中……')}</div></div>
      <form class="composer b-comp" id="bComp" autocomplete="off"><div class="composer-box"><textarea id="bText" rows="1"></textarea><span id="bMic"></span><button class="send" type="submit" title="${t('发送')}">${I.arrow}</button></div><div class="b-calls" id="bCalls"></div></form></section></div>`;
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
  let tp = BD.topic && d.topics.find(x => x.id === BD.topic);
  if (BD.topic && !tp) { BD.topic = ''; tp = null; }
  const count = id => d.posts.filter(p => p.topic === id).length, closed = d.topics.filter(x => x.closed);
  $('#bSide').innerHTML = `<button class="btn b-new" data-bform>${I.plus}${t('发起讨论')}</button>
    <div class="b-t${!tp ? ' on' : ''}" data-btopic="">${I.chat}<b>${t('全部')}</b><span>${d.posts.length}</span></div>
    ${d.topics.filter(x => !x.closed).map(x => `<div class="b-t${tp && tp.id === x.id ? ' on' : ''}" data-btopic="${esc(x.id)}"><i class="live"></i><b>${esc(x.title)}</b><span>${count(x.id)}/${x.max}</span></div>`).join('')}
    ${closed.length ? `<div class="b-sub">${t('结束了的')}</div>${closed.map(x => `<div class="b-t done${tp && tp.id === x.id ? ' on' : ''}" data-btopic="${esc(x.id)}"><i></i><b>${esc(x.title)}</b><span>${count(x.id)}</span></div>`).join('')}` : ''}
    <div class="b-sub">${t('收得到这里的会话')}</div><div class="b-members">${d.members.length ? d.members.map(n => `<span class="b-mem" title="${esc(n)}">${face(n)}<span>${esc(n)}</span></span>`).join('') : `<span class="hint">${t('还没有。在这个项目上工作的会话下一轮开始时加入。')}</span>`}</div>`;
  $('#bHead').innerHTML = tp ? `<div class="b-topic"><div><b>${esc(tp.title)}</b><span>${tp.members.map(n => esc(who(n))).join(t('、'))} · ${t('{a}/{b} 条', { a: count(tp.id), b: tp.max })}${tp.closed ? ' · ' + t('已结束') : ''}</span></div>${tp.closed ? '' : `<button class="btn" data-bclose="${esc(tp.id)}">${t('结束讨论')}</button>`}</div>` : '';
  const list = tp ? d.posts.filter(p => p.topic === tp.id) : d.posts, box = $('#bPosts'), atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.innerHTML = list.length ? list.map(p => postHtml(p, d, tp)).join('') : `<div class="b-empty">${tp ? t('这场讨论还没有人发言。') : t('还没有人在这里说过话。<br>发在这里的话，收得到这里的会话下一轮开始时都会看到；写 @名字 叫某个会话马上来看，@all 叫所有人。')}</div>`;
  if (atEnd || !BD.drawn) box.scrollTop = box.scrollHeight;
  BD.drawn = true;
  const ta = $('#bText'), shut = !!(tp && tp.closed), b = boardOf(key);
  ta.disabled = shut;
  ta.placeholder = shut ? t('这场讨论已经结束了') : tp ? t('在「{n}」里说……  参加的会话马上会看到', { n: tp.title }) : ((b && b.kind === 'workspace') || wsOf(key) ? t('写到工作区的讨论区……  Enter 发送，@名字 叫某个会话') : t('写到项目的讨论区……  Enter 发送，@名字 叫某个会话'));
  const callable = S.sessions.filter(x => live(x) && !x.unknown && (x.project === key || x.workspace === key || d.members.includes(x.name)));
  $('#bCalls').innerHTML = callable.length && !shut ? `<span>${t('叫：')}</span>${callable.map(x => `<button type="button" class="b-call" data-bcall="${esc(x.name)}" title="${esc(titleOf(x))}">${mark(x.kind, standing(x)[0], 'xs')}${esc(x.name)}</button>`).join('')}` : '';
}
function postHtml(p, d, cur) {
  const tp = p.topic && d.topics.find(x => x.id === p.topic), sys = ['amail', 'sturnus'].includes(p.from);
  const tag = tp && !cur ? `<a class="ptag" data-btopic="${esc(tp.id)}">${p.title ? t('发起') + ' · ' : ''}${esc(tp.title)}</a>` : p.title ? `<span class="ptag">${t('发起')}</span>` : '';
  return `<div class="post${p.from === 'user' ? ' mine' : ''}${sys ? ' sys' : ''}">${p.from === 'user' ? mark('user', '', 'sm') : MARK[p.kind] ? mark(p.kind, '', 'sm') : face(p.from)}
    <div class="pb"><div class="ph"><b>${esc(who(p.from))}</b>${FULL[p.kind] ? `<span>${FULL[p.kind]}</span>` : ''}${tag}<time>${clock(p.at)}</time></div><div class="pt">${atLinks(md(p.text))}</div></div></div>`;
}
function drawTopicForm() {
  const key = BD.key, el = $('#bForm');
  if (!el) return;
  if (!BD.form) { el.innerHTML = ''; return; }
  const cands = S.sessions.filter(x => live(x) && !x.unknown).sort((a, c) => (c.project === key) - (a.project === key) || ORDER(a) - ORDER(c));
  el.innerHTML = `<div class="b-form"><h4>${t('发起讨论')}</h4>
    <input class="field" id="tfTitle" placeholder="${t('题目，比如：辩论——留言板要不要按话题分')}">
    <div class="b-sub">${t('请谁来（Claude、Codex、Cursor 都可以，不在这个项目上的也行）')}</div>
    <div class="b-pick">${cands.map(x => `<label class="pk"><input type="checkbox" value="${esc(x.name)}">${mark(x.kind, standing(x)[0], 'xs')}<b>${esc(x.name)}</b><span>${esc(titleOf(x))}${x.project && x.project !== key ? ' · ' + esc((projOf(x.project) || {}).name || '') : ''}</span></label>`).join('') || `<span class="hint">${t('现在没有在跑的会话')}</span>`}</div>
    <textarea class="area" id="tfText" rows="3" placeholder="${t('开场：要讨论什么、各自的角色（比如谁是正方、谁是反方）、要得出什么')}"></textarea>
    <div class="row"><span class="hint">${t('最多')}</span><input class="field num" id="tfMax" type="number" min="2" max="200" value="24"><span class="hint">${t('条后自动结束 · 请来的会话马上会被叫来')}</span><span class="sp"></span><button type="button" class="btn" data-bform>${t('取消')}</button><button type="button" class="btn primary" data-tfgo>${t('发起')}</button></div></div>`;
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
  $('#crumbs').innerHTML = route.name === 'boards' ? `${I.chev}<a href="#/boards">${t('讨论')}</a>${I.chev}<b>${esc(name)}</b>` : `${I.chev}<a href="#/w/${encodeURIComponent(route.key)}">${esc(name)}</a>${I.chev}<b>${t('讨论区')}</b>`;
  draw('hero', ['b', route.key, name], () => {
    $('#hero').innerHTML = `<div class="s-hero proj"><div class="row"><span class="mark lg pj">${I.chat}</span><div style="min-width:0"><h1>${w ? t('{name} 工作区', { name: esc(name) }) : esc(name)}</h1>
      <div class="sub"><span>${w ? t('这个工作区里所有的会话都收得到这里的消息') : p ? t('项目 {n} 的讨论区：在这个项目上工作的会话都收得到', { n: esc(p.name) }) : t('讨论区')}</span>${w ? `<span class="nm">${esc(home(w.path))}</span>` : ''}</div></div></div><div class="tabs"></div></div>`;
  });
  drawBoard(route.key, $('#boardBox'));
}
function renderBoards() {
  draw('blist', [(S.workspaces || []).map(w => [w.key, w.projects]), Object.values(S.boards || {}).map(b => [b.key, b.unread, b.last && b.last.at, b.topics.length]), S.sessions.map(x => x.project), tick()], () => {
    const row = (k, name, kind, href) => {
      const b = boardOf(k), open = b ? b.topics.filter(t => !t.closed).length : 0;
      return `<a class="b-row" href="${href}"><span class="mark sm pj">${kind === 'workspace' ? I.chat : I.folder}</span><div class="t"><b>${esc(name)}</b>${b && b.last ? `<p><em>${esc(who(b.last.from))}</em>${t('：')}${esc(b.last.text.replace(/\s+/g, ' ').slice(0, 120))}</p>` : `<p class="none">${t('还没有人说过话')}</p>`}</div>
        <div class="r">${open ? `<span class="hint">${t('{n} 场讨论', { n: open })}</span>` : ''}${b && b.unread ? `<span class="n hot">${b.unread}</span>` : ''}${b && b.last ? `<time>${ago(b.last.at)}</time>` : ''}</div></a>`;
    };
    $('#bList').innerHTML = (S.workspaces || []).map(w => `<section class="grp"><div class="grp-head"><h3>${esc(w.name)}</h3><span class="meta"><span>${esc(home(w.path))}</span></span></div><div class="b-rows">
      ${row(w.key, t('{name} 工作区', { name: w.name }), 'workspace', `#/b/${encodeURIComponent(w.key)}`)}
      ${w.projects.filter(k => boardOf(k) || S.sessions.some(x => x.project === k)).map(k => row(k, projOf(k).name, 'project', `#/p/${encodeURIComponent(k)}/board`)).join('')}</div></section>`).join('') || `<div class="empty-line">${t('还没有工作区')}</div>`;
  });
}

let chatTimer = null;
async function drawChat(s, k) {
  if (sig.chatFor !== s.id) {
    sig.chatFor = s.id;
    $('#tabBody').innerHTML = `<div class="s-body"><div class="convo" id="convo"><div class="hint">${t('读取对话……')}</div></div><div class="chat-say">${replyBox(s)}</div></div>`;
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
      box.innerHTML = items.length ? items.map(it => `<div class="bub ${it.who}${it.who === 'assistant' ? ' ' + k : ''}">${it.who === 'tool' ? esc(it.text) : md(it.text)}${it.at && it.who !== 'tool' ? `<time>${clock(it.at)}</time>` : ''}</div>`).join('') : `<div class="hint">${t('读不到它的对话记录。')}</div>`;
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
  if (n) { n.hidden = false; n.innerHTML = `<div class="box"><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${retry ? `<p><button class="btn" data-act="retry-term">${t('重新连接')}</button></p>` : ''}</div>`; }
}
async function drawTerm(s) {
  if (termFor === s.id && $('#xterm')) return;
  closeTerm();
  termFor = s.id;
  $('#tabBody').innerHTML = `<div class="s-body full"><div class="term-wrap"><div id="xterm"></div><div class="term-note" id="termNote" hidden></div></div></div>`;
  fitTerm();
  if (!s.loc) return termNote(t('进不去'), s.group ? t('这个组已经不在了。') : t('这个会话不在 Zellij 或 tmux 里。'));
  try { await loadXterm(); } catch { return termNote(t('终端组件没加载出来'), t('刷新页面再试一次。'), true); }
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
    if (e.code !== 4001) return termNote(t('连接断开了'), t('它的会话还在，只是这个网页终端断了。'), true);
    let r = {}; try { r = JSON.parse(e.reason); } catch {}
    termNote(t('没有接上，免得 Zellij 崩掉'), t('这个 Zellij 已经开着 {held} 个文件，上限 {limit}。网页终端是它的又一个客户端，要再开约 {need} 个；超过上限 Zellij 会崩掉，里面的会话全部结束。先关掉一个连着它的终端再试；要多连几个，调高上限后重启 Zellij（见 README）。', { held: r.held, limit: r.limit, need: r.need }), true);
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
    $('#tabBody').innerHTML = `<div class="s-body"><div class="panel" style="max-width:820px"><h4>${t('和它有关的消息')}<span class="r hint">${t('{n} 条', { n: thread.length })}</span></h4>${thread.length ? thread.map(m => `
      <div class="m${openMsgs.has(m.key) ? ' open' : ''}" data-msg="${esc(m.key)}">${face(m.from)}<div><div class="route"><b>${esc(who(m.from))}</b>${I.arrow}<b>${esc(who(m.to))}</b><time>${clock(m.at)}</time></div><div class="txt">${md(m.text)}</div></div></div>`).join('') : `<div class="hint">${t('还没有。')}</div>`}</div></div>`;
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
  $('#qRec').innerHTML = `<div class="rec"><p class="hint">${group ? t('助手在看 {p} 组里各个会话在做什么……', { p: esc(groupName(group)) }) : t('助手在看各个会话在做什么……')}</p></div>`;
  const j = await api('recommend', { text, group }).catch(e => ({ ok: false, msg: e.message }));
  if (!j.ok) { $('#qRec').innerHTML = `<div class="rec"><p class="hint">${esc(j.msg || t('助手没给出建议'))}</p></div>`; return; }
  REC = { ...j, text };
  $('#qRec').innerHTML = `<div class="rec"><h4>${t('助手的建议')}</h4>
    ${j.to ? `<div class="rec-opt"><div><b>${t('交给「{n}」', { n: esc(j.to.title || j.to.name) })}</b><span>${esc(j.to.name)} · ${esc(groupName(j.to.group || '~none'))}</span><p>${esc(j.why)}</p></div><button class="btn primary" data-rec="to">${t('交给它')}</button></div>` : ''}
    ${j.new ? `<div class="rec-opt"><div><b>${t('新开一个 {k} 会话', { k: FULL[j.new.kind] })}</b><span>${esc(groupName(j.new.group))} · ${esc(home(j.new.cwd))}${j.new.name ? ' · ' + esc(j.new.name) : ''}</span><p>${esc(j.new.why)}</p></div><button class="btn${j.to ? '' : ' primary'}" data-rec="new">${t('新建并交给它')}</button></div>` : ''}
    ${!j.to && !j.new ? `<p class="hint">${esc(j.why || t('没找到合适的会话'))}</p>` : ''}</div>`;
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
    const opts = [...Object.keys(S.groups || {}).map(g => [`g:${g}`, t('{g} 组里先空下来的会话', { g })]), ['g:', t('任何一个先空下来的会话')], ...live.map(s => [`s:${s.name}`, `${titleOf(s)} · ${s.name}`])];
    const key = opts.map(o => o[0]).join();
    if (sel.dataset.opts !== key) { const cur = sel.value; sel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join(''); sel.dataset.opts = key; if (cur) sel.value = cur; }
  }
  const q = S.queue || [];
  const sec = (title, list) => list.length ? `<div class="q-sec"><h3>${t(title)} · ${list.length}</h3>${list.map(qItem).join('')}</div>` : '';
  draw('queue', [q, tick()], () => {
    $('#qList').innerHTML = (sec('可以发了', q.filter(i => i.status === 'ready')) + sec('排着', q.filter(i => ['waiting', 'checking', 'held'].includes(i.status))) +
      sec('已发出', q.filter(i => i.status === 'sent').slice(0, 20)) + sec('不用发了', q.filter(i => i.status === 'dropped').slice(0, 20))) || `<div class="hint">${t('还没有排队的事。')}</div>`;
  });
}
function qItem(i) {
  const target = i.to ? i.to : i.group ? t('{g} 组里先空下来的', { g: i.group }) : t('任何一个先空下来的');
  const acts = i.status === 'ready' ? `<button class="btn primary" data-q="send" data-id="${i.id}">${t('发给 {n}', { n: esc(i.ready_to || i.to) })}</button><button class="btn" data-q="drop" data-id="${i.id}">${t('不发了')}</button>`
    : ['waiting', 'held', 'checking'].includes(i.status) ? `${i.to ? `<button class="btn" data-q="send" data-id="${i.id}" title="${t('不等了，现在就发')}">${t('现在就发')}</button>` : ''}<button class="btn" data-q="drop" data-id="${i.id}">${t('不发了')}</button>`
      : i.status === 'dropped' ? `<button class="btn" data-q="restore" data-id="${i.id}">${t('重新排上')}</button><button class="btn" data-q="delete" data-id="${i.id}">${t('删除')}</button>`
        : `<button class="btn" data-q="delete" data-id="${i.id}">${t('删除')}</button>`;
  return `<div class="q-item ${i.status}"><span class="bar4"></span><div>
    <div class="txt">${esc(i.sent_text || i.text)}</div>
    <div class="meta"><span>${t('交给')} <b>${esc(target)}</b></span><span>${t(QST[i.status] || i.status)}${i.status === 'sent' && i.sent_to ? ' → ' + esc(i.sent_to) : ''}</span><span>${i.mode === 'auto' ? t('助手确认后自动发') : t('空了提醒我')}</span><span>${t('{t}前写的', { t: ago(i.created) })}</span></div>
    ${i.note ? `<div class="note">${esc(i.note)}</div>` : ''}</div><div class="acts">${acts}</div></div>`;
}

// ---------- status bar ----------
function drawStatus() {
  const sm = S.summarizer || {}, a = S.about || {};
  $('#status').innerHTML = `<span>${sm.error ? `<span class="warn">${t('总结模型出错，去设置里看看')}</span>` : `${t('总结：{m}', { m: esc(a.model || '') })}${sm.busy ? t(' · 正在更新') : ''}`}</span>
    <span class="r">${t('刷新于 {t}', { t: agoT(lastOk / 1000) })}</span><span>Sturnus ${esc(S.version)}</span>`;
}

// ---------- palette ----------
let palIndex = 0;
function openPalette() { closeOverlays(); $('#palette').hidden = false; $('#paletteQ').value = ''; palIndex = 0; drawPalette(); setTimeout(() => $('#paletteQ').focus(), 20); }
function palPlaces() {  // (workspaces and projects whose name matches: before the sessions)
  const q = $('#paletteQ').value.trim().toLowerCase();
  if (!q) return [];
  return [...(S.workspaces || []).filter(w => w.name.toLowerCase().includes(q)).map(w => ({ href: `#/w/${encodeURIComponent(w.key)}`, label: w.name, sub: t('工作区 · {p}', { p: home(w.path) }), ws: w })),
    ...Object.values(S.projects || {}).filter(p => p.name.toLowerCase().includes(q)).slice(0, 6).map(p => ({ href: `#/p/${encodeURIComponent(p.key)}`, label: p.name, sub: t('项目 · {w}', { w: (wsOf(p.workspace) || {}).name || '' }) }))].slice(0, 8);
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
      <span class="loc">${s.loc ? `${esc(groupName(s.loc.session))}:${esc(s.loc.pane)}` : esc(folder(s.cwd))}</span></div>`).join('') : `<div class="p-sec">${t('没有匹配的工作区、项目或会话')}</div>`;
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
  const isNew = NS.group === '+', g = isNew ? NS.newGroup || t('<新组名>') : groupName(NS.group);
  if ((isNew ? NS.mux : muxOf(NS.group)) === 'tmux') return `tmux ${isNew ? `new-session -d -s ${g}` : `new-window -t ${g}:`} -c ${NS.cwd} -- ${cmd}`;
  return `zellij --session ${g} action new-tab  →  cd ${NS.cwd} && ${cmd}`;
}
function drawNew() {
  const groups = Object.keys(S.groups || {}), isNew = NS.group === '+';
  const muxes = S.muxes || ['zellij'];
  $('#newBody').innerHTML = `<h3>${t('新建会话')}</h3><p class="lead">${t('在一个组（Zellij 或 tmux 会话）里开一个新标签页或窗口，把 agent 跑起来。之后在这里和在终端里都能管理它。')}</p>
    <div class="f-row"><label>${t('开什么')}</label><div class="choice">${['claude', 'codex', 'cursor', 'shell'].map(k => `
      <button type="button" class="${NS.kind === k ? 'on' : ''}" data-kind="${k}">${mark(k, '', 'sm')}<div><b>${k === 'shell' ? t('终端') : FULL[k]}</b><span>${t({ claude: '对话与长任务', codex: '终端里的编码', cursor: '编辑器风格的 agent', shell: '组里的一个 shell' }[k])}</span></div></button>`).join('')}</div></div>
    <div class="f-row top"><label>${t('组')}</label><div class="choice groups">${groups.map(n => `
      <button type="button" class="${NS.group === n ? 'on' : ''}" data-group="${esc(n)}"><b>${esc(groupName(n))}${muxTag(n)}</b><span>${t('{n} 个会话', { n: S.groups[n].agents })} · ${S.groups[n].clients.length ? t('有终端连着') : t('后台')}</span></button>`).join('')}
      <button type="button" class="newg ${isNew ? 'on' : ''}" data-group="+"><b>+ ${t('新组')}</b><span>${t('新建一个 {m} 会话', { m: muxes.length > 1 ? t('Zellij 或 tmux') : muxes[0] === 'tmux' ? 'tmux' : 'Zellij' })}</span></button></div></div>
    ${isNew ? `<div class="f-row"><label>${t('新组名')}</label><input class="field" id="nsGroup" value="${esc(NS.newGroup)}" placeholder="${t('比如 release、envhub、review')}"></div>
      ${muxes.length > 1 ? `<div class="f-row"><label>${t('用')}</label><div class="seg">${muxes.map(m => `<button type="button" data-mux="${m}" class="${NS.mux === m ? 'on' : ''}">${m === 'tmux' ? 'tmux' : 'Zellij'}</button>`).join('')}</div></div>` : ''}` : ''}
    <div class="f-row"><label>${t('目录')}</label><div class="inline"><input class="field" id="nsCwd" list="nsDirs" value="${esc(NS.cwd)}" placeholder="~/projects/..."><datalist id="nsDirs">${(S.dirs || []).map(d => `<option value="${esc(d)}">`).join('')}</datalist>
      <button type="button" class="btn" data-browse>${I.folder}${t('浏览')}</button></div></div>
    ${NS.tree ? `<div class="f-row top"><label></label><div class="tree" id="nsTree"></div></div>` : ''}
    <div class="f-row"><label>${t('名字')}</label><input class="field" id="nsName" value="${esc(NS.name)}" placeholder="${t('可选：会话、amail 和窗格标题都用这个名字')}"></div>
    ${NS.kind === 'shell' ? '' : `<div class="f-row top"><label>${t('初始任务')}</label><div class="with-mic"><textarea class="area" id="nsPrompt" rows="3" placeholder="${t('可选：开起来就交给它的第一件事')}">${esc(NS.prompt)}</textarea>${micBtn('nsPrompt')}</div></div>`}
    <div class="f-row top"><label>${t('等同于')}</label><div class="code" id="nsCli">${esc(cliText())}</div></div>
    <div class="f-foot"><label class="check"><input type="checkbox" id="nsJump" ${NS.jump ? 'checked' : ''}> ${t('建好后打开它')}</label><button class="btn" data-close>${t('取消')}</button><button class="btn primary" id="nsGo">${I.plus}${t('新建')}</button></div>`;
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
      <input class="field" id="treeQ" placeholder="${t('筛选')}" autocomplete="off"></div>
    <div class="tree-list">${j.dirs.map(n => `<div class="tree-d" data-dir="${esc(j.path.replace(/\/$/, '') + '/' + n)}">${I.folder}${esc(n)}</div>`).join('') || `<p class="hint">${t('这里没有子目录')}</p>`}${j.more ? `<p class="hint">${t('还有 {n} 个没列出，用筛选找', { n: j.more })}</p>` : ''}</div>
    <div class="tree-foot"><span class="hint">${esc(j.show)}</span><button type="button" class="btn primary" data-pick>${t('选这个目录')}</button></div>`;
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
  if (!group) { toast(t('先选一个组，或给新组起个名字'), false); return; }
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
  return `<div class="mblock" data-role="${role}"><h4>${title}</h4><div class="what">${what} · ${t('现在：{m}', { m: esc(mlabel(m.label)) })}</div>
    <div class="f-row"><label>${t('运行在')}</label><div class="seg">${[['claude', 'Claude Code'], ['codex', 'Codex'], ['pi', 'pi'], ['api', 'API']].map(([k, l]) => `<button type="button" data-src="${k}" class="${src === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="f-row"><label>${t('模型')}</label><input class="field" data-f="model" list="ml-${role}" value="${esc(src === m.source ? m.model : (MODEL_HINTS[src] || [''])[0])}" placeholder="${src === 'codex' || src === 'pi' ? t('留空用它自己的默认模型') : t('模型名')}"><datalist id="ml-${role}">${(MODEL_HINTS[src] || []).filter(Boolean).map(x => `<option value="${x}">`).join('')}</datalist></div>
    ${src === 'api' ? `<div class="f-row"><label>${t('接口地址')}</label><input class="field" data-f="url" value="${esc(m.url || '')}" placeholder="https://api.example.com/v1"></div>
      <div class="f-row"><label>API Key</label><input class="field" data-f="key" type="password" value="${esc(m.key || '')}" placeholder="${t('只存在本机（权限 600）')}"></div>` : ''}
    <div class="f-row"><label></label><div class="inline"><button class="btn" data-mact="test">${t('测试')}</button><button class="btn primary" data-mact="save">${t('保存并使用')}</button></div></div>
    <div class="result" id="res-${role}"></div></div>`;
}
const MB = {};
function drawSettings() {
  document.querySelectorAll('#settingsNav button').forEach(b => b.classList.toggle('on', b.dataset.pane === pane));
  const a = S.about || {}, th = store.get('deck.theme', 'auto');
  $('#settingsBody').innerHTML = {
    models: `<h3>${t('助手与模型')}</h3>
      <div class="opt"><div><h4>${t('agent 的工作语言')}</h4><p>${t('总结、简报、助手的回答、帮你起草的话用哪种语言写。已经写好的，等它们下次更新时换过来。')}</p></div><div class="seg">${[['zh', '中文'], ['en', 'English']].map(([k, l]) => `<button data-work-lang="${k}" class="${(S.work_lang || 'zh') === k ? 'on' : ''}">${l}</button>`).join('')}</div></div><p class="lead">${t('可以用本机装的任何 agent 运行时（Claude Code、Codex、pi，用它们自己的登录），也可以接一个 API。保存后马上生效。')}</p>
      ${modelBlock('assist', t('助手 agent'), t('替你看排队的事还要不要做、发给谁；帮你起草回复'))}
      ${modelBlock('summary', t('总结模型'), t('给每个会话起任务名、写进展、判断要不要你处理、记下决定（用小而快的模型就好）'))}
      ${S.summarizer && S.summarizer.error ? `<div class="code">${t('最近一次总结出错：{m}', { m: esc(S.summarizer.error) })}</div>` : ''}`,
    look: `<h3>${t('显示')}</h3><p class="lead">${t('这台机器上的显示偏好。')}</p>
      <div class="opt"><div><h4>${t('语言')}</h4><p>${t('页面用的语言。')}</p></div><div class="seg">${[['auto', t('跟随系统')], ['zh', '中文'], ['en', 'English']].map(([k, l]) => `<button data-lang-set="${k}" class="${store.get('deck.lang', 'auto') === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="opt"><div><h4>${t('主题')}</h4><p>${t('跟随系统，或固定浅色、深色。')}</p></div><div class="seg">${[['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(([k, l]) => `<button data-theme-set="${k}" class="${th === k ? 'on' : ''}">${t(l)}</button>`).join('')}</div></div>
      <div class="opt col"><div><h4>${t('工作区图标')}</h4><p>${t('最左边那条栏里工作区的颜色。')}</p></div>
        <div class="wsc-pick">${Object.entries(WSC).map(([k, l]) => `<button class="wsc-card${store.get('deck.wsColor', 'graphite') === k ? ' on' : ''}" data-wscolor="${k}" aria-pressed="${store.get('deck.wsColor', 'graphite') === k}">
          <span class="wsc-prev" data-look="${k}">${[['S', 0], ['N', 1], ['D', 3]].map(([c, i]) => `<i style="--t:${MUTED[i]}">${c}</i>`).join('')}</span><b>${t(l)}</b></button>`).join('')}</div></div>
      <div class="opt"><div><h4>${t('窗格标题')}</h4><p>${t('用「状态 · 会话名 · 在做的事」做每个 agent 窗格的标题，在 Zellij 或 tmux 里一眼认出是哪个（tmux 要开 pane-border-status 才看得到）。')}</p></div><label class="switch"><input type="checkbox" id="paneTitles" ${S.pane_titles ? 'checked' : ''}></label></div>`,
    voice: voicePane(),
    access: `<h3>${t('访问')}</h3><div id="accessBody"></div>`,
    about: `<h3>Sturnus</h3><p class="lead">${t('这台机器上所有 Claude Code、Codex、Cursor 会话的入口和状态。')}</p>
      <dl class="kv"><dt>${t('版本')}</dt><dd>${esc(S.version)}</dd><dt>${t('地址')}</dt><dd>http://${esc(a.listen || '')}</dd><dt>${t('运行自')}</dt><dd>${a.started ? new Date(a.started * 1000).toLocaleString(LANG === 'en' ? 'en-GB' : 'zh-CN') : ''}</dd>
        <dt>${t('程序')}</dt><dd>${esc(home(a.app))}</dd><dt>${t('源码')}</dt><dd>${esc(home(a.source || ''))}</dd><dt>${t('设置')}</dt><dd>${esc(home(a.config))}</dd></dl>
      <h4 style="margin-top:20px">${t('命令行')}</h4><div class="code">sturnus status | upgrade | uninstall [--purge]
amail status | send | ask
zellij attach &lt;${t('组名')}&gt;  |  tmux attach -t &lt;${t('组名')}&gt;</div>
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
function asstText(tx) {  // (the answer as Markdown; [[open|report|term:name]] become links to the session)
  const links = [];
  const held = String(tx).replace(/\[\[(open|report|term):([^\]]+)\]\]/g, (m, kind, name) => {
    const s = S && S.sessions.find(x => x.name === name.trim());
    links.push(s ? `<a class="s-link" data-go="${esc(s.id)}" data-tab="${kind === 'open' ? 'overview' : kind}">${mark(s.kind, standing(s)[0], 'xs')}<b>${esc(titleOf(s))}</b><em>${kind === 'report' ? t('报告') : kind === 'term' ? t('终端') : esc(s.name)}</em></a>` : esc(name.trim()));
    return `@@L${links.length - 1}@@`;
  });
  return md(held).replace(/@@L(\d+)@@/g, (m, n) => links[+n]);
}
function drawAsst(frame) {
  const box = $('#asst');
  if (!box || box.hidden || !S) return;
  if (frame || !$('#asstList')) {
    const keep = $('#asstQ') ? $('#asstQ').value : '';
    box.innerHTML = `<div class="asst-head">${I.spark}<b>${t('助手')}</b><span class="hint">${esc(mlabel(((S.models || {}).assist || {}).label))}</span>
        <button class="lnk" data-asst-clear title="${t('清空这段对话')}">${t('清空')}</button><button class="lnk x" data-asst-close title="${t('收起（⌘/Ctrl+J）')}">${t('收起')}</button></div>
      <div class="asst-list" id="asstList"></div>
      <form class="asst-in" id="asstForm" autocomplete="off"><textarea id="asstQ" rows="2" placeholder="${t('问各个会话的事：谁在等我、哪个在做什么、定过什么……  Enter 发送')}"></textarea>
        <div class="asst-row">${micBtn('asstQ')}<span class="sp"></span><button class="send" type="submit" title="${t('发送')}">${I.arrow}</button></div></form>`;
    const ta = $('#asstQ');
    ta.value = keep;
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#asstForm').requestSubmit(); } });
    $('#asstForm').addEventListener('submit', e => { e.preventDefault(); const q = ta.value.trim(); if (q && !ASST.busy) { ta.value = ''; asstAsk(q); } });
  }
  const list = $('#asstList');
  list.innerHTML = ASST.msgs.length ? ASST.msgs.map(m => m.who === 'user' ? `<div class="a-q">${esc(m.text)}</div>` : `<div class="a-a${m.bad ? ' bad' : ''}">${asstText(m.text)}</div>`).join('')
      + (ASST.busy ? `<div class="a-a busy"><i></i><i></i><i></i>${t('在翻各个会话……')}</div>` : '')
    : `<div class="a-empty"><p>${t('问我各个会话的事：我看得到每个会话在做什么、到哪了、定过什么、谁在等你，也能帮你找到它。')}</p>${ASK_SAMPLES.map(x => t(x)).map(x => `<button class="a-sample" data-asst-ask="${esc(x)}">${esc(x)}</button>`).join('')}</div>`;
  list.scrollTop = list.scrollHeight;
}
async function asstAsk(q) {
  ASST.msgs.push({ who: 'user', text: q }); ASST.busy = true; drawAsst(); $('#asstBtn').classList.add('busy');
  const j = await api('assistant', { q, history: ASST.msgs.slice(-7, -1) }).catch(e => ({ ok: false, msg: e.message }));
  ASST.busy = false;
  ASST.msgs.push({ who: 'assistant', text: j.ok ? j.answer : (j.msg || t('没答上来')), bad: !j.ok });
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
  return `<h3>${t('语音输入')}</h3><p class="lead">${t('开启后，写字的地方会多一个麦克风：点一下开始说，再点一下停，转出来的文字放到光标处。录音只转给你选的服务。')}</p>
    <div class="v-now"><span class="dot ${sv.on && keys[sv.provider] ? 'working' : ''}"></span>${t('现在用的：')}<b>${esc(mlabel(sv.label))}</b>${keys[sv.provider] ? '' : ` · <em>${t('还没填 key')}</em>`}${sv.on ? '' : ` · ${t('关着')}`}</div>
    <div class="opt"><div><h4>${t('开启语音输入')}</h4><p>${window.isSecureContext ? t('这个页面可以用麦克风。') : t('这个地址不是 https，浏览器不让网页用麦克风：本机用 http://127.0.0.1:7788，或给 tailnet 开 https。')}</p></div><label class="switch"><input type="checkbox" id="vOn" ${sv.on ? 'checked' : ''}></label></div>
    <div class="mblock"><h4>${t('接入方式')}</h4>
      <div class="f-row"><label>${t('服务')}</label><div class="seg">${Object.entries(VS).map(([k, l]) => `<button type="button" data-vs="${k}" class="${v.provider === k ? 'on' : ''}">${t(l)}${k === sv.provider ? ' ·' : ''}</button>`).join('')}</div></div>
      <div class="f-row"><label>${t('模型')}</label><input class="field" id="vModel" value="${esc(v.model || '')}" placeholder="${esc((sv.defaults || VMODEL)[v.provider] || '')}"></div>
      ${v.provider === 'openai' ? `<div class="f-row"><label>${t('接口地址')}</label><input class="field" id="vUrl" value="${esc(v.url || '')}" placeholder="${t('https://api.openai.com/v1（也可以是 Groq 等兼容的）')}"></div>` : ''}
      <div class="f-row"><label>API Key</label><input class="field" id="vKey" type="password" value="${esc(v.key || '')}" placeholder="${t('{p} 的 key，只存在本机（权限 600）', { p: esc(t(VS[v.provider])) })}"></div>
      <div class="f-row"><label>${t('语言')}</label><div class="seg">${[['', t('自动（中英混说）')], ['zh', '中文'], ['en', 'English']].map(([k, l]) => `<button type="button" data-vl="${k}" class="${(v.lang || '') === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="f-row"><label></label><div class="inline"><button class="btn" data-vact="voice_test">${t('测试')}</button><button class="btn primary" data-vact="voice">${t('保存并使用')}</button></div></div>
      <div class="result" id="vRes"></div></div>`;
}
function readVoice() { VE = { ...VE, model: $('#vModel').value.trim(), url: $('#vUrl') ? $('#vUrl').value.trim() : VE.url, key: $('#vKey').value.trim() }; return { ...VE, on: !!(S.voice && S.voice.on) }; }

// the microphone next to a text box: record, stop, the text at the cursor
let rec = null;
const micBtn = id => (S && S.voice && S.voice.on ? `<button type="button" class="mic${rec && rec.id === id ? ' on' : ''}" data-mic="${id}" title="${t('语音输入（{l}）：点一下开始，再点一下停', { l: esc(mlabel(S.voice.label)) })}">${I.mic}</button>` : '');
async function micToggle(id) {
  if (rec) { rec.mr.stop(); return; }
  if (!window.isSecureContext || !navigator.mediaDevices) { toast(t('这个地址不是 https，浏览器不让网页用麦克风：本机用 http://127.0.0.1:7788，或给 tailnet 开 https'), false); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { toast(t('拿不到麦克风：{m}', { m: e.message }), false); return; }
  const mr = new MediaRecorder(stream), chunks = [];
  mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  mr.onstop = async () => {
    stream.getTracks().forEach(t => t.stop());
    rec = null;
    document.querySelectorAll('.mic').forEach(b => { b.classList.remove('on'); if (b.dataset.mic === id) b.classList.add('busy'); });
    const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
    try {
      const r = await fetch('/api/stt', { method: 'POST', headers: { 'X-Deck': '1', 'X-Lang': LANG, 'Content-Type': blob.type }, body: blob });
      const j = await r.json(), el = document.getElementById(id);
      if (j.ok && j.text && el) {
        toast(t('{v} 转好了', { v: j.via }));
        const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
        el.value = el.value.slice(0, a) + j.text + el.value.slice(b);
        el.focus(); el.selectionStart = el.selectionEnd = a + j.text.length;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else toast(j.msg || t('没听清'), false);
    } catch (e) { toast(t('没连上 sturnus 服务：{m}', { m: e.message }), false); }
    document.querySelectorAll('.mic.busy').forEach(b => b.classList.remove('busy'));
  };
  mr.start();
  rec = { mr, id };
  document.querySelectorAll(`.mic[data-mic="${CSS.escape(id)}"]`).forEach(b => b.classList.add('on'));
}

async function drawAccess() {
  const j = await api('access', {}).catch(() => null), b = $('#accessBody');
  if (!b || !j || !j.ok) return;
  b.innerHTML = `<p class="lead">${t('每个浏览器第一次打开都要登录令牌：在这台机器的终端里运行 {a}；{b} 换一个，所有浏览器都会退出。', { a: '<code>sturnus token</code>', b: '<code>sturnus token --rotate</code>' })}</p>
    <dl class="kv"><dt>${t('本机')}</dt><dd>${esc(j.local)}</dd>${j.tailnet ? `<dt>Tailnet</dt><dd>${esc(j.tailnet)}</dd>` : ''}</dl>
    ${j.tailnet ? `<p class="hint" style="margin-top:8px">${t('Tailnet 地址只放行你自己账号下的设备。')}</p>` : ''}
    <h4 style="margin-top:22px">${t('已登录的浏览器')}</h4>
    <div class="acc-list">${j.sessions.map(x => `<div class="acc-row"><div><div><b>${esc(x.who === '本机' ? t('本机') : x.who)}</b>${x.me ? `<span class="acc-me">${t('这个浏览器')}</span>` : ''}</div><div class="hint">${t('登录于 {t}', { t: new Date(x.at * 1000).toLocaleString(LANG === 'en' ? 'en-GB' : 'zh-CN') })}</div></div>
      <button class="btn" data-acc="${x.me ? 'me' : esc(x.key)}">${x.me ? t('退出登录') : t('移出')}</button></div>`).join('')}</div>`;
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
  if ((el = q('[data-bclose]'))) { if (confirm(t('结束这场讨论？之后就不能再往里发言了。'))) { await post('topic_close', { key: BD.key, topic: el.dataset.bclose }); boardFetch(); } return; }
  if ((el = q('[data-bcall]'))) { const ta = $('#bText'), at = ta.selectionStart ?? ta.value.length, w = `@${el.dataset.bcall} `; ta.value = ta.value.slice(0, at) + w + ta.value.slice(at); ta.focus(); ta.selectionStart = ta.selectionEnd = at + w.length; return; }
  if ((el = q('[data-tab-go]'))) { go(route.id, el.dataset.tabGo); return; }
  if ((el = q('[data-rail]'))) { railTab = el.dataset.rail; store.set('deck.rail', railTab); document.querySelectorAll('[data-rail]').forEach(b => b.classList.toggle('on', b === el)); sig.rail = ''; render(); return; }
  if ((el = q('[data-q]'))) { const b = { do: el.dataset.q, id: el.dataset.id }; if (b.do === 'delete' && !confirm(t('删掉这件排队的事？'))) return; post('queue', b); return; }
  if ((el = q('[data-qmode]'))) { qMode = el.dataset.qmode; document.querySelectorAll('[data-qmode]').forEach(b => b.classList.toggle('on', b === el)); return; }
  if ((el = q('[data-old]'))) { const k = el.dataset.old; openOld.has(k) ? openOld.delete(k) : openOld.add(k); render(); return; }
  if ((el = q('[data-msg]'))) { const k = el.dataset.msg; openMsgs.has(k) ? openMsgs.delete(k) : openMsgs.add(k); el.classList.toggle('open'); return; }
  if ((el = q('[data-pal]'))) { palOpen(palAll()[+el.dataset.pal]); return; }
  if ((el = q('[data-act]'))) {
    const act = el.dataset.act, s = route.name === 'session' && S.sessions.find(x => x.id === route.id);
    if (act === 'jump' && s) post('jump', { id: s.id });
    if (act === 'retry-term') { closeTerm(); render(); }
    if (act === 'rename' && s) { const name = $('#rName').value.trim(); if (name) post('rename', { id: s.id, name }); }
    if (act === 'draft' && s) { el.disabled = true; el.innerHTML = `${I.spark}${t('起草中…')}`; const j = await api('draft', { id: s.id }).catch(() => ({ ok: false, msg: t('没连上服务') })); el.disabled = false; el.innerHTML = `${I.spark}${t('帮我起草')}`; if (j.ok) { $('#rText').value = j.draft; $('#rText').focus(); } else toast(j.msg, false); }
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
    res.className = 'result'; res.textContent = el.dataset.vact === 'voice' ? t('保存中……') : t('测试中：送一秒静音过去……');
    const j = await api(el.dataset.vact, body).catch(e => ({ ok: false, msg: e.message }));
    if (j.ok && el.dataset.vact === 'voice') { VE = null; await load(); drawSettings(); }
    const r2 = $('#vRes'); r2.className = 'result ' + (j.ok ? 'ok' : 'bad'); r2.textContent = j.msg;
    return;
  }
  if ((el = q('[data-rec]'))) { takeRec(el.dataset.rec); return; }
  if ((el = q('[data-stop]'))) { if (confirm(t('停止这个子 agent？它和它启动的进程都会被结束。'))) post('stop', { id: el.dataset.stop }); return; }
  if ((el = q('[data-mreply]'))) { const f = document.querySelector(`.m-reply[data-mid="${CSS.escape(el.dataset.mreply)}"]`); if (f) { f.hidden = !f.hidden; if (!f.hidden) f.querySelector('input').focus(); } return; }
  if ((el = q('[data-mread]'))) { post('mail_read', { mid: el.dataset.mread }); return; }
  if ((el = q('[data-unlock]'))) { if (confirm(t('释放这把推送锁？在等它的会话会收到通知。'))) post('unlock', { key: el.dataset.unlock }); return; }
  if ((el = q('[data-quiet]'))) { toggle(quietOpen, 'deck.quietOpen', el.dataset.quiet); return; }
  if ((el = q('[data-report]'))) { e.stopPropagation(); el.disabled = true; el.textContent = t('正在写…'); post('report', { id: el.dataset.report }); return; }
  if ((el = q('[data-acc]'))) { const key = el.dataset.acc; await api('access', { do: 'drop', key }); if (key === 'me') location.reload(); else drawAccess(); return; }
  if ((el = q('[data-work-lang]'))) { await post('work_lang', { lang: el.dataset.workLang }); drawSettings(); return; }
  if ((el = q('[data-lang-set]'))) { store.set('deck.lang', el.dataset.langSet); applyLang(); applyTheme(); applyFold(); conn(); for (const k in sig) delete sig[k]; build(); render(); drawSettings(); return; }
  if ((el = q('[data-wscolor]'))) { store.set('deck.wsColor', el.dataset.wscolor); applyWsColor(); drawSettings(); return; }
  if ((el = q('[data-theme-set]'))) { store.set('deck.theme', el.dataset.themeSet); applyTheme(); drawSettings(); return; }
  if ((el = q('[data-src]'))) { const role = el.closest('.mblock').dataset.role; MB[role] = { source: el.dataset.src }; drawSettings(); return; }
  if ((el = q('[data-mact]'))) {
    const role = el.closest('.mblock').dataset.role, body = readModel(role), res = $('#res-' + role);
    res.className = 'result'; res.textContent = el.dataset.mact === 'test' ? t('测试中……') : t('保存中……');
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
applyLang();
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
