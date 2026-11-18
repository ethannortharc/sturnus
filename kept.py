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
    pinned REAL, archived REAL, state TEXT NOT NULL DEFAULT 'stopped', note TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS segs (kept TEXT NOT NULL, n INTEGER NOT NULL, kind TEXT NOT NULL, conv TEXT NOT NULL, path TEXT NOT NULL DEFAULT '',
    began REAL NOT NULL, ended REAL, how TEXT NOT NULL DEFAULT '', PRIMARY KEY (kept, n));
CREATE UNIQUE INDEX IF NOT EXISTS segs_conv ON segs (kind, conv);
CREATE TABLE IF NOT EXISTS terms (kept TEXT NOT NULL, n INTEGER NOT NULL, mux TEXT NOT NULL DEFAULT '', grp TEXT NOT NULL DEFAULT '',
    pane TEXT NOT NULL DEFAULT '', sock TEXT NOT NULL DEFAULT '', origin TEXT NOT NULL DEFAULT '', pid INTEGER, pid_at REAL,
    began REAL NOT NULL, ended REAL, why TEXT NOT NULL DEFAULT '', PRIMARY KEY (kept, n));
CREATE INDEX IF NOT EXISTS terms_open ON terms (ended);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
'''
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


def bindable(s):
    """A row of the deck that is a session of its own: an agent the person talks to, not one another session started, a
    run with no window, or a card for something still starting."""
    return (s.get('kind') in AGENTS and s.get('state') not in ('gone', 'ended') and not s.get('starting')
            and not s.get('parent') and not s.get('parent_id') and not s.get('from'))


class Book:
    def __init__(self, path=None):
        self.path = path or PATH
        self.lock = threading.RLock()
        self.missing = {}  # (kept id -> when the deck first did not see it)
        self.stopping = {}  # (kept id -> (when the person stopped it, its process): what is still seen of that process for a moment is on its way out)
        os.makedirs(os.path.dirname(self.path), mode=0o700, exist_ok=True)
        with contextlib.closing(self._open()) as c:
            c.executescript(SCHEMA)

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
        """Every session with what it runs on now: its latest conversation, its open terminal (if any), and how many of
        each it has had. The newest first."""
        with self.read() as c:
            out = {r['id']: {**dict(r), 'seg': None, 'term': None, 'nsegs': 0, 'nterms': 0} for r in c.execute('SELECT * FROM kept')}
            for r in c.execute('SELECT * FROM segs ORDER BY n'):
                k = out.get(r['kept'])
                if k:
                    k['seg'], k['nsegs'] = dict(r), k['nsegs'] + 1
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

    def drop(self, kid):
        """A session deleted for good: only an archived one (the conversations' own files are the agents', and stay)."""
        with self.tx() as c:
            k = c.execute('SELECT archived FROM kept WHERE id = ?', (kid,)).fetchone()
            if not k:
                raise No('session')
            if not k['archived']:
                raise No('archive')
            for t in ('segs', 'terms'):
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
            have = {(r['kind'], r['conv']) for r in c.execute('SELECT kind, conv FROM segs')}
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
        conversation it shows; else the one it was started for (STURNUS_SESSION in its environment, the row's 'want');
        else the one whose terminal the same process was a moment ago (it went on with a new conversation); else a new
        session. Its terminal is noted when it moves into one, and closed when the row has been out of sight for a
        while: why, by BOOT (when the machine started) and THERE (whether a terminal's pane still exists: True, False,
        or None when that cannot be told)."""
        now, out = now or time.time(), {}
        with self.tx() as c:
            kept = {r['id']: dict(r) for r in c.execute('SELECT * FROM kept')}
            by_conv = {(r['kind'], r['conv']): r['kept'] for r in c.execute('SELECT kind, conv, kept FROM segs')}
            nseg = {r['kept']: r['n'] for r in c.execute('SELECT kept, COUNT(*) n FROM segs GROUP BY kept')}
            opened = {r['kept']: dict(r) for r in c.execute('SELECT * FROM terms WHERE ended IS NULL')}
            by_pid = {(t['pid'], int(t['pid_at'] or 0)): k for k, t in opened.items() if t['pid']}
            spaces = self._spaces(c)
            seen = set()
            for s in live:
                if not bindable(s):
                    continue
                conv, pid = s.get('session') or '', s.get('window_pid') or s.get('pid')
                pid_at = int(s.get('pid_at') or 0)
                kid, how = by_conv.get((s['kind'], conv)) if conv else None, ''
                if not kid and s.get('want') in kept:
                    kid, how = s['want'], 'clear' if nseg.get(s['want']) and kept[s['want']]['kind'] == s['kind'] else 'handover' if nseg.get(s['want']) else 'new'
                if not kid and pid and (pid, pid_at) in by_pid:
                    kid, how = by_pid[(pid, pid_at)], 'clear'
                if not kid:
                    if not conv:
                        continue  # (nothing to know it by yet: a window before its first word)
                    kid, how = 's-' + uuid.uuid4().hex[:8], 'found'
                    at = s.get('born') or s.get('since') or now
                    c.execute('INSERT INTO kept (id, folder, kind, name, made, at, state) VALUES (?, ?, ?, ?, ?, ?, ?)',
                              (kid, norm(s.get('home') or s.get('cwd')), s['kind'], s.get('name') or '', at, s.get('at') or now, s['state']))
                    kept[kid] = dict(c.execute('SELECT * FROM kept WHERE id = ?', (kid,)).fetchone())
                halt = self.stopping.get(kid)
                if kid in seen or (halt and now - halt[0] < 30 and halt[1] in (None, pid)):  # (two rows of one session: the first one seen is it; a process just stopped is not it running again)
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
                if t and ((t['mux'], t['grp'], t['pane']) != here or (pid and t['pid'] and (t['pid'], int(t['pid_at'] or 0)) != (pid, pid_at))):
                    c.execute('UPDATE terms SET ended = ?, why = ? WHERE kept = ? AND n = ?', (now, 'moved', kid, t['n']))
                    t = None
                if not t:
                    n = (c.execute('SELECT MAX(n) m FROM terms WHERE kept = ?', (kid,)).fetchone()['m'] or 0) + 1
                    c.execute('INSERT INTO terms (kept, n, mux, grp, pane, sock, origin, pid, pid_at, began) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                              (kid, n, *here, loc.get('sock') or '', '' if loc else line(s.get('origin'), 80), pid, pid_at or None, now))
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
        """A session's open terminal marked over (the person stopped it): the deck does not wait to see it gone."""
        now = now or time.time()
        with self.tx() as c:
            t = c.execute('SELECT pid FROM terms WHERE kept = ? AND ended IS NULL', (kid,)).fetchone()
            c.execute('UPDATE terms SET ended = ?, why = ? WHERE kept = ? AND ended IS NULL', (now, why, kid))
            c.execute("UPDATE kept SET state = 'stopped' WHERE id = ?", (kid,))
        self.missing.pop(kid, None)
        self.stopping = {k: v for k, v in self.stopping.items() if now - v[0] < 30}
        self.stopping[kid] = (now, t and t['pid'])
