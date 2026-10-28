import type { ModelUsage } from 'claude-code'

import type { CostPoint, RequestSample, SessionStats } from '../types'

// 统计的累加规则。全部是纯函数：输入旧统计，返回新统计，由 register.tsx 经
// `update($, atom, fn)` 写回 $.state。

// 速度与 TTFT 的计时口径版本，口径改了就加一：重载后旧口径的合计与样本整条清掉，
// 不与新的混算。1：首 token 取思考块的开始，不足 0.5 秒的请求计入总速度；
// 2：首 token 取响应的第一个块（见 token-times.ts），不足 1 秒的请求不计速度。
export const TIMING_VERSION = 2

export const EMPTY_STATS: SessionStats = {
  sessionId: null,
  compactions: 0,
  totalTokens: 0,
  promptTokens: 0,
  cacheReadTokens: 0,
  workMs: 0,
  mainTurnStartedAt: null,
  lastTurnEndedAt: null,
  timingVersion: TIMING_VERSION,
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
// 首末 token 相隔不足 1 秒的请求不计速度，总速度与小图的柱子都不计（TTFT 照记）：
// token 是一批一批到达的（工具参数整段到达，思考期间只有空块），窗口短时一批的
// 早晚就能让速度差出几倍。实测（2026-10-28，31 次请求）：窗口 1 到 1.7 秒的请求是
// 102–143 tok/s，与长请求同一范围；不足 1 秒的 3 次是 171、5810 tok/s 这类离群值。
const MIN_SPEED_WINDOW_MS = 1000
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
  | 'timingVersion' | 'recentRequests' | 'decodedTokens' | 'decodeMs'
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
 * 旧版本的速度与 TTFT 口径不同（见 StoredStats 与 TIMING_VERSION），合计与样本
 * 不能和新的混算，一并清掉，从下一次请求重新计。
 * 进行中那一轮的开始时间保留：重载可能发生在一轮中途，新模块照样收得到这一轮的
 * turn.complete。万一漏掉了，状态栏按引擎的 isWorking 判断空闲（见 band.tsx），
 * 下一轮开始时覆盖掉。
 */
export function backfillStats(stored: SessionStats): SessionStats {
  const {
    recentSpeeds, streamedOutputTokens, streamMs, timedOutputTokens, generationMs,
    firstChunkWaitMs, firstChunkCount, ...current
  } = stored as StoredStats
  const isCurrentTiming =
    current.decodeMs !== undefined && current.timingVersion === TIMING_VERSION
  if (!isCurrentTiming) {
    const {
      timingVersion, recentRequests, decodedTokens, decodeMs,
      firstTokenWaitMs, firstTokenCount, ...rest
    } = current

    return { ...EMPTY_STATS, ...rest }
  }

  return { ...EMPTY_STATS, ...current }
}

/**
 * 把计数对上当前会话。会话没换时原样返回。计数刚清零（sessionId 为 null）时认下
 * 当前会话，计数不动。换了会话（/clear、/resume 之后，旧会话的计数还在）时从头计。
 * 认下会话时按 assumeTurnEndedBy 补上最后一轮的结束时刻：恢复的会话已有轮次。
 */
export function adoptSession(
  stats: SessionStats,
  current: { sessionId: string; loadedAt: number; promptCount: number | null },
): SessionStats {
  if (stats.sessionId === current.sessionId) {
    return stats
  }
  const base = stats.sessionId === null ? stats : EMPTY_STATS

  return assumeTurnEndedBy(
    { ...base, sessionId: current.sessionId },
    current.loadedAt,
    current.promptCount,
  )
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
 * 生成的 token 内。首末 token 相隔不足 MIN_SPEED_WINDOW_MS 的请求只计 TTFT。
 */
export function addStreamTiming(
  stats: SessionStats,
  timing: StreamTiming,
): SessionStats {
  const isSpeedCounted = timing.decodeMs >= MIN_SPEED_WINDOW_MS
  const decodedTokens = isSpeedCounted ? Math.max(0, timing.outputTokens - 1) : 0
  const decodeMs = isSpeedCounted ? timing.decodeMs : 0
  const sample: RequestSample = {
    speed: isSpeedCounted ? decodedTokens / (decodeMs / MS_PER_SECOND) : null,
    ttftMs: timing.ttftMs,
  }
  const recentRequests = [...stats.recentRequests, sample].slice(-MAX_REQUEST_SAMPLES)

  return {
    ...stats,
    decodedTokens: stats.decodedTokens + decodedTokens,
    decodeMs: stats.decodeMs + decodeMs,
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

/** 主对话一轮结束：耗时按引擎报的时长计入，记下结束时刻，进行中标记清掉。 */
export function finishMainTurn(
  stats: SessionStats,
  turn: { durationMs: number; endedAt: number },
): SessionStats {
  return {
    ...stats,
    workMs: stats.workMs + turn.durationMs,
    mainTurnStartedAt: null,
    lastTurnEndedAt: turn.endedAt,
  }
}

/**
 * mod 加载（会话开始、重载插件、恢复会话）时补上不知道的最后一轮结束时刻：会话
 * 已经有过轮次、统计里却没有这一项（升级前的统计没有，恢复的会话在别的进程里
 * 或换会话之前跑过），按加载时刻算，最后一轮至迟在这时已经结束。下一轮结束时
 * 换成准确的时刻。还没有过轮次、或已经知道时原样返回。
 */
export function assumeTurnEndedBy(
  stats: SessionStats,
  loadedAt: number,
  promptCount: number | null,
): SessionStats {
  const hasTurns = (promptCount ?? 0) > 0 || stats.workMs > 0
  if (stats.lastTurnEndedAt !== null || !hasTurns) {
    return stats
  }

  return { ...stats, lastTurnEndedAt: loadedAt }
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
 * 换会话（/clear 或 /resume）时从头算：清空全部计数，sessionId 留空，由下一次
 * 每秒刷新认下新会话（adoptSession）。限额、花费等引擎读数不在这里，由刷新照
 * 引擎的新值显示。
 */
export function resetForNewSession(): SessionStats {
  return EMPTY_STATS
}
