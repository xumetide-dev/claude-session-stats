import type { TurnStepChunk } from 'claude-code'

import type { StreamTiming } from './stats'

// 一次模型请求里首 token 与末 token 的到达时刻，由流式块逐个推出来。纯函数：时刻由
// 调用方读时钟后传入。
//
// 口径（vLLM、AIPerf、Artificial Analysis 的通行定义）：TTFT 是发出请求到首 token，
// 思考的 token 也算；速度只算首 token 到末 token 之间，不含排队与预填充。
//
// 思考内容不显示时（Opus 5.5 等的默认）收不到思考的 token，output_tokens 却含着
// 它们，首 token 的时刻只能从块的到达推断。实测（2026-10-28，31 次请求）：响应的
// 第一个块总是 engine 块（响应开始），思考块的开始有时紧随其后，有时晚 0.2 到
// 1 秒，这段时间模型已经在思考。以思考块的开始计起，窗口漏掉这一段，短请求的
// 速度虚高：174 token 的请求算成 244 tok/s，以响应开始计起是 143 tok/s；长请求
// 两种算法只差几个百分点。所以首 token 取响应第一个块的到达时刻。
// 末 token 取最后一个内容块：其后的 stop 块要再等 0.1 到 1.2 秒，这段与输出多少
// 无关，不是生成。
// 也有整段内容在响应开始后 20 毫秒内一起到达的（123 token，算出来 5810 tok/s），
// 这类窗口过短的请求由 stats.ts 的 MIN_SPEED_WINDOW_MS 排除在速度之外。

/** 生成内容的块：模型产出的 token 在这几种块里到达。 */
const CONTENT_KINDS: ReadonlySet<TurnStepChunk['kind']> = new Set([
  'thinking', 'text', 'tool', 'input',
])

/** 响应第一个块（首 token）与最后一个内容块（末 token）的到达时刻。 */
export type TokenTimes = {
  firstAt?: number
  lastAt?: number
}

/** 一块在 now 到达后的时刻记录。 */
export function markTokenTime(
  times: TokenTimes,
  kind: TurnStepChunk['kind'],
  now: number,
): TokenTimes {
  const firstAt = times.firstAt ?? now
  if (!CONTENT_KINDS.has(kind)) {
    return { ...times, firstAt }
  }

  return { firstAt, lastAt: now }
}

/** 这次请求的计时；没收到生成内容、或没有输出时为 null，不计时。 */
export function toStreamTiming(
  times: TokenTimes,
  requestedAt: number,
  outputTokens: number,
): StreamTiming | null {
  const { firstAt, lastAt } = times
  if (firstAt === undefined || lastAt === undefined || outputTokens === 0) {
    return null
  }

  return { outputTokens, ttftMs: firstAt - requestedAt, decodeMs: lastAt - firstAt }
}
