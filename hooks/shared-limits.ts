import type { EngineInterface } from 'claude-code'

import type { EngineReadings, OwnLimits, RateLimitReading } from '../types'

// 5 小时与 7 天限额是账号级的，引擎给的却是本会话最近一次响应带回的读数：闲置的会话
// 一直停在它最后一次请求时的数。各会话经一个共享文件交换读数，每个窗口显示所有会话
// 里最新的一份。
//
// 用 $.fs 读写固定路径的文件，不用 $.store：后者没有说明一个进程写入后另一个进程
// 能否立即读到；文件每次读到的都是磁盘上的当前内容。
//
// 文件不记账号（插件读不到会话登录的是哪个账号），隔离靠两条：文件放在 Claude Code
// 的配置目录下，用 CLAUDE_CONFIG_DIR 分开登录的各个账号各有一份；本会话自己没有
// 限额读数时（API key 计费，或还没收到过响应）不借用文件里的。
//
// 同一窗口内谁新谁旧，看读数是什么时候读到的（observedAt），不看用量大小。用量在
// 窗口内通常只增不减，但升级套餐后额度变大，已用比例会掉下来而重置时刻不变；
// 若仍取用得多的那份，升级前的旧读数会永远压住新读数。本会话读数的观测时刻由
// stampOwnLimits 记下：引擎只在收到响应时才给出新读数，所以读数变了就是此刻读到的。

/** 共享文件的内容：两个窗口各自最新的读数，没有时为 null。 */
export type SharedLimits = {
  fiveHour: RateLimitReading | null
  sevenDay: RateLimitReading | null
}

/**
 * 读共享文件的结果。absent：文件还不存在，或找不到配置目录；unreadable：内容解析
 * 不了，多半是另一个会话正写到一半。
 */
export type SharedLimitsFile =
  | { kind: 'absent' }
  | { kind: 'unreadable' }
  | { kind: 'read'; limits: SharedLimits }

/** 共享文件相对配置目录的路径。 */
export const SHARED_LIMITS_FILE = 'session-stats/rate-limits.json'

const NO_SHARED_LIMITS: SharedLimits = { fiveHour: null, sevenDay: null }
const ABSENT: SharedLimitsFile = { kind: 'absent' }
const UNREADABLE: SharedLimitsFile = { kind: 'unreadable' }

// 两份读数的重置时刻相差超过这么多，算作不同的窗口。新窗口在旧窗口重置之后才开始，
// 重置时刻至少晚一个窗口长度（5 小时）；同一窗口内各次响应报的重置时刻可能有出入。
const SAME_WINDOW_TOLERANCE_MS = 10 * 60_000

// $.fs 没有改名操作，写文件不是原子的，读到半份文件是正常的，下一秒再读即可；
// 连续这么多秒都读不出来才当作文件坏了，用本会话的读数覆盖。
const UNREADABLE_SECONDS_BEFORE_OVERWRITE = 3

// 写共享文件失败时只记一次调试日志：每秒都会重试，同一原因会反复出现。
let hasLoggedWriteFailure = false
// 连续读不出共享文件的次数（每秒一次）。
let unreadableStreak = 0

/**
 * 一个窗口取本会话与共享文件中较新的读数。已过重置时刻的读数不参与；共享的读数
 * 一定带重置时刻（没有重置时刻的无法判断属于哪个窗口，不写进共享文件）。
 * 不同窗口取重置时刻晚的那份；同一窗口内取观测时刻晚的那份（升级套餐后用量会
 * 回落，不能再按用量大小比）。观测时刻相同或都不知道（0）时没有依据，退回
 * 用量的比较：窗口内用量通常只增不减，用得多的那份较新。
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
  const ownObservedAt = own.observedAt ?? 0
  const sharedObservedAt = shared.observedAt ?? 0
  if (ownObservedAt !== sharedObservedAt) {
    return ownObservedAt > sharedObservedAt ? own : shared
  }

  return shared.percentUsed > own.percentUsed ? shared : own
}

/**
 * 给本会话的限额读数标上观测时刻。previous 是上一次标过的结果：读数与上次相同就
 * 沿用上次的时刻；变了说明刚收到响应，时刻取 now。previous 为 null（mod 刚加载）
 * 时读数是什么时候读到的不知道，标 0：不冒充"刚读到"，免得闲置会话里的旧读数
 * 压过其他会话的新读数。
 */
export function stampOwnLimits(
  previous: OwnLimits | null,
  own: EngineReadings,
): OwnLimits {
  const stamp = (
    before: RateLimitReading | null,
    current: RateLimitReading | null,
  ): RateLimitReading | null => {
    if (current === null) {
      return null
    }
    if (previous === null) {
      return { ...current, observedAt: 0 }
    }
    if (before !== null && isSameReading(before, current)) {
      return { ...current, observedAt: before.observedAt ?? 0 }
    }

    return { ...current, observedAt: own.now }
  }

  return {
    fiveHour: stamp(previous?.fiveHour ?? null, own.fiveHour),
    sevenDay: stamp(previous?.sevenDay ?? null, own.sevenDay),
  }
}

/** 两份读数的用量与重置时刻都相同；观测时刻不参与比较。 */
function isSameReading(a: RateLimitReading, b: RateLimitReading): boolean {
  return a.percentUsed === b.percentUsed && a.resetsAt === b.resetsAt
}

