// 面板的配色：深藏青底、薄荷绿与亮蓝两种强调色，橙、黄、红留给提醒。面板自带深色
// 底，不跟随 App 的浅色/深色主题：SVG 按图片绘制，读不到 App 的主题色，自带底色
// 能保证两种主题下都看得清。

export const COLORS = {
  // 外框与卡片：外框最暗，卡片略亮，卡片里的小方块再亮一档。
  frame: '#07111b',
  frameStroke: '#163049',
  cardTop: '#0f1f2f',
  cardBottom: '#0a1622',
  cardStroke: '#172b3f',
  tile: '#0f2131',
  tileStroke: '#1a3045',
  divider: '#1c3044',
  text: '#e8eef5',
  dim: '#8796a8',
  icon: '#a7b6c8',
  track: '#1c2a39',
  accent: '#34dfa4',
  // 强调色的底：秒数方块、LIVE 标记。
  accentTile: '#0f3a30',
  accentTileStroke: '#1f6e55',
  warning: '#ffa94d',
  // 分区仪表的黄色段；比 warning 的橙色更偏黄，红黄绿三段才分得开。
  caution: '#e6d36a',
  error: '#f07a6e',
  // TTFT 曲线与它的读数用蓝色，和绿色的速度柱子区分。
  ttft: '#29aef5',
  freeDot: '#1f2d3c',
  bufferDot: '#5e4b2d',
} as const

/** 上下文格子里 used 各类别的颜色，按类别序号循环取用。 */
export const CATEGORY_COLORS = [
  '#34dfa4',
  '#3b9cf5',
  '#a78bfa',
  '#f0a35e',
  '#f472b6',
  '#5fd4d4',
  '#e6d36a',
] as const

export const FONT_FAMILY =
  "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', sans-serif"

/**
 * 面板 <defs> 里的渐变：卡片底、头像底、速度柱子与花费曲线下方的填充。
 * 引用处写 url(#id)。
 */
export const GRADIENT_DEFS =
  verticalGradient('cardFill', [[0, COLORS.cardTop, 1], [1, COLORS.cardBottom, 1]]) +
  verticalGradient('agentAvatar', [[0, '#8f9cf7', 1], [1, '#56c4f4', 1]]) +
  verticalGradient('mainAvatar', [[0, '#b18cf7', 1], [1, '#6f8ff5', 1]]) +
  verticalGradient('speedBar', [[0, COLORS.accent, 1], [1, COLORS.accent, 0.25]]) +
  verticalGradient('costFill', [[0, COLORS.accent, 0.32], [1, COLORS.accent, 0]])

type Tone = 'warning' | 'error' | undefined

/** 文字的颜色：有提醒色用提醒色，否则用正文色。 */
export function toneColor(tone: Tone): string {
  if (tone === 'error') {
    return COLORS.error
  }

  return tone === 'warning' ? COLORS.warning : COLORS.text
}

/** 图形（环、横条）的颜色：有提醒色用提醒色，否则用强调绿。 */
export function graphicColor(tone: Tone): string {
  return tone === undefined ? COLORS.accent : toneColor(tone)
}

/** 从上到下的线性渐变；每一档是位置、颜色与不透明度。 */
function verticalGradient(id: string, stops: [number, string, number][]): string {
  const marks = stops
    .map(([offset, color, opacity]) =>
      `<stop offset="${offset}" stop-color="${color}" stop-opacity="${opacity}"/>`,
    )
    .join('')

  return (
    `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
    `${marks}</linearGradient>`
  )
}
