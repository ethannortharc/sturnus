"""terms - the terminals sessions run in: Zellij and tmux, and the ways a session gets one.

Everything sturnus asks of a terminal goes through here, by a pane's place:

    {'mux': 'zellij' | 'tmux', 'session': <group>, 'pane': <id>, 'sock': <tmux server socket>}

A group is a Zellij session (its name) or a tmux session ("tmux:<name>"). The deck finds where an agent runs (place_of),
types into it (type_in), reads it (pane_screen), shows it in the page (term_argv), brings a terminal to it (go_to, and
enter for `sturnus open`), and asks whether it is still there (there).

How a session GETS its terminal is one of the ways at the end of this file: a tab in a Zellij group, a window in a tmux
group, a tmux session of its own. A session outlasts its terminals (kept.py), so the way can be changed at any time: the
next terminal a session is given is opened the new way, and nothing is moved. Another way is one more class here.
"""
import functools
import hashlib
import json
import os
import re
import resource
import shutil
import subprocess
import sys
import threading
import time

A = None  # (amail: what it knows of processes; given by setup(), with the rest)
CACHE = WASM = VERSION = ''
tx = lambda zh, en: zh  # (the words shown: Chinese or English, as the deck decides)
config = dict


def setup(amail, say, conf, cache, wasm, version):
    global A, tx, config, CACHE, WASM, VERSION
    A, tx, config, CACHE, WASM, VERSION = amail, say, conf, cache, wasm, version


def run(argv, timeout=10, **kw):
    try:
        return subprocess.run(argv, capture_output=True, text=True, timeout=timeout, **kw)
    except (OSError, subprocess.TimeoutExpired) as e:
        return subprocess.CompletedProcess(argv, 1, '', str(e))


# ---------- processes and Zellij ----------

def procs():
    out = []
    for pid in A.pids():
        p = A.proc(pid)
        if not p or p[0] not in ('claude', 'codex', 'zellij', 'cursor-agent', 'agent', 'node', 'MainThread'):
            continue
        args = A.proc_args(pid)
        if args is not None:
            out.append({'pid': pid, 'comm': p[0], 'args': args, 'start': p[2]})
    return out


# A group is a Zellij session (its name) or a tmux session ("tmux:<name>"); an agent's place is a pane in it:
# {'mux': 'zellij' | 'tmux', 'session': <group>, 'pane': <id>, 'sock': <tmux server socket>}.

def environ(pid):
    return A.proc_env(pid)


def place_of(pid):
    """Where a process runs: the innermost multiplexer's pane (tmux started in a Zellij pane is tmux's)."""
    env = environ(pid)
    if env.get('TMUX') and env.get('TMUX_PANE'):
        return TMUX.place(env['TMUX'].split(',')[0], env['TMUX_PANE'])
    if env.get('ZELLIJ_PANE_ID'):
        return {'mux': 'zellij', 'session': env.get('ZELLIJ_SESSION_NAME', ''), 'pane': env['ZELLIJ_PANE_ID']}
    return None


def place_from(e):
    """The place a hook recorded (amail's board): tmux by socket and pane, Zellij by session and pane."""
    if e.get('tmux'):
        return TMUX.place(e['tmux'].get('sock'), e['tmux'].get('pane'))
    z = e.get('zellij')
    return {'mux': 'zellij', **z} if z else None


WEB_TMUX = 'deck-web-'  # (the browser's own tmux sessions, grouped with an agent's: not groups of their own)


