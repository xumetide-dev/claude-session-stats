import type { TurnStepChunk } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { markTokenTime, toStreamTiming } from '../hooks/token-times'
import type { TokenTimes } from '../hooks/token-times'

// 首 token 与末 token 从流式块推出来。时刻是距发出请求的毫秒数。

const timesOf = (arrivals: [number, TurnStepChunk['kind']][]): TokenTimes =>
  arrivals.reduce<TokenTimes>((times, [at, kind]) => markTokenTime(times, kind, at), {})

describe('首 token 与末 token', () => {
  test('思考内容不显示：首 token 是响应第一个块的到达，末 token 是最后一个内容块', async () => {
    // 实测的形状：响应开始的 engine 块，0.4 秒后思考块才打开（模型已在思考），之后来
    // 空的 thinking 块；正文前有块的关闭与打开，末尾 stop 之后还有消息尾。
    const times = timesOf([
      [1_134, 'engine'], [1_572, 'engine'],
      [1_656, 'thinking'], [12_565, 'thinking'],
      [12_565, 'engine'], [12_567, 'tool'], [14_416, 'input'],
      [14_417, 'engine'], [15_112, 'stop'], [15_113, 'engine'],
    ])
    expect(times.firstAt).toBe(1_134)
    expect(times.lastAt).toBe(14_416)
    expect(toStreamTiming(times, 0, 1_284)).toEqual({
      outputTokens: 1_284, ttftMs: 1_134, decodeMs: 13_282,
    })
  })

  test('第一个块就是内容块时，首 token 是它', async () => {
    const times = timesOf([[500, 'text'], [900, 'text'], [1_000, 'stop']])
    expect(times).toMatchObject({ firstAt: 500, lastAt: 900 })
  })

  test('首 token 之后的 engine 块不改首 token', async () => {
    const times = timesOf([
      [100, 'engine'], [200, 'text'], [300, 'engine'], [400, 'text'],
    ])
    expect(times).toMatchObject({ firstAt: 100, lastAt: 400 })
  })

  test('没有内容块或没有输出时不计时', async () => {
    expect(toStreamTiming(timesOf([[100, 'engine'], [200, 'stop']]), 0, 50)).toBeNull()
    expect(toStreamTiming(timesOf([[100, 'text']]), 0, 0)).toBeNull()
  })
})
