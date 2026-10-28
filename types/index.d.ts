/**
 * 本会话的累计统计：各事件钩子往里累加，状态栏只读它。
 *
 * 从 mod 在当前进程中加载那一刻开始计；mod 重载时保留，换了会话（/clear、/resume）
 * 时清零。
 */
export type SessionStats = {
  /**
   * 这些计数属于哪个会话（`$.session.id()`）；刚清零、还没对上会话时为 null。
   * 每秒对一次，换了会话就清零重计。
   */
  sessionId: string | null
  /** 主对话已生效的上下文压缩次数，不含预计算、被跳过的和子 agent 的。 */
  compactions: number
  /** 所有请求（主对话与子 agent）的 token 总和：输入、输出、缓存读、缓存写。 */
  totalTokens: number
  /** 输入侧 token（输入 + 缓存读 + 缓存写），缓存命中率的分母。 */
  promptTokens: number
  /** 缓存读 token，缓存命中率的分子。 */
  cacheReadTokens: number
  /** 主对话已结束各轮的耗时之和，毫秒。 */
  workMs: number
  /**
   * 主对话正在进行的那一轮的开始时间；没有进行中的轮次时为 null。mod 重载时保留：
   * 重载可能发生在一轮中途。漏掉了一轮的结束时可能留着旧值，状态栏按引擎的
   * isWorking 判断此刻在不在跑，不单看它。
   */
  mainTurnStartedAt: number | null
  /**
   * 主对话最后一轮的结束时间；还没有过轮次时为 null。mod 加载时会话已有轮次、
   * 却不知道最后一轮何时结束时，取加载时刻。会话时长算到这里：空闲时不再往上走。
   */
  lastTurnEndedAt: number | null
  /** 速度与 TTFT 的计时口径版本；与现行版本不同时，重载后计时的合计与样本清掉。 */
  timingVersion: number
  /**
   * 主对话各次请求首 token 之后的输出 token（含思考）之和，速度的分子。首末 token
   * 相隔不足 1 秒的请求不计。
   */
  decodedTokens: number
  /** 同一批请求从首 token 到末 token 的时长之和，毫秒，速度的分母。 */
  decodeMs: number
  /**
   * 主对话各次请求从发出到首 token 的时长之和，毫秒（TTFT 的分子）。思考的 token
   * 也算首 token：思考内容不显示时，取响应第一个块到达的时刻。
   */
  firstTokenWaitMs: number
  /** 计入 TTFT 的请求数（TTFT 的分母）。 */
  firstTokenCount: number
  /** 主对话的工具调用次数。 */
  toolCalls: number
  /** 主对话各次工具调用的耗时之和，毫秒；并行的调用各自计入。 */
  toolMs: number
  /** 子 agent 请求的 token 合计，已含在 totalTokens 里。 */
  agentTokens: number
  /** 子 agent 各轮的耗时之和，毫秒；并行的子 agent 各自计入。 */
  agentWorkMs: number
  /** 子 agent 的工具调用次数合计。 */
  agentToolCalls: number
  /** 主对话最近若干次请求的速度与 TTFT，旧的在前；面板画成双轴小图。 */
  recentRequests: RequestSample[]
  /** 花费每变化一次记一个点，旧的在前；点数超上限时隔一个删一个，保留整段走势。 */
  costPoints: CostPoint[]
}

/** 主对话一次请求的样本：速度柱子与 TTFT 曲线共用横轴。 */
export type RequestSample = {
  /** 输出速度，token/秒；首末 token 相隔不足 1 秒的请求为 null（速度是离群值）。 */
  speed: number | null
  /** 从发出请求到首 token，毫秒。 */
  ttftMs: number | null
}

/** 花费曲线上的一个点。 */
export type CostPoint = {
  /** 记录时刻，毫秒时间戳。 */
  at: number
  /** 当时的累计花费，美元。 */
  usd: number
}

/** 一个限额窗口的读数。 */
export type RateLimitReading = {
  /** 已用百分比，0 到 100，最多一位小数。 */
  percentUsed: number
  /** 重置时刻，毫秒时间戳；引擎没给时为 null。 */
  resetsAt: number | null
}

/**
 * 引擎当前的读数，每秒整体刷新一次。读数归引擎所有，mod 只照抄，不累加。
 */
export type EngineReadings = {
  /** 刷新时的时间，毫秒时间戳；尚未刷新时为 0。时间类指标都以它为"现在"。 */
  now: number
  /** 会话开始时间，毫秒时间戳；恢复的会话是首次启动的时间，/clear 后重新计。 */
  sessionStartedAt: number | null
  /** 用户发过的 prompt 数，含 mod 加载前的。 */
  promptCount: number | null
  /** 运行中（running 或 waiting）的子 agent 数。 */
  runningAgents: number | null
  /** 5 小时限额窗口；非订阅账号或尚无读数时为 null。 */
  fiveHour: RateLimitReading | null
  /** 7 天限额窗口；非订阅账号或尚无读数时为 null。 */
  sevenDay: RateLimitReading | null
  /** 本会话花费，美元；宿主不记账时为 null。 */
  costUsd: number | null
  /** 最近一次响应的输入 token（状态栏的读数）；最近一次响应之前为 null。 */
  contextTokens: number | null
  /** 模型的上下文窗口，token（状态栏的读数）；不是自动压缩窗口，后者见 ContextGrid。 */
  contextWindow: number | null
  /** contextTokens / contextWindow 的百分比，0 到 100；最近一次响应之前为 null。 */
  contextPercent: number | null
}

/**
 * 上下文格子里一个点（/context 那张格子图的一格）。
 * used 是已占用的内容，free 是剩余空间，buffer 是自动压缩的预留。
 */
export type ContextDot = {
  kind: 'used' | 'free' | 'buffer'
  /** 所属类别在 ContextGrid.usedCategories 里的下标，决定颜色；非 used 为 -1。 */
  categoryIndex: number
  /** 这一格占满的程度，0 到 1；/context 把低于 0.7 的画成空心。 */
  fullness: number
}

/**
 * /context 的结果：按行排列的点、used 各类别的名字（与颜色一一对应），
 * 以及 /context 算出的占用。桌面端的上下文指示与它一致，分母是自动压缩窗口。
 */
export type ContextGrid = {
  dots: ContextDot[][]
  usedCategories: string[]
  /** 已用 token：各类内容的估算之和，与状态栏的 contextTokens 可能略有出入。 */
  usedTokens: number
  /** 衡量占用的窗口：自动压缩窗口，可能小于模型的上下文窗口。 */
  windowTokens: number
  /** usedTokens / windowTokens 的整数百分比，引擎算好的。 */
  percent: number
}

declare module 'claude-code' {
  interface PluginState {
    'session-stats': {
      stats: SessionStats
      readings: EngineReadings
      grid: ContextGrid | null
      /** 桌面端面板是否收起成一行摘要；另存一份在 $.store，新会话沿用上次的状态。 */
      isCollapsed: boolean
    }
  }
}
