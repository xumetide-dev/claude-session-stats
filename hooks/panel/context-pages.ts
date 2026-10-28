import type { ContextGrid, EngineReadings, SessionStats } from '../../types'
import { NO_READING, cacheHitRate, formatCount } from '../format'
import { CARD_PADDING } from './cards'
import { COLORS } from './palette'
import { caption, dotGrid, labelValue, segmentedBar } from './primitives'
import type { Area } from './primitives'
import { zoneGauge } from './zone-gauge'
import type { GaugeZone } from './zone-gauge'

// 桌面端面板第二张卡片的两页：上下文构成点阵；会话 token、上下文占用与缓存命中率。
// 换页由 panel.ts 安排，页码点画在卡片右上角。

/** 两页用到的数据。 */
type ContextInput = {
  stats: SessionStats
  readings: EngineReadings
  grid: ContextGrid | null
}

const HEADER_BASELINE = 22
// 上下文点阵：10 行时每格 8 像素。
const GRID_TOP = 30
const GRID_SIZE = 80

/** 第一页：压缩次数与上下文构成点阵（/context 那张格子）。 */
export function contextPage(card: Area, { stats, grid }: ContextInput): string {
  const x = card.x + CARD_PADDING

  return (
    labelValue(x, card.y + HEADER_BASELINE, '压缩', String(stats.compactions)) +
    dotGrid({ x, y: card.y + GRID_TOP, w: GRID_SIZE, h: GRID_SIZE }, grid) +
    caption(x, card.y + card.h - 10, '上下文构成', { size: 10.5 })
  )
}

// 缓存命中率的三段：低于 70% 红、70%–90% 黄、90% 以上绿。长会话里每次请求都重发
// 同一段前缀，命中率通常在 90% 以上；两个阈值是经验值，可按需要调整。
const CACHE_ZONES: readonly GaugeZone[] = [
  { upTo: 0.7, color: COLORS.error },
  { upTo: 0.9, color: COLORS.caution },
  { upTo: 1, color: COLORS.accent },
]

/** 第二页：会话 token、上下文窗口占用，缓存命中率的扇形仪表。 */
export function usagePage(card: Area, { stats, readings, grid }: ContextInput): string {
  const x = card.x + CARD_PADDING
  const w = card.w - 2 * CARD_PADDING
  const right = x + w
  const top = card.y
  const { tokens, window, percent } = contextUsageOf(readings, grid)
  const hitRate = cacheHitRate(stats)
  const usageText =
    tokens === null || window === null
      ? NO_READING
      : `${formatCount(tokens)} / ${formatCount(window)}`
  const percentText = percent === null ? NO_READING : `${Math.round(percent)}%`
  const hitRateText = hitRate === null ? NO_READING : `${(hitRate * 100).toFixed(1)}%`

  return (
    labelValue(x, top + HEADER_BASELINE, '会话', formatCount(stats.totalTokens)) +
    caption(x, top + 42, '上下文', { size: 10.5 }) +
    caption(right, top + 42, percentText, {
      size: 10.5, color: COLORS.text, anchor: 'end',
    }) +
    segmentedBar({ x, y: top + 47, w, h: 7 }, 10, (percent ?? 0) / 100) +
    caption(x, top + 67, usageText, { size: 10.5 }) +
    caption(x, top + 88, '总缓存', { size: 10.5 }) +
    caption(right, top + 88, hitRateText, {
      size: 10.5, color: cacheValueColor(hitRate), anchor: 'end',
    }) +
    zoneGauge({ x, y: top + 98, w, h: 26 }, hitRate, CACHE_ZONES)
  )
}

/**
 * 上下文占用以 /context 为准，与桌面端的上下文指示一致：分母是自动压缩窗口，
 * 可能比模型的上下文窗口小得多（如 52.7 万对 100 万）。还没有 /context 的结果时
 * 退回状态栏的读数，分母是模型的上下文窗口。
 */
function contextUsageOf(
  readings: EngineReadings,
  grid: ContextGrid | null,
): { tokens: number | null; window: number | null; percent: number | null } {
  // 旧版本存下的格子没有占用字段，重载后第一次刷新之前也走状态栏的读数。
  if (grid !== null && grid.windowTokens !== undefined) {
    return { tokens: grid.usedTokens, window: grid.windowTokens, percent: grid.percent }
  }

  return {
    tokens: readings.contextTokens,
    window: readings.contextWindow,
    percent: readings.contextPercent,
  }
}

/** 命中率读数的颜色：落在绿段用正文色，落在黄段、红段用该段的颜色。 */
function cacheValueColor(hitRate: number | null): string {
  if (hitRate === null) {
    return COLORS.text
  }
  const zone = CACHE_ZONES.find(candidate => hitRate < candidate.upTo)

  return zone === undefined || zone.color === COLORS.accent ? COLORS.text : zone.color
}
