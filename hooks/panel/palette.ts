// 面板的配色。面板自带深色卡片底，不跟随 App 的浅色/深色主题：SVG 按图片绘制，
// 读不到 App 的主题色，自带底色能保证两种主题下都看得清。

export const COLORS = {
  card: '#16181b',
  cardStroke: '#2b2e33',
  divider: '#2b2e33',
  text: '#e7e9ec',
  dim: '#8a9097',
  track: '#2a2d31',
  accent: '#7ee2a8',
  warning: '#f0a35e',
  // 分区仪表的黄色段；比 warning 的橙色更偏黄，红黄绿三段才分得开。
  caution: '#e6d36a',
  error: '#f07a6e',
  // TTFT 曲线与它的读数用蓝色，和绿色的速度柱子区分。
  ttft: '#6cb6ff',
  freeDot: '#34383d',
  bufferDot: '#6b5634',
} as const

/** 上下文格子里 used 各类别的颜色，按类别序号循环取用。 */
export const CATEGORY_COLORS = [
  '#7ee2a8',
  '#6cb6ff',
  '#c39bff',
  '#f0a35e',
  '#ff8fb1',
  '#5fd4d4',
  '#e6d36a',
] as const

export const FONT_FAMILY =
  "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', sans-serif"

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
