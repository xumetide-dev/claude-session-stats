import { describe, expect, test } from 'claude-code/testing'

import { EMPTY_READINGS } from '../hooks/readings'
import {
  newerLimit,
  parseSharedLimits,
  toSharedLimits,
} from '../hooks/shared-limits'
import {
  HOUR_MS,
  SHARED_LIMITS_PATH,
  START,
  answerEngine,
  bandText,
} from './fixtures'

// 限额跨会话共享：各窗口取所有会话里最新的读数，本会话更新时写回共享文件。

const RESETS_AT = START + 2 * HOUR_MS
const limit = (percentUsed: number, resetsAt: number | null = RESETS_AT) => ({
  percentUsed, resetsAt,
})

describe('取较新的读数', () => {
  test('一边没有或已过重置时刻时取另一边', async () => {
    expect(newerLimit(limit(15), null, START)).toEqual(limit(15))
    expect(newerLimit(null, limit(20), START)).toEqual(limit(20))
    // 共享的已重置：不用；本会话的已重置：换成共享的。
    expect(newerLimit(limit(15), limit(20, START - 1), START)).toEqual(limit(15))
    expect(newerLimit(limit(15, START - 1), limit(20), START)).toEqual(limit(20))
  })

  test('同一窗口内用量只增不减，用得多的较新；重置时刻的少许出入仍算同一窗口', async () => {
    expect(newerLimit(limit(15), limit(20), START)).toEqual(limit(20))
    expect(newerLimit(limit(30), limit(20), START)).toEqual(limit(30))
    const nearby = RESETS_AT + 5 * 60_000
    expect(newerLimit(limit(15), limit(20, nearby), START)).toEqual(limit(20, nearby))
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

describe('共享文件的内容', () => {
  test('只写带重置时刻、尚未重置的读数', async () => {
    const readings = {
      ...EMPTY_READINGS, now: START,
      fiveHour: limit(15, null), sevenDay: limit(40, START - 1),
    }
    expect(toSharedLimits(readings)).toEqual({ fiveHour: null, sevenDay: null })
    expect(toSharedLimits({ ...readings, fiveHour: limit(15) }).fiveHour).toEqual(
      limit(15),
    )
  })

  test('内容不是预期的形状时不用；形状不对的单个窗口当作没有', async () => {
    expect(parseSharedLimits('{"fiveHour":')).toBeNull()
    expect(parseSharedLimits('42')).toBeNull()
    const parsed = parseSharedLimits(
      JSON.stringify({ fiveHour: limit(20), sevenDay: { percentUsed: '7' } }),
    )
    expect(parsed).toEqual({ fiveHour: limit(20), sevenDay: null })
  })
})

const fiveHourLimit = (percentUsed: number) => ({
  kind: 'five_hour', percentUsed, resetsAt: new Date(RESETS_AT).toISOString(),
})

test('另一个会话的读数较新时，状态栏显示共享文件里的读数', async ($, on) => {
  const { clock, engine, files } = answerEngine(on)
  engine.rateLimits = [fiveHourLimit(15)]
  files.set(SHARED_LIMITS_PATH, JSON.stringify({ fiveHour: limit(20), sevenDay: null }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1000)

  expect(await bandText($, 'desktop')).toContain('5小时 20%')
})

test('本会话的读数较新时写回共享文件', async ($, on) => {
  const { clock, engine, files } = answerEngine(on)
  engine.rateLimits = [fiveHourLimit(30)]
  files.set(SHARED_LIMITS_PATH, JSON.stringify({ fiveHour: limit(20), sevenDay: null }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1000)

  expect(await bandText($, 'desktop')).toContain('5小时 30%')
  const written = parseSharedLimits(files.get(SHARED_LIMITS_PATH) ?? '')
  expect(written).toEqual({ fiveHour: limit(30), sevenDay: null })
})

test('哪个会话都没有限额读数时不写共享文件', async ($, on) => {
  const { clock, files } = answerEngine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1000)

  expect(files.has(SHARED_LIMITS_PATH)).toBe(false)
})
