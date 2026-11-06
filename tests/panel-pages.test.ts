import { describe, expect, test } from 'claude-code/testing'

import { formatModelName } from '../hooks/format'
import { displayToolName, toolsPage, topTools } from '../hooks/panel/activity-pages'
import { contextPage, usagePage } from '../hooks/panel/context-pages'
import { COLORS } from '../hooks/panel/palette'
import { markerTick, truncateToWidth } from '../hooks/panel/primitives'
import { speedCard } from '../hooks/panel/time-cards'
import { EMPTY_READINGS, toContextGrid } from '../hooks/readings'
import {
  EMPTY_STATS,
  addMainToolCall,
  addStopFailure,
  backfillStats,
  recordEffort,
} from '../hooks/stats'
import type { ContextGrid } from '../types'
import { START, answerEngine, breakdownFixture, panelProps } from './fixtures'

// 面板信息结构调整后的新内容：上下文页的占比与压缩次数、自动压缩刻度、模型与
// effort、限流与过载计数、工具分布页。

const CARD = { x: 0, y: 0, w: 214, h: 132 }
const SMALL_CARD = { x: 0, y: 0, w: 112, h: 132 }

const GRID: ContextGrid = {
  dots: [[{ kind: 'used', categoryIndex: 0, fullness: 1 }]],
  usedCategories: ['Messages'],
  usedTokens: 138_000,
  windowTokens: 527_000,
  percent: 26,
  autoCompactTokens: 460_000,
}

describe('上下文页', () => {
  test('构成页的头部是上下文占比，压缩次数在页脚', async () => {
    const stats = { ...EMPTY_STATS, compactions: 2 }
    const input = { stats, readings: EMPTY_READINGS, grid: GRID }
    const markup = contextPage(SMALL_CARD, input)
    expect(markup).toContain('>上下文<')
    expect(markup).toContain('>26%<')
    expect(markup).toContain('>压缩 2次<')
    expect(markup).not.toContain('上下文构成')
  })

  test('会话累计页的上下文条在自动压缩的触发点画一道刻度', async () => {
    const input = { stats: EMPTY_STATS, readings: EMPTY_READINGS, grid: GRID }
    const markup = usagePage(SMALL_CARD, input)
    // 条从 x=10 起、宽 92（卡片 112 去掉两侧 10），460000 / 527000 处在 90.3。
    expect(markup)
      .toContain(`<line x1="90.3" y1="45" x2="90.3" y2="56" stroke="${COLORS.text}"`)
    // 关闭自动压缩、或只有状态栏读数（不知道触发点）时不画。
    const offGrid = { ...GRID, autoCompactTokens: null }
    const off = usagePage(SMALL_CARD, { ...input, grid: offGrid })
    expect(off).not.toContain('<line')
    expect(usagePage(SMALL_CARD, { ...input, grid: null })).not.toContain('<line')
  })

  test('/context 关了自动压缩时格子里没有触发点', async () => {
    const on = toContextGrid(breakdownFixture({ autoCompactThreshold: 167_000 }))
    expect(on.autoCompactTokens).toBe(167_000)
    const off = toContextGrid(
      breakdownFixture({ isAutoCompactEnabled: false, autoCompactThreshold: 167_000 }),
    )
    expect(off.autoCompactTokens).toBe(null)
  })

  test('刻度落在条外时不画', async () => {
    const bar = { x: 0, y: 0, w: 100, h: 7 }
    expect(markerTick(bar, 1.2, '#fff')).toBe('')
    expect(markerTick(bar, -0.1, '#fff')).toBe('')
    expect(markerTick(bar, Number.NaN, '#fff')).toBe('')
    expect(markerTick(bar, 0.5, '#fff')).toContain('x1="50"')
  })
})

