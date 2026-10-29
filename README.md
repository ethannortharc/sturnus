# sturnus

One page for the Claude Code, Codex and Cursor sessions on this machine. For each session it shows:

- what it is doing (a one-line summary by a model),
- where it is (its Zellij or tmux session and pane: a session is a group, a pane an agent),
- what the sessions say to each other.

From the page you can jump to a session's pane, write to it, or give it one name that is used everywhere.

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
- `sturnus upgrade` — reinstalls from the folder it was last installed from, when that folder's VERSION is newer (so: `git pull` or unpack a newer release there, then `sturnus upgrade`). Three versions are kept.
- `sturnus uninstall [--purge]` — takes all of it out again (`--purge`: its settings, caches and mail too).
- `amail help` — the mailbox the sessions use.

An agentdeck install (this app's name before) is taken over by the first `./sturnus install`: its settings, sign-in token, keys and caches move over, and its service and folder are removed.

## From another computer

With Tailscale, the deck is also on this machine's tailnet, for your own Tailscale devices only (each peer is checked with `tailscale whois`; devices shared into your tailnet are turned away), and still asks for the token:

- **https://\<machine\>.\<tailnet\>.ts.net:7443** — through `tailscale serve`, with Tailscale's certificate for the machine's name. It needs HTTPS turned on for the tailnet (admin console → DNS → HTTPS certificates). On Linux, `tailscale serve` also needs `sudo tailscale set --operator=$USER` once. A certificate is only issued for the name, so a bare 100.x address cannot have HTTPS.
- http://\<machine\>:7788 and http://\<100.x address\>:7788 — the deck listening on the Tailscale address itself (the traffic is WireGuard-encrypted all the same).

Set `"tailnet": false` in the config to stay on 127.0.0.1. Its terminal in the page (xterm.js in `web/vendor`, MIT) is a Zellij or tmux client run by the deck in a pseudo-terminal, behind the same sign-in; a tmux one is a session grouped with the agent's, gone when the page closes.

## Settings

`~/.config/sturnus/config.json`:

- `port`, `host`;
- `tailnet` (false: not on the Tailscale address);
- `https_port` (7443);
- `pane_titles`;
- `summarizer.cmd`, which defaults to `claude -p --model haiku`;
- `summarizer.api`, to use an OpenAI-compatible endpoint instead: `{"url", "model", "key_env"}`.

## Building

The Zellij plugin's source is in `zellij-jump/`. Rebuild it with `cargo build --release --target wasm32-wasip1`, then copy the `.wasm` file next to this README. `scripts/release.sh` makes the release archive from a clean checkout of a tag.

© 2026 Ethan H.B. Zhou