class Tmux:
    """tmux: a session is a group, a pane (%N) an agent's place; terminals attached are its clients."""

    def __init__(self):
        self.socks, self.cache = set(), {}

    @staticmethod
    def tm(sock, *args, timeout=5):
        return run(['tmux', '-S', sock, *args], timeout=timeout)

    def sockets(self):
        default = os.path.realpath(os.path.join(os.environ.get('TMUX_TMPDIR') or '/tmp', f'tmux-{os.getuid()}', 'default'))
        return sorted(x for x in self.socks | {default} if os.path.exists(x))

    def names(self, sock):  # (pane -> session, read once every couple of seconds per server)
        c = self.cache.get(sock)
        if not c or time.time() - c[0] > 2:
            r = self.tm(sock, 'list-panes', '-a', '-F', '#{pane_id}\t#{session_name}')
            c = self.cache[sock] = (time.time(), dict(l.split('\t', 1) for l in r.stdout.splitlines() if '\t' in l and not l.split('\t', 1)[1].startswith(WEB_TMUX)))
        return c[1]

    def place(self, sock, pane):
        if not sock or not pane:
            return None
        sock = os.path.realpath(sock)  # (/tmp is /private/tmp on macOS: one server, one name)
        self.socks.add(sock)
        name = self.names(sock).get(pane)
        return name and {'mux': 'tmux', 'session': f'tmux:{name}', 'pane': pane, 'sock': sock}

    def sessions(self):
        out = []
        for sock in self.sockets():
            for l in self.tm(sock, 'list-sessions', '-F', '#{session_name}').stdout.splitlines():
                if l.strip() and not l.startswith(WEB_TMUX):
                    out.append((f'tmux:{l.strip()}', sock))
        return out

    def clients(self):
        out = []
        for sock in self.sockets():
            for l in self.tm(sock, 'list-clients', '-F', '#{client_tty}\t#{session_name}\t#{client_pid}').stdout.splitlines():
                tty, name, pid = (l.split('\t') + ['', '', ''])[:3]
                if tty and not name.startswith(WEB_TMUX) and not environ(pid).get('STURNUS_TERM'):
                    out.append({'tty': tty, 'session': f'tmux:{name}', 'pid': int(pid or 0), 'sock': sock})
        return out

    def focus(self, loc, via=None):
        sock, pane, name = loc['sock'], loc['pane'], loc['session'][5:]
        clients = [c for c in self.clients() if c['sock'] == sock]
        if not clients:
            return False, tx(f'没有终端连着 tmux。在终端里运行：tmux attach -t {name}', f'No terminal is attached to tmux. Run in a terminal: tmux attach -t {name}')
        c = next((c for c in clients if c['pid'] == via), None) or next((c for c in clients if c['session'] == loc['session']), clients[0])
        for args in (['select-window', '-t', pane], ['select-pane', '-t', pane], ['switch-client', '-c', c['tty'], '-t', pane]):
            r = self.tm(sock, *args)
            if r.returncode != 0:
                return False, tx(f'切换失败：{(r.stderr or r.stdout).strip()[:200]}', f'Switch failed: {(r.stderr or r.stdout).strip()[:200]}')
        return True, tx(f'已把 {c["tty"]} 上的 tmux 切到 {name} 的这个窗格', f'Switched tmux on {c["tty"]} to this pane of {name}')

    def title(self, loc, text):
        return self.tm(loc['sock'], 'select-pane', '-t', loc['pane'], '-T', text).returncode == 0

    def type(self, loc, text, enter):
        ok = not text or self.tm(loc['sock'], 'send-keys', '-t', loc['pane'], '-l', '--', text).returncode == 0
        if ok and enter:
            time.sleep(.15)  # (a TUI takes pasted text, then the key)
            ok = self.tm(loc['sock'], 'send-keys', '-t', loc['pane'], 'Enter').returncode == 0
        return ok

    def new(self, name, tab, cwd, env, argv):
        """A window running argv in session name (made when new); returns (ok, what was made or why not, its place)."""
        sock = next(iter(self.sockets()), None) or os.path.join(os.environ.get('TMUX_TMPDIR') or '/tmp', f'tmux-{os.getuid()}', 'default')
        envs = [x for kv in env for x in ('-e', kv)]
        have = any(k == f'tmux:{name}' for k, _ in self.sessions())
        r = self.tm(sock, *(['new-window', '-t', f'={name}:'] if have else ['new-session', '-d', '-s', name]), '-n', tab, '-c', cwd,
                    '-P', '-F', '#{pane_id}', *envs, '--', *argv, timeout=10)
        self.cache.pop(sock, None)
        if r.returncode != 0:
            return False, (r.stderr or r.stdout).strip()[:200], None
        pane = r.stdout.strip()
        return True, '' if have else tx(f'新建了 tmux 组 {name}，', f'Created tmux group {name}. '), self.place(sock, pane) if pane.startswith('%') else None


