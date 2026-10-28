import type { EngineReadings, SessionStats } from '../types'
import { NO_READING, averageTtft, cacheHitRate, outputSpeed } from './format'
import type { Row, Segment } from './format'

// 桌面端面板收起后的一行摘要。与状态栏第一行是同样几项，但数值精度更低、大数用
// 美制单位（K/M/B），每项长度大致固定，窄窗口里也放得下一行。展开的面板与终端
// 仍用 format.ts 的写法（万、亿）。

const US_UNITS = [
  { size: 1_000_000_000, suffix: 'B' },
  { size: 1_000_000, suffix: 'M' },
  { size: 1_000, suffix: 'K' },
] as const
const MS_PER_SECOND = 1000
// TTFT 不到 10 秒时保留一位小数，10 秒以上写整秒。
const TTFT_DECIMAL_LIMIT_MS = 10_000
// 花费不到 100 美元写到分，不到 1 万美元写整数，再往上用 K。
const USD_CENTS_LIMIT = 100
const USD_WHOLE_LIMIT = 10_000

export function toSummaryRow(stats: SessionStats, readings: EngineReadings): Row {
  const hitRate = cacheHitRate(stats)
  const speed = outputSpeed(stats)
  const ttft = averageTtft(stats)
  const { costUsd } = readings
  const segments: (Segment | null)[] = [
    { label: '压缩', value: String(stats.compactions) },
    { label: '会话', value: formatUsCount(stats.totalTokens) },
    {
      label: '总缓存',
      value: hitRate === null ? NO_READING : `${Math.round(hitRate * 100)}%`,
    },
    { label: '速度', value: speed === null ? NO_READING : `${Math.round(speed)} tok/s` },
    { label: 'TTFT', value: ttft === null ? NO_READING : formatSeconds(ttft) },
    costUsd === null ? null : { label: '花费', value: formatUsd(costUsd) },
  ]

  return segments.filter((segment): segment is Segment => segment !== null)
}

/** 美制单位写大数：950、1.25K、30.1M、2.4B。保留三位有效数字，一律向下取整。 */
export function formatUsCount(count: number): string {
  const unit = US_UNITS.find(candidate => count >= candidate.size)
  if (unit === undefined) {
    return String(Math.floor(count))
  }

  return `${threeSignificantDigits(count, unit.size)}${unit.suffix}`
}

/** $46.83、$468、$12.3K。 */
export function formatUsd(usd: number): string {
  if (usd < USD_CENTS_LIMIT) {
    return `$${usd.toFixed(2)}`
  }
  if (usd < USD_WHOLE_LIMIT) {
    return `$${Math.floor(usd)}`
  }

  return `$${formatUsCount(Math.floor(usd))}`
}

/** 5.4s、12s。 */
function formatSeconds(ms: number): string {
  const seconds = ms / MS_PER_SECOND

  return ms < TTFT_DECIMAL_LIMIT_MS
    ? `${seconds.toFixed(1)}s`
    : `${Math.round(seconds)}s`
}

/**
 * count 以 unitSize 为单位、向下取整到三位有效数字：1130 → 1.13，30_140_000 → 30.1。
 * 按整数步长取整，避免 1.13 * 100 这类浮点误差把末位算小；末尾的 0 不写。
 */
function threeSignificantDigits(count: number, unitSize: number): string {
  const whole = Math.floor(count / unitSize)
  const decimals = whole < 10 ? 2 : whole < 100 ? 1 : 0
  const scale = 10 ** decimals
  const step = unitSize / scale

  return String(Math.floor(count / step) / scale)
}
