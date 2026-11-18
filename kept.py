"""kept - the sessions that last, and the workspaces they are in (sturnus's own record: ~/.local/state/sturnus/sessions.db).

A session here is the person's: one thing they are getting done with an agent. It outlasts the terminal it runs in and
the agent's own conversation. A terminal ends (its tab closed, the machine restarted) and another takes over; the agent's
conversation is cleared, or another agent takes the work on. So a kept session has, in order, its conversations (segs) and
its terminals (terms). What runs now is found by the deck, pass after pass, and bound to its session here (bind).

A workspace is the person's too: a name and the folders it covers. A session is in the workspace whose folder it was
opened in, the nearest one, unless the person put it elsewhere; one opened in no workspace's folder is in none.

Nothing here starts or reads a terminal or a conversation: that is terms.py's and the deck's. This file only remembers.
"""
import contextlib
import json
import os
import re
import sqlite3
import threading
import time
import uuid

# (beside the tasks; a deck to try things on, with its own tasks, gets its own sessions with no more said)
PATH = os.environ.get('STURNUS_SESSIONS') or os.path.join(os.path.dirname(os.environ.get('STURNUS_TASKS') or os.path.expanduser('~/.local/state/sturnus/tasks.db')), 'sessions.db')
# (seconds a session may be out of the deck's sight before its terminal counts as ended: a blip is not an end)
QUIET = float(os.environ.get('STURNUS_QUIET') or 20)
AGENTS = ('claude', 'codex', 'cursor')
SCHEMA = '''
CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, grp TEXT NOT NULL DEFAULT '', made REAL NOT NULL,
    at REAL NOT NULL, archived REAL);
CREATE TABLE IF NOT EXISTS places (space TEXT NOT NULL, path TEXT NOT NULL, host TEXT NOT NULL DEFAULT '', main INTEGER NOT NULL DEFAULT 0,
    at REAL NOT NULL, PRIMARY KEY (path, host));
CREATE TABLE IF NOT EXISTS kept (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', titled INTEGER NOT NULL DEFAULT 0,
    space TEXT, spaced INTEGER NOT NULL DEFAULT 0, folder TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT '', work TEXT NOT NULL DEFAULT '', made REAL NOT NULL, at REAL NOT NULL,
    pinned REAL, archived REAL, state TEXT NOT NULL DEFAULT 'stopped', note TEXT NOT NULL DEFAULT '',
    wt TEXT NOT NULL DEFAULT '', wt_branch TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS segs (kept TEXT NOT NULL, n INTEGER NOT NULL, kind TEXT NOT NULL, conv TEXT NOT NULL, path TEXT NOT NULL DEFAULT '',
    began REAL NOT NULL, ended REAL, how TEXT NOT NULL DEFAULT '', PRIMARY KEY (kept, n));
CREATE UNIQUE INDEX IF NOT EXISTS segs_conv ON segs (kind, conv);
CREATE TABLE IF NOT EXISTS terms (kept TEXT NOT NULL, n INTEGER NOT NULL, mux TEXT NOT NULL DEFAULT '', grp TEXT NOT NULL DEFAULT '',
    pane TEXT NOT NULL DEFAULT '', sock TEXT NOT NULL DEFAULT '', origin TEXT NOT NULL DEFAULT '', pid INTEGER, pid_at REAL,
    began REAL NOT NULL, ended REAL, why TEXT NOT NULL DEFAULT '', PRIMARY KEY (kept, n));
CREATE INDEX IF NOT EXISTS terms_open ON terms (ended);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS said (kept TEXT NOT NULL, seg INTEGER NOT NULL, n INTEGER NOT NULL, who TEXT NOT NULL, text TEXT NOT NULL, at REAL,
    PRIMARY KEY (kept, seg, n));
CREATE TABLE IF NOT EXISTS reads (path TEXT PRIMARY KEY, off INTEGER NOT NULL, kept TEXT NOT NULL, seg INTEGER NOT NULL, clipped INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, title TEXT NOT NULL, prompt TEXT NOT NULL, kind TEXT NOT NULL, folder TEXT NOT NULL, space TEXT,
    every TEXT NOT NULL, live INTEGER NOT NULL DEFAULT 1, made REAL NOT NULL, last REAL, next REAL);
CREATE TABLE IF NOT EXISTS plan_runs (plan TEXT NOT NULL, kept TEXT NOT NULL, at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS starts (mark TEXT PRIMARY KEY, kept TEXT NOT NULL, at REAL NOT NULL, pid INTEGER, pid_at REAL);
CREATE TABLE IF NOT EXISTS dropped (kind TEXT NOT NULL, conv TEXT NOT NULL, at REAL NOT NULL, PRIMARY KEY (kind, conv));
'''
# starts: each terminal sturnus opens for a session carries a mark of its own (STURNUS_NEW) beside the session's id
# (STURNUS_SESSION). Both are inherited by whatever that process starts, so the session's id alone proves nothing: it
# counts only for the first process seen with the mark issued for it. dropped: the conversations of sessions the person
# deleted, so the look through the disk does not bring them back.
# said: what was said in a session, copied from the agents' own conversation files as they grow (reads: how far each file
# has been read), so a session's words outlast those files, read the same whichever agent wrote them, and can be searched.
WORDS = "CREATE VIRTUAL TABLE IF NOT EXISTS words USING fts5(text, kept UNINDEXED, seg UNINDEXED, n UNINDEXED, tokenize='trigram')"
# how a conversation came to be a session's: 'new' (started for it), 'found' (already running, or on disk, when first
# seen), 'clear' (the same terminal went on with a new conversation), 'handover' (another agent took the work on).
# why a terminal ended: 'restart' (the machine restarted), 'closed' (its pane is gone), 'exited' (the agent quit, the pane
# is still there), 'moved' (the session went on in another pane), 'stopped' (the person archived it), 'ended' (not known).


