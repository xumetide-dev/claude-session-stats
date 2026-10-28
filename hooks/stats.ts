import type { ModelUsage } from 'claude-code'

import type { CostPoint, RequestSample, SessionStats } from '../types'

// 统计的累加规则。全部是纯函数：输入旧统计，返回新统计，由 register.tsx 经
// `update($, atom, fn)` 写回 $.state。

export const EMPTY_STATS: SessionStats = {
  compactions: 0,
  totalTokens: 0,
  promptTokens: 0,
  cacheReadTokens: 0,
  workMs: 0,
  mainTurnStartedAt: null,
  decodedTokens: 0,
  decodeMs: 0,
  firstTokenWaitMs: 0,
  firstTokenCount: 0,
  toolCalls: 0,
  toolMs: 0,
  agentTokens: 0,
  agentWorkMs: 0,
  agentToolCalls: 0,
  recentRequests: [],
  costPoints: [],
}

// 速度与 TTFT 小图保留最近 40 次请求；花费曲线最多 120 个点。
const MAX_REQUEST_SAMPLES = 40
const MAX_COST_POINTS = 120
// 首末 token 相隔不足 0.5 秒的请求在小图里没有速度柱子（TTFT 照记）：输出几个
// token 就结束的请求，时长接近 0，又常是一批 token 一起到达，算出来的速度是离群值，
// 把其余柱子压扁。总速度仍计入它们。
const MIN_SAMPLE_DECODE_MS = 500
const MS_PER_SECOND = 1000

/** 一次请求计时的结果，主对话的才计入速度与 TTFT。 */
export type StreamTiming = {
  /** 这次请求的输出 token，含思考。 */
  outputTokens: number
  /** 从发出请求到首 token，毫秒（TTFT）。 */
  ttftMs: number
  /** 从首 token 到末 token，毫秒。 */
  decodeMs: number
}

/** 现行的计时字段：旧版本的统计里没有，按它们判断计时口径是不是旧的。 */
type TimingFields =
  | 'recentRequests' | 'decodedTokens' | 'decodeMs'
  | 'firstTokenWaitMs' | 'firstTokenCount'

/**
 * $.state 里存的统计：可能来自旧版本，缺新字段、带着旧字段。各版本的计时字段：
 * 只记速度的 recentSpeeds；从首个流式块计时的 streamedOutputTokens、streamMs；
 * 从发出请求计到响应结束的 timedOutputTokens、generationMs；TTFT 记到首个流式块的
 * firstChunkWaitMs、firstChunkCount。
 */
type StoredStats = Omit<SessionStats, TimingFields> &
  Partial<Pick<SessionStats, TimingFields>> & {
    recentSpeeds?: number[]
    streamedOutputTokens?: number
    streamMs?: number
    timedOutputTokens?: number
    generationMs?: number
    firstChunkWaitMs?: number
    firstChunkCount?: number
  }

/**
 * mod 重载后 $.state 里可能是旧版本的统计：用空统计补齐新加的字段。
 * 旧版本的速度与 TTFT 口径不同（见 StoredStats），合计与样本不能和新的混算，
 * 一并清掉，从下一次请求重新计。
 * 重载发生在轮次结束之后，此时没有进行中的轮次，开始时间一并清掉，
 * 免得错过的 turn.complete 让耗时一直往上涨。
 */
export function backfillStats(stored: SessionStats): SessionStats {
  const {
    recentSpeeds, streamedOutputTokens, streamMs, timedOutputTokens, generationMs,
    firstChunkWaitMs, firstChunkCount, ...current
  } = stored as StoredStats
  if (current.decodeMs === undefined) {
    const {
      recentRequests, decodedTokens, firstTokenWaitMs, firstTokenCount, ...rest
    } = current

    return { ...EMPTY_STATS, ...rest, mainTurnStartedAt: null }
  }

  return { ...EMPTY_STATS, ...current, mainTurnStartedAt: null }
}

/** 一次请求的 token 计入会话总量与缓存命中率。主对话和子 agent 的请求都调用。 */
export function addRequestUsage(stats: SessionStats, usage: ModelUsage): SessionStats {
  // 每次请求都会重发整段上下文，命中缓存的部分记在 cache_read 里，
  // 所以输入侧要把三项加起来，才是这次请求实际送进模型的 token。
  const promptTokens =
    usage.input_tokens +
    usage.cache_read_input_tokens +
    usage.cache_creation_input_tokens

  return {
    ...stats,
    totalTokens: stats.totalTokens + promptTokens + usage.output_tokens,
    promptTokens: stats.promptTokens + promptTokens,
    cacheReadTokens: stats.cacheReadTokens + usage.cache_read_input_tokens,
  }
}

