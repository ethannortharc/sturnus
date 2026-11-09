"""The Sturnus phone app's side of the deck: pairing a phone, its key, and the small view it merges across machines.

    python3 -m unittest discover -s tests

The pairing and view tests run on a temporary folder. The HTTP tests start one trial deck of this checkout on a spare
port with its own config, cache, mailbox and an empty Claude registry; it is stopped by its PID."""
import importlib.machinery
import importlib.util
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = tempfile.mkdtemp(prefix='sturnus-app-')
ENV = dict(STURNUS_CONF=f'{TMP}/conf/config.json', STURNUS_CACHE=f'{TMP}/cache', AMAIL_HOME=f'{TMP}/mail',
           STURNUS_TASKS=f'{TMP}/tasks.db', AMAIL_CLAUDE_SESSIONS=f'{TMP}/none', AMAIL_NAME='app-test')
os.environ.update(ENV)


def load(name):
    loader = importlib.machinery.SourceFileLoader(name, os.path.join(HERE, name))
    module = importlib.util.module_from_spec(importlib.util.spec_from_loader(name, loader))
    loader.exec_module(module)
    return module


S = load('sturnus')
PANE = {'mux': 'zellij', 'session': 'work', 'pane': '3'}


def session(**kw):
    s = {'id': 'claude:abc', 'name': 'work-1', 'kind': 'claude', 'state': 'idle', 'since': 50, 'at': 60, 'loc': PANE,
         'title': '', 'summary': '', 'needs_you': '', 'asks': [], 'tool': None, 'tool_at': None, 'tool_end': None, 'born': 10}
    s.update(kw)
    return s


class FakeDeck:
    def __init__(self, sessions):
        self.lock, self.changed = threading.Lock(), threading.Condition()
        self.state = {'sessions': sessions, 'groups': {'work': {'clients': 1}}, 'workspaces': [{'key': 'w1', 'name': 'software'}]}
        self.projects = type('P', (), {'known': {'p1': {'name': 'sturnus'}}})()

    def find(self, sid):
        return next((s for s in self.state['sessions'] if s['id'] == sid), None)


def places(**kw):
    """A deck's state beyond its sessions, as a collect leaves it: workspace w1 with projects p1 and p2, a channel, tasks."""
    works = [{'path': '/r/sturnus', 'branch': 'main', 'main': True, 'dirty': 0, 'at': 100, 'subject': 'Release 0.22'},
             {'path': '/r/wt/old', 'branch': 'old', 'main': False, 'dirty': 0, 'ahead': 1, 'behind': 9, 'at': 50, 'subject': 'Old'},
             {'path': '/r/wt/app', 'branch': 'app-workspaces', 'main': False, 'dirty': 2, 'ahead': 3, 'behind': 0, 'at': 200, 'subject': 'A view'}]
    st = {'workspaces': [{'key': 'w1', 'name': 'software', 'live': 1, 'at': 300, 'projects': ['p2', 'p1']}],
          'projects': {'p1': {'key': 'p1', 'name': 'sturnus', 'git': True, 'live': 1, 'at': 300, 'facts': {'main': 'main', 'tag': 'v0.21.1', 'works': works}},
                       'p2': {'key': 'p2', 'name': 'columba', 'git': True, 'live': 0, 'at': 10, 'facts': None}},
          'digests': {'w1': {'at': 290, 'headline': 'One thing moves', 'items': [{'thing': 'Phone app', 'now': 'a view', 'sessions': ['claude:abc', 'gone:1']},
                                                                                 {'thing': 'Old', 'now': '', 'sessions': ['gone:2']}]}},
          'boards': {'p1': {'key': 'p1', 'name': 'sturnus', 'kind': 'project', 'unread': 2, 'calls': 1, 'last': {'from': 'x', 'text': 'hi', 'at': 280},
                            'topics': [{'id': 't1', 'title': 'Pairing', 'closed': False, 'n': 4, 'at': 270}, {'id': 't2', 'title': 'Done', 'closed': True}]}},
          'tasks': [{'id': 't-1', 'scope': 'p1', 'scope_name': 'sturnus', 'title': 'Phone app', 'status': 'doing', 'shown': 'working', 'now': 'n', 'next': 'x',
                     'at': 300, 'sessions': [{'name': 'work-1', 'sid': 'claude:abc', 'live': True, 'st': 'working', 'title': 'T'}]},
                    {'id': 't-2', 'scope': 'p1', 'scope_name': 'sturnus', 'title': 'Shipped', 'status': 'done', 'at': 10, 'closed': 20, 'sessions': []}],
          'inbox': [{'id': 'abcdef123456', 'from': 'work-1', 'to': 'ethan', 'text': 'Look at this', 'at': 250}],
          'lock_issues': [{'key': '0123456789ab', 'holder': 'gone-1', 'branch': 'main', 'repo': '/r/sturnus', 'since': 100, 'why': 'gone-1 已经退出'}]}
    st.update(kw)
    return st


