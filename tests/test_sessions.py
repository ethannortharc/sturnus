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
        for d in ('conf', 'cache', 'mail', 'reg', 'tm', 'fake', 'proj', 'elsewhere'):
            os.makedirs(f'{cls.dir}/{d}')
        cls.port = free_port()
        with open(f'{cls.dir}/conf/config.json', 'w') as f:
            json.dump({'port': cls.port, 'host': '127.0.0.1', 'tailnet': False, 'pane_titles': False, 'terminal': 'tmux-window',
                       'launch': {'claude': [sys.executable, AGENT], 'codex': ['codex'], 'cursor': ['cursor-agent']},
                       'models': {r: {'source': 'api', 'url': 'http://127.0.0.1:9/v1', 'model': 'none'} for r in ('summary', 'assist')}}, f)
        keep = {k: v for k, v in os.environ.items() if not k.startswith(('TMUX', 'ZELLIJ', 'STURNUS', 'AMAIL'))}  # (run from inside a session or not: the same)
        cls.env = {**keep, 'STURNUS_CONF': f'{cls.dir}/conf/config.json', 'STURNUS_CACHE': f'{cls.dir}/cache', 'AMAIL_HOME': f'{cls.dir}/mail',
                   'STURNUS_TASKS': f'{cls.dir}/tasks.db', 'AMAIL_CLAUDE_SESSIONS': f'{cls.dir}/reg', 'TMUX_TMPDIR': f'{cls.dir}/tm',
                   'FAKE_HOME': f'{cls.dir}/fake', 'FAKE_AMAIL': os.path.join(HERE, 'amail'), 'STURNUS_QUIET': '3'}
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
            try:
                os.kill(int(r.stdout.strip()), signal.SIGTERM)
            except OSError:
                pass
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
        self.fail(why + '\n' + open(f'{self.dir}/deck.log').read()[-1500:])

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
        self.assertTrue(self.call('/api/say', {'id': k['live'], 'text': 'second ask'})['ok'])
        self.until(lambda: 'done: second ask' in self.said(kid), 'the words typed did not reach it')

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

    def test_an_agent_started_by_hand_is_a_session_too(self):
        there = f'{self.dir}/elsewhere'
        r = self.tmux('new-session', '-d', '-s', 'hand', '-c', there, sys.executable, AGENT, 'by hand')
        self.assertEqual(r.returncode, 0, r.stderr)
        k = self.until(lambda: next((k for k in self.call('/api/state').get('kept') or [] if k['folder'] == there and k['live']), None), 'the agent started by hand did not become a session')
        self.assertEqual((k['space'], k['term']['grp'], k['nsegs']), (None, 'tmux:hand', 1))
        self.assertEqual(self.call(f'/api/kept?id={k["id"]}')['kept']['segs'][0]['how'], 'found')
        self.assertIn('done: by hand', self.said(k['id']))


if __name__ == '__main__':
    unittest.main()
