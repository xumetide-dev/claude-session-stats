import type {
  AgentInfo,
  AgentStatus,
  ContextGridSquare,
  SessionContextBreakdown,
  SessionRateLimit,
  SessionUsage,
} from 'claude-code'

import type {
  ContextDot,
  ContextGrid,
  EngineReadings,
  RateLimitReading,
} from '../types'

// 把引擎几处查询的结果整理成状态栏要的读数。纯函数，不累加，每次整体替换。

export const EMPTY_READINGS: EngineReadings = {
  now: 0,
  sessionStartedAt: null,
  promptCount: null,
  runningAgents: null,
  fiveHour: null,
  sevenDay: null,
  costUsd: null,
  contextTokens: null,
  contextWindow: null,
  contextPercent: null,
}

/** 一次刷新从引擎读到的原始结果。 */
export type EngineSnapshot = {
  now: number
  usage: SessionUsage
  agents: readonly AgentInfo[]
  promptCount: number
}

// waiting 是子 agent 在运行途中被挂起（等它自己的后台任务、等审批），仍算运行中。
const ACTIVE_AGENT_STATUSES: readonly AgentStatus[] = ['running', 'waiting']

export function toReadings(snapshot: EngineSnapshot): EngineReadings {
  const { now, usage, agents, promptCount } = snapshot
  const { context } = usage
  const runningAgents = agents.filter(agent =>
    ACTIVE_AGENT_STATUSES.includes(agent.status),
  ).length
  // 引擎没给百分比时按 tokens / window 自己算。
  const contextPercent =
    context.percent ??
    (context.tokens === undefined ? null : (context.tokens / context.window) * 100)

  return {
    now,
    sessionStartedAt: usage.startedAt,
    promptCount,
    runningAgents,
    fiveHour: rateLimitOf(usage.rateLimits, 'five_hour'),
    sevenDay: rateLimitOf(usage.rateLimits, 'seven_day'),
    costUsd: usage.cost?.usd ?? null,
    contextTokens: context.tokens ?? null,
    contextWindow: context.window,
    contextPercent,
  }
}

/**
 * 把 /context 的格子整理成面板要的点阵。颜色字段是主题键名，SVG 里解析不了，
 * 所以只保留"属于哪一类"，颜色由面板按类别序号从自己的调色板里取。
 */
export function toContextGrid(breakdown: SessionContextBreakdown): ContextGrid {
  const usedCategories = breakdown.categories
    .filter(category => category.kind === 'used')
    .map(category => category.name)
  const kindOf = new Map(
    breakdown.categories.map(category => [category.name, category.kind]),
  )
  const toDot = (square: ContextGridSquare): ContextDot => {
    const kind = kindOf.get(square.categoryName)
    if (kind === 'used') {
      const categoryIndex = usedCategories.indexOf(square.categoryName)

      return { kind, categoryIndex, fullness: square.squareFullness }
    }

    // 格子里没有 deferred（按需加载的工具不占窗口）；对不上名字的按空闲画。
    const dotKind = kind === 'buffer' ? 'buffer' : 'free'

    return { kind: dotKind, categoryIndex: -1, fullness: square.squareFullness }
  }

  return {
    dots: breakdown.gridRows.map(row => row.map(toDot)),
    usedCategories,
    usedTokens: breakdown.totalTokens,
    windowTokens: breakdown.rawMaxTokens,
    percent: breakdown.percentage,
  }
}

function rateLimitOf(
  rateLimits: readonly SessionRateLimit[],
  kind: string,
): RateLimitReading | null {
  const window = rateLimits.find(limit => limit.kind === kind)
  if (window === undefined) {
    return null
  }

  const resetsAt = window.resetsAt === undefined ? NaN : Date.parse(window.resetsAt)

  return {
    percentUsed: window.percentUsed,
    resetsAt: Number.isNaN(resetsAt) ? null : resetsAt,
  }
}
