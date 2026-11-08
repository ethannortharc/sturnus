"""The phone interface (Columba): what a phone is shown, and what its answers type.

    python3 -m unittest discover -s tests

Runs on copies of nothing: a mailbox and caches in a temporary folder, no deck, no pane."""
import importlib.machinery
import importlib.util
import json
import os
import tempfile
import threading
import unittest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = tempfile.mkdtemp(prefix='sturnus-phone-')
os.environ.update(STURNUS_CONF=f'{TMP}/conf/config.json', STURNUS_CACHE=f'{TMP}/cache', AMAIL_HOME=f'{TMP}/mail',
                  STURNUS_TASKS=f'{TMP}/tasks.db', AMAIL_CLAUDE_SESSIONS=f'{TMP}/none', AMAIL_NAME='phone-test')


def load(name):
    loader = importlib.machinery.SourceFileLoader(name, os.path.join(HERE, name))
    module = importlib.util.module_from_spec(importlib.util.spec_from_loader(name, loader))
    loader.exec_module(module)
    return module


S = load('sturnus')
A = load('amail')
PANE = {'mux': 'zellij', 'session': 'work', 'pane': '3'}
BASH = {'tool': 'Bash', 'input': {'command': 'touch columba-one.txt', 'description': 'Create empty file'}, 'use': 'toolu_1', 'at': 100}
QUESTION = {'tool': 'AskUserQuestion', 'use': 'toolu_2', 'at': 200, 'input': {'questions': [
    {'question': 'Which colour?', 'header': 'Colour', 'multiSelect': False,
     'options': [{'label': 'Red'}, {'label': 'Green'}, {'label': 'Blue'}]}]}}


GROUPS = {'work': {'clients': 1}}


def session(**kw):
    s = {'id': 'claude:abc', 'name': 'work-1', 'kind': 'claude', 'state': 'idle', 'since': 50, 'at': 60, 'loc': PANE,
         'title': '', 'needs_you': '', 'asks': [], 'tool': None, 'tool_at': None, 'tool_end': None}
    if kw.get('state') == 'waiting':  # (as collect leaves one Claude Code says waits, in a pane found now)
        s.update(prompting=True, cc_status='waiting', cc_since=90, loc_live=True)
    s.update(kw)
    return s


def items(sessions):
    return S.phone_items(sessions, groups=GROUPS)