/** 本会话有没有自己的限额读数：引擎报过任一窗口即算，过没过重置时刻都算。 */
export function hasOwnLimits(own: EngineReadings): boolean {
  return own.fiveHour !== null || own.sevenDay !== null
}

/**
 * 本会话的读数换上两个窗口各自较新的限额，其余不变。本会话自己没有限额读数时
 * 原样返回：文件不记账号，借来的可能是另一个账号的。
 */
export function mergeSharedLimits(
  own: EngineReadings,
  file: SharedLimitsFile,
): EngineReadings {
  if (file.kind !== 'read' || !hasOwnLimits(own)) {
    return own
  }
  const { fiveHour, sevenDay } = file.limits

  return {
    ...own,
    fiveHour: newerLimit(own.fiveHour, fiveHour, own.now),
    sevenDay: newerLimit(own.sevenDay, sevenDay, own.now),
  }
}

/**
 * 要写进共享文件的内容：只留带重置时刻、尚未重置的读数，并带上观测时刻
 * （不知道时写 0）。
 */
export function toSharedLimits(readings: EngineReadings): SharedLimits {
  const { now, fiveHour, sevenDay } = readings
  const sharable = (limit: RateLimitReading | null): RateLimitReading | null =>
    limit !== null && limit.resetsAt !== null && limit.resetsAt > now
      ? { ...limit, observedAt: limit.observedAt ?? 0 }
      : null

  return { fiveHour: sharable(fiveHour), sevenDay: sharable(sevenDay) }
}

/**
 * 解析共享文件；内容不是预期的形状时为 null，形状不对的单个窗口为 null。
 * 没有观测时刻的窗口是旧版写的，无从比新旧，也当作没有：否则升级套餐前留下的
 * 旧读数会一直压住新读数。
 */
export function parseSharedLimits(text: string): SharedLimits | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    // 另一个会话正在写，读到半份文件，或文件坏了：由调用方按读不出来处理。
    return null
  }
  if (typeof data !== 'object' || data === null) {
    return null
  }
  const record = data as Record<string, unknown>

  return { fiveHour: limitOf(record.fiveHour), sevenDay: limitOf(record.sevenDay) }
}

/** 读共享文件。找不到配置目录、文件还不存在或读不了时为 absent，照用本会话的读数。 */
export async function readSharedLimits($: EngineInterface): Promise<SharedLimitsFile> {
  let text: string
  try {
    const path = await sharedLimitsPath($)
    if (path === null) {
      return ABSENT
    }
    text = String(await $.fs.read(path))
  } catch {
    // 第一个会话写之前文件不存在，$.fs.read 会拒绝；这是常态，不记日志。
    return ABSENT
  }
  const limits = parseSharedLimits(text)

  return limits === null ? UNREADABLE : { kind: 'read', limits }
}

/**
 * 本会话的读数比共享文件新（或文件里有已重置的旧读数）时写回文件。没有可写的
 * 读数时不写，免得没有限额的会话把别人的读数清掉。读到半份文件时这一秒不写：
 * 那时并不知道文件里是什么，写回去的可能比它旧。
 * 不等写完：失败只记一次调试日志，下一秒再写。
 */
export function publishLimits(
  $: EngineInterface,
  merged: EngineReadings,
  file: SharedLimitsFile,
): void {
  unreadableStreak = file.kind === 'unreadable' ? unreadableStreak + 1 : 0
  const next = toSharedLimits(merged)
  const hasNothingToShare = next.fiveHour === null && next.sevenDay === null
  const isPartlyWritten =
    file.kind === 'unreadable' && unreadableStreak < UNREADABLE_SECONDS_BEFORE_OVERWRITE
  const current = file.kind === 'read' ? file.limits : NO_SHARED_LIMITS
  const isUnchanged =
    file.kind !== 'unreadable' && JSON.stringify(next) === JSON.stringify(current)
  if (hasNothingToShare || isPartlyWritten || isUnchanged) {
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

/**
 * 共享文件放在 Claude Code 的配置目录下：设了 CLAUDE_CONFIG_DIR 时是它（Claude Code
 * 只认绝对路径），否则是 HOME 下的 .claude。两者都没有时为 null，不共享。
 */
async function sharedLimitsPath($: EngineInterface): Promise<string | null> {
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  if (configDir !== undefined && isAbsolutePath(configDir)) {
    return `${configDir}/${SHARED_LIMITS_FILE}`
  }
  const home = await $.env.get('HOME')

  if (home === undefined || home === '') {
    return null
  }

  return `${home}/.claude/${SHARED_LIMITS_FILE}`
}

/** 绝对路径：以 / 开头，或 Windows 的盘符加分隔符（C:\ 或 C:/）。 */
function isAbsolutePath(path: string): boolean {
  const hasDrive = path.length >= 3 && path[1] === ':' && '\\/'.includes(path[2] ?? '')

  return path.startsWith('/') || hasDrive
}

/** 重置时刻还没到。没有重置时刻的读数无从判断，算作仍有效。 */
function isLive(limit: RateLimitReading, now: number): boolean {
  return limit.resetsAt === null || limit.resetsAt > now
}

function limitOf(value: unknown): RateLimitReading | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const { percentUsed, resetsAt, observedAt } = value as Record<string, unknown>
  const isShaped =
    typeof percentUsed === 'number' &&
    typeof resetsAt === 'number' &&
    typeof observedAt === 'number'
  if (!isShaped) {
    return null
  }

  return { percentUsed, resetsAt, observedAt }
}
