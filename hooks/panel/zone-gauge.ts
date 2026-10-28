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
 * 扁的扇形仪表：上半个椭圆，几段等角度的色段从左到右排开，一根指针从圆心指向
 * 当前值，色段之间的分界写在弧的外侧。各段角度一样，取值范围却可以不同
 * （如 0–70%、70–90%、90–100%），段内按取值线性换算角度，所以要靠分界的数字
 * 读刻度。area 是弧本身占的方框（含线宽），分界的数字画在方框上方。
 * ratio 为 null 时不画指针。
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
  const zoneDegrees = 180 / zones.length
  const arcs = zones.map((zone, index) => {
    const from = 180 - index * zoneDegrees - ZONE_GAP_DEGREES / 2
    const to = 180 - (index + 1) * zoneDegrees + ZONE_GAP_DEGREES / 2
    const opacity = index === activeIndex ? 1 : INACTIVE_ZONE_OPACITY

    return fanArc(fan, from, to, zone.color, opacity)
  })
  const labels = zones.slice(0, -1).map((zone, index) =>
    boundaryLabel(fan, 180 - (index + 1) * zoneDegrees, zone.upTo),
  )
  const pointer = value === null ? '' : needle(fan, zoneAngle(zones, value))

  return arcs.join('') + labels.join('') + pointer
}

/** 椭圆上某个角度（0° 在右、90° 在上、180° 在左）的点。 */
function fanPoint(
  fan: FanGeometry,
  degrees: number,
  reach = 1,
): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180

  return {
    x: fan.cx + reach * fan.rx * Math.cos(radians),
    y: fan.cy - reach * fan.ry * Math.sin(radians),
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
  const outside = { ...fan, rx: fan.rx + 12, ry: fan.ry + 9 }
  const point = fanPoint(outside, degrees)
  const text = `${Math.round(upTo * 100)}%`

  return caption(point.x, point.y + 3, text, { size: 9, anchor: 'middle' })
}

/** 值落在哪一段：小于该段上限即属于它；等于最后上限的归最后一段。 */
function zoneIndexOf(zones: readonly GaugeZone[], value: number): number {
  const index = zones.findIndex(zone => value < zone.upTo)

  return index === -1 ? zones.length - 1 : index
}

/** 值对应的指针角度：先找段，再在段内按取值线性换算。180° 是最左，0° 是最右。 */
function zoneAngle(zones: readonly GaugeZone[], value: number): number {
  const index = zoneIndexOf(zones, value)
  const lower = index === 0 ? 0 : zones[index - 1]?.upTo ?? 0
  const upper = zones[index]?.upTo ?? 1
  const fraction = upper > lower ? (value - lower) / (upper - lower) : 1
  const position = (index + fraction) / zones.length

  return 180 * (1 - position)
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
