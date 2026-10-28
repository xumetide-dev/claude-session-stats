import type { ContextGrid, EngineReadings, SessionStats } from '../../types'
import { formatUsd } from '../summary'
import { agentsPage, mainLoopPage } from './activity-pages'
import { CARD_PADDING, cardFrame, pageDots } from './cards'
import { stepChart } from './charts'
import { contextPage, usagePage } from './context-pages'
import { dollarIcon } from './icons'
import { limitsCard } from './limits-column'
import { COLORS, FONT_FAMILY, GRADIENT_DEFS } from './palette'
import { caption } from './primitives'
import type { Area } from './primitives'
import { runtimeCard, speedCard } from './time-cards'

// 桌面端的图形面板：一张 960×144 的 SVG，比状态栏宽时按比例缩小。外框里六张卡片
// 从左到右是子 agent 与主对话、上下文与缓存、运行时长、处理速度与 TTFT、限额、
// 花费。前两张各有两页轮流显示，每页停留 20 秒。
//
// 有分母的比例（上下文占用、缓存命中、限额）画 0 到 100% 的条形；速度、TTFT 与
// 花费另画历史：双轴小图是最近若干次请求的速度与 TTFT，花费折线是每次变化的点，
// 都由 mod 自己记录，从 mod 加载之后开始，加载之前的没有。

export const PANEL_WIDTH = 960
export const PANEL_HEIGHT = 144

export type PanelInput = {
  stats: SessionStats
  readings: EngineReadings
  grid: ContextGrid | null
  /** 主对话是否正在跑一轮：运行时长卡片的 LIVE 标记、主对话页的状态。 */
  isWorking: boolean
}

const FRAME_PADDING = 6
const CARD_GAP = 6
// 六张卡片的宽度，按设计图的比例分配，合计 960 - 2×6 - 5×6 = 918。
const CARD_WIDTHS = {
  activity: 214, context: 112, runtime: 160, speed: 161, limits: 134, cost: 137,
} as const
type CardName = keyof typeof CARD_WIDTHS

// 两处轮播同时换页，共用一个页码：第一张是子 agent、主对话，第二张是上下文构成、
// 会话与缓存。两处都是两页。
const ACTIVITY_PAGES = [agentsPage, mainLoopPage] as const
const CONTEXT_PAGES = [contextPage, usagePage] as const
const PAGE_COUNT = 2
const CAROUSEL_INTERVAL_MS = 20_000

export function buildPanelSvg(input: PanelInput): string {
  const page = carouselPage(input.readings.now)
  const cards = cardAreas()
  const drawActivity = ACTIVITY_PAGES[page] ?? agentsPage
  const drawContext = CONTEXT_PAGES[page] ?? contextPage
  const { activity, context } = cards
  const body = [
    `<rect x="0.5" y="0.5" width="${PANEL_WIDTH - 1}" height="${PANEL_HEIGHT - 1}" ` +
      `rx="14" fill="${COLORS.frame}" stroke="${COLORS.frameStroke}"/>`,
    ...Object.values(cards).map(cardFrame),
    drawActivity(activity, input),
    pageDots(activity.x + activity.w - 18, activity.y + 32, page, PAGE_COUNT),
    drawContext(context, input),
    pageDots(context.x + context.w - CARD_PADDING, context.y + 18, page, PAGE_COUNT),
    runtimeCard(cards.runtime, input),
    speedCard(cards.speed, input),
    limitsCard(cards.limits, input.readings),
    costCard(cards.cost, input),
  ].join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PANEL_WIDTH}" ` +
    `height="${PANEL_HEIGHT}" viewBox="0 0 ${PANEL_WIDTH} ${PANEL_HEIGHT}" ` +
    `font-family="${FONT_FAMILY}"><defs>${GRADIENT_DEFS}</defs>${body}</svg>`
  )
}

/**
 * 轮播此刻显示第几页：按时间每 20 秒换一页，不另起定时器。面板本来每秒
 * 随读数重画一次，所以换页最多晚 1 秒。用时间而不用计数，重载后页码也接得上。
 */
export function carouselPage(now: number): number {
  return Math.floor(now / CAROUSEL_INTERVAL_MS) % PAGE_COUNT
}

/** 六张卡片的位置：从左到右依次排开，高度相同。 */
function cardAreas(): Record<CardName, Area> {
  const top = FRAME_PADDING
  const height = PANEL_HEIGHT - 2 * FRAME_PADDING
  let x = FRAME_PADDING
  const areas = {} as Record<CardName, Area>
  for (const name of Object.keys(CARD_WIDTHS) as CardName[]) {
    areas[name] = { x, y: top, w: CARD_WIDTHS[name], h: height }
    x += CARD_WIDTHS[name] + CARD_GAP
  }

  return areas
}

/** 花费：大号金额与花费随时间的阶梯折线。 */
function costCard(card: Area, { stats, readings }: PanelInput): string {
  const x = card.x + CARD_PADDING
  const { costUsd, now } = readings
  const title =
    dollarIcon(x + 7, card.y + 17, 15, COLORS.accent) +
    caption(x + 19, card.y + 22, '花费', { size: 12, color: COLORS.text })
  if (costUsd === null) {
    return title + caption(x, card.y + 46, '无记账', { size: 10.5 })
  }

  return (
    title +
    `<text x="${x}" y="${card.y + 50}" font-size="22" font-weight="600" ` +
    `fill="${COLORS.text}">${formatUsd(costUsd)}</text>` +
    stepChart(
      { x, y: card.y + 62, w: card.w - 2 * CARD_PADDING, h: card.h - 70 },
      stats.costPoints,
      now,
    )
  )
}