class No(ValueError):
    """Something asked that cannot be: its first word says what (the deck puts it in the person's language) —
    'name', 'there', 'folder', 'taken' (path, the workspace that has it), 'space', 'place', 'session', 'archive'."""

    @property
    def code(self):
        return self.args[0]


def norm(p):
    return os.path.realpath(os.path.expanduser(p)) if p else ''


def line(x, n):
    """One line of text, as it may be shown in a list or a terminal."""
    return re.sub(r'\s+', ' ', re.sub(r'[\x00-\x08\x0e-\x1f\x7f-\x9f]', '', str(x or ''))).strip()[:n]


def nearest(spaces, folder):
    """The workspace a folder is in: the one with the nearest folder at or above it; None when none covers it."""
    folder, best = norm(folder), (0, None)
    for sp in spaces if folder else []:
        if sp.get('archived'):
            continue
        for pl in sp['places']:
            p = pl['path']
            if (folder == p or folder.startswith(p.rstrip('/') + '/')) and len(p) > best[0]:
                best = (len(p), sp['id'])
    return best[1]


def next_at(every, after):
    """When something set for EVERY comes round next after AFTER, by this machine's clock: 'daily HH:MM', 'weekdays HH:MM'
    (Monday to Friday), 'hours N' (N hours on). None for anything else."""
    m = re.fullmatch(r'(daily|weekdays) ([01]?\d|2[0-3]):([0-5]\d)', str(every or '').strip())
    if m:
        t = time.localtime(after)
        for day in range(8):
            at = time.mktime((t.tm_year, t.tm_mon, t.tm_mday + day, int(m.group(2)), int(m.group(3)), 0, 0, 0, -1))
            if at > after and (m.group(1) == 'daily' or time.localtime(at).tm_wday < 5):
                return at
    m = re.fullmatch(r'hours ([1-9]\d{0,2})', str(every or '').strip())
    return after + int(m.group(1)) * 3600 if m else None


def bindable(s):
    """A row of the deck that is a session of its own: an agent the person talks to, not one another session started, a
    sub-agent's thread (with or without its starter in sight), a run with no window, or a card for something still starting."""
    return (s.get('kind') in AGENTS and s.get('state') not in ('gone', 'ended') and not s.get('starting')
            and not s.get('parent') and not s.get('parent_id') and not s.get('from') and not s.get('sub'))


