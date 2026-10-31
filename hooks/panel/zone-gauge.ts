import { COLORS } from './palette'
import { caption, clampRatio, fixed } from './primitives'
import type { Area } from './primitives'

/** 分区仪表的一段：取值从上一段的 upTo 到这一段的 upTo（0 到 1），用 color 画。 */
export type GaugeZone = { upTo: number; color: string }

// 指针不在其中的色段调暗，突出当前所在的那一段。
const INACTIVE_ZONE_OPACITY = 0.35
const GAUGE_STROKE = 6
// 色段之间留的空隙，角度。
const ZONE_GAP_DEGREES = 3
// 指针长度占半径的比例，指针尖不压到色段上。
const NEEDLE_REACH = 0.8

/** 扇形仪表的几何：圆心在下边中点，横、竖两个半径（竖的短，所以是扁的）。 */
type FanGeometry = { cx: number; cy: number; rx: number; ry: number }

/**
 * 扁的扇形仪表：上半个椭圆，刻度从左端的 0 线性走到右端的 100%，一根指针从圆心
 * 指向当前值；色段按各自的取值范围占角度（如 0–70%、70–90%、90–100% 占 126°、
 * 36°、18°），分界的数字写在弧的外侧。area 是弧本身占的方框（含线宽），分界的
 * 数字画在方框上方。ratio 为 null 时不画指针。
 *
 * 角度都是从圆心看过去的方向角，不是椭圆的参数角：扁的椭圆上两者不同（宽是高的
 * 两倍时，参数角 108° 的点在方向角 123° 上），按参数角画，指针的倾斜就和取值对
 * 不上。
 */
export function zoneGauge(
  area: Area,
  ratio: number | null,
  zones: readonly GaugeZone[],
): string {
  const fan = {
    cx: area.x + area.w / 2,
    cy: area.y + area.h,
    rx: area.w / 2 - GAUGE_STROKE / 2,
    ry: area.h - GAUGE_STROKE / 2,
  }
  const value = ratio === null ? null : clampRatio(ratio)
  const activeIndex = value === null ? -1 : zoneIndexOf(zones, value)
  const arcs = zones.map((zone, index) => {
    const lower = index === 0 ? 0 : zones[index - 1]?.upTo ?? 0
    const from = valueAngle(lower) - ZONE_GAP_DEGREES / 2
    const to = valueAngle(zone.upTo) + ZONE_GAP_DEGREES / 2
    const opacity = index === activeIndex ? 1 : INACTIVE_ZONE_OPACITY

    return fanArc(fan, from, to, zone.color, opacity)
  })
  const labels = zones.slice(0, -1).map(zone =>
    boundaryLabel(fan, valueAngle(zone.upTo), zone.upTo),
  )
  const pointer = value === null ? '' : needle(fan, valueAngle(value))

  return arcs.join('') + labels.join('') + pointer
}

/**
 * 椭圆上某个方向角（0° 在右、90° 在上、180° 在左）的点：从圆心沿这个方向出去，
 * 与椭圆的交点；reach 小于 1 时停在半路。
 */
function fanPoint(
  fan: FanGeometry,
  degrees: number,
  reach = 1,
): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  // 椭圆的极坐标方程：x²/rx² + y²/ry² = 1 上方向角为 θ 的点离圆心的距离。
  const radius = (fan.rx * fan.ry) / Math.hypot(fan.ry * cos, fan.rx * sin)

  return {
    x: fan.cx + reach * radius * cos,
    y: fan.cy - reach * radius * sin,
  }
}

/** 从 from 度到 to 度（from 在左、to 在右）的一段弧，顺时针经过上方。 */
function fanArc(
  fan: FanGeometry,
  from: number,
  to: number,
  color: string,
  opacity: number,
): string {
  const start = fanPoint(fan, from)
  const end = fanPoint(fan, to)
  const path =
    `M${fixed(start.x)} ${fixed(start.y)}` +
    `A${fixed(fan.rx)} ${fixed(fan.ry)} 0 0 1 ${fixed(end.x)} ${fixed(end.y)}`

  return (
    `<path d="${path}" fill="none" stroke="${color}" ` +
    `stroke-width="${GAUGE_STROKE}" opacity="${opacity}"/>`
  )
}

/** 两段之间的分界数字，写在弧外侧。 */
function boundaryLabel(fan: FanGeometry, degrees: number, upTo: number): string {
  const outside = { ...fan, rx: fan.rx + 14, ry: fan.ry + 9 }
  const point = fanPoint(outside, degrees)
  const text = `${Math.round(upTo * 100)}%`

  return caption(point.x, point.y + 3, text, { size: 9, anchor: 'middle' })
}

/** 值落在哪一段：小于该段上限即属于它；等于最后上限的归最后一段。 */
function zoneIndexOf(zones: readonly GaugeZone[], value: number): number {
  const index = zones.findIndex(zone => value < zone.upTo)

  return index === -1 ? zones.length - 1 : index
}

/** 取值（0 到 1）对应的方向角：线性刻度，0 在最左（180°），1 在最右（0°）。 */
function valueAngle(value: number): number {
  return 180 * (1 - value)
}

/** 指针：从圆心指向 degrees 方向，圆心画一个轴点。 */
function needle(fan: FanGeometry, degrees: number): string {
  const tip = fanPoint(fan, degrees, NEEDLE_REACH)

  return (
    `<line x1="${fixed(fan.cx)}" y1="${fixed(fan.cy)}" ` +
    `x2="${fixed(tip.x)}" y2="${fixed(tip.y)}" ` +
    `stroke="${COLORS.text}" stroke-width="2" stroke-linecap="round"/>` +
    `<circle cx="${fixed(fan.cx)}" cy="${fixed(fan.cy)}" r="3.5" ` +
    `fill="${COLORS.text}"/>`
  )
}
