#!/usr/bin/env python3
"""Channels under load, without running agents: N simulated sessions take turns on a workspace channel and project
channels, the way the hooks would hand them posts (amail's own functions, in a mailbox of its own), and post, call and
discuss as busy agents do. Prints what a session is handed per turn (characters; a token is about 3–4) and how long
the hooks' channel work takes.

  python3 scripts/swarm.py [--agents 100] [--projects 10] [--rounds 20] [--busy 1] [--fill 0] [--seed 1] [--home DIR] [--quiet]
"""
import argparse, importlib.machinery, importlib.util, os, random, statistics, sys, tempfile, time

ap = argparse.ArgumentParser()
ap.add_argument('--agents', type=int, default=100)
ap.add_argument('--projects', type=int, default=10)
ap.add_argument('--rounds', type=int, default=20)
ap.add_argument('--seed', type=int, default=1)
ap.add_argument('--busy', type=int, default=1, help='chances to post per turn (1: about a third of turns post)')
ap.add_argument('--fill', type=int, default=0, help='posts already on each channel before they start (a channel keeps 3000)')
ap.add_argument('--home', help='the mailbox to fill (default: a new one in a temporary folder)')
ap.add_argument('--quiet', action='store_true', help='only the summary')
o = ap.parse_args()

os.environ['AMAIL_HOME'] = o.home or tempfile.mkdtemp(prefix='amail-swarm-')
spec = importlib.util.spec_from_loader('amail', importlib.machinery.SourceFileLoader('amail', os.path.join(os.path.dirname(__file__), '..', 'amail')))
A = importlib.util.module_from_spec(spec)
spec.loader.exec_module(A)
A.CLAUDE_SESSIONS = tempfile.mkdtemp(prefix='swarm-claude-')  # (none of this machine's real sessions)
rnd = random.Random(o.seed)

WORDS = ('the parser now keeps comments; tests pass; next the CLI flags. found the flaky test: a shared temp dir. '
         'merged the schema change, run migrations before pulling. the build is slow because of the wasm step. '
         'I am refactoring the session list; please do not touch web/app.js for an hour. '
         'review of the login page done, two small issues filed. benchmark: 3.2 ms per request, down from 5.1.').split()


def say(n):
    return ' '.join(rnd.choice(WORDS) for _ in range(n))


ws = {'key': A.key_of('w', '/swarm'), 'name': 'swarm', 'path': '/swarm', 'kind': 'workspace'}
projs = [{'key': A.key_of('p', f'/swarm/p{i}'), 'name': f'p{i}', 'path': f'/swarm/p{i}', 'kind': 'project'} for i in range(o.projects)]
for c in [ws] + projs:
    A.chan_ensure(c)
names = [f'agent-{i:03d}' for i in range(o.agents)]
proj_of = {n: projs[i % o.projects]['key'] for i, n in enumerate(names)}
if o.fill:  # (older posts, as a channel that has been busy for days holds them: written before anyone here joins)
    t0 = time.time() - o.fill - 60
    for c in [ws] + projs:
        old = A.topic_new(rnd.choice(names), c['key'], say(5), say(30), rnd.sample(names, 4))
        A.put(A.path('channels', c['key'], 'topics', f'{old["id"]}.json'), {**old, 'at': t0 - 1})
        for i in range(o.fill):
            at = round(t0 + i, 6)
            m = {'id': f'{i:010x}', 'from': rnd.choice(names), 'kind': 'claude', 'text': say(50), 'topic': old['id'] if i % 4 == 0 else None, 'to': [], 'at': at}
            A.put(A.path('channels', c['key'], 'posts', f'{at:.6f}-{m["id"]}.json'), m)
        A.put(A.path('channels', c['key'], 'topics', f'{old["id"]}.json'), {**A.topic_get(c['key'], old['id']), 'n': 1 + len(range(0, o.fill, 4))})
        for f in os.listdir(os.path.dirname(A.path('channels', c['key'], 'seen', 'x'))):
            os.remove(A.path('channels', c['key'], 'seen', f))
for n in names:  # (on the board, as their hooks would have put them, so a call by name is known)
    A.put(A.path('board', f'{n}.json'), {'name': n, 'kind': 'claude', 'state': 'idle', 'at': time.time()})
    A.join(n, ws['key'], auto=True)
    A.join(n, proj_of[n], auto=True)

hand_start, hand_mid, t_start, t_mid, t_post, posted = [], [], [], [], [], {'plain': 0, 'call': 0, 'all': 0, 'topic': 0}
open_topics = [(c['key'], t['id']) for c in [ws] + projs for t in A.topics(c['key'])]  # (channel key, topic id)


