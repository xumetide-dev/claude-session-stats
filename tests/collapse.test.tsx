import { expect, test } from 'claude-code/testing'

import { BAND, answerEngine } from './fixtures'

// 桌面端面板的收起与展开：按钮切换，状态另存一份在 $.store，新会话沿用。

test('桌面端面板按"收起"变成一行摘要，按"展开"恢复面板', async ($, on) => {
  answerEngine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const textsOf = async () =>
    (await ui.findAll({ type: 'Text' })).map(text => text.text).join(' ')

  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  await ui.press({ key: 'collapse' })
  // 收起后没有面板，只剩第一行摘要（压缩、会话、缓存……）与展开按钮。
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await textsOf()).toContain('会话')
  expect(await textsOf()).not.toContain('时长')

  await ui.press({ key: 'expand' })
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  await ui.unmount()
})

test('收起状态存进 $.store；上次收起的，新会话一开始就是一行摘要', async ($, on) => {
  const { stored } = answerEngine(on, { isCollapsed: true })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.press({ key: 'expand' })
  expect(stored.get('isCollapsed')).toBe(false)
  await ui.press({ key: 'collapse' })
  expect(stored.get('isCollapsed')).toBe(true)
  await ui.unmount()
})
