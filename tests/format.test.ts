import { describe, expect, test } from 'claude-code/testing'

import {
  formatCount,
  formatCountdown,
  formatDuration,
  outputSpeed,
  rowsToText,
  toRows,
} from '../hooks/format'
import { requestChart } from '../hooks/panel/charts'
import { paceTone, windowElapsedRatio } from '../hooks/panel/limits-column'
import {
  PANEL_HEIGHT,
  PANEL_WIDTH,
  buildPanelSvg,
  carouselPage,
} from '../hooks/panel/panel'
import {
  dotGrid,
  escapeXml,
  gaugeBar,
  segmentedBar,
} from '../hooks/panel/primitives'
import { zoneGauge } from '../hooks/panel/zone-gauge'
import { EMPTY_READINGS, toContextGrid } from '../hooks/readings'
import {
  EMPTY_STATS,
  addStreamTiming,
  backfillStats,
  recordCost,
} from '../hooks/stats'
import type { ContextGrid } from '../types'
import { HOUR_MS, START, breakdownFixture } from './fixtures'

// 纯函数：格式化、累加规则、格子转换与面板图元，不经引擎。

describe('格式化', () => {
  test('大数按万、亿写，向下取整', async () => {
    expect(formatCount(9_999)).toBe('9999')
    expect(formatCount(12_345)).toBe('1.2万')
    expect(formatCount(63_254_000)).toBe('6325万')
    expect(formatCount(99_999_999)).toBe('9999万')
    expect(formatCount(123_456_789)).toBe('1.23亿')
  })

  test('时长写成时分秒，倒计时精确到分', async () => {
    expect(formatDuration(8_743_000)).toBe('2时25分43秒')
    expect(formatDuration(1_503_000)).toBe('25分3秒')
    expect(formatDuration(999)).toBe('0秒')
    expect(formatCountdown(6 * 24 * HOUR_MS + 3 * HOUR_MS + 59_000)).toBe('6天3时')
    expect(formatCountdown(2 * HOUR_MS + 13 * 60_000)).toBe('2时13分')
    expect(formatCountdown(30_000)).toBe('不到1分')
  })

  test('限额到 80% 提醒、到 100% 报错；alt 一行一句', async () => {
    const readings = {
      ...EMPTY_READINGS,
      now: START,
      fiveHour: { percentUsed: 79.9, resetsAt: null },
      sevenDay: { percentUsed: 92, resetsAt: START + HOUR_MS },
    }
    const rows = toRows(EMPTY_STATS, readings)
    expect(rows.map(row => row.map(segment => segment.label))).toEqual([
      ['压缩', '会话', '总缓存', '速度', 'TTFT'],
      ['耗时', '工具'],
      ['5小时', '7天'],
      ['子 agent 合计'],
    ])
    expect(rows[2]?.[1]).toEqual({
      label: '7天', value: '92% · 1时0分后重置', tone: 'warning',
    })
    const exceeded = { ...readings, sevenDay: { percentUsed: 100, resetsAt: null } }
    expect(toRows(EMPTY_STATS, exceeded)[2]?.[1]?.tone).toBe('error')
    expect(rowsToText(rows).split('\n')[2]).toBe('5小时 79.9% │ 7天 92% · 1时0分后重置')
  })

  test('没有限额读数时整行不出现', async () => {
    const rows = toRows(EMPTY_STATS, { ...EMPTY_READINGS, now: START })
    expect(rows.map(row => row[0]?.label)).toEqual(['压缩', '耗时', '子 agent 合计'])
  })
})

