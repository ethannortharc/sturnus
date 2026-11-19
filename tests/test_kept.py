"""The sessions that last and their workspaces (kept.py): what the deck's rows are bound to, pass after pass.

    python3 -m unittest discover -s tests

Everything runs on a temporary file; no deck, no terminal."""
import importlib.machinery
import importlib.util
import os
import tempfile
import unittest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = os.path.realpath(tempfile.mkdtemp(prefix='sturnus-kept-'))


def load(name):
    loader = importlib.machinery.SourceFileLoader(name.split('.')[0], os.path.join(HERE, name))
    module = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
    loader.exec_module(module)
    return module


K = load('kept.py')
N = [0]


def book():
    N[0] += 1
    return K.Book(os.path.join(TMP, f'b{N[0]}.db'))


def row(**kw):
    """A row as the deck collects it: a Claude session idle in pane 3 of group work."""
    s = {'id': 'claude:c1', 'kind': 'claude', 'session': 'c1', 'name': 'work-1', 'state': 'idle', 'at': 100, 'since': 90, 'born': 80,
         'home': '/r/sturnus', 'cwd': '/r/sturnus', 'loc': {'mux': 'zellij', 'session': 'work', 'pane': '3'}, 'pid': 500, 'pid_at': 70,
         'transcript': '/t/c1.jsonl', 'title': '', 'summary': ''}
    s.update(kw)
    return s


class Workspaces(unittest.TestCase):
    def test_a_workspace_has_a_name_and_folders_and_the_first_is_its_default(self):
        b = book()
        w = b.space_add('Sturnus', ['/r/sturnus', '/r/sturnus-ios'])
        sp = b.spaces()[0]
        self.assertEqual((sp['id'], sp['name'], [(p['path'], p['main']) for p in sp['places']]), (w, 'Sturnus', [('/r/sturnus', True), ('/r/sturnus-ios', False)]))
        b.place_main(w, '/r/sturnus-ios')
        self.assertEqual([p['path'] for p in b.spaces()[0]['places'] if p['main']], ['/r/sturnus-ios'])

    def test_a_folder_is_in_one_workspace_only(self):
        b = book()
        b.space_add('A', ['/r/a'])
        with self.assertRaises(ValueError):
            b.space_add('B', ['/r/a'])
        w = b.space_add('B', ['/r/b'])
        with self.assertRaises(ValueError):
            b.place_add(w, '/r/a')
        with self.assertRaises(ValueError):
            b.space_add('', ['/r/c'])

    def test_the_nearest_folder_above_decides(self):
        b = book()
        wide, near = b.space_add('software', ['/r']), b.space_add('Sturnus', ['/r/sturnus'])
        sp = b.spaces()
        self.assertEqual(K.nearest(sp, '/r/sturnus/web'), near)
        self.assertEqual(K.nearest(sp, '/r/sturnus'), near)
        self.assertEqual(K.nearest(sp, '/r/sturnus-ios'), wide)  # (a name that only starts the same is another folder)
        self.assertIsNone(K.nearest(sp, '/elsewhere'))

    def test_the_default_folder_gone_the_oldest_left_is_it(self):
        b = book()
        w = b.space_add('S', ['/r/a', '/r/b'])
        b.place_drop(w, '/r/a')
        self.assertEqual([(p['path'], p['main']) for p in b.spaces()[0]['places']], [('/r/b', True)])


