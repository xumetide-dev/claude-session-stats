# session-stats

[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-blue)](.claude-plugin/plugin.json)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-2.1.309-d97757)](https://github.com/anthropics/claude-code)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

[English](README.en.md) | 简体中文

Claude Code 插件，在输入框上方显示当前会话的统计：上下文与缓存命中率、输出速度与
TTFT、运行时长、5 小时与 7 天限额、花费。桌面端显示为图形面板，终端显示为几行文字。

![桌面端面板](docs/images/panel-page-1.png)

## 显示内容

### 桌面端

面板由六张卡片组成。前两张卡片各有两页，每 20 秒同时翻页，下图是第二页：

![桌面端面板第二页](docs/images/panel-page-2.png)

| 卡片 | 内容 |
| --- | --- |
| 子 agent / 主对话 | 第一页：运行中的子 agent 个数，子 agent 合计的耗时、token、工具调用次数。第二页：主对话是否在运行，Prompt 次数、工具调用次数与耗时 |
| 上下文 / 会话 | 第一页：压缩次数与上下文构成点阵。第二页：会话 token、上下文占用、缓存命中率仪表 |
| 运行时长 | 会话时长的时、分、秒，主对话运行时标 LIVE；耗时及其占会话时长的比例 |
| 处理速度 / TTFT | 平均输出速度与平均 TTFT，最近 24 次请求的速度柱与 TTFT 曲线 |
| 限额 | 5 小时与 7 天窗口的已用额度与已过时间 |
| 花费 | 当前花费与随时间变化的阶梯折线 |

面板顶部正中的尖括号用于收起和展开：点 ﹀ 收起为一行摘要，点 ︿ 恢复面板。
收起状态在会话之间保留。收起后的摘要：

```
压缩 1 │ 会话 39.1M │ 命中率 98% │ 速度 129 tok/s │ TTFT 2.7s │ 花费 $6.51
```

### 终端

终端最多显示四行，窗口变窄时自动换行。本会话没有限额读数时（如使用 API key 计费，
或会话还没有收到响应）不显示限额一行。

```
压缩 1 │ 会话 3912万 │ 命中率 98.2% │ 速度 ≈129.1 tok/s │ TTFT ≈2.7s │ 花费 $6.51
时长 42分49秒 │ 耗时 12分47秒 │ Prompt 7 │ 工具 213次 · 5分15秒
5小时 19% · 4时39分后重置 │ 7天 30% · 3天18时后重置
运行中子 agent 1 │ 子 agent 合计 29分59秒 · 1196万 token · 工具 113次
```

用 Claude Code 自带的 `[-]`（ctrl+x ctrl+a）收起状态栏。

## 指标说明

| 指标 | 计算方式 |
| --- | --- |
| 会话 token | 主对话与子 agent 各次请求的输入（含缓存读取与写入）与输出之和 |
| 命中率 | 缓存读取的 token 占输入 token 的比例 |
| 上下文占用 | 与 `/context` 一致，分母是自动压缩窗口，可能小于模型的上下文窗口 |
| 速度 | 首 token 之后的输出 token（含思考）之和，除以各次请求首末 token 之间的时长之和 |
| TTFT | 从发出请求到响应开始返回的时长，各次请求取平均 |
| 运行时长 | 从会话开始到主对话最后一轮结束；主对话运行时算到当前，空闲时不再增加 |
| 耗时 | 主对话各轮的时长之和，含等待权限确认的时间 |
| 工具耗时 | 各次工具调用从发起到返回的时长之和，含等待权限确认的时间；并行的调用分别计时，合计可能超过耗时 |
| 限额 | 5 小时与 7 天窗口的已用百分比与重置时刻 |
| 花费 | 与 `/cost` 一致 |

计算规则：

- 速度与 TTFT 只统计主对话的请求。子 agent 常使用其他模型，并且并行运行。
- 首末 token 相隔不足 1 秒的请求只计入 TTFT，不计入速度。这类请求的 token 常常
  一批同时到达，算出的速度偏离实际。
- 恢复的会话，运行时长从首次启动算起。插件加载时会话已经空闲的，运行时长先算到
  加载时刻，主对话下一轮结束后更正。
- 限额是账号级的。各会话把读数写入 Claude Code 配置目录下的
  `session-stats/rate-limits.json`（缺省为 `~/.claude`，设了 `CLAUDE_CONFIG_DIR`
  时是该目录），每个窗口显示所有会话中最新的一份。本会话自己有限额读数时才使用
  这份文件：文件不区分账号，用 `CLAUDE_CONFIG_DIR` 分开的账号各有一份。窗口没有
  读数或已过重置时刻时，显示为 0%。
- 已用额度的比例超过窗口已过时间的比例时，面板上的限额显示为橙色，用满时为红色。
  终端按已用百分比显示：80% 起为橙色，100% 为红色。
- 会话 token、压缩次数、耗时、工具调用、速度、TTFT 与子 agent 合计由插件累计，
  从插件在当前进程中加载、或切换到当前会话时开始计数，`/reload-plugins` 不清零；
  恢复的会话（`--resume` 或 `/resume`）从 0 开始，`/clear` 后清零。花费、Prompt
  次数、上下文占用与限额是 Claude Code 自身的读数，覆盖整个会话。花费曲线从插件
  加载时开始记录。
- 请求失败、或在响应结束前被中断时，Claude Code 不给出这次请求的用量，它的 token
  不计入会话 token 与命中率。

## 安装

在 Claude Code 2.1.309 上测试。

从 GitHub 安装：

```bash
claude plugin install session-stats --marketplace xumetide-dev/claude-session-stats
```

在会话中安装：

```
/plugin install session-stats --marketplace xumetide-dev/claude-session-stats
```

从本地目录安装，路径为本仓库的克隆目录：

```bash
claude plugin install session-stats --marketplace /path/to/claude-session-stats
```

安装后新开的会话生效；已打开的会话运行 `/reload-plugins`。从本地目录安装的插件
直接读取该目录，修改代码后同样运行 `/reload-plugins`。

## 开发

| 路径 | 内容 |
| --- | --- |
| `.claude-plugin/plugin.json` | 插件清单 |
| `.claude-plugin/marketplace.json` | marketplace 文件，唯一条目指向仓库根目录 |
| `hooks/register.tsx` | 入口：读数刷新与各项计数 |
| `hooks/band.tsx` | 状态栏的绘制、收起与展开 |
| `hooks/panel/` | 桌面端面板的卡片、图表与图标 |
| `hooks/format.ts` | 数值格式化与终端的文字行 |
| `hooks/summary.ts` | 收起后的一行摘要 |
| `hooks/stats.ts` | 计数的累加规则 |
| `hooks/token-times.ts` | 首末 token 的计时 |
| `hooks/shared-limits.ts` | 限额读数的跨会话共享 |
| `types/index.d.ts` | `$.state` 的类型契约 |
| `tests/` | 测试 |
| `scripts/readme-images.mts` | 用示例数据渲染本文的面板截图 |

类型检查需要全局安装的 TypeScript。在仓库根目录运行类型检查、测试与清单校验：

```bash
tsc -p . && claude plugin test . && claude plugin validate .
```

`tsconfig.json` 继承 `.claude-plugin/types/tsconfig.json`。该目录是 Claude Code
加载插件时生成的类型声明，不入库。克隆后先运行一次 `claude --plugin-dir .` 生成它，
再做类型检查。

本文的截图用示例数据渲染，需要 `rsvg-convert`（macOS 上运行 `brew install librsvg`
安装）：

```bash
npx tsx scripts/readme-images.mts
```

## 许可证

[Apache License 2.0](LICENSE)
