"""addons.py - what other programs add to Sturnus.

An add-on is a folder holding an addon.json and one program. Sturnus knows nothing of what an add-on is for; it gives
it four things, each asked for in addon.json:

  events     it is told when a session starts, a turn ends, a session ends. amail's hooks leave a line in the mailbox
             and the service hands the lines over within seconds, several at once
  tasks      the service runs it every so many seconds, and shows that on the By the clock page
  settings   fields the person fills in under Settings -> Add-ons. The values go to the add-on; Sturnus keeps none
  state      what it shows there: a line on how it stands, a few rows, links

The program runs as a process of its own (never loaded into the service) and puts nothing of its own into the page:

  PROGRAM events      stdin {"events": [{"event", "agent", "session", "cwd", "transcript", "at"}, ...]}
  PROGRAM task ID     stdin {}
  PROGRAM set         stdin {"values": {ID: text, ...}}
  PROGRAM state       stdin {}

It answers with one JSON object on stdout: {"ok": true|false, "note": text}, and for state {"ready", "status", "rows",
"links", "settings"}. docs/addons.md has all of it. An add-on is put in by the person at this machine's command line
(sturnus addon add DIR), never from the page: it is a program that runs as them.

Each add-on has one piece of work going at a time (events, a task, or being given its settings), in a thread of its
own, so a slow one holds up no other; state may be asked for meanwhile. While one is off, Sturnus runs none of its
tasks and hands it no events: only state and set, which it needs before it can be switched on.
"""
import atexit, contextlib, fcntl, json, os, re, shutil, signal, subprocess, tempfile, threading, time

API = 1  # (the version of this arrangement: an add-on written for a later one is not loaded)
ID = re.compile(r'[a-z][a-z0-9-]{1,30}')
EVENTS = ('session_start', 'turn_end', 'session_end')
KINDS = ('text', 'url', 'secret')
TIMES = {'state': 20, 'set': 60, 'events': 900, 'task': 900}  # (seconds one run of each verb has)
ANSWER = 1 << 20  # (an answer is at most this long)
TICK = float(os.environ.get('STURNUS_ADDON_TICK') or 5)  # (seconds between looks at what the hooks left and at the clock)
LINK = re.compile(r'https?://[^\s<>"\'`]{1,500}')
A = tx = config = save_config = None
HOME = ''
RUNNING = set()  # (the programs at work now: stopped when the service is)


def setup(amail, tx_, config_, save_config_, share):
    global A, tx, config, save_config, HOME
    A, tx, config, save_config = amail, tx_, config_, save_config_
    HOME = os.environ.get('STURNUS_ADDONS') or os.path.join(share, 'addons')  # (another one: a second deck to try things on)


def stop(p):
    """A program and whatever it started (it runs in a group of its own) are stopped."""
    with contextlib.suppress(OSError):
        os.killpg(p.pid, signal.SIGKILL)
    with contextlib.suppress(Exception):
        p.wait(timeout=5)


atexit.register(lambda: [stop(p) for p in list(RUNNING)])


@contextlib.contextmanager
def held(aid, wait=None):
    """An add-on's turn, across the service and the command line: its program at work, or its folder being changed, one
    at a time. Gives False when it was not free within WAIT seconds (None: waits as long as it takes)."""
    os.makedirs(HOME, mode=0o700, exist_ok=True)
    with open(os.path.join(HOME, f'.{aid}.lock'), 'w') as f:
        end, got = None if wait is None else time.time() + wait, False
        while not got:
            try:
                fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
                got = True
            except OSError:
                if end is not None and time.time() >= end:
                    break
                time.sleep(0.2)
        try:
            yield got
        finally:
            if got:
                fcntl.flock(f, fcntl.LOCK_UN)


def words(v, room=80):
    """A piece of text an add-on gives, in Chinese and English: {"zh", "en"} when it has both, else the one for both."""
    zh, en = (v.get('zh'), v.get('en')) if isinstance(v, dict) else (v, v)
    zh, en = (str(x)[:room] if isinstance(x, (str, int, float)) and not isinstance(x, bool) else '' for x in (zh, en))
    return {'zh': zh or en, 'en': en or zh}


