import { describe, expect, test } from 'claude-code/testing'

import { EMPTY_READINGS } from '../hooks/readings'
import {
  SHARED_LIMITS_FILE,
  newerLimit,
  parseSharedLimits,
  stampOwnLimits,
  toSharedLimits,
} from '../hooks/shared-limits'
import type { EngineReadings, RateLimitReading } from '../types'
import {
  HOUR_MS,
  SHARED_LIMITS_PATH,
  START,
  TEST_HOME,
  answerEngine,
  bandText,
} from './fixtures'

// 限额跨会话共享：各窗口取所有会话里最新的读数，本会话更新时写回共享文件。

const RESETS_AT = START + 2 * HOUR_MS
const limit = (percentUsed: number, resetsAt: number | null = RESETS_AT) => ({
  percentUsed, resetsAt,
})
// 带观测时刻的读数：共享文件里每个窗口都是这个形状，0 表示不知道。
const stamped = (
  percentUsed: number,
  observedAt: number,
  resetsAt: number | null = RESETS_AT,
) => ({ percentUsed, resetsAt, observedAt })

describe('取较新的读数', () => {
  test('一边没有或已过重置时刻时取另一边', async () => {
    expect(newerLimit(limit(15), null, START)).toEqual(limit(15))
    expect(newerLimit(null, limit(20), START)).toEqual(limit(20))
    // 共享的已重置：不用；本会话的已重置：换成共享的。
    expect(newerLimit(limit(15), limit(20, START - 1), START)).toEqual(limit(15))
    expect(newerLimit(limit(15, START - 1), limit(20), START)).toEqual(limit(20))
  })

  test('观测时刻相同或都不知道时，同一窗口内用得多的较新；重置时刻的少许出入仍算同一窗口', async () => {
    expect(newerLimit(limit(15), limit(20), START)).toEqual(limit(20))
    expect(newerLimit(limit(30), limit(20), START)).toEqual(limit(30))
    const nearby = RESETS_AT + 5 * 60_000
    expect(newerLimit(limit(15), limit(20, nearby), START)).toEqual(limit(20, nearby))
    expect(newerLimit(stamped(15, 100), stamped(20, 100), START)).toEqual(stamped(20, 100))
  })

  test('同一窗口内观测时刻晚的较新，即使用量更少（升级套餐后用量会回落）', async () => {
    expect(newerLimit(stamped(3, 200), stamped(100, 100), START)).toEqual(stamped(3, 200))
    expect(newerLimit(stamped(100, 100), stamped(3, 200), START)).toEqual(stamped(3, 200))
  })

  test('本会话读数的观测时刻不知道（0）时，不压过有观测时刻的共享读数', async () => {
    expect(newerLimit(stamped(100, 0), stamped(3, 100), START)).toEqual(stamped(3, 100))
    expect(newerLimit(limit(100), stamped(3, 100), START)).toEqual(stamped(3, 100))
  })

  test('不同窗口取重置时刻晚的那份，即使用量更少', async () => {
    const nextWindow = RESETS_AT + 5 * HOUR_MS
    expect(newerLimit(limit(90), limit(3, nextWindow), START)).toEqual(
      limit(3, nextWindow),
    )
    expect(newerLimit(limit(3, nextWindow), limit(90), START)).toEqual(
      limit(3, nextWindow),
    )
  })

  test('本会话的读数没有重置时刻时按用量比较', async () => {
    expect(newerLimit(limit(15, null), limit(20), START)).toEqual(limit(20))
    expect(newerLimit(limit(25, null), limit(20), START)).toEqual(limit(25, null))
  })
})