class Pairing(unittest.TestCase):
    def setUp(self):
        if os.path.exists(S.ACCESS):
            os.remove(S.ACCESS)
        self.a = S.Access()

    def test_a_code_pairs_one_phone_once(self):
        code = self.a.pair_code()
        self.assertRegex(code, r'^[A-HJKMNP-Z2-9]{8}$')
        key, msg = self.a.pair(code[:4] + '-' + code[4:].lower(), 'Ethan’s iPhone', 'tailnet')  # (as typed: a dash, any case)
        self.assertTrue(key, msg)
        self.assertEqual(self.a.device(key)['name'], 'Ethan’s iPhone')
        again, msg = self.a.pair(code, 'another', 'tailnet')
        self.assertIsNone(again)
        self.assertIn('配对码', msg)

    def test_a_code_that_ran_out_pairs_nothing(self):
        code = self.a.pair_code()
        self.a.d['codes'][S.Access.key(code)] = time.time() - 1
        self.a.save()
        self.assertIsNone(self.a.pair(code, 'x', 'tailnet')[0])

    def test_wrong_codes_are_counted_with_wrong_tokens(self):
        for _ in range(8):
            self.assertIsNone(self.a.pair('AAAAAAAA', 'x', 'tailnet')[0])
        code = self.a.pair_code()
        key, msg = self.a.pair(code, 'x', 'tailnet')
        self.assertIsNone(key)
        self.assertIn('10', msg)

    def test_the_file_keeps_only_hashes(self):
        code = self.a.pair_code()
        key, _ = self.a.pair(code, 'phone', 'tailnet')
        with open(S.ACCESS) as f:
            raw = f.read()
        self.assertNotIn(key, raw)
        self.assertNotIn(code, raw)

    def test_taking_a_phone_out_ends_its_key(self):
        key, _ = self.a.pair(self.a.pair_code(), 'phone', 'tailnet')
        [d] = self.a.devices()
        self.a.drop(d['key'])
        self.assertIsNone(self.a.device(key))

    def test_a_new_token_signs_out_phones_too(self):
        key, _ = self.a.pair(self.a.pair_code(), 'phone', 'tailnet')
        S.access_data(rotate=True)
        self.assertIsNone(S.Access().device(key))

    def test_no_key_and_a_wrong_key_are_nobody(self):
        self.a.pair(self.a.pair_code(), 'phone', 'tailnet')
        self.assertIsNone(self.a.device(''))
        self.assertIsNone(self.a.device('not-a-key'))