/** 子 agent 一次请求的 token 另记一份合计（总量已由 addRequestUsage 计入）。 */
export function addAgentTokens(stats: SessionStats, usage: ModelUsage): SessionStats {
  const tokens =
    usage.input_tokens +
    usage.output_tokens +
    usage.cache_read_input_tokens +
    usage.cache_creation_input_tokens

  return { ...stats, agentTokens: stats.agentTokens + tokens }
}

/**
 * 主对话一次请求的计时计入速度与 TTFT。
 *
 * 速度按通行的单请求口径（vLLM、AIPerf、Artificial Analysis）：首 token 之后的
 * 输出 token 数除以首末 token 之间的时长。首 token 的到达是计时起点，不算在窗口里
 * 生成的 token 内。首末 token 同时到达的请求没有时长，只计 TTFT。
 */
export function addStreamTiming(
  stats: SessionStats,
  timing: StreamTiming,
): SessionStats {
  const hasDecodeTime = timing.decodeMs > 0
  const decodedTokens = hasDecodeTime ? Math.max(0, timing.outputTokens - 1) : 0
  const isSpeedSampled = timing.decodeMs >= MIN_SAMPLE_DECODE_MS
  const sample: RequestSample = {
    speed: isSpeedSampled ? decodedTokens / (timing.decodeMs / MS_PER_SECOND) : null,
    ttftMs: timing.ttftMs,
  }
  const recentRequests = [...stats.recentRequests, sample].slice(-MAX_REQUEST_SAMPLES)

  return {
    ...stats,
    decodedTokens: stats.decodedTokens + decodedTokens,
    decodeMs: stats.decodeMs + timing.decodeMs,
    firstTokenWaitMs: stats.firstTokenWaitMs + timing.ttftMs,
    firstTokenCount: stats.firstTokenCount + 1,
    recentRequests,
  }
}

/** 花费变了才记一个点；没变时原样返回，调用方据此判断要不要写回。 */
export function recordCost(stats: SessionStats, at: number, usd: number): SessionStats {
  const last = stats.costPoints[stats.costPoints.length - 1]
  if (last !== undefined && last.usd === usd) {
    return stats
  }

  return { ...stats, costPoints: appendThinned(stats.costPoints, { at, usd }) }
}

/**
 * 追加一个点；超过上限时隔一个删一个（保留最新的点），
 * 曲线变稀但仍覆盖整个会话，不会只剩最近一段。
 */
function appendThinned(points: CostPoint[], point: CostPoint): CostPoint[] {
  const appended = [...points, point]
  if (appended.length <= MAX_COST_POINTS) {
    return appended
  }

  const thinned = appended.filter((_, index) => index % 2 === 0)

  return thinned[thinned.length - 1] === point ? thinned : [...thinned, point]
}

export function startMainTurn(stats: SessionStats, startedAt: number): SessionStats {
  return { ...stats, mainTurnStartedAt: startedAt }
}

/** 主对话一轮结束：耗时按引擎报的时长计入，进行中标记清掉。 */
export function finishMainTurn(stats: SessionStats, durationMs: number): SessionStats {
  return { ...stats, workMs: stats.workMs + durationMs, mainTurnStartedAt: null }
}

export function addAgentTurn(stats: SessionStats, durationMs: number): SessionStats {
  return { ...stats, agentWorkMs: stats.agentWorkMs + durationMs }
}

export function addMainToolCall(stats: SessionStats, durationMs: number): SessionStats {
  return { ...stats, toolCalls: stats.toolCalls + 1, toolMs: stats.toolMs + durationMs }
}

export function addAgentToolCall(stats: SessionStats): SessionStats {
  return { ...stats, agentToolCalls: stats.agentToolCalls + 1 }
}

export function addCompaction(stats: SessionStats): SessionStats {
  return { ...stats, compactions: stats.compactions + 1 }
}

/**
 * /clear 之后会话从头算：清空全部计数。
 * 限额、花费等引擎读数不在这里，由下一次每秒刷新照引擎的新值显示。
 */
export function resetForClear(): SessionStats {
  return EMPTY_STATS
}
