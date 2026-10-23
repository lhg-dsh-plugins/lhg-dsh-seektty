# 本版修复（BUGFIX）· 1.3.0 → 1.3.1

## 标题

终端观察者（sink）抛错会挂死前台提问：`NativeInteractions.questions()` 的两处 emit 无异常防护（与同类 `approval()` 的既定防护不对称）。

- 基线：上游 v1.3.0，commit `42a2a7fa2a01b5a10a2e2ce368c151c8e0fdafc5`
- 本版：1.3.1
- 选型说明：上游 open issue 中 #196（流式输出时欢迎页刷新清全历史缓存）的最小修复已由上游 PR #198 合入本基线（`setRuntimeFacts` 已做值比较、欢迎页回调已改走 `refreshWelcomePresentation()`），#197 为性能架构规划、#215 为另一仓库在 Windows 经插件市场的安装失败（无完整日志、离线不可复现）、#190/#161/#157 为功能请求；本 bug 为静态审查实锤缺陷 + 最小复现证实（修复前失败、修复后通过），非 issue 编号对应项。

## 现象与根因

`src/host/native-interactions.ts` 中，`approval()` 对观察者抛错有完整防护：结算帧 emit 包 try/catch（注释明言「坏观察者不得拖垮主流程」），初始 emit 抛错时以 `finish('unavailable')` 干净收尾；同文件既有测试亦把这点立为契约（`fails closed when a terminal sink throws…`）。`questions()` 的两处 emit 却是裸调用：

1. 结算路径：`finish()` 先删除 pending、移除 abort 监听，随后裸 `this.emit(question/resolved)`，最后才 `resolve/reject`。任一 sink 在该帧抛错，异常直接穿透 `respond()` 抛给调用方，而问题 Promise 永不 settle——前台提问永久挂死，且 pending 已删除、无从重试。
2. 初始路径：末尾裸 `this.emit(envelope)`（question/requested）。sink 抛错时异常穿透 Promise 执行器，问题以观察者的原始错误（而非约定的 `ASK_ABORTED`）被拒，且 pending 条目残留（`replay()` 仍能枚举到），后续 `dispose()` 经 `cancel → finish` 还会再次撞上同一裸 emit。

## 证据链

1. **最小复现（新增回归测试 `tests/native-interactions-observer-fault.test.ts`，2 条）**，在未修改的上游源码上运行：
   - resolved 帧抛错：`respondThrew=true receipt=undefined settlement=pending`——`respond()` 抛异常、问题不结算（测试红）。
   - requested 帧抛错：`settlement=settled replayPending=1`——以观察者原始 `Error: broken terminal` 拒绝（非 `ASK_ABORTED`）、pending 残留 1 条（测试红）。
2. **基线测试**：上游基线全量 `vitest run` 为 2373 条（2322 通过 / 51 跳过 / 0 失败）；`tsc --noEmit` 与 `tsdown` 构建均通过。缺陷不在既有覆盖内——既有测试只为 approval 路径立了坏观察者契约，questions 路径无对应断言。

## 改动

- `src/host/native-interactions.ts`（唯一实现改动，+4/−3）：`finish()` 的 resolved 帧 emit 包 try/catch 并加与 approval 一致的注释；初始 `this.emit(envelope)` 改为抛错时调用 `finish()`——以默认 `ASK_ABORTED` 干净拒绝并撤下 pending（与 approval 抛错时 `finish('unavailable')` 的收尾方式对称）。
- 新增回归测试 `tests/native-interactions-observer-fault.test.ts`（2 条）；上游既有测试一字未改。
- `src/dsh-compat.ts` 的 `PACKAGE_VERSION` 与 `package.json` 的 `version` 同步为 `1.3.1`（patch +1）；`package.json` 的 `repository.url` 改指本修复版仓库，其余字段未动。
- `lib/` 按 `tsdown` 重建（版本常量变化使 chunk 更名为 `dsh-compat-DVSMuTDo.js`）；`README.md` 仅顶部追加 fork 头，上游原文一字未删；`LICENSE` 与上游逐字一致。`pnpm-lock.yaml` 无根包版本字段，无需同步。

## 复验结果

- 新增回归测试修复后 2/2 通过：resolved 帧抛错时 `respondThrew=false receipt={"accepted":true} settlement=settled`，问题正常以答案结算；requested 帧抛错时以 `ASK_ABORTED` 拒绝、`replayPending=0`。
- 修复后（bump 前）全量：2375 条，**2324 通过 / 51 跳过 / 0 失败**（基线 2373 + 新增 2 条，差值可完全勾稽）。
- 最终形态（修复 + bump + lib 重建 + README 头）全量：2375 条，2321 通过 / 51 跳过 / **3 失败**，3 条均为版本针断言、与逻辑改动无关：
  - `package-contract` 两条：把 `manifest.version`/`PACKAGE_VERSION` 写死为 `'1.3.0'`（tests/package-contract.test.ts:50-51），及要求 README 携带发版版本字样——属上游发版仪式，本 fork 不执行该仪式、不伪造 release 文档与 README 正文。
  - `intake-public-wiring` 一条：登录用例期望 client version 字面量 `'1.3.0'`，实际为本版 `'1.3.1'`。
  - 三条均可由「期望值是字面量 1.3.0、本版按约 bump 为 1.3.1」直接勾稽；bump 前同一代码全量 0 失败即为对照。
- `typecheck`（tsc --noEmit）通过；`build`（tsdown）通过；`pack:check` 通过（seektty-1.3.1.tgz，55 entries）。
- 附带记录：`foreground-question-native` 的 Host 截止时间用例在本沙箱高负载下曾间歇失败 2 次，单独复跑（含修复在内）连续通过、且在两次全量运行中均通过，属时序敏感的环境抖动，与本次改动无关（已用 `git stash` 回退改动对照过基线行为）。

## 验证边界

- 只防护 questions 的两处 emit；`replay()` 向调用方 sink 的直投与 `approval()` 既有行为未动。
- 本机 pnpm 脚本入口因沙箱 overlay 权属（chown EPERM）无法经 `pnpm run` 复验，构建/类型检查/测试均以 `node_modules/.bin` 下同一二进制直跑完成，口径与脚本定义一致；未对真实 dsh 宿主做装机端到端验证。
