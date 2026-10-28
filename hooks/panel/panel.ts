import type { ContextGrid, EngineReadings, SessionStats } from '../../types'
import {
  NO_READING,
  averageTtft,
  cacheHitRate,
  formatCount,
  formatDuration,
  liveWorkMs,
  outputSpeed,
} from '../format'
import { agentsPage, mainLoopPage } from './activity-pages'
import { limitsColumn } from './limits-column'
import { STEP_CHART_DEFS, requestChart, stepChart } from './charts'
import { COLORS, FONT_FAMILY } from './palette'
import {
  caption,
  divider,
  dotGrid,
  gaugeBar,
  labelValue,
  rect,
  segmentedBar,
  stateIcon,
} from './primitives'
import type { Column } from './primitives'
import { zoneGauge } from './zone-gauge'
import type { GaugeZone } from './zone-gauge'

// 桌面端的图形面板：一张 720×172 的 SVG。五栏从左到右是子 agent 与主对话、
// 上下文与缓存、时间与速度、限额、花费。面板比状态栏宽时按比例缩小。
// 前两栏各有两页轮流显示，每页停留 20 秒。
//
// 有分母的比例（上下文占用、缓存命中、耗时占时长、限额）画 0 到 100% 的条形；
// 速度、TTFT 与花费另画历史：双轴小图是最近若干次请求的速度与 TTFT，
// 花费折线是每次变化的点，都由 mod 自己记录，从 mod 加载之后开始，加载之前的没有。

export const PANEL_WIDTH = 720
export const PANEL_HEIGHT = 172

export type PanelInput = {
  stats: SessionStats
  readings: EngineReadings
  grid: ContextGrid | null
  /** 主对话是否正在跑一轮：决定时长旁的图标是播放还是暂停。 */
  isWorking: boolean
}

const REQUEST_SLOTS = 40
const COLUMN_TOP = 16
const COLUMN_BOTTOM = 156
const BAR_HEIGHT = 6

/** 五栏的左边缘与宽度；栏间 32 像素，中间是分隔线。 */
const COLUMNS = {
  activity: { x: 16, w: 100 },
  context: { x: 148, w: 132 },
  time: { x: 312, w: 172 },
  limits: { x: 516, w: 84 },
  cost: { x: 632, w: 72 },
} as const
const DIVIDERS = [132, 296, 500, 616]

// 两处轮播同时换页，共用一个页码：第一栏是子 agent、主对话，第二栏是上下文构成、
// 会话与缓存。两处都是两页。
const ACTIVITY_PAGES = [agentsPage, mainLoopPage] as const
const CONTEXT_PAGES = [contextPage, usagePage] as const
const CAROUSEL_PAGE_COUNT = 2
const CAROUSEL_INTERVAL_MS = 20_000
// 上下文点阵的宽度：10 列时每格约 10 像素，与改成轮播之前一样大。
const CONTEXT_GRID_WIDTH = 100

export function buildPanelSvg(input: PanelInput): string {
  const page = carouselPage(input.readings.now)
  const drawActivity = ACTIVITY_PAGES[page] ?? agentsPage
  const drawContext = CONTEXT_PAGES[page] ?? contextPage
  const body = [
    rect({ x: 0.5, y: 0.5, w: PANEL_WIDTH - 1, h: PANEL_HEIGHT - 1 }, COLORS.card, 14),
    ...DIVIDERS.map(x => divider(x, COLUMN_TOP, COLUMN_BOTTOM)),
    drawActivity(COLUMNS.activity, input),
    pageDots(COLUMNS.activity, page),
    drawContext(input),
    pageDots(COLUMNS.context, page),
    timeColumn(input),
    limitsColumn(COLUMNS.limits, input.readings),
    costColumn(input),
  ].join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PANEL_WIDTH}" ` +
    `height="${PANEL_HEIGHT}" viewBox="0 0 ${PANEL_WIDTH} ${PANEL_HEIGHT}" ` +
    `font-family="${FONT_FAMILY}"><defs>${STEP_CHART_DEFS}</defs>${body}</svg>`
  )
}

/**
 * 轮播此刻显示第几页：按时间每 20 秒换一页，不另起定时器。面板本来每秒
 * 随读数重画一次，所以换页最多晚 1 秒。用时间而不用计数，重载后页码也接得上。
 */
export function carouselPage(now: number): number {
  return Math.floor(now / CAROUSEL_INTERVAL_MS) % CAROUSEL_PAGE_COUNT
}

