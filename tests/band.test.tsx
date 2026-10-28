import type { TurnStepChunk } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { COLORS } from '../hooks/panel/palette'

import {
  BAND,
  HOUR_MS,
  NO_USAGE,
  START,
  agent,
  answerEngine,
  answerSteps,
  bandText,
  answerFiles,
  breakdownFixture,
  drain,
  panelProps,
} from './fixtures'

// 经引擎事件驱动插件，看状态栏画出了什么：桌面端是 Svg 面板，终端是几行文字。

test('token、缓存、子 agent 与工具累加后画进状态栏', async ($, on) => {
  const { clock, engine } = answerEngine(on)
  engine.promptCount = 7
  engine.costUsd = 12.3
  engine.agents = [
    agent('a1', 'running'), agent('a2', 'waiting'), agent('a3', 'completed'),
  ]
  engine.rateLimits = [
    {
      kind: 'five_hour', percentUsed: 23.5,
      resetsAt: new Date(START + 2 * HOUR_MS).toISOString(),
    },
    { kind: 'seven_day', percentUsed: 92 },
  ]
  // 主对话一次请求 6300 万 token（缓存读 6100 万）；子 agent 一次 25.4 万。
  answerSteps(on, turnId =>
    turnId === 'main'
      ? {
          ...NO_USAGE, input_tokens: 100_000, output_tokens: 1_000_000,
          cache_read_input_tokens: 61_000_000, cache_creation_input_tokens: 900_000,
        }
      : { ...NO_USAGE, input_tokens: 254_000 },
  )
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await drain($.turn.step({ turnId: 'main', index: 0, model: 'm', messageCount: 1 }))
  await drain($.turn.step({
    turnId: 'sub', index: 0, model: 'm', messageCount: 1, agentId: 'a1',
  }))
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'pwd', agentId: 'a1' })
  await $.turn.complete({
    turnId: 'main', answer: '', durationMs: 8_743_000, isAborted: false,
    reason: 'answer',
  })
  await $.turn.complete({
    turnId: 'sub', agentId: 'a1', answer: '', durationMs: 65_000, isAborted: false,
    reason: 'answer',
  })
  await clock.advance(1000)

  for (const surface of ['desktop', 'terminal'] as const) {
    const text = await bandText($, surface)
    expect(text).toContain('会话 6325万')
    // 61,000,000 / 62,254,000 = 97.99%
    expect(text).toContain('总缓存 98.0%')
    expect(text).toContain('花费 $12.30')
    expect(text).toContain('时长 1秒')
    expect(text).toContain('耗时 2时25分43秒')
    expect(text).toContain('Prompt 7')
    expect(text).toContain('5小时 23.5% · 1时59分后重置')
    expect(text).toContain('7天 92%')
    expect(text).toContain('工具 1次 · 0秒')
    expect(text).toContain('运行中子 agent 2')
    expect(text).toContain('子 agent 合计 1分5秒 · 25.4万 token · 工具 1次')
  }
})

test('桌面端画 Svg 面板，数据进到对应的栏里；两处轮播每 20 秒换一页', async ($, on) => {
  const { clock, engine } = answerEngine(on)
  engine.costUsd = 1
  engine.rateLimits = [{ kind: 'five_hour', percentUsed: 85 }]
  engine.agents = [agent('a1', 'running')]

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  engine.costUsd = 1.5
  await clock.advance(1000)
  const { source } = await panelProps($)

  expect(source.startsWith('<svg ')).toBe(true)
  expect(source.endsWith('</svg>')).toBe(true)
  expect(source.length).toBeLessThan(131_072)
  // 子 agent 卡片：头部是运行中 1 个，下面的小方块是合计。
  expect(source).toContain('>子 agent<')
  expect(source).toContain('>运行中<')
  expect(source).toContain('>合计耗时<')
  // 第二张卡片第一页是上下文构成点阵，第二页的会话与缓存这时不画。
  expect(source).toContain('上下文构成')
  expect(source).not.toContain('总缓存')
  // prompt 与工具次数只在第一张卡片的主对话页。
  expect(source).not.toContain('Prompt')
  // 5 小时到 85%、没有重置时刻：比不了时间，按 80% 的规则用提醒色，时间条写占位符。
  expect(source).toContain(`fill="${COLORS.warning}"`)
  expect(source).toContain('>额度<')
  expect(source).toContain('>时间<')
  expect(source).toContain('>无读数<')
  // 花费记了两个点（$1 与 $1.5），画出阶梯折线。
  expect(source).toContain('url(#costFill)')
  expect(source).toContain('$1.50')

  // 20 秒后两处同时换到第二页。第一张卡片是主对话的 prompt 与工具；第二张是上下文
  // 窗口占用，与红黄绿三段的缓存仪表（分界写在段间）。
  await clock.advance(20_000)
  const second = (await panelProps($)).source
  expect(second).toContain('>主对话<')
  expect(second).toContain('>Prompt<')
  expect(second).toContain('>工具次数<')
  expect(second).not.toContain('子 agent')
  expect(second).toContain('>上下文<')
  expect(second).toContain('>1.2万 / 20万<')
  expect(second).toContain('总缓存')
  expect(second).toContain('>90%<')
  expect(second).not.toContain('上下文构成')
})

