import type { ContextGrid } from '../../types'
import { CATEGORY_COLORS, COLORS } from './palette'

// 面板的图元：每个函数返回一段 SVG 标记字符串，坐标都是面板 viewBox 里的像素。
// 只拼字符串、不碰数据来源，数值进来之前已经算好。两种历史小图在 charts.ts，
// 扇形仪表在 zone-gauge.ts，卡片与小方块在 cards.ts，图标在 icons.ts。

/** 一个矩形区域：左上角与宽高。 */
export type Area = { x: number; y: number; w: number; h: number }

/** 面板上一栏的左边缘与宽度。 */
export type Column = { x: number; w: number }

const LABEL_SIZE = 12
const LABEL_VALUE_GAP = 6
const SEGMENT_GAP = 2

/** 文字里的 & < > " 换成实体，免得打断标记。 */
export function escapeXml(text: string): string {
  return text
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
}

/** 坐标保留一位小数，标记更短。 */
export function fixed(value: number): string {
  return String(Math.round(value * 10) / 10)
}

/** 比例夹到 0 到 1 之间。 */
export function clampRatio(ratio: number): number {
  return Math.min(1, Math.max(0, ratio))
}

/** 一段文字。anchor 为 end 时 x 是右边缘。 */
export function caption(
  x: number,
  y: number,
  text: string,
  style: { size?: number; color?: string; anchor?: 'start' | 'middle' | 'end' } = {},
): string {
  const { size = 11, color = COLORS.dim, anchor = 'start' } = style

  return (
    `<text x="${fixed(x)}" y="${fixed(y)}" font-size="${size}" fill="${color}" ` +
    `text-anchor="${anchor}">${escapeXml(text)}</text>`
  )
}

/** "标签 值"：标签暗色、值亮色（或提醒色），同一行。 */
export function labelValue(
  x: number,
  y: number,
  label: string,
  value: string,
  valueColor: string = COLORS.text,
): string {
  return (
    `<text x="${fixed(x)}" y="${fixed(y)}" font-size="${LABEL_SIZE}">` +
    `<tspan fill="${COLORS.dim}">${escapeXml(label)}</tspan>` +
    `<tspan dx="${LABEL_VALUE_GAP}" fill="${valueColor}">${escapeXml(value)}</tspan>` +
    `</text>`
  )
}

/** 分段进度条：等宽的若干段，按比例从左往右填满，最后一段可部分填。 */
export function segmentedBar(
  area: Area,
  segments: number,
  ratio: number,
  color: string = COLORS.accent,
): string {
  const segmentWidth = (area.w - SEGMENT_GAP * (segments - 1)) / segments
  const filledSegments = clampRatio(ratio) * segments
  const parts: string[] = []
  for (let index = 0; index < segments; index += 1) {
    const x = area.x + index * (segmentWidth + SEGMENT_GAP)
    const fill = clampRatio(filledSegments - index) * segmentWidth
    parts.push(rect({ x, y: area.y, w: segmentWidth, h: area.h }, COLORS.track, 2))
    if (fill > 0) {
      parts.push(rect({ x, y: area.y, w: fill, h: area.h }, color, 2))
    }
  }

  return parts.join('')
}

/**
 * 比例横条：底轨是 0 到 100%，按比例从左填充。只用于有分母的比例，
 * 超过 100% 的按满格画。
 */
export function gaugeBar(area: Area, ratio: number, color: string): string {
  const fill = clampRatio(ratio) * area.w
  const radius = area.h / 2

  return rect(area, COLORS.track, radius) + rect({ ...area, w: fill }, color, radius)
}

/**
 * 上下文点阵：一格一个圆点，used 按类别上色，free 暗灰，buffer 暗橙；
 * 不足 0.7 满的格子画成空心，与 /context 一致。还没有格子时画一张全空的 10×10。
 */
export function dotGrid(area: Area, grid: ContextGrid | null): string {
  const dots = grid?.dots ?? emptyGrid()
  const columns = Math.max(1, ...dots.map(row => row.length))
  const cell = Math.min(area.w / columns, area.h / Math.max(1, dots.length))
  const radius = cell * 0.32

  return dots
    .flatMap((row, rowIndex) =>
      row.map((dot, columnIndex) => {
        const cx = fixed(area.x + (columnIndex + 0.5) * cell)
        const cy = fixed(area.y + (rowIndex + 0.5) * cell)
        const color = dotColor(dot.kind, dot.categoryIndex)
        const paint =
          dot.kind === 'used' && dot.fullness < 0.7
            ? `fill="none" stroke="${color}" stroke-width="1"`
            : `fill="${color}"`

        return `<circle cx="${cx}" cy="${cy}" r="${fixed(radius)}" ${paint}/>`
      }),
    )
    .join('')
}

function dotColor(kind: 'used' | 'free' | 'buffer', categoryIndex: number): string {
  if (kind === 'buffer') {
    return COLORS.bufferDot
  }
  if (kind === 'free') {
    return COLORS.freeDot
  }

  return CATEGORY_COLORS[categoryIndex % CATEGORY_COLORS.length] ?? COLORS.accent
}

function emptyGrid(): ContextGrid['dots'] {
  const side = 10
  const row = Array.from({ length: side }, () => ({
    kind: 'free' as const,
    categoryIndex: -1,
    fullness: 0,
  }))

  return Array.from({ length: side }, () => row)
}

/** 圆角矩形。 */
export function rect(area: Area, fill: string, radius: number): string {
  return (
    `<rect x="${fixed(area.x)}" y="${fixed(area.y)}" ` +
    `width="${fixed(Math.max(0, area.w))}" height="${fixed(area.h)}" ` +
    `rx="${fixed(radius)}" fill="${fill}"/>`
  )
}