describe('本会话读数的观测时刻', () => {
  const readingsOf = (now: number, fiveHour: RateLimitReading | null): EngineReadings => ({
    ...EMPTY_READINGS, now, fiveHour,
  })

  test('刚加载（没有上次的记录）时不知道读数何时读到，标 0', async () => {
    const stampedOwn = stampOwnLimits(null, readingsOf(START, limit(15)))
    expect(stampedOwn.fiveHour).toEqual(stamped(15, 0))
    expect(stampedOwn.sevenDay).toBeNull()
  })

  test('读数没变时沿用上次的观测时刻；用量或重置时刻变了就取现在', async () => {
    const loaded = stampOwnLimits(null, readingsOf(START, limit(15)))
    const unchanged = stampOwnLimits(loaded, readingsOf(START + 1000, limit(15)))
    expect(unchanged.fiveHour).toEqual(stamped(15, 0))

    const usageChanged = stampOwnLimits(unchanged, readingsOf(START + 2000, limit(16)))
    expect(usageChanged.fiveHour).toEqual(stamped(16, START + 2000))
    const stillSame = stampOwnLimits(usageChanged, readingsOf(START + 5000, limit(16)))
    expect(stillSame.fiveHour).toEqual(stamped(16, START + 2000))

    const resetMoved = stampOwnLimits(
      stillSame, readingsOf(START + 6000, limit(16, RESETS_AT + 1000)),
    )
    expect(resetMoved.fiveHour).toEqual(stamped(16, START + 6000, RESETS_AT + 1000))
  })

  test('读数先没有后出现（第一次收到响应）时取现在；读数消失时为 null', async () => {
    const none = stampOwnLimits(null, readingsOf(START, null))
    expect(none.fiveHour).toBeNull()
    const appeared = stampOwnLimits(none, readingsOf(START + 1000, limit(15)))
    expect(appeared.fiveHour).toEqual(stamped(15, START + 1000))
    expect(stampOwnLimits(appeared, readingsOf(START + 2000, null)).fiveHour).toBeNull()
  })
})

describe('共享文件的内容', () => {
  test('只写带重置时刻、尚未重置的读数，并带观测时刻（不知道时写 0）', async () => {
    const readings = {
      ...EMPTY_READINGS, now: START,
      fiveHour: limit(15, null), sevenDay: limit(40, START - 1),
    }
    expect(toSharedLimits(readings)).toEqual({ fiveHour: null, sevenDay: null })
    expect(toSharedLimits({ ...readings, fiveHour: limit(15) }).fiveHour).toEqual(
      stamped(15, 0),
    )
    expect(
      toSharedLimits({ ...readings, fiveHour: stamped(15, 500) }).fiveHour,
    ).toEqual(stamped(15, 500))
  })

  test('内容不是预期的形状时不用；形状不对的单个窗口当作没有', async () => {
    expect(parseSharedLimits('{"fiveHour":')).toBeNull()
    expect(parseSharedLimits('42')).toBeNull()
    const parsed = parseSharedLimits(
      JSON.stringify({ fiveHour: stamped(20, 7), sevenDay: { percentUsed: '7' } }),
    )
    expect(parsed).toEqual({ fiveHour: stamped(20, 7), sevenDay: null })
  })

  test('旧版写的窗口没有观测时刻，当作没有', async () => {
    const parsed = parseSharedLimits(
      JSON.stringify({ fiveHour: limit(20), sevenDay: limit(100) }),
    )
    expect(parsed).toEqual({ fiveHour: null, sevenDay: null })
  })
})

const engineLimit = (kind: 'five_hour' | 'seven_day', percentUsed: number) => ({
  kind, percentUsed, resetsAt: new Date(RESETS_AT).toISOString(),
})
const fiveHourLimit = (percentUsed: number) => engineLimit('five_hour', percentUsed)
const sevenDayLimit = (percentUsed: number) => engineLimit('seven_day', percentUsed)
const sharedFileOf = (limits: { fiveHour?: object | null; sevenDay?: object | null }) =>
  JSON.stringify({ fiveHour: null, sevenDay: null, ...limits })