test('上下文占用按 /context 的自动压缩窗口算，与桌面端的上下文指示一致', async ($, on) => {
  const { clock, engine } = answerEngine(on)
  // 模型窗口 100 万，自动压缩窗口 52.7 万：桌面端显示 339.6k / 527k、64%。
  engine.context = { window: 1_000_000, tokens: 332_000, percent: 33 }
  engine.breakdown = breakdownFixture({
    totalTokens: 339_600, maxTokens: 527_000, rawMaxTokens: 527_000, percentage: 64,
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // 占用写在第二张卡片的第二页。
  await clock.advance(20_000)
  const { source } = await panelProps($)

  expect(source).toContain('>33.9万 / 52.7万<')
  expect(source).toContain('>64%<')
  expect(source).not.toContain('/ 100万')
})

test('主对话一次请求结束后立即刷新上下文占用，不等定时刷新', async ($, on) => {
  const { clock, engine } = answerEngine(on)
  answerSteps(on, () => NO_USAGE)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // 走到第二页的前 1 秒：15 秒的定时刷新已经用旧格子跑过，下一次在 30 秒。
  await clock.advance(19_000)
  engine.breakdown = breakdownFixture({ totalTokens: 50_000, percentage: 25 })
  await drain($.turn.step({ turnId: 'main', index: 0, model: 'm', messageCount: 1 }))
  await clock.advance(1_000)
  const { source } = await panelProps($)

  expect(source).toContain('>5万 / 20万<')
})

test('终端的分隔符与后一段同在一个 Box 里，换行时不会留在行尾', async ($, on) => {
  answerEngine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const band = (await ui.drawn()) as unknown as DrawnNode
  await ui.unmount()

  // 每一行的直接子元素都是段落 Box；竖线只出现在段落 Box 内部。
  const rows = (band.children ?? []) as DrawnNode[]
  expect(rows.length).toBeGreaterThan(0)
  for (const row of rows) {
    const segments = (row.children ?? []) as DrawnNode[]
    const types = segments.map(segment => segment.type)
    expect(types.every(type => type === 'Box')).toBe(true)
  }
})

/** 画出来的元素树里本测试关心的部分：类型与子元素。 */
type DrawnNode = { type: string; children?: unknown[] }

test('进行中的轮次与会话时长每秒刷新', async ($, on) => {
  const { clock } = answerEngine(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'hi', turnId: 'main' })
  await clock.advance(65_000)

  const text = await bandText($, 'desktop')
  expect(text).toContain('时长 1分5秒')
  expect(text).toContain('耗时 1分5秒')
})

test('只计主对话真正生效的压缩', async ($, on) => {
  answerEngine(on)
  // 压缩后至少留一条消息（摘要）；手动压缩被拦下，其余照常完成。
  const messages = [{ role: 'user' as const, text: 'summary', toolUses: [] }]
  on('session.compact', (_, e) =>
    e.trigger === 'manual' ? { skip: 'blocked' } : { messages },
  )

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.session.compact({ trigger: 'auto', messages })
  await $.session.compact({ trigger: 'precompute', messages })
  await $.session.compact({ trigger: 'auto', agentId: 'a1', messages })
  await $.session.compact({ trigger: 'manual', messages })

  expect(await bandText($, 'desktop')).toContain('压缩 1')
})

// 仿照实测的隐藏思考流（思考内容不显示）：0.5 秒来第一个空的 thinking 块，思考期间
// 陆续再来，2.5 秒思考结束、开始出正文，3 秒到末 token，再过 0.6 秒才到 stop。
// 每项是距上一块的毫秒数与块。块的开始等 engine 块测试里造不出来，它们的处理见
// token-times.test.ts。
const HIDDEN_THINKING_STREAM: [number, TurnStepChunk][] = [
  [500, { kind: 'thinking', index: 0, text: '' }],
  [1_000, { kind: 'thinking', index: 0, text: '' }],
  [1_000, { kind: 'thinking', index: 0, text: '' }],
  [0, { kind: 'text', index: 1, text: 'h' }],
  [500, { kind: 'text', index: 1, text: 'i' }],
  [600, { kind: 'stop', stopReason: 'end_turn', usage: null }],
]

test('速度与 TTFT 只计主对话，速度柱子只来自主对话', async ($, on) => {
  const { clock } = answerEngine(on)
  // 主对话输出 201 个 token（含思考）。TTFT 取首个思考块的 0.5 秒；速度是首 token
  // 之后的 200 个除以首末 token 间的 2.5 秒 = 80，stop 之前那 0.6 秒不算。
  // 子 agent 那次输出更多：若被误计入，速度会变成 (200 + 999) / 5 秒 ≈ 240。
  const mainUsage = { ...NO_USAGE, output_tokens: 201 }
  const agentUsage = { ...NO_USAGE, output_tokens: 1_000 }
  on('turn.step', async function* (_, e) {
    const usage = e.agentId === undefined ? mainUsage : agentUsage
    for (const [waitMs, chunk] of HIDDEN_THINKING_STREAM) {
      if (waitMs > 0) {
        await clock.sleep(waitMs)
      }
      yield chunk
    }

    return {
      turnId: e.turnId, index: e.index, answer: 'hi',
      toolUses: [], stopReason: 'end_turn', usage,
    }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (const agentId of [undefined, 'a1']) {
    const reading = drain($.turn.step({
      turnId: 't1', index: 0, model: 'm', messageCount: 1, agentId,
    }))
    await clock.settle()
    for (const [waitMs] of HIDDEN_THINKING_STREAM) {
      if (waitMs > 0) {
        await clock.advance(waitMs)
      }
    }
    expect((await reading).answer).toBe('hi')
  }

  const { alt, source } = await panelProps($)
  expect(alt).toContain('速度 ≈80.0 tok/s')
  // 面板上的大号读数：速度与速度柱子同为绿色，TTFT 与曲线同为蓝色。
  expect(source).toContain(`fill="${COLORS.accent}">80<tspan`)
  expect(alt).toContain('TTFT ≈0.5s')
  expect(source).toContain(`fill="${COLORS.ttft}">0.5<tspan`)
  // 速度小图只有主对话那一根（最新的一根不透明）。
  expect(source.split('fill="url(#speedBar)" opacity="1"/>').length - 1).toBe(1)
})

test('/clear 后计数清零，花费照引擎的新读数', async ($, on) => {
  const { clock, engine } = answerEngine(on)
  answerSteps(on, () => ({ ...NO_USAGE, input_tokens: 50_000 }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await drain($.turn.step({ turnId: 'main', index: 0, model: 'm', messageCount: 1 }))
  engine.costUsd = 3
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  engine.costUsd = 0
  await clock.advance(1000)

  const text = await bandText($, 'desktop')
  expect(text).toContain('会话 0')
  expect(text).toContain('花费 $0.00')
})

test('没有记账与限额读数时，面板写明没有，而不是画 0', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  answerFiles(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: START, context: { window: 200_000 }, rateLimits: [] },
  }))
  on('agent.list', () => ({ value: [] }))
  on('session.turns', () => ({ value: 0 }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(20_000)
  const { source } = await panelProps($)

  expect(source).toContain('无记账')
  expect(source).toContain('无限额读数')
  expect(source).toContain('>上下文<')
  expect(source).toContain('>—<')
})