def read(folder):
    """An add-on's addon.json, checked: (what it says, None), or (None, what is wrong with it)."""
    try:
        with open(os.path.join(folder, 'addon.json'), encoding='utf-8') as f:
            m = json.load(f)
    except (OSError, ValueError, RecursionError) as e:
        return None, f'its addon.json cannot be read: {e}'
    if not isinstance(m, dict):
        return None, 'its addon.json is not an object'
    aid, api, prog = m.get('id'), m.get('api'), m.get('run')
    if not isinstance(aid, str) or not ID.fullmatch(aid):
        return None, 'its id must be 2 to 31 lowercase letters, digits or dashes, a letter first'
    if not isinstance(api, int) or isinstance(api, bool) or not 1 <= api <= API:
        return None, f'it is written for add-on arrangement {api!r}; this Sturnus has {API}'
    if not isinstance(prog, str) or not prog or os.path.isabs(prog) or '..' in prog.replace('\\', '/').split('/'):
        return None, 'its "run" must name a program inside its own folder'
    full = os.path.join(folder, prog)
    if os.path.islink(full) or not os.path.realpath(full).startswith(os.path.realpath(folder) + os.sep):
        return None, 'its "run" must name a program inside its own folder, not a link'
    if not os.path.isfile(full) or not os.access(full, os.X_OK):
        return None, f'its program {prog} is not there, or may not be run'
    events = m.get('events') or []
    if not isinstance(events, list) or any(e not in EVENTS for e in events):
        return None, f'it asks for an event this Sturnus does not have (it has: {", ".join(EVENTS)})'
    tasks, settings = [], []
    for t in m.get('tasks') or []:
        if not isinstance(t, dict) or not isinstance(t.get('id'), str) or not ID.fullmatch(t['id']):
            return None, 'each task needs an id of lowercase letters, digits or dashes'
        every = t.get('every')
        if not isinstance(every, int) or isinstance(every, bool) or not 60 <= every <= 7 * 86400:
            return None, f'task {t["id"]}: "every" is in seconds, from 60 to a week'
        tasks.append({'id': t['id'], 'every': every, 'name': words(t.get('name') or t['id'], 60), 'about': words(t.get('about'), 300)})
    for s in m.get('settings') or []:
        if not isinstance(s, dict) or not isinstance(s.get('id'), str) or not ID.fullmatch(s['id']) or s.get('kind', 'text') not in KINDS:
            return None, f'each setting needs an id and a kind ({", ".join(KINDS)})'
        settings.append({'id': s['id'], 'kind': s.get('kind', 'text'), 'name': words(s.get('name') or s['id'], 60), 'hint': words(s.get('hint'), 120)})
    if len(tasks) > 6 or len(settings) > 8 or len({t['id'] for t in tasks}) < len(tasks) or len({s['id'] for s in settings}) < len(settings):
        return None, 'at most 6 tasks and 8 settings, each id once'
    return {'id': aid, 'api': api, 'version': str(m.get('version') or '')[:20], 'name': words(m.get('name') or aid, 40),
            'about': words(m.get('about'), 500), 'run': prog, 'events': list(dict.fromkeys(events)), 'tasks': tasks, 'settings': settings}, None


def conf():
    c = config().get('addons')
    return {k: v for k, v in c.items() if isinstance(v, dict)} if isinstance(c, dict) else {}


def keep(aid, on=None, events=None, gone=False):
    """What the settings keep of an add-on: whether it is on, and the events it wants (amail's hook reads just these)."""
    c = conf()
    if gone:
        c.pop(aid, None)
    else:
        was = c.get(aid) or {}
        c[aid] = {'on': bool(was.get('on')) if on is None else bool(on), 'events': list(was.get('events') or []) if events is None else list(events)}
    save_config({'addons': c})
    return c