class Binding(unittest.TestCase):
    def test_a_row_first_seen_becomes_a_session_with_its_conversation_and_terminal(self):
        b = book()
        w = b.space_add('Sturnus', ['/r/sturnus'])
        got = b.bind([row(title='Make sessions last')], now=200)
        k = b.get(got['claude:c1'])
        self.assertEqual((k['space'], k['folder'], k['kind'], k['name'], k['state'], k['title']), (w, '/r/sturnus', 'claude', 'work-1', 'idle', 'Make sessions last'))
        self.assertEqual([(s['kind'], s['conv'], s['how'], s['ended']) for s in k['segs']], [('claude', 'c1', 'found', None)])
        self.assertEqual([(t['mux'], t['grp'], t['pane'], t['pid'], t['ended']) for t in k['terms']], [('zellij', 'work', '3', 500, None)])
        self.assertEqual(b.bind([row()], now=202), got)  # (the next pass: the same session, nothing new)
        k = b.get(got['claude:c1'])
        self.assertEqual((len(k['segs']), len(k['terms'])), (1, 1))

    def test_out_of_sight_for_a_moment_is_not_an_end_but_for_long_is(self):
        b = book()
        kid = b.bind([row()], now=200)['claude:c1']
        b.bind([], now=205)
        self.assertIsNone(b.get(kid)['terms'][0]['ended'])
        self.assertEqual(b.get(kid)['state'], 'idle')
        b.bind([row()], now=210)  # (back: the count starts again)
        b.bind([], now=215)
        b.bind([], now=230)
        self.assertIsNone(b.get(kid)['terms'][0]['ended'])
        b.bind([], now=240, there=lambda t: False)
        k = b.get(kid)
        self.assertEqual((k['terms'][0]['ended'], k['terms'][0]['why'], k['state']), (215, 'closed', 'stopped'))

    def test_why_a_terminal_ended(self):
        for there, boot, why in ((lambda t: True, 0, 'exited'), (lambda t: False, 0, 'closed'), (None, 0, 'ended'), (lambda t: True, 250, 'restart')):
            b = book()
            kid = b.bind([row()], now=200)['claude:c1']
            b.bind([], now=300, boot=boot, there=there)
            b.bind([], now=330, boot=boot, there=there)
            self.assertEqual(b.get(kid)['terms'][0]['why'], why)

    def test_a_restart_ends_it_at_its_last_stir_at_once(self):
        b = book()
        kid = b.bind([row(at=180)], now=200)['claude:c1']
        b.bind([], now=900, boot=600)
        t = b.get(kid)['terms'][0]
        self.assertEqual((t['began'], t['ended'], t['why']), (70, 180, 'restart'))  # (begun with its process, over at its last stir)

    def test_resumed_in_another_terminal_is_the_same_session_with_a_second_terminal(self):
        b = book()
        kid = b.bind([row()], now=200)['claude:c1']
        b.bind([], now=300, there=lambda t: False)
        b.bind([], now=330, there=lambda t: False)
        again = row(loc={'mux': 'tmux', 'session': 'tmux:st', 'pane': '%4', 'sock': '/s'}, pid=900, pid_at=400)
        self.assertEqual(b.bind([again], now=500)['claude:c1'], kid)
        k = b.get(kid)
        self.assertEqual([(t['mux'], t['pane'], t['why']) for t in k['terms']], [('zellij', '3', 'closed'), ('tmux', '%4', '')])
        self.assertEqual((len(k['segs']), k['state']), (1, 'idle'))

    def test_a_cleared_conversation_in_the_same_process_stays_the_session(self):
        b = book()
        kid = b.bind([row()], now=200)['claude:c1']
        got = b.bind([row(id='claude:c2', session='c2', transcript='/t/c2.jsonl')], now=260)
        self.assertEqual(got, {'claude:c2': kid})
        k = b.get(kid)
        self.assertEqual([(s['conv'], s['how'], s['ended']) for s in k['segs']], [('c1', 'found', 260), ('c2', 'clear', None)])
        self.assertEqual(len(k['terms']), 1)

    def test_another_process_with_another_conversation_is_another_session(self):
        b = book()
        a = b.bind([row()], now=200)['claude:c1']
        got = b.bind([row(), row(id='claude:c2', session='c2', pid=501, name='work-2', loc={'mux': 'zellij', 'session': 'work', 'pane': '4'})], now=210)
        self.assertNotEqual(got['claude:c2'], a)
        self.assertEqual(len(b.all()), 2)

    def test_started_for_a_session_it_is_that_session(self):
        b = book()
        kid = b.add(title='Write the notes', folder='/r/sturnus', kind='codex')
        self.assertEqual((b.get(kid)['titled'], b.get(kid)['state']), (1, 'stopped'))
        b.start('m1', kid)
        window = row(id='codex-window:77', kind='codex', session=None, pid=None, window_pid=77, want=kid, mark='m1', transcript=None)
        self.assertEqual(b.bind([window], now=200), {'codex-window:77': kid})  # (no conversation yet: known by what it was started for)
        got = b.bind([row(id='codex:t1', kind='codex', session='t1', pid=None, window_pid=77, want=kid, mark='m1', title='Something else')], now=230)
        k = b.get(kid)
        self.assertEqual((got, [(s['conv'], s['how']) for s in k['segs']], len(k['terms']), k['title']), ({'codex:t1': kid}, [('t1', 'new')], 1, 'Write the notes'))

    def test_another_agent_taking_a_session_on_is_a_handover(self):
        b = book()
        kid = b.bind([row()], now=200)['claude:c1']
        b.bind([], now=300)
        b.bind([], now=330)
        b.start('m2', kid)
        got = b.bind([row(id='codex:t9', kind='codex', session='t9', pid=None, window_pid=88, want=kid, mark='m2')], now=400)
        k = b.get(kid)
        self.assertEqual((got['codex:t9'], k['kind'], [(s['kind'], s['how']) for s in k['segs']]), (kid, 'codex', [('claude', 'found'), ('codex', 'handover')]))

    def test_the_conversation_decides_over_what_it_was_started_for(self):
        b = book()
        a = b.bind([row()], now=200)['claude:c1']
        other = b.add(title='Other', folder='/r/x', kind='claude')
        b.start('m3', other)
        self.assertEqual(b.bind([row(want=other, mark='m3')], now=210)['claude:c1'], a)

    def test_what_a_session_s_process_starts_is_not_that_session(self):
        b = book()
        kid = b.add(title='Mine', folder='/r/sturnus', kind='claude')
        b.start('m1', kid)
        mine = row(pid=500, want=kid, mark='m1')
        self.assertEqual(b.bind([mine], now=200), {'claude:c1': kid})
        # (an agent started by hand in a terminal that inherited both words: a session of its own)
        other = row(id='claude:c9', session='c9', pid=777, pid_at=150, name='by-hand', want=kid, mark='m1', loc={'mux': 'tmux', 'session': 'tmux:x', 'pane': '%9'})
        got = b.bind([mine, other], now=210)
        self.assertNotEqual(got['claude:c9'], kid)
        b.bind([other], now=300)
        b.bind([other], now=330)  # (and with the first one gone, still its own)
        self.assertEqual(([s['conv'] for s in b.get(kid)['segs']], [s['conv'] for s in b.get(got['claude:c9'])['segs']]), (['c1'], ['c9']))
        self.assertIsNone(b.bind([row(id='claude:w', session=None, pid=901, want=kid, mark='never-issued')], now=340).get('claude:w'))

    def test_a_cleared_conversation_stays_with_the_session_its_terminal_shows(self):
        b = book()
        k1 = b.add(title='One', folder='/r/sturnus', kind='claude')
        b.start('m1', k1)
        b.bind([row(want=k1, mark='m1')], now=200)
        k2 = b.bind([row(id='claude:c2', session='c2', pid=600, name='two', loc={'mux': 'zellij', 'session': 'work', 'pane': '5'})], now=210)['claude:c2']
        b.bind([], now=300)
        b.bind([], now=330)
        # (the first one's process now shows the second one's conversation — /resume in its terminal — and is then cleared)
        self.assertEqual(b.bind([row(id='claude:c2', session='c2', want=k1, mark='m1')], now=400)['claude:c2'], k2)
        self.assertEqual(b.bind([row(id='claude:c3', session='c3', want=k1, mark='m1')], now=410)['claude:c3'], k2)

    def test_a_place_not_found_for_a_pass_is_no_other_terminal(self):
        b = book()
        kid = b.bind([row()], now=200)['claude:c1']
        for i, loc in enumerate((None, {'mux': 'zellij', 'session': 'work', 'pane': '3'}, None, {'mux': 'zellij', 'session': 'work', 'pane': '3'})):
            b.bind([row(loc=loc)], now=210 + i)
        self.assertEqual(len(b.get(kid)['terms']), 1)
        late = b.bind([row(id='claude:c7', session='c7', pid=700, loc=None, origin='x')], now=300)['claude:c7']
        b.bind([row(id='claude:c7', session='c7', pid=700, loc={'mux': 'tmux', 'session': 'tmux:g', 'pane': '%2', 'sock': '/s'})], now=302)
        self.assertEqual([(t['mux'], t['pane'], t['ended']) for t in b.get(late)['terms']], [('tmux', '%2', None)])  # (found a pass later: the same terminal)

    def test_runs_others_started_and_ended_ones_are_no_sessions(self):
        b = book()
        rows = [row(id='claude:k', session='k', parent='work-1'), row(id='codex:x', kind='codex', session='x', **{'from': {'mux': 'zellij'}}),
                row(id='claude:g', session='g', state='gone'), row(id='new:1', session=None, starting=True), row(id='shell:1', kind='shell', session='s')]
        self.assertEqual(b.bind(rows, now=200), {})
        self.assertEqual(b.all(), [])

    def test_two_rows_of_one_conversation_are_one_session(self):
        b = book()
        got = b.bind([row(), row(id='claude-window:500', unknown=True)], now=200)
        self.assertEqual(len(set(got.values())), 1)
        self.assertEqual(len(b.all()), 1)

    def test_moving_to_another_pane_closes_the_old_terminal(self):
        b = book()
        kid = b.bind([row()], now=200)['claude:c1']
        b.bind([row(loc={'mux': 'zellij', 'session': 'other', 'pane': '9'})], now=250)
        self.assertEqual([(t['grp'], t['why'], t['ended']) for t in b.get(kid)['terms']], [('work', 'moved', 250), ('other', '', None)])

    def test_in_no_pane_it_notes_how_it_was_started(self):
        b = book()
        kid = b.bind([row(loc=None, origin='终端窗口（Ghostty）')], now=200)['claude:c1']
        t = b.get(kid)['terms'][0]
        self.assertEqual((t['mux'], t['origin']), ('', '终端窗口（Ghostty）'))


