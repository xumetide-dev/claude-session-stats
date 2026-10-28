import type { CostPoint, RequestSample } from '../../types'
import { COLORS } from './palette'
import { caption, fixed } from './primitives'
import type { Area } from './primitives'

// 两种历史小图：最近若干次请求的速度与 TTFT，花费随时间的阶梯折线。

// 双轴小图顶上留出的高度，用来写左右两轴的最大值（如 "10.7s"）。
const AXIS_LABEL_HEIGHT = 14
const MS_PER_SECOND = 1000

/** 双轴小图的横向布局：绘图区与每次请求占的宽度。 */
type ChartLayout = { plot: Area; slotWidth: number; firstSlot: number }

/**
 * 双轴小图：每次请求占一个位置，最新的在最右，不足 slots 次时左边留空。
 * 柱子是输出速度（左轴），曲线是 TTFT（右轴）；两轴都从 0 到各自的最大值，
 * 最大值写在绘图区上方的左右两端，颜色与各自的图形相同。
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
  const plot = { ...area, y: area.y + AXIS_LABEL_HEIGHT, h: area.h - AXIS_LABEL_HEIGHT }
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

/**
 * 速度柱子：按最大速度归一化高度，自上而下由亮转暗；最新一次请求的柱子不透明。
 * 没有速度的请求不画。
 */
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
        `width="${fixed(slotWidth * 0.6)}" height="${fixed(height)}" rx="1" ` +
        `fill="url(#speedBar)" opacity="${opacity}"/>`
      )
    })
    .join('')
}

/**
 * TTFT 曲线：平滑地连起有 TTFT 的请求（跳过没有的），最新的那个点画一个圆点。
 * 每段是一条三次贝塞尔曲线，控制点取相邻点连线方向（Catmull-Rom），并夹在
 * 绘图区里，曲线不会冲出图外。
 */
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
  const path = smoothPath(points, { top: plot.y, bottom: plot.y + plot.h })
  const latest = points[points.length - 1]
  const dot = latest === undefined ? '' : endpoint(latest.x, latest.y, COLORS.ttft)

  return (
    `<path d="${path}" fill="none" stroke="${COLORS.ttft}" stroke-width="1.5" ` +
    `stroke-linejoin="round" stroke-linecap="round"/>` +
    dot
  )
}

type Point = { x: number; y: number }

/** 过各点的平滑路径：M 起笔，之后每两点之间一段 C。 */
function smoothPath(
  points: readonly Point[],
  bounds: { top: number; bottom: number },
): string {
  const first = points[0]
  if (first === undefined) {
    return ''
  }
  const at = (index: number): Point =>
    points[Math.min(points.length - 1, Math.max(0, index))] ?? first
  const clampY = (y: number) => Math.min(bounds.bottom, Math.max(bounds.top, y))
  const segments = points.slice(1).map((end, offset) => {
    const before = at(offset - 1)
    const start = at(offset)
    const after = at(offset + 2)
    const c1 = {
      x: start.x + (end.x - before.x) / 6,
      y: clampY(start.y + (end.y - before.y) / 6),
    }
    const c2 = {
      x: end.x - (after.x - start.x) / 6,
      y: clampY(end.y - (after.y - start.y) / 6),
    }

    return (
      `C${fixed(c1.x)} ${fixed(c1.y)} ${fixed(c2.x)} ${fixed(c2.y)} ` +
      `${fixed(end.x)} ${fixed(end.y)}`
    )
  })

  return `M${fixed(first.x)} ${fixed(first.y)}${segments.join('')}`
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

  return (
    `<path d="${areaPath}" fill="url(#costFill)"/>` +
    `<path d="${line}" fill="none" stroke="${COLORS.accent}" stroke-width="1.5" ` +
    `stroke-linejoin="round"/>` +
    endpoint(toX(end), toY(last.usd), COLORS.warning)
  )
}

/** 曲线末端的点：实心圆点外加一圈淡色光晕。 */
function endpoint(x: number, y: number, color: string): string {
  return (
    `<circle cx="${fixed(x)}" cy="${fixed(y)}" r="5.5" ` +
    `fill="${color}" opacity="0.25"/>` +
    `<circle cx="${fixed(x)}" cy="${fixed(y)}" r="2.5" fill="${color}" ` +
    `stroke="#fff" stroke-width="0.8"/>`
  )
}