def deliver(me, urgent):
    t0 = time.perf_counter()
    items = A.news(me, urgent=urgent)
    text = A.news_text(me, items) if items else ''
    (t_mid if urgent else t_start).append(time.perf_counter() - t0)
    (hand_mid if urgent else hand_start).append(len(text))
    return text


def act(me):
    t0 = time.perf_counter()
    r = rnd.random()
    mine = [(k, tid) for k, tid in open_topics if me in (A.topic_get(k, tid) or {}).get('members', ())]
    if mine and rnd.random() < .5:
        k, tid = rnd.choice(mine)
        try:
            A.post(me, k, say(40), topic=tid)
            posted['topic'] += 1
        except ValueError:  # (closed meanwhile)
            open_topics.remove((k, tid))
    elif r < .25:
        A.post(me, proj_of[me], say(50))
        posted['plain'] += 1
    elif r < .32:
        A.post(me, ws['key'], say(60))
        posted['plain'] += 1
    elif r < .36:
        A.post(me, proj_of[me], f'@{rnd.choice(names)} {say(30)}')
        posted['call'] += 1
    elif r < .365:
        A.post(me, ws['key'], f'@all {say(30)}')
        posted['all'] += 1
    elif r < .375:
        k = rnd.choice([ws['key'], proj_of[me]])
        t = A.topic_new(me, k, say(6), say(40), rnd.sample(names, 5))
        open_topics.append((k, t['id']))
        posted['topic'] += 1
    else:
        return
    t_post.append(time.perf_counter() - t0)


start = time.time()
for r in range(o.rounds):
    # (all at work at once: each one's turn — start, a post or not, tool calls, stop — interleaved with everyone else's)
    steps = {n: ['start', 'act'] + ['tool'] * rnd.randint(1, 6) + ['stop'] for n in names}
    c0, m0 = len(hand_start), len(hand_mid)
    while steps:
        me = rnd.choice(list(steps))
        st = steps[me].pop(0)
        if not steps[me]:
            del steps[me]
        if st == 'start':
            deliver(me, False)  # (a turn starts: all that is new)
        elif st == 'act':
            for _ in range(o.busy):
                act(me)
        else:
            deliver(me, True)  # (a tool call, or it stops: calls and its discussions only)
    if not o.quiet:
        hs = hand_start[c0:]
        print(f'round {r + 1:>2}: handed at a turn start {statistics.median(hs):>6.0f} chars (median), {max(hs):>6} (max); mid-work {sum(hand_mid[m0:]):>7} chars in all')


def q(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(p * len(xs)))] if xs else 0


nposts = sum(len(os.listdir(os.path.dirname(A.path('channels', c['key'], 'posts', 'x')))) for c in [ws] + projs)
total = sum(hand_start) + sum(hand_mid)
print(f'\n{o.agents} sessions, {o.projects} projects, {o.rounds} rounds ({o.agents * o.rounds} turns) in {time.time() - start:.1f}s; '
      f'{nposts} posts ({posted})')
print(f'handed at a turn start:  median {q(hand_start, .5):>6} chars, p95 {q(hand_start, .95):>6}, max {max(hand_start):>6}')
print(f'handed mid-work/stop:    median {q(hand_mid, .5):>6} chars, p95 {q(hand_mid, .95):>6}, max {max(hand_mid):>6}')
print(f'all handed over:         {total:,} chars ≈ {total // 4:,} tokens ({total // 4 // (o.agents * o.rounds):,} per turn)')
print(f'hook time, turn start:   median {q(t_start, .5) * 1000:6.1f} ms, p95 {q(t_start, .95) * 1000:6.1f} ms, max {max(t_start) * 1000:6.1f} ms')
print(f'hook time, mid-work:     median {q(t_mid, .5) * 1000:6.1f} ms, p95 {q(t_mid, .95) * 1000:6.1f} ms, max {max(t_mid) * 1000:6.1f} ms')
print(f'a post:                  median {q(t_post, .5) * 1000:6.1f} ms, p95 {q(t_post, .95) * 1000:6.1f} ms, max {max(t_post) * 1000:6.1f} ms')
t0 = time.perf_counter(); A.posts(ws['key']); whole = time.perf_counter() - t0
t0 = time.perf_counter(); A.posts(ws['key'], limit=400); last = time.perf_counter() - t0
print(f'reading the workspace channel ({len(os.listdir(os.path.dirname(A.path("channels", ws["key"], "posts", "x"))))} posts): whole {whole * 1000:.0f} ms, the last 400 {last * 1000:.0f} ms')
print(f'mailbox: {os.environ["AMAIL_HOME"]}')