/** 轮播栏右上角的页码点：当前页亮，其余暗。 */
function pageDots({ x, w }: Column, page: number): string {
  const right = x + w

  return Array.from({ length: CAROUSEL_PAGE_COUNT }, (_, index) => {
    const cx = right - (CAROUSEL_PAGE_COUNT - 1 - index) * 9 - 3
    const color = index === page ? COLORS.text : COLORS.track

    return `<circle cx="${cx}" cy="27" r="3" fill="${color}"/>`
  }).join('')
}

/** 第二栏第一页：压缩次数与上下文构成点阵（/context 那张格子）。 */
function contextPage({ stats, grid }: PanelInput): string {
  const { x } = COLUMNS.context

  return (
    labelValue(x, 32, '压缩', String(stats.compactions)) +
    dotGrid({ x, y: 44, w: CONTEXT_GRID_WIDTH, h: 96 }, grid) +
    caption(x, 154, '上下文构成')
  )
}

// 缓存命中率的三段：低于 70% 红、70%–90% 黄、90% 以上绿。长会话里每次请求都重发
// 同一段前缀，命中率通常在 90% 以上；两个阈值是经验值，可按需要调整。
const CACHE_ZONES: readonly GaugeZone[] = [
  { upTo: 0.7, color: COLORS.error },
  { upTo: 0.9, color: COLORS.caution },
  { upTo: 1, color: COLORS.accent },
]

/** 第二栏第二页：会话 token 与上下文窗口占用，缓存命中率的扇形仪表。 */
function usagePage({ stats, readings, grid }: PanelInput): string {
  const { x, w } = COLUMNS.context
  const { tokens, window, percent } = contextUsageOf(readings, grid)
  const hitRate = cacheHitRate(stats)
  const contextText =
    tokens === null || window === null
      ? `上下文 ${NO_READING}`
      : `上下文 ${formatCount(tokens)} / ${formatCount(window)}`
  const hitRateText = hitRate === null ? NO_READING : `${(hitRate * 100).toFixed(1)}%`

  return (
    labelValue(x, 32, '会话', formatCount(stats.totalTokens)) +
    segmentedBar({ x, y: 42, w, h: 10 }, 10, (percent ?? 0) / 100) +
    caption(x, 68, contextText) +
    labelValue(x, 104, '总缓存', hitRateText, cacheValueColor(hitRate)) +
    zoneGauge({ x, y: 121, w, h: 33 }, hitRate, CACHE_ZONES)
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

/**
 * 第三栏：会话时长，横条是耗时占时长的比例；平均速度、平均 TTFT，
 * 与最近若干次请求的速度（柱）和 TTFT（曲线）。prompt 与工具的次数在第一栏的
 * 主对话页。速度与 TTFT 的读数分别用柱子与曲线的颜色，兼作图例。
 */
function timeColumn({ stats, readings, isWorking }: PanelInput): string {
  const { x, w } = COLUMNS.time
  const { now, sessionStartedAt } = readings
  const workMs = liveWorkMs(stats, now)
  const sessionMs = sessionStartedAt === null ? 0 : now - sessionStartedAt
  const workRatio = sessionMs > 0 ? Math.min(1, workMs / sessionMs) : 0
  const workLine = `耗时 ${formatDuration(workMs)} · 占 ${Math.round(workRatio * 100)}%`
  const speed = outputSpeed(stats)
  const ttft = averageTtft(stats)
  const speedText = speed === null ? NO_READING : `≈${speed.toFixed(1)} tok/s`
  const ttftText = ttft === null ? NO_READING : `≈${(ttft / 1000).toFixed(1)}s`

  return (
    stateIcon(x, 28, isWorking) +
    labelValue(x + 14, 32, '时长', formatDuration(sessionMs)) +
    gaugeBar({ x, y: 42, w, h: BAR_HEIGHT }, workRatio, COLORS.accent) +
    caption(x, 64, workLine) +
    labelValue(x, 92, '速度', speedText, COLORS.accent) +
    caption(x + w, 92, `TTFT ${ttftText}`, { anchor: 'end', color: COLORS.ttft }) +
    requestChart({ x, y: 102, w, h: 50 }, stats.recentRequests, REQUEST_SLOTS)
  )
}

/** 第五栏：花费与花费随时间的阶梯折线。 */
function costColumn({ stats, readings }: PanelInput): string {
  const { x, w } = COLUMNS.cost
  const { costUsd, now } = readings
  if (costUsd === null) {
    return caption(x, 32, '花费') + caption(x, 52, '无记账')
  }

  return (
    labelValue(x, 32, '花费', `$${costUsd.toFixed(2)}`) +
    stepChart({ x, y: 48, w, h: 92 }, stats.costPoints, now)
  )
}