class Book:
    def __init__(self, path=None):
        self.path = path or PATH
        self.lock = threading.RLock()
        self.missing = {}  # (kept id -> when the deck first did not see it)
        self.stopping = {}  # (kept id -> (when the person stopped it, its process): what is still seen of that process for a moment is on its way out)
        os.makedirs(os.path.dirname(self.path), mode=0o700, exist_ok=True)
        with contextlib.closing(self._open()) as c:
            c.executescript(SCHEMA)
            have = {r['name'] for r in c.execute('PRAGMA table_info(kept)')}
            for col in ('wt', 'wt_branch', 'meta'):  # (a record made before a session could have a worktree of its own, or before what model it runs on was kept)
                if col not in have:
                    c.execute(f"ALTER TABLE kept ADD COLUMN {col} TEXT NOT NULL DEFAULT ''")
            try:  # (searching by any three characters in a row: where this SQLite has it; else a plain look through)
                c.execute(WORDS)
                self.fts = True
            except sqlite3.OperationalError:
                self.fts = False

    def _open(self):
        c = sqlite3.connect(self.path, timeout=5, isolation_level=None)  # (no journal mode set: DELETE, readable from a sandbox)
        c.row_factory = sqlite3.Row
        return c

    @contextlib.contextmanager
    def tx(self):
        """One change: what it reads and what it writes are one step, among the service and the command line."""
        with self.lock, contextlib.closing(self._open()) as c:
            c.execute('BEGIN IMMEDIATE')
            try:
                yield c
            except BaseException:
                c.execute('ROLLBACK')
                raise
            c.execute('COMMIT')

    @contextlib.contextmanager
    def read(self):
        with contextlib.closing(self._open()) as c:
            yield c

    def meta(self, key, value=None):
        with self.tx() as c:
            if value is not None:
                c.execute('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', (key, str(value)))
                return str(value)
            r = c.execute('SELECT value FROM meta WHERE key = ?', (key,)).fetchone()
            return r and r['value']

    # ---------- workspaces ----------

    @staticmethod
    def _spaces(c):
        out = {r['id']: {**dict(r), 'places': []} for r in c.execute('SELECT * FROM spaces ORDER BY made')}
        for r in c.execute('SELECT * FROM places ORDER BY main DESC, at'):
            if r['space'] in out:
                out[r['space']]['places'].append({'path': r['path'], 'host': r['host'], 'main': bool(r['main']), 'at': r['at']})
        return list(out.values())

    def spaces(self):
        with self.read() as c:
            return self._spaces(c)

    def space_add(self, name, paths=(), sid=None, grp='', at=None):
        """A new workspace with its folders; returns its id. A folder another workspace already has is refused."""
        name, at = line(name, 60), at or time.time()
        if not name:
            raise No('name')
        sid = sid or 'w-' + uuid.uuid4().hex[:8]
        with self.tx() as c:
            if c.execute('SELECT 1 FROM spaces WHERE id = ?', (sid,)).fetchone():
                raise No('there', sid)
            c.execute('INSERT INTO spaces (id, name, grp, made, at) VALUES (?, ?, ?, ?, ?)', (sid, name, grp, at, at))
            for i, p in enumerate(dict.fromkeys(norm(p) for p in paths if p)):
                self._place(c, sid, p, at, main=not i)
        return sid

    @staticmethod
    def _place(c, sid, p, at, main=False):
        if not p or p == '/':
            raise No('folder', p)
        other = c.execute('SELECT s.name FROM places p JOIN spaces s ON s.id = p.space WHERE p.path = ? AND p.host = ? AND p.space != ?', (p, '', sid)).fetchone()
        if other:
            raise No('taken', p, other['name'])
        c.execute('INSERT OR IGNORE INTO places (space, path, host, main, at) VALUES (?, ?, ?, ?, ?)', (sid, p, '', int(main), at))

    def space_set(self, sid, name=None, grp=None, archived=None):
        with self.tx() as c:
            if not c.execute('SELECT 1 FROM spaces WHERE id = ?', (sid,)).fetchone():
                raise No('space')
            if name is not None:
                if not line(name, 60):
                    raise No('name')
                c.execute('UPDATE spaces SET name = ?, at = ? WHERE id = ?', (line(name, 60), time.time(), sid))
            if grp is not None:
                c.execute('UPDATE spaces SET grp = ? WHERE id = ?', (grp, sid))
            if archived is not None:
                c.execute('UPDATE spaces SET archived = ? WHERE id = ?', (time.time() if archived else None, sid))

    def place_add(self, sid, path):
        p = norm(path)
        with self.tx() as c:
            if not c.execute('SELECT 1 FROM spaces WHERE id = ?', (sid,)).fetchone():
                raise No('space')
            first = not c.execute('SELECT 1 FROM places WHERE space = ?', (sid,)).fetchone()
            self._place(c, sid, p, time.time(), main=first)
        return p

    def place_drop(self, sid, path):
        """A folder out of a workspace: nothing on disk is touched; the sessions opened in it are then in no workspace
        (unless another folder of one still covers them)."""
        p = norm(path)
        with self.tx() as c:
            was = c.execute('SELECT main FROM places WHERE space = ? AND path = ?', (sid, p)).fetchone()
            c.execute('DELETE FROM places WHERE space = ? AND path = ?', (sid, p))
            if was and was['main']:  # (the default folder went: the oldest one left is it now)
                c.execute('UPDATE places SET main = 1 WHERE rowid = (SELECT rowid FROM places WHERE space = ? ORDER BY at LIMIT 1)', (sid,))

    def place_main(self, sid, path):
        p = norm(path)
        with self.tx() as c:
            if not c.execute('SELECT 1 FROM places WHERE space = ? AND path = ?', (sid, p)).fetchone():
                raise No('place', p)
            c.execute('UPDATE places SET main = (path = ?) WHERE space = ?', (p, sid))

    def space_drop(self, sid):
        """A workspace gone (the person's word): its folders stay on disk, its sessions are in no workspace."""
        with self.tx() as c:
            c.execute('DELETE FROM places WHERE space = ?', (sid,))
            c.execute('DELETE FROM spaces WHERE id = ?', (sid,))
            c.execute('UPDATE kept SET space = NULL, spaced = 0 WHERE space = ?', (sid,))

    # ---------- sessions ----------

    def add(self, title='', folder='', kind='', space=None, name='', at=None):
        """A session the person starts from the page or the command line, before anything runs for it; returns its id.
        What is then started for it carries STURNUS_SESSION=<id>, and is bound to it when the deck sees it."""
        at, kid = at or time.time(), 's-' + uuid.uuid4().hex[:8]
        with self.tx() as c:
            sp = space or nearest(self._spaces(c), folder)
            c.execute('INSERT INTO kept (id, title, titled, space, spaced, folder, kind, name, made, at, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                      (kid, line(title, 120), int(bool(title)), sp, int(bool(space)), norm(folder), kind, name, at, at, 'stopped'))
        return kid

    def start(self, mark, kid, now=None):
        """A terminal is about to be opened for a session, with this mark: the first process seen carrying it is the
        session's."""
        now = now or time.time()
        with self.tx() as c:
            c.execute('DELETE FROM starts WHERE at < ?', (now - 30 * 86400,))
            c.execute('INSERT OR REPLACE INTO starts (mark, kept, at) VALUES (?, ?, ?)', (mark, kid, now))

    @staticmethod
    def _full(c, kid):
        r = c.execute('SELECT * FROM kept WHERE id = ?', (kid,)).fetchone()
        if not r:
            return None
        k = dict(r)
        k['segs'] = [dict(x) for x in c.execute('SELECT * FROM segs WHERE kept = ? ORDER BY n', (kid,))]
        k['terms'] = [dict(x) for x in c.execute('SELECT * FROM terms WHERE kept = ? ORDER BY n', (kid,))]
        return k

    def get(self, kid):
        with self.read() as c:
            return self._full(c, kid)

    def all(self):
        """Every session with what it runs on now: its latest conversation (and the one before), its open terminal (if
        any), and how many of each it has had. The newest first."""
        with self.read() as c:
            out = {r['id']: {**dict(r), 'seg': None, 'prev': None, 'term': None, 'nsegs': 0, 'nterms': 0} for r in c.execute('SELECT * FROM kept')}
            for r in c.execute('SELECT * FROM segs ORDER BY n'):
                k = out.get(r['kept'])
                if k:
                    k['prev'], k['seg'], k['nsegs'] = k['seg'], dict(r), k['nsegs'] + 1
            for r in c.execute('SELECT * FROM terms ORDER BY n'):
                k = out.get(r['kept'])
                if k:
                    k['nterms'] += 1
                    k['term'] = dict(r) if r['ended'] is None else k['term']
                    k['last_term'] = dict(r)
        return sorted(out.values(), key=lambda k: -k['at'])

    def set(self, kid, **f):
        """The person's word on a session: its title, its workspace ('' takes it back to the one its folder is in),
        pinned, archived."""
        with self.tx() as c:
            k = c.execute('SELECT * FROM kept WHERE id = ?', (kid,)).fetchone()
            if not k:
                raise No('session')
            now = time.time()
            if 'title' in f:
                t = line(f['title'], 120)
                c.execute('UPDATE kept SET title = ?, titled = ? WHERE id = ?', (t, int(bool(t)), kid))
            if 'space' in f:
                sp = f['space'] or None
                if sp and not c.execute('SELECT 1 FROM spaces WHERE id = ?', (sp,)).fetchone():
                    raise No('space')
                c.execute('UPDATE kept SET space = ?, spaced = ? WHERE id = ?', (sp or nearest(self._spaces(c), k['folder']), int(bool(sp)), kid))
            if 'pinned' in f:
                c.execute('UPDATE kept SET pinned = ? WHERE id = ?', (now if f['pinned'] else None, kid))
            if 'archived' in f:
                c.execute('UPDATE kept SET archived = ? WHERE id = ?', (now if f['archived'] else None, kid))
                if f['archived']:  # (archived: out of the pinned ones too)
                    c.execute('UPDATE kept SET pinned = NULL WHERE id = ?', (kid,))
            if 'kind' in f:
                c.execute('UPDATE kept SET kind = ? WHERE id = ?', (f['kind'], kid))
            if 'meta' in f:  # (the model it last ran on, and how: kept so a stopped session still says)
                c.execute('UPDATE kept SET meta = ? WHERE id = ?', (json.dumps(f['meta'], ensure_ascii=False) if f['meta'] else '', kid))
            if 'wt' in f:  # (the worktree sturnus made for it, and its branch; '' once it is merged and gone)
                c.execute('UPDATE kept SET wt = ?, wt_branch = ? WHERE id = ?', (norm(f['wt']), f.get('wt_branch') or '', kid))

    def drop(self, kid):
        """A session deleted for good: only an archived one (the conversations' own files are the agents', and stay)."""
        with self.tx() as c:
            k = c.execute('SELECT archived FROM kept WHERE id = ?', (kid,)).fetchone()
            if not k:
                raise No('session')
            if not k['archived']:
                raise No('archive')
            c.executemany('INSERT OR REPLACE INTO dropped (kind, conv, at) VALUES (?, ?, ?)', [(r['kind'], r['conv'], time.time()) for r in c.execute('SELECT kind, conv FROM segs WHERE kept = ?', (kid,))])
            for t in ('segs', 'terms', 'said', 'reads') + (('words',) if self.fts else ()):
                c.execute(f'DELETE FROM {t} WHERE kept = ?', (kid,))
            c.execute('DELETE FROM kept WHERE id = ?', (kid,))

    @staticmethod
    def _seg(c, kid, kind, conv, path, at, how):
        """A conversation becomes a session's latest: the one before it is over."""
        n = (c.execute('SELECT MAX(n) m FROM segs WHERE kept = ?', (kid,)).fetchone()['m'] or 0) + 1
        c.execute('UPDATE segs SET ended = ? WHERE kept = ? AND ended IS NULL', (at, kid))
        c.execute('INSERT INTO segs (kept, n, kind, conv, path, began, how) VALUES (?, ?, ?, ?, ?, ?, ?)', (kid, n, kind, conv, path or '', at, how))

    def learn(self, convs, now=None):
        """Conversations found on disk that no session has yet: each becomes a stopped session, as it was left. convs:
        [{kind, conv, path, folder, began, at, title, note}]. One written in the last ten minutes is left for now: it
        is running, and the deck binds it to the session it runs for. Returns how many were new."""
        now, n = now or time.time(), 0
        with self.tx() as c:
            spaces = self._spaces(c)
            have = {(r['kind'], r['conv']) for r in c.execute('SELECT kind, conv FROM segs UNION SELECT kind, conv FROM dropped')}
            for v in convs:
                if not v.get('conv') or v.get('kind') not in AGENTS or (v['kind'], v['conv']) in have or (v.get('at') or 0) > now - 600:
                    continue
                have.add((v['kind'], v['conv']))
                kid, at = 's-' + uuid.uuid4().hex[:8], v.get('at') or now
                c.execute('INSERT INTO kept (id, title, space, folder, kind, name, made, at, state, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                          (kid, line(v.get('title'), 120), nearest(spaces, v.get('folder')), norm(v.get('folder')), v['kind'], v.get('name') or '',
                           v.get('began') or at, at, 'stopped', line(v.get('note'), 300)))
                c.execute('INSERT INTO segs (kept, n, kind, conv, path, began, how) VALUES (?, 1, ?, ?, ?, ?, ?)', (kid, v['kind'], v['conv'], v.get('path') or '', v.get('began') or at, 'found'))
                n += 1
        return n

    def bind(self, live, now=None, boot=0, there=None):
        """The deck's rows, bound to the sessions here; returns {row id: session id}. A row is the session whose
        conversation it shows; else the one whose terminal the same process is (it went on with a new conversation);
        else the one it was started for (the row's 'want', its STURNUS_SESSION, when its 'mark', its STURNUS_NEW, is the
        one issued for that session and no other process has shown up with it: both are inherited by what it starts);
        else a new session. Its terminal is noted when it moves into one, and closed when the row has been out of sight for a
        while: why, by BOOT (when the machine started) and THERE (whether a terminal's pane still exists: True, False,
        or None when that cannot be told)."""
        now, out = now or time.time(), {}
        with self.tx() as c:
            kept = {r['id']: dict(r) for r in c.execute('SELECT * FROM kept')}
            by_conv = {(r['kind'], r['conv']): r['kept'] for r in c.execute('SELECT kind, conv, kept FROM segs')}
            nseg = {r['kept']: r['n'] for r in c.execute('SELECT kept, COUNT(*) n FROM segs GROUP BY kept')}
            opened = {r['kept']: dict(r) for r in c.execute('SELECT * FROM terms WHERE ended IS NULL')}
            by_pid = {(t['pid'], int(t['pid_at'] or 0)): k for k, t in opened.items() if t['pid']}
            starts = {r['mark']: dict(r) for r in c.execute('SELECT * FROM starts')}
            spaces = self._spaces(c)
            seen = set()
            for s in live:
                if not bindable(s):
                    continue
                # (its process: the one the deck names as showing one conversation at a time, 'proc'; a row without that word, its own)
                conv, pid = s.get('session') or '', s['proc'] if 'proc' in s else s.get('window_pid') or s.get('pid')
                pid_at = int(s.get('pid_at') or 0)
                kid, how = by_conv.get((s['kind'], conv)) if conv else None, ''
                again = lambda k: 'clear' if nseg.get(k) and kept[k]['kind'] == s['kind'] else 'handover' if nseg.get(k) else 'new'
                if not kid and pid and (pid, pid_at) in by_pid:
                    kid = by_pid[(pid, pid_at)]
                    how = again(kid)
                st = starts.get(s.get('mark') or '')
                if not kid and st and st['kept'] == s.get('want') and st['kept'] in kept and pid and (st['pid'] is None or (st['pid'], int(st['pid_at'] or 0)) == (pid, pid_at)):
                    kid = st['kept']
                    how = again(kid)
                    if st['pid'] is None:  # (this process is the one it was started as: no other is, from here on)
                        c.execute('UPDATE starts SET pid = ?, pid_at = ? WHERE mark = ?', (pid, pid_at or None, st['mark']))
                        st['pid'], st['pid_at'] = pid, pid_at
                if not kid:
                    if not conv:
                        continue  # (nothing to know it by yet: a window before its first word)
                    kid, how = 's-' + uuid.uuid4().hex[:8], 'found'
                    at = s.get('born') or s.get('since') or now
                    c.execute('INSERT INTO kept (id, folder, kind, name, made, at, state) VALUES (?, ?, ?, ?, ?, ?, ?)',
                              (kid, norm(s.get('home') or s.get('cwd')), s['kind'], s.get('name') or '', at, s.get('at') or now, s['state']))
                    kept[kid] = dict(c.execute('SELECT * FROM kept WHERE id = ?', (kid,)).fetchone())
                halt = self.stopping.get(kid)
                # (a process just stopped is not the session running again; a terminal closed with no process to its name — the Codex app's — is not reopened by the same row, until it is in a pane)
                if kid in seen or (halt and now - halt[0] < 30 and (halt[1] == pid if halt[1] else not (s.get('loc') or {}).get('mux'))):  # (two rows of one session: the first one seen is it; a process just stopped is not it running again)
                    out[s['id']] = kid
                    continue
                seen.add(kid)
                out[s['id']] = kid
                k = kept[kid]
                if conv and (s['kind'], conv) not in by_conv:
                    self._seg(c, kid, s['kind'], conv, s.get('transcript') or '', now, how or 'found')
                    by_conv[(s['kind'], conv)] = kid
                    nseg[kid] = nseg.get(kid, 0) + 1
                elif conv and s.get('transcript'):
                    c.execute("UPDATE segs SET path = ? WHERE kind = ? AND conv = ? AND path = ''", (s['transcript'], s['kind'], conv))
                # its terminal: the pane it is in now (or, in none, how it was started)
                loc, t = s.get('loc') or {}, opened.get(kid)
                here = (loc.get('mux') or '', loc.get('session') or '', str(loc.get('pane') or ''))
                same = bool(t) and not (pid and t['pid'] and (t['pid'], int(t['pid_at'] or 0)) != (pid, pid_at))
                if t and same and (t['mux'], t['grp'], t['pane']) != here:
                    if not here[0]:  # (its place not found this pass: it is where it was)
                        here = (t['mux'], t['grp'], t['pane'])
                    elif not t['mux']:  # (its place found only now: the same terminal, known better)
                        c.execute('UPDATE terms SET mux = ?, grp = ?, pane = ?, sock = ? WHERE kept = ? AND n = ?', (*here, loc.get('sock') or '', kid, t['n']))
                        t = {**t, 'mux': here[0], 'grp': here[1], 'pane': here[2]}
                if t and (not same or (t['mux'], t['grp'], t['pane']) != here):
                    c.execute('UPDATE terms SET ended = ?, why = ? WHERE kept = ? AND n = ?', (now, 'moved', kid, t['n']))
                    t = None
                if not t:
                    last = c.execute('SELECT MAX(n) m, MAX(COALESCE(ended, began)) e FROM terms WHERE kept = ?', (kid,)).fetchone()
                    # (it began when its process did, not when the deck first saw it there: what was said in between is this terminal's)
                    began = pid_at if pid_at and (last['e'] or 0) < pid_at <= now else now
                    c.execute('INSERT INTO terms (kept, n, mux, grp, pane, sock, origin, pid, pid_at, began) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                              (kid, (last['m'] or 0) + 1, *here, loc.get('sock') or '', '' if loc else line(s.get('origin'), 80), pid, pid_at or None, began))
                elif not t['pid'] and pid:
                    c.execute('UPDATE terms SET pid = ?, pid_at = ? WHERE kept = ? AND n = ?', (pid, pid_at or None, kid, t['n']))
                # what the session is now
                new = {'kind': s['kind'], 'name': s.get('name') or k['name'], 'state': s['state'], 'at': max(k['at'], s.get('at') or 0),
                       'branch': s.get('branch') or '', 'work': s.get('work') or '', 'note': line(s.get('summary') or s.get('said'), 300) or k['note'],
                       'folder': k['folder'] or norm(s.get('home') or s.get('cwd')),
                       # (running again: out of the archive, unless it was archived a moment ago and is still stopping)
                       'archived': k['archived'] if k['archived'] and now - k['archived'] < 60 else None}
                if not k['titled'] and s.get('title'):
                    new['title'] = line(s['title'], 120)
                ch = {f: v for f, v in new.items() if k.get(f) != v}
                if ch:
                    c.execute(f'UPDATE kept SET {", ".join(f + " = ?" for f in ch)} WHERE id = ?', (*ch.values(), kid))
                    k.update(ch)
                self.missing.pop(kid, None)
            for kid, t in opened.items():  # (a terminal whose session the deck no longer sees: over, after a while)
                if kid in seen:
                    continue
                since = self.missing.setdefault(kid, now)
                restarted = bool(boot and boot > t['began'])
                if not restarted and now - since < QUIET:
                    continue
                ok = None if restarted or not there else there(t)
                why = 'restart' if restarted else 'exited' if ok else 'closed' if ok is False else 'ended'
                c.execute('UPDATE terms SET ended = ?, why = ? WHERE kept = ? AND n = ?', (max(t['began'], kept[kid]['at']) if restarted else since, why, kid, t['n']))
                self.missing.pop(kid, None)
            live_now = seen | {k for k in opened if k not in seen and k in self.missing}
            for kid, k in kept.items():
                if kid not in live_now and k['state'] != 'stopped':
                    c.execute("UPDATE kept SET state = 'stopped' WHERE id = ?", (kid,))
                if not k['spaced']:  # (its workspace follows the folders: one added or taken away moves it)
                    sp = nearest(spaces, k['folder'])
                    if sp != k['space']:
                        c.execute('UPDATE kept SET space = ? WHERE id = ?', (sp, kid))
        return out

    def close(self, kid, why='stopped', now=None):
        """A session's open terminal marked over — the person stopped it ('stopped'), it rested too long ('rested'), it is
        being moved into another ('moved') — without the deck waiting to see it gone."""
        now = now or time.time()
        with self.tx() as c:
            t = c.execute('SELECT pid FROM terms WHERE kept = ? AND ended IS NULL', (kid,)).fetchone()
            c.execute('UPDATE terms SET ended = ?, why = ? WHERE kept = ? AND ended IS NULL', (now, why, kid))
            c.execute("UPDATE kept SET state = 'stopped' WHERE id = ?", (kid,))
        self.missing.pop(kid, None)
        self.stopping = {k: v for k, v in self.stopping.items() if now - v[0] < 30}
        self.stopping[kid] = (now, t and t['pid'])

    # ---------- what was said: a session's own copy of its conversations ----------

    def reading(self, path):
        """How far a conversation file has been read into the record: {off, kept, seg, clipped}, or None."""
        with self.read() as c:
            r = c.execute('SELECT * FROM reads WHERE path = ?', (path,)).fetchone()
            return r and dict(r)

    def asks(self, kid):
        """How many times a person (or what started it) has spoken in a session, as far as its conversations are copied."""
        with self.read() as c:
            return c.execute("SELECT COUNT(*) n FROM said WHERE kept = ? AND who = 'user'", (kid,)).fetchone()['n']

    def readings(self):
        with self.read() as c:
            return {r['path']: dict(r) for r in c.execute('SELECT * FROM reads')}

    def say(self, kid, seg, path, off, items, clipped=False):
        """More of a conversation, read up to OFF of its file: items [{who, text, at}] go after what the record has."""
        with self.tx() as c:
            n = c.execute('SELECT MAX(n) m FROM said WHERE kept = ? AND seg = ?', (kid, seg)).fetchone()['m'] or 0
            for it in items:
                text = str(it.get('text') or '')
                if not text.strip():
                    continue
                n += 1
                c.execute('INSERT INTO said (kept, seg, n, who, text, at) VALUES (?, ?, ?, ?, ?, ?)', (kid, seg, n, it.get('who') or '', text, it.get('at')))
                if self.fts and it.get('who') in ('user', 'assistant'):
                    c.execute('INSERT INTO words (text, kept, seg, n) VALUES (?, ?, ?, ?)', (text, kid, seg, n))
            c.execute('INSERT INTO reads (path, off, kept, seg, clipped) VALUES (?, ?, ?, ?, ?) ON CONFLICT (path) DO UPDATE SET off = excluded.off, kept = excluded.kept, seg = excluded.seg', (path, off, kid, seg, int(clipped)))

    def said(self, kid, limit=200, talk=False):
        """The last of what was said in a session, across its conversations, oldest first: [{who, text, at, seg, kind}];
        with TALK, only the person's and the agent's words."""
        with self.read() as c:
            kinds = {r['n']: r['kind'] for r in c.execute('SELECT n, kind FROM segs WHERE kept = ?', (kid,))}
            rows = c.execute(f"SELECT * FROM said WHERE kept = ? {'AND who != ' + repr('tool') if talk else ''} ORDER BY seg DESC, n DESC LIMIT ?", (kid, limit)).fetchall()
        return [{'who': r['who'], 'text': r['text'], 'at': r['at'], 'seg': r['seg'], 'kind': kinds.get(r['seg'], '')} for r in reversed(rows)]

    def find(self, q, limit=40):
        """Where something was said: [{kept, seg, n, who, text, at}], the latest first. Three characters or more go by the
        index; fewer, or with no index, by a plain look through."""
        q = str(q or '').strip()
        if not q:
            return []
        with self.read() as c:
            if self.fts and len(q) >= 3:
                sql = ('SELECT s.* FROM words w JOIN said s ON s.kept = w.kept AND s.seg = w.seg AND s.n = w.n WHERE words MATCH ? ORDER BY s.at DESC LIMIT ?')
                rows = c.execute(sql, ('"' + q.replace('"', '""') + '"', limit)).fetchall()
            else:
                like = '%' + q.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
                rows = c.execute("SELECT * FROM said WHERE who IN ('user', 'assistant') AND text LIKE ? ESCAPE '\\' ORDER BY at DESC LIMIT ?", (like, limit)).fetchall()
        return [dict(r) for r in rows]

    # ---------- what is set to be done again and again: each time, a new session ----------

    def plans(self):
        """Everything set to run by the clock, each with its latest runs (the sessions it started), the newest first."""
        with self.read() as c:
            out = [dict(r) for r in c.execute('SELECT * FROM plans ORDER BY made')]
            for p in out:
                p['runs'] = [dict(r) for r in c.execute('SELECT kept, at FROM plan_runs WHERE plan = ? ORDER BY at DESC LIMIT 8', (p['id'],))]
        return out

    def plan_add(self, title, prompt, kind, folder, every, space=None, now=None):
        now = now or time.time()
        if not line(title, 80) or not str(prompt or '').strip():
            raise No('plan')
        if kind not in AGENTS or next_at(every, now) is None:
            raise No('every')
        pid = 'p-' + uuid.uuid4().hex[:8]
        with self.tx() as c:
            c.execute('INSERT INTO plans (id, title, prompt, kind, folder, space, every, made, next) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                      (pid, line(title, 80), str(prompt).strip()[:8000], kind, norm(folder), space or None, every.strip(), now, next_at(every, now)))
        return pid

    def plan_set(self, pid, live=None, now=None):
        """Switched on or off: switched on, its next time counts from now."""
        now = now or time.time()
        with self.tx() as c:
            p = c.execute('SELECT * FROM plans WHERE id = ?', (pid,)).fetchone()
            if not p:
                raise No('plan')
            if live is not None:
                c.execute('UPDATE plans SET live = ?, next = ? WHERE id = ?', (int(bool(live)), next_at(p['every'], now) if live else None, pid))

    def plan_drop(self, pid):
        with self.tx() as c:
            c.execute('DELETE FROM plans WHERE id = ?', (pid,))
            c.execute('DELETE FROM plan_runs WHERE plan = ?', (pid,))

    def plan_ran(self, pid, kid, now=None, due=True):
        """A run noted (its session, when there is one); the next time set from now when it ran because it was due."""
        now = now or time.time()
        with self.tx() as c:
            p = c.execute('SELECT * FROM plans WHERE id = ?', (pid,)).fetchone()
            if not p:
                return
            if kid:
                c.execute('INSERT INTO plan_runs (plan, kept, at) VALUES (?, ?, ?)', (pid, kid, now))
                c.execute('DELETE FROM plan_runs WHERE plan = ? AND rowid NOT IN (SELECT rowid FROM plan_runs WHERE plan = ? ORDER BY at DESC LIMIT 40)', (pid, pid))
            c.execute('UPDATE plans SET last = ?, next = ? WHERE id = ?', (now, next_at(p['every'], now) if due and p['live'] else p['next'], pid))

    def plan_kept(self, since):
        """The sessions the clock started since SINCE."""
        with self.read() as c:
            return {r['kept'] for r in c.execute('SELECT kept FROM plan_runs WHERE at > ?', (since,))}
