import type { EngineInterface } from 'claude-code'

import type { EngineReadings, RateLimitReading } from '../types'

// 5 小时与 7 天限额是账号级的，引擎给的却是本会话最近一次响应带回的读数：闲置的会话
// 一直停在它最后一次请求时的数。各会话经一个共享文件交换读数，每个窗口显示所有会话
// 里最新的一份。
//
// 用 $.fs 读写固定路径的文件，不用 $.store：后者没有说明一个进程写入后另一个进程
// 能否立即读到；文件每次读到的都是磁盘上的当前内容。

/** 共享文件的内容：两个窗口各自最新的读数，没有时为 null。 */
export type SharedLimits = {
  fiveHour: RateLimitReading | null
  sevenDay: RateLimitReading | null
}

/** 共享文件相对 HOME 的路径。 */
export const SHARED_LIMITS_FILE = '.claude/session-stats/rate-limits.json'

const NO_SHARED_LIMITS: SharedLimits = { fiveHour: null, sevenDay: null }

// 两份读数的重置时刻相差超过这么多，算作不同的窗口。新窗口在旧窗口重置之后才开始，
// 重置时刻至少晚一个窗口长度（5 小时）；同一窗口内各次响应报的重置时刻可能有出入。
const SAME_WINDOW_TOLERANCE_MS = 10 * 60_000

// 写共享文件失败时只记一次调试日志：每秒都会重试，同一原因会反复出现。
let hasLoggedWriteFailure = false

/**
 * 一个窗口取本会话与共享文件中较新的读数。已过重置时刻的读数不参与；共享的读数
 * 一定带重置时刻（没有重置时刻的无法判断属于哪个窗口，不写进共享文件）。
 * 同一窗口内用量只增不减，用得多的那份较新；不同窗口取重置时刻晚的那份。
 */
export function newerLimit(
  own: RateLimitReading | null,
  shared: RateLimitReading | null,
  now: number,
): RateLimitReading | null {
  if (shared === null || !isLive(shared, now)) {
    return own
  }
  if (own === null || !isLive(own, now)) {
    return shared
  }
  if (own.resetsAt !== null && shared.resetsAt !== null) {
    const gap = own.resetsAt - shared.resetsAt
    if (Math.abs(gap) > SAME_WINDOW_TOLERANCE_MS) {
      return gap > 0 ? own : shared
    }
  }

  return shared.percentUsed > own.percentUsed ? shared : own
}

/** 本会话的读数换上两个窗口各自较新的限额，其余不变。 */
export function mergeSharedLimits(
  own: EngineReadings,
  shared: SharedLimits | null,
): EngineReadings {
  const { fiveHour, sevenDay } = shared ?? NO_SHARED_LIMITS

  return {
    ...own,
    fiveHour: newerLimit(own.fiveHour, fiveHour, own.now),
    sevenDay: newerLimit(own.sevenDay, sevenDay, own.now),
  }
}

/** 要写进共享文件的内容：只留带重置时刻、尚未重置的读数。 */
export function toSharedLimits(readings: EngineReadings): SharedLimits {
  const { now, fiveHour, sevenDay } = readings
  const sharable = (limit: RateLimitReading | null) =>
    limit !== null && limit.resetsAt !== null && limit.resetsAt > now ? limit : null

  return { fiveHour: sharable(fiveHour), sevenDay: sharable(sevenDay) }
}

/** 解析共享文件；内容不是预期的形状时为 null，形状不对的单个窗口为 null。 */
export function parseSharedLimits(text: string): SharedLimits | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    // 另一个会话正在写，读到半份文件：这一次当作没有共享读数，下一秒再读。
    return null
  }
  if (typeof data !== 'object' || data === null) {
    return null
  }
  const record = data as Record<string, unknown>

  return { fiveHour: limitOf(record.fiveHour), sevenDay: limitOf(record.sevenDay) }
}

/** 读共享文件。没有 HOME、文件还不存在或读不了时为 null，照用本会话的读数。 */
export async function readSharedLimits(
  $: EngineInterface,
): Promise<SharedLimits | null> {
  try {
    const path = await sharedLimitsPath($)

    return path === null ? null : parseSharedLimits(String(await $.fs.read(path)))
  } catch {
    // 第一个会话写之前文件不存在，$.fs.read 会拒绝；这是常态，不记日志。
    return null
  }
}

/**
 * 本会话的读数比共享文件新（或文件里有已重置的旧读数）时写回文件。
 * 不等写完：失败只记一次调试日志，下一秒再写。
 */
export function publishLimits(
  $: EngineInterface,
  merged: EngineReadings,
  shared: SharedLimits | null,
): void {
  const next = toSharedLimits(merged)
  if (JSON.stringify(next) === JSON.stringify(shared ?? NO_SHARED_LIMITS)) {
    return
  }
  writeSharedLimits($, next).catch((error: unknown) => {
    if (!hasLoggedWriteFailure) {
      hasLoggedWriteFailure = true
      $.ui.log(`session-stats: 写共享限额失败: ${String(error)}`, { to: 'debug' })
    }
  })
}

async function writeSharedLimits(
  $: EngineInterface,
  limits: SharedLimits,
): Promise<void> {
  const path = await sharedLimitsPath($)
  if (path !== null) {
    await $.fs.write(path, JSON.stringify(limits))
  }
}

async function sharedLimitsPath($: EngineInterface): Promise<string | null> {
  const home = await $.env.get('HOME')

  return home === undefined || home === '' ? null : `${home}/${SHARED_LIMITS_FILE}`
}

/** 重置时刻还没到。没有重置时刻的读数无从判断，算作仍有效。 */
function isLive(limit: RateLimitReading, now: number): boolean {
  return limit.resetsAt === null || limit.resetsAt > now
}

function limitOf(value: unknown): RateLimitReading | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const { percentUsed, resetsAt } = value as Record<string, unknown>
  if (typeof percentUsed !== 'number' || typeof resetsAt !== 'number') {
    return null
  }

  return { percentUsed, resetsAt }
}
