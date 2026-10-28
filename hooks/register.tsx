import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  HookStream,
  On,
  Register,
  TurnStepChunk,
  TurnStepResult,
} from 'claude-code'

import type { ContextGrid } from '../types'
import { registerBand, restoreCollapsed } from './band'
import { EMPTY_READINGS, toContextGrid, toReadings } from './readings'
import { mergeSharedLimits, publishLimits, readSharedLimits } from './shared-limits'
import {
  EMPTY_STATS,
  addAgentToolCall,
  addAgentTokens,
  addAgentTurn,
  addCompaction,
  addMainToolCall,
  addRequestUsage,
  addStreamTiming,
  backfillStats,
  finishMainTurn,
  recordCost,
  resetForClear,
  startMainTurn,
} from './stats'
import { markTokenTime, toStreamTiming } from './token-times'
import type { TokenTimes } from './token-times'

// 计数与读数：会话开始后定时读引擎，按轮次、工具调用与模型请求累加 stats。
// 输入框上方状态栏的绘制在 band.tsx。

// 数据放在 $.state 里：mod 热重载时模块变量会清空，$.state 在整个会话内保留。
// stats 是 mod 自己累加的计数；readings 是每秒从引擎读一次的读数；
// grid 是桌面端面板用的上下文格子。
const stats = atom(
  { plugin: 'session-stats', key: 'stats' } as const,
  EMPTY_STATS,
)
const readings = atom(
  { plugin: 'session-stats', key: 'readings' } as const,
  EMPTY_READINGS,
)
const grid = atom(
  { plugin: 'session-stats', key: 'grid' } as const,
  null as ContextGrid | null,
)

// 每秒刷新一次：时长、耗时、重置倒计时按秒变化；读数来自引擎的现成查询，不发请求。
const REFRESH_INTERVAL_MS = 1000
// 上下文格子（含上下文占用）在主对话每次请求结束后刷新一次，另有 15 秒一次的
// 定时刷新兜底：它要在本地按类别估算 token，比读数贵，而且只在请求之间变化，
// 不需要每秒更新。
const GRID_REFRESH_INTERVAL_MS = 15_000

export const register: Register = on => {
  registerRefresh(on)
  registerTurnCounters(on)
  registerToolCounters(on)
  registerRequestCounters(on)
  registerBand(on)
}

/**
 * 读一次引擎的读数，整体替换 readings；写入会让状态栏重画。
 * 限额是账号级的，与其他会话经共享文件交换，各窗口显示最新的一份。
 * 花费变了就在花费曲线上记一个点，没变不写 stats。
 */
async function refreshReadings($: EngineInterface): Promise<void> {
  const [now, usage, agents, promptCount, shared] = await Promise.all([
    $.clock.now(),
    $.session.usage(),
    $.agent.list(),
    $.session.turns(),
    readSharedLimits($),
  ])
  const own = toReadings({ now, usage, agents, promptCount })
  const latest = mergeSharedLimits(own, shared)
  await update($, readings, () => latest)
  publishLimits($, latest, shared)

  const { costUsd } = latest
  if (costUsd === null) {
    return
  }
  const current = await read($, stats)
  if (recordCost(current, now, costUsd) !== current) {
    await update($, stats, value => recordCost(value, now, costUsd))
  }
}

/** 按 /context 的方式在本地估算一次上下文构成与占用（不发请求），替换 grid。 */
async function refreshGrid($: EngineInterface): Promise<void> {
  const { context } = await $.session.usage({ breakdown: 'summary' })
  const { breakdown } = context
  if (breakdown !== undefined) {
    await update($, grid, () => toContextGrid(breakdown))
  }
}

/**
 * 每隔 intervalMs 跑一次 task。失败只影响这一次的显示；同一原因会反复出现，
 * 所以每个任务只把第一次失败记到调试日志。
 */
function repeat(
  $: EngineInterface,
  intervalMs: number,
  name: string,
  task: () => Promise<void>,
): void {
  let hasLoggedFailure = false
  $.clock.every(intervalMs, () => {
    task().catch((error: unknown) => {
      if (!hasLoggedFailure) {
        hasLoggedFailure = true
        $.ui.log(`session-stats: ${name}失败: ${String(error)}`, { to: 'debug' })
      }
    })
  })
}

/**
 * 会话开始与每次重载都会到这里：补齐旧版本统计的字段，立即读一次引擎，
 * 读回上次的面板收起状态，再起每秒刷新的定时器（模块重载时引擎会取消旧定时器）。
 * /clear 时清零计数。
 */
