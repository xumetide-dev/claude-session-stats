import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, On } from 'claude-code'

import type { ContextGrid, SessionStats } from '../types'
import { rowsToText, toRows } from './format'
import type { Row, Segment } from './format'
import { CHEVRON_HEIGHT, CHEVRON_WIDTH, chevronSvg } from './panel/chevron'
import { buildPanelSvg } from './panel/panel'
import { toSummaryRow } from './summary'
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

// 收起与展开的开关是面板顶部正中一个扁的尖括号，不写文字。面板贴着输入框，
// 收起时上沿往下落，展开时往上长，所以展开时画向下的 ﹀，收起后画向上的 ︿。
// 尖括号是一个 8 像素高的 Svg，只占这么高；可点的是叠在它上面的一个按钮（见
// drawToggle），按钮比尖括号高、宽，不必点中线条。
// 按钮的文字是一串盲文空白（U+2800）：看不见，只用来撑出可点的宽度。普通空格在
// 文字两端会被吞掉；盲文空白不算空白字符，不会。
const TOGGLE_HIT_LABEL = '\u2800'.repeat(10)
// 悬停的分组：指针在按钮上时，同组里亮的那个尖括号显出来，盖住暗的。
const TOGGLE_HOVER_SCOPE = 'session-stats-toggle'

/**
 * 输入框上方的状态栏，读到的数据任一变化即重画。桌面端画图形面板（Svg），
 * 其余端画几行小字；面板的 alt 就是这几行字，读屏与不能显示图片时用。
 * 桌面端面板顶部正中有收起的尖括号，收起后只剩一行摘要（精度更低、美制单位），
 * 顶部正中换成展开的尖括号；摘要放不下时在行尾截断，不换行。
 * 终端的状态栏用引擎自带的 [-]（ctrl+x ctrl+a）收起。
 */
export function registerBand(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const currentStats = settleTurn(await read($, stats), e.props.isWorking)
    const currentReadings = await read($, readings)
    const rows = toRows(currentStats, currentReadings)
    const elements = $.ui.resolve(e)
    // 终端没有 Svg；移动端与编辑器有 Svg，但按需求只在桌面端画面板。
    if (e.surface !== 'desktop' || !('Svg' in elements)) {
      return drawRows(elements, rows)
    }

    const { Box, Svg } = elements
    const toggle = () => toggleCollapsed($)
    // 收起时不读上下文格子：摘要用不到它，也就不必随它的刷新重画。
    if (await read($, collapsed)) {
      return (
        <Box flexDirection="column" rowGap={0}>
          {drawToggle(elements, { isCollapsed: true, onPress: toggle })}
          <Box minWidth={0}>
            {drawSummary(elements, toSummaryRow(currentStats, currentReadings))}
          </Box>
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
      <Box flexDirection="column" rowGap={0}>
        {drawToggle(elements, { isCollapsed: false, onPress: toggle })}
        <Svg source={source} alt={rowsToText(rows)} />
      </Box>
    )
  })
}

/**
 * 主对话此刻在不在跑一轮，以引擎的 isWorking 为准：统计里的开始时刻可能是漏掉了
 * 结束的旧值（见 SessionStats.mainTurnStartedAt），引擎说空闲时按空闲显示，
 * 时长与耗时不再往上走。
 */
function settleTurn(current: SessionStats, isWorking: boolean): SessionStats {
  return isWorking ? current : { ...current, mainTurnStartedAt: null }
}

/**
 * 顶部正中的开关，一行只有尖括号那么高（8 像素）：
 * - 平时画暗的尖括号；指针在按钮上时，同一位置显出亮的尖括号盖住它。
 * - 按钮绝对定位，不占这一行的高度，上下各伸出一行再在其中居中，比尖括号高、
 *   宽得多：点到尖括号附近就算数。它是这一行最后一个子元素，画在最上层。
 * 按钮不另给 label：桌面端画的是 label 的文字，引擎取子元素的文字作 label。
 * key 不随方向变。
 */
function drawToggle(
  { Box, Button, Svg }: Pick<Elements['desktop'], 'Box' | 'Button' | 'Svg'>,
  { isCollapsed, onPress }: { isCollapsed: boolean; onPress: () => void },
) {
  const direction = isCollapsed ? 'up' : 'down'
  const name = isCollapsed ? '展开面板' : '收起面板'
  const chevron = (isLit: boolean) => (
    <Svg
      source={chevronSvg(direction, isLit)}
      alt={name}
      width={CHEVRON_WIDTH}
      height={CHEVRON_HEIGHT}
    />
  )

  return (
    <Box flexDirection="row" justifyContent="center">
      {chevron(false)}
      <Box
        position="absolute"
        top={0}
        left={0}
        right={0}
        flexDirection="row"
        justifyContent="center"
        display="none"
        hover={{ scope: TOGGLE_HOVER_SCOPE, display: 'flex' }}
      >
        {chevron(true)}
      </Box>
      <Box
        position="absolute"
        top={-1}
        bottom={-1}
        left={0}
        right={0}
        flexDirection="row"
        justifyContent="center"
        alignItems="center"
      >
        <Button
          key={isCollapsed ? 'expand' : 'collapse'}
          plain
          hover={{ scope: TOGGLE_HOVER_SCOPE }}
          onPress={onPress}
        >
          {TOGGLE_HIT_LABEL}
        </Button>
      </Box>
    </Box>
  )
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
 * 收起后的一行摘要：整行是一个 Text，各段是其中的片段，标签与数值、段与段之间只隔
 * 一个空格，比 drawRows 每处一个 columnGap 窄得多。空格在片段中间，不在整个 Text
 * 的两端，不会被吞掉。窗口仍放不下时在行尾截断并加省略号，不换成两行。
 */
function drawSummary({ Text }: BandElements, row: Row) {
  const runs = row.flatMap((segment, index) => [
    ...(index === 0 ? [] : [<Text dimColor> │ </Text>]),
    <Text dimColor>{`${segment.label} `}</Text>,
    <Text tabular>{segment.value}</Text>,
  ])

  return (
    <Text size="footnote" wrap="truncate-end">
      {runs}
    </Text>
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
