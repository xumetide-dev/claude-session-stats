import { describe, expect, test } from 'claude-code/testing'

import {
  IDLE_LIMIT,
  currentLimits,
  rowsToText,
  sessionDurationMs,
  toRows,
} from '../hooks/format'
import { requestChart } from '../hooks/panel/charts'
import { buildPanelSvg } from '../hooks/panel/panel'
import { fitFontSize, textEm } from '../hooks/panel/primitives'
import { EMPTY_READINGS } from '../hooks/readings'
import { EMPTY_STATS } from '../hooks/stats'
import { HOUR_MS, START } from './fixtures'

// 空值、0 值与极端值：读数缺失或为 0 时组件照样画出来，算式不除以 0，大数不出格。

describe('会话时长', () => {
  const readings = {
    ...EMPTY_READINGS, now: START + 10 * HOUR_MS, sessionStartedAt: START,
  }

  test('空闲时停在主对话最后一轮结束的时刻，不随当前时间增长', async () => {
    const stats = { ...EMPTY_STATS, lastTurnEndedAt: START + 90_000 }
    expect(sessionDurationMs(stats, readings)).toBe(90_000)
  })

  test('主对话正在跑一轮时算到现在', async () => {
    const stats = {
      ...EMPTY_STATS,
      lastTurnEndedAt: START + 90_000,
      mainTurnStartedAt: START + 5 * HOUR_MS,
    }
    expect(sessionDurationMs(stats, readings)).toBe(10 * HOUR_MS)
  })

  test('还没有结束过一轮、或不知道会话开始时间时为 null，终端写占位符', async () => {
    expect(sessionDurationMs(EMPTY_STATS, readings)).toBeNull()
    const ended = { ...EMPTY_STATS, lastTurnEndedAt: START }
    expect(sessionDurationMs(ended, { ...readings, sessionStartedAt: null })).toBeNull()
    expect(rowsToText(toRows(EMPTY_STATS, readings)).split('\n')[1]).toStartWith('时长 —')
  })

  test('结束时刻早于开始时刻时按 0 计', async () => {
    const stats = { ...EMPTY_STATS, lastTurnEndedAt: START - 1000 }
    expect(sessionDurationMs(stats, readings)).toBe(0)
  })
})

describe('限额窗口', () => {
  test('两个窗口都没有读数时都为 null，整行不出现', async () => {
    const readings = { ...EMPTY_READINGS, now: START }
    expect(currentLimits(readings)).toEqual({ fiveHour: null, sevenDay: null })
  })

  test('只有 7 天的读数时，5 小时按未开始计时的 0% 显示', async () => {
    const readings = {
      ...EMPTY_READINGS,
      now: START,
      sevenDay: { percentUsed: 40, resetsAt: START + HOUR_MS },
    }
    expect(currentLimits(readings).fiveHour).toEqual(IDLE_LIMIT)
    const text = rowsToText(toRows(EMPTY_STATS, readings))
    expect(text).toContain('5小时 0% │ 7天 40% · 1时0分后重置')
  })

  test('过了重置时刻的读数作废，按 0% 显示', async () => {
    const readings = {
      ...EMPTY_READINGS,
      now: START,
      fiveHour: { percentUsed: 96, resetsAt: START },
      sevenDay: { percentUsed: 40, resetsAt: START + HOUR_MS },
    }
    expect(currentLimits(readings).fiveHour).toEqual(IDLE_LIMIT)
  })
})

describe('图形的 0 值与极端值', () => {
  test('速度与 TTFT 全为 0 时小图不画柱子与曲线，也不除以 0', async () => {
    const samples = [{ speed: 0, ttftMs: 0 }, { speed: 0, ttftMs: 0 }]
    const markup = requestChart({ x: 0, y: 0, w: 120, h: 30 }, samples, 24)
    expect(markup).not.toContain('NaN')
    expect(markup).not.toContain('Infinity')
    expect(markup).not.toContain('<rect')
  })

  test('放不下的长数值缩小字号，最小 6', async () => {
    expect(fitFontSize('12', 100, 22)).toBe(22)
    const size = fitFontSize('123456789', 60, 22)
    expect(size).toBeLessThan(22)
    expect(textEm('123456789') * size).toBeLessThanOrEqual(60)
    expect(fitFontSize('123456789', 0, 22)).toBe(6)
  })

  test('全空的读数与极大的读数都画得出面板，没有 NaN 与 undefined', async () => {
    const empty = buildPanelSvg({
      stats: EMPTY_STATS, readings: EMPTY_READINGS, grid: null, isWorking: false,
    })
    const huge = buildPanelSvg({
      stats: {
        ...EMPTY_STATS,
        totalTokens: 9_876_543_210_123,
        workMs: 345 * HOUR_MS,
        lastTurnEndedAt: START + 345 * HOUR_MS,
        toolCalls: 123_456,
        toolMs: 999 * HOUR_MS,
        agentTokens: 8_765_432_109,
        agentToolCalls: 98_765,
        agentWorkMs: 888 * HOUR_MS,
        decodedTokens: 50_000_000,
        decodeMs: 10_000,
        firstTokenWaitMs: 999 * HOUR_MS,
        firstTokenCount: 1,
        recentRequests: [{ speed: 5000, ttftMs: 999 * HOUR_MS }],
        costPoints: [{ at: START, usd: 0 }, { at: START + 1, usd: 123_456.78 }],
      },
      readings: {
        ...EMPTY_READINGS,
        now: START + 346 * HOUR_MS,
        sessionStartedAt: START,
        costUsd: 123_456.78,
        promptCount: 123_456,
        runningAgents: 1234,
        fiveHour: { percentUsed: 250, resetsAt: START + 347 * HOUR_MS },
        sevenDay: { percentUsed: 0, resetsAt: null },
      },
      grid: null,
      isWorking: false,
    })
    for (const source of [empty, huge]) {
      expect(source).not.toContain('NaN')
      expect(source).not.toContain('Infinity')
      expect(source).not.toContain('undefined')
    }
    // 会话停在最后一轮结束时：345 小时，不是此刻的 346 小时。
    expect(huge).toContain('>345<')
  })
})
