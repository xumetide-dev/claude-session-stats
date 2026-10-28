import { expect, test } from 'claude-code/testing'

import {
  NO_USAGE,
  START,
  answerEngine,
  answerSteps,
  bandText,
  breakdownFixture,
  drain,
  panelProps,
} from './fixtures'

// 计数属于哪个会话：换了会话从头计。空闲时显示不变就不重画。

const step = { turnId: 'main', index: 0, model: 'm', messageCount: 1 }

test('/resume 换到另一个会话：计数从头算，补上最后一轮的结束时刻', async ($, on) => {
  const { clock, engine } = answerEngine(on)
  answerSteps(on, () => ({ ...NO_USAGE, input_tokens: 50_000 }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await drain($.turn.step(step))
  expect(await bandText($, 'terminal')).toContain('会话 5万')

  await $.session.end({
    reason: 'resume', sessionId: 'session-1', resume: { id: 'session-1' },
  })
  // 恢复的会话已有 4 次 prompt：最后一轮至迟在认下它时已经结束。
  engine.sessionId = 'session-2'
  engine.promptCount = 4
  await clock.advance(1000)

  const text = await bandText($, 'terminal')
  expect(text).toContain('会话 0')
  expect(text).toContain('时长 1秒')
})

test('会话 id 变了、没有收到会话结束：同样从头算', async ($, on) => {
  const { clock, engine } = answerEngine(on)
  answerSteps(on, () => ({ ...NO_USAGE, input_tokens: 50_000 }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await drain($.turn.step(step))
  engine.sessionId = 'session-2'
  await clock.advance(1000)

  expect(await bandText($, 'terminal')).toContain('会话 0')
})

test('换了会话立即重算上下文格子，不等 15 秒的定时刷新', async ($, on) => {
  const { clock, engine } = answerEngine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const before = (await panelProps($)).source
  // 格子变成四格全满：会话没换时要等定时刷新，一秒后面板不变。
  const full = breakdownFixture().gridRows[0]?.[0]
  if (full === undefined) {
    throw new Error('格子的样例缺第一格')
  }
  engine.breakdown = breakdownFixture({ gridRows: [[full, full], [full, full]] })
  await clock.advance(1000)
  expect((await panelProps($)).source).toBe(before)

  engine.sessionId = 'session-2'
  await clock.advance(1000)
  expect((await panelProps($)).source).not.toBe(before)
})

test('空闲时显示不变就不重画：面板逐秒不变，到换页时才变', async ($, on) => {
  const { clock, engine } = answerEngine(on)
  const resetsAt = new Date(START + 2 * 3_600_000).toISOString()
  engine.rateLimits = [{ kind: 'five_hour', percentUsed: 40, resetsAt }]
  engine.costUsd = 1

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // 花费变了：读数写回一次，花费曲线有了两个点，右端跟着时间走。
  engine.costUsd = 1.5
  await clock.advance(1000)
  const settled = (await panelProps($)).source
  await clock.advance(1000)
  expect((await panelProps($)).source).toBe(settled)

  // START 是 20 秒的整数倍：到 START + 20 秒换页。
  await clock.advance(18_000)
  expect((await panelProps($)).source).not.toBe(settled)
})
