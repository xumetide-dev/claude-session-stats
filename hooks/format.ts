import type { EngineReadings, RateLimitReading, SessionStats } from '../types'

// 把统计与读数转成状态栏上的文字。只管显示，不改数据。

/** 状态栏的一段：标签、值，以及值需要的提醒色（限额接近或超过上限时）。 */
export type Segment = { label: string; value: string; tone?: 'warning' | 'error' }

/** 状态栏的一行：同一类指标放一行，行内放不下时自动换行。 */
export type Row = Segment[]

const TEN_THOUSAND = 10_000
const MILLION = 1_000_000
const HUNDRED_MILLION = 100_000_000
const MS_PER_SECOND = 1000
const MS_PER_MINUTE = 60_000
const MS_PER_HOUR = 3_600_000
const MS_PER_DAY = 86_400_000
const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3600
const LIMIT_WARNING_PERCENT = 80
const LIMIT_EXCEEDED_PERCENT = 100
/** 没有读数时显示的占位符。 */
export const NO_READING = '—'

/** 按中文习惯写大数：9999、1.2万、6325万、1.23亿。一律向下取整，不会进位成"10000万"。 */
export function formatCount(count: number): string {
  if (count < TEN_THOUSAND) {
    return String(count)
  }
  if (count < MILLION) {
    return `${Math.floor(count / 1000) / 10}万`
  }
  if (count < HUNDRED_MILLION) {
    return `${Math.floor(count / TEN_THOUSAND)}万`
  }

  return `${Math.floor(count / MILLION) / 100}亿`
}

/** 2时25分43秒、25分3秒、43秒。 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / MS_PER_SECOND)
  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR)
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)
  const seconds = totalSeconds % SECONDS_PER_MINUTE

  if (hours > 0) {
    return `${hours}时${minutes}分${seconds}秒`
  }
  if (minutes > 0) {
    return `${minutes}分${seconds}秒`
  }

  return `${seconds}秒`
}

/** 地方小时用的时长：满一小时不写秒。2时25分、25分3秒、43秒。 */
export function formatShortDuration(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / MS_PER_MINUTE)
  const hours = Math.floor(totalMinutes / 60)

  return hours > 0 ? `${hours}时${totalMinutes % 60}分` : formatDuration(ms)
}

/** 距重置还有多久，精确到分：6天3时、2时13分、13分、不到1分。 */
export function formatCountdown(ms: number): string {
  const days = Math.floor(ms / MS_PER_DAY)
  const hours = Math.floor((ms % MS_PER_DAY) / MS_PER_HOUR)
  const minutes = Math.floor((ms % MS_PER_HOUR) / MS_PER_MINUTE)

  if (days > 0) {
    return `${days}天${hours}时`
  }
  if (hours > 0) {
    return `${hours}时${minutes}分`
  }

  return minutes > 0 ? `${minutes}分` : '不到1分'
}

/** 缓存命中率，0 到 1；还没有任何输入 token 时为 null。 */
export function cacheHitRate(stats: SessionStats): number | null {
  return stats.promptTokens === 0 ? null : stats.cacheReadTokens / stats.promptTokens
}

/** 输出速度，token/秒；还没有计过时的请求时为 null。 */
export function outputSpeed(stats: SessionStats): number | null {
  return stats.decodeMs === 0
    ? null
    : stats.decodedTokens / (stats.decodeMs / MS_PER_SECOND)
}

/** 平均首 token 延迟，毫秒；还没有计过时的请求时为 null。 */
export function averageTtft(stats: SessionStats): number | null {
  return stats.firstTokenCount === 0
    ? null
    : stats.firstTokenWaitMs / stats.firstTokenCount
}

/** 主对话耗时：已结束各轮之和，加上进行中那一轮到现在为止的时长。 */
export function liveWorkMs(stats: SessionStats, now: number): number {
  const runningMs =
    stats.mainTurnStartedAt === null ? 0 : Math.max(0, now - stats.mainTurnStartedAt)

  return stats.workMs + runningMs
}

/**
 * 状态栏的各行：用量、时间与工具、限额、子 agent。没有读数的段落不出现，
 * 整行都没有读数时（如 API key 计费没有限额）这一行也不出现。
 * 两段限额都带倒计时、最长，单独一行，常见宽度下各行都不必换行。
 */