TMUX = Tmux()


def env_of(pid, key):
    return A.proc_env(pid).get(key)
    return None


def cwd_of(pid):
    return A.proc_cwd(pid)


def zellij_clients(ps):
    """The terminals attached to a Zellij session ('zellij a NAME' / 'zellij attach NAME'), newest first."""
    out = []
    for p in ps:
        a = p['args']
        if p['comm'] == 'zellij' and len(a) >= 3 and a[1] in ('a', 'attach') and not a[2].startswith('-') and not environ(p['pid']).get('STURNUS_TERM'):
            via = 'local'
            for pid, name in A.ancestors(p['pid']):
                if name in ('sshd', 'sshd-session'):
                    via = 'ssh'
                    break
            out.append({'pid': p['pid'], 'session': a[2], 'via': via, 'start': p['start']})
    return sorted(out, key=lambda c: -c['start'])


def zellij_sessions():
    r = run(['zellij', 'list-sessions', '-n'], timeout=5)
    return [l.split()[0] for l in r.stdout.splitlines() if l.strip() and 'EXITED' not in l] if r.returncode == 0 else []


def zj(session, *args, timeout=5):
    return run(['zellij', '--session', session, *args], timeout=timeout)


def zellij_server(session):
    for p in A.pids():
        r = A.proc(p)
        if r and r[0] == 'zellij':
            a = A.proc_args(p) or []
            if len(a) >= 3 and a[1] == '--server' and os.path.basename(a[2]) == session:
                return p
    return None


ROOM = threading.Lock()
ROOM_TAKEN = {}  # (session -> [(when, files)]: what was let in a moment ago, its plugins maybe not loaded yet)


def raise_file_limit():
    """A Zellij server keeps the open-file limit of what starts it, and this service has the system's (macOS: 256), never
    a shell's ~/.zshenv. zellij_room() takes zellij_max_files at its word, so a server started from here must really have
    it. Read each time, as zellij_room() reads it: the setting can change under a running service. Only ever raises."""
    try:
        want = int(config().get('zellij_max_files') or 0)
        soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
        if want and soft != resource.RLIM_INFINITY and soft < want:
            resource.setrlimit(resource.RLIMIT_NOFILE, (want if hard == resource.RLIM_INFINITY else min(want, hard), hard))
    except (OSError, ValueError, TypeError) as e:
        print(f'open-file limit left as it is: {e}', file=sys.stderr, flush=True)


def zellij_room(session, what='client'):
    """Whether a session's Zellij has room for one more client (or tab), as {'ok', 'held', 'limit', 'need'}; None when
    its server cannot be read. Every client gets its own copy of each tab's bar plugins, each copy holding a few files
    open; a server out of files dies, and every pane in it with it. Called holding ROOM: what it lets in counts as
    taken for a few seconds, so two pages opening at once are not both let in."""
    pid = zellij_server(session)
    held = pid and A.proc_nfiles(pid)
    if not held:
        return None
    # (Linux tells a process's limit and macOS does not: there it is the setting, else 256, what a server started from
    # a terminal gets, unless the server already holds more, which shows it was raised)
    limit = A.proc_nofile(pid) or int(config().get('zellij_max_files') or 0) or (256 if held <= 256 else None)
    now = time.time()
    taken = ROOM_TAKEN[session] = [t for t in ROOM_TAKEN.get(session, []) if now - t[0] < 8]
    held += sum(n for _, n in taken)
    if what == 'tab':  # (a tab: its bars once for every client)
        need = 8 * max(1, len(clients_of(session))) + 8
    else:  # (measured: 58 more files per client of a 7-tab session with a tab bar and a status bar)
        need = 8 * (len([l for l in zj(session, 'action', 'query-tab-names').stdout.splitlines() if l.strip()]) or 1) + 8
    ok = limit is None or held + need + 16 <= limit
    if ok:
        taken.append((now, need))
    return {'ok': ok, 'held': held, 'limit': limit, 'need': need}


