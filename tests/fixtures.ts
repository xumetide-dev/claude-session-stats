import { mock } from 'claude-code/testing'
import type {
  AgentInfo,
  ContextGridSquare,
  On,
  SessionContextBreakdown,
  SessionRateLimit,
  TurnUsage,
} from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

import { SHARED_LIMITS_FILE } from '../hooks/shared-limits'

// 测试共用的引擎应答与读取工具。测试里 `on` 注册的钩子垫在插件下面，代替引擎作答。

export const START = 1_000_000
export const HOUR_MS = 3_600_000
/** 测试里的 HOME 与跨会话共享限额文件的路径；文件只在内存表里，不碰真实的 HOME。 */
export const TEST_HOME = '/home/test'
export const SHARED_LIMITS_PATH = `${TEST_HOME}/${SHARED_LIMITS_FILE}`

export const NO_USAGE: TurnUsage = {
  model: 'm',
  input_tokens: 0, output_tokens: 0,
  cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
}

export const BAND = {
  plugin: 'session-stats',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 160,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

/** 引擎这一侧的可变读数：测试改它，下一次每秒刷新就读到新值。 */
export type EngineSide = {
  rateLimits: SessionRateLimit[]
  costUsd: number
  agents: AgentInfo[]
  promptCount: number
  /** 状态栏的上下文读数：上下文窗口与最近一次响应的输入 token。 */
  context: { window: number; tokens: number; percent: number }
  /** /context 的结果，带 breakdown 的查询返回它。 */
  breakdown: SessionContextBreakdown
}

function square(categoryName: string, squareFullness: number): ContextGridSquare {
  return {
    color: 'inactive', isFilled: squareFullness > 0, categoryName,
    tokens: 0, percentage: 0, squareFullness,
  }
}

/**
 * 一张 2×2 的上下文格子：系统提示占满一格，消息半格，一格空闲，一格压缩预留。
 * 占用是 1.2 万 / 20 万；overrides 改占用或窗口。
 */
export function breakdownFixture(
  overrides: Partial<SessionContextBreakdown> = {},
): SessionContextBreakdown {
  const category = (name: string, kind: 'used' | 'free' | 'buffer') => ({
    name, tokens: 1000, color: 'inactive', isDeferred: false, kind,
  })

  return {
    categories: [
      category('System prompt', 'used'),
      category('Messages', 'used'),
      category('Free space', 'free'),
      category('Autocompact buffer', 'buffer'),
    ],
    totalTokens: 12_000, maxTokens: 200_000, rawMaxTokens: 200_000,
    autocompactSource: 'model-default', percentage: 6,
    gridRows: [
      [square('System prompt', 1), square('Messages', 0.5)],
      [square('Free space', 0), square('Autocompact buffer', 1)],
    ],
    model: 'm', memoryFiles: [], mcpTools: [], agents: [],
    isAutoCompactEnabled: true, apiUsage: null,
    ...overrides,
  }
}

/** answerEngine 交给测试的东西。 */
export type AnsweredEngine = {
  clock: MockClock
  engine: EngineSide
  /** $.store 的内容。 */
  stored: ReadonlyMap<string, unknown>
  /** $.fs 看到的文件：键是路径，值是内容；测试可预置，也可查看插件写了什么。 */
  files: Map<string, string>
}

/**
 * 用内存里的表回答 $.env.get('HOME') 与 $.fs 的读写，返回那张表。
 * 每个测试都要垫上：否则插件读写的会是真实 HOME 下的共享限额文件。
 */
export function answerFiles(on: On): Map<string, string> {
  const files = new Map<string, string>()
  mock.env(on, { HOME: TEST_HOME })
  on('fs.read', (_, e) => {
    const text = files.get(e.path)

    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)

    return { value: undefined }
  })

  return files
}

/**
 * 垫好会话开始所需的引擎应答，装上内存时钟（会话从 START 开始）、内存里的
 * $.store（store 是它开始时的内容，模拟上次会话存下的值）与内存里的文件。
 * 测试改读数后推进时钟即可看到刷新，查表即可看到插件存了什么、写了什么。
 */
export function answerEngine(
  on: On,
  store: Readonly<Record<string, unknown>> = {},
): AnsweredEngine {
  const clock = mock.clock(on, { now: START })
  const files = answerFiles(on)
  // 不用 mock.store：测试这一侧的 $ 没有 $.store，自己作答才能查看写入的值。
  const stored = new Map<string, unknown>(Object.entries(store))
  on('store.get', (_, e) => ({ value: stored.get(e.key) }))
  on('store.set', (_, e) => {
    stored.set(e.key, e.value)

    return { value: undefined }
  })
  const engine: EngineSide = {
    rateLimits: [], costUsd: 0, agents: [], promptCount: 0,
    context: { window: 200_000, tokens: 12_000, percent: 6 },
    breakdown: breakdownFixture(),
  }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', (_, e) => {
    const { context } = engine
    const isBreakdownAsked = e?.breakdown !== undefined
    const breakdown = isBreakdownAsked ? { breakdown: engine.breakdown } : {}

    return {
      value: {
        startedAt: START, context: { ...context, ...breakdown },
        rateLimits: engine.rateLimits, cost: { usd: engine.costUsd },
      },
    }
  })
  on('agent.list', () => ({ value: engine.agents }))
  on('session.turns', () => ({ value: engine.promptCount }))

  return { clock, engine, stored, files }
}

/** 一次立即结束的请求：一个文本块后返回给定的 usage。 */
export function answerSteps(on: On, usageOf: (turnId: string) => TurnUsage) {
  on('turn.step', async function* (_, e) {
    const usage = usageOf(e.turnId)
    yield { kind: 'text', index: 0, text: 'ok' }

    return {
      turnId: e.turnId, index: e.index, answer: 'ok',
      toolUses: [], stopReason: 'end_turn', usage,
    }
  })
}

/** 读完一条流，返回它的结果（测试端的流没有 `.result`）。 */
export async function drain<R>(stream: AsyncGenerator<unknown, R>): Promise<R> {
  let item = await stream.next()
  while (!item.done) {
    item = await stream.next()
  }

  return item.value
}

/** 桌面端画出的 Svg 元素的属性：source 与 alt。 */
export async function panelProps($: Engine): Promise<{ source: string; alt: string }> {
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svg = await ui.find({ type: 'Svg' })
  await ui.unmount()

  return { source: String(svg?.props.source ?? ''), alt: String(svg?.props.alt ?? '') }
}

/** 状态栏的文字：桌面端取 Svg 的 alt，终端取画出来的全部文字。 */
export async function bandText(
  $: Engine,
  surface: 'desktop' | 'terminal',
): Promise<string> {
  if (surface === 'desktop') {
    return (await panelProps($)).alt
  }

  const ui = await $.ui.mount({ ...BAND, surface })
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()

  return texts.map(text => text.text).join(' ')
}

export function agent(id: string, status: AgentInfo['status']): AgentInfo {
  return { id, description: id, type: 'general-purpose', status }
}
