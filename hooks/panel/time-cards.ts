import type { EngineReadings, SessionStats } from '../../types'
import {
  NO_READING,
  averageTtft,
  formatShortDuration,
  liveWorkMs,
  outputSpeed,
  sessionDurationMs,
} from '../format'
import { CARD_PADDING, bigNumber, pill, tileFrame, vLine } from './cards'
import { requestChart } from './charts'
import { boltIcon, lineIcon } from './icons'
import { COLORS } from './palette'
import { caption, escapeXml, fitFontSize, fixed } from './primitives'
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
const TIME_TILE_VALUE_SIZE = 22

/**
 * 运行时长：会话开始到主对话最后一轮结束的时、分、秒（正在跑一轮时算到现在，
 * 空闲时停住），秒数方块用强调色；右上角标记主对话此刻在不在跑一轮。底部是耗时
 * （主对话各轮之和）与它占时长的比例。还不知道最后一轮何时结束时写占位符。
 */
export function runtimeCard(
  card: Area,
  { stats, readings, isWorking }: TimeInput,
): string {
  const x = card.x + CARD_PADDING
  const right = card.x + card.w - CARD_PADDING
  const sessionMs = sessionDurationMs(stats, readings)
  const workMs = liveWorkMs(stats, readings.now)
  // 时长为 0（刚开始）时比例没有意义，与不知道时长一样写占位符。
  const workPercent =
    sessionMs === null || sessionMs === 0
      ? NO_READING
      : `${Math.round(Math.min(1, workMs / sessionMs) * 100)}%`
  const badge = isWorking
    ? pill(right, card.y + 9, 'LIVE', COLORS.accent)
    : pill(right, card.y + 9, '空闲', COLORS.dim)

  return (
    lineIcon('clock', x + 7, card.y + 17, 14, COLORS.icon) +
    caption(x + 19, card.y + HEADER_BASELINE, '运行时长', TITLE_STYLE) +
    badge +
    clockTiles({ ...card, x, w: right - x }, sessionMs) +
    `<text x="${fixed(x)}" y="${fixed(card.y + card.h - 12)}" font-size="11" ` +
    `fill="${COLORS.dim}">耗时<tspan dx="4" fill="${COLORS.accent}">` +
    `${escapeXml(formatShortDuration(workMs))}</tspan><tspan dx="4">· 占</tspan>` +
    `<tspan dx="4" fill="${COLORS.accent}">${workPercent}</tspan></text>`
  )
}

/**
 * 时、分、秒三个方块，方块之间一个小圆点。时长未知时三格都写 --；小时数超过两位
 * 时照写，放不下就缩小字号。
 */
function clockTiles(row: Area, sessionMs: number | null): string {
  const totalSeconds = Math.floor(Math.max(0, sessionMs ?? 0) / MS_PER_SECOND)
  const digits = (value: number) =>
    sessionMs === null ? '--' : String(value).padStart(2, '0')
  const parts = [
    { value: digits(Math.floor(totalSeconds / SECONDS_PER_HOUR)), label: '小时' },
    {
      value: digits(Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)),
      label: '分钟',
    },
    { value: digits(totalSeconds % SECONDS_PER_MINUTE), label: '秒' },
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
        `<text x="${fixed(center)}" y="${fixed(top + 34)}" ` +
        `font-size="${fitFontSize(value, width - 6, TIME_TILE_VALUE_SIZE)}" ` +
        `font-weight="600" fill="${valueColor}" text-anchor="middle">${value}</text>` +
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
  const speedAt = { x, y: valueY, maxWidth: middle - 6 - x }
  const ttftAt = { x: middle + 10, y: valueY, maxWidth: right - middle - 10 }

  return (
    boltIcon(x + 6, card.y + 17, 14, COLORS.accent) +
    caption(x + 16, card.y + HEADER_BASELINE, '处理速度', TITLE_STYLE) +
    vLine(middle, card.y + 10, card.y + 54) +
    lineIcon('clock', middle + 16, card.y + 17, 13, COLORS.ttft) +
    caption(middle + 26, card.y + HEADER_BASELINE, 'TTFT', {
      ...TITLE_STYLE, color: COLORS.ttft,
    }) +
    bigNumber(
      speedAt,
      { value: speedValue(speed), unit: speed === null ? '' : 'tok/s' },
      COLORS.accent,
    ) +
    bigNumber(
      ttftAt,
      { value: ttftValue(ttft), unit: ttft === null ? '' : 's' },
      COLORS.ttft,
    ) +
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