class Clock(unittest.TestCase):
    def at(self, *ymdhm):
        import time
        return time.mktime((*ymdhm, 0, 0, 0, -1))

    def test_the_next_time_of_each_kind(self):
        mon, fri = self.at(2026, 11, 16, 8, 0), self.at(2026, 11, 20, 10, 0)  # (a Monday morning, a Friday after ten)
        self.assertEqual(K.next_at('daily 09:30', mon), self.at(2026, 11, 16, 9, 30))
        self.assertEqual(K.next_at('daily 07:00', mon), self.at(2026, 11, 17, 7, 0))
        self.assertEqual(K.next_at('weekdays 09:30', fri), self.at(2026, 11, 23, 9, 30))  # (over the weekend)
        self.assertEqual(K.next_at('daily 09:30', fri), self.at(2026, 11, 21, 9, 30))
        self.assertEqual(K.next_at('hours 6', mon), mon + 6 * 3600)
        for bad in ('', 'daily 25:00', 'hours 0', 'weekly 09:00', 'daily 9', None):
            self.assertIsNone(K.next_at(bad, mon), bad)

    def test_something_set_by_the_clock_is_kept_run_noted_and_switched(self):
        b = book()
        now = self.at(2026, 11, 16, 8, 0)
        with self.assertRaises(ValueError):
            b.plan_add('', 'do it', 'claude', '/r', 'daily 09:00')
        with self.assertRaises(ValueError):
            b.plan_add('Morning check', 'do it', 'claude', '/r', 'sometimes')
        pid = b.plan_add('Morning check', 'look at the build', 'codex', '/r/x', 'daily 09:00', now=now)
        p = b.plans()[0]
        self.assertEqual((p['title'], p['kind'], p['folder'], p['live'], p['next'], p['runs']), ('Morning check', 'codex', '/r/x', 1, self.at(2026, 11, 16, 9, 0), []))
        b.plan_ran(pid, 's-1', now=self.at(2026, 11, 16, 9, 0))
        b.plan_ran(pid, 's-2', now=self.at(2026, 11, 16, 12, 0), due=False)  # (run by hand in between: its next time stays)
        p = b.plans()[0]
        self.assertEqual((p['next'], [r['kept'] for r in p['runs']]), (self.at(2026, 11, 17, 9, 0), ['s-2', 's-1']))
        self.assertEqual(b.plan_kept(self.at(2026, 11, 16, 10, 0)), {'s-2'})
        b.plan_set(pid, live=False)
        self.assertEqual((b.plans()[0]['live'], b.plans()[0]['next']), (0, None))
        b.plan_set(pid, live=True, now=self.at(2026, 11, 18, 10, 0))
        self.assertEqual(b.plans()[0]['next'], self.at(2026, 11, 19, 9, 0))
        b.plan_drop(pid)
        self.assertEqual((b.plans(), b.plan_kept(0)), ([], set()))


