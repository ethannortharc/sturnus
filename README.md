# sturnus

One page for the Claude Code, Codex and Cursor sessions on this machine. You keep using each one through its own command line; Sturnus is the layer across them. For each session it shows:

- what it is doing (a one-line summary by a model),
- which project it works on, and in which worktree and branch,
- where it is (its Zellij or tmux session and pane),
- what the sessions say to each other.

From the page you can jump to a session's pane, write to it, or give it one name that is used everywhere.

## Workspaces, projects, work items

- A **workspace** is a folder of projects, like `~/Projects/software/workspace`. By default it is the folder above each git repository a session works in; list your own under `workspaces` in the settings.
- A **project** is a git repository (all its worktrees are one project) or a plain folder in a workspace.
- A **work item** is one of a project's worktrees and its branch. Sessions come and go; a work item stays until it is merged and its worktree removed.
- A session belongs to the project of the folder it is in now. One at the top of a workspace belongs to the project whose files it works on (edits count most), else to the workspace itself. On its page you can say otherwise.

The home page shows a workspace's projects with the sessions on them; a project's page shows its work items (ahead of or behind main, files not committed, the last commit) with their sessions, its channel, the decisions taken and what came out.

## Channels

Every project has a channel, and so does every workspace: a room that every session on it reads, whatever agent it is.

- `amail post "..."` posts to the channel of your project. The other sessions on it get it at the start of their next turn.
- `@NAME` in a post calls that session (`@all`: everyone on the channel). A call reaches it mid-work too, and Sturnus wakes it if it is idle. One called that is not on the channel gets it by mail.
- `amail topic "Debate: …" --invite a,b` starts a discussion with the sessions you name. Its posts reach those in it mid-work, a stop picks them up, and Sturnus wakes them when idle, so they can go back and forth. It closes after 24 posts (`--max N`), or when someone closes it.
- `amail read` shows what is new; `amail read --all` the last posts; `amail topics` the open discussions.

On the page, a project's "讨论" tab is its channel: post, start a discussion with any sessions, close it.

## Writing to a session

A session's page has one send button, and what it does follows how the session stands: typed into its terminal when it is idle, held until its turn ends while it works (or typed right away, if you say so), not typed at all while it sits at a permission or choice prompt (the text would answer the prompt), put in its mailbox when it runs in no Zellij or tmux pane.

It runs on Linux and macOS, with the Python 3 the system has (3.9 or newer) and nothing else to install.

## Install

Get a release (`sturnus-<version>.tar.gz`) or clone the repository, then, in that folder:

- `./sturnus install` — installs into `~/.local/share/sturnus`. It adds:
  - `~/.local/bin/sturnus` and `~/.local/bin/amail`,
  - amail's hooks for Claude Code, Codex and Cursor,
  - the Zellij plugin,
  - a user service on http://127.0.0.1:7788 that starts at login: systemd on Linux (`systemctl --user status sturnus`), launchd on macOS (`~/Library/LaunchAgents/com.giomni.sturnus.plist`, log in `~/Library/Logs/sturnus.log`),
  - with Tailscale, https://\<machine\>.\<tailnet\>.ts.net:7443 (see below).
- `sturnus token [--rotate]` — the sign-in token. Every browser needs it once, then stays signed in for 30 days. `--rotate` makes a new token and signs every browser out.
- `sturnus status` — the version, the service, and every address it is on.
- `sturnus upgrade` — reinstalls from the folder it was last installed from, when that folder's VERSION is newer (in a clone: `git pull`, then `sturnus upgrade`; a newer release archive: `./sturnus install` in its folder). Three versions are kept.
- `sturnus uninstall [--purge]` — takes all of it out again (`--purge`: its settings, caches and mail too).
- `amail help` — the mailbox the sessions use.

An agentdeck install (this app's name before) is taken over by the first `./sturnus install`: its settings, sign-in token, keys and caches move over, and its service and folder are removed.

## From another computer

With Tailscale, the deck is also on this machine's tailnet, for your own Tailscale devices only (each peer is checked with `tailscale whois`; devices shared into your tailnet are turned away), and still asks for the token:

- **https://\<machine\>.\<tailnet\>.ts.net:7443** — through `tailscale serve`, with Tailscale's certificate for the machine's name. It needs HTTPS turned on for the tailnet (admin console → DNS → HTTPS certificates). On Linux, `tailscale serve` also needs `sudo tailscale set --operator=$USER` once. A certificate is only issued for the name, so a bare 100.x address cannot have HTTPS.
- http://\<machine\>:7788 and http://\<100.x address\>:7788 — the deck listening on the Tailscale address itself (the traffic is WireGuard-encrypted all the same).

Set `"tailnet": false` in the config to stay on 127.0.0.1. Its terminal in the page (xterm.js in `web/vendor`, MIT) is a Zellij or tmux client run by the deck in a pseudo-terminal, behind the same sign-in; a tmux one is a session grouped with the agent's, gone when the page closes.

## Zellij's open files

Every client of a Zellij session (each terminal attached to it, the page's terminal too) loads its own copy of each tab's tab bar and status bar, and each copy holds a few files open: about 58 more files per client for a session of 7 tabs. A Zellij server that runs out of files dies, and every pane in it ends. macOS lets a server started from a terminal or an ssh login hold 256 (Linux usually 1024), which 7 tabs reach at the fourth client.

So the page does not open its terminal, or a new tab in a Zellij session, when that would take the server past its limit, and says why. macOS does not tell one process another's limit, so there the deck takes it as 256 unless the server already holds more.

To give Zellij more room, raise the limit in the shell it is started from, e.g. `ulimit -n 10240` in `~/.zshenv`, then start the Zellij session again: a running server keeps the limit it started with. On macOS, also set `zellij_max_files` to that number in the config, so the deck knows.

## Settings

`~/.config/sturnus/config.json`:

- `port`, `host`;
- `tailnet` (false: not on the Tailscale address);
- `https_port` (7443);
- `pane_titles`;
- `zellij_max_files` (macOS: the open-file limit your Zellij sessions start with, once you have raised it);
- `workspaces`: the folders of projects (default: the folder above each git repository a session works in);
- `summarizer.cmd`, which defaults to `claude -p --model haiku`;
- `summarizer.api`, to use an OpenAI-compatible endpoint instead: `{"url", "model", "key_env"}`.

## Trying a change

A second deck can run beside the installed one: `STURNUS_CONF`, `STURNUS_CACHE` and `AMAIL_HOME` point it at its own settings (with another `port`), caches and mail, and `STURNUS_DRY=1` keeps it from typing into any pane.

## Building

The Zellij plugin's source is in `zellij-jump/`. Rebuild it with `cargo build --release --target wasm32-wasip1`, then copy the `.wasm` file next to this README. `scripts/release.sh` makes the release archive from a clean checkout of a tag.

© 2026 Ethan H.B. Zhou
