"""Add-ons: what other programs add to Sturnus (addons.py).

    python3 -m unittest tests.test_addons

Everything runs in a temporary folder: its own settings, mailbox and add-ons folder, and one made-up add-on whose
program writes down every call it gets."""
import importlib.machinery
import importlib.util
import json
import os
import shutil
import stat
import tempfile
import threading
import time
import unittest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = tempfile.mkdtemp(prefix='sturnus-addons-')
ENV = dict(STURNUS_CONF=f'{TMP}/conf/config.json', STURNUS_CACHE=f'{TMP}/cache', AMAIL_HOME=f'{TMP}/mail', STURNUS_TASKS=f'{TMP}/tasks.db',
           AMAIL_CLAUDE_SESSIONS=f'{TMP}/none', AMAIL_NAME='addons-test', STURNUS_ADDONS=f'{TMP}/addons')
WAS = {k: os.environ.get(k) for k in ENV}
os.environ.update(ENV)


def load(name):
    loader = importlib.machinery.SourceFileLoader(name, os.path.join(HERE, name))
    module = importlib.util.module_from_spec(importlib.util.spec_from_loader(name, loader))
    loader.exec_module(module)
    return module


S = load('sturnus')
AD = S.AD
for k, v in WAS.items():  # (the other test files get the environment they set themselves; each test here sets this one again)
    if v is None:
        os.environ.pop(k, None)
    else:
        os.environ[k] = v

PROGRAM = r'''#!/usr/bin/env python3
"""A made-up add-on: it writes down every call, keeps what it is set to, and answers as addon.json promises."""
import json, os, sys
here = os.path.dirname(os.path.abspath(__file__))
keep, verb, arg = os.environ['ADDON_TEST_KEEP'], sys.argv[1], (sys.argv[2:] + [''])[0]
data = json.loads(sys.stdin.read() or '{}')
with open(os.path.join(keep, 'calls.jsonl'), 'a') as f:
    f.write(json.dumps({'verb': verb, 'arg': arg, 'data': data, 'lang': os.environ.get('STURNUS_LANG'), 'cwd': os.getcwd()}) + '\n')
f = os.path.join(keep, 'set.json')
have = json.load(open(f)) if os.path.exists(f) else {}
if verb == 'set':
    v = dict(have, **data['values'])
    if v.get('token') != 'good':
        print(json.dumps({'ok': False, 'note': 'the server did not take that token'}))
    else:
        json.dump(v, open(f, 'w'))
        print(json.dumps({'ok': True, 'note': {'zh': '已连上', 'en': 'Connected'}}))
elif verb == 'state':
    print(json.dumps({'ready': bool(have), 'status': {'zh': '已连上' if have else '还没连上', 'en': 'Connected' if have else 'Not connected'},
                      'rows': [{'name': {'zh': '设备', 'en': 'Device'}, 'value': 'mac <b>'}, 'not a row'],
                      'links': [{'name': 'Open', 'url': have.get('server', 'https://x.example')}, {'name': 'Bad', 'url': 'javascript:alert(1)'}],
                      'settings': {'server': have.get('server', ''), 'token': have.get('token', '')}}))
elif verb == 'task' and os.path.exists(os.path.join(keep, 'fail')):
    sys.exit('the disk is full')
elif verb == 'task' and arg == 'slow':
    import time
    time.sleep(float(open(os.path.join(keep, 'slow')).read()))
    with open(os.path.join(keep, 'calls.jsonl'), 'a') as f:
        f.write(json.dumps({'verb': 'done', 'arg': arg}) + '\n')
    print(json.dumps({'ok': True}))
elif verb == 'task' and arg == 'loud':
    sys.stdout.write('x' * (3 << 20))
elif verb == 'task' and arg == 'deep':
    sys.stdout.write('[' * 200000)
elif verb == 'task' and arg == 'child':
    import subprocess
    p = subprocess.Popen(['sleep', '300'])
    open(os.path.join(keep, 'child.pid'), 'w').write(str(p.pid))
    print(json.dumps({'ok': True, 'note': 'left one behind'}))
else:
    print(json.dumps({'ok': True, 'note': f'{verb} {arg} done'}))
'''
MANIFEST = {'id': 'sample', 'api': 1, 'version': '1.2', 'name': {'zh': '样例', 'en': 'Sample'}, 'about': 'A made-up add-on', 'run': 'run.py',
            'events': ['turn_end', 'session_end'], 'tasks': [{'id': 'scan', 'every': 600, 'name': {'zh': '扫描', 'en': 'Scan'}}],
            'settings': [{'id': 'server', 'kind': 'url', 'name': 'Server'}, {'id': 'token', 'kind': 'secret', 'name': 'Token'}]}