test('另一个会话的读数较新时，状态栏显示共享文件里的读数', async ($, on) => {
  const { clock, engine, files } = answerEngine(on)
  engine.rateLimits = [fiveHourLimit(15)]
  files.set(SHARED_LIMITS_PATH, sharedFileOf({ fiveHour: stamped(20, START - 1000) }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1000)

  expect(await bandText($, 'desktop')).toContain('5小时 20%')
})

test('本会话的读数较新时写回共享文件', async ($, on) => {
  const { clock, engine, files } = answerEngine(on)
  engine.rateLimits = [fiveHourLimit(15)]
  files.set(SHARED_LIMITS_PATH, sharedFileOf({ fiveHour: stamped(20, START - 1000) }))

  // 加载时本会话的读数不知道何时读到，让位给共享文件；之后读数变了（收到响应）才较新。
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  engine.rateLimits = [fiveHourLimit(30)]
  await clock.advance(1000)

  expect(await bandText($, 'desktop')).toContain('5小时 30%')
  const written = parseSharedLimits(files.get(SHARED_LIMITS_PATH) ?? '')
  expect(written).toEqual({ fiveHour: stamped(30, START + 1000), sevenDay: null })
})

test('升级套餐后用量回落：本会话读到更低的新读数时，压过共享文件里升级前的读数', async ($, on) => {
  const { clock, engine, files } = answerEngine(on)
  engine.rateLimits = [sevenDayLimit(100)]
  files.set(SHARED_LIMITS_PATH, sharedFileOf({ sevenDay: stamped(100, START - 1000) }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1000)
  expect(await bandText($, 'desktop')).toContain('7天 100%')

  engine.rateLimits = [sevenDayLimit(3)]
  await clock.advance(1000)

  expect(await bandText($, 'desktop')).toContain('7天 3%')
  const written = parseSharedLimits(files.get(SHARED_LIMITS_PATH) ?? '')
  expect(written).toEqual({ fiveHour: null, sevenDay: stamped(3, START + 2000) })
})

test('另一个会话已读到升级后的新读数时，本会话停着的旧读数不压过它，也不改写文件', async ($, on) => {
  const { clock, engine, files } = answerEngine(on)
  engine.rateLimits = [sevenDayLimit(100)]
  const shared = sharedFileOf({ sevenDay: stamped(3, START - 1000) })
  files.set(SHARED_LIMITS_PATH, shared)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1000)

  expect(await bandText($, 'desktop')).toContain('7天 3%')
  expect(files.get(SHARED_LIMITS_PATH)).toBe(shared)
})

test('旧版写的共享文件（没有观测时刻）不用，免得升级前的读数压住新读数', async ($, on) => {
  const { clock, engine, files } = answerEngine(on)
  engine.rateLimits = [sevenDayLimit(3)]
  files.set(SHARED_LIMITS_PATH, sharedFileOf({ sevenDay: limit(100) }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1000)

  expect(await bandText($, 'desktop')).toContain('7天 3%')
  const written = parseSharedLimits(files.get(SHARED_LIMITS_PATH) ?? '')
  expect(written).toEqual({ fiveHour: null, sevenDay: stamped(3, 0) })
})

test('哪个会话都没有限额读数时不写共享文件', async ($, on) => {
  const { clock, files } = answerEngine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1000)

  expect(files.has(SHARED_LIMITS_PATH)).toBe(false)
})

test('本会话没有限额读数（API key 计费）时不借用共享文件，也不改写它', async ($, on) => {
  const { clock, files } = answerEngine(on)
  const shared = JSON.stringify({ fiveHour: limit(20), sevenDay: null })
  files.set(SHARED_LIMITS_PATH, shared)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1000)

  expect(await bandText($, 'terminal')).not.toContain('5小时')
  expect(files.get(SHARED_LIMITS_PATH)).toBe(shared)
})

test('读到半份共享文件时不回写，连续 3 秒读不出来才用本会话的读数覆盖', async ($, on) => {
  const { clock, engine, files } = answerEngine(on)
  engine.rateLimits = [fiveHourLimit(30)]
  const partial = '{"fiveHour":'
  files.set(SHARED_LIMITS_PATH, partial)

  // 会话开始时读一次，之后每秒一次：第 1、2 次读不出来都不写。
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1000)
  expect(files.get(SHARED_LIMITS_PATH)).toBe(partial)

  await clock.advance(1000)
  const written = parseSharedLimits(files.get(SHARED_LIMITS_PATH) ?? '')
  expect(written).toEqual({ fiveHour: stamped(30, 0), sevenDay: null })
})

test('设了 CLAUDE_CONFIG_DIR 时共享文件放在它下面', async ($, on) => {
  const env = { HOME: TEST_HOME, CLAUDE_CONFIG_DIR: '/config/work' }
  const { clock, engine, files } = answerEngine(on, {}, env)
  engine.rateLimits = [fiveHourLimit(30)]

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1000)

  expect(files.has(`/config/work/${SHARED_LIMITS_FILE}`)).toBe(true)
  expect(files.has(SHARED_LIMITS_PATH)).toBe(false)
})
