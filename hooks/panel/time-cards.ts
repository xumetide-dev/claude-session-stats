import type { EngineReadings, SessionStats } from '../../types'
import {
  NO_READING,
  averageTtft,
  formatShortDuration,
  liveWorkMs,
  outputSpeed,
} from '../format'
import { CARD_PADDING, bigNumber, pill, tileFrame, vLine } from './cards'
import { requestChart } from './charts'
import { boltIcon, lineIcon } from './icons'
import { COLORS } from './palette'
import { caption, escapeXml, fixed } from './primitives'
import type { Area } from './primitives'

// 桌面端面板的两张时间卡片：运行时长（时、分、秒三个方块）；处理速度与 TTFT
// （两个大号读数与最近若干次请求的双轴小图）。

/** 两张卡片用到的数据。 */
type TimeInput = { stats: SessionStats; readings: EngineReadings; isWorking: boolean }

const HEADER_BASELINE = 22
// 卡片标题：正文色、比标签略大。
const TITLE_STYLE = { size: 12, color: COLORS.text }
// 小图最多画最近 24 次请求：柱子宽一些，与设计图相近。
const REQUEST_SLOTS = 24
const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3600
// TTFT 不到 10 秒时保留一位小数，10 秒以上写整秒。
const TTFT_DECIMAL_LIMIT_MS = 10_000
const TIME_TILE_TOP = 32
const TIME_TILE_HEIGHT = 66
const TIME_TILE_GAP = 8

/**
 * 运行时长：会话开始至今的时、分、秒，秒数方块用强调色；右上角标记主对话此刻
 * 在不在跑一轮。底部是耗时（主对话各轮之和）与它占时长的比例。
 */
export function runtimeCard(
  card: Area,
  { stats, readings, isWorking }: TimeInput,
): string {
  const x = card.x + CARD_PADDING
  const right = card.x + card.w - CARD_PADDING
  const { now, sessionStartedAt } = readings
  const sessionMs = sessionStartedAt === null ? 0 : now - sessionStartedAt
  const workMs = liveWorkMs(stats, now)
  const workRatio = sessionMs > 0 ? Math.min(1, workMs / sessionMs) : 0
  const badge = isWorking ? pill(right, card.y + 9, 'LIVE', COLORS.accent)
    : pill(right, card.y + 9, '空闲', COLORS.dim)

  return (
    lineIcon('clock', x + 7, card.y + 17, 14, COLORS.icon) +
    caption(x + 19, card.y + HEADER_BASELINE, '运行时长', TITLE_STYLE) +
    badge +
    clockTiles({ ...card, x, w: right - x }, sessionMs) +
    `<text x="${fixed(x)}" y="${fixed(card.y + card.h - 12)}" font-size="11" ` +
    `fill="${COLORS.dim}">耗时<tspan dx="4" fill="${COLORS.accent}">` +
    `${escapeXml(formatShortDuration(workMs))}</tspan><tspan dx="4">· 占</tspan>` +
    `<tspan dx="4" fill="${COLORS.accent}">${Math.round(workRatio * 100)}%` +
    `</tspan></text>`
  )
}

/** 时、分、秒三个方块，方块之间一个小圆点。 */
function clockTiles(row: Area, sessionMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, sessionMs) / MS_PER_SECOND)
  const parts = [
    { value: Math.floor(totalSeconds / SECONDS_PER_HOUR), label: '小时' },
    {
      value: Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE),
      label: '分钟',
    },
    { value: totalSeconds % SECONDS_PER_MINUTE, label: '秒' },
  ]
  const width = (row.w - (parts.length - 1) * TIME_TILE_GAP) / parts.length
  const top = row.y + TIME_TILE_TOP

  return parts
    .map(({ value, label }, index) => {
      const tile = {
        x: row.x + index * (width + TIME_TILE_GAP),
        y: top, w: width, h: TIME_TILE_HEIGHT,
      }
      const isSeconds = index === parts.length - 1
      const center = tile.x + width / 2
      const valueColor = isSeconds ? COLORS.accent : COLORS.text
      const separator =
        index === 0
          ? ''
          : `<circle cx="${fixed(tile.x - TIME_TILE_GAP / 2)}" ` +
            `cy="${fixed(top + 28)}" r="1.3" fill="${COLORS.dim}"/>`

      return (
        separator +
        tileFrame(tile, isSeconds ? 'accent' : 'plain') +
        `<text x="${fixed(center)}" y="${fixed(top + 34)}" font-size="22" ` +
        `font-weight="600" fill="${valueColor}" text-anchor="middle">` +
        `${String(value).padStart(2, '0')}</text>` +
        caption(center, top + 54, label, {
          size: 10.5, anchor: 'middle', color: isSeconds ? COLORS.accent : COLORS.dim,
        })
      )
    })
    .join('')
}

/**
 * 处理速度与 TTFT：左右两个大号读数，下面是最近若干次请求的双轴小图，柱子是速度、
 * 曲线是 TTFT。读数用各自图形的颜色，兼作图例。
 */
export function speedCard(card: Area, { stats }: TimeInput): string {
  const x = card.x + CARD_PADDING
  const right = card.x + card.w - CARD_PADDING
  const middle = card.x + Math.round(card.w * 0.55)
  const speed = outputSpeed(stats)
  const ttft = averageTtft(stats)
  const valueY = card.y + 50

  return (
    boltIcon(x + 6, card.y + 17, 14, COLORS.accent) +
    caption(x + 16, card.y + HEADER_BASELINE, '处理速度', TITLE_STYLE) +
    vLine(middle, card.y + 10, card.y + 54) +
    lineIcon('clock', middle + 16, card.y + 17, 13, COLORS.ttft) +
    caption(middle + 26, card.y + HEADER_BASELINE, 'TTFT', {
      ...TITLE_STYLE, color: COLORS.ttft,
    }) +
    bigNumber(x, valueY, speedValue(speed), speed === null ? '' : 'tok/s', COLORS.accent) +
    bigNumber(middle + 10, valueY, ttftValue(ttft), ttft === null ? '' : 's', COLORS.ttft) +
    requestChart(
      { x, y: card.y + 60, w: right - x, h: card.h - 68 },
      stats.recentRequests,
      REQUEST_SLOTS,
    )
  )
}

/** 速度的大号读数：整数 token/秒。 */
function speedValue(speed: number | null): string {
  return speed === null ? NO_READING : String(Math.round(speed))
}

/** TTFT 的大号读数，单位秒：10 秒以内一位小数，以上取整。 */
function ttftValue(ttftMs: number | null): string {
  if (ttftMs === null) {
    return NO_READING
  }
  const seconds = ttftMs / MS_PER_SECOND

  return ttftMs < TTFT_DECIMAL_LIMIT_MS
    ? seconds.toFixed(1)
    : String(Math.round(seconds))
}
