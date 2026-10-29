# Sturnus in motion / 操作演示

[English README](../README.md) · [中文 README](../README.zh-CN.md) · [Full MP4 / 完整视频](media/v0.13.1/walkthrough.mp4)

The 36-second video follows one task through the actual Sturnus **0.13.1** frontend. The README GIF shows the same sequence at **2× speed** (about 18 seconds). Both are silent; chapter captions are part of the video.

36 秒视频沿着一项工作浏览 Sturnus **0.13.1 的真实前端**。README 中的 GIF 是同一段操作的 **2 倍速版本**，约 18 秒。两者均无声，视频内含章节说明。

## What you are seeing / 画面说明

All projects, paths, agent names, messages, reports, and task results are fictional sample data. The capture uses the repository's unmodified frontend with local API fixtures. Clicks, keyboard search, tabs, and page navigation operate the real interface. No agents are run, messages sent, terminals controlled, or model calls made during the recording. This is a UI walkthrough, not evidence of a completed coding task or a delivery test.

项目、路径、Agent 名称、消息、报告和任务结果均为虚构的示例数据。拍摄使用仓库中未经修改的前端，由本地固定数据响应 API。点击、键盘搜索、标签切换和页面跳转都在真实界面中完成。录制过程不运行 Agent、不发送消息、不操作终端，也不调用模型；它展示界面操作，不代表一次真实编码任务或消息投递测试。

## Walkthrough / 文字版

Times are approximate. 时间为近似值。

| Time | Action and purpose | 操作与用途 |
|---|---|---|
| 00:00 | Start on the Studio dashboard: one session needs review, two agents are working, and three work items remain in progress. | 从 Studio 仪表盘开始：一个会话待验收，两个 Agent 工作中，三个工作项仍在进行。 |
| 00:04 | Open Work items, then atlas-api. See branch progress and the two sessions sharing the usage-limits worktree. | 打开工作项，再进入 atlas-api，查看分支进度和共用 usage-limits worktree 的两个会话。 |
| 00:11 | Open release-review, then Conversation, to read the sample review context. | 打开 release-review，再进入对话，阅读示例检查记录。 |
| 00:18 | Switch to Report for the goal, completed work, decisions, and next step. | 切到报告，查看目标、已完成事项、决定和下一步。 |
| 00:22 | Press Cmd+K, search for api-builder, and open it. Sub-agent activity appears beneath the parent session. | 按 Cmd+K 搜索 api-builder 并打开；子 Agent 活动列在父会话下方。 |
| 00:27 | Return to the project and open Channels to read the shared release discussion. | 返回项目并打开讨论区，阅读共享的发布讨论。 |
| 00:32 | Return to the workspace dashboard. | 返回工作区仪表盘。 |

## Stills / 截图

### Workspace / 工作区

![Studio dashboard with a review request and work-item progress.](media/v0.13.1/workspace.png)

### Project / 项目

![atlas-api project with worktrees, agent sessions, decisions, and an output reference.](media/v0.13.1/project.png)

### Channel / 讨论区

![Shared project discussion with agent identities, a mention, and a user decision.](media/v0.13.1/channel.png)

## Production / 制作

Screenshots are 2880 × 2000 PNGs. The video is 1440 × 1000 H.264 MP4; the GIF is 1008 × 700. Media is versioned under `docs/media/v0.13.1/` so future UI changes can get a new capture set.

The [capture runbook](../.demo-studio/runbook.md), [fixture data](../.demo-studio/source/v0.13.1-readme/fixtures.cjs), [capture script](../.demo-studio/source/v0.13.1-readme/capture.cjs), and [export script](../.demo-studio/source/v0.13.1-readme/export.py) are included for reproduction. Production tools are separate from Sturnus's runtime dependencies.
