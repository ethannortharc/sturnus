# Sturnus installation and operations

[← README](../README.md) · [中文 README](../README.zh-CN.md)

Commands below run from the repository root.

## Install

Either clone it:

```sh
git clone https://github.com/ethannortharc/sturnus && cd sturnus && ./sturnus install
```

or take the newest release ([Releases](https://github.com/ethannortharc/sturnus/releases)), unpack it and run `./sturnus install` in its folder.

- `./sturnus install` — installs into `~/.local/share/sturnus`. It adds:
  - `~/.local/bin/sturnus` and `~/.local/bin/amail`,
  - amail's hooks for Claude Code, Codex and Cursor,
  - the Zellij plugin,
  - a user service on http://127.0.0.1:7788 that starts at login: systemd on Linux (`systemctl --user status sturnus`), launchd on macOS (`~/Library/LaunchAgents/com.giomni.sturnus.plist`, log in `~/Library/Logs/sturnus.log`),
  - with Tailscale, https://\<machine\>.\<tailnet\>.ts.net:7443 (see below).
- `sturnus token [--rotate]` — the sign-in token. Every browser needs it once, then stays signed in for 30 days. `--rotate` makes a new token and signs every browser out.
- `sturnus status` — the version, the service, and every address it is on.
- `sturnus upgrade` — the newest version, on Linux and macOS alike. Installed from a clone, it pulls the clone (fast-forward only) and installs it when its VERSION is newer; installed from a release, it takes the newest release on GitHub (checked against its sha256). Three versions are kept, and a new one must pass its own check before it takes over. `--force` installs again, `--release` takes the release even with a clone.
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
- `releases`: the GitHub repository `sturnus upgrade` takes releases from (default `ethannortharc/sturnus`);
- `work_lang`: `"zh"` (default) or `"en"` for generated summaries, reports, assistant replies, and drafts;
- `models.summary` and `models.assist`: separate model configurations for background summaries and interactive assistance;
- `voice`: optional speech-to-text provider settings.

The easiest way to configure models is **Settings → Assistant & models**. Each role supports `claude`, `codex`, `pi`, or an OpenAI-compatible `api`. Defaults are Claude Haiku for summaries and Claude Sonnet for the assistant, using the installed CLI and its authentication.

For example, to use a compatible API for summaries while keeping Claude for the assistant:

```json
{
  "workspaces": ["~/projects"],
  "work_lang": "en",
  "models": {
    "summary": {
      "source": "api",
      "url": "https://your-model-service.example/v1",
      "model": "your-model-name",
      "key_env": "STURNUS_MODEL_KEY"
    },
    "assist": { "source": "claude", "model": "sonnet" }
  }
}
```

Replace the example endpoint and model. If using `key_env`, make that variable available to the user service; a variable exported only in an interactive shell may not reach launchd or systemd. Alternatively, save the key through Settings. Keys are stored separately in `secrets.json` beside the config; Sturnus creates this file with mode `600`. Legacy `summarizer.api` is used only when `models.summary` is absent. Use the model-role settings for new configurations.

**Settings → Display** controls the browser's English/Chinese interface, theme, page colors (warm grey by default, cool grey, or a frame that stays dark), workspace marks, and pane titles. Interface language is saved in the browser; `work_lang` controls future model-generated content separately.

### Data sent to providers

The dashboard and its state live on this machine. Model features send relevant session excerpts and context to the selected CLI or API provider. A local dashboard does not imply local model processing. Optional voice input sends recordings to the selected transcription provider (Soniox, ElevenLabs, AssemblyAI, or an OpenAI-compatible service). Voice capture needs browser microphone permission and HTTPS, except on localhost.

## Trying a change

A second instance can run beside the installed one: `STURNUS_CONF`, `STURNUS_CACHE` and `AMAIL_HOME` point it at its own settings (with another `port`), caches and mail. `STURNUS_DRY=1` suppresses typing into panes and queueing into Codex threads; it is not a general network or filesystem sandbox.

To reproduce the README media without contacting agent sessions or model services, use the [fixture capture runbook](../.demo-studio/runbook.md). That browser harness serves the unmodified frontend with fictional API responses and rejects mutating requests.

## Building

The Zellij plugin's source is in `zellij-jump/`. Rebuild it with `cargo build --release --target wasm32-wasip1`, then copy the `.wasm` file into the repository root. `scripts/release.sh` makes the release archive from a clean checkout of a tag.

## License

MIT (see [LICENSE](../LICENSE)). xterm.js in `web/vendor` is MIT, the fonts in `web/fonts` are under the SIL Open Font License (see [`web/fonts/OFL.txt`](../web/fonts/OFL.txt)).

© 2026 Ethan H.B. Zhou
