import { expect, test } from 'claude-code/testing'

import { formatUsCount, formatUsd, toSummaryRow } from '../hooks/summary'
import { EMPTY_READINGS } from '../hooks/readings'
import { EMPTY_STATS } from '../hooks/stats'
import { BAND, answerEngine, findPanelSvg } from './fixtures'

const HIT_LABEL = '\u2800'.repeat(10)

// 桌面端面板的收起与展开：按钮切换，状态另存一份在 $.store，新会话沿用。

test('开关是 8 像素高的尖括号 Svg，可点的是叠在上面、看不见文字的按钮', async ($, on) => {
  answerEngine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const chevronsOf = async (alt: string) =>
    (await ui.findAll({ type: 'Svg' })).filter(svg => svg.props.alt === alt)

  // 展开时是向下的尖括号：暗的一个，悬停时显出的亮的一个。
  const down = await chevronsOf('收起面板')
  expect(down).toHaveLength(2)
  expect(down[0]?.props.height).toBe(8)
  expect(String(down[0]?.props.source)).toContain('M3 1.5L12 6.5L21 1.5')
  // 桌面端画的是按钮的 label：只能是看不见的空白，不能是"收起面板"之类的文字。
  const collapse = await ui.find({ key: 'collapse' })
  expect(collapse?.props.label).toBe(HIT_LABEL)

  await ui.press({ key: 'collapse' })
  const up = await chevronsOf('展开面板')
  expect(up).toHaveLength(2)
  expect(String(up[0]?.props.source)).toContain('M3 6.5L12 1.5L21 6.5')
  expect((await ui.find({ key: 'expand' }))?.props.label).toBe(HIT_LABEL)
  const texts = (await ui.findAll({ type: 'Text' })).map(text => text.text).join(' ')
  expect(texts).not.toContain('展开')
  await ui.unmount()
})

test('桌面端面板按收起变成一行摘要，按展开恢复面板', async ($, on) => {
  answerEngine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const textsOf = async () =>
    (await ui.findAll({ type: 'Text' })).map(text => text.text).join(' ')

  expect(await findPanelSvg(ui)).toBeDefined()
  await ui.press({ key: 'collapse' })
  // 收起后没有面板，只剩第一行摘要（压缩、会话、命中率……）与展开的尖括号。
  expect(await findPanelSvg(ui)).toBeUndefined()
  expect(await textsOf()).toContain('会话')
  expect(await textsOf()).not.toContain('时长')

  await ui.press({ key: 'expand' })
  expect(await findPanelSvg(ui)).toBeDefined()
  await ui.unmount()
})

test('收起后的摘要是一个 Text：段间只隔空格，放不下时行尾截断，不换行', async ($, on) => {
  const { engine } = answerEngine(on, { isCollapsed: true })
  engine.costUsd = 52.214
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  const texts = await ui.findAll({ type: 'Text' })
  const summary = texts.find(text => text.props.wrap === 'truncate-end')
  expect(summary?.props.size).toBe('footnote')
  expect(summary?.text).toBe(
    '压缩 0 │ 会话 0 │ 命中率 — │ 速度 — │ TTFT — │ 花费 $52.21',
  )
  await ui.unmount()
})

test('收起状态存进 $.store；上次收起的，新会话一开始就是一行摘要', async ($, on) => {
  const { stored } = answerEngine(on, { isCollapsed: true })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect(await findPanelSvg(ui)).toBeUndefined()
  await ui.press({ key: 'expand' })
  expect(stored.get('isCollapsed')).toBe(false)
  await ui.press({ key: 'collapse' })
  expect(stored.get('isCollapsed')).toBe(true)
  await ui.unmount()
})

test('摘要的大数用美制单位，三位有效数字，向下取整', async () => {
  expect(formatUsCount(950)).toBe('950')
  expect(formatUsCount(1_130)).toBe('1.13K')
  expect(formatUsCount(999_999)).toBe('999K')
  expect(formatUsCount(30_140_000)).toBe('30.1M')
  expect(formatUsCount(30_000_000)).toBe('30M')
  expect(formatUsCount(2_400_000_000)).toBe('2.4B')
})

test('摘要的花费：不到 $100 写到分，不到 $10K 写整数，再往上用 K', async () => {
  expect(formatUsd(46.834)).toBe('$46.83')
  expect(formatUsd(468.9)).toBe('$468')
  expect(formatUsd(12_345)).toBe('$12.3K')
})

test('摘要降低精度：缓存整数百分比，速度整数，TTFT 一位小数', async () => {
  const stats = {
    ...EMPTY_STATS,
    totalTokens: 30_140_000, promptTokens: 1_000, cacheReadTokens: 982,
    decodedTokens: 1_116, decodeMs: 10_000,
    firstTokenWaitMs: 10_800, firstTokenCount: 2,
  }
  const row = toSummaryRow(stats, { ...EMPTY_READINGS, costUsd: 46.83 })
  const text = row.map(({ label, value }) => `${label} ${value}`).join(' | ')
  expect(text).toBe(
    '压缩 0 | 会话 30.1M | 命中率 98% | 速度 112 tok/s | TTFT 5.4s | 花费 $46.83',
  )
})
