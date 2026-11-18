#!/usr/bin/env python3
"""A stand-in for Claude Code, for tests. It does what sturnus can see of the real one: keeps a conversation file, is in
Claude Code's registry of running sessions while it runs, and tells amail what happens, as the real one's hooks do.

    fake_agent.py [--resume ID] [--name NAME] [first ask]

A line typed to it is an ask, answered at once with "done: <ask>". /clear goes on with a new conversation; /ask leaves it
waiting on the person; /exit ends it.
It needs FAKE_HOME (where its conversation files go), FAKE_AMAIL (the amail to tell) and AMAIL_CLAUDE_SESSIONS (the registry)."""
import json
import os
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


def path():
    os.makedirs(os.path.join(HOME, 'projects', 'p'), exist_ok=True)
    return os.path.join(HOME, 'projects', 'p', f'{conv}.jsonl')


def write(role, text):
    with open(path(), 'a') as f:
        f.write(json.dumps({'type': role, 'message': {'role': role, 'content': text}, 'timestamp': time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime()),
                            'cwd': os.getcwd(), 'entrypoint': 'cli', 'sessionId': conv}, ensure_ascii=False) + '\n')


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
for line in sys.stdin:
    line = line.strip()
    if line == '/exit':
        hook('SessionEnd')
        leave()
    elif line == '/ask':  # (stopped at a prompt that waits on the person, until the next line)
        reg('waiting')
        print('waiting on the person', flush=True)
    elif line == '/clear':
        conv = str(uuid.uuid4())
        reg('idle')
        hook('SessionStart', source='clear')
        print(f'cleared: now on {conv}', flush=True)
    elif line:
        turn(line)
leave()
