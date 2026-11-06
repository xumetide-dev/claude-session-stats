import type { EngineReadings, SessionStats, ToolTally } from '../../types'
import { NO_READING, formatCount, formatModelName, formatShortDuration } from '../format'
import { tileFrame } from './cards'
import { avatar, lineIcon } from './icons'
import type { AvatarKind, LineIconName } from './icons'
import { COLORS } from './palette'
import {
  caption, escapeXml, fitFontSize, fixed, textEm, truncateToWidth,
} from './primitives'
import type { Area } from './primitives'

// 桌面端面板第一张卡片的三页：主对话、子 agent、工具分布。三页版式相同：上面一条
// 头部（头像、名称、状态），下面三个小方块（左上角图标或小字、数值、标签）。换页由
// panel.ts 安排，页码点画在头部右侧。

/** 两页用到的数据。 */
type ActivityInput = {
  stats: SessionStats
  readings: EngineReadings
  isWorking: boolean
}

/**
 * 下面小方块里的一项：数值、标签，左上角是图标或一段小字（note），右上角可另有
 * 一段红色小字（alert）。
 */
type TileItem = {
  value: string
  label: string
  icon?: LineIconName
  note?: string
  alert?: string
}

const HEADER_INSET = 6
const HEADER_HEIGHT = 52
const AVATAR_SIZE = 34
const TILE_GAP = 6
const TILE_VALUE_SIZE = 13
// 头部状态一行：状态字的字号；状态后面补充说明（模型与 effort）的字号与间隔。
const STATUS_SIZE = 11
const STATUS_DETAIL_SIZE = 10
const STATUS_DETAIL_GAP = 4
// 状态一行右端离头部方块右边缘的留白。
const STATUS_RIGHT_INSET = 8
// 小方块角上小字的字号与离边缘的距离；标签的字号。
const TILE_CORNER_SIZE = 9.5
const TILE_CORNER_INSET = 6
const TILE_LABEL_SIZE = 10.5
// 工具分布页列出按耗时排前几的工具。
const TOP_TOOL_COUNT = 3

/**
 * 第二页：子 agent。头部是此刻运行中的个数；小方块是会话至今所有子 agent 的
 * 合计耗时、token 与工具调用次数。
 */
export function agentsPage(card: Area, { stats, readings }: ActivityInput): string {
  const { runningAgents } = readings
  const isRunning = (runningAgents ?? 0) > 0
  const status = {
    label: '运行中',
    value: runningAgents === null ? NO_READING : String(runningAgents),
    color: isRunning ? COLORS.accent : COLORS.dim,
  }

  return (
    header(card, 'agent', '子 agent', status) +
    tiles(card, [
      { icon: 'clock', value: formatShortDuration(stats.agentWorkMs), label: '合计耗时' },
      { icon: 'database', value: formatCount(stats.agentTokens), label: 'token' },
      { icon: 'grid', value: `${stats.agentToolCalls}次`, label: '工具调用' },
    ])
  )
}

/**
 * 第一页：主对话。头部是主对话此刻在不在跑一轮，后面跟着模型与 effort 档位；小方块
 * 是用户发过几次 prompt、主对话的工具调用次数与耗时。工具耗时是各次调用的时长之和，
 * 并行的调用各自计时，合计可能超过会话的耗时。
 */
export function mainLoopPage(
  card: Area,
  { stats, readings, isWorking }: ActivityInput,
): string {
  const { promptCount } = readings
  const detail = modelDetail(readings.model, stats.effort)
  const status = isWorking
    ? { label: '运行中', value: '', color: COLORS.accent, detail }
    : { label: '空闲', value: '', color: COLORS.dim, detail }

  return (
    header(card, 'main', '主对话', status) +
    tiles(card, [
      {
        icon: 'chat',
        value: promptCount === null ? NO_READING : String(promptCount),
        label: 'Prompt',
      },
      { icon: 'grid', value: `${stats.toolCalls}次`, label: '工具调用' },
      { icon: 'clock', value: formatShortDuration(stats.toolMs), label: '工具耗时' },
    ])
  )
}

/**
 * 第三页：工具分布，回答主对话的工具耗时花在哪。头部是按工具记下的合计次数与耗时；
 * 小方块是按耗时排前三的工具：耗时、工具名、调用次数，有失败时右上角写红字。
 * 统计从插件加入按工具计数之后开始，所以合计可能少于主对话页的工具调用与耗时。
 */
export function toolsPage(card: Area, { stats }: ActivityInput): string {
  const tallies = Object.entries(stats.toolBreakdown)
  const calls = tallies.reduce((sum, [, tally]) => sum + tally.calls, 0)
  const ms = tallies.reduce((sum, [, tally]) => sum + tally.ms, 0)
  const status = {
    label: `合计 ${calls}次 · ${formatShortDuration(ms)}`,
    value: '',
    color: COLORS.dim,
  }
  const items = topTools(stats.toolBreakdown, TOP_TOOL_COUNT).map(toolTile)
  const placeholders = Array.from(
    { length: TOP_TOOL_COUNT - items.length },
    () => ({ value: NO_READING, label: '' }),
  )

  return (
    header(card, 'tools', '工具分布', status) +
    tiles(card, [...items, ...placeholders])
  )
}

/** 按耗时从多到少排的前 count 个工具；耗时相同的按调用次数。 */
export function topTools(
  breakdown: Readonly<Record<string, ToolTally>>,
  count: number,
): { tool: string; tally: ToolTally }[] {
  return Object.entries(breakdown)
    .map(([tool, tally]) => ({ tool, tally }))
    .sort((a, b) => b.tally.ms - a.tally.ms || b.tally.calls - a.tally.calls)
    .slice(0, count)
}

