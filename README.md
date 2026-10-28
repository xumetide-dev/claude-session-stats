# session-stats

Claude Code 插件（mod）：在输入框上方显示当前会话的状态统计。桌面端是一张图形面板，
终端是几行文字。

## 显示内容

桌面端面板是深色底上的六张卡片：

| 卡片 | 内容 |
| --- | --- |
| 子 agent / 主对话（两页轮播） | 子 agent：运行中的个数，合计的耗时、token、工具次数；主对话：是否在运行，Prompt 次数、工具次数与耗时 |
| 上下文 / 会话（两页轮播） | 压缩次数与上下文构成点阵；会话 token、上下文占用（按自动压缩窗口计算）、缓存命中率扇形仪表 |
| 运行时长 | 会话时长的时、分、秒，主对话运行中时标 LIVE；耗时与耗时占比 |
| 处理速度 / TTFT | 平均输出速度与 TTFT 的大号读数，最近 24 次请求的双轴小图 |
| 限额 | 5 小时与 7 天窗口：额度条与时间分段条，额度用得比时间快时变橙 |
| 花费 | 当前花费与花费随时间的阶梯折线 |

- 两处轮播每 20 秒同时换一页。
- 面板上方的「收起」按钮把面板收成一行摘要，「展开」恢复；收起状态跨会话保留。
- 终端的状态栏用 Claude Code 自带的 `[-]`（ctrl+x ctrl+a）收起。
- 速度、TTFT 与花费的历史从插件加载后开始记录，加载之前的没有。

## 安装

### 从本地目录

添加本目录为 marketplace，再安装插件：

```bash
claude plugin marketplace add /path/to/claude-session-stats
```

```bash
claude plugin install session-stats@claude-session-stats
```

安装后新开的会话生效。本地目录安装的插件直接读取该目录，修改代码后在会话中运行
`/reload-plugins` 重新读取。

### 从 GitHub

在终端会话的输入框中输入以下命令，按 `y` 添加 marketplace，再选择安装范围（scope）：

```
/plugin install session-stats --marketplace <owner>/claude-session-stats
```

从 shell 安装：

```bash
claude plugin install session-stats --marketplace <owner>/claude-session-stats
```

在桌面端：点击输入框旁的 +，选择 Plugins，用 Add marketplace 填入
`<owner>/claude-session-stats`，再 Add plugin。

`<owner>` 为仓库所在的 GitHub 账号或组织。

## 开发

```
.claude-plugin/plugin.json       插件清单
.claude-plugin/marketplace.json  marketplace 文件，唯一条目指向仓库根目录
hooks/register.tsx               入口：读数刷新与各项计数
hooks/band.tsx                   输入框上方状态栏的绘制与收起
hooks/panel/                     桌面端 SVG 面板的卡片、图标与图元
hooks/format.ts                  数值格式化与终端文字行
hooks/stats.ts                   计数的累加规则
hooks/readings.ts                引擎读数与上下文格子的转换
types/index.d.ts                 $.state 的类型契约
tests/                           测试，由 claude plugin test 运行
```

检查命令，在本目录下运行：

```bash
tsc -p .
```

```bash
claude plugin test .
```

```bash
claude plugin validate .
```

`tsconfig.json` 继承 `.claude-plugin/types/tsconfig.json`。该目录是 Claude Code
加载插件时生成的 API 类型声明，不入库；克隆后先用 `claude --plugin-dir .`
启动一次会话生成它，再运行类型检查。

## 许可证

[Apache License 2.0](LICENSE)
