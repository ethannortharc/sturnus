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


def session(**kw):
    s = {'id': 'claude:abc', 'name': 'work-1', 'kind': 'claude', 'state': 'idle', 'since': 50, 'at': 60, 'loc': PANE,
         'title': '', 'needs_you': '', 'asks': [], 'tool': None, 'tool_at': None, 'tool_end': None}
    s.update(kw)
    if s['state'] == 'waiting':
        s['prompting'] = True
    return s


class Items(unittest.TestCase):
    def test_a_permission_prompt_says_what_it_is_for_and_offers_yes_and_no(self):
        [it] = S.phone_items([session(state='waiting', asking=BASH, title='Fix the build')])
        self.assertEqual(it['kind'], 'permission')
        self.assertEqual(it['level'], 'urgent')
        self.assertIn('touch columba-one.txt', it['body'])
        self.assertEqual([a['id'] for a in it['actions']], ['allow', 'deny'])
        self.assertEqual(it['open_url'], '/#/s/claude%3Aabc')
        self.assertEqual(it['meta'], 'work-1')

    def test_the_id_names_the_prompt_so_a_later_prompt_is_another_item(self):
        a = S.phone_items([session(state='waiting', asking=BASH)])[0]['id']
        again = S.phone_items([session(state='waiting', asking=dict(BASH))])[0]['id']
        later = S.phone_items([session(state='waiting', asking={**BASH, 'use': 'toolu_9'})])[0]['id']
        self.assertEqual(a, again)
        self.assertNotEqual(a, later)

    def test_one_question_with_one_answer_offers_its_options(self):
        [it] = S.phone_items([session(state='waiting', asking=QUESTION)])
        self.assertEqual(it['kind'], 'question')
        self.assertEqual(it['body'], 'Which colour?')
        self.assertEqual([(a['id'], a['label']) for a in it['actions']], [('o1', 'Red'), ('o2', 'Green'), ('o3', 'Blue')])

    def test_several_questions_or_several_answers_are_only_opened(self):
        many = {**QUESTION, 'input': {'questions': QUESTION['input']['questions'] * 2}}
        multi = json.loads(json.dumps(QUESTION))
        multi['input']['questions'][0]['multiSelect'] = True
        for asking in (many, multi):
            [it] = S.phone_items([session(state='waiting', asking=asking)])
            self.assertEqual((it['kind'], it['actions']), ('menu', []))
            self.assertIn('Which colour?', it['body'])

    def test_a_plan_is_shown_not_approved(self):
        [it] = S.phone_items([session(state='waiting', asking={'tool': 'ExitPlanMode', 'input': {'plan': 'Step one'}, 'use': 'u', 'at': 1})])
        self.assertEqual((it['kind'], it['body'], it['actions']), ('menu', 'Step one', []))

    def test_codex_at_a_prompt_and_a_prompt_with_no_details_are_only_opened(self):
        for s in (session(kind='codex', id='codex:x', state='waiting', waiting_for='Bash'), session(state='waiting', waiting_for='Claude needs your permission')):
            [it] = S.phone_items([s])
            self.assertEqual(it['actions'], [])

    def test_with_no_pane_there_is_nothing_to_answer_with(self):
        [it] = S.phone_items([session(state='waiting', asking=BASH, loc=None)])
        self.assertEqual(it['actions'], [])

    def test_a_session_waiting_for_words_can_be_answered_and_its_asks_ticked_off(self):
        [it] = S.phone_items([session(needs_you='Pick a name', asks=[{'id': 'k1', 'what': 'Pick a name'}])])
        self.assertEqual(it['kind'], 'needs')
        self.assertEqual([a['id'] for a in it['actions']], ['reply', 'done'])
        self.assertIn('text', it['actions'][0])
        [plain] = S.phone_items([session(needs_you='Look at the result')])
        self.assertEqual([a['id'] for a in plain['actions']], ['reply'])

    def test_ended_hidden_and_quiet_sessions_are_left_out_and_prompts_come_first(self):
        out = S.phone_items([session(state='ended', needs_you='x'), session(hidden=True, needs_you='x'), session(id='claude:q'),
                             session(id='claude:n', needs_you='Look', summary_at=999), session(id='claude:p', state='waiting', asking=BASH)])
        self.assertEqual([i['session'] for i in out], ['claude:p', 'claude:n'])

    def test_the_summary_counts_what_waits_and_what_works(self):
        sessions = [session(id='claude:p', state='waiting', asking=BASH), session(id='claude:w', state='working'), session(id='claude:i')]
        sm = S.phone_summary(sessions, S.phone_items(sessions))
        self.assertEqual((sm['status'], sm['needs_me']), ('attention', 1))
        self.assertEqual([m['value'] for m in sm['metrics']], ['1', '1', '3'])
        self.assertEqual(S.phone_summary([session()], [])['status'], 'ok')


