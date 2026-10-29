# Sturnus 0.13.1 · README media

## Brief

Audience: developers running Claude Code, Codex, and Cursor together. Show how
Sturnus connects a request for attention to its workspace, worktree, session,
conversation, and shared channel. Deliver three screenshots, a short inline GIF,
and a captioned MP4 walkthrough for the English and Chinese GitHub READMEs.

Source: `ab1db6f` / version 0.13.1. Frontend files are served unchanged. The API
responses are synthetic fixtures in `source/v0.13.1-readme/fixtures.cjs`. This is
an interactive UI tour, not an end-to-end agent execution or message delivery test.
No real session, mailbox, credential, model service, or terminal is accessed.
All mutating API calls and unexpected external requests are rejected.

## Visual direction

Use the application's graphite theme, restrained warm framing, generous margins,
and a consistent viewport. Keep the actual app larger than its frame. The frame
contains chapter captions and sample-data disclosure; product UI is unmodified.
Use real clicks and keyboard navigation, deliberate pauses, and a visible cursor.
No audio. No unrelated desktop, browser toolbar, or notification is captured.

## Shot list and runbook

| Step | Mode | Action | Expected result |
|---|---|---|---|
| 1 | deterministic | Load a fresh browser context with the fixture workspace | Three agent sessions and one item ready for review |
| 2 | checkpoint | Review dashboard, project, and channel stills | Native labels, readable text, no clipping or private data |
| 3 | deterministic | Open Work items, then a project | Branch progress, worktrees, sessions, and decisions are connected |
| 4 | deterministic | Open a session, then Conversation and Report | Sample transcript and report shown by the real frontend |
| 5 | deterministic | Use Cmd+K, type a session name, press Enter | Search opens the matching session |
| 6 | deterministic | Open the project's Channel | Shared sample discussion and participant identities |
| 7 | deterministic | Return to the workspace | Clean ending with the original dashboard |
| 8 | checkpoint | Review the rehearsal before recording | No unexpected API requests or browser errors |
| 9 | deterministic | Record the same navigation with chapter labels | One continuous video master; preserve it unchanged |
| 10 | checkpoint | Inspect every final still and video first/middle/last frames; play the full video | Clear story, calm motion, zero audio streams |

## Reproduce

From the repository root, use Node.js, Playwright, Chrome, FFmpeg, and ImageMagick.
These are production tools only; Sturnus's Python runtime gains no dependencies.

```
node .demo-studio/source/v0.13.1-readme/capture.cjs /path/to/playwright
node .demo-studio/source/v0.13.1-readme/capture.cjs /path/to/playwright --record
```

Each run uses a new timestamped directory under `capture/v0.13.1-readme/`.
Encoding and export commands are in the companion production scripts. Masters and
QA previews stay ignored; final assets go in `docs/media/v0.13.1/`.

Stop if fixture requests reach a real service, a control fails to navigate, a
source window is ambiguous, or private data appears. Do not stage a successful
send, model reply, or terminal execution.

GitHub limits were checked against the official documentation on 2026-10-29:
[repository file limits](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)
and [supported media attachments](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files).
Use a repository GIF for inline playback and a separate MP4 link; keep each
export below 10 MB as a production target. Uploading the finished documentation
and media to GitHub is explicitly authorized by the user.

## Export and verify

After a successful rehearsal and recording, pass their timestamped directories:

```sh
python3 .demo-studio/source/v0.13.1-readme/export.py \
  .demo-studio/capture/v0.13.1-readme/rehearsal-TIMESTAMP \
  .demo-studio/capture/v0.13.1-readme/record-TIMESTAMP
```

The export script preserves the WebM master, trims its page-load lead-in, creates
an H.264 MP4 and a 2× GIF, strips PNG metadata, and produces a video contact sheet.
It checks the absence of audio and the per-file size target. Review exported
stills and the contact sheet before publication.

To render the documentation with GitHub's Markdown API and verify it in Chrome:

```sh
mkdir -p .demo-studio/_production/readme
gh api markdown -F text=@README.md -F mode=gfm -F context=ethannortharc/sturnus \
  > .demo-studio/_production/readme/README.md.html
gh api markdown -F text=@README.zh-CN.md -F mode=gfm -F context=ethannortharc/sturnus \
  > .demo-studio/_production/readme/README.zh-CN.md.html
node .demo-studio/source/v0.13.1-readme/verify.cjs /path/to/playwright
```

The verifier uses a local reading-layout stylesheet around GitHub-rendered HTML;
it is not a screenshot of the GitHub website. It checks loaded images and heading
links, saves page previews, and plays the MP4 at normal speed through its end.
Playwright recording also requires its FFmpeg helper (`playwright install ffmpeg`).
See [the production record](production-record.md) for this capture's QA and files.
