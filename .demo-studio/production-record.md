# Production record · Sturnus 0.13.1

Date: 2026-10-29. Product source: `ab1db6f`.

## Capture log

- Rehearsal: `capture/v0.13.1-readme/rehearsal-2026-10-29T07-48-00-079Z/`.
- Video master: `capture/v0.13.1-readme/record-2026-10-29T07-48-36-846Z/walkthrough.webm`.
- These local masters, request logs, and QA previews remain in ignored production directories.
- Frontend files were served unchanged; all data came from the included fictional fixtures.
- All captured requests were GETs to the fixture origin. No browser errors or unexpected requests.
- Initial rehearsals revealed that clicking the already-selected rail tile folds its column. The final tour returns using the Dashboard link instead. No application changes were needed.
- The first export contact-sheet command depended on an unavailable font alias. The final exporter composes images without any font dependency.

## Deliverables

Three PNG stills: 2880 × 2000, stripped metadata. MP4: 1440 × 1000,
H.264, yuv420p, faststart, 36.36 s, no audio. GIF: 1008 × 700,
182 frames, 18.20 s, looping, 2× speed. All files are below the 10 MB target.

| File | Bytes | SHA-256 |
|---|---:|---|
| `channel.png` | 1,078,372 | `9cc57b38297a58a52e359ff2d4a9f3ee9c8869b12aff866f64410a86815004cb` |
| `project.png` | 997,232 | `b7328eabff38ec1bccff9ff3a886bb703a279b0f5e4602ada891b2698976733d` |
| `walkthrough.gif` | 5,501,735 | `fa182525fb1c32f647e7795130165f38642abd1b503cb70d430e40d6aeb89210` |
| `walkthrough.mp4` | 2,164,931 | `4c64fe0f11db5b1c35cdddf9256211eb10380ad7b2589e4cdf46591111fec2ad` |
| `workspace.png` | 1,063,731 | `0af7751fb321b863fc957b88bac20274b3c580d3ed8a8eb3cc8660fdb3d29d1d` |

## QA

- Visually reviewed all three screenshot compositions and the first, middle, and final video scenes, including a contact sheet spanning 0–34 seconds.
- Played the complete MP4 in Chrome at normal speed: reached `ended: true`, duration 36.36 s, no media error; playback checkpoints at approximately 11, 22, and 33 seconds.
- Verified the GIF's dimensions, duration, frame count, and a decoded middle frame.
- Rendered both READMEs through GitHub's Markdown API, then inspected local browser previews. Each loaded all five images; both section-navigation links resolved to their headings.
- Checked all local links in both READMEs, operations guide, demo transcript, and runbook. Reviewed source definitions for model defaults, delivery behavior, keyboard navigation, and configuration.
- Screenshots and captions disclose sample data. No personal paths, private discussions, tokens, keys, or real task outputs are included.
- No product/runtime files changed. Verification covers documentation, fixture navigation, and media playback; it does not claim to test live agent execution, terminal control, or message delivery.

## Retrospective

The project view best explains the product: work survives a session and stays
connected to its branch, participants, decisions, and outputs. Keep that view in
future capture sets. The full-size MP4 is the reading-quality version; the smaller
GIF is a navigation preview. Re-capture after significant UI changes instead of
editing controls or text into screenshots.
