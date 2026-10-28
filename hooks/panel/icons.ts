import { fixed } from './primitives'

// 面板上的小图标与头像。图标按 16×16 的格子画，再平移、缩放到 (cx, cy) 为中心、
// 边长 size 的位置；线条图标用描边，闪电与美元用填充。

/** 线条图标的名字。 */
export type LineIconName = 'clock' | 'database' | 'grid' | 'calendar' | 'chat'

const ICON_GRID = 16
const LINE_ICONS: Record<LineIconName, string> = {
  clock: '<circle cx="8" cy="8" r="6.5"/><path d="M8 4.6V8l2.4 1.6"/>',
  database:
    '<ellipse cx="8" cy="3.9" rx="5.6" ry="2.2"/>' +
    '<path d="M2.4 3.9v8.2c0 1.2 2.5 2.2 5.6 2.2s5.6-1 5.6-2.2V3.9' +
    'M2.4 8c0 1.2 2.5 2.2 5.6 2.2s5.6-1 5.6-2.2"/>',
  grid:
    '<rect x="1.8" y="1.8" width="5.2" height="5.2" rx="1.2"/>' +
    '<rect x="9" y="1.8" width="5.2" height="5.2" rx="1.2"/>' +
    '<rect x="1.8" y="9" width="5.2" height="5.2" rx="1.2"/>' +
    '<rect x="9" y="9" width="5.2" height="5.2" rx="1.2"/>',
  calendar:
    '<rect x="1.8" y="3" width="12.4" height="11.2" rx="2"/>' +
    '<path d="M1.8 6.6h12.4M5.4 1.4v3M10.6 1.4v3' +
    'M5 9.6h.1M8 9.6h.1M11 9.6h.1M5 12h.1M8 12h.1"/>',
  chat:
    '<path d="M3.2 2.6h9.6a1.6 1.6 0 0 1 1.6 1.6v5.6a1.6 1.6 0 0 1-1.6 1.6H7.4' +
    'l-3.2 2.6v-2.6h-1a1.6 1.6 0 0 1-1.6-1.6V4.2a1.6 1.6 0 0 1 1.6-1.6z"/>',
}

/** 一个线条图标。 */
export function lineIcon(
  name: LineIconName,
  cx: number,
  cy: number,
  size: number,
  color: string,
): string {
  return (
    `<g transform="${placement(cx, cy, size)}" fill="none" stroke="${color}" ` +
    `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">` +
    `${LINE_ICONS[name]}</g>`
  )
}

/** 闪电：速度的图标。 */
export function boltIcon(cx: number, cy: number, size: number, color: string): string {
  return (
    `<g transform="${placement(cx, cy, size)}">` +
    `<path d="M9.4 1.2 3.4 9.1h4.2l-1.1 5.7 6.1-8H8.4z" fill="${color}"/></g>`
  )
}

/** 实心圆里一个美元符号：花费的图标。 */
export function dollarIcon(cx: number, cy: number, size: number, color: string): string {
  return (
    `<g transform="${placement(cx, cy, size)}">` +
    `<circle cx="8" cy="8" r="8" fill="${color}"/>` +
    `<text x="8" y="12.2" font-size="11.5" font-weight="700" fill="#06261c" ` +
    `text-anchor="middle">$</text></g>`
  )
}

/** 头像的样式：子 agent 是机器人，主对话是对话气泡。 */
export type AvatarKind = 'agent' | 'main'

/** 圆角方块头像，边长 size，左上角在 (x, y)。 */
export function avatar(kind: AvatarKind, x: number, y: number, size: number): string {
  const scale = size / 32
  const face = kind === 'agent' ? ROBOT_FACE : CHAT_FACE
  const gradient = kind === 'agent' ? 'agentAvatar' : 'mainAvatar'

  return (
    `<g transform="translate(${fixed(x)} ${fixed(y)}) scale(${fixed2(scale)})">` +
    `<rect width="32" height="32" rx="9" fill="url(#${gradient})"/>` +
    `<rect x="1" y="1" width="30" height="14" rx="8" fill="#fff" opacity="0.14"/>` +
    `${face}</g>`
  )
}

// 机器人：天线、白色头壳、深色面罩里两只青色眼睛。32×32 的格子。
const ROBOT_FACE =
  '<path d="M16 5.5v3" stroke="#eaf4ff" stroke-width="1.6" stroke-linecap="round"/>' +
  '<circle cx="16" cy="5" r="1.6" fill="#eaf4ff"/>' +
  '<rect x="6" y="9" width="20" height="16" rx="6" fill="#eaf4ff"/>' +
  '<rect x="8.5" y="12" width="15" height="9" rx="4" fill="#1b2a5e"/>' +
  '<circle cx="12.8" cy="16.5" r="1.8" fill="#5ef0ff"/>' +
  '<circle cx="19.2" cy="16.5" r="1.8" fill="#5ef0ff"/>'

// 对话气泡：白色气泡里三个点。32×32 的格子。
const CHAT_FACE =
  '<path d="M9 8.5h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-7l-4.5 3.5v-3.5H9' +
  'a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3z" fill="#f3efff"/>' +
  '<circle cx="11.5" cy="15.5" r="1.6" fill="#5b5fc7"/>' +
  '<circle cx="16" cy="15.5" r="1.6" fill="#5b5fc7"/>' +
  '<circle cx="20.5" cy="15.5" r="1.6" fill="#5b5fc7"/>'

/** 16×16 的格子平移、缩放到以 (cx, cy) 为中心、边长 size。 */
function placement(cx: number, cy: number, size: number): string {
  const scale = size / ICON_GRID
  const left = cx - size / 2
  const top = cy - size / 2

  return `translate(${fixed(left)} ${fixed(top)}) scale(${fixed2(scale)})`
}

/** 缩放比保留两位小数：一位小数会让 18/16 这类比例偏差明显。 */
function fixed2(value: number): string {
  return String(Math.round(value * 100) / 100)
}
