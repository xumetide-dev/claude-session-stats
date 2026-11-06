import type { ContextGrid, EngineReadings, SessionStats } from '../../types'
import { NO_READING, cacheHitRate, formatCount } from '../format'
import { CARD_PADDING } from './cards'
import { COLORS } from './palette'
import { caption, dotGrid, labelValue, markerTick, segmentedBar } from './primitives'
import type { Area } from './primitives'
import { zoneGauge } from './zone-gauge'
import type { GaugeZone } from './zone-gauge'

// 桌面端面板第二张卡片的两页：上下文占比与构成点阵；会话 token、上下文占用与缓存
// 命中率。上下文占比是随时要看的读数，两页的头部附近都有。换页由 panel.ts 安排，
// 页码点画在卡片右上角。

/** 两页用到的数据。 */
type ContextInput = {
  stats: SessionStats
  readings: EngineReadings
  grid: ContextGrid | null
}

const HEADER_BASELINE = 22
// 头部一行右端让给页码点（三个点与间隔）的宽度；头部的数值放不下时缩小字号。
// 字宽是估算的，"%" 这类字形实际更宽，多留几像素免得贴着页码点。
const PAGE_DOTS_ROOM = 32
// 上下文点阵：10 行时每格 8 像素。
const GRID_TOP = 30
const GRID_SIZE = 80

/**
 * 第一页：上下文占比与构成点阵（/context 那张格子），页脚是主对话的压缩次数。
 * 头部的占比与第二页的上下文一行同一口径（contextUsageOf）。
 */
export function contextPage(
  card: Area,
  { stats, readings, grid }: ContextInput,
): string {
  const x = card.x + CARD_PADDING
  const header = { x, y: card.y + HEADER_BASELINE, maxWidth: headerWidth(card) }
  const { percent } = contextUsageOf(readings, grid)

  return (
    labelValue(header, '上下文', percentText(percent)) +
    dotGrid({ x, y: card.y + GRID_TOP, w: GRID_SIZE, h: GRID_SIZE }, grid) +
    caption(x, card.y + card.h - 10, `压缩 ${stats.compactions}次`, { size: 10.5 })
  )
}

// 缓存命中率的三段：低于 70% 红、70%–90% 黄、90% 以上绿。长会话里每次请求都重发
// 同一段前缀，命中率通常在 90% 以上；两个阈值是经验值，可按需要调整。
// 仪表是线性刻度，两处分界都在右半边，靠右端：仪表右侧让出这么宽写分界的数字。
const GAUGE_LABEL_ROOM = 20
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
  const { tokens, window, percent, autoCompactTokens } = contextUsageOf(readings, grid)
  const hitRate = cacheHitRate(stats)
  const contextBar = { x, y: top + 47, w, h: 7 }
  // 自动压缩的触发点在上下文条上画一道刻度：占用到刻度处就会压缩。
  const compactTick =
    autoCompactTokens === null || window === null || window <= 0
      ? ''
      : markerTick(contextBar, autoCompactTokens / window, COLORS.text)
  const usageText =
    tokens === null || window === null
      ? NO_READING
      : `${formatCount(tokens)} / ${formatCount(window)}`
  const hitRateText = hitRate === null ? NO_READING : `${(hitRate * 100).toFixed(1)}%`

  return (
    labelValue(
      { x, y: top + HEADER_BASELINE, maxWidth: headerWidth(card) },
      '会话', formatCount(stats.totalTokens),
    ) +
    caption(x, top + 42, '上下文', { size: 10.5 }) +
    caption(right, top + 42, percentText(percent), {
      size: 10.5, color: COLORS.text, anchor: 'end',
    }) +
    segmentedBar(contextBar, 10, (percent ?? 0) / 100) +
    compactTick +
    caption(x, top + 67, usageText, { size: 10.5 }) +
    caption(x, top + 88, '命中率', { size: 10.5 }) +
    caption(right, top + 88, hitRateText, {
      size: 10.5, color: cacheValueColor(hitRate), anchor: 'end',
    }) +
    zoneGauge({ x, y: top + 98, w: w - GAUGE_LABEL_ROOM, h: 26 }, hitRate, CACHE_ZONES)
  )
}

/** 上下文占比的写法：取整的百分数，没有读数时写占位符。 */
function percentText(percent: number | null): string {
  return percent === null ? NO_READING : `${Math.round(percent)}%`
}

/** 头部一行能给"标签 值"的宽度：去掉两侧留白与页码点。 */
function headerWidth(card: Area): number {
  return card.w - 2 * CARD_PADDING - PAGE_DOTS_ROOM
}

/**
 * 上下文占用以 /context 为准，与桌面端的上下文指示一致：分母是自动压缩窗口，
 * 可能比模型的上下文窗口小得多（如 52.7 万对 100 万）。还没有 /context 的结果时
 * 退回状态栏的读数，分母是模型的上下文窗口，也不知道自动压缩的触发点。
 */
function contextUsageOf(
  readings: EngineReadings,
  grid: ContextGrid | null,
): {
  tokens: number | null
  window: number | null
  percent: number | null
  autoCompactTokens: number | null
} {
  // 旧版本存下的格子没有占用字段，重载后第一次刷新之前也走状态栏的读数。
  if (grid !== null && grid.windowTokens !== undefined) {
    return {
      tokens: grid.usedTokens,
      window: grid.windowTokens,
      percent: grid.percent,
      autoCompactTokens: grid.autoCompactTokens ?? null,
    }
  }

  return {
    tokens: readings.contextTokens,
    window: readings.contextWindow,
    percent: readings.contextPercent,
    autoCompactTokens: null,
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