class Items(unittest.TestCase):
    def test_a_permission_prompt_says_what_it_is_for_and_offers_yes_and_no(self):
        [it] = items([session(state='waiting', asking=BASH, title='Fix the build')])
        self.assertEqual(it['kind'], 'permission')
        self.assertEqual(it['level'], 'urgent')
        self.assertIn('touch columba-one.txt', it['body'])
        self.assertEqual([a['id'] for a in it['actions']], ['allow', 'deny'])
        self.assertEqual(it['open_url'], '/#/s/claude%3Aabc')
        self.assertEqual(it['meta'], 'work-1')

    def test_the_id_names_the_prompt_so_a_later_prompt_is_another_item(self):
        a = items([session(state='waiting', asking=BASH)])[0]['id']
        again = items([session(state='waiting', asking=dict(BASH))])[0]['id']
        later = items([session(state='waiting', asking={**BASH, 'use': 'toolu_9'})])[0]['id']
        self.assertEqual(a, again)
        self.assertNotEqual(a, later)

    def test_one_question_with_one_answer_offers_its_options(self):
        [it] = items([session(state='waiting', asking=QUESTION)])
        self.assertEqual(it['kind'], 'question')
        self.assertEqual(it['body'], 'Which colour?')
        self.assertEqual([(a['id'], a['label']) for a in it['actions']], [('o1', 'Red'), ('o2', 'Green'), ('o3', 'Blue')])

    def test_several_questions_or_several_answers_are_only_opened(self):
        many = {**QUESTION, 'input': {'questions': QUESTION['input']['questions'] * 2}}
        multi = json.loads(json.dumps(QUESTION))
        multi['input']['questions'][0]['multiSelect'] = True
        for asking in (many, multi):
            [it] = items([session(state='waiting', asking=asking)])
            self.assertEqual((it['kind'], it['actions']), ('menu', []))
            self.assertIn('Which colour?', it['body'])

    def test_a_plan_is_shown_not_approved(self):
        [it] = items([session(state='waiting', asking={'tool': 'ExitPlanMode', 'input': {'plan': 'Step one'}, 'use': 'u', 'at': 1})])
        self.assertEqual((it['kind'], it['body'], it['actions']), ('menu', 'Step one', []))

    def test_codex_at_a_prompt_and_a_prompt_with_no_details_are_only_opened(self):
        for s in (session(kind='codex', id='codex:x', state='waiting', waiting_for='Bash'), session(state='waiting', waiting_for='Claude needs your permission')):
            [it] = items([s])
            self.assertEqual(it['actions'], [])

    def test_keys_are_offered_only_where_they_would_reach_this_prompt(self):
        def acts(**kw):
            return [a['id'] for a in items([session(**{'state': 'waiting', 'asking': BASH, **kw})])[0]['actions']]
        self.assertEqual(acts(), ['allow', 'deny'])
        self.assertEqual(acts(loc=None, loc_live=False), [], 'no pane')
        self.assertEqual(acts(loc_live=False), [], 'only the pane amail saw, not one found now')
        self.assertEqual(acts(cc_status='busy'), [], 'Claude Code says it is working: answered in the terminal')
        self.assertEqual(acts(cc_status=None), [], 'not in Claude Code\'s registry')
        self.assertEqual(acts(asking={**BASH, 'many': True}), [], 'more than one prompt open')
        self.assertEqual(acts(cc_since=200), [], 'the prompt on record is older than this wait')
        self.assertEqual(acts(loc={**PANE, 'session': 'other'}), [], 'a Zellij group with no client')
        self.assertEqual(acts(loc={'mux': 'tmux', 'sock': '/tmp/x', 'pane': '%1'}), ['allow', 'deny'])

    def test_the_id_changes_with_what_the_prompt_is_for(self):
        a = items([session(state='waiting', asking=BASH)])[0]['id']
        other = items([session(state='waiting', asking={**BASH, 'input': {'command': 'rm -rf build'}})])[0]['id']
        self.assertNotEqual(a, other)

    def test_a_session_waiting_for_words_can_be_answered_and_its_asks_ticked_off(self):
        [it] = items([session(needs_you='Pick a name', asks=[{'id': 'k1', 'what': 'Pick a name'}])])
        self.assertEqual(it['kind'], 'needs')
        self.assertEqual([a['id'] for a in it['actions']], ['reply', 'done'])
        self.assertIn('text', it['actions'][0])
        [plain] = items([session(needs_you='Look at the result')])
        self.assertEqual([a['id'] for a in plain['actions']], ['reply'])

    def test_ended_hidden_and_quiet_sessions_are_left_out_and_prompts_come_first(self):
        out = items([session(state='ended', needs_you='x'), session(hidden=True, needs_you='x'), session(id='claude:q'),
                             session(id='claude:n', needs_you='Look', summary_at=999), session(id='claude:p', state='waiting', asking=BASH)])
        self.assertEqual([i['session'] for i in out], ['claude:p', 'claude:n'])

    def test_the_summary_counts_what_waits_and_what_works(self):
        sessions = [session(id='claude:p', state='waiting', asking=BASH), session(id='claude:w', state='working'), session(id='claude:i')]
        sm = S.phone_summary(sessions, items(sessions))
        self.assertEqual((sm['status'], sm['needs_me']), ('attention', 1))
        self.assertEqual([m['value'] for m in sm['metrics']], ['1', '1', '3'])
        self.assertEqual(S.phone_summary([session()], [])['status'], 'ok')


class Deck:
    """What phone_answer uses of the deck, recording what would be typed or said; and what Claude Code's registry and
    amail's board say this moment, which phone_answer reads again before it types."""

    def __init__(self, sessions, registry='waiting', board=None):
        self.lock = threading.Lock()
        self.state = {'sessions': sessions, 'groups': GROUPS}
        self.typed, self.said, self.ticked = [], [], []
        self.sums = self
        s = sessions[0]
        self.registry = [{'name': s['name'], 'status': registry}] if registry else []
        self.board = {s['name']: board if board is not None else {'state': 'waiting' if s['state'] == 'waiting' else 'idle', 'asking': s.get('asking')}}
        S.PHONE_DONE.clear()
        S.A.claude_sessions, S.A.board = (lambda: self.registry), (lambda: self.board)

    def find(self, sid):
        return next((s for s in self.state['sessions'] if s['id'] == sid), None)

    def type_in(self, s, text, enter):
        self.typed.append((s['id'], text, enter))
        return True, 'typed'

    def act(self, what, body):
        self.said.append((what, body))
        return True, 'said'

    def ask_done(self, aid):
        self.ticked.append(aid)
        return (True, {}) if aid != 'gone' else (False, 'handled')