def zellij_marked(session, marker):
    """The pane of a session started with STURNUS_NEW=marker, as Zellij tells it (macOS hides the environment of the
    system's own programs, a login shell's among them, so marked() cannot find a shell there)."""
    try:
        panes = json.loads(zj(session, 'action', 'list-panes', '--json', '--command').stdout or '[]')
    except ValueError:
        return None
    for p in panes if isinstance(panes, list) else []:
        if not p.get('is_plugin') and f'STURNUS_NEW={marker}' in (p.get('terminal_command') or ''):
            return {'mux': 'zellij', 'session': session, 'pane': str(p['id'])}
    return None


def focused(session):
    """Where the session's first client stands: the one its command line moves."""
    r = zj(session, 'action', 'list-clients')
    return set(re.findall(r'^\d+\s+terminal_(\d+)', r.stdout, re.M)[:1])


def focus_in(session, pane):
    """Bring a pane of a session forward in the terminals attached to it: the command line has no focus-by-id, so
    walk the tabs and their panes until the attached client stands on it. ponytail: a walk, O(panes) calls."""
    pane = str(pane)
    if pane in focused(session):
        return True
    tabs = len([l for l in zj(session, 'action', 'query-tab-names').stdout.splitlines() if l.strip()]) or 1
    for t in range(1, tabs + 1):
        zj(session, 'action', 'go-to-tab', str(t))
        seen = set()
        for _ in range(24):
            f = focused(session)
            if pane in f:
                return True
            key = ','.join(sorted(f))
            if key in seen:
                break
            seen.add(key)
            zj(session, 'action', 'focus-next-pane')
    return False


NAME = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,40}')


def kdl(s):
    return '"' + str(s).replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n') + '"'


def marked(marker):
    """The place of the process started with STURNUS_NEW=marker, once it runs."""
    for p in A.pids():
        if A.proc_env(p).get('STURNUS_NEW') == marker:
            loc = place_of(p)
            if loc:
                return loc
    return None


@functools.cache
def plugin_v():
    # (a configuration per build, not per version: Zellij keeps a loaded plugin running, so a new build needs its own
    # instance, and each new instance may ask for permission in the person's terminal)
    try:
        return hashlib.sha256(open(WASM, 'rb').read()).hexdigest()[:10]
    except OSError:
        return VERSION


def clients_of(session):
    return re.findall(r'^(\d+)\s', zj(session, 'action', 'list-clients').stdout, re.M)


def plugin(session, text, client=None):
    # (it may type into panes and share the session on the web, which the person allows once per Zellij server;
    # Zellij hands a pipe to the plugin's instance in every client, so one client's is named to do it: by default the first)
    client = client or next(iter(clients_of(session)), None)
    said = f'@{client} {text}' if client else text
    for _ in range(2):  # (an instance just launched may be another client's: by then each client has one)
        # (-s: a new instance compiles this build, not Zellij's cached copy of the same path)
        r = zj(session, 'action', 'pipe', '-s', '--plugin', f'file:{WASM}', '--plugin-configuration', f'v={plugin_v()}', '--', said, timeout=8)
        if r.stdout.strip():
            return r
    return r


def ask_grant(session):
    """Show the plugin in a session's terminal, so the person can allow it (Zellij's own prompt); the one already
    asking is brought forward rather than another opened. It hides itself once answered."""
    return zj(session, 'action', 'launch-or-focus-plugin', '--floating', '--configuration', f'v={plugin_v()}', f'file:{WASM}')


def in_view(loc):
    """Whether a terminal (the person's, or the page's) shows this pane now."""
    if loc['mux'] == 'tmux':
        return loc['pane'] in TMUX.tm(loc['sock'], 'list-clients', '-F', '#{pane_id}').stdout.split()
    return str(loc['pane']) in re.findall(r'^\d+\s+terminal_(\d+)', zj(loc['session'], 'action', 'list-clients').stdout, re.M)


TERMS = {'gnome-terminal-server': 'GNOME 终端', 'kgx': 'GNOME Console', 'ptyxis-agent': 'Ptyxis', 'konsole': 'Konsole', 'xterm': 'xterm',
         'alacritty': 'Alacritty', 'kitty': 'kitty', 'wezterm-gui': 'WezTerm', 'foot': 'foot', 'terminator': 'Terminator', 'tilix': 'Tilix',
         'xfce4-terminal': 'Xfce 终端', 'mate-terminal': 'MATE 终端', 'urxvt': 'urxvt', 'st': 'st', 'ghostty': 'Ghostty',
         'Terminal': '终端', 'iTerm2': 'iTerm2', 'WezTerm': 'WezTerm', 'Alacritty': 'Alacritty', 'Warp': 'Warp'}


