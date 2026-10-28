import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, On } from 'claude-code'

import type { ContextGrid } from '../types'
import { rowsToText, toRows } from './format'
import type { Row, Segment } from './format'
import { buildPanelSvg } from './panel/panel'
import { EMPTY_READINGS } from './readings'
import { EMPTY_STATS } from './stats'

// 与 register.tsx 同一组 $.state 值，这里只读。引擎加载时静态扫描 read 与 update
// 的来源，要求是本文件里用 atom 声明的常量，不能从别的模块导入，所以每个文件各声明
// 一遍。atom 只是一份描述，不向引擎登记任何东西；两边的初值取同一份 EMPTY_*，
// 键名与类型由 types/index.d.ts 的 PluginState 约束。
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
// 桌面端面板是否收起。只有这个值归 band.tsx 写：由面板上的按钮切换。
const collapsed = atom(
  { plugin: 'session-stats', key: 'isCollapsed' } as const,
  false,
)
// 收起状态在 $.store 里的键。$.state 只在本会话内保留，每次切换另写一份到
// $.store，会话开始时读回来，新会话沿用上次的状态。
const COLLAPSED_STORE_KEY = 'isCollapsed'

/**
 * 输入框上方的状态栏，读到的数据任一变化即重画。桌面端画图形面板（Svg），
 * 其余端画几行小字；面板的 alt 就是这几行字，读屏与不能显示图片时用。
 * 桌面端面板上方有"收起"按钮，收起后只剩第一行摘要与"展开"按钮；
 * 终端的状态栏用引擎自带的 [-]（ctrl+x ctrl+a）收起。
 */
export function registerBand(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const currentStats = await read($, stats)
    const currentReadings = await read($, readings)
    const rows = toRows(currentStats, currentReadings)
    const elements = $.ui.resolve(e)
    // 终端没有 Svg；移动端与编辑器有 Svg，但按需求只在桌面端画面板。
    if (e.surface !== 'desktop' || !('Svg' in elements)) {
      return drawRows(elements, rows)
    }

    const { Box, Button, Svg } = elements
    const toggle = () => toggleCollapsed($)
    // 收起时不读上下文格子：摘要用不到它，也就不必随它的刷新重画。
    if (await read($, collapsed)) {
      return (
        <Box flexDirection="row" columnGap={1}>
          <Button key="expand" plain dimColor label="展开统计" onPress={toggle} />
          {drawRows(elements, rows.slice(0, 1))}
        </Box>
      )
    }

    const source = buildPanelSvg({
      stats: currentStats,
      readings: currentReadings,
      grid: await read($, grid),
      isWorking: e.props.isWorking,
    })

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="flex-end">
          <Button key="collapse" plain dimColor label="收起" onPress={toggle} />
        </Box>
        <Svg source={source} alt={rowsToText(rows)} />
      </Box>
    )
  })
}

/**
 * 会话开始（含 mod 重载）时把 $.store 里的收起状态读回 $.state。由 register.tsx
 * 的 session.start 钩子调用：同一事件一个 mod 只能挂一个不带匹配条件的钩子。
 * 没存过或存的不是布尔值时不动，面板照常展开；读写失败只记调试日志，
 * 不影响会话开始。
 */
export async function restoreCollapsed($: EngineInterface): Promise<void> {
  try {
    const stored = await $.store.get(COLLAPSED_STORE_KEY)
    if (typeof stored === 'boolean') {
      await update($, collapsed, () => stored)
    }
  } catch (error: unknown) {
    $.ui.log(`session-stats: 读回收起状态失败: ${String(error)}`, { to: 'debug' })
  }
}

/**
 * 收起或展开桌面端面板。在按钮的回调里写，不在绘制时写（绘制时写会被拒绝）。
 * 写入失败只记调试日志，面板保持原样，再按一次即可。
 */
function toggleCollapsed($: EngineInterface): void {
  flipCollapsed($).catch((error: unknown) => {
    $.ui.log(`session-stats: 切换收起失败: ${String(error)}`, { to: 'debug' })
  })
}

/** 翻转 $.state 里的收起状态，再把翻转后的值存进 $.store。 */
async function flipCollapsed($: EngineInterface): Promise<void> {
  const isCollapsed = await update($, collapsed, current => !current)
  await $.store.set(COLLAPSED_STORE_KEY, isCollapsed)
}

/** 各端的 Box 与 Text 同型，绘制只用这两个元素。 */
type BandElements = Pick<Elements['terminal'], 'Box' | 'Text'>

function drawRows(elements: BandElements, rows: Row[]) {
  const { Box } = elements

  return (
    <Box flexDirection="column">
      {rows.map(row => (
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {row.map((segment, index) => drawSegment(elements, segment, index === 0))}
        </Box>
      ))}
    </Box>
  )
}

/**
 * 一段：除行首外前面带一个分隔符，分隔符与这一段同在一个 Box 里，窗口窄到换行时
 * 一起移到下一行，不会把分隔符孤零零留在行尾。各元素间距只靠 columnGap：
 * 文字两端的空格在桌面端会被吞掉。
 */
function drawSegment({ Box, Text }: BandElements, segment: Segment, isFirst: boolean) {
  const tone = segment.tone === undefined ? {} : { color: segment.tone }
  const separator = isFirst ? [] : [
    <Text size="footnote" dimColor>
      │
    </Text>,
  ]

  return (
    <Box flexDirection="row" columnGap={1}>
      {separator}
      <Text size="footnote" dimColor>
        {segment.label}
      </Text>
      <Text size="footnote" tabular {...tone}>
        {segment.value}
      </Text>
    </Box>
  )
}