class View(unittest.TestCase):
    def view(self, sessions):
        return S.app_view(FakeDeck(sessions))

    def test_standing_follows_the_page(self):
        rows = {r['id']: r['standing'] for r in self.view([
            session(id='a', state='waiting', prompting=True),
            session(id='b', state='working', needs_you='Which colour?'),
            session(id='c', state='working', tool='AskUserQuestion', tool_at=5, tool_end=1),
            session(id='d', state='working'),
            session(id='e', state='idle', status='review'),
            session(id='f', state='idle'),
        ])['sessions']}
        self.assertEqual(rows, {'a': 'waiting', 'b': 'asking', 'c': 'waiting', 'd': 'working', 'e': 'review', 'f': 'idle'})

    def test_most_pressing_first_and_otherwise_in_the_order_they_began(self):
        ids = [r['id'] for r in self.view([
            session(id='late-idle', born=30), session(id='early-idle', born=1),
            session(id='working', state='working', born=20), session(id='waits', state='waiting', prompting=True, born=40),
        ])['sessions']]
        self.assertEqual(ids, ['waits', 'working', 'early-idle', 'late-idle'])

    def test_ended_gone_and_hidden_are_left_out_and_a_sub_agent_names_its_parent(self):
        rows = self.view([session(id='a'), session(id='b', state='ended'), session(id='c', state='gone'), session(id='d', hidden=True),
                          session(id='e', parent_id='a', born=20), session(id='f', stale=True)])['sessions']
        self.assertEqual([(r['id'], r['parent'], r['kids']) for r in rows], [('a', '', 1), ('e', 'a', 0)])

    def test_a_sub_agent_at_a_prompt_is_in_the_list_its_card_opens(self):
        v = self.view([session(id='a'), session(id='e', parent_id='a', state='waiting', prompting=True)])
        self.assertIn('e', {r['id'] for r in v['sessions']})
        self.assertEqual({i['session'] for i in v['inbox']}, {'e'})

    def test_names_of_project_and_workspace_and_how_words_get_there(self):
        [r] = self.view([session(project='p1', workspace='w1', state='working')])['sessions']
        self.assertEqual((r['project'], r['workspace'], r['say'], r['pane']), ('sturnus', 'software', 'queue', True))

    def test_groups_are_named_as_a_new_session_takes_them(self):
        deck = FakeDeck([session(loc={'mux': 'tmux', 'session': 'tmux:t', 'pane': '%0'})])
        deck.state['groups'] = {'work': {'mux': 'zellij'}, 'tmux:t': {'mux': 'tmux', 'name': 't'}}
        v = S.app_view(deck)
        self.assertEqual((v['groups'], v['sessions'][0]['group']), (['tmux:t', 'work'], 'tmux:t'))

    def test_a_prompt_comes_with_its_answers_and_its_session(self):
        bash = {'tool': 'Bash', 'input': {'command': 'touch x'}, 'use': 'toolu_1', 'at': 100}
        v = self.view([session(state='waiting', prompting=True, asking=bash, cc_status='waiting', loc_live=True)])
        [it] = v['inbox']
        self.assertEqual((it['kind'], it['session'], [a['id'] for a in it['actions']]), ('permission', 'claude:abc', ['allow', 'deny']))
        self.assertNotIn('asks', it)

    def test_rev_changes_with_what_is_shown_and_only_then(self):
        a = self.view([session(at=60)])['rev']
        self.assertEqual(a, self.view([session(at=61)])['rev'])  # (its last stir alone is no news)
        self.assertEqual(a, self.view([session(at=9999)])['rev'])
        self.assertNotEqual(a, self.view([session(state='working')])['rev'])
        self.assertNotEqual(a, self.view([session(title='Fix the build')])['rev'])
        # (a window no hook saw has its file's time as `since`, moving while it works; the recent folders reorder)
        self.assertEqual(a, self.view([session(since=51)])['rev'])
        deck = FakeDeck([session()])
        deck.state['dirs'] = ['~/b', '~/a']
        self.assertEqual(a, S.app_view(deck)['rev'])

    def test_a_wait_ends_at_news_or_at_its_time(self):
        deck = FakeDeck([session()])
        rev = S.app_view(deck)['rev']
        t = time.time()
        self.assertEqual(S.app_state(deck, rev, 1)['rev'], rev)
        self.assertGreaterEqual(time.time() - t, 0.9)

        def change():
            time.sleep(.3)
            with deck.lock:
                deck.state['sessions'] = [session(state='working')]
            with deck.changed:
                deck.changed.notify_all()
        threading.Thread(target=change).start()
        t = time.time()
        v = S.app_state(deck, rev, 20)
        self.assertNotEqual(v['rev'], rev)
        self.assertLess(time.time() - t, 3)
        self.assertEqual(S.app_state(deck, 'old', 20)['rev'], v['rev'])  # (a phone behind gets it at once)

    def placed(self, sessions, **kw):
        deck = FakeDeck(sessions)
        deck.state.update(places(**kw))
        deck.tasks_current = {'work-1': 't-1'}
        return S.app_view(deck)

    def test_a_workspace_comes_with_its_projects_their_work_items_and_its_overview(self):
        v = self.placed([session(project='p1', workspace='w1', state='working', branch='app-workspaces')])
        [w] = v['workspaces']
        self.assertEqual((w['key'], w['name'], w['headline']), ('w1', 'software', 'One thing moves'))
        self.assertEqual([x['thing'] for x in w['things']], ['Phone app'], 'an overview names only sessions the phone is shown')
        self.assertEqual(w['things'][0]['sessions'], ['claude:abc'])
        self.assertEqual([p['name'] for p in w['projects']], ['sturnus', 'columba'], 'the one with sessions on it first')
        p = w['projects'][0]
        self.assertEqual([x['branch'] for x in p['works']], ['main', 'app-workspaces', 'old'], 'main, then the newest worktrees')
        self.assertEqual((p['tag'], p['works'][1]['ahead'], p['works'][1]['dirty']), ('v0.21.1', 3, 2))
        self.assertEqual(p['board'], {'unread': 2, 'calls': 1, 'open': 1})
        self.assertEqual(w['projects'][1]['works'], [])
        [r] = v['sessions']
        self.assertEqual((r['pkey'], r['wkey'], r['task'], r['branch']), ('p1', 'w1', 't-1', 'app-workspaces'))

    def test_tasks_channels_mail_and_locks(self):
        v = self.placed([session()])
        self.assertEqual([(t['id'], t['shown']) for t in v['tasks']], [('t-1', 'working'), ('t-2', 'done')], 'open first, then the closed')
        self.assertEqual(v['tasks'][0]['sessions'], [{'name': 'work-1', 'sid': 'claude:abc', 'live': True, 'st': 'working'}])
        [b] = v['boards']
        self.assertEqual((b['key'], b['unread'], [t['title'] for t in b['topics']]), ('p1', 2, ['Pairing']), 'open discussions only')
        self.assertEqual([(m['id'], m['from']) for m in v['mail']], [('abcdef123456', 'work-1')])
        self.assertEqual([(l['key'], l['repo']) for l in v['locks']], [('0123456789ab', 'sturnus')])

    def test_the_newest_letters_when_there_are_many(self):
        v = self.placed([session()], inbox=[{'id': f'{i:012x}', 'from': 'x', 'text': str(i), 'at': i} for i in range(40)])
        self.assertEqual([m['text'] for m in v['mail']][-1], '39')
        self.assertEqual(len(v['mail']), 30)

    def test_a_lock_that_changed_hands_is_not_let_go(self):
        os.makedirs(S.A.path('locks'), exist_ok=True)
        f = S.A.path('locks', 'abcdefabcdef.json')
        S.A.put(f, {'holder': 'new-1', 'branch': 'main', 'repo': '/r', 'since': 1})
        ok, msg = S.Deck.act(FakeDeck([]), 'unlock', {'key': 'abcdefabcdef', 'holder': 'gone-1'})
        self.assertFalse(ok)
        self.assertIn('new-1', msg)
        self.assertTrue(os.path.exists(f))
        ok, _ = S.Deck.act(FakeDeck([]), 'unlock', {'key': 'abcdefabcdef', 'holder': 'new-1'})
        self.assertTrue(ok)
        self.assertFalse(os.path.exists(f))

    def test_a_project_stirring_is_no_news_but_a_new_commit_is(self):
        a = self.placed([session()])['rev']
        self.assertEqual(a, self.placed([session()], projects={**places()['projects'], 'p1': {**places()['projects']['p1'], 'at': 301}})['rev'])
        moved = places()['projects']['p1']
        moved = {**moved, 'facts': {**moved['facts'], 'works': moved['facts']['works'][:2] + [{**moved['facts']['works'][2], 'ahead': 4, 'subject': 'More'}]}}
        self.assertNotEqual(a, self.placed([session()], projects={**places()['projects'], 'p1': moved})['rev'])
        self.assertNotEqual(a, self.placed([session()], inbox=[])['rev'])

    def test_a_state_without_places_still_makes_a_view(self):
        v = self.view([session()])
        self.assertEqual((v['tasks'], v['boards'], v['mail'], v['locks']), ([], [], [], []))
        self.assertEqual([(w['key'], w['projects']) for w in v['workspaces']], [('w1', [])])

    def test_a_session_page_has_its_asks_report_tasks_kids_and_messages(self):
        deck = FakeDeck([session(asks=[{'id': 'a1', 'what': 'Pick a colour', 'quote': 'red or blue?', 'at': 5}], home=os.path.expanduser('~/x')),
                         session(id='claude:kid', name='kid-1', parent_id='claude:abc', pid=42, state='working', title='Review')])
        deck.state.update(places(reports={'claude:abc': {'at': 9, 'r': {'goal': 'Ship it', 'next': ['test']}}}, reporting=[],
                                 talk=[{'from': 'work-1', 'to': 'other', 'text': 'later', 'at': 3}, {'from': 'x', 'to': 'y', 'text': 'no', 'at': 2},
                                       {'from': 'other', 'to': 'work-1', 'text': 'first', 'at': 1}]))
        v = S.app_session(deck, 'claude:abc')
        self.assertEqual([a['id'] for a in v['asks']], ['a1'])
        self.assertEqual((v['report']['goal'], v['reporting'], v['cwd']), ('Ship it', False, '~/x'))
        self.assertEqual([t['id'] for t in v['tasks']], ['t-1'])
        self.assertEqual([(k['name'], k['running'], k['standing']) for k in v['kids']], [('kid-1', True, 'working')])
        self.assertEqual([m['text'] for m in v['msgs']], ['first', 'later'], 'its own, oldest first')
        self.assertEqual([m['id'] for m in v['mail']], ['abcdef123456'])
        self.assertIsNone(S.app_session(deck, 'nobody'))