class Keeping(unittest.TestCase):
    def test_a_title_the_person_gave_stays_and_one_taken_back_follows_again(self):
        b = book()
        kid = b.bind([row(title='From the summary')], now=200)['claude:c1']
        b.set(kid, title='Mine')
        b.bind([row(title='Summary again')], now=210)
        self.assertEqual(b.get(kid)['title'], 'Mine')
        b.set(kid, title='')
        b.bind([row(title='Summary again')], now=220)
        self.assertEqual(b.get(kid)['title'], 'Summary again')

    def test_its_workspace_follows_the_folders_unless_the_person_placed_it(self):
        b = book()
        kid = b.bind([row()], now=200)['claude:c1']
        self.assertIsNone(b.get(kid)['space'])
        w = b.space_add('Sturnus', ['/r/sturnus'])
        b.bind([], now=201)
        self.assertEqual(b.get(kid)['space'], w)
        other = b.space_add('Other', ['/r/other'])
        b.set(kid, space=other)
        b.bind([row()], now=202)
        self.assertEqual(b.get(kid)['space'], other)
        b.set(kid, space='')
        self.assertEqual(b.get(kid)['space'], w)
        b.place_drop(w, '/r/sturnus')
        b.bind([], now=203)
        self.assertIsNone(b.get(kid)['space'])

    def test_archived_only_by_the_person_and_deleted_only_once_archived(self):
        b = book()
        kid = b.bind([row()], now=200)['claude:c1']
        with self.assertRaises(ValueError):
            b.drop(kid)
        b.set(kid, pinned=True)
        b.set(kid, archived=True)
        k = b.get(kid)
        self.assertTrue(k['archived'] and not k['pinned'])
        b.bind([row()], now=k['archived'] + 5)  # (still stopping: it stays archived)
        self.assertTrue(b.get(kid)['archived'])
        b.bind([row()], now=k['archived'] + 100)  # (running again later: back among the open ones)
        self.assertIsNone(b.get(kid)['archived'])
        b.set(kid, archived=True)
        b.drop(kid)
        self.assertIsNone(b.get(kid))

    def test_a_terminal_with_no_process_closed_is_not_reopened_by_the_same_row_until_it_is_in_a_pane(self):
        b = book()
        app = row(id='codex:t1', kind='codex', session='t1', pid=None, pid_at=0, loc=None, origin='Codex 桌面应用')  # (a thread in the Codex app: no pane, no process of its own)
        kid = b.bind([app], now=200)['codex:t1']
        self.assertEqual([(t['mux'], t['origin']) for t in b.get(kid)['terms']], [('', 'Codex 桌面应用')])
        b.close(kid, 'moved', now=210)  # (being moved into a terminal of the deck's own)
        b.bind([app], now=212)
        self.assertEqual((len(b.get(kid)['terms']), b.get(kid)['terms'][0]['why']), (1, 'moved'))  # (the same row, still pane-less: no terminal of it again)
        b.bind([row(id='codex:t1', kind='codex', session='t1', pid=None, window_pid=77, pid_at=211, loc={'mux': 'tmux', 'session': 'tmux:g', 'pane': '%3'})], now=214)
        self.assertEqual([(t['mux'], t['pane'], t['ended'] is None) for t in b.get(kid)['terms']], [('', '', False), ('tmux', '%3', True)])
        self.assertEqual(len(b.get(kid)['segs']), 1)  # (the same conversation, in another place)

    def test_stopping_closes_its_terminal_at_once(self):
        b = book()
        kid = b.bind([row()], now=200)['claude:c1']
        b.close(kid, now=220)
        k = b.get(kid)
        self.assertEqual((k['state'], k['terms'][0]['why'], k['terms'][0]['ended']), ('stopped', 'stopped', 220))
        b.bind([row()], now=222)  # (still seen for a moment while it goes: not a new terminal)
        k = b.get(kid)
        self.assertEqual((k['state'], len(k['terms'])), ('stopped', 1))
        b.bind([row(pid=777, pid_at=221, loc={'mux': 'zellij', 'session': 'work', 'pane': '8'})], now=224)  # (another process for it, at once: it goes on)
        k = b.get(kid)
        self.assertEqual((k['state'], [t['pane'] for t in k['terms']]), ('idle', ['3', '8']))
        b.close(kid, now=230)
        b.bind([row()], now=270)  # (still there much later: it did not stop after all)
        k = b.get(kid)
        self.assertEqual((k['state'], len(k['terms'])), ('idle', 3))

    def test_conversations_on_disk_become_stopped_sessions_once(self):
        b = book()
        w = b.space_add('Sturnus', ['/r/sturnus'])
        convs = [{'kind': 'claude', 'conv': 'old1', 'path': '/t/old1.jsonl', 'folder': '/r/sturnus', 'began': 10, 'at': 50, 'title': 'An old one', 'note': 'left\nhere'},
                 {'kind': 'codex', 'conv': 'old2', 'path': '/t/old2.jsonl', 'folder': '/elsewhere', 'began': 20, 'at': 60}]
        self.assertEqual(b.learn(convs + [{'kind': 'claude', 'conv': 'now', 'folder': '/r/sturnus', 'at': 995}], now=1000), 2)  # (one still being written is the deck's to bind)
        self.assertEqual(b.learn(convs, now=1000), 0)
        a = {k['seg']['conv']: k for k in b.all()}
        self.assertEqual((a['old1']['space'], a['old1']['title'], a['old1']['state'], a['old1']['note'], a['old1']['at'], a['old1']['term']), (w, 'An old one', 'stopped', 'left here', 50, None))
        self.assertIsNone(a['old2']['space'])
        self.assertEqual(b.bind([row(id='claude:old1', session='old1')], now=300)['claude:old1'], a['old1']['id'])  # (resumed: it is that session)
        b.set(a['old2']['id'], archived=True)
        b.drop(a['old2']['id'])
        self.assertEqual((b.learn(convs, now=1000), len(b.all())), (0, 1))  # (deleted by the person: not found on disk again)

    def test_what_was_said_is_kept_in_order_found_again_and_goes_with_the_session(self):
        b = book()
        kid = b.bind([row()], now=200)['claude:c1']
        b.say(kid, 1, '/t/c1.jsonl', 120, [{'who': 'user', 'text': '把会话改成连续的', 'at': 5}, {'who': 'tool', 'text': 'Bash(ls)', 'at': 6}, {'who': 'assistant', 'text': '好的，100% done_ok', 'at': 7}, {'who': 'user', 'text': '  '}])
        b.bind([row(id='claude:c2', session='c2')], now=260)  # (cleared: its second conversation)
        b.say(kid, 2, '/t/c2.jsonl', 40, [{'who': 'user', 'text': 'ab', 'at': 9}])
        self.assertEqual((b.reading('/t/c1.jsonl')['off'], b.reading('/t/c2.jsonl')['seg'], b.reading('/t/none')), (120, 2, None))
        self.assertEqual([(x['who'], x['text'], x['seg'], x['kind']) for x in b.said(kid)],
                         [('user', '把会话改成连续的', 1, 'claude'), ('tool', 'Bash(ls)', 1, 'claude'), ('assistant', '好的，100% done_ok', 1, 'claude'), ('user', 'ab', 2, 'claude')])
        self.assertEqual([x['text'] for x in b.said(kid, 2, talk=True)], ['好的，100% done_ok', 'ab'])
        for q, want in (('改成连', ['把会话改成连续的']), ('ab', ['ab']), ('100%', ['好的，100% done_ok']), ('done_ok', ['好的，100% done_ok']), ('Bash', []), ('', [])):
            self.assertEqual([x['text'] for x in b.find(q)], want, q)
        b.set(kid, archived=True)
        b.drop(kid)
        self.assertEqual((b.find('改成连'), b.said(kid), b.reading('/t/c1.jsonl')), ([], [], None))

    def test_a_conversation_read_again_whole_takes_the_place_of_its_copy(self):
        b = book()
        kid = b.bind([row()], now=200)['claude:c1']
        b.say(kid, 1, '/t/c1.jsonl', 900, [{'who': 'user', 'text': 'the last of it', 'at': 9}], clipped=True)  # (first met: read from near its end)
        self.assertEqual((b.said_n(kid), b.reading('/t/c1.jsonl')['v'], b.stale()), ((1, ['/t/c1.jsonl']), K.SAID_V, []))
        b.say(kid, 1, '/t/c1.jsonl', 950, [{'who': 'assistant', 'text': 'and on', 'at': 10}])  # (read further: still one read from the middle)
        self.assertEqual(b.said_n(kid), (2, ['/t/c1.jsonl']))
        whole = [{'who': 'user', 'text': 'how it began', 'at': 1}, {'who': 'user', 'text': 'the last of it', 'at': 9}, {'who': 'assistant', 'text': 'and on', 'at': 10}]
        b.say(kid, 1, '/t/c1.jsonl', 950, whole, clipped=0, whole=True)
        self.assertEqual(([x['text'] for x in b.said(kid)], b.said_n(kid), [x['text'] for x in b.find('the last of it')]), (['how it began', 'the last of it', 'and on'], (3, []), ['the last of it']))
        # a record from before a copy said which reading made it: its copies are all to be made again; one that cannot be keeps what it has
        import sqlite3
        c = sqlite3.connect(b.path)
        c.executescript('ALTER TABLE reads RENAME TO r0; CREATE TABLE reads (path TEXT PRIMARY KEY, off INTEGER NOT NULL, kept TEXT NOT NULL, seg INTEGER NOT NULL, clipped INTEGER NOT NULL DEFAULT 0);'
                        'INSERT INTO reads SELECT path, off, kept, seg, 1 FROM r0; DROP TABLE r0;')
        c.close()
        b = K.Book(b.path)
        self.assertEqual(([(r['path'], r['v']) for r in b.stale()], b.said_n(kid)[1]), ([('/t/c1.jsonl', 0)], ['/t/c1.jsonl']))
        b.reread('/t/c1.jsonl')
        self.assertEqual((b.stale(), b.said_n(kid), b.reading('/t/c1.jsonl')['clipped']), ([], (3, []), 2))

    def test_the_list_is_newest_first_with_what_each_runs_on(self):
        b = book()
        b.bind([row(), row(id='claude:c2', session='c2', pid=501, at=300, loc={'mux': 'zellij', 'session': 'work', 'pane': '4'})], now=310)
        a = b.all()
        self.assertEqual([k['seg']['conv'] for k in a], ['c2', 'c1'])
        self.assertEqual((a[0]['term']['pane'], a[0]['nsegs'], a[0]['nterms']), ('4', 1, 1))


if __name__ == '__main__':
    unittest.main()