def origin_of(pid):
    """How a session outside Zellij and tmux was started, in words: what stands above its process."""
    chain = A.ancestors(pid)[1:] if pid else []
    for p, comm in chain:
        exe = A.proc_exe(p).lower()
        if comm in ('sshd', 'sshd-session'):
            return 'ssh 登录的终端'
        if comm in TERMS or comm.startswith('gnome-terminal'):
            return f'终端窗口（{TERMS.get(comm, comm)}）'
        if comm.lower() == 'screen':
            return 'screen 会话'
        if comm == 'code' or exe.endswith('/code') or '/visual studio code.app/' in exe:
            return 'VS Code 的终端'
        if comm == 'cursor' or (exe.endswith('/cursor') and 'cursor-agent' not in exe) or '/cursor.app/' in exe:
            return 'Cursor 编辑器的终端'
        if comm == 'ChatGPT' or '/chatgpt/' in exe or '/chatgpt.app/' in exe:
            return 'Codex 桌面应用'
        if comm == 'cron':
            return 'cron 定时任务'
        if comm == 'systemd':
            return '后台服务（systemd）'
    first = next((c for _, c in chain if c not in ('bash', 'zsh', 'sh', 'fish', 'dash', 'env', 'sudo', 'timeout', 'nohup', 'setsid', 'login')), None)
    if not first and A.MAC and chain and (A.proc(chain[-1][0]) or (None, 0))[1] == 1:
        return '后台服务（launchd）'  # (macOS: only shells between it and launchd, as a LaunchAgent starts one)
    return f'由 {first} 启动' if first else '来源不明'


def go_to(loc, via=None):
    """Bring a terminal to an agent's pane."""
    if not loc:
        return False, tx('这个会话不在 Zellij 或 tmux 里', 'This session is not in Zellij or tmux')
    return TMUX.focus(loc, via) if loc.get('mux') == 'tmux' else jump(loc, via)


def jump(loc, via=None):  # (Zellij)
    target, pane = loc['session'], str(loc['pane'])
    clients = zellij_clients(procs())
    if any(c['session'] == target for c in clients):
        ok = focus_in(target, pane)
        return ok, (tx(f'已在 {target} 里切到这个窗格', f'Switched to this pane in {target}') if ok else tx(f'没在 {target} 里找到窗格 {pane}', f'No pane {pane} found in {target}'))
    if not clients:
        return False, tx(f'没有终端连着 Zellij。在终端里运行：zellij attach {target}', f'No terminal is attached to Zellij. Run in a terminal: zellij attach {target}')
    src = next((c for c in clients if c['pid'] == via), clients[0])
    r = plugin(src['session'], f'switch {target} {pane}')
    if r.returncode == 0 and 'ok' in r.stdout:
        return True, tx(f'已把连着 {src["session"]} 的终端（{src["via"]}）切到 {target}', f'Switched the terminal attached to {src["session"]} ({src["via"]}) to {target}')
    return False, tx(f'切换失败：{(r.stderr or r.stdout).strip()[:200]}', f'Switch failed: {(r.stderr or r.stdout).strip()[:200]}')


def term_argv(loc):
    """What the browser's terminal runs: its own client of the agent's group, brought to the agent's pane."""
    if loc['mux'] == 'tmux':
        sock, pane = loc['sock'], loc['pane']
        name = f'{WEB_TMUX}{os.urandom(3).hex()}'
        # (a session grouped with the agent's: the same windows, its own current one, gone once the browser leaves)
        argv = ['tmux', '-S', sock, 'new-session', '-t', '=' + loc['session'][5:], '-s', name, ';', 'set-option', 'destroy-unattached', 'on']
        if pane:
            win = TMUX.tm(sock, 'display', '-p', '-t', pane, '#{window_index}').stdout.strip()
            argv += [';', 'select-window', '-t', f'={name}:{win}', ';', 'select-pane', '-t', pane]
        return argv
    return ['zellij', 'attach', loc['session']]


