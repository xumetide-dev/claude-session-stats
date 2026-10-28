import type { EngineReadings, SessionStats } from '../../types'
import { NO_READING, formatCount, formatDuration } from '../format'
import { COLORS } from './palette'
import { caption, labelValue } from './primitives'
import type { Column } from './primitives'

// 桌面端面板第一栏的两页：子 agent 与主对话各自的次数与耗时。两页版式相同，
// 上面一个大号读数，下面是标签左对齐、数值右对齐的几行。换页由 panel.ts 安排。

/** 两页用到的数据。 */
type ActivityInput = { stats: SessionStats; readings: EngineReadings }

// 运行中的子 agent 一个画一个点，最多画这么多个，多出来的写 +N。
const MAX_AGENT_DOTS = 8
// 下半各行的基线：第一行的位置与行距。
const FIRST_ROW_Y = 114
const ROW_SPACING = 18

/**
 * 第一页：子 agent。上半是此刻运行中的个数，一个子 agent 一个点；
 * 下半是会话至今所有子 agent 的合计。
 */
export function agentsPage(
  column: Column,
  { stats, readings }: ActivityInput,
): string {
  const { x } = column
  const { runningAgents } = readings
  const running = runningAgents === null ? NO_READING : String(runningAgents)
  const runningColor = (runningAgents ?? 0) > 0 ? COLORS.accent : COLORS.text

  return (
    caption(x, 32, '子 agent', { size: 13 }) +
    labelValue(x, 58, '运行中', running, runningColor) +
    agentDots(x, 74, runningAgents ?? 0) +
    caption(x, 96, '合计', { size: 10 }) +
    alignedRows(column, [
      ['耗时', formatDuration(stats.agentWorkMs)],
      ['token', formatCount(stats.agentTokens)],
      ['工具', `${stats.agentToolCalls}次`],
    ])
  )
}

/**
 * 第二页：主对话。上半是用户发过几次 prompt；下半是主对话的工具调用次数与耗时。
 * 工具耗时是各次调用的时长之和，并行的调用各自计时，合计可能超过会话的耗时。
 */
export function mainLoopPage(
  column: Column,
  { stats, readings }: ActivityInput,
): string {
  const { x } = column
  const { promptCount } = readings
  const prompts = promptCount === null ? NO_READING : String(promptCount)

  return (
    caption(x, 32, '主对话', { size: 13 }) +
    labelValue(x, 58, 'Prompt', prompts) +
    caption(x, 96, '工具', { size: 10 }) +
    alignedRows(column, [
      ['次数', `${stats.toolCalls}次`],
      ['耗时', formatDuration(stats.toolMs)],
    ])
  )
}

/** 下半的几行：标签左对齐、数值右对齐。 */
function alignedRows({ x, w }: Column, rows: [string, string][]): string {
  return rows
    .map(([label, value], index) => {
      const y = FIRST_ROW_Y + index * ROW_SPACING

      return (
        caption(x, y, label) +
        caption(x + w, y, value, { color: COLORS.text, anchor: 'end' })
      )
    })
    .join('')
}

/** 运行中的子 agent 一个一个点；超过上限的写成 +N。 */
function agentDots(x: number, y: number, count: number): string {
  const shown = Math.min(count, MAX_AGENT_DOTS)
  const dots = Array.from({ length: shown }, (_, index) =>
    `<circle cx="${x + 4 + index * 10}" cy="${y}" r="3.5" ` +
    `fill="${COLORS.accent}"/>`,
  )
  const rest = count - shown
  const more =
    rest > 0 ? caption(x + 4 + shown * 10, y + 4, `+${rest}`, { size: 10 }) : ''

  return dots.join('') + more
}