/**
 * 小方块上的工具名：MCP 工具（mcp__服务器__工具）只留最后的工具名，服务器名太长，
 * 小方块放不下。
 */
export function displayToolName(tool: string): string {
  const MCP_PREFIX = 'mcp__'
  if (!tool.startsWith(MCP_PREFIX)) {
    return tool
  }
  const name = tool.slice(tool.lastIndexOf('__') + 2)

  return name === '' ? tool : name
}

function toolTile({ tool, tally }: { tool: string; tally: ToolTally }): TileItem {
  const alert = tally.failures > 0 ? `失败${tally.failures}` : undefined

  return {
    value: formatShortDuration(tally.ms),
    label: displayToolName(tool),
    note: `${tally.calls}次`,
    ...(alert === undefined ? {} : { alert }),
  }
}

/** 主对话状态后面的补充说明："· Opus 5.5 · high"；两样都没有时为空串。 */
function modelDetail(model: string | null, effort: string | null): string {
  const parts = [model === null ? null : formatModelName(model), effort]
    .filter((part): part is string => part !== null && part !== '')

  return parts.map(part => `· ${part}`).join(' ')
}

/** 头部状态：圆点与文字的颜色、状态字、可选的计数与补充说明（暗色、小一号）。 */
type HeaderStatus = { label: string; value: string; color: string; detail?: string }

/**
 * 头部：一个浅一档的方块，里面是头像、名称，名称下面是带圆点的状态。状态后面的
 * 补充说明放不下时从末尾截断。
 */
function header(
  card: Area,
  kind: AvatarKind,
  title: string,
  status: HeaderStatus,
): string {
  const box = {
    x: card.x + HEADER_INSET, y: card.y + HEADER_INSET,
    w: card.w - 2 * HEADER_INSET, h: HEADER_HEIGHT,
  }
  const textX = box.x + 14 + AVATAR_SIZE + 10
  const statusX = textX + 10
  const statusY = box.y + 41
  const count =
    status.value === '' ? '' : `<tspan dx="3">${escapeXml(status.value)}</tspan>`
  const statusWidth = textEm(status.label + status.value) * STATUS_SIZE
  const detailRoom =
    box.x + box.w - STATUS_RIGHT_INSET - statusX - statusWidth - STATUS_DETAIL_GAP
  const detail = truncateToWidth(status.detail ?? '', detailRoom, STATUS_DETAIL_SIZE)
  const detailSpan =
    detail === ''
      ? ''
      : `<tspan dx="${STATUS_DETAIL_GAP}" font-size="${STATUS_DETAIL_SIZE}" ` +
        `fill="${COLORS.dim}">${escapeXml(detail)}</tspan>`

  return (
    tileFrame(box) +
    avatar(kind, box.x + 9, box.y + (HEADER_HEIGHT - AVATAR_SIZE) / 2, AVATAR_SIZE) +
    caption(textX, box.y + 22, title, { size: 13, color: COLORS.text }) +
    `<circle cx="${fixed(textX + 3)}" cy="${fixed(statusY - 3.5)}" r="3" ` +
    `fill="${status.color}"/>` +
    `<text x="${fixed(statusX)}" y="${fixed(statusY)}" font-size="${STATUS_SIZE}" ` +
    `fill="${status.color}"><tspan>${escapeXml(status.label)}</tspan>${count}` +
    `${detailSpan}</text>`
  )
}

/**
 * 头部下面并排的三个小方块：左上角图标或小字，右上角可有红字，中间数值，底部标签。
 * 标签放不下时从末尾截断。
 */
function tiles(card: Area, items: TileItem[]): string {
  const top = card.y + HEADER_INSET + HEADER_HEIGHT + TILE_GAP
  const height = card.y + card.h - HEADER_INSET - top
  const room = card.w - 2 * HEADER_INSET - (items.length - 1) * TILE_GAP
  const width = room / items.length

  return items
    .map((item, index) => {
      const tile = {
        x: card.x + HEADER_INSET + index * (width + TILE_GAP),
        y: top, w: width, h: height,
      }
      const center = tile.x + width / 2

      return (
        tileFrame(tile) +
        tileCorners(tile, item) +
        `<text x="${fixed(center)}" y="${fixed(tile.y + 37)}" ` +
        `font-size="${fitFontSize(item.value, width - 8, TILE_VALUE_SIZE)}" ` +
        `font-weight="600" fill="${COLORS.text}" text-anchor="middle">` +
        `${escapeXml(item.value)}</text>` +
        caption(
          center,
          tile.y + height - 9,
          truncateToWidth(item.label, width - 8, TILE_LABEL_SIZE),
          { size: TILE_LABEL_SIZE, anchor: 'middle' },
        )
      )
    })
    .join('')
}

/** 小方块的两个上角：左上角图标或暗色小字，右上角红字。 */
function tileCorners(tile: Area, item: TileItem): string {
  const baseline = tile.y + TILE_CORNER_INSET + TILE_CORNER_SIZE - 1
  const left =
    item.icon !== undefined
      ? lineIcon(item.icon, tile.x + 13, tile.y + 13, 13, COLORS.icon)
      : caption(tile.x + TILE_CORNER_INSET, baseline, item.note ?? '', {
          size: TILE_CORNER_SIZE,
        })
  const right =
    item.alert === undefined
      ? ''
      : caption(tile.x + tile.w - TILE_CORNER_INSET, baseline, item.alert, {
          size: TILE_CORNER_SIZE, color: COLORS.error, anchor: 'end',
        })

  return left + right
}