def pane_screen(loc):
    """(ok, what the pane shows now with its colours, its width or 0): read only, with no client attached, so a phone can look
    at an agent's pane without Zellij shrinking the desktop's layout to the phone, and sees that pane, not the tab the
    desktop happens to show."""
    if loc['mux'] == 'tmux':
        r = TMUX.tm(loc['sock'], 'capture-pane', '-p', '-e', '-t', loc['pane'])
        w = TMUX.tm(loc['sock'], 'display', '-p', '-t', loc['pane'], '#{pane_width}').stdout.strip()
        return r.returncode == 0, r.stdout, int(w) if w.isdigit() else 0
    r = zj(loc['session'], 'action', 'dump-screen', '--pane-id', str(loc['pane']), '--ansi', timeout=5)
    return r.returncode == 0, r.stdout, 0

def zellij_bring(loc, before):
    for _ in range(40):
        new = [c for c in clients_of(loc['session']) if c not in before]
        if new:
            plugin(loc['session'], f'focus {loc["pane"]}', client=max(new, key=int))
            return
        time.sleep(.15)



# ---------- what a terminal can be asked, whichever multiplexer it is in ----------

def loc_of(t):
    """A terminal as kept.py keeps it (mux, grp, pane, sock), as a place; None for one in no multiplexer."""
    if not t or not t.get('mux') or not t.get('pane'):
        return None
    return {'mux': t['mux'], 'session': t['grp'], 'pane': t['pane'], **({'sock': t['sock']} if t.get('sock') else {})}


def there(loc):
    """Whether a pane still exists (its command may have exited): True, False, or None when that cannot be told."""
    if not loc:
        return None
    if loc['mux'] == 'tmux':
        if not loc.get('sock') or not os.path.exists(loc['sock']):
            return False
        r = TMUX.tm(loc['sock'], 'list-panes', '-a', '-F', '#{pane_id}')
        return r.returncode == 0 and loc['pane'] in r.stdout.split()
    if not shutil.which('zellij'):
        return None
    if loc['session'] not in zellij_sessions():
        return False
    try:
        panes = json.loads(zj(loc['session'], 'action', 'list-panes', '--json').stdout or 'null')
    except ValueError:
        return None
    if not isinstance(panes, list):
        return None
    return any(not p.get('is_plugin') and str(p.get('id')) == str(loc['pane']) for p in panes)


def type_in(loc, text, enter, attached=True):
    """Type into a pane as if at its keyboard (and press Enter). Returns (ok, why): '' when typed; 'grant' when Zellij
    wants the person's leave first (asked for in their terminal just now); 'detached' when no terminal is attached to
    that Zellij session, which its plugin needs; 'failed' otherwise."""
    if loc['mux'] == 'tmux':
        return (True, '') if TMUX.type(loc, text, enter) else (False, 'failed')
    if text:
        r = plugin(loc['session'], f'type {loc["pane"]} {text}')
        if r.returncode != 0 or 'ok' not in r.stdout:
            if attached:
                ask_grant(loc['session'])
                return False, 'grant'
            return False, 'detached'
    if enter:
        time.sleep(.15)  # (a TUI takes pasted text, then the key)
        plugin(loc['session'], f'enter {loc["pane"]}')
    return True, ''


def attach_words(loc):
    """What to type in a terminal on this machine to get to a pane's group."""
    return f'tmux attach -t {loc["session"][5:]}' if loc['mux'] == 'tmux' else f'zellij attach {loc["session"]}'