describe('累加规则', () => {
  test('速度是总输出除以总流式时长，不是各次速度的平均', async () => {
    // 两次请求：10 token / 0.05 秒（200 tok/s）与 300 token / 3 秒（100 tok/s）。
    const first = addStreamTiming(EMPTY_STATS, {
      outputTokens: 10, waitMs: 100, streamMs: 50,
    })
    const both = addStreamTiming(first, {
      outputTokens: 300, waitMs: 100, streamMs: 3_000,
    })
    // 310 / 3.05 秒 ≈ 101.6，而两次速度的平均是 150。
    expect(outputSpeed(both)?.toFixed(1)).toBe('101.6')
  })

  test('流式不足 0.5 秒的请求计入总速度；小图里只有 TTFT，没有速度柱子', async () => {
    const short = addStreamTiming(EMPTY_STATS, {
      outputTokens: 5, waitMs: 100, streamMs: 50,
    })
    expect(short.streamedOutputTokens).toBe(5)
    expect(short.recentRequests).toEqual([{ speed: null, ttftMs: 100 }])
    const long = addStreamTiming(short, {
      outputTokens: 300, waitMs: 800, streamMs: 3_000,
    })
    expect(long.recentRequests[1]).toEqual({ speed: 100, ttftMs: 800 })
  })

  test('只记速度的旧统计重载后转成 TTFT 为空的样本，旧字段不再保留', async () => {
    const legacy = { ...EMPTY_STATS, recentSpeeds: [90, 110] }
    delete (legacy as Partial<typeof legacy>).recentRequests
    const migrated = backfillStats(legacy)
    expect(migrated.recentRequests).toEqual([
      { speed: 90, ttftMs: null }, { speed: 110, ttftMs: null },
    ])
    expect('recentSpeeds' in migrated).toBe(false)
  })

  test('花费没变不记点；超过 120 个点时隔一个删一个，保留最新的点', async () => {
    const once = recordCost(EMPTY_STATS, 1, 0.5)
    expect(recordCost(once, 2, 0.5)).toBe(once)

    let stats = EMPTY_STATS
    for (let index = 1; index <= 121; index += 1) {
      stats = recordCost(stats, index, index / 100)
    }
    expect(stats.costPoints.length).toBeLessThan(121)
    expect(stats.costPoints[0]).toEqual({ at: 1, usd: 0.01 })
    const newest = stats.costPoints[stats.costPoints.length - 1]
    expect(newest).toEqual({ at: 121, usd: 1.21 })
  })
})

