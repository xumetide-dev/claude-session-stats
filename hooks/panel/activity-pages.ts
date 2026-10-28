import type { EngineReadings, SessionStats } from '../../types'
import { NO_READING, formatCount, formatShortDuration } from '../format'
import { tileFrame } from './cards'
import { avatar, lineIcon } from './icons'
import type { AvatarKind, LineIconName } from './icons'
import { COLORS } from './palette'
import { caption, escapeXml, fixed } from './primitives'
import type { Area } from './primitives'

// 桌面端面板第一张卡片的两页：子 agent 与主对话。两页版式相同：上面一条头部
// （头像、名称、状态），下面三个小方块（图标、数值、标签）。换页由 panel.ts 安排，
// 页码点画在头部右侧。

/** 两页用到的数据。 */
type ActivityInput = {
  stats: SessionStats
  readings: EngineReadings
  isWorking: boolean
}

/** 下面小方块里的一项：图标、数值、标签。 */
type TileItem = { icon: LineIconName; value: string; label: string }

const HEADER_INSET = 6
const HEADER_HEIGHT = 52
const AVATAR_SIZE = 34
const TILE_GAP = 6

/**
 * 第一页：子 agent。头部是此刻运行中的个数；小方块是会话至今所有子 agent 的
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
      { icon: 'grid', value: `${stats.agentToolCalls}次`, label: '工具' },
    ])
  )
}

/**
 * 第二页：主对话。头部是主对话此刻在不在跑一轮；小方块是用户发过几次 prompt、
 * 主对话的工具调用次数与耗时。工具耗时是各次调用的时长之和，并行的调用各自计时，
 * 合计可能超过会话的耗时。
 */
export function mainLoopPage(
  card: Area,
  { stats, readings, isWorking }: ActivityInput,
): string {
  const { promptCount } = readings
  const status = isWorking
    ? { label: '运行中', value: '', color: COLORS.accent }
    : { label: '空闲', value: '', color: COLORS.dim }

  return (
    header(card, 'main', '主对话', status) +
    tiles(card, [
      {
        icon: 'chat',
        value: promptCount === null ? NO_READING : String(promptCount),
        label: 'Prompt',
      },
      { icon: 'grid', value: `${stats.toolCalls}次`, label: '工具次数' },
      { icon: 'clock', value: formatShortDuration(stats.toolMs), label: '工具耗时' },
    ])
  )
}

/** 头部：一个浅一档的方块，里面是头像、名称，名称下面是带圆点的状态。 */
function header(
  card: Area,
  kind: AvatarKind,
  title: string,
  status: { label: string; value: string; color: string },
): string {
  const box = {
    x: card.x + HEADER_INSET, y: card.y + HEADER_INSET,
    w: card.w - 2 * HEADER_INSET, h: HEADER_HEIGHT,
  }
  const textX = box.x + 14 + AVATAR_SIZE + 10
  const statusY = box.y + 41
  const count =
    status.value === '' ? '' : `<tspan dx="3">${escapeXml(status.value)}</tspan>`

  return (
    tileFrame(box) +
    avatar(kind, box.x + 9, box.y + (HEADER_HEIGHT - AVATAR_SIZE) / 2, AVATAR_SIZE) +
    caption(textX, box.y + 22, title, { size: 13, color: COLORS.text }) +
    `<circle cx="${fixed(textX + 3)}" cy="${fixed(statusY - 3.5)}" r="3" ` +
    `fill="${status.color}"/>` +
    `<text x="${fixed(textX + 10)}" y="${fixed(statusY)}" font-size="11" ` +
    `fill="${status.color}"><tspan>${escapeXml(status.label)}</tspan>${count}</text>`
  )
}

/** 头部下面并排的三个小方块：左上角图标，中间数值，底部标签。 */
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
        lineIcon(item.icon, tile.x + 13, tile.y + 13, 13, COLORS.icon) +
        `<text x="${fixed(center)}" y="${fixed(tile.y + 37)}" font-size="13" ` +
        `font-weight="600" fill="${COLORS.text}" text-anchor="middle">` +
        `${escapeXml(item.value)}</text>` +
        caption(center, tile.y + height - 9, item.label, {
          size: 10.5, anchor: 'middle',
        })
      )
    })
    .join('')
}