def enter(loc):
    """Take the terminal this process runs in to a pane (`sturnus open`). In the same multiplexer it switches there and
    returns (ok, words); from a plain terminal it becomes that multiplexer's client and does not return."""
    if loc['mux'] == 'tmux':
        sock, pane = loc['sock'], loc['pane']
        mine = os.environ.get('TMUX', '').split(',')[0]
        if mine and os.path.realpath(mine) != os.path.realpath(sock):
            return False, tx('这个终端在另一个 tmux 服务里：换一个终端再打开', 'This terminal is in another tmux server: open it from another terminal')
        for a in (['select-window', '-t', pane], ['select-pane', '-t', pane]):
            TMUX.tm(sock, *a)
        if mine:
            r = TMUX.tm(sock, 'switch-client', '-t', pane)
            return r.returncode == 0, (r.stderr or r.stdout).strip()[:200]
        sys.stdout.flush()
        os.execvp('tmux', ['tmux', '-S', sock, 'attach', '-t', '=' + loc['session'][5:]])
    target, pane = loc['session'], str(loc['pane'])
    inside = os.environ.get('ZELLIJ_SESSION_NAME')
    if inside == target:
        r = zj(target, 'action', 'focus-pane-id', f'terminal_{pane}')
        return (True, '') if r.returncode == 0 else (focus_in(target, pane), (r.stderr or r.stdout).strip()[:200])
    if inside:  # (in another Zellij session: this terminal is switched over, by the plugin)
        me = next((c for c, p in re.findall(r'^(\d+)\s+terminal_(\d+)', zj(inside, 'action', 'list-clients').stdout, re.M) if p == os.environ.get('ZELLIJ_PANE_ID')), None)
        r = plugin(inside, f'switch {target} {pane}', client=me)
        if r.returncode == 0 and 'ok' in r.stdout:
            return True, ''
        return False, tx(f'切不过去：先在这个终端里退出 Zellij（Ctrl+o d），再运行一次；或者：zellij attach {target}', f'Could not switch: detach from Zellij here (Ctrl+o d) and run it again; or: zellij attach {target}')
    with ROOM:
        room = zellij_room(target)
    if room and not room['ok']:
        return False, tx(f'没有打开：{target} 的 Zellij 已经开着 {room["held"]} 个文件，上限 {room["limit"]}，再连一个终端它可能崩掉。先关掉一个连着它的终端，或者调高上限（见 README）。',
                         f'Not opened: Zellij for {target} already has {room["held"]} files open, with a limit of {room["limit"]}; one more terminal may crash it. Close a terminal attached to it, or raise the limit (see the README).')
    before = clients_of(target)
    if os.fork() == 0:  # (Zellij puts a new client where its first client stands: a moment later, this one onto the pane)
        try:
            os.setsid()
            for fd in (0, 1, 2):
                os.close(fd)
            zellij_bring(loc, before)
        finally:
            os._exit(0)
    sys.stdout.flush()
    os.execvp('zellij', ['zellij', 'attach', target])


# ---------- the ways a session gets its terminal ----------

def slug(name, fallback='sturnus'):
    """A group's name from a workspace's: what Zellij and tmux take (letters, digits, _ . -)."""
    s = re.sub(r'[^A-Za-z0-9_.-]+', '-', str(name or '')).strip('-._')[:30]
    return s if s and NAME.fullmatch(s) else fallback


class Way:
    """One way a session gets its terminal: where it is opened, and in which group. Whatever a session then needs of
    its terminal goes by the place start() returns, through the functions above."""
    key = mux = ''

    def label(self):
        return self.key

    def usable(self):
        return bool(shutil.which(self.mux))

    def group(self, space, kept, prefer=None):
        """The group a session's terminal is opened in: the one its workspace's sessions are in (PREFER), else the
        workspace's own, by its name."""
        return prefer or (space or {}).get('grp') or slug((space or {}).get('name'))

    def start(self, group, tab, cwd, env, argv, marker):
        """Open a terminal running argv (with env, a list of K=V) at cwd; returns (ok, words, place). The place may be
        None when it is not known yet: marked(marker) finds it once the process runs."""
        raise NotImplementedError


