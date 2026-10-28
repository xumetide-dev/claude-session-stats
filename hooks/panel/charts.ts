import type { CostPoint, RequestSample } from '../../types'
import { COLORS } from './palette'
import { caption, fixed } from './primitives'
import type { Area } from './primitives'

// 两种历史小图：最近若干次请求的速度与 TTFT，花费随时间的阶梯折线。

// 双轴小图两侧各留出的宽度，用来写左右两轴的最大值（如 "10.7s"）。
const AXIS_GUTTER = 24
const MS_PER_SECOND = 1000

/** 双轴小图的横向布局：绘图区与每次请求占的宽度。 */
type ChartLayout = { plot: Area; slotWidth: number; firstSlot: number }

/**
 * 双轴小图：每次请求占一个位置，最新的在最右，不足 slots 次时左边留空。
 * 柱子是输出速度（左轴），曲线是 TTFT（右轴）；两轴都从 0 到各自的最大值，
 * 最大值写在绘图区两侧的顶端，颜色与各自的图形相同。
 */
export function requestChart(
  area: Area,
  samples: readonly RequestSample[],
  slots: number,
): string {
  if (samples.length === 0) {
    return caption(area.x, area.y + area.h / 2 + 4, '暂无数据')
  }

  const shown = samples.slice(-slots)
  const plot = { ...area, x: area.x + AXIS_GUTTER, w: area.w - 2 * AXIS_GUTTER }
  const layout = { plot, slotWidth: plot.w / slots, firstSlot: slots - shown.length }
  const maxSpeed = maxOf(shown.map(sample => sample.speed))
  const maxTtft = maxOf(shown.map(sample => sample.ttftMs))
  const labelY = area.y + 7
  const speedLabel =
    maxSpeed === null ? '' : String(Math.round(maxSpeed))
  const ttftLabel =
    maxTtft === null ? '' : `${(maxTtft / MS_PER_SECOND).toFixed(1)}s`

  return (
    speedBars(layout, shown, maxSpeed) +
    ttftLine(layout, shown, maxTtft) +
    caption(area.x, labelY, speedLabel, { size: 9, color: COLORS.accent }) +
    caption(area.x + area.w, labelY, ttftLabel, {
      size: 9, color: COLORS.ttft, anchor: 'end',
    })
  )
}

/** 速度柱子：按最大速度归一化高度；最新一次请求的柱子不透明。没有速度的请求不画。 */
function speedBars(
  { plot, slotWidth, firstSlot }: ChartLayout,
  samples: readonly RequestSample[],
  maxSpeed: number | null,
): string {
  if (maxSpeed === null) {
    return ''
  }

  return samples
    .map((sample, index) => {
      if (sample.speed === null) {
        return ''
      }
      const height = Math.max(1, (sample.speed / maxSpeed) * plot.h)
      const x = plot.x + (firstSlot + index + 0.2) * slotWidth
      const opacity = index === samples.length - 1 ? 1 : 0.55

      return (
        `<rect x="${fixed(x)}" y="${fixed(plot.y + plot.h - height)}" ` +
        `width="${fixed(slotWidth * 0.6)}" height="${fixed(height)}" ` +
        `fill="${COLORS.accent}" opacity="${opacity}"/>`
      )
    })
    .join('')
}

/** TTFT 曲线：连起有 TTFT 的请求（跳过没有的），最新的那个点画一个圆点。 */
function ttftLine(
  { plot, slotWidth, firstSlot }: ChartLayout,
  samples: readonly RequestSample[],
  maxTtft: number | null,
): string {
  if (maxTtft === null) {
    return ''
  }

  const points = samples.flatMap((sample, index) =>
    sample.ttftMs === null
      ? []
      : [{
          x: plot.x + (firstSlot + index + 0.5) * slotWidth,
          y: plot.y + plot.h - (sample.ttftMs / maxTtft) * plot.h,
        }],
  )
  const path = points
    .map((point, index) => {
      const command = index === 0 ? 'M' : 'L'

      return `${command}${fixed(point.x)} ${fixed(point.y)}`
    })
    .join('')
  const latest = points[points.length - 1]
  const dot =
    latest === undefined
      ? ''
      : `<circle cx="${fixed(latest.x)}" cy="${fixed(latest.y)}" r="2" ` +
        `fill="${COLORS.ttft}"/>`

  return (
    `<path d="${path}" fill="none" stroke="${COLORS.ttft}" stroke-width="1.5" ` +
    `stroke-linejoin="round"/>` +
    dot
  )
}

function maxOf(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null)

  return present.length === 0 ? null : Math.max(...present)
}

/**
 * 阶梯折线：花费每变一次抬一级，横轴是时间（到 now 为止），纵轴从记录里的
 * 最小值到最大值，所以看的是这段时间里涨了多少，不是从 0 开始。
 */
export function stepChart(area: Area, points: CostPoint[], now: number): string {
  const first = points[0]
  const last = points[points.length - 1]
  if (first === undefined || last === undefined) {
    return caption(area.x, area.y + area.h / 2, '暂无数据')
  }

  const end = Math.max(now, last.at, first.at + 1)
  const low = Math.min(...points.map(point => point.usd))
  const high = Math.max(...points.map(point => point.usd))
  const toX = (at: number) => area.x + ((at - first.at) / (end - first.at)) * area.w
  // 花费从没变过时只有一个高度，画在中线上。
  const toY = (usd: number) =>
    high === low
      ? area.y + area.h / 2
      : area.y + area.h - ((usd - low) / (high - low)) * area.h
  const steps = points
    .slice(1)
    .map(point => `H${fixed(toX(point.at))}V${fixed(toY(point.usd))}`)
    .join('')
  const start = `M${fixed(toX(first.at))} ${fixed(toY(first.usd))}`
  const line = `${start}${steps}H${fixed(toX(end))}`
  const floor = fixed(area.y + area.h)
  const areaPath = `${line}V${floor}H${fixed(toX(first.at))}Z`
  const tipX = fixed(toX(end))
  const tipY = fixed(toY(last.usd))

  return (
    `<path d="${areaPath}" fill="url(#costFill)"/>` +
    `<path d="${line}" fill="none" stroke="${COLORS.accent}" stroke-width="1.5"/>` +
    `<circle cx="${tipX}" cy="${tipY}" r="6" fill="${COLORS.warning}" ` +
    `opacity="0.25"/>` +
    `<circle cx="${tipX}" cy="${tipY}" r="2.5" fill="${COLORS.warning}"/>`
  )
}

/** 阶梯折线下方渐变填充的定义，面板的 <defs> 里放一次。 */
export const STEP_CHART_DEFS =
  `<linearGradient id="costFill" x1="0" y1="0" x2="0" y2="1">` +
  `<stop offset="0" stop-color="${COLORS.accent}" stop-opacity="0.28"/>` +
  `<stop offset="1" stop-color="${COLORS.accent}" stop-opacity="0"/>` +
  `</linearGradient>`