export function toRows(stats: SessionStats, readings: EngineReadings): Row[] {
  const rows = [
    usageRow(stats, readings),
    timeRow(stats, readings),
    limitRow(readings),
    agentRow(stats, readings),
  ]

  return rows.filter(row => row.length > 0)
}

function usageRow(stats: SessionStats, readings: EngineReadings): Row {
  const hitRate = cacheHitRate(stats)
  const speed = outputSpeed(stats)
  const ttft = averageTtft(stats)
  const { costUsd } = readings
  // 速度从首个流式块计到流结束，TTFT 从发出请求计到首个流式块，都是近似值。
  const hitRateText = hitRate === null ? NO_READING : `${(hitRate * 100).toFixed(1)}%`
  const speedText = speed === null ? NO_READING : `≈${speed.toFixed(1)} tok/s`
  const ttftText = ttft === null ? NO_READING : `≈${(ttft / MS_PER_SECOND).toFixed(1)}s`
  const segments: (Segment | null)[] = [
    { label: '压缩', value: String(stats.compactions) },
    { label: '会话', value: formatCount(stats.totalTokens) },
    { label: '总缓存', value: hitRateText },
    { label: '速度', value: speedText },
    { label: 'TTFT', value: ttftText },
    costUsd === null ? null : { label: '花费', value: `$${costUsd.toFixed(2)}` },
  ]

  return withoutMissing(segments)
}

function timeRow(stats: SessionStats, readings: EngineReadings): Row {
  const { now, sessionStartedAt, promptCount } = readings
  const segments: (Segment | null)[] = [
    sessionStartedAt === null
      ? null
      : { label: '时长', value: formatDuration(now - sessionStartedAt) },
    { label: '耗时', value: formatDuration(liveWorkMs(stats, now)) },
    promptCount === null ? null : { label: 'Prompt', value: String(promptCount) },
    { label: '工具', value: `${stats.toolCalls}次 · ${formatDuration(stats.toolMs)}` },
  ]

  return withoutMissing(segments)
}

function limitRow(readings: EngineReadings): Row {
  const { now } = readings

  return withoutMissing([
    limitSegment('5小时', readings.fiveHour, now),
    limitSegment('7天', readings.sevenDay, now),
  ])
}

function agentRow(stats: SessionStats, readings: EngineReadings): Row {
  const agentTotals = [
    formatDuration(stats.agentWorkMs),
    `${formatCount(stats.agentTokens)} token`,
    `工具 ${stats.agentToolCalls}次`,
  ]
  const segments: (Segment | null)[] = [
    readings.runningAgents === null
      ? null
      : { label: '运行中子 agent', value: String(readings.runningAgents) },
    { label: '子 agent 合计', value: agentTotals.join(' · ') },
  ]

  return withoutMissing(segments)
}

/** 限额：已用百分比，有重置时刻时带上倒计时；用到 80% 提醒、到 100% 报错。 */
function limitSegment(
  label: string,
  limit: RateLimitReading | null,
  now: number,
): Segment | null {
  if (limit === null) {
    return null
  }

  const reset = resetText(limit, now)
  const percent = `${limit.percentUsed}%`
  const value = reset === null ? percent : `${percent} · ${reset}`
  const tone = limitTone(limit.percentUsed)

  return tone === undefined ? { label, value } : { label, value, tone }
}

/** 限额的提醒色：用到 80% 提醒、到 100% 报错，其余不加颜色。 */
export function limitTone(percentUsed: number): Segment['tone'] {
  if (percentUsed >= LIMIT_EXCEEDED_PERCENT) {
    return 'error'
  }
  if (percentUsed >= LIMIT_WARNING_PERCENT) {
    return 'warning'
  }

  return undefined
}

/**
 * "2时13分后重置"；没有重置时刻，或时刻已过（读数旧了，等下一次请求带回新读数）
 * 时为 null。
 */
export function resetText(limit: RateLimitReading, now: number): string | null {
  const { resetsAt } = limit
  if (resetsAt === null || resetsAt <= now) {
    return null
  }

  return `${formatCountdown(resetsAt - now)}后重置`
}

/** 各行的纯文字：段落用竖线隔开，一行一句。用作 Svg 的 alt。 */
export function rowsToText(rows: Row[]): string {
  return rows
    .map(row => row.map(segment => `${segment.label} ${segment.value}`).join(' │ '))
    .join('\n')
}

function withoutMissing(segments: (Segment | null)[]): Row {
  return segments.filter((segment): segment is Segment => segment !== null)
}
