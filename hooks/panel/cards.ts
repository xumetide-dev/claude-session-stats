import { COLORS } from './palette'
import { escapeXml, fixed } from './primitives'
import type { Area } from './primitives'

// 卡片式版面的公用部件：卡片、卡片里的小方块、状态标记、大号读数、轮播页码。

/** 卡片内容离卡片边缘的距离。 */
export const CARD_PADDING = 10
const CARD_RADIUS = 10
const TILE_RADIUS = 8
const PILL_HEIGHT = 16

/** 一张卡片：渐变底、细描边。 */
export function cardFrame(area: Area): string {
  return framedRect(area, 'url(#cardFill)', COLORS.cardStroke, CARD_RADIUS)
}

/** 卡片里的小方块；accent 用强调绿的底与描边（运行时长的秒数）。 */
export function tileFrame(area: Area, variant: 'plain' | 'accent' = 'plain'): string {
  return variant === 'accent'
    ? framedRect(area, COLORS.accentTile, COLORS.accentTileStroke, TILE_RADIUS)
    : framedRect(area, COLORS.tile, COLORS.tileStroke, TILE_RADIUS)
}

/** 右端对齐 right 的胶囊标记（LIVE / 空闲），文字居中。 */
export function pill(right: number, top: number, text: string, color: string): string {
  const width = 12 + text.length * 7
  const area = { x: right - width, y: top, w: width, h: PILL_HEIGHT }

  return (
    `<rect x="${fixed(area.x)}" y="${fixed(top)}" width="${fixed(width)}" ` +
    `height="${PILL_HEIGHT}" rx="${PILL_HEIGHT / 2}" ` +
    `fill="${color}" fill-opacity="0.16"/>` +
    `<text x="${fixed(area.x + width / 2)}" y="${fixed(top + 11.5)}" font-size="9.5" ` +
    `font-weight="600" fill="${color}" text-anchor="middle">${escapeXml(text)}</text>`
  )
}

/** 大号读数：数值大字，单位小字紧跟其后，同一条基线。 */
export function bigNumber(
  x: number,
  y: number,
  value: string,
  unit: string,
  color: string,
): string {
  const unitMark =
    unit === ''
      ? ''
      : `<tspan dx="3" font-size="10" font-weight="400" fill="${COLORS.dim}">` +
        `${escapeXml(unit)}</tspan>`

  return (
    `<text x="${fixed(x)}" y="${fixed(y)}" font-size="22" font-weight="600" ` +
    `fill="${color}">${escapeXml(value)}${unitMark}</text>`
  )
}

/** 轮播的页码点，右端对齐 right：当前页亮，其余暗。 */
export function pageDots(
  right: number,
  cy: number,
  page: number,
  count: number,
): string {
  return Array.from({ length: count }, (_, index) => {
    const cx = right - (count - 1 - index) * 8 - 2.5
    const color = index === page ? COLORS.text : COLORS.track

    return `<circle cx="${fixed(cx)}" cy="${fixed(cy)}" r="2.5" fill="${color}"/>`
  }).join('')
}

/** 水平分隔线。 */
export function hLine(x1: number, x2: number, y: number): string {
  return (
    `<line x1="${fixed(x1)}" y1="${fixed(y)}" x2="${fixed(x2)}" y2="${fixed(y)}" ` +
    `stroke="${COLORS.divider}" stroke-width="1"/>`
  )
}

/** 竖直分隔线。 */
export function vLine(x: number, y1: number, y2: number): string {
  return (
    `<line x1="${fixed(x)}" y1="${fixed(y1)}" x2="${fixed(x)}" y2="${fixed(y2)}" ` +
    `stroke="${COLORS.divider}" stroke-width="1"/>`
  )
}

/** 带描边的圆角矩形；描边画在半像素上，1 像素线才清楚。 */
function framedRect(area: Area, fill: string, stroke: string, radius: number): string {
  return (
    `<rect x="${fixed(area.x + 0.5)}" y="${fixed(area.y + 0.5)}" ` +
    `width="${fixed(area.w - 1)}" height="${fixed(area.h - 1)}" rx="${radius}" ` +
    `fill="${fill}" stroke="${stroke}" stroke-width="1"/>`
  )
}