def tearDownModule():
    shutil.rmtree(TMP, ignore_errors=True)


def source(manifest=None, name='src', **change):
    """A folder to add an add-on from: the made-up program and an addon.json (MANIFEST with CHANGE)."""
    d = os.path.join(TMP, name)
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    with open(os.path.join(d, 'run.py'), 'w') as f:
        f.write(PROGRAM)
    os.chmod(os.path.join(d, 'run.py'), 0o755)
    with open(os.path.join(d, 'addon.json'), 'w') as f:
        json.dump(dict(manifest or MANIFEST, **change), f)
    return d


class Addons(unittest.TestCase):
    def setUp(self):
        self.was = {k: os.environ.get(k) for k in list(ENV) + ['ADDON_TEST_KEEP']}
        os.environ.update(ENV, ADDON_TEST_KEEP=f'{TMP}/keep')
        for d in ('addons', 'keep', 'conf', 'mail/addons'):
            shutil.rmtree(os.path.join(TMP, d), ignore_errors=True)
        os.makedirs(f'{TMP}/keep')
        self.said, self.told = [], []
        S._REQ.lang = 'zh'

    def tearDown(self):
        for k, v in self.was.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def addons(self):
        return AD.Addons(lambda text, ok=True: self.said.append((text, ok)), lambda: self.told.append(1), S.lang_now)

    def calls(self, verb=None):
        f = f'{TMP}/keep/calls.jsonl'
        rows = []
        if os.path.exists(f):
            with open(f) as h:
                rows = [json.loads(l) for l in h]
        return [r for r in rows if not verb or r['verb'] == verb]

    def step(self, a):
        """One look of the service's, waited for: what it started is done when this returns."""
        for th in a.step():
            th.join(30)

    def connected(self, **change):
        """The sample add-on added, given a server and a token it takes, and switched on."""
        self.assertIsNone(AD.add(source(**change))[1])
        a = self.addons()
        self.assertTrue(a.act({'addon': 'sample', 'values': {'server': 'https://archive.example', 'token': 'good'}})[0])
        self.assertTrue(a.act({'addon': 'sample', 'on': True})[0])
        return a, a.items['sample']

    def test_it_is_carried(self):
        self.assertIn('addons.py', S.FILES)
        self.assertEqual(self.addons().view(), [])
        self.assertEqual(AD.HOME, ENV['STURNUS_ADDONS'])

    def test_addon_json_is_checked(self):
        for change, why in (({'id': 'Bad Id'}, 'id'), ({'id': 'x'}, 'id'), ({'api': 2}, 'arrangement'), ({'api': True}, 'arrangement'), ({'run': '/bin/sh'}, 'inside'),
                            ({'run': '../run.py'}, 'inside'), ({'run': 'gone.py'}, 'not there'), ({'events': ['turn_end', 'reboot']}, 'event'),
                            ({'tasks': [{'id': 'scan', 'every': 5}]}, 'every'), ({'tasks': [{'id': 'scan', 'every': 600}] * 2}, 'once'),
                            ({'settings': [{'id': 'k', 'kind': 'html'}]}, 'kind')):
            m, said = AD.read(source(**change))
            self.assertIsNone(m, change)
            self.assertIn(why, said, change)
        d = source()
        os.chmod(os.path.join(d, 'run.py'), 0o644)
        self.assertIn('may not be run', AD.read(d)[1])
        m, said = AD.read(source())
        self.assertIsNone(said)
        self.assertEqual((m['id'], m['name'], m['about']['zh'], m['tasks'][0]['every']), ('sample', {'zh': '样例', 'en': 'Sample'}, 'A made-up add-on', 600))

    def test_added_replaced_and_taken_out(self):
        self.assertIsNotNone(AD.add(f'{TMP}/no-such-folder')[1])
        m, why = AD.add(source())
        self.assertIsNone(why)
        dest = os.path.join(ENV['STURNUS_ADDONS'], 'sample')
        self.assertEqual(stat.S_IMODE(os.stat(dest).st_mode), 0o700)
        self.assertEqual(S.config()['addons'], {'sample': {'on': False, 'events': ['turn_end', 'session_end']}})
        AD.keep('sample', on=True)
        m, why = AD.add(source(version='1.3', events=['turn_end']))  # (a newer one over it: it stays on, and wants what the new one asks for)
        self.assertEqual((why, m['version']), (None, '1.3'))
        self.assertEqual(S.config()['addons'], {'sample': {'on': True, 'events': ['turn_end']}})
        self.assertEqual(self.addons().view()[0]['version'], '1.3')
        big = source(name='big')
        for i in range(301):
            open(os.path.join(big, f'f{i}'), 'w').close()
        self.assertIn('small folder', AD.add(big)[1])
        self.assertTrue(AD.remove('../sample'))  # (said why not)
        self.assertEqual(AD.remove('sample'), '')
        self.assertFalse(os.path.exists(dest))
        self.assertEqual(S.config()['addons'], {})

    def test_one_that_cannot_be_read_is_shown_not_run(self):
        AD.add(source())
        with open(os.path.join(ENV['STURNUS_ADDONS'], 'sample', 'addon.json'), 'w') as f:
            f.write('{')
        a = self.addons()
        view = a.view()
        self.assertEqual((view[0]['id'], 'cannot be read' in view[0]['error']), ('sample', True))
        self.assertFalse(a.act({'addon': 'sample', 'on': True})[0])
        AD.keep('sample', on=True)
        a.scan()
        self.assertFalse(a.on('sample'))

    def test_settings_go_to_the_addon_and_the_switch_waits_for_them(self):
        AD.add(source())
        a = self.addons()
        ok, msg = a.act({'addon': 'sample', 'on': True})  # (it says it is not ready: the switch stays off)
        self.assertEqual((ok, msg), (False, '还没连上'))
        self.assertFalse(a.act({'addon': 'nobody', 'on': True})[0])
        self.assertFalse(a.act({'addon': 'sample', 'values': {'server': 'file:///etc/passwd', 'token': 'good'}})[0])  # (not an address)
        self.assertEqual(self.calls('set'), [])
        ok, msg = a.act({'addon': 'sample', 'values': {'server': 'https://archive.example', 'token': 'wrong', 'other': 'x', 'n': 5}})
        self.assertEqual((ok, msg), (False, 'the server did not take that token'))
        self.assertEqual(self.calls('set')[-1]['data'], {'values': {'server': 'https://archive.example', 'token': 'wrong'}})  # (only what addon.json names)
        S._REQ.lang = 'en'
        ok, msg = a.act({'addon': 'sample', 'values': {'server': ' https://archive.example ', 'token': 'good'}})
        self.assertTrue(ok, msg)
        self.assertEqual((self.calls('set')[-1]['lang'], os.path.realpath(self.calls('set')[-1]['cwd'])), ('en', os.path.realpath(a.items['sample']['dir'])))
        a.act({'addon': 'sample', 'values': {'server': 'https://two.example', 'token': ''}})  # (a secret left empty: the one it has stays)
        self.assertEqual(self.calls('set')[-1]['data'], {'values': {'server': 'https://two.example'}})
        v = a.view()[0]
        self.assertEqual((v['ready'], v['status']['en'], v['on']), (True, 'Connected', False))
        self.assertEqual([(f['id'], f['value']) for f in v['settings']], [('server', 'https://two.example'), ('token', True)])  # (the secret never comes back)
        self.assertEqual(v['rows'], [{'name': {'zh': '设备', 'en': 'Device'}, 'value': {'zh': 'mac <b>', 'en': 'mac <b>'}}])
        self.assertEqual([l['url'] for l in v['links']], ['https://two.example'])  # (only http and https links are shown)
        ok, msg = a.act({'addon': 'sample', 'on': True})
        self.assertEqual((ok, msg), (True, 'Sample: on'))
        self.assertTrue(a.view()[0]['on'] and a.view()[0]['tasks'][0]['next'])
        self.assertTrue(a.act({'addon': 'sample', 'on': False})[0])
        self.assertEqual((a.view()[0]['on'], a.view()[0]['tasks'][0]['next']), (False, None))

    def test_the_hook_leaves_events_only_for_those_that_want_them(self):
        AD.add(source())
        left = lambda: sorted(os.listdir(f'{TMP}/mail/addons/sample')) if os.path.isdir(f'{TMP}/mail/addons/sample') else []
        p = {'session_id': 's1', 'cwd': '/p', 'transcript_path': '/x/s1.jsonl'}
        S.A.addons('claude', 'stop', p)  # (it is off)
        self.assertEqual(left(), [])
        AD.keep('sample', on=True)
        for ev in ('stop', 'end', 'start', 'prompt', 'pre', None):  # (it asked for a turn's end and a session's end)
            S.A.addons('claude', ev, p)
        self.assertEqual(len(left()), 2)
        e = S.A.get(os.path.join(f'{TMP}/mail/addons/sample', left()[0]))
        self.assertEqual({k: e[k] for k in ('event', 'agent', 'session', 'cwd', 'transcript')},
                         {'event': 'turn_end', 'agent': 'claude', 'session': 's1', 'cwd': '/p', 'transcript': '/x/s1.jsonl'})
        S.save_config({'addons': {'../x': {'on': True, 'events': ['turn_end']}, 'sample': 'on'}})  # (settings someone broke: nothing is written anywhere else)
        S.A.addons('claude', 'stop', p)
        self.assertEqual((len(left()), os.path.exists(f'{TMP}/mail/x')), (2, False))

    def test_events_reach_the_program_once(self):
        a, it = self.connected()
        p = {'session_id': 's1', 'cwd': '/p', 'transcript_path': '/x/s1.jsonl'}
        S.A.addons('claude', 'stop', p)
        S.A.addons('codex', 'stop', dict(p, session_id='s2', transcript_path='/x/s2.jsonl'))
        self.step(a)
        got = self.calls('events')
        self.assertEqual(len(got), 1)  # (both in one call)
        self.assertEqual([(e['event'], e['agent'], e['transcript']) for e in got[0]['data']['events']],
                         [('turn_end', 'claude', '/x/s1.jsonl'), ('turn_end', 'codex', '/x/s2.jsonl')])
        self.step(a)
        self.assertEqual(len(self.calls('events')), 1)
        S.A.addons('claude', 'stop', p)
        a.act({'addon': 'sample', 'on': False})
        self.step(a)  # (off since: what was left is dropped, not kept for later)
        self.assertEqual((len(self.calls('events')), os.listdir(f'{TMP}/mail/addons/sample')), (1, []))
        os.makedirs(f'{TMP}/mail/addons/gone')
        S.A.put(f'{TMP}/mail/addons/gone/1.json', {'event': 'turn_end'})
        self.step(a)
        self.assertEqual(os.listdir(f'{TMP}/mail/addons/gone'), [])
        a.act({'addon': 'sample', 'on': True})
        with open(f'{TMP}/mail/addons/sample/1.json', 'w') as f:
            f.write('[' * 200000)  # (a file that is no event: removed, and the rest goes on)
        S.A.addons('claude', 'end', p)
        self.step(a)
        self.assertEqual([e['event'] for e in self.calls('events')[-1]['data']['events']], ['session_end'])
        self.assertEqual(os.listdir(f'{TMP}/mail/addons/sample'), [])

    def test_tasks_run_by_the_clock_and_when_asked(self):
        a, it = self.connected()
        self.step(a)
        self.assertEqual(self.calls('task'), [])  # (not yet its time)
        it['tasks']['scan']['next'] = time.time() - 1
        self.step(a)
        self.assertEqual([c['arg'] for c in self.calls('task')], ['scan'])
        v = a.view()[0]['tasks'][0]
        self.assertEqual((v['last']['ok'], v['last']['note']['zh'], v['busy']), (True, 'task scan done', False))
        self.assertTrue(600 - 5 < v['next'] - time.time() <= 600)
        ok, msg = a.act({'addon': 'sample', 'task': 'scan'})  # (the person asks for it now)
        self.assertTrue(ok)
        for _ in range(100):
            if len(self.calls('task')) == 2 and not it['busy']:
                break
            time.sleep(0.05)
        self.assertEqual(len(self.calls('task')), 2)
        self.assertFalse(a.act({'addon': 'sample', 'task': 'nothing'})[0])
        self.assertEqual(self.said, [])
        self.assertTrue(self.told)
        a.act({'addon': 'sample', 'on': False})
        ok, msg = a.act({'addon': 'sample', 'task': 'scan'})  # (off: nothing of it is run but state and set)
        self.assertEqual((ok, len(self.calls('task'))), (False, 2))
        it['tasks']['scan']['next'] = time.time() - 1
        self.step(a)
        self.assertEqual(len(self.calls('task')), 2)

    def test_what_went_wrong_is_said_once(self):
        a, it = self.connected()
        open(f'{TMP}/keep/fail', 'w').close()
        for _ in range(2):
            a.run_task(it, it['m']['tasks'][0])
        self.assertEqual(self.said, [('插件「样例」：the disk is full', False)])
        self.assertEqual(a.view()[0]['tasks'][0]['last']['ok'], False)
        os.remove(f'{TMP}/keep/fail')
        a.run_task(it, it['m']['tasks'][0])
        open(f'{TMP}/keep/fail', 'w').close()
        a.run_task(it, it['m']['tasks'][0])  # (it worked in between: said again)
        self.assertEqual(len(self.said), 2)

    def test_one_added_while_the_service_runs_is_seen(self):
        a = self.addons()
        self.assertEqual(a.view(), [])
        AD.add(source())
        self.step(a)
        self.assertEqual([(v['id'], v['looked'], v['status']['zh']) for v in a.view()], [('sample', True, '还没连上')])
        AD.remove('sample')
        self.step(a)
        self.assertEqual(a.view(), [])
        AD.keep('sample', on=True, events=['turn_end'])  # (what the settings still hold of one that is gone goes after a minute)
        a.scan()
        self.assertIn('sample', S.config()['addons'])
        a.gone['sample'] -= 61
        a.scan()
        self.assertEqual(S.config()['addons'], {})

    def test_links_are_not_followed(self):
        big = os.path.join(TMP, 'elsewhere')
        os.makedirs(big, exist_ok=True)
        for i in range(5):
            open(os.path.join(big, f'f{i}'), 'w').close()
        for make in (lambda d: os.symlink(big, os.path.join(d, 'lib')), lambda d: os.symlink('.', os.path.join(d, 'loop')),
                     lambda d: os.symlink('/etc/hosts', os.path.join(d, 'hosts'))):
            d = source()
            make(d)
            m, why = AD.add(d)
            self.assertIsNone(m)
            self.assertIn('is a link', why)
        d = source()
        os.rename(os.path.join(d, 'run.py'), os.path.join(big, 'run.py'))
        os.symlink(os.path.join(big, 'run.py'), os.path.join(d, 'run.py'))  # (its program is elsewhere)
        self.assertIn('not a link', AD.read(d)[1])
        self.assertEqual(os.listdir(ENV['STURNUS_ADDONS']) if os.path.isdir(ENV['STURNUS_ADDONS']) else [], [])

    def test_a_slow_one_holds_up_no_other(self):
        tasks = [{'id': 'scan', 'every': 600}, {'id': 'slow', 'every': 600}]
        a, it = self.connected(tasks=tasks)
        other = dict(MANIFEST, id='other')
        AD.add(source(other, 'src2'))
        a.act({'addon': 'other', 'values': {'server': 'https://archive.example', 'token': 'good'}})
        self.assertTrue(a.act({'addon': 'other', 'on': True})[0])
        with open(f'{TMP}/keep/slow', 'w') as f:
            f.write('1.5')
        it['tasks']['slow']['next'] = a.items['other']['tasks']['scan']['next'] = time.time() - 1
        began = time.time()
        threads = a.step()
        self.assertLess(time.time() - began, 1.0)  # (the look itself waits for nothing)
        self.assertEqual(len(threads), 2)
        threads[0].join(10)  # (add-ons go by name: "other" first)
        self.assertEqual([c['arg'] for c in self.calls('task') if c['arg'] == 'scan'], ['scan'])  # (the other one's task is done meanwhile)
        self.assertEqual(self.calls('done'), [])
        self.assertEqual(it['busy'], 'task slow')
        ok, msg = a.act({'addon': 'sample', 'values': {'server': 'https://three.example'}})  # (it is at work: said at once, not waited for)
        self.assertEqual((ok, len(self.calls('set'))), (False, 2))
        self.assertTrue(a.act({'addon': 'sample', 'task': 'scan'})[0])  # (asked twice while it is at work: not run twice)
        self.assertEqual(a.step(), [])
        m, why = AD.add(source(version='9', tasks=tasks))  # (put in again while it is at work: that waits for the work to end)
        self.assertIsNone(why)
        self.assertEqual(len(self.calls('done')), 1)
        threads[1].join(10)
        a.scan()
        self.assertIs(a.items['sample'], it)  # (it is the same add-on: when its tasks last ran is kept)
        self.assertEqual((it['busy'], it['m']['version'], it['tasks']['slow']['last']['ok']), ('', '9', True))
        self.assertEqual(len([c for c in self.calls('task') if c['arg'] == 'slow']), 1)

    def test_it_waits_for_work_to_end_before_the_folder_changes(self):
        a, it = self.connected()
        got = []
        with AD.held('sample'):  # (its program is at work, here or in the service)
            th = threading.Thread(target=lambda: got.append(AD.add(source(version='2'))))
            th.start()
            time.sleep(0.6)
            self.assertEqual(got, [])
        th.join(10)
        self.assertEqual(got[0][0]['version'], '2')

    def test_a_program_that_misbehaves_is_only_a_failure(self):
        tasks = [{'id': t, 'every': 600} for t in ('slow', 'loud', 'deep', 'child')]
        a, it = self.connected(tasks=tasks)
        by = {t['id']: t for t in it['m']['tasks']}
        for t, why in (('loud', 'JSON'), ('deep', 'JSON')):  # (3 MB of output; brackets 200,000 deep)
            self.assertTrue(a.run_task(it, by[t]))
            self.assertEqual(it['tasks'][t]['last']['ok'], False)
            self.assertIn(why, it['tasks'][t]['last']['note']['en'])
        self.assertTrue(a.run_task(it, by['child']))  # (what it left running is stopped with it)
        self.assertTrue(it['tasks']['child']['last']['ok'])
        with open(f'{TMP}/keep/child.pid') as f:
            pid = int(f.read())
        for _ in range(40):
            try:
                os.kill(pid, 0)
            except OSError:
                break
            time.sleep(0.05)
        else:
            self.fail('the program it started is still running')
        with open(f'{TMP}/keep/slow', 'w') as f:
            f.write('30')
        was, AD.TIMES['task'] = AD.TIMES['task'], 1
        try:
            began = time.time()
            self.assertTrue(a.run_task(it, by['slow']))
        finally:
            AD.TIMES['task'] = was
        self.assertLess(time.time() - began, 8)
        self.assertEqual((it['tasks']['slow']['last']['ok'], 'stopped' in it['tasks']['slow']['last']['note']['en']), (False, True))

    def test_the_command_line(self):
        out = []
        self.assertEqual(AD.command([], out.append), 0)
        self.assertIn('no add-ons', out[-1])
        self.assertEqual(AD.command(['add', source(run='gone.py')], out.append), 1)
        self.assertIn('not added', out[-1])
        self.assertEqual(AD.command(['add', source()], out.append), 0)
        self.assertEqual(AD.command(['on', 'sample'], out.append, S.lang_now), 1)  # (not ready)
        self.addons().act({'addon': 'sample', 'values': {'server': 'https://archive.example', 'token': 'good'}})
        self.assertEqual(AD.command(['on', 'sample'], out.append, S.lang_now), 0)
        AD.command([], out.append)
        self.assertRegex(out[-1], r'^sample +on +1\.2 +Sample$')
        self.assertEqual(AD.command(['remove', 'sample'], out.append), 0)
        self.assertEqual(AD.command(['remove', 'sample'], out.append), 1)
        self.assertIn('no add-on', out[-1])
        self.assertEqual(AD.command(['what'], out.append), 1)

    def test_the_deck_tells_the_page(self):
        AD.add(source())

        class Deck(S.Deck):
            def __init__(self):
                self.lock, self.changed, self.state, self.cfg, self.said = threading.Lock(), threading.Condition(), {}, {}, []
                self.addons = AD.Addons(self.note, self.addons_tell, S.lang_now)

            def note(self, text, ok=True):
                self.said.append((text, ok))

        d = Deck()
        ok, msg = d.act('addon', {'addon': 'sample', 'values': {'server': 'https://archive.example', 'token': 'good'}})
        self.assertTrue(ok, msg)
        self.assertEqual([(v['id'], v['ready']) for v in d.state['addons']], [('sample', True)])


if __name__ == '__main__':
    unittest.main()
