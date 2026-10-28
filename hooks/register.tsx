import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  HookStream,
  On,
  Register,
  TurnStepChunk,
  TurnStepResult,
} from 'claude-code'

import type { ContextGrid, EngineReadings, SessionStats } from '../types'
import { registerBand, restoreCollapsed } from './band'
import { rowsToText, toRows } from './format'
import { carouselPage } from './panel/panel'
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
  adoptSession,
  backfillStats,
  finishMainTurn,
  recordCost,
  resetForNewSession,
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

// 每秒刷新一次：主对话跑着一轮时时长与耗时按秒变化；读数来自引擎的现成查询，
// 不发请求。显示不变时不写回读数，空闲时状态栏不每秒重画（见 isDisplayChanged）。
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
 * 读一次引擎的读数，有变化时整体替换 readings；写入会让状态栏重画。
 * 限额是账号级的，与其他会话经共享文件交换，各窗口显示最新的一份。
 * 计数顺带对上当前会话、记下花费的变化（syncStats）。
 */
async function refreshReadings($: EngineInterface): Promise<void> {
  const [now, usage, agents, promptCount, sharedFile, sessionId] = await Promise.all([
    $.clock.now(),
    $.session.usage(),
    $.agent.list(),
    $.session.turns(),
    readSharedLimits($),
    $.session.id(),
  ])
  const own = toReadings({ now, usage, agents, promptCount })
  const latest = mergeSharedLimits(own, sharedFile)
  publishLimits($, latest, sharedFile)
  const currentStats = await syncStats($, {
    sessionId, now, promptCount, costUsd: latest.costUsd,
  })
  if (isDisplayChanged(await read($, readings), latest, currentStats)) {
    await update($, readings, () => latest)
  }
}

/**
 * 新读数要不要写回 $.state。每次写入都让状态栏重画一次，而 now 每秒都变；只在显示
 * 会变时写：除 now 之外的读数变了，终端那几行字变了（时长、耗时与重置倒计时；
 * 主对话跑着一轮时按秒走），或到了面板换页的时刻。面板上随时间连续变化的图形
 * （花费曲线的右端、限额的时间条）空闲时跟着这几种时刻一起更新，至少每 20 秒一次。
 */
function isDisplayChanged(
  previous: EngineReadings,
  next: EngineReadings,
  current: SessionStats,
): boolean {
  const withoutNow = (at: EngineReadings) => JSON.stringify({ ...at, now: 0 })
  const textOf = (at: EngineReadings) => rowsToText(toRows(current, at))

  return (
    withoutNow(previous) !== withoutNow(next) ||
    carouselPage(previous.now) !== carouselPage(next.now) ||
    textOf(previous) !== textOf(next)
  )
}

/**
 * 计数对上当前会话：/clear、/resume 之后换了会话就从头计（adoptSession），并立即
 * 重算上下文格子，不等 15 秒的定时刷新。花费变了就在花费曲线上记一个点。都没变时
 * 不写 stats。返回写入后的统计。
 */
async function syncStats(
  $: EngineInterface,
  current: {
    sessionId: string; now: number; promptCount: number; costUsd: number | null
  },
): Promise<SessionStats> {
  const { sessionId, now, promptCount, costUsd } = current
  const sync = (value: SessionStats) => {
    const adopted = adoptSession(value, { sessionId, loadedAt: now, promptCount })

    return costUsd === null ? adopted : recordCost(adopted, now, costUsd)
  }
  const stored = await read($, stats)
  if (sync(stored) === stored) {
    return stored
  }
  const written = await update($, stats, sync)
  if (stored.sessionId !== sessionId) {
    refreshGridSoon($)
  }

  return written
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
 * 会话开始与每次重载都会到这里：补齐旧版本统计的字段，计数对上当前会话（含不知道
 * 的最后一轮结束时刻），立即读一次引擎，读回上次的面板收起状态，再起每秒刷新的
 * 定时器（模块重载时引擎会取消旧定时器）。
 * /clear 与进程内的 /resume 不再触发 session.start：会话结束时清零计数，下一次
 * 刷新认下新会话。
 */
function registerRefresh(on: On): void {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const [loadedAt, promptCount, sessionId] = await Promise.all([
      $.clock.now(),
      $.session.turns(),
      $.session.id(),
    ])
    await update($, stats, current =>
      adoptSession(backfillStats(current), { sessionId, loadedAt, promptCount }),
    )
    await Promise.all([refreshReadings($), refreshGrid($), restoreCollapsed($)])
    repeat($, REFRESH_INTERVAL_MS, '刷新读数', () => refreshReadings($))
    repeat($, GRID_REFRESH_INTERVAL_MS, '刷新上下文格子', () => refreshGrid($))

    return started
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      await update($, stats, resetForNewSession)
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
 * 速度与 TTFT。块到达时先发出读时钟的请求、转发出去，再等时钟的回答：时刻仍是
 * 到达时的，转发不必等宿主那一来一回。
 * 流没读完就关了（请求失败或被中断）时结果拿不到，这次请求的 token 不计。
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
    const arrivedAt = $.clock.now()
    yield chunk
    times = markTokenTime(times, chunk.kind, await arrivedAt)
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
