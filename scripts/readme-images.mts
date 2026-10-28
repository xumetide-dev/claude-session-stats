// 用示例数据渲染 README 里的面板截图（两页轮播各一张，2 倍分辨率 PNG），并打印同一份
// 数据在终端与收起状态下的文字。数据是虚构的，不来自任何真实会话。
//
// 运行（需要 rsvg-convert，macOS 上由 librsvg 提供：brew install librsvg）：
//   npx tsx scripts/readme-images.mts

import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { rowsToText, toRows } from '../hooks/format.ts'
import { buildPanelSvg } from '../hooks/panel/panel.ts'
import { EMPTY_STATS } from '../hooks/stats.ts'
import { toSummaryRow } from '../hooks/summary.ts'

const OUTPUT_DIR = fileURLToPath(new URL('../docs/images/', import.meta.url))
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
// 轮播按 20 秒换页：now 取在一页的开头，加 20 秒是另一页。
const PAGE_MS = 20_000
const now = Date.UTC(2026, 9, 28, 14, 0, 0)

const speeds = [
  96, 118, 131, 102, 88, 140, 151, 122, 109, 135, 144, 127,
  98, 149, 158, 117, 139, 146, 128, 152, 141, 133, 160, 147,
]
const costs = [0, 0.4, 0.9, 1.6, 2.1, 2.9, 3.3, 4.2, 4.9, 5.4, 6.0, 6.51]

const stats = {
  ...EMPTY_STATS,
  compactions: 1,
  totalTokens: 39_120_000,
  promptTokens: 38_000_000,
  cacheReadTokens: 37_300_000,
  workMs: 12 * MINUTE_MS + 47_000,
  lastTurnEndedAt: now - 5_000,
  decodedTokens: 142_000,
  decodeMs: 1_100_000,
  firstTokenWaitMs: 27_000,
  firstTokenCount: 10,
  toolCalls: 213,
  toolMs: 5 * MINUTE_MS + 15_000,
  agentTokens: 11_960_000,
  agentWorkMs: 29 * MINUTE_MS + 59_000,
  agentToolCalls: 113,
  recentRequests: speeds.map((speed, index) => ({
    speed, ttftMs: 1_800 + ((index * 7) % 9) * 140,
  })),
  costPoints: costs.map((usd, index) => ({
    at: now - (costs.length - 1 - index) * 3 * MINUTE_MS, usd,
  })),
}

const readings = {
  now,
  sessionStartedAt: now - (42 * MINUTE_MS + 54_000),
  promptCount: 7,
  runningAgents: 1,
  fiveHour: { percentUsed: 19, resetsAt: now + 4 * HOUR_MS + 39 * MINUTE_MS },
  sevenDay: { percentUsed: 30, resetsAt: now + 90 * HOUR_MS },
  costUsd: 6.51,
  contextTokens: 305_000,
  contextWindow: 1_000_000,
  contextPercent: 30,
}

// 上下文格子：10×10，前 34 格按类别着色（最后一格半满），末尾 12 格是压缩缓冲。
const CATEGORY_OF_BLOCK = [0, 0, 1, 1, 2, 2, 3, 4, 5, 6]
const grid = {
  usedCategories: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  usedTokens: 305_000,
  windowTokens: 527_000,
  percent: 58,
  dots: Array.from({ length: 10 }, (_, row) =>
    Array.from({ length: 10 }, (_, column) => {
      const index = row * 10 + column
      if (index < 34) {
        const categoryIndex = CATEGORY_OF_BLOCK[Math.floor(index / 3.4)] ?? 0
        const fullness = index === 33 ? 0.5 : 1
        return { kind: 'used' as const, categoryIndex, fullness }
      }
      if (index >= 88) {
        return { kind: 'buffer' as const, categoryIndex: -1, fullness: 1 }
      }
      return { kind: 'free' as const, categoryIndex: -1, fullness: 0 }
    }),
  ),
}

mkdirSync(OUTPUT_DIR, { recursive: true })
for (const page of [1, 2]) {
  const pageReadings = { ...readings, now: now + (page - 1) * PAGE_MS }
  const svg = buildPanelSvg({ stats, readings: pageReadings, grid, isWorking: false })
  const pngPath = `${OUTPUT_DIR}panel-page-${page}.png`
  execFileSync('rsvg-convert', ['-z', '2', '-o', pngPath], { input: svg })
}

const summary = toSummaryRow(stats, readings)
  .map(segment => `${segment.label} ${segment.value}`)
  .join(' │ ')
console.log('终端：')
console.log(rowsToText(toRows(stats, readings)))
console.log('\n收起：')
console.log(summary)