def add(src):
    """Put the add-on in folder SRC into Sturnus, or replace the one of its id; whether it is on stays as it was.
    Its files are copied: later changes to SRC reach Sturnus when it is added again. -> (what it says, None) or (None, why not)"""
    src = os.path.realpath(src)
    m, why = read(src)
    if not m:
        return None, why
    files = size = 0
    for d, dirs, names in os.walk(src):  # (links are not followed, and none may be there: what is copied is what was counted)
        for n in dirs + names:
            f = os.path.join(d, n)
            if os.path.islink(f):
                return None, f'{os.path.relpath(f, src)} is a link; an add-on\'s folder holds its own files only'
            if n in names:
                files += 1
                with contextlib.suppress(OSError):
                    size += os.path.getsize(f)
    if files > 300 or size > 20 << 20:
        return None, f'an add-on is a small folder of its own; this one holds {files} files, {size >> 20} MB'
    dest, new, old = os.path.join(HOME, m['id']), os.path.join(HOME, f'.{m["id"]}.new'), os.path.join(HOME, f'.{m["id"]}.old')
    with held(m['id'], 30) as free:
        if not free:
            return None, 'it is at work now; add it again when it is done'
        for d in (new, old):
            shutil.rmtree(d, ignore_errors=True)
        try:
            shutil.copytree(src, new, symlinks=True, ignore=shutil.ignore_patterns('__pycache__', '.git', '.DS_Store', '*.pyc'))
            os.chmod(new, 0o700)
            if os.path.isdir(dest):
                os.rename(dest, old)
            os.rename(new, dest)
        except (OSError, shutil.Error) as e:
            shutil.rmtree(new, ignore_errors=True)
            if os.path.isdir(old) and not os.path.isdir(dest):
                os.rename(old, dest)  # (the one that was there is put back)
            return None, f'it could not be copied: {str(e)[:300]}'
        shutil.rmtree(old, ignore_errors=True)
    keep(m['id'], events=m['events'])
    return m, None


def remove(aid):
    """Take an add-on out. -> '' when it is gone, else why not."""
    if not ID.fullmatch(aid or '') or not os.path.isdir(os.path.join(HOME, aid)):
        return f'no add-on {aid}'
    with held(aid, 30) as free:
        if not free:
            return 'it is at work now; take it out when it is done'
        shutil.rmtree(os.path.join(HOME, aid), ignore_errors=True)
    shutil.rmtree(os.path.join(A.HOME, 'addons', aid), ignore_errors=True)
    with contextlib.suppress(OSError):
        os.remove(os.path.join(HOME, f'.{aid}.lock'))
    keep(aid, gone=True)
    return ''