class Keys(unittest.TestCase):
    """A phone's keys reach only the prompt it was shown, or a session at none when it was shown none."""
    BASH = {'tool': 'Bash', 'input': {'command': 'touch x'}, 'use': 'toolu_1', 'at': 100}

    def setUp(self):
        self.was = S.phone_now

    def tearDown(self):
        S.phone_now = self.was

    def now(self, reg, raw):
        S.phone_now = lambda s: (reg, raw)

    def at_prompt(self, asking=None):
        return session(state='waiting', prompting=True, asking=asking or self.BASH, cc_status='waiting', loc_live=True)

    def test_the_prompt_it_saw(self):
        s, deck = self.at_prompt(), None
        deck = FakeDeck([s])
        self.now({'status': 'waiting'}, {'state': 'waiting', 'asking': self.BASH})
        [it] = S.app_view(deck)['inbox']
        self.assertEqual(S.phone_prompt(deck, s), it['id'])

    def test_another_prompt_since_is_not_the_one_it_saw(self):
        s = self.at_prompt()
        deck = FakeDeck([s])
        [it] = S.app_view(deck)['inbox']
        other = {**self.BASH, 'input': {'command': 'rm -rf build'}, 'use': 'toolu_2', 'at': 200}
        self.now({'status': 'waiting'}, {'state': 'waiting', 'asking': other})  # (the records moved on before the look round)
        self.assertEqual(S.phone_prompt(deck, s), '?')
        s2 = self.at_prompt(other)
        deck2 = FakeDeck([s2])
        self.now({'status': 'waiting'}, {'state': 'waiting', 'asking': other})
        self.assertNotEqual(S.phone_prompt(deck2, s2), it['id'])

    def test_no_prompt_and_none_coming(self):
        s = session(state='idle')
        self.now({'status': 'idle'}, {'state': 'idle'})
        self.assertEqual(S.phone_prompt(FakeDeck([s]), s), '')

    def test_a_prompt_that_came_up_after_the_look_round(self):
        s = session(state='idle')
        self.now({'status': 'waiting'}, {'state': 'waiting', 'asking': self.BASH})
        self.assertEqual(S.phone_prompt(FakeDeck([s]), s), '?')


