import type { EngineReadings, RateLimitReading } from '../../types'
import { NO_READING, limitTone, resetText } from '../format'
import type { Segment } from '../format'
import { CARD_PADDING, hLine } from './cards'
import { lineIcon } from './icons'
import type { LineIconName } from './icons'
import { COLORS, graphicColor, toneColor } from './palette'
import { caption, gaugeBar, labelValue, segmentedBar } from './primitives'
import type { Area, Column } from './primitives'

// 桌面端面板的限额卡片。额度与时间各画一根同刻度的条，比较两根条的长短就知道
// 额度是不是用得比时间快。

const BAR_HEIGHT = 5
// 左侧图标占的宽度，文字与条从它右边开始。
const ICON_COLUMN = 22
// 行首"额度"/"时间"两个小字占的宽度，条从它右边开始。
const ROW_LABEL_WIDTH = 25
const HOUR_MS = 3_600_000
const FIVE_HOUR_MS = 5 * HOUR_MS
const SEVEN_DAY_MS = 7 * 24 * HOUR_MS

/** 一个限额窗口在面板上的画法：图标、名称、窗口长度，以及时间条分几段。 */
type LimitWindow = {
  icon: LineIconName
  label: string
  limit: RateLimitReading | null
  windowMs: number
  segments: number
}

/**
 * 限额卡片：5 小时与 7 天两个窗口，上下各一块。每个窗口两根同刻度的条：额度条是已用比例，
 * 时间条是窗口已过的比例，分 5 段（每段一小时）或 7 段（每段一天）。
 * 分段只画在时间条上，"一格"只表示时间；额度条比时间条长，说明用得比时间
 * 走得快，额度条变橙。
 */
export function limitsCard(card: Area, readings: EngineReadings): string {
  const x = card.x + CARD_PADDING
  const { fiveHour, sevenDay, now } = readings
  if (fiveHour === null && sevenDay === null) {
    return (
      caption(x, card.y + 22, '限额', { size: 12, color: COLORS.text }) +
      caption(x, card.y + 42, '无限额读数', { size: 10.5 })
    )
  }

  const column = { x, w: card.w - 2 * CARD_PADDING }
  const fiveHourWindow = {
    icon: 'clock' as const, label: '5小时', limit: fiveHour,
    windowMs: FIVE_HOUR_MS, segments: 5,
  }
  const sevenDayWindow = {
    icon: 'calendar' as const, label: '7天', limit: sevenDay,
    windowMs: SEVEN_DAY_MS, segments: 7,
  }
  const middle = card.y + card.h / 2

  return (
    limitBlock(column, fiveHourWindow, card.y + 4, now) +
    hLine(x, x + column.w, middle) +
    limitBlock(column, sevenDayWindow, middle + 2, now)
  )
}

/** 一个窗口：左侧图标，右侧名称与百分比、额度条、时间条、重置倒计时。 */
function limitBlock(
  column: Column,
  window: LimitWindow,
  top: number,
  now: number,
): string {
  const { icon, label, limit, windowMs, segments } = window
  const x = column.x + ICON_COLUMN
  const w = column.w - ICON_COLUMN
  const y = top + 16
  if (limit === null) {
    return (
      lineIcon(icon, column.x + 7, y - 4, 15, COLORS.dim) +
      labelValue(x, y, label, '无读数', COLORS.dim)
    )
  }

  const elapsed = windowElapsedRatio(limit, now, windowMs)
  const tone = paceTone(limit.percentUsed, elapsed)
  const bar = { x: x + ROW_LABEL_WIDTH, w: w - ROW_LABEL_WIDTH, h: BAR_HEIGHT }
  const quotaBar = { ...bar, y: y + 9 }
  const timeBar = { ...bar, y: y + 21 }
  // 没有重置时刻就算不出窗口过了多少，时间条换成占位符。
  const timeGraphic =
    elapsed === null
      ? caption(timeBar.x, rowBaseline(timeBar), NO_READING, { size: 10 })
      : segmentedBar(timeBar, segments, elapsed, COLORS.dim)

  return (
    lineIcon(icon, column.x + 7, y - 4, 15, graphicColor(tone)) +
    labelValue(x, y, label, `${limit.percentUsed}%`, toneColor(tone)) +
    caption(x, rowBaseline(quotaBar), '额度', { size: 10 }) +
    gaugeBar(quotaBar, limit.percentUsed / 100, graphicColor(tone)) +
    caption(x, rowBaseline(timeBar), '时间', { size: 10 }) +
    timeGraphic +
    caption(x, y + 42, resetText(limit, now) ?? '', { size: 10 })
  )
}

/** 行首小字的基线：与右边的条垂直居中。 */
function rowBaseline(bar: { y: number; h: number }): number {
  return bar.y + bar.h / 2 + 3.5
}

/**
 * 限额在面板上的提醒色：到 100% 报错；额度用得比窗口时间走得快时提醒。
 * 没有重置时刻、比不了时间时，退回按百分比的规则（到 80% 提醒）。
 */
export function paceTone(
  percentUsed: number,
  elapsedRatio: number | null,
): Segment['tone'] {
  if (elapsedRatio === null) {
    return limitTone(percentUsed)
  }
  if (percentUsed >= 100) {
    return 'error'
  }

  return percentUsed / 100 > elapsedRatio ? 'warning' : undefined
}

/**
 * 窗口已过的比例：窗口在 resetsAt 结束、长 windowMs，开始于 resetsAt - windowMs。
 * 没有重置时刻时为 null。
 */
export function windowElapsedRatio(
  limit: RateLimitReading,
  now: number,
  windowMs: number,
): number | null {
  if (limit.resetsAt === null) {
    return null
  }

  const elapsed = 1 - (limit.resetsAt - now) / windowMs

  return Math.min(1, Math.max(0, elapsed))
}