class Addons:
    """The add-ons on this machine: read from their folders, asked how they stand, told of events, run by the clock."""

    def __init__(self, note=None, tell=None, lang=None):
        self.note = note or (lambda text, ok=True: None)  # (what the page is told went wrong)
        self.tell = tell or (lambda: None)  # (the page shows how the add-ons stand at once, not at its next collect)
        self.lang = lang or (lambda: 'zh')
        self.items, self.conf, self.gone, self.mu = {}, {}, {}, threading.Lock()
        self.scan()

    def scan(self):
        """The add-ons installed now; one whose addon.json changed is read again (it stays the same add-on: what it is
        doing, and when its tasks last ran, go on). True when the list changed."""
        found, changed = {}, False
        try:
            names = sorted(os.listdir(HOME))
        except OSError:
            names = []
        for n in names:
            d = os.path.join(HOME, n)
            if n.startswith('.'):
                continue
            try:
                at = os.stat(os.path.join(d, 'addon.json')).st_mtime_ns
            except OSError:
                continue
            it = self.items.get(n)
            if it and it['at'] == at:
                found[n] = it
                continue
            m, why = read(d)
            if m and m['id'] != n:
                m, why = None, 'its folder is not named by its id'
            was = it['tasks'] if it else {}
            it = it if it is not None else {'id': n, 'busy': '', 'said': ''}
            it.update(dir=d, at=at, m=m, error=why, state=None, tasks={t['id']: was.get(t['id']) or {'next': 0.0, 'last': None} for t in (m or {}).get('tasks', [])})
            found[n], changed = it, True
        changed = changed or set(found) != set(self.items)
        self.items, self.conf = found, conf()
        for n, it in found.items():  # (the hook reads the wanted events from the settings: kept as addon.json has them)
            if it['m'] and (self.conf.get(n) or {}).get('events') != it['m']['events']:
                self.conf = keep(n, events=it['m']['events'])
        now = time.time()
        for n in list(self.conf):  # (what the settings still hold of one that is gone for a minute goes too: the hook leaves it nothing more)
            if n in found:
                self.gone.pop(n, None)
            elif now - self.gone.setdefault(n, now) > 60:
                self.conf = keep(n, gone=True)
                self.gone.pop(n, None)
        return changed

    def on(self, aid):
        it = self.items.get(aid)
        return bool(it and it['m'] and (self.conf.get(aid) or {}).get('on'))

    def claim(self, it, what):
        """An add-on's turn is taken for a piece of work, unless one is going."""
        with self.mu:
            if it['busy']:
                return False
            it['busy'] = what
            return True

    def release(self, it):
        with self.mu:
            it['busy'] = ''

    def call(self, it, verb, arg=None, data=None):
        """One run of an add-on's program: what it answered, with "ok" always there and, when it failed, a "note" why.
        It runs in a process group of its own, so that when its time is up, or it is done, nothing of it stays behind;
        what it prints goes to a file, so a program that prints without end fills no memory here."""
        timeout = TIMES[verb]
        argv = [os.path.join(it['dir'], it['m']['run']), verb] + ([arg] if arg else [])
        env = dict(os.environ, STURNUS_ADDON=it['id'], STURNUS_LANG=self.lang(), STURNUS_API=str(API))
        with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
            try:
                p = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=out, stderr=err, cwd=it['dir'], env=env, start_new_session=True)
            except OSError as e:
                return {'ok': False, 'note': str(e)[:300]}
            RUNNING.add(p)
            try:
                p.communicate(json.dumps(data or {}).encode(), timeout=timeout)
            except subprocess.TimeoutExpired:
                return {'ok': False, 'note': {'zh': f'{timeout} 秒没做完，停掉了', 'en': f'not done in {timeout} seconds; stopped'}}
            finally:
                stop(p)
                RUNNING.discard(p)
            out.seek(0)
            raw = out.read(ANSWER + 1)
            err.seek(max(0, err.seek(0, 2) - 2000))
            said = err.read().decode('utf-8', 'replace').strip().splitlines()
        ans = None
        if len(raw) <= ANSWER:
            with contextlib.suppress(ValueError, RecursionError):
                ans = json.loads(raw.decode('utf-8', 'replace').strip() or '{}')
        if not isinstance(ans, dict):
            ans = {'ok': False, 'note': {'zh': '它的回答不是一个 JSON 对象（或超过 1 MB）', 'en': 'its answer is not a JSON object (or is over 1 MB)'}}
        if p.returncode != 0:
            ans['ok'] = False
        ans['ok'] = ans.get('ok') is not False
        if not ans['ok'] and not ans.get('note'):
            ans['note'] = (said or [f'exit {p.returncode}'])[-1][:300]
        return ans

    def look(self, it):
        """How an add-on says it stands, kept for the page. A secret setting's value never comes back: only whether it is set."""
        if not it['m']:
            return
        m, s = it['m'], self.call(it, 'state')
        vals = s.get('settings') if isinstance(s.get('settings'), dict) else {}
        it['state'] = {
            'ready': s['ok'] and s.get('ready') is not False,
            'status': words(s.get('status') if s['ok'] else s.get('note'), 300),
            'rows': [{'name': words(r.get('name'), 40), 'value': words(r.get('value'), 300)} for r in (s.get('rows') if isinstance(s.get('rows'), list) else [])[:12] if isinstance(r, dict)],
            'links': [{'name': words(l.get('name') or l['url'], 40), 'url': l['url']} for l in (s.get('links') if isinstance(s.get('links'), list) else [])[:4]
                      if isinstance(l, dict) and isinstance(l.get('url'), str) and LINK.fullmatch(l['url'])],
            'values': {x['id']: bool(vals.get(x['id'])) if x['kind'] == 'secret' else str(vals.get(x['id']) or '')[:500] for x in m['settings']}}

    def view(self):
        """What the page shows of the add-ons."""
        out = []
        for it in list(self.items.values()):
            m, st = it['m'], it['state'] or {}
            if not m:
                out.append({'id': it['id'], 'error': it['error']})
                continue
            on = self.on(it['id'])
            out.append({'id': m['id'], 'name': m['name'], 'about': m['about'], 'version': m['version'], 'on': on, 'busy': it['busy'], 'looked': bool(it['state']),
                        'ready': bool(st.get('ready')), 'status': st.get('status') or words(''), 'rows': st.get('rows') or [], 'links': st.get('links') or [],
                        'settings': [dict(x, value=(st.get('values') or {}).get(x['id'], False if x['kind'] == 'secret' else '')) for x in m['settings']],
                        'tasks': [dict(t, next=(it['tasks'][t['id']]['next'] or None) if on else None, last=it['tasks'][t['id']]['last'],
                                       busy=it['busy'] == 'task ' + t['id']) for t in m['tasks']]})
        return out

    def act(self, b):
        """From the page or the command line: look again at how they all stand; switch one on or off; give one its
        settings; run one of its tasks now (only while it is on)."""
        self.scan()
        lang = 'en' if self.lang() == 'en' else 'zh'
        if b.get('look'):
            for it in list(self.items.values()):
                self.look(it)
            return True, ''
        it = self.items.get(b.get('addon') if isinstance(b.get('addon'), str) else '')
        if not it or not it['m']:
            return False, tx('没有这个插件', 'No such add-on')
        m, name = it['m'], it['m']['name'][lang]
        if 'values' in b:  # (what the person filled in: handed to the add-on, which says whether it holds; Sturnus keeps none of it)
            kinds, give = {x['id']: x['kind'] for x in m['settings']}, {}
            for k, v in (b['values'] if isinstance(b['values'], dict) else {}).items():
                if k not in kinds or not isinstance(v, str) or (not v.strip() and kinds[k] == 'secret'):
                    continue  # (a secret left empty: the one it has stays)
                give[k] = v.strip()[:2000]
                if kinds[k] == 'url' and give[k] and not re.fullmatch(r'https?://\S+', give[k]):
                    return False, tx('地址要以 http:// 或 https:// 开头', 'An address starts with http:// or https://')
            if not self.claim(it, 'set'):
                return False, tx('它正在做事，等这一次做完再保存', 'It is at work; save again when it is done')
            try:
                with held(it['id']):
                    r = self.call(it, 'set', data={'values': give})
            finally:
                self.release(it)
            self.look(it)
            return r['ok'], words(r.get('note'), 300)[lang] or (tx('已保存', 'Saved') if r['ok'] else tx('没有保存', 'Not saved'))
        if 'on' in b:
            on = bool(b['on'])
            if on:
                self.look(it)
                if not it['state']['ready']:
                    return False, it['state']['status'][lang] or tx('先把它的设置填好', 'Fill in its settings first')
            self.conf = keep(m['id'], on=on, events=m['events'])
            for t in it['tasks'].values():
                t['next'] = time.time() + 10 if on else 0.0  # (its tasks' first run shortly after it is switched on)
            return True, tx(f'{name}：' + ('已打开' if on else '已关掉'), f'{name}: ' + ('on' if on else 'off'))
        if b.get('task'):
            t = next((t for t in m['tasks'] if t['id'] == b['task']), None)
            if not t:
                return False, tx('它没有这个任务', 'It has no such task')
            if not self.on(m['id']):
                return False, tx('它关着：先打开', 'It is off: switch it on first')
            if not self.claim(it, 'task ' + t['id']):
                return True, tx('正在做', 'It is at work')
            threading.Thread(target=self.serve, args=(it, [t]), daemon=True).start()
            return True, tx('开始做', 'Started')
        return False, tx('不认识的操作', 'Unknown action')

    def did(self, it, r):
        """What went wrong is said on the page once, not at every run."""
        said = '' if r['ok'] else words(r.get('note') or 'failed', 300)
        if said and said != it['said']:
            self.note(tx(f'插件「{it["m"]["name"]["zh"]}」：{said["zh"]}', f'Add-on “{it["m"]["name"]["en"]}”: {said["en"]}'), False)
        it['said'] = said

    def serve(self, it, tasks=()):
        """An add-on's turn, already claimed for it: the events left for it are handed over, then the given tasks run."""
        try:
            with held(it['id']):
                events = self.queue(it['id']) if self.on(it['id']) else []
                if events:
                    it['busy'] = 'events'
                    self.did(it, self.call(it, 'events', data={'events': events}))
                for t in tasks:
                    if not it['m'] or t['id'] not in it['tasks']:
                        continue  # (replaced meanwhile by one without this task)
                    it['busy'] = 'task ' + t['id']
                    self.tell()
                    began = time.time()
                    r = self.call(it, 'task', t['id'])
                    it['tasks'][t['id']]['last'] = {'at': time.time(), 'ok': r['ok'], 'note': words(r.get('note'), 300), 'took': round(time.time() - began, 1)}
                    self.did(it, r)
                if it['m']:
                    self.look(it)
        except Exception as e:
            self.note(tx(f'插件「{it["id"]}」出错：{e!r}', f'Add-on “{it["id"]}” failed: {e!r}'), False)
        finally:
            self.release(it)
            self.tell()

    def run_task(self, it, t):
        """Run one task now and wait for it. False when the add-on is at work on something else."""
        if not self.claim(it, 'task ' + t['id']):
            return False
        self.serve(it, [t])
        return True

    def _left(self, aid):
        d = os.path.join(A.HOME, 'addons', aid)
        try:
            return d, sorted(n for n in os.listdir(d) if n.endswith('.json'))[:500]
        except OSError:
            return d, []

    def queue(self, aid):
        """What amail's hooks left for an add-on since the last look, taken out as it is read: handed over once, whether
        or not the add-on then takes it (its tasks are there to pick up what a failed call missed)."""
        d, out = self._left(aid)[0], []
        for n in self._left(aid)[1]:
            e = None
            with contextlib.suppress(Exception):  # (a file that is no event is only removed)
                e = A.get(os.path.join(d, n), None)
            with contextlib.suppress(OSError):
                os.remove(os.path.join(d, n))
            it = self.items.get(aid)
            if isinstance(e, dict) and it and it['m'] and e.get('event') in it['m']['events']:
                e = {k: e.get(k) for k in ('event', 'agent', 'session', 'cwd', 'transcript', 'at')}
                if e not in out:
                    out.append(e)
        return out

    def step(self):
        """One look: add-ons put in or taken out since the last; what was left for ones that are off or gone, dropped; for
        each one that is on with events waiting or a task whose time has come, a thread of its own to do them, unless it
        is still at work (then at a later look). -> the threads started"""
        if self.scan():
            self.tell()
        told = False
        for it in list(self.items.values()):
            if it['m'] and it['state'] is None and not it['busy']:
                self.look(it)
                told = True
        if told:
            self.tell()
        try:
            left = os.listdir(os.path.join(A.HOME, 'addons'))
        except OSError:
            left = []
        for aid in left:
            if not self.on(aid):  # (nothing piles up for one that is off or gone)
                d, names = self._left(aid)
                for n in names:
                    with contextlib.suppress(OSError):
                        os.remove(os.path.join(d, n))
        started = []
        for it in list(self.items.values()):
            if not self.on(it['id']):
                continue
            now, due = time.time(), []
            for t in it['m']['tasks']:
                k = it['tasks'][t['id']]
                if not k['next']:
                    k['next'] = now + 30  # (the service just started, or it was switched on at the command line)
                elif now >= k['next']:
                    due.append(t)
            if (due or self._left(it['id'])[1]) and self.claim(it, 'events'):
                for t in due:
                    it['tasks'][t['id']]['next'] = now + t['every']
                th = threading.Thread(target=self.serve, args=(it, due), daemon=True)
                th.start()
                started.append(th)
        return started

    def loop(self):
        time.sleep(15)
        while True:
            try:
                self.step()
            except Exception as e:
                self.note(tx(f'插件出错：{e!r}', f'Add-ons failed: {e!r}'), False)
            time.sleep(TICK)