function registerRefresh(on: On): void {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await update($, stats, backfillStats)
    await Promise.all([refreshReadings($), refreshGrid($), restoreCollapsed($)])
    repeat($, REFRESH_INTERVAL_MS, '刷新读数', () => refreshReadings($))
    repeat($, GRID_REFRESH_INTERVAL_MS, '刷新上下文格子', () => refreshGrid($))

    return started
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, stats, resetForClear)
    }

    return next(e)
  })
}

/** 轮次：主对话的开始时刻与耗时、子 agent 的耗时、主对话的压缩次数。 */
function registerTurnCounters(on: On): void {
  // 主对话一轮开始时记下时刻，状态栏据此每秒推进"耗时"，不必等这一轮结束。
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const startedAt = await $.clock.now()
      await update($, stats, current => startMainTurn(current, startedAt))
    }

    return next(e)
  })

  // 耗时按主对话与子 agent 分开记：两者的时间是重叠的。
  on('turn.complete', async ($, e, next) => {
    const { durationMs } = e
    const isMainLoop = e.agentId === undefined
    const endedAt = await $.clock.now()
    await update($, stats, current =>
      isMainLoop
        ? finishMainTurn(current, { durationMs, endedAt })
        : addAgentTurn(current, durationMs),
    )

    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    // 只计主对话真正生效的压缩：预计算只是提前算好摘要，被跳过的没有改动对话，
    // 子 agent 压缩的是它自己的上下文。
    const isMainLoop = e.agentId === undefined
    const isApplied = e.trigger !== 'precompute' && compacted.skip === undefined
    if (isMainLoop && isApplied) {
      await update($, stats, addCompaction)
    }

    return compacted
    // 这个钩子只观察。计数出错时压缩照常进行：已调用过 next 时 next(e) 回放那次结果，
    // 不会再压缩一遍。
  }).catch(($, e, next) => next(e))
}

/** 工具调用：主对话的计次数与耗时，子 agent 的只计次数。 */
function registerToolCounters(on: On): void {
  on('tool.call', async ($, e, next) => {
    const startedAt = await $.clock.now()
    const ran = await next(e)
    const durationMs = (await $.clock.now()) - startedAt
    const isMainLoop = e.agentId === undefined
    await update($, stats, current =>
      isMainLoop ? addMainToolCall(current, durationMs) : addAgentToolCall(current),
    )

    return ran
    // 这个钩子只观察。计数出错时工具照常运行：已调用过 next 时 next(e) 回放那次结果，
    // 不会再运行一遍。
  }).catch(($, e, next) => next(e))
}

/**
 * 模型请求：token 在每次请求结束时计入（主对话与子 agent 都计），不必等一整轮结束。
 * 速度与 TTFT 只计主对话：子 agent 常用别的模型并且并行运行，混进来就不是
 * 正在看的那个模型的数字。
 */
function registerRequestCounters(on: On): void {
  on('turn.step', async function* ($, e, next) {
    const requestedAt = await $.clock.now()
    const stream = next(e)
    if (e.agentId === undefined) {
      const answered = yield* forwardMainRequest($, stream, requestedAt)
      refreshGridSoon($)

      return answered
    }

    const response = yield* stream
    const { usage } = response
    if (usage !== null) {
      await update($, stats, current =>
        addAgentTokens(addRequestUsage(current, usage), usage),
      )
    }

    return response
  })
}

/**
 * 请求结束后刷新上下文格子，占用不必等定时刷新。不等它算完：估算放在后台，
 * 不拖慢这次请求的返回。失败只记调试日志，下一次定时刷新会补上。
 */
function refreshGridSoon($: EngineInterface): void {
  refreshGrid($).catch((error: unknown) => {
    $.ui.log(`session-stats: 刷新上下文格子失败: ${String(error)}`, { to: 'debug' })
  })
}

/**
 * 转发主对话一次请求的流，记下首 token 与末 token 的到达时刻；流结束后计入 token、
 * 速度与 TTFT。
 *
 * 首末 token 怎么认见 token-times.ts。
 */
async function* forwardMainRequest(
  $: EngineInterface,
  stream: HookStream<TurnStepChunk, TurnStepResult>,
  requestedAt: number,
): AsyncGenerator<TurnStepChunk, TurnStepResult> {
  let times: TokenTimes = {}
  for await (const chunk of stream) {
    times = markTokenTime(times, chunk.kind, await $.clock.now())
    yield chunk
  }
  const response = await stream.result
  const { usage } = response
  if (usage === null) {
    return response
  }

  const timing = toStreamTiming(times, requestedAt, usage.output_tokens)
  await update($, stats, current => {
    const counted = addRequestUsage(current, usage)

    return timing === null ? counted : addStreamTiming(counted, timing)
  })

  return response
}