class Answers(unittest.TestCase):
    def answer(self, deck, choice, text=''):
        it = S.phone_items(deck.state['sessions'])[0]
        return S.phone_answer(deck, it['id'], choice, text)

    def test_yes_is_key_1_and_no_is_escape(self):
        d = Deck([session(state='waiting', asking=BASH)])
        self.assertEqual(self.answer(d, 'allow')[0], 200)
        d = Deck([session(state='waiting', asking=BASH)])
        self.assertEqual(self.answer(d, 'deny')[0], 200)
        self.assertEqual(d.typed, [('claude:abc', '\x1b', False)])

    def test_a_second_answer_to_the_same_item_types_nothing(self):
        d = Deck([session(state='waiting', asking=BASH)])
        self.assertEqual(self.answer(d, 'allow')[0], 200)
        self.assertEqual(self.answer(d, 'allow')[0], 409, 'before the next collect has seen the first')
        self.assertEqual(d.typed, [('claude:abc', '1', False)])

    def test_keys_wait_for_this_moment_to_agree(self):
        for registry, board in [('busy', None), (None, None), ('waiting', {'state': 'working'}),
                                ('waiting', {'state': 'waiting', 'asking': {**BASH, 'use': 'toolu_9'}})]:
            d = Deck([session(state='waiting', asking=BASH)], registry=registry, board=board)
            self.assertEqual(self.answer(d, 'allow')[0], 409, (registry, board))
            self.assertEqual(d.typed, [])

    def test_an_option_is_its_number(self):
        d = Deck([session(state='waiting', asking=QUESTION)])
        self.assertEqual(self.answer(d, 'o2'), (200, '已选「Green」'))
        self.assertEqual(d.typed, [('claude:abc', '2', False)])

    def test_an_answer_to_a_prompt_that_has_gone_types_nothing(self):
        d = Deck([session(state='waiting', asking=BASH)])
        old = items(d.state['sessions'])[0]['id']
        d.state['sessions'] = [session(state='waiting', asking={**BASH, 'use': 'toolu_9'})]
        self.assertEqual(S.phone_answer(d, old, 'allow')[0], 409)
        d.state['sessions'] = [session(state='working')]
        self.assertEqual(S.phone_answer(d, old, 'allow')[0], 409)
        self.assertEqual(d.typed, [])

    def test_a_choice_the_item_does_not_offer_is_refused(self):
        d = Deck([session(state='waiting', asking=BASH)])
        self.assertEqual(self.answer(d, 'o1')[0], 400)
        d = Deck([session(state='waiting', asking=BASH, loc=None, loc_live=False)])
        self.assertEqual(self.answer(d, 'allow')[0], 400)
        self.assertEqual(d.typed, [])

    def test_words_go_the_way_the_page_sends_them_and_handled_ticks_the_asks(self):
        asks = [{'id': 'k1', 'what': 'Pick a name'}, {'id': 'k2', 'what': 'And a colour'}]
        d = Deck([session(needs_you='Pick a name', asks=asks)], registry='idle')
        self.assertEqual(self.answer(d, 'reply', '  ')[0], 400)
        self.assertEqual(self.answer(d, 'reply', 'Call it Columba'), (200, 'said'))
        self.assertEqual(d.said, [('say', {'id': 'claude:abc', 'text': 'Call it Columba'})])
        d = Deck([session(needs_you='Pick a name', asks=asks)], registry='idle')
        self.assertEqual(self.answer(d, 'done')[0], 200)
        self.assertEqual(d.ticked, ['k1', 'k2'])
        self.assertEqual(d.typed, [])

    def test_handled_ticks_only_what_the_card_showed(self):
        d = Deck([session(needs_you='x', asks=[{'id': 'gone', 'what': 'x'}])], registry='idle')
        self.assertEqual(self.answer(d, 'done')[0], 409, 'ticked off elsewhere already')

    def test_words_wait_while_it_has_just_stopped_at_a_prompt(self):
        d = Deck([session(needs_you='Pick a name')], registry='waiting')
        self.assertEqual(self.answer(d, 'reply', '2')[0], 409)
        self.assertEqual(d.said, [])

    def test_after_a_deny_words_go_though_amails_record_still_says_waiting(self):
        d = Deck([session(needs_you='What should I do instead?')], registry='idle', board={'state': 'waiting', 'asking': BASH})
        self.assertEqual(self.answer(d, 'reply', 'Use the other folder')[0], 200)


