import type { TurnStepChunk } from 'claude-code'

import type { StreamTiming } from './stats'

// 一次模型请求里首 token 与末 token 的到达时刻，由流式块逐个推出来。纯函数：时刻由
// 调用方读时钟后传入。
//
// 口径（vLLM、AIPerf、Artificial Analysis 的通行定义）：TTFT 是发出请求到首 token，
// 思考的 token 也算；速度只算首 token 到末 token 之间，不含排队与预填充。
//
// 思考内容不显示时（Opus 5.5 等的默认）收不到思考的 token，output_tokens 却含着
// 它们。实测（2026-10-27）思考块在思考开始时就打开，思考期间陆续来空的 thinking 块，
// 思考结束时关闭：所以首 token 取首个内容块之前最后一个 engine 块（块的开始）的
// 到达时刻，思考的时长与思考的 token 同在计时窗口里。若以首个可见 token 计起，
// 窗口漏掉思考的时长，速度会虚高好几倍（出现过 900 多 tok/s）。
// 末 token 取最后一个内容块：其后的 stop 块要再等零点几秒，那段不是生成。

/** 生成内容的块：模型产出的 token 在这几种块里到达。 */
const CONTENT_KINDS: ReadonlySet<TurnStepChunk['kind']> = new Set([
  'thinking', 'text', 'tool', 'input',
])

/** 首 token 与末 token 的到达时刻，以及首 token 之前最后一个 engine 块的。 */
export type TokenTimes = {
  lastEngineAt?: number
  firstAt?: number
  lastAt?: number
}

/** 一块在 now 到达后的时刻记录。 */
export function markTokenTime(
  times: TokenTimes,
  kind: TurnStepChunk['kind'],
  now: number,
): TokenTimes {
  const hasFirstToken = times.firstAt !== undefined
  if (kind === 'engine' && !hasFirstToken) {
    return { ...times, lastEngineAt: now }
  }
  if (!CONTENT_KINDS.has(kind)) {
    return times
  }

  return {
    ...times,
    firstAt: hasFirstToken ? times.firstAt : (times.lastEngineAt ?? now),
    lastAt: now,
  }
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
