# sturnus

One page for the Claude Code, Codex and Cursor sessions on this machine. For each session it shows:

- what it is doing (a one-line summary by a model),
- where it is (its Zellij or tmux session and pane: a session is a group, a pane an agent),
- what the sessions say to each other.

From the page you can jump to a session's pane, write to it, or give it one name that is used everywhere.

- `./sturnus install` — installs into `~/.local/share/sturnus`. It adds:
  - `~/.local/bin/sturnus` and `~/.local/bin/amail`,
  - amail's hooks for Claude Code, Codex and Cursor,
  - the Zellij plugin,
  - a user service on http://127.0.0.1:7788.
- `sturnus token [--rotate]` — the sign-in token. Every browser needs it once, then stays signed in for 30 days. `--rotate` makes a new token and signs every browser out.
- `sturnus upgrade` — reinstalls from this folder when its VERSION is newer. Three versions are kept.
- An agentdeck install (this app's name before) is taken over by the first `./sturnus install`: its settings, sign-in token, keys and caches move over, and its service and folder are removed.
- `sturnus uninstall [--purge]` — takes all of it out again.
- `amail help` — the mailbox the sessions use.

From another computer: the deck also listens on this machine's Tailscale address (`http://<machine>:7788`, or its 100.x IP), for your own Tailscale devices only (each peer is checked with `tailscale whois`), and still asks for the token. Set `"tailnet": false` in the config to stay on 127.0.0.1. Its terminal in the page (xterm.js in `web/vendor`, MIT) is a Zellij or tmux client run by the deck in a pseudo-terminal, behind the same sign-in; a tmux one is a session grouped with the agent's, gone when the page closes.

Settings live in `~/.config/sturnus/config.json`:

- `port`, `host`;
- `tailnet` (false: not on the Tailscale address);
- `pane_titles`;
- `summarizer.cmd`, which defaults to `claude -p --model haiku`;
- `summarizer.api`, to use an OpenAI-compatible endpoint instead: `{"url", "model", "key_env"}`.

The Zellij plugin's source is in `zellij-jump/`. Rebuild it with `cargo build --release --target wasm32-wasip1`, then copy the `.wasm` file next to this README.

© 2026 Ethan H.B. Zhou