describe('模型与 effort', () => {
  test('模型名认出家族与版本时写成 Opus 5.5，认不出时原样', async () => {
    expect(formatModelName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(formatModelName('Opus 5.5')).toBe('Opus 5.5')
    expect(formatModelName('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5')
    expect(formatModelName('claude-haiku-5')).toBe('Haiku 5')
    // 旧式 id 的日期不当版本；别名没有版本。
    const legacy = 'claude-3-5-sonnet-20241022'
    expect(formatModelName(legacy)).toBe(legacy)
    expect(formatModelName('opus')).toBe('opus')
  })

  test('effort 记成字符串，没变时原样返回', async () => {
    const high = recordEffort(EMPTY_STATS, 'high')
    expect(high.effort).toBe('high')
    expect(recordEffort(high, 'high')).toBe(high)
    expect(recordEffort(high, 8000).effort).toBe('8000')
    expect(recordEffort(high, undefined).effort).toBe(null)
  })

  test('放不下的文字从末尾截断并加省略号', async () => {
    expect(truncateToWidth('Bash', 100, 10)).toBe('Bash')
    // 每个拉丁字母约 0.6 em，10 号字 30 像素放得下"star"加省略号。
    expect(truncateToWidth('start_session', 30, 10)).toBe('star…')
    expect(truncateToWidth('start_session', 3, 10)).toBe('')
  })
})

describe('限流与过载', () => {
  test('只计限流与过载，其余错误原样返回', async () => {
    const limited = addStopFailure(EMPTY_STATS, 'rate_limit')
    expect(limited.rateLimitFailures).toBe(1)
    expect(addStopFailure(limited, 'overloaded').overloadFailures).toBe(1)
    expect(addStopFailure(limited, 'billing_error')).toBe(limited)
  })

  test('速度卡片：都为 0 时不画，否则在小图顶上写小红字', async () => {
    const input = { stats: EMPTY_STATS, readings: EMPTY_READINGS, isWorking: false }
    expect(speedCard(CARD, input)).not.toContain('限流')
    const stats = { ...EMPTY_STATS, rateLimitFailures: 2, overloadFailures: 1 }
    expect(speedCard(CARD, { ...input, stats }))
      .toContain(`fill="${COLORS.error}" text-anchor="middle">限流 2 · 过载 1<`)
    const overloadOnly = { ...EMPTY_STATS, overloadFailures: 3 }
    expect(speedCard(CARD, { ...input, stats: overloadOnly })).toContain('>过载 3<')
  })
})

describe('工具分布', () => {
  const call = (tool: string, durationMs: number, isFailed = false) =>
    ({ tool, durationMs, isFailed })

  test('主对话的工具调用按工具名累计次数、耗时与失败', async () => {
    let stats = addMainToolCall(EMPTY_STATS, call('Bash', 3000, true))
    stats = addMainToolCall(stats, call('Bash', 1000))
    stats = addMainToolCall(stats, call('Read', 200))
    expect(stats.toolCalls).toBe(3)
    expect(stats.toolMs).toBe(4200)
    expect(stats.toolBreakdown).toEqual({
      Bash: { calls: 2, ms: 4000, failures: 1 },
      Read: { calls: 1, ms: 200, failures: 0 },
    })
  })

  test('旧版本的统计没有按工具的合计，重载后补成空表', async () => {
    const { toolBreakdown, effort, ...old } = EMPTY_STATS
    expect(backfillStats(old as typeof EMPTY_STATS).toolBreakdown).toEqual({})
  })

  test('按耗时取前三，耗时相同按次数；MCP 工具只写工具名', async () => {
    const breakdown = {
      Read: { calls: 9, ms: 500, failures: 0 },
      Bash: { calls: 2, ms: 9000, failures: 0 },
      Grep: { calls: 3, ms: 500, failures: 0 },
      Agent: { calls: 1, ms: 20_000, failures: 0 },
    }
    const names = topTools(breakdown, 3).map(entry => entry.tool)
    expect(names).toEqual(['Agent', 'Bash', 'Read'])
    expect(displayToolName('mcp__ccd_session__start_session')).toBe('start_session')
    expect(displayToolName('Bash')).toBe('Bash')
  })

  test('工具分布页：合计、前三的耗时与次数，失败写红字，不足三个补占位', async () => {
    const stats = {
      ...EMPTY_STATS,
      toolBreakdown: {
        Bash: { calls: 12, ms: 21_000, failures: 2 },
        Read: { calls: 5, ms: 4_000, failures: 0 },
      },
    }
    const markup = toolsPage(CARD, { stats, readings: EMPTY_READINGS, isWorking: false })
    expect(markup).toContain('>工具分布<')
    expect(markup).toContain('合计 17次 · 25秒')
    expect(markup).toContain('>21秒<')
    expect(markup).toContain('>12次<')
    expect(markup).toContain(`fill="${COLORS.error}" text-anchor="end">失败2<`)
    expect(markup.split('失败').length - 1).toBe(1)
    expect(markup).toContain('>—<')
  })
})

test('引擎报限流、过载失败与工具被拒绝时，面板记下并画出来', async ($, on) => {
  const { clock } = answerEngine(on)
  on('classic.StopFailure', () => ({}))
  on('tool.call', (_, e) => (e.tool === 'Bash' ? { deny: '不允许' } : { result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.classic.StopFailure({ error: 'rate_limit' })
  await $.classic.StopFailure({ error: 'overloaded' })
  await $.classic.StopFailure({ error: 'server_error' })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf /' })
  await $.tool.call({ tool: 'Read', file_path: '/tmp/a' })
  await clock.advance(1000)
  const first = (await panelProps($)).source
  expect(first).toContain('>限流 1 · 过载 1<')

  // 第三页是工具分布：被拒绝的 Bash 记一次失败。会话从 START 开始，第三页在 40 秒后。
  await clock.advance(40_000 - 1000)
  expect(START % 60_000).toBe(0)
  const third = (await panelProps($)).source
  expect(third).toContain('>工具分布<')
  expect(third).toContain('>失败1<')
})
