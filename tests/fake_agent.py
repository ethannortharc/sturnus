#!/usr/bin/env python3
"""A stand-in for Claude Code, for tests. It does what sturnus can see of the real one: keeps a conversation file, is in
Claude Code's registry of running sessions while it runs, and tells amail what happens, as the real one's hooks do.

    fake_agent.py [--resume ID] [--name NAME] [first ask]

A line typed to it is an ask, answered at once with "done: <ask>". /clear goes on with a new conversation; /ask leaves it
waiting on the person; /model NAME, /effort LEVEL and /fast on|off change what its next answers say they were made with;
/work SECONDS keeps it at work that long, and a line typed meanwhile is kept as Claude Code keeps words sent mid-turn (queued
at once, handed over at the next step as a line of its own kind, then answered with "noted: <words>"); /exit ends it.
It needs FAKE_HOME (where its conversation files go), FAKE_AMAIL (the amail to tell) and AMAIL_CLAUDE_SESSIONS (the registry)."""
import json
import os
import select
import signal
import subprocess
import sys
import time
import uuid

HOME, REG, AMAIL = os.environ['FAKE_HOME'], os.environ['AMAIL_CLAUDE_SESSIONS'], os.environ['FAKE_AMAIL']
args = sys.argv[1:]
flag = lambda f: args[args.index(f) + 1] if f in args else None
conv = flag('--resume') or str(uuid.uuid4())
name = flag('--name') or f'{os.path.basename(os.getcwd())}-{uuid.uuid4().hex[:2]}'
taken = {i for f in ('--resume', '--name') if f in args for i in (args.index(f), args.index(f) + 1)}
first = next((a for i, a in enumerate(args) if i not in taken and not a.startswith('-')), '')
me = os.path.join(REG, f'{os.getpid()}.json')
made = {'model': 'claude-fable-5-2', 'effort': 'high', 'speed': 'standard'}  # (what each answer says it was made with, as Claude Code's do)


def path():
    os.makedirs(os.path.join(HOME, 'projects', 'p'), exist_ok=True)
    return os.path.join(HOME, 'projects', 'p', f'{conv}.jsonl')


def stamp():
    return time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime())


def raw(line):
    with open(path(), 'a') as f:
        f.write(json.dumps(line, ensure_ascii=False) + '\n')


def write(role, text):
    with open(path(), 'a') as f:
        how = {'effort': made['effort']} if role == 'assistant' else {}
        said = {'role': role, 'content': text, **({'model': made['model'], 'usage': {'speed': made['speed']}} if role == 'assistant' else {})}
        f.write(json.dumps({'type': role, 'message': said, 'timestamp': stamp(),
                            'cwd': os.getcwd(), 'entrypoint': 'cli', 'sessionId': conv, **how}, ensure_ascii=False) + '\n')


def reg(status):
    ms = int(time.time() * 1000)
    os.makedirs(REG, exist_ok=True)
    with open(me + '.tmp', 'w') as f:
        json.dump({'pid': os.getpid(), 'sessionId': conv, 'cwd': os.getcwd(), 'name': name, 'status': status, 'kind': 'interactive',
                   'updatedAt': ms, 'statusUpdatedAt': ms}, f)
    os.replace(me + '.tmp', me)


def hook(event, **more):
    subprocess.run([sys.executable, AMAIL, 'hook', 'claude'], text=True, capture_output=True, timeout=30,
                   input=json.dumps({'hook_event_name': event, 'session_id': conv, 'cwd': os.getcwd(), 'transcript_path': path(), **more}))


def turn(text):
    write('user', text)
    reg('busy')
    hook('UserPromptSubmit', prompt=text)
    write('assistant', f'done: {text}')
    reg('idle')
    hook('Stop', last_assistant_message=f'done: {text}')
    print(f'done: {text}', flush=True)


EOF, held = object(), b''


def typed(wait=None):
    """The next line typed to it; None when WAIT seconds pass without one; EOF when its input ends."""
    global held
    end = None if wait is None else time.time() + wait
    while b'\n' not in held:
        if end is not None and (end <= time.time() or not select.select([0], [], [], max(0, end - time.time()))[0]):
            return None
        more = os.read(0, 65536)
        if not more:
            return EOF
        held += more
    line, held = held.split(b'\n', 1)
    return line.decode('utf-8', 'replace').strip()


def work(secs, text):
    write('user', text)
    reg('busy')
    hook('UserPromptSubmit', prompt=text)
    end = time.time() + secs
    while True:
        line = typed(end - time.time())
        if line is None or line is EOF:
            break
        if not line:
            continue
        at = stamp()
        raw({'type': 'queue-operation', 'operation': 'enqueue', 'timestamp': at, 'content': line})
        write('assistant', 'a step')  # (the step in hand comes to its end; then the words are handed over)
        raw({'type': 'queue-operation', 'operation': 'remove', 'timestamp': stamp(), 'content': line})
        raw({'type': 'attachment', 'attachment': {'type': 'queued_command', 'prompt': line, 'commandMode': 'prompt', 'origin': {'kind': 'human'}, 'timestamp': at, 'humanTurn': True}, 'timestamp': at})
        write('assistant', f'noted: {line}')
        print(f'noted: {line}', flush=True)
    write('assistant', f'done: {text}')
    reg('idle')
    hook('Stop', last_assistant_message=f'done: {text}')
    print(f'done: {text}', flush=True)


def leave(*_):
    try:
        os.remove(me)
    except OSError:
        pass
    sys.exit(0)


signal.signal(signal.SIGTERM, leave)
signal.signal(signal.SIGHUP, leave)
reg('idle')
hook('SessionStart')
print(f'fake agent {name} on {conv}', flush=True)
if first:
    turn(first)
while True:
    line = typed()
    if line is EOF:
        break
    if line == '/exit':
        hook('SessionEnd')
        leave()
    elif line == '/ask':  # (stopped at a prompt that waits on the person, until the next line)
        reg('waiting')
        print('waiting on the person', flush=True)
    elif line.split(' ')[0] in ('/model', '/effort', '/fast') and len(line.split()) == 2:
        word, v = line.split()
        if word == '/model':
            made['model'] = f'claude-{v}-5-2' if v == 'fable' else f'claude-{v}-5-5'
        elif word == '/effort':
            made['effort'] = v
        else:
            made['speed'] = 'fast' if v == 'on' else 'standard'
        print(f'{word[1:]} set to {v}', flush=True)
    elif line.split(' ')[0] == '/work' and len(line.split()) == 2:
        work(float(line.split()[1]), line)
    elif line == '/clear':
        conv = str(uuid.uuid4())
        reg('idle')
        hook('SessionStart', source='clear')
        print(f'cleared: now on {conv}', flush=True)
    elif line:
        turn(line)
leave()
