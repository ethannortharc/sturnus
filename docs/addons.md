# Add-ons

An add-on is a small program of yours that Sturnus runs for you. Sturnus knows nothing about what an add-on is for. It gives one four things:

| | What Sturnus does |
|---|---|
| **Events** | Tells the add-on when a session starts, a turn ends or a session ends |
| **Tasks** | Runs the add-on every so many seconds, and shows that on the By the clock page |
| **Settings** | Shows the fields the add-on asks for under Settings → Add-ons, and hands it what you fill in |
| **State** | Shows there what the add-on says about itself: a status line, a few rows, links |

An add-on runs as a process of its own. It is never loaded into the Sturnus service, and it puts no script or markup into the page: Sturnus draws everything from what the add-on declares and answers, as plain text.

## Putting one in

```sh
sturnus addon add DIR        # put the add-on in folder DIR in (again: replace it; whether it is on stays)
sturnus addon                # the add-ons here, on or off
sturnus addon on ID          # switch it on (also under Settings → Add-ons)
sturnus addon off ID
sturnus addon remove ID
```

`add` copies the folder into `~/.local/share/sturnus/addons/ID`. Later changes to `DIR` reach Sturnus when you add it again. The running service notices within seconds; no restart is needed. An add-on that is at work is not replaced or removed under it: `add` and `remove` wait up to half a minute for the work to end, and say so if it has not.

**An add-on is a program that runs as you.** It can do whatever you can do on this machine. So add-ons are put in only at this machine's command line, never from the page, and you should add only ones whose source you trust. From the page one can switch an add-on on and off, fill in its settings and run its tasks.

## The folder

```
my-addon/
  addon.json      what it asks of Sturnus
  run.py          its program (any executable; named by "run")
  ...             whatever else it needs (at most 300 files, 20 MB, no symbolic links)
```

### addon.json

```json
{
  "id": "sample",
  "api": 1,
  "version": "1.0",
  "name": {"zh": "样例", "en": "Sample"},
  "about": {"zh": "它做什么", "en": "What it does"},
  "run": "run.py",
  "events": ["turn_end", "session_end"],
  "tasks": [
    {"id": "scan", "every": 600, "name": {"zh": "扫描", "en": "Scan"}, "about": "What one run does"}
  ],
  "settings": [
    {"id": "server", "kind": "url", "name": "Server", "hint": "https://example.com"},
    {"id": "token", "kind": "secret", "name": "Token"}
  ]
}
```

| Field | |
|---|---|
| `id` | 2 to 31 lowercase letters, digits or dashes, a letter first. The folder Sturnus keeps it in has this name |
| `api` | The version of this arrangement the add-on is written for. This document describes `1` |
| `run` | The program, a path inside the folder. It must be executable |
| `events` | Any of `session_start`, `turn_end`, `session_end` |
| `tasks` | Up to 6. `every` is in seconds, from 60 to a week |
| `settings` | Up to 8. `kind` is `text`, `url` (must start with `http://` or `https://`) or `secret` |

Every piece of text (`name`, `about`, `hint`, and the texts in the program's answers) is either a string or `{"zh": ..., "en": ...}`; the page shows the one for its language.

## The program

Sturnus runs the program with a verb, a JSON object on standard input, and the add-on's folder as the working directory. The program prints one JSON object on standard output, at most 1 MB. A non-zero exit, or `"ok": false`, means it failed; `note` then says why (else the last line of standard error is shown).

| Run as | Standard input | Answer | Time it has |
|---|---|---|---|
| `run events` | `{"events": [{"event", "agent", "session", "cwd", "transcript", "at"}, ...]}` | `{"ok", "note"}` | 15 minutes |
| `run task ID` | `{}` | `{"ok", "note"}` | 15 minutes |
| `run set` | `{"values": {"server": "...", "token": "..."}}` | `{"ok", "note"}` | 60 seconds |
| `run state` | `{}` | see below | 20 seconds |

A run that is not done in its time is stopped. The program runs in a process group of its own, and the whole group is stopped when the run ends or its time is up: an add-on leaves nothing running between runs.

The environment carries `STURNUS_ADDON` (the id), `STURNUS_LANG` (`zh` or `en`: the language of the person asking) and `STURNUS_API`.

**Events.** amail's hooks, which Claude Code, Codex and Cursor already run, leave one line per event in the mailbox; the hook itself runs no add-on and waits for none. The service hands the lines to the program within seconds, several in one call. `agent` is `claude`, `codex` or `cursor`; `transcript` is the path of the conversation's file, when the agent gives one. Events reach only an add-on that is switched on; what was left while it was off is dropped. An event is handed over once: if that call fails, it is not sent again, so an add-on that must miss nothing also has a task that picks up what was missed. Events come for every session the hooks see, sub-agents' and windowless runs' included; an add-on that cares tells them apart from the transcript.

**Tasks.** While the add-on is on, each task runs every `every` seconds, first shortly after it is switched on or the service starts, and when you press Run now. The task's `note` is shown as its last result. A failure is said on the page once, not at every run.

**Settings.** Sturnus keeps none of the values. `set` gets the fields that were filled in (a `secret` left empty is left out: the one the add-on has stays) and decides whether they hold, for example by trying them; it keeps them wherever it likes. A secret never comes back to the page.

**State.**

```json
{
  "ready": true,
  "status": {"zh": "已连上", "en": "Connected"},
  "rows": [{"name": "Last run", "value": "10:02, 4 sent"}],
  "links": [{"name": "Open", "url": "https://example.com"}],
  "settings": {"server": "https://example.com", "token": true}
}
```

`ready: false` keeps the switch off until the settings are filled in. `settings` gives the current values to show in the fields; for a `secret`, only whether it is set. Up to 12 rows and 4 links (`http` and `https` only) are shown. `state` is asked for within seconds of the add-on being put in, when the Add-ons page is opened and after each run, so it should answer fast and change nothing.

**On and off.** While an add-on is off, Sturnus hands it no events and runs none of its tasks, by the clock or by hand. It still runs `state` and `set`: the settings have to be filled in before it can be switched on.

**One at a time.** Each add-on has one piece of work going at a time (events, a task, or `set`), in a thread of its own, so a slow add-on holds up no other. Settings saved while it is at work are refused with a word to try again. `state` may be asked for meanwhile.

## What Sturnus keeps

- `~/.local/share/sturnus/addons/ID/`: the add-on's files.
- `addons` in `config.json`: for each add-on whether it is on, and the events it wants (the hook reads just this).
- `addons/ID/` in the mailbox: events on their way to the add-on.

`sturnus uninstall` takes the add-ons out with everything else. A second instance for trying things (see [operations](operations.md#trying-a-change)) keeps its add-ons apart with `STURNUS_ADDONS`.

© 2026 Ethan H.B. Zhou