class Deck:
    """What phone_answer uses of the deck, recording what would be typed or said."""

    def __init__(self, sessions):
        self.lock = threading.Lock()
        self.state = {'sessions': sessions}
        self.typed, self.said, self.ticked = [], [], []
        self.sums = self

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
        return True, {}


class Answers(unittest.TestCase):
    def answer(self, deck, choice, text=''):
        it = S.phone_items(deck.state['sessions'])[0]
        return S.phone_answer(deck, it['id'], choice, text)

    def test_yes_is_key_1_and_no_is_escape(self):
        d = Deck([session(state='waiting', asking=BASH)])
        self.assertEqual(self.answer(d, 'allow')[0], 200)
        self.assertEqual(self.answer(d, 'deny')[0], 200)
        self.assertEqual(d.typed, [('claude:abc', '1', False), ('claude:abc', '\x1b', False)])

    def test_an_option_is_its_number(self):
        d = Deck([session(state='waiting', asking=QUESTION)])
        self.assertEqual(self.answer(d, 'o2'), (200, '已选「Green」'))
        self.assertEqual(d.typed, [('claude:abc', '2', False)])

    def test_an_answer_to_a_prompt_that_has_gone_types_nothing(self):
        d = Deck([session(state='waiting', asking=BASH)])
        old = S.phone_items(d.state['sessions'])[0]['id']
        d.state['sessions'] = [session(state='waiting', asking={**BASH, 'use': 'toolu_9'})]
        self.assertEqual(S.phone_answer(d, old, 'allow')[0], 409)
        d.state['sessions'] = [session(state='working')]
        self.assertEqual(S.phone_answer(d, old, 'allow')[0], 409)
        self.assertEqual(d.typed, [])

    def test_a_choice_the_item_does_not_offer_is_refused(self):
        d = Deck([session(state='waiting', asking=BASH)])
        self.assertEqual(self.answer(d, 'o1')[0], 400)
        d = Deck([session(state='waiting', asking=BASH, loc=None)])
        self.assertEqual(self.answer(d, 'allow')[0], 400)
        self.assertEqual(d.typed, [])

    def test_words_go_the_way_the_page_sends_them_and_handled_ticks_the_asks(self):
        d = Deck([session(needs_you='Pick a name', asks=[{'id': 'k1', 'what': 'Pick a name'}, {'id': 'k2', 'what': 'And a colour'}])])
        self.assertEqual(self.answer(d, 'reply', '  ')[0], 400)
        self.assertEqual(self.answer(d, 'reply', 'Call it Columba'), (200, 'said'))
        self.assertEqual(d.said, [('say', {'id': 'claude:abc', 'text': 'Call it Columba'})])
        self.assertEqual(self.answer(d, 'done')[0], 200)
        self.assertEqual(d.ticked, ['k1', 'k2'])
        self.assertEqual(d.typed, [])


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
        e = self.event('PostToolUse', tool_name='Bash', tool_use_id='toolu_7')
        self.assertNotIn('asking', e)
        self.assertEqual(e['state'], 'working')

    def test_long_input_is_cut_and_a_huge_one_kept_small(self):
        self.assertEqual(len(A.clip_input({'command': 'x' * 5000})['command']), 1501)
        huge = A.clip_input({f'k{i}': 'y' * 1400 for i in range(30)})
        self.assertEqual(list(huge), ['clipped'])
        self.assertLess(len(huge['clipped']), 6100)


if __name__ == '__main__':
    unittest.main()
