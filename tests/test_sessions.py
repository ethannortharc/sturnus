"""Sessions that last, end to end: a trial deck of this checkout, a stand-in agent (fake_agent.py), and a tmux server of
its own. A session is started from the page, goes on through a cleared conversation, is stopped, goes on in a second
terminal, loses that terminal, is opened from a command line, is archived and deleted; an agent started by hand becomes
a session too.

    python3 -m unittest tests.test_sessions

Skipped without tmux. Everything is in a temporary folder (config, cache, mailbox, tasks, sessions, the tmux socket); the
deck and the tmux server are stopped by their PIDs."""
import importlib.machinery
import importlib.util
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AGENT = os.path.join(HERE, 'tests', 'fake_agent.py')


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


@unittest.skipUnless(shutil.which('tmux'), 'needs tmux')
class Sessions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = os.path.realpath(tempfile.mkdtemp(prefix='st-', dir='/tmp'))  # (short: a tmux socket's path has a limit)
        for d in ('conf', 'cache', 'mail', 'reg', 'tm', 'zj', 'fake', 'proj', 'elsewhere'):
            os.makedirs(f'{cls.dir}/{d}')
        cls.port = free_port()
        with open(f'{cls.dir}/conf/config.json', 'w') as f:
            json.dump({'port': cls.port, 'host': '127.0.0.1', 'tailnet': False, 'pane_titles': False, 'terminal': 'tmux-window',
                       'launch': {k: [sys.executable, AGENT] for k in ('claude', 'codex', 'cursor')},  # (never the real ones: a test starts no agent of the person's)
                       'models': {r: {'source': 'api', 'url': 'http://127.0.0.1:9/v1', 'model': 'none'} for r in ('summary', 'assist')}}, f)
        keep = {k: v for k, v in os.environ.items() if not k.startswith(('TMUX', 'ZELLIJ', 'STURNUS', 'AMAIL'))}  # (run from inside a session or not: the same)
        cls.env = {**keep, 'STURNUS_CONF': f'{cls.dir}/conf/config.json', 'STURNUS_CACHE': f'{cls.dir}/cache', 'AMAIL_HOME': f'{cls.dir}/mail',
                   'STURNUS_TASKS': f'{cls.dir}/tasks.db', 'AMAIL_CLAUDE_SESSIONS': f'{cls.dir}/reg', 'TMUX_TMPDIR': f'{cls.dir}/tm',
                   'FAKE_HOME': f'{cls.dir}/fake', 'FAKE_AMAIL': os.path.join(HERE, 'amail'), 'STURNUS_QUIET': '3', 'STURNUS_REST_EVERY': '2',
                   'ZELLIJ_SOCKET_DIR': f'{cls.dir}/zj'}  # (no Zellij session of the person's can be reached from here, whatever a test starts)
        cls.log = open(f'{cls.dir}/deck.log', 'w')
        cls.deck = subprocess.Popen([sys.executable, os.path.join(HERE, 'sturnus'), 'serve'], env=cls.env, stdout=cls.log, stderr=cls.log)
        for _ in range(120):
            try:
                urllib.request.urlopen(f'http://127.0.0.1:{cls.port}/login.html', timeout=1)
                break
            except OSError:
                time.sleep(.25)
        else:
            cls.tearDownClass()
            raise RuntimeError('the trial deck did not come up: ' + open(f'{cls.dir}/deck.log').read()[-2000:])
        token = subprocess.run([sys.executable, os.path.join(HERE, 'sturnus'), 'token'], env=cls.env, capture_output=True, text=True).stdout.split()[-1]
        req = urllib.request.Request(f'http://127.0.0.1:{cls.port}/api/login', json.dumps({'token': token}).encode(), {'Content-Type': 'application/json', 'X-Deck': '1'})
        with urllib.request.urlopen(req, timeout=10) as r:
            cls.cookie = r.headers['Set-Cookie'].split(';')[0]

    @classmethod
    def tearDownClass(cls):
        cls.deck.terminate()  # (by its PID)
        try:
            cls.deck.wait(10)
        except subprocess.TimeoutExpired:
            cls.deck.kill()
        cls.log.close()
        r = subprocess.run(['tmux', 'display-message', '-p', '#{pid}'], env=cls.env, capture_output=True, text=True)  # (this folder's own server)
        if r.returncode == 0 and r.stdout.strip().isdigit():
            pid = int(r.stdout.strip())
            try:
                os.kill(pid, signal.SIGTERM)
                for _ in range(40):  # (gone, and what ran in it with it, before the folder is: an agent on its way out still writes there)
                    os.kill(pid, 0)
                    time.sleep(.1)
            except OSError:
                pass
            time.sleep(1)
        shutil.rmtree(cls.dir, ignore_errors=True)

    def call(self, path, body=None):
        req = urllib.request.Request(f'http://127.0.0.1:{self.port}{path}', json.dumps(body).encode() if body is not None else None,
                                     {'Content-Type': 'application/json', 'X-Deck': '1', 'Cookie': self.cookie})
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            return json.load(e)

    def kept(self, kid):
        return next((k for k in self.call('/api/state').get('kept') or [] if k['id'] == kid), None)

    def until(self, what, why, wait=25):
        """What a look returns, once it returns something; the test fails with WHY after WAIT seconds of nothing."""
        end = time.time() + wait
        while time.time() < end:
            v = what()
            if v:
                return v
            time.sleep(.4)
        with open(f'{self.dir}/deck.log') as f:
            self.fail(why + '\n' + f.read()[-1500:])

    def said(self, kid):
        return [i['text'] for i in self.call(f'/api/transcript?kept={kid}')['items']]

    def tmux(self, *a):
        return subprocess.run(['tmux', *a], env=self.env, capture_output=True, text=True)

    def test_a_session_from_start_to_delete(self):
        proj = f'{self.dir}/proj'
        j = self.call('/api/space', {'do': 'add', 'name': 'Proj', 'paths': [proj]})
        self.assertTrue(j['ok'], j)
        ws = j['id']
        self.assertFalse(self.call('/api/space', {'do': 'add', 'name': 'Again', 'paths': [proj]})['ok'])  # (a folder is in one workspace only)

        # started from the page: a session at once, bound to what runs for it
        j = self.call('/api/new', {'kind': 'claude', 'cwd': proj, 'prompt': 'first ask'})
        self.assertTrue(j['ok'] and j.get('kept'), j)
        kid = j['kept']
        k = self.until(lambda: (lambda k: k if k and k['live'] and k['nsegs'] == 1 and not k['live'].startswith('new:') else None)(self.kept(kid)), 'the started session was not bound')
        self.assertEqual((k['space'], k['kind'], k['title'], k['term']['mux'], k['term']['grp'], k['nterms']), (ws, 'claude', 'first ask', 'tmux', 'tmux:Proj', 1))
        self.until(lambda: 'done: first ask' in self.said(kid), 'its first ask was not answered')
        full = self.call(f'/api/kept?id={kid}')['kept']
        self.assertEqual(([s['how'] for s in full['segs']], [t['ended'] for t in full['terms']], full['terms'][0]['words']), (['new'], [None], 'tmux attach -t Proj'))

        # words from the page are typed into its terminal
        self.until(lambda: (self.kept(kid) or {}).get('state') == 'idle', 'it did not come to rest')
        j = self.call('/api/say', {'id': k['live'], 'text': 'second ask'})
        self.assertEqual((j['ok'], j.get('how')), (True, 'type'), j)  # (the page says beside the words how they went)
        self.until(lambda: 'done: second ask' in self.said(kid), 'the words typed did not reach it')
        # the model it runs on is read from its conversation; one set from the page is a command typed into its terminal
        self.until(lambda: (self.kept(kid) or {}).get('model') == {'model': 'claude-fable-5-2', 'effort': 'high', 'speed': 'standard'}, 'its model was not read')
        for words in ('/model opus', '/effort low', '/fast on'):
            self.assertTrue(self.call('/api/type', {'id': k['live'], 'text': words, 'enter': True})['ok'])
        self.assertTrue(self.call('/api/say', {'id': k['live'], 'text': 'and again'})['ok'])
        self.until(lambda: (self.kept(kid) or {}).get('model') == {'model': 'claude-opus-5-5', 'effort': 'low', 'speed': 'fast'}, 'its new model was not read')
        got = self.call(f'/api/transcript?kept={kid}')
        self.assertTrue(got['sig'] and got['items'])
        self.assertEqual(self.call(f'/api/transcript?kept={kid}&have={got["sig"]}'), {'same': True, 'sig': got['sig'], 'more': False})

        # words for it while it works go into its terminal at once, and are in its conversation where they took effect:
        # after the step it was on, before what it did with them
        self.assertTrue(self.call('/api/type', {'id': k['live'], 'text': '/work 5', 'enter': True})['ok'])
        self.until(lambda: (self.kept(kid) or {}).get('state') == 'working', 'it did not get to work')
        j = self.call('/api/say', {'id': k['live'], 'text': 'one more thing'})
        self.assertEqual((j['ok'], j.get('how')), (True, 'type'), j)  # (not held until its turn ends)
        self.until(lambda: 'done: /work 5' in self.said(kid), 'its work did not end')
        said = self.said(kid)
        at = said.index('one more thing')
        self.assertEqual(said[at - 1:at + 3], ['a step', 'one more thing', 'noted: one more thing', 'done: /work 5'], said[-8:])
        self.assertEqual([i['who'] for i in self.call(f'/api/transcript?kept={kid}')['items'] if i['text'] == 'one more thing'], ['user'])

        # a cleared conversation in the same terminal: the same session, a second conversation
        self.assertTrue(self.call('/api/type', {'id': self.kept(kid)['live'], 'text': '/clear', 'enter': True})['ok'])
        k = self.until(lambda: (lambda k: k if k and k['nsegs'] == 2 and k['live'] else None)(self.kept(kid)), 'the cleared conversation did not become its second')
        self.assertEqual((k['nterms'], [s['how'] for s in self.call(f'/api/kept?id={kid}')['kept']['segs']]), (1, ['new', 'clear']))
        self.assertIn('done: second ask', self.said(kid))  # (what was said before the clear is still its)
        self.assertTrue(self.call('/api/say', {'id': k['live'], 'text': 'after the clear'})['ok'])
        self.until(lambda: 'done: after the clear' in self.said(kid), 'the ask after the clear was not answered')

        # stopped by the person; then on again, in a second terminal, with the same conversation
        self.assertTrue(self.call('/api/kept', {'id': kid, 'do': 'stop'})['ok'])
        k = self.until(lambda: (lambda k: k if k and not k['live'] and k['state'] == 'stopped' else None)(self.kept(kid)), 'it did not stop')
        self.assertEqual(k['ended']['why'], 'stopped')
        j = self.call('/api/resume', {'id': kid, 'text': 'third ask'})
        self.assertTrue(j['ok'], j)
        self.assertFalse(self.call('/api/resume', {'id': kid})['ok'])  # (one process on a conversation: not a second)
        k = self.until(lambda: (lambda k: k if k and k['live'] and not k['live'].startswith('new:') and k['nterms'] == 2 else None)(self.kept(kid)), 'it did not go on')
        self.assertEqual(k['nsegs'], 2)
        self.until(lambda: 'done: third ask' in self.said(kid), 'the ask it went on with was not answered')
        self.assertFalse(self.call('/api/resume', {'id': kid})['ok'])

        # its terminal closed under it: the session stays, stopped, and says why
        pane = self.kept(kid)['term']['pane']
        self.assertEqual(self.tmux('kill-pane', '-t', pane).returncode, 0)
        k = self.until(lambda: (lambda k: k if k and not k['live'] and k['ended'] else None)(self.kept(kid)), 'the closed terminal was not noticed')
        self.assertEqual((k['ended']['why'], k['state']), ('closed', 'stopped'))

        # at a command line: listed, and opened (which starts it again; with no terminal here, only that far)
        out = subprocess.run([sys.executable, os.path.join(HERE, 'sturnus'), 'ls'], env=self.env, capture_output=True, text=True).stdout
        self.assertIn('first ask', out)
        self.assertIn('Proj', out)
        self.assertIn('已停止', out)
        r = subprocess.run([sys.executable, os.path.join(HERE, 'sturnus'), 'open', '1'], env=self.env, capture_output=True, text=True, stdin=subprocess.DEVNULL)
        self.assertIn('first ask', r.stdout, r.stderr)
        k = self.until(lambda: (lambda k: k if k and k['live'] and not k['live'].startswith('new:') and k['nterms'] == 3 else None)(self.kept(kid)), 'opening it from the command line did not start it')

        # renamed, pinned, moved out of its workspace and back
        self.assertTrue(self.call('/api/kept', {'id': kid, 'do': 'title', 'title': 'Mine'})['ok'])
        self.assertTrue(self.call('/api/kept', {'id': kid, 'do': 'pin'})['ok'])
        k = self.kept(kid)
        self.assertEqual((k['title'], bool(k['pinned'])), ('Mine', True))
        self.assertTrue(self.call('/api/space', {'do': 'place_drop', 'id': ws, 'path': proj})['ok'])
        self.assertIsNone(self.kept(kid)['space'])
        self.assertTrue(self.call('/api/space', {'do': 'place_add', 'id': ws, 'path': proj})['ok'])
        self.assertEqual(self.kept(kid)['space'], ws)

        # archived: stopped, out of the list, still there to find; deleted only then
        self.assertFalse(self.call('/api/kept', {'id': kid, 'do': 'delete'})['ok'])
        self.assertTrue(self.call('/api/kept', {'id': kid, 'do': 'archive'})['ok'])
        self.until(lambda: self.kept(kid) is None, 'the archived session stayed in the list')
        every = {k['id']: k for k in self.call('/api/kept')['kept']}
        self.assertTrue(every[kid]['archived'] and not every[kid]['live'])
        time.sleep(5)  # (its agent has gone by now: it does not come back by itself)
        self.assertTrue({k['id']: k for k in self.call('/api/kept')['kept']}[kid]['archived'])
        self.assertTrue(self.call('/api/kept', {'id': kid, 'do': 'delete'})['ok'])
        self.assertNotIn(kid, {k['id'] for k in self.call('/api/kept')['kept']})

    def test_another_agent_takes_a_session_on_with_what_it_is_told(self):
        proj = f'{self.dir}/elsewhere'
        kid = self.call('/api/new', {'kind': 'claude', 'cwd': proj, 'prompt': 'find the slow query', 'title': 'Slow query'})['kept']
        self.until(lambda: 'done: find the slow query' in self.said(kid), 'its ask was not answered')
        hits = self.until(lambda: self.call('/api/search?q=slow%20query')['hits'], 'what was said was not found')
        self.assertEqual((hits[0]['kept'], hits[0]['title']), (kid, 'Slow query'))
        self.assertTrue(self.call('/api/kept', {'id': kid, 'do': 'stop'})['ok'])
        self.until(lambda: (lambda k: k and not k['live'])(self.kept(kid)), 'it did not stop')
        self.assertFalse(self.call('/api/handover', {'id': kid, 'kind': 'vim'})['ok'])
        j = self.call('/api/handover', {'id': kid, 'kind': 'codex', 'text': 'then fix it'})
        self.assertTrue(j['ok'], j)
        for part in ('Slow query', 'Claude Code', 'find the slow query', 'then fix it', j['file']):
            self.assertIn(part, j['note'])
        with open(j['file']) as f:
            self.assertIn('find the slow query', f.read())
        self.assertTrue(self.call('/api/resume', {'id': kid, 'kind': 'codex', 'text': 'HANDOVER ' + j['note']})['ok'])
        k = self.until(lambda: (lambda k: k if k and k['live'] and not k['live'].startswith('new:') and k['nsegs'] == 2 else None)(self.kept(kid)), 'the other agent did not take it on')
        self.assertEqual(k['nterms'], 2)  # (a new conversation of its own, in a second terminal, in the same session)
        self.until(lambda: any(x.startswith('HANDOVER ') for x in self.said(kid)), 'what it was told is not in the session')
        self.assertIn('done: find the slow query', self.said(kid))  # (and what was said before is still its)

    def test_a_session_in_a_worktree_of_its_own_shows_what_it_changed_and_is_merged_back(self):
        repo = f'{self.dir}/repo'
        os.makedirs(repo)
        git = lambda *a, cwd=repo: subprocess.run(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', *a], cwd=cwd, capture_output=True, text=True, env=self.env)
        git('init', '-q', '-b', 'main')
        open(f'{repo}/.gitignore', 'w').write('.env\n')
        open(f'{repo}/a.txt', 'w').write('one\n')
        git('add', '.'), git('commit', '-q', '-m', 'first')
        self.assertFalse(self.call('/api/new', {'kind': 'claude', 'cwd': f'{self.dir}/elsewhere', 'worktree': True})['ok'])  # (no repository there)
        j = self.call('/api/new', {'kind': 'claude', 'cwd': repo, 'prompt': 'add b', 'title': 'Add B file', 'worktree': True})
        self.assertTrue(j['ok'], j)
        kid = j['kept']
        k = self.until(lambda: (lambda k: k if k and k['live'] and not k['live'].startswith('new:') else None)(self.kept(kid)), 'the session in a worktree did not start')
        work = f'{repo}/.claude/worktrees/add-b-file'
        self.assertEqual(k['folder'], work)
        self.assertEqual(git('status', '--porcelain').stdout, '')  # (the worktrees folder is out of the repository's own view)
        open(f'{work}/b.txt', 'w').write('two\nthree\n')
        open(f'{work}/a.txt', 'a').write('more\n')
        open(f'{work}/.env', 'w').write('KEY=1\n')  # (a file git ignores: it would go with the folder)
        d = self.call(f'/api/diff?kept={kid}')
        self.assertEqual((d['branch'], d['main'], d['own'], [(f['path'], f['add'], f['state']) for f in d['files']]), ('add-b-file', 'main', True, [('a.txt', 1, 'changed'), ('b.txt', 0, 'new')]))
        self.assertIn('+more', self.call(f'/api/diff?kept={kid}&file=a.txt')['diff'])
        self.assertIn('+three', self.call(f'/api/diff?kept={kid}&file=b.txt')['diff'])
        self.assertFalse(self.call(f'/api/diff?kept={kid}&file=../../a.txt')['ok'])
        self.assertFalse(self.call('/api/kept', {'id': kid, 'do': 'merge'})['ok'])  # (still running)
        self.assertTrue(self.call('/api/kept', {'id': kid, 'do': 'stop'})['ok'])
        self.until(lambda: (lambda k: k and not k['live'])(self.kept(kid)), 'it did not stop')
        self.assertFalse(self.call('/api/kept', {'id': kid, 'do': 'merge'})['ok'])  # (changes not committed)
        git('add', '.', cwd=work), git('commit', '-q', '-m', 'b', cwd=work)
        # another agent at work in its worktree: the folder is not taken from under it
        self.assertEqual(self.tmux('new-session', '-d', '-s', 'guest', '-c', work, sys.executable, AGENT, 'guest').returncode, 0)
        guest = self.until(lambda: next((k for k in self.call('/api/state').get('kept') or [] if k['folder'] == work and k['live'] and k['id'] != kid), None), 'the guest did not become a session')
        j = self.call('/api/kept', {'id': kid, 'do': 'merge'})
        self.assertEqual((j['ok'], os.path.exists(work), os.path.exists(f'{repo}/b.txt')), (False, True, False), j)
        self.assertFalse(self.call(f'/api/diff?kept={guest["id"]}')['own'])  # (a worktree it only works in is not its to merge:
        self.assertFalse(self.call('/api/kept', {'id': guest['id'], 'do': 'merge'})['ok'])  # running or not)
        self.tmux('kill-session', '-t', 'guest')
        self.until(lambda: (lambda k: k and not k['live'])(self.kept(guest['id'])), 'the guest did not end')
        self.assertFalse(self.call('/api/kept', {'id': guest['id'], 'do': 'merge'})['ok'])
        # files git ignores are in it: nothing is done until the person says so
        j = self.call('/api/kept', {'id': kid, 'do': 'merge'})
        self.assertEqual((j['ok'], j.get('ask'), j.get('files'), os.path.exists(f'{work}/.env'), os.path.exists(f'{repo}/b.txt')), (False, 'ignored', ['.env'], True, False), j)
        j = self.call('/api/kept', {'id': kid, 'do': 'merge', 'drop': True})
        self.assertTrue(j['ok'], j)
        self.assertFalse(self.call('/api/kept', {'id': kid, 'do': 'merge'})['ok'])  # (merged and gone: not its any more)
        self.assertEqual((open(f'{repo}/b.txt').read(), os.path.exists(work), git('branch', '--list', 'add-b-file').stdout), ('two\nthree\n', False, ''))

    def test_a_prompt_of_the_person_s_is_answered_from_the_page(self):
        from urllib.parse import quote
        os.makedirs(f'{self.dir}/asks', exist_ok=True)  # (a folder of its own: the other tests count the sessions in theirs)
        j = self.call('/api/new', {'kind': 'claude', 'cwd': f'{self.dir}/asks', 'prompt': 'start', 'title': 'Asks'})
        self.assertTrue(j['ok'], j)
        kid = j['kept']
        live = self.until(lambda: (lambda k: k and k['conv'] and k['live'] and not k['live'].startswith('new:') and k['live'])(self.kept(kid)), 'the session did not start')
        row = lambda: next((s for s in self.call('/api/state')['sessions'] if s['id'] == live), None) or {}
        item = lambda: next((i for i in self.call('/api/phone/inbox')['items'] if i['open_url'].endswith('/s/' + quote(live, safe=''))), None)

        def stop_at(text, answers):
            """It is given a line that stops it at a prompt; the item the page is given for that prompt, once its answers are these."""
            self.until(lambda: row().get('state') == 'idle', f'it did not come to rest before {text}')
            self.assertTrue(self.call('/api/type', {'id': live, 'text': text, 'enter': True})['ok'])
            return self.until(lambda: (lambda i: i and [a['id'] for a in i['actions']] == answers and i)(item()), f'the prompt of {text} did not offer {answers}')

        it = stop_at('/perm make build', ['allow', 'deny'])  # (a permission prompt: what it is for, yes or no)
        self.assertIn('make build', it['body'])
        self.assertEqual(((row().get('asking') or {}).get('tool'), row().get('prompting')), ('Bash', True), 'the row says what the prompt is for: the page shows it where the words go')
        self.assertTrue(self.call('/api/phone/actions/' + it['id'], {'choice': 'allow'})['ok'])
        self.until(lambda: 'ran: make build' in self.said(kid), 'Allow did not reach its prompt')
        self.assertFalse(self.call('/api/phone/actions/' + it['id'], {'choice': 'allow'})['ok'], 'an answer to a prompt that is gone types nothing')
        it = stop_at('/question', ['o1', 'o2', 'o3'])  # (one question with one answer: its options)
        self.assertEqual(len((row().get('asking') or {})['input']['questions'][0]['options']), 3)
        self.assertTrue(self.call('/api/phone/actions/' + it['id'], {'choice': 'o2'})['ok'])
        self.until(lambda: 'chosen: The private host only' in self.said(kid), 'the option picked did not reach its prompt')
        it = stop_at('/perm rm -rf build', ['allow', 'deny'])
        self.assertTrue(self.call('/api/phone/actions/' + it['id'], {'choice': 'deny'})['ok'])
        self.until(lambda: 'not done: the person said no to Bash' in self.said(kid), 'No did not reach its prompt')
        it = stop_at('/plan', [])  # (a plan is shown whole, and approved in the terminal: no answer is typed for it from here)
        self.assertIn('show an agent', it['body'])
        self.assertEqual((row().get('asking') or {}).get('tool'), 'ExitPlanMode')
        self.assertTrue(self.call('/api/type', {'id': live, 'text': '1', 'enter': False})['ok'])  # (as the person would, in its terminal)
        self.until(lambda: 'plan approved' in self.said(kid), 'the key typed in its terminal did not answer the plan')
        self.assertTrue(self.call('/api/kept', {'id': kid, 'do': 'stop'})['ok'])
        self.until(lambda: not self.kept(kid)['live'], 'it did not stop')

    def test_an_agent_started_by_hand_is_a_session_too(self):
        there = f'{self.dir}/elsewhere'
        r = self.tmux('new-session', '-d', '-s', 'hand', '-c', there, sys.executable, AGENT, 'by hand')
        self.assertEqual(r.returncode, 0, r.stderr)
        k = self.until(lambda: next((k for k in self.call('/api/state').get('kept') or [] if k['folder'] == there and k['live']), None), 'the agent started by hand did not become a session')
        self.assertEqual((k['space'], k['term']['grp'], k['nsegs']), (None, 'tmux:hand', 1))
        self.assertEqual(self.call(f'/api/kept?id={k["id"]}')['kept']['segs'][0]['how'], 'found')
        self.assertIn('done: by hand', self.said(k['id']))
        # one started by hand in a terminal that carries a session's words (that session's agent opened the terminal): a session of its own
        j = self.call('/api/new', {'kind': 'claude', 'cwd': f'{self.dir}/proj', 'prompt': 'mine', 'title': 'Mine'})
        self.assertTrue(j['ok'], j)
        mine = j['kept']
        self.until(lambda: (lambda m: m and m['live'] and not m['live'].startswith('new:'))(self.kept(mine)), 'the session did not start')
        r = self.tmux('new-session', '-d', '-s', 'leak', '-c', there, 'env', f'STURNUS_SESSION={mine}', f'STURNUS_NEW={j["marker"]}', sys.executable, AGENT, 'leaked')
        self.assertEqual(r.returncode, 0, r.stderr)
        other = self.until(lambda: next((x for x in self.call('/api/state').get('kept') or [] if x['live'] and (x['term'] or {}).get('grp') == 'tmux:leak'), None), 'the one that inherited a session’s words did not show')
        self.assertNotIn(other['id'], (mine, k['id']))
        self.assertEqual((len(self.call(f'/api/kept?id={mine}')['kept']['segs']), self.kept(mine)['live'] != other['live']), (1, True))

    def test_one_outside_zellij_and_tmux_is_brought_to_a_terminal_here(self):
        there = f'{self.dir}/elsewhere'
        out = subprocess.Popen([sys.executable, AGENT, 'outside'], cwd=there, env=self.env, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)  # (a plain process: in no pane)
        try:
            k = self.until(lambda: next((x for x in self.call('/api/state').get('kept') or [] if x['live'] and 'done: outside' in self.said(x['id'])), None), 'the one outside did not become a session')
            self.assertEqual((k['term']['mux'], k['nsegs']), ('', 1))
            j = self.call('/api/kept', {'id': k['id'], 'do': 'take'})
            self.assertTrue(j['ok'], j)
            self.assertIsNotNone(out.wait(10))  # (its process was ended first: no two on one conversation)
            m = self.until(lambda: (lambda x: x if x and x['live'] and not x['live'].startswith('new:') and x['term'] and x['term']['mux'] == 'tmux' else None)(self.kept(k['id'])), 'it did not come up in a terminal here')
            full = self.call(f'/api/kept?id={k["id"]}')['kept']
            self.assertEqual((len(full['segs']), [(t['mux'], t['why'] or '') for t in full['terms']]), (1, [('', 'moved'), ('tmux', '')]))
            self.assertTrue(self.call('/api/say', {'id': m['live'], 'text': 'here now'})['ok'])
            self.until(lambda: 'done: here now' in self.said(k['id']), 'words did not reach it in its new terminal')
            self.assertFalse(self.call('/api/kept', {'id': k['id'], 'do': 'take'})['ok'])  # (already in a pane)
        finally:
            if out.poll() is None:
                out.kill()

    def test_one_not_used_for_long_has_its_terminal_closed_and_goes_on_when_taken_up(self):
        mk = lambda title: self.call('/api/new', {'kind': 'claude', 'cwd': f'{self.dir}/proj', 'prompt': title, 'title': title})['kept']
        rests, pinned = mk('rests'), mk('pinned')
        for kid in (rests, pinned):
            self.until(lambda: (lambda k: k and k['live'] and not k['live'].startswith('new:') and k['state'] == 'idle')(self.kept(kid)), 'a session did not come to rest')
        self.assertTrue(self.call('/api/kept', {'id': pinned, 'do': 'pin', 'on': True})['ok'])
        self.assertFalse(self.call('/api/terminal', {'rest_days': -1})['ok'])
        self.assertEqual(self.call('/api/state')['terminal']['rest_days'], 7)
        try:
            self.assertTrue(self.call('/api/terminal', {'rest_days': 0.00003})['ok'])  # (about three seconds, for the test)
            self.until(lambda: (lambda k: k and not k['live'] and (k['ended'] or {}).get('why') == 'rested')(self.kept(rests)), 'the idle one was not put to rest', wait=45)
            self.assertTrue(self.kept(pinned)['live'])  # (a pinned one is left alone)
        finally:
            self.assertTrue(self.call('/api/terminal', {'rest_days': 0})['ok'])
        j = self.call('/api/resume', {'id': rests, 'text': 'on again'})  # (taken up again: a new terminal, the same conversation)
        self.assertTrue(j['ok'], j)
        self.until(lambda: 'done: on again' in self.said(rests), 'it did not go on')
        self.until(lambda: (lambda k: k and k['live'] and not k['live'].startswith('new:'))(self.kept(rests)), 'its new terminal was not seen')
        full = self.call(f'/api/kept?id={rests}')['kept']
        self.assertEqual((len(full['segs']), [t['why'] or '' for t in full['terms']]), (1, ['rested', '']))
        self.assertTrue(self.call('/api/terminal', {'rest_days': 7})['ok'])



if __name__ == '__main__':
    unittest.main()
