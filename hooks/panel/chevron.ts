// 收起、展开开关的尖括号：一个扁的折线，画成独立的小 Svg。用 Svg 而不用字符：
// 字符要占一整行文字的高度，桌面端的按钮还要再加内边距；Svg 的高度就是折线本身
// 加一点留白。

/** 尖括号 Svg 的尺寸，CSS 像素：宽 24、高 8，折线宽 18、高 5。 */
export const CHEVRON_WIDTH = 24
export const CHEVRON_HEIGHT = 8

// 折线颜色取中性灰：尖括号画在面板外、App 的底色上，读不到 App 是浅色还是深色，
// 中性灰在两种底色上都看得见。平时半透明，悬停时不透明并加粗。
const CHEVRON_COLOR = '#8e8e93'
const REST_STYLE = { opacity: 0.7, strokeWidth: 1.5 }
const HOVER_STYLE = { opacity: 1, strokeWidth: 2 }

/**
 * 尖括号的 Svg 源码。up 是 ︿ 的形状，down 是 ﹀ 的形状；isLit 为悬停时的样子。
 */
export function chevronSvg(direction: 'up' | 'down', isLit: boolean): string {
  const { opacity, strokeWidth } = isLit ? HOVER_STYLE : REST_STYLE
  const points = direction === 'up' ? 'M3 6.5L12 1.5L21 6.5' : 'M3 1.5L12 6.5L21 1.5'

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CHEVRON_WIDTH}" ` +
    `height="${CHEVRON_HEIGHT}" viewBox="0 0 ${CHEVRON_WIDTH} ${CHEVRON_HEIGHT}">` +
    `<path d="${points}" fill="none" stroke="${CHEVRON_COLOR}" ` +
    `stroke-opacity="${opacity}" stroke-width="${strokeWidth}" ` +
    `stroke-linecap="round" stroke-linejoin="round"/></svg>`
  )
}