class AccessFile(unittest.TestCase):
    def setUp(self):
        if os.path.exists(S.ACCESS):
            os.remove(S.ACCESS)
        self.a = S.Access()

    def test_a_file_read_half_written_signs_nobody_out(self):
        key, _ = self.a.pair(self.a.pair_code(), 'phone', 'tailnet')
        token = self.a.d['token']
        with open(S.ACCESS, 'w'):
            pass  # (empty, as a reader could once catch it mid-write)
        os.utime(S.ACCESS, ns=(1, 1))
        self.assertIsNone(self.a.device('x'))
        self.assertEqual(self.a.d['token'], token)
        self.assertTrue(self.a.device(key))
        with self.assertRaises(SystemExit):
            S.access_data()
        self.assertNotEqual(S.access_data(rotate=True)['token'], token)  # (and the way out is the one the message names)

    def test_writes_from_two_processes_both_stay(self):
        code = self.a.pair_code()  # (as `sturnus pair` would, in its own process: another Access over the same file)
        other = S.Access()
        key, _ = other.pair(code, 'phone', 'tailnet')
        sid, _ = self.a.login(self.a.d['token'], 'browser')
        fresh = S.Access()
        self.assertTrue(fresh.device(key))
        self.assertTrue(fresh.check(sid))

    def test_a_new_code_ends_the_one_before(self):
        old = self.a.pair_code()
        new = self.a.pair_code()
        self.assertIsNone(self.a.pair(old, 'x', 'tailnet')[0])
        self.assertTrue(self.a.pair(new, 'x', 'tailnet')[0])

    def test_wrong_tries_are_counted_per_caller(self):
        for _ in range(8):
            self.a.pair('AAAAAAAA', 'x', '本机')
        self.assertIn('10', self.a.pair(self.a.pair_code(), 'x', '本机')[1])
        self.assertTrue(self.a.pair(self.a.pair_code(), 'x', 'my-iphone (100.1.2.3)')[0])


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