describe('上下文格子与面板', () => {
  test('格子按类别归类，颜色只认类别序号；占用按自动压缩窗口算', async () => {
    const grid = toContextGrid(breakdownFixture({
      totalTokens: 339_600, rawMaxTokens: 527_000, percentage: 64,
    }))
    expect(grid.usedTokens).toBe(339_600)
    expect(grid.windowTokens).toBe(527_000)
    expect(grid.percent).toBe(64)
    expect(grid.usedCategories).toEqual(['System prompt', 'Messages'])
    expect(grid.dots).toEqual([
      [
        { kind: 'used', categoryIndex: 0, fullness: 1 },
        { kind: 'used', categoryIndex: 1, fullness: 0.5 },
      ],
      [
        { kind: 'free', categoryIndex: -1, fullness: 0 },
        { kind: 'buffer', categoryIndex: -1, fullness: 1 },
      ],
    ])
  })

  test('不足 0.7 满的 used 格子画成空心', async () => {
    const grid: ContextGrid = toContextGrid(breakdownFixture())
    const markup = dotGrid({ x: 0, y: 0, w: 20, h: 20 }, grid)
    expect(markup.split('<circle').length - 1).toBe(4)
    expect(markup.split('fill="none"').length - 1).toBe(1)
  })

  test('双轴小图最多画 slots 次请求：柱子是速度，曲线连起各次 TTFT', async () => {
    const samples = Array.from({ length: 50 }, (_, index) => ({
      speed: index + 1, ttftMs: 1000 + index * 10,
    }))
    const markup = requestChart({ x: 0, y: 0, w: 120, h: 30 }, samples, 40)
    expect(markup.split('<rect').length - 1).toBe(40)
    expect(markup.split('opacity="1"').length - 1).toBe(1)
    // 40 个点：一个 M 起笔，39 段 L。
    const path = markup.split('d="')[1]?.split('"')[0] ?? ''
    expect(path.split('L').length - 1).toBe(39)
    // 两轴各自的最大值：速度 50、TTFT 1.49 秒。
    expect(markup).toContain('>50<')
    expect(markup).toContain('>1.5s<')
  })

  test('没有速度的请求不画柱子，没有 TTFT 的请求不进曲线', async () => {
    const samples = [
      { speed: 100, ttftMs: null },
      { speed: null, ttftMs: 2000 },
      { speed: 80, ttftMs: 1000 },
    ]
    const markup = requestChart({ x: 0, y: 0, w: 120, h: 30 }, samples, 40)
    expect(markup.split('<rect').length - 1).toBe(2)
    const path = markup.split('d="')[1]?.split('"')[0] ?? ''
    expect(path.split('L').length - 1).toBe(1)
  })

  test('限额窗口已过的比例由重置时刻倒推，超出范围的截到 0 与 1', async () => {
    const fiveHourMs = 5 * HOUR_MS
    const resetsIn2h = { percentUsed: 10, resetsAt: START + 2 * HOUR_MS }
    expect(windowElapsedRatio(resetsIn2h, START, fiveHourMs)?.toFixed(2)).toBe('0.60')
    expect(windowElapsedRatio({ ...resetsIn2h, resetsAt: null }, START, fiveHourMs))
      .toBe(null)
    const resetsIn6h = { percentUsed: 10, resetsAt: START + 6 * HOUR_MS }
    expect(windowElapsedRatio(resetsIn6h, START, fiveHourMs)).toBe(0)
  })

  test('时间条分段画，一段一格，最后一段可部分填', async () => {
    // 宽 84、5 段、段间 2：每段 15.2，第 3 段从 34.4 开始，填一半是 7.6。
    const bar = { x: 0, y: 0, w: 84, h: 6 }
    const markup = segmentedBar(bar, 5, 0.5, '#fff')
    expect(markup.split('fill="#2a2d31"').length - 1).toBe(5)
    expect(markup.split('fill="#fff"').length - 1).toBe(3)
    expect(markup).toContain('x="34.4" y="0" width="7.6"')
  })

  test('额度用得比时间快才提醒；到 100% 报错；比不了时间时按 80% 提醒', async () => {
    expect(paceTone(72, 0.59)).toBe('warning')
    expect(paceTone(10, 0.38)).toBe(undefined)
    expect(paceTone(100, 0.9)).toBe('error')
    expect(paceTone(85, null)).toBe('warning')
    expect(paceTone(50, null)).toBe(undefined)
  })

  test('扇形仪表：三段等角度，指针在段内按取值换算角度，所在段不透明', async () => {
    const zones = [
      { upTo: 0.7, color: '#f00' },
      { upTo: 0.9, color: '#ff0' },
      { upTo: 1, color: '#0f0' },
    ]
    // 方框 132×33：圆心 (66, 33)，横半径 63、竖半径 30，指针长 0.8 倍半径。
    const area = { x: 0, y: 0, w: 132, h: 33 }
    // 0.8 在黄段正中，正好朝上；1 朝正右；0 朝正左。
    const yellow = zoneGauge(area, 0.8, zones)
    expect(yellow).toContain('x1="66" y1="33" x2="66" y2="9"')
    expect(yellow.split('opacity="1"').length - 1).toBe(1)
    expect(yellow.split('opacity="0.35"').length - 1).toBe(2)
    expect(yellow).toContain('stroke="#ff0" stroke-width="6" opacity="1"')
    expect(zoneGauge(area, 1, zones)).toContain('x2="116.4" y2="33"')
    expect(zoneGauge(area, 0, zones)).toContain('x2="15.6" y2="33"')
    // 分界写在弧外侧；没有读数时不画指针，三段都调暗。
    const empty = zoneGauge(area, null, zones)
    expect(empty).toContain('>70%<')
    expect(empty).toContain('>90%<')
    expect(empty).not.toContain('<line')
    expect(empty.split('opacity="0.35"').length - 1).toBe(3)
  })

  test('横条超过 100% 按满格画', async () => {
    const markup = gaugeBar({ x: 0, y: 0, w: 100, h: 6 }, 1.5, '#fff')
    expect(markup.split('width="100"').length - 1).toBe(2)
  })

  test('文字里的标记字符被转义', async () => {
    expect(escapeXml('a<b>&"c"')).toBe('a&lt;b&gt;&amp;&quot;c&quot;')
  })

  test('轮播每 20 秒换一页，两页轮流', async () => {
    expect(carouselPage(0)).toBe(0)
    expect(carouselPage(19_999)).toBe(0)
    expect(carouselPage(20_000)).toBe(1)
    expect(carouselPage(40_000)).toBe(0)
  })

  test('数据最满时面板仍远小于 Svg 的长度上限', async () => {
    const stats = {
      ...EMPTY_STATS,
      recentRequests: Array.from({ length: 40 }, (_, index) => ({
        speed: 50 + index, ttftMs: 1000 + index,
      })),
      costPoints: Array.from({ length: 120 }, (_, index) => ({
        at: index, usd: index,
      })),
    }
    const bigGrid: ContextGrid = {
      usedCategories: ['a'],
      usedTokens: 900_000, windowTokens: 1_000_000, percent: 90,
      dots: Array.from({ length: 10 }, () =>
        Array.from({ length: 20 }, () => ({
          kind: 'used' as const, categoryIndex: 0, fullness: 1,
        })),
      ),
    }
    const readings = {
      ...EMPTY_READINGS,
      now: START, sessionStartedAt: 0, costUsd: 9.99,
      fiveHour: { percentUsed: 50, resetsAt: START + HOUR_MS },
      sevenDay: { percentUsed: 10, resetsAt: START + 24 * HOUR_MS },
    }
    const source = buildPanelSvg({ stats, readings, grid: bigGrid, isWorking: true })
    expect(source).toContain(`viewBox="0 0 ${PANEL_WIDTH} ${PANEL_HEIGHT}"`)
    expect(source.length).toBeLessThan(131_072 / 2)
  })
})
