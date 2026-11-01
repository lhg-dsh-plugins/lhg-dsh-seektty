#!/usr/bin/env node
/**
 * dsh version scan 降噪守卫。
 *
 * 背景：bump-dsh.mjs 在 npm latest 的子包还没发全时按设计 exit 2
 * （"需要人工迁移"），每天定时任务都会红一次、发一封邮件，但待迁移集合
 * 经常连续多天完全不变 —— 纯噪音。
 *
 * 本守卫把最近一次报告的待迁移集合落盘到 .dsh-scan-state.json：
 * - 集合无变化 → 打印说明，exit 0（静默通过，不发邮件），输出 proceed=false；
 * - 集合发生变化 → 更新状态文件，透出 bump-dsh 的报错并 exit 2
 *   （workflow 里另有 always() 步骤把状态文件提交回去）；
 * - 正常升级（exit 0 且输出"已升级"）→ 输出 proceed=true，exit 0；
 * - 其他失败原样透出（缺 tested、registry 不可用等照常红）。
 *
 * 用法：node scripts/dsh-scan-guard.mjs <target>
 * 本地：node scripts/dsh-scan-guard.mjs \
 *         $(node scripts/bump-dsh.mjs --check | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).target')
 */

import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const statePath = resolve(root, '.dsh-scan-state.json')
const target = process.argv[2]
if (!target) {
  process.stderr.write('用法：node scripts/dsh-scan-guard.mjs <target>\n')
  process.exit(2)
}

function setOutput(name, value) {
  const f = process.env.GITHUB_OUTPUT
  if (f) appendFileSync(f, `${name}=${value}\n`)
}

const r = spawnSync('node', [resolve(root, 'scripts/bump-dsh.mjs'), target], { encoding: 'utf8' })
process.stdout.write(r.stdout ?? '')
if (r.status === 0) {
  // 真升级时 bump-dsh 打印"已升级："并改文件；"无需升级"分支到不了这里
  //（workflow 已先确认 updateAvailable），但防御性地以输出为准。
  const proceeded = /已升级/.test(r.stdout ?? '')
  setOutput('proceed', proceeded ? 'true' : 'false')
  if (!proceeded) process.stdout.write('[scan-guard] bump-dsh 正常退出但未升级，不触发后续步骤。\n')
  process.exit(0)
}
process.stderr.write(r.stderr ?? '')
if (r.status !== 2) process.exit(typeof r.status === 'number' ? r.status : 1)

// exit 2：只对"需要人工迁移"做降噪，其他 exit 2（如缺 tested、registry 不可用）照常红。
const m = /需要人工迁移：以下包没有 (\S+)，未修改任何文件：\n([\s\S]*)/.exec(r.stderr ?? '')
if (!m) process.exit(2)
const state = { target: m[1], missing: m[2].split('\n').map(s => s.trim()).filter(Boolean).sort() }
let prev = null
if (existsSync(statePath)) {
  try { prev = JSON.parse(readFileSync(statePath, 'utf8')) } catch { prev = null }
}
const same = !!prev && prev.target === state.target &&
  JSON.stringify([...(prev.missing ?? [])].sort()) === JSON.stringify(state.missing)
if (same) {
  setOutput('proceed', 'false')
  process.stdout.write(`[scan-guard] dsh ${state.target} 待迁移集合无变化（${state.missing.length} 个包），已于上次报告，本次静默通过。\n`)
  process.exit(0)
}
writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
process.stderr.write('[scan-guard] 待迁移集合发生变化，已更新 .dsh-scan-state.json，保持失败以便通知。\n')
process.exit(2)