@unittest.skipUnless(S.shutil.which('tmux'), 'needs tmux')
class Screen(unittest.TestCase):
    """A pane as it looks now, read only, from a tmux server of its own."""

    def test_a_pane_is_read_with_its_colours_and_width(self):
        import subprocess
        name = f'sturnus-screen-{os.getpid()}'
        subprocess.run(['tmux', '-L', name, 'new-session', '-d', '-s', 't', '-x', '70', '-y', '10', "printf '\\033[32mgreen\\033[0m plain\\n'; sleep 30"], check=True)
        self.addCleanup(subprocess.run, ['tmux', '-L', name, 'kill-server'], capture_output=True)
        sock = subprocess.run(['tmux', '-L', name, 'display', '-p', '#{socket_path}'], capture_output=True, text=True).stdout.strip()
        pane = subprocess.run(['tmux', '-L', name, 'display', '-p', '#{pane_id}'], capture_output=True, text=True).stdout.strip()
        for _ in range(40):
            ok, text, cols = S.pane_screen({'mux': 'tmux', 'sock': sock, 'pane': pane, 'session': 'tmux:t'})
            if 'plain' in text:
                break
            S.time.sleep(.1)
        self.assertTrue(ok)
        self.assertIn('\x1b[32mgreen', text)
        self.assertEqual(cols, 70)


class Hooks(unittest.TestCase):
    """amail keeps what a permission prompt is for, and lets go of it once the prompt is answered."""

    def event(self, name, **p):
        A.on_event('claude', A.EVENTS[name], {'session_id': 's-1', 'hook_event_name': name, 'cwd': TMP, **p})
        return A.get(A.path('board', 'phone-test.json'), {})

    def test_a_prompt_keeps_its_tool_call_until_it_is_answered(self):
        self.event('PreToolUse', tool_name='Bash', tool_input={'command': 'ls'}, tool_use_id='toolu_7')
        e = self.event('PermissionRequest', tool_name='Bash', tool_input={'command': 'ls'})
        self.assertEqual((e['state'], e['asking']['tool'], e['asking']['use'], e['asking']['input']), ('waiting', 'Bash', 'toolu_7', {'command': 'ls'}))
        e = self.event('Notification', message='Claude needs your permission to use Bash')
        self.assertEqual(e['asking']['use'], 'toolu_7')
        self.assertFalse(e['asking']['many'])
        e = self.event('PostToolUse', tool_name='Bash', tool_input={'command': 'ls'}, tool_use_id='toolu_7')
        self.assertNotIn('asking', e)
        self.assertEqual(e['state'], 'working')

    def test_another_call_starting_leaves_an_open_prompt_and_a_second_one_is_marked(self):
        self.event('UserPromptSubmit', prompt='go')
        self.event('PreToolUse', tool_name='Bash', tool_input={'command': 'a'}, tool_use_id='toolu_a')
        self.event('PermissionRequest', tool_name='Bash', tool_input={'command': 'a'})
        e = self.event('PreToolUse', tool_name='Bash', tool_input={'command': 'b'}, tool_use_id='toolu_b')
        self.assertEqual(e['asking']['input'], {'command': 'a'}, 'a sub-agent starting a call does not answer the prompt')
        e = self.event('PermissionRequest', tool_name='Bash', tool_input={'command': 'b'})
        self.assertTrue(e['asking']['many'], 'two open: which one the terminal shows is not known here')
        e = self.event('PostToolUse', tool_name='Bash', tool_input={'command': 'a'}, tool_use_id='toolu_a')
        self.assertIn('asking', e, 'the end of another call leaves this one')
        e = self.event('Stop')
        self.assertNotIn('asking', e)

    def test_a_question_ends_by_its_call_though_its_end_carries_the_answers(self):
        self.event('UserPromptSubmit', prompt='ask me')
        q = {'questions': [{'question': 'Which?', 'options': [{'label': 'A'}, {'label': 'B'}]}]}
        self.event('PreToolUse', tool_name='AskUserQuestion', tool_input=q, tool_use_id='toolu_q')
        self.event('PermissionRequest', tool_name='AskUserQuestion', tool_input=q)
        e = self.event('PostToolUse', tool_name='AskUserQuestion', tool_input={**q, 'answers': {'Which?': 'B'}}, tool_use_id='toolu_q')
        self.assertNotIn('asking', e)
        self.event('PreToolUse', tool_name='Bash', tool_input={'command': 'ls'}, tool_use_id='toolu_n')
        e = self.event('PermissionRequest', tool_name='Bash', tool_input={'command': 'ls'})
        self.assertFalse(e['asking']['many'], 'the next prompt in the turn is the only one open')

    def test_long_input_is_cut_and_a_huge_one_kept_small(self):
        self.assertEqual(len(A.clip_input({'command': 'x' * 5000})['command']), 1501)
        huge = A.clip_input({f'k{i}': 'y' * 1400 for i in range(30)})
        self.assertEqual(list(huge), ['clipped'])
        self.assertLess(len(huge['clipped']), 6100)


if __name__ == '__main__':
    unittest.main()