class ZellijTab(Way):
    """A tab of its own in a Zellij session (the group): the session is made in the background when it is not there."""
    key, mux = 'zellij-tab', 'zellij'

    def label(self):
        return tx('Zellij：工作区那一组里的一个标签', 'Zellij: a tab in the workspace’s group')

    def start(self, group, tab, cwd, env, argv, marker):
        if not NAME.fullmatch(group):
            return False, tx('组名只能用字母、数字和 _ . -', 'A group name can use only letters, digits and _ . -'), None
        layout = f'''layout {{
    tab name={kdl(tab)} cwd={kdl(cwd)} {{
        pane size=1 borderless=true {{
            plugin location="zellij:tab-bar"
        }}
        pane command="env" name={kdl(tab)} cwd={kdl(cwd)} {{
            args {" ".join(kdl(a) for a in env + argv)}
        }}
        pane size=1 borderless=true {{
            plugin location="zellij:status-bar"
        }}
    }}
}}
'''
        os.makedirs(os.path.join(CACHE, 'layouts'), exist_ok=True)
        f = os.path.join(CACHE, 'layouts', f'{marker}.kdl')
        with open(f, 'w') as w:
            w.write(layout)
        made = ''
        if group not in zellij_sessions():
            raise_file_limit()
            r = run(['zellij', 'attach', '--create-background', group, 'options', '--show-startup-tips', 'false'], timeout=10)
            for _ in range(20):
                if group in zellij_sessions():
                    break
                time.sleep(.25)
            else:
                return False, tx(f'建不了组 {group}：{(r.stderr or r.stdout).strip()[:160]}', f'Could not create group {group}: {(r.stderr or r.stdout).strip()[:160]}'), None
            made = tx(f'新建了组 {group}，', f'Created group {group}. ')
        else:
            with ROOM:
                room = zellij_room(group, 'tab')
            if room and not room['ok']:
                return False, tx((f'没有开：{group} 的 Zellij 已经开着 {room["held"]} 个文件，上限 {room["limit"]}，再开一个标签页要约 '
                                  f'{room["need"]} 个，超过上限它会崩掉，里面的会话全部结束。先关掉一个连着它的终端，或者调高上限（见 README）。'),
                                 f'Not opened: Zellij for {group} already has {room["held"]} files open, with a limit of {room["limit"]}; another tab needs about {room["need"]} more, and past the limit it crashes and every session in it ends. Close a terminal attached to it, or raise the limit (see the README).'), None
        r = zj(group, 'action', 'new-tab', '--layout', f, timeout=10)
        if r.returncode != 0:
            return False, tx(f'开不了新标签页：{(r.stderr or r.stdout).strip()[:200]}', f'Could not open a new tab: {(r.stderr or r.stdout).strip()[:200]}'), None
        return True, made, zellij_marked(group, marker)


class TmuxWindow(Way):
    """A window of its own in a tmux session (the group, "tmux:<name>" as a place): made when it is not there."""
    key, mux = 'tmux-window', 'tmux'

    def label(self):
        return tx('tmux：工作区那一组里的一个窗口', 'tmux: a window in the workspace’s group')

    def group(self, space, kept, prefer=None):
        return (prefer or '').removeprefix('tmux:') or super().group(space, kept)

    def start(self, group, tab, cwd, env, argv, marker):
        group = group.removeprefix('tmux:')
        if not NAME.fullmatch(group):
            return False, tx('组名只能用字母、数字和 _ . -', 'A group name can use only letters, digits and _ . -'), None
        ok, made, loc = TMUX.new(group, tab, cwd, env, argv)
        return (True, made, loc) if ok else (False, tx(f'tmux 开不了：{made}', f'tmux could not start: {made}'), None)


class TmuxOwn(TmuxWindow):
    """A tmux session of its own for each session, named after it: `tmux attach -t st-…` is that session and nothing else."""
    key = 'tmux-own'

    def label(self):
        return tx('tmux：每条会话一个自己的 tmux 会话', 'tmux: a tmux session of its own for each session')

    def group(self, space, kept, prefer=None):
        return 'st-' + str((kept or {}).get('id') or os.urandom(3).hex()).removeprefix('s-')[:8]


WAYS = {w.key: w for w in (ZellijTab(), TmuxWindow(), TmuxOwn())}


def way(cfg, group=''):
    """The way new terminals are opened: the one set (config "terminal"), when its multiplexer is installed; else the
    first that is. A group named outright ("tmux:<name>") is opened as what it is."""
    if group.startswith('tmux:'):
        return WAYS['tmux-window']
    w = WAYS.get(str((cfg or {}).get('terminal') or ''))
    return w if w and w.usable() else next((x for x in WAYS.values() if x.usable()), WAYS['zellij-tab'])