class OverHttp(unittest.TestCase):
    """The real deck's gate: a paired phone's key reaches the app's calls, not the browsers' settings."""

    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp(prefix='sturnus-app-http-')
        for d in ('conf', 'cache', 'mail', 'none'):
            os.makedirs(f'{cls.dir}/{d}')
        cls.port = free_port()
        with open(f'{cls.dir}/conf/config.json', 'w') as f:
            json.dump({'port': cls.port, 'host': '127.0.0.1', 'tailnet': False, 'pane_titles': False,
                       'models': {r: {'source': 'api', 'url': 'http://127.0.0.1:9/v1', 'model': 'none'} for r in ('summary', 'assist')}}, f)
        cls.env = {**os.environ, 'STURNUS_CONF': f'{cls.dir}/conf/config.json', 'STURNUS_CACHE': f'{cls.dir}/cache',
                   'AMAIL_HOME': f'{cls.dir}/mail', 'STURNUS_TASKS': f'{cls.dir}/tasks.db', 'AMAIL_CLAUDE_SESSIONS': f'{cls.dir}/none',
                   'STURNUS_DRY': '1'}
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

    @classmethod
    def tearDownClass(cls):
        cls.deck.terminate()  # (by its PID)
        try:
            cls.deck.wait(10)
        except subprocess.TimeoutExpired:
            cls.deck.kill()
        cls.log.close()

    def call(self, path, body=None, key=None, deck_header=True):
        h = {'Content-Type': 'application/json', **({'X-Deck': '1'} if deck_header else {}), **({'Authorization': f'Bearer {key}'} if key else {})}
        req = urllib.request.Request(f'http://127.0.0.1:{self.port}{path}', json.dumps(body).encode() if body is not None else None, h)
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.status, json.load(r)
        except urllib.error.HTTPError as e:
            return e.code, json.load(e)

    def code(self):
        out = subprocess.run([sys.executable, os.path.join(HERE, 'sturnus'), 'pair'], env=self.env, capture_output=True, text=True).stdout
        return next(l.split()[1] for l in out.splitlines() if l.startswith('code:'))

    def test_pair_then_read_and_answer_with_the_key(self):
        st, j = self.call('/api/app/pair', {'code': self.code(), 'device': 'Test iPhone'})
        self.assertEqual(st, 200, j)
        key = j['key']
        self.assertTrue(j['machine']['version'])
        st, v = self.call('/api/app/state', key=key)
        self.assertEqual(st, 200)
        self.assertEqual(set(v), {'machine', 'sessions', 'inbox', 'rev', 'groups', 'dirs', 'workspaces', 'tasks', 'boards', 'mail', 'locks'})
        st, j = self.call('/api/app/session?id=claude:none', key=key)  # (a session's page: none by that id)
        self.assertEqual((st, j['ok']), (404, False))
        st, _ = self.call('/api/app/session?id=claude:none')  # (and nothing without a key)
        self.assertEqual(st, 401)
        t = time.time()
        st, w = self.call(f'/api/app/state?after={v["rev"]}&wait=2', key=key)
        self.assertEqual((st, w['rev']), (200, v['rev']))
        self.assertGreaterEqual(time.time() - t, 1.5)
        st, j = self.call('/api/say', {'id': 'claude:none', 'text': 'hi'}, key=key)  # (an action goes through, and finds no session)
        self.assertEqual(st, 200)
        self.assertFalse(j['ok'])
        st, _ = self.call('/api/access', {}, key=key)  # (a phone manages no access)
        self.assertEqual(st, 403)

    def test_a_query_reaches_no_other_action_than_the_one_let_in(self):
        for path in ('/api/login?/say', '/api/login?x=/api/say', '/api/app/pair?/say', '/api/login#/say'):
            st, j = self.call(path, {'id': 'claude:none', 'text': 'hi'})
            self.assertEqual(st, 401, (path, j))
            self.assertNotIn('先写', j.get('msg', ''), path)
        st, j = self.call('/api/login?/access', {})
        self.assertEqual(st, 401)
        self.assertNotIn('sessions', j)

    def test_only_one_word_after_api(self):
        st, j = self.call('/api/app/pair', {'code': self.code(), 'device': 'x'})
        self.assertEqual(self.call('/api/x/say', {'id': 'x', 'text': 'hi'}, key=j['key'])[0], 404)

    def test_no_key_or_a_wrong_one_is_turned_away(self):
        self.assertEqual(self.call('/api/app/state')[0], 401)
        self.assertEqual(self.call('/api/app/state', key='wrong')[0], 401)
        self.assertEqual(self.call('/api/app/pair', {'code': 'ZZZZZZZZ', 'device': 'x'})[0], 401)

    def test_a_post_without_the_page_header_is_refused_even_with_a_key(self):
        st, j = self.call('/api/app/pair', {'code': self.code(), 'device': 'x'})
        self.assertEqual(self.call('/api/say', {'id': 'x', 'text': 'hi'}, key=j['key'], deck_header=False)[0], 403)


if __name__ == '__main__':
    unittest.main()