def command(argv, say=print, lang=None):
    """sturnus addon [add DIR | remove ID | on ID | off ID]: the add-ons on this machine, from its command line."""
    c, arg = (argv + ['', ''])[:2]
    if c == 'add' and arg:
        m, why = add(arg)
        if not m:
            return say(f'not added: {why}') or 1
        say(f'added {m["id"]} {m["version"]}: {m["name"]["en"]}. Switch it on under Settings -> Add-ons, or: sturnus addon on {m["id"]}')
        return 0
    if c == 'remove' and arg:
        why = remove(arg)
        say(why or f'removed {arg}')
        return 1 if why else 0
    if c in ('on', 'off') and arg:
        ok, msg = Addons(lang=lang).act({'addon': arg, 'on': c == 'on'})
        say(msg)
        return 0 if ok else 1
    if c:
        say('sturnus addon [add DIR | remove ID | on ID | off ID]')
        return 1
    a = Addons()
    for it in a.items.values():
        m = it['m']
        say(f'{it["id"]:<14} ' + (f'{"on" if a.on(it["id"]) else "off":<4} {m["version"]:<10} {m["name"]["en"]}' if m else f'not loaded: {it["error"]}'))
    if not a.items:
        say(f'no add-ons (they live in {HOME}; add one with: sturnus addon add DIR)')
    return 0
