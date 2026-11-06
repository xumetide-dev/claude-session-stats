# session-stats

[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-blue)](.claude-plugin/plugin.json)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-2.1.309-d97757)](https://github.com/anthropics/claude-code)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

English | [简体中文](README.md)

A Claude Code plugin that shows statistics for the current session above the prompt
input: context and cache hit rate, output speed and TTFT, runtime, 5-hour and 7-day
rate limits, and cost. The desktop app shows a graphical panel; the terminal shows a
few lines of text. The interface text is in Chinese.

![Desktop panel](docs/images/panel-page-1.png)

## What it shows

### Desktop

The panel has six cards. The first two cards have three pages each and turn pages
together every 20 seconds; the two cards on one page cover the same subject. Page 1
shows the main conversation and its context right now; pages 2 and 3 show totals.
The image below shows page 1; see [panel-page-2.png](docs/images/panel-page-2.png)
and [panel-page-3.png](docs/images/panel-page-3.png) for the others:

![Desktop panel, page 1](docs/images/panel-page-1.png)

| Card | Content |
| --- | --- |
| Main conversation (`主对话`) / Sub-agents (`子 agent`) / Tool breakdown (`工具分布`) | Page 1: whether the main conversation is running, the model and effort level; prompt count, tool call count (`工具调用`), and tool time. Page 2: number of running sub-agents; total time, tokens, and tool calls across sub-agents. Page 3: the main conversation's top three tools by time, each with its time and call count, and failures in red |
| Context (`上下文`) / Session (`会话`) | Page 1: context usage, a dot grid of context composition, and the compaction count (`压缩`). Pages 2 and 3: session tokens, context usage (the white tick on the bar marks the auto-compact threshold), and a cache hit rate gauge |
| Runtime (`运行时长`) | Session runtime in hours, minutes, and seconds, marked LIVE while the main conversation runs; work time and its share of the runtime |
| Output speed (`输出速度`) / TTFT | Average output speed and average TTFT; speed bars and a TTFT line for the last 24 requests; failure counts in red above the chart when turns failed on rate limits or overload |
| Rate limits (`5小时` / `7天`) | Quota used and time elapsed in the 5-hour and 7-day windows; light gray hatching on the quota bar shows the projected usage at reset at the current pace |
| Cost (`花费`) | Current cost and a step line of cost over time |

The chevron at the top center of the panel collapses and expands it: click ﹀ to
collapse the panel to a one-line summary, and click ︿ to restore it. The collapsed
state persists across sessions. The collapsed summary:

```
压缩 1 │ 会话 39.1M │ 命中率 98% │ 速度 129 tok/s │ TTFT 2.7s │ 花费 $6.51
```

### Terminal

The terminal shows up to four lines and wraps them when the window narrows. When the
session has no rate-limit readings of its own (for example, with API key billing, or
before the session has received a response), the rate-limit line is not shown.

```
压缩 1 │ 会话 3912万 │ 命中率 98.2% │ 速度 ≈129.1 tok/s │ TTFT ≈2.7s │ 花费 $6.51
时长 42分49秒 │ 耗时 12分47秒 │ Prompt 7 │ 工具 213次 · 5分15秒
5小时 19% · 4时39分后重置 │ 7天 30% · 3天18时后重置
运行中子 agent 1 │ 子 agent 合计 29分59秒 · 1196万 token · 工具 113次
```

To hide the band, use Claude Code's built-in `[-]` control (ctrl+x ctrl+a).

## Metrics

| Metric | Label | Definition |
| --- | --- | --- |
| Session tokens | `会话` | Sum of input (including cache reads and writes) and output across all requests from the main conversation and sub-agents |
| Hit rate | `命中率` | Cache-read tokens as a share of input tokens |
| Context usage | `上下文` | Matches `/context`; the denominator is the auto-compact window, which can be smaller than the model's context window |
| Speed | `速度` | Output tokens after the first token (including thinking), summed over requests, divided by the summed time between each request's first and last token |
| TTFT | `TTFT` | Time from sending a request to the start of the response, averaged over requests |
| Runtime | `时长` | From session start to the end of the main conversation's last turn; counts up to now while the main conversation runs and stops while it is idle |
| Work time | `耗时` | Sum of the durations of the main conversation's turns, including time spent waiting for permission prompts |
| Tool time | `工具` | Sum of the time from each tool call to its result, including time spent waiting for permission prompts; parallel calls are timed separately, so the total can exceed the work time |
| Tool breakdown | `工具分布` | The main conversation's tool calls split by tool name: calls, time, and failures; a tool error or a denied call counts as a failure |
| Model and effort | — | The model as `/model` shows it; effort is the thinking effort level of the latest main conversation request, not shown for models without effort |
| Rate limit / overload failures | `限流` / `过载` | Turns that failed on a rate limit (`rate_limit`) or overload (`overloaded`) after Claude Code's retries ran out; retries that succeed are not counted |
| Rate limits | `5小时` / `7天` | Percentage used and reset time of the 5-hour and 7-day windows |
| Cost | `花费` | Matches `/cost` |

Calculation rules:

- Speed and TTFT count only main conversation requests. Sub-agents often use other
  models and run in parallel.
- Requests whose first and last tokens are less than 1 second apart count toward
  TTFT but not speed. The tokens of such requests often arrive in a single batch,
  which makes the computed speed unrepresentative.
- Requests that include thinking and whose TTFT is longer than the time between
  their first and last tokens also count toward TTFT only. When thinking is not
  displayed, output tokens include the thinking, and the start of the response
  occasionally arrives only after the thinking ends. The thinking time then falls
  inside TTFT, and dividing by the first-to-last-token time alone gives hundreds to
  thousands of tok/s. Requests without thinking are not subject to this rule.
- The hit rate gauge (`命中率`) has a linear scale: 0 at the left end, 100% at the
  right end, split into red, yellow, and green zones at 70% and 90%.
- For a resumed session, runtime starts from the session's first launch. If the
  session is already idle when the plugin loads, runtime runs up to the load time
  and is corrected when the next main conversation turn ends.
- Rate limits are per account. Each session writes its readings to
  `session-stats/rate-limits.json` in the Claude Code configuration directory
  (`~/.claude` by default, or `CLAUDE_CONFIG_DIR` when set), and each window shows
  the most recent reading across all sessions. A session uses this file only when
  it has rate-limit readings of its own: the file does not record the account, so
  accounts separated by `CLAUDE_CONFIG_DIR` each have their own file. A window with
  no reading, or one past its reset time, shows 0%.
- Within one window, "most recent" is decided by when a reading was taken, not by
  how much is used: after a plan upgrade the used percentage drops while the reset
  time stays the same, and the new reading has to replace the pre-upgrade one. A
  session records the time when it receives a response and its reading changes. A
  reading that was already present when the plugin loaded has no known time, so it
  does not override a timestamped reading in the file until that session receives
  its next response. Contents of the file written by older versions, which have no
  timestamps, are ignored.
- On the panel, a rate limit turns orange when the share of quota used exceeds the
  share of the window elapsed, and red when the quota is used up. The terminal
  colors by percentage used: orange from 80%, red at 100%.
- The light gray hatching after the solid fill on a quota bar is the projected usage
  at reset, extrapolated from the average pace so far in the window: share of quota
  used ÷ share of the window elapsed. Hatching that fills the whole bar means the
  quota runs out before the reset at this pace; the bar is orange in that case too.
  No hatching is drawn until 10% of the window has elapsed (about 30 minutes for
  the 5-hour window, about 17 hours for the 7-day window), because the projection
  is unstable before then, nor for a window that has not started or has no reset
  time.
- The white tick on the context bar marks the auto-compact threshold (the threshold
  in `/context`). It is not drawn when auto-compact is off or before the first
  `/context` result.
- The tool breakdown starts counting when the plugin version that adds it loads;
  calls made before that count only toward the tool calls and tool time on the
  main conversation page, so the two totals can differ. MCP tools are shown by tool
  name, without the server name.
- Session tokens, compactions, work time, tool calls, tool breakdown, rate limit and
  overload failures, speed, TTFT, and sub-agent totals are counted by the plugin, starting when it loads in the current process
  or when the process switches to the current session. `/reload-plugins` keeps
  them; a resumed session (`--resume` or `/resume`) starts them from 0, and
  `/clear` resets them. Cost, prompt count, context usage, and rate limits are
  Claude Code's own readings and cover the whole session. The cost chart starts
  recording when the plugin loads.
- When a request fails or is interrupted before the response ends, Claude Code
  reports no usage for it, and its tokens are not counted in session tokens or the
  hit rate.

## Installation

Tested on Claude Code 2.1.309.

Install from GitHub:

```bash
claude plugin install session-stats --marketplace xumetide-dev/claude-session-stats
```

Install from within a session:

```
/plugin install session-stats --marketplace xumetide-dev/claude-session-stats
```

Install from a local directory, where the path is your clone of this repository:

```bash
claude plugin install session-stats --marketplace /path/to/claude-session-stats
```

The plugin takes effect in new sessions; in sessions already open, run
`/reload-plugins`. A plugin installed from a local directory reads that directory
directly, so after changing the code, also run `/reload-plugins`.

## Development

| Path | Content |
| --- | --- |
| `.claude-plugin/plugin.json` | Plugin manifest |
| `.claude-plugin/marketplace.json` | Marketplace file; its only entry points to the repository root |
| `hooks/register.tsx` | Entry point: reading refresh and counters |
| `hooks/band.tsx` | Band rendering, collapse, and expand |
| `hooks/panel/` | Desktop panel cards, charts, and icons |
| `hooks/format.ts` | Value formatting and terminal text lines |
| `hooks/summary.ts` | One-line summary shown when collapsed |
| `hooks/stats.ts` | Counter accumulation rules |
| `hooks/token-times.ts` | First and last token timing |
| `hooks/shared-limits.ts` | Sharing rate-limit readings across sessions |
| `types/index.d.ts` | Type contract for `$.state` |
| `tests/` | Tests |
| `scripts/readme-images.mts` | Renders the panel screenshots in this document from sample data |
| `CHANGELOG.md` | Change log per version, in Chinese; add an entry under "未发布" (Unreleased) for each fix or change |

Type checking requires a global TypeScript installation. From the repository root,
run the type check, tests, and manifest validation:

```bash
tsc -p . && claude plugin test . && claude plugin validate .
```

`tsconfig.json` extends `.claude-plugin/types/tsconfig.json`. That directory holds
type declarations that Claude Code generates when it loads the plugin, and it is not
committed. After cloning, run `claude --plugin-dir .` once to generate it, then run
the type check.

The screenshots in this document are rendered from sample data and require
`rsvg-convert` (on macOS, install it with `brew install librsvg`):

```bash
npx tsx scripts/readme-images.mts
```

## License

[Apache License 2.0](LICENSE)
