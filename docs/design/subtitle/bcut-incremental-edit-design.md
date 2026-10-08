> 移植自 BaoCut v2；文中的数据模型名（TranscriptDoc 等）指 v2 的模型，与 v3 文档模型的对应见[架构设计 §14](../../architecture/architecture-design.md#14-待评审事项)。

# BaoCut 增量编辑设计（Transcript 局部补丁与写路径审计）

> 状态：2026-08-15 落地第一阶段（`patchTranscript` op、请求体上限、Mac 差分提交、
> Studio 写失败回退）；2026-08-18 落地 §3.5（三端写失败分类：瞬态先重试、裁决即回退）
> 与 §3.6（`patchTimeline`：Mac 时间轴也改为差分提交）。
> 本文同时是当前所有编辑写路径的审计台账与后续收口计划。
> 端点参数以 [`bcut-cli-server-reference.md`](../cli/bcut-cli-server-reference.md) 为准。

## 1. 问题

用户在 Mac App 里对一个 7 小时项目改说话人名字，得到：

```
Could not save your edit, so it was reverted. (serve HTTP 400: body too large)
```

根因链（逐文件核实）：

1. Mac 编辑器本地持有一份可变 `Doc`；`Store.commit` 每次改动（含说话人改名、
   章节标题、段落断点、单段字幕）都经 `productDocumentDidChange` → 250 ms 去抖 →
   `ProductTranscriptAdapter.replacingTranscript` **重建整份 transcript.json**
   （无条件重写 `words[]`）→ `AppStore.applyTranscriptDocument` 以
   `replaceTranscript {document}` 整份 POST 到 `__bcut/transcript/apply`。
2. `bcut serve` 对除 `export/video` 之外的所有请求体设 1 MiB 上限
   （`router.rs::MAX_BODY`）；7 小时约 6 万词，序列化后数 MB，直接被拒。
3. 拒绝响应是裸文本 400 `body too large`；App 只能转述「serve HTTP 400」，
   然后按事务失败语义把编辑回退。

三个独立缺陷叠加：**改元信息却全量提交**、**上限过小且错误不可读**、
**没有任何局部编辑通道被 Mac 使用**。

## 2. 写路径审计（2026-08-15）

| 表面 | 端点 | 载荷 | 并发保护 | 评价 |
| --- | --- | --- | --- | --- |
| Mac `AppStore.applyTranscriptDocument` | `transcript/apply` | 改前：`replaceTranscript` 整文档；改后：`patchTranscript` 差分，兜底 `replaceTranscript` | `baseRev` = `data.json.rev` | 本次修复对象 |
| Mac `AppStore.applyTimelineDocument` | `timeline/apply` | 改前：`replaceTimeline` 整份 timeline.json；改后（§3.6）：`patchTimeline` 差分，兜底 `replaceTimeline` | `baseRev` = timeline 历史计数 | 体量小但整份替换会把 cut 出处、词锚一起交给客户端重建；§3.6 已收口 |
| Mac `AppStore.applySubtitleStyle` | `style/apply` | 整份 `studio/style.json` | `baseRev` | 样式对象小，可接受 |
| Mac `applySourceEdit` / `applyTranslationEdit` | `transcript/apply` | `sourceText` / `translation` 单 op | `baseRev` + op `base` | 仅被未挂载的 `ProjectsViewController` 调用，产品壳里是死代码 |
| Mac 项目标题/描述/备注/链接 | `bcut project edit`（子进程） | 只带改动字段 | — | 不经 serve，不受本问题影响 |
| Studio Web `applyTranscriptOps` | `transcript/apply` | 1–2 个细粒度 op（sourceText/translation/timing/结构） | `baseRev` + op `base`；单条串行队列 | 良好 |
| Studio Web `mutate/flush` | `put` | 整份 `studio/edits.json`（样式覆盖、Agent 请求） | sha256 CAS，stale 重拉重放 | 有缺陷：非 409 失败会无限重试（本次修复）；文件通常小 |
| Studio Web 导出 | `export/video` | 完整派生投影（`data.json` + 时间线派生行） | — | 数 MB 量级，靠更高上限容纳 |
| gpui | `transcript/apply` / `timeline/apply` / `style/apply` / `restore` | 细粒度 op（同 Web），style 整份 | 双 rev 计数 | 良好，无需改动 |
| Windows | 无 serve 写路径 | — | — | 不适用 |

Studio Web 没有说话人/章节/标题编辑 UI，因而不存在元信息全量提交问题；Mac 是唯一
把「本地整文档」当写单位的客户端。

## 3. 本次落地

### 3.1 `patchTranscript` op（服务端）

- 实现：[`core/crates/bcut-flow-core/src/patch.rs`](../../../core/crates/bcut-flow-core/src/patch.rs)
  纯函数 `apply_patch(&mut TranscriptDoc, &Value)`，零 I/O、事务性（内部副本，
  失败不留半套改动）；serve 侧
  [`core/crates/bcut-serve/src/endpoints/transcript.rs`](../core/crates/bcut-serve/src/endpoints/transcript.rs)
  `apply_transcript_patch`：读盘 → 补丁 → `validate()` → 原子写 → 重建投影 →
  history。主源与 `transcripts/<srcId>.json` 同一条路径。
- 形状（与 `replaceTranscript` 一样必须是事务里唯一的 op）：

  ```jsonc
  { "kind": "patchTranscript",
    "words": {
      "update":  { "<wordId>": { "t0"?, "t1"?, "text"?, "sp"? } },
      "splices": [ { "first": "<id>", "last": "<id>", "words": [ …Word ] },
                   { "after": "<id>" | null, "words": [ …Word ] } ] },
    "set": {
      "speakers":   { "<id>": {name,hue?} | null },
      "breaks":     { "<wordId>": "break"|"nobreak" | null },
      "paraBreaks": { "<wordId>": true | null },
      "hidden":     { "<wordId>": true | null },
      "stages":     { "asr"|"asrLayout"|"polish"|"segment"|"chapters": "…" | null },
      "trans":      { "<lang>": null | { "<sid>": "…" | null } },
      "transAlign": { "<lang>": null | { "<sid>": {…} | null } },
      "transSrc":   { "<lang>": null | { "<sid>": "…" | null } },
      "transDisplay": { "<lang>": null | { "<sid>": {text,basis,transFingerprint} | null } },
      "autoBreaks": { "<profile>": null | { "<wordId>": "break"|"nobreak" | null } },
      "layoutProfile": "<id>" | null,
      "chapters":   [ …Chapter ] } }
  ```

- 设计取舍：
  - **为什么是「差分补丁」而不是一组语义 op（renameSpeaker、setChapter…）**：
    Mac 的业务语义已经在本地 `Doc` 与 adapter 里（合并句边界、译文覆盖层折回等），
    强行拆成语义 op 会把这些规则复制到服务端第二份；补丁保留「客户端提交它想要的
    最终值」的语义，只把传输与 journal 成本压到与改动成正比。Studio/gpui 没有本地
    整文档，继续用语义 op（`sourceText`/`sourceStructure`…），两条通道底层同一份
    `TranscriptDoc` 校验。
  - **不发 CLI 命令、不进 skill 文档**：补丁是 UI 客户端与 serve 之间的传输格式，
    Agent 走 `bcut studio apply` 覆盖层与 CLI 命令，不需要感知。
  - `baseRev` 仍是唯一并发锁：任何写都会 `rev+1`，补丁不再逐词带 `base`；引用
    不存在的词/键直接 400。

### 3.2 请求体上限与错误信封

`MAX_BODY` 1 MiB → 64 MiB，`MAX_EXPORT_BODY` 32 MiB → 256 MiB；serve 只监听
127.0.0.1，上限是防误用护栏而非资源配额。超限返回 413 JSON
`{ok:false, reason:"body-too-large", error, declared, limit}`，客户端能把原因原样
展示。上限的存在仍提醒客户端：日常编辑必须发增量 op。

### 3.3 Mac 差分提交

[`apps/mac/Sources/BaoCutCore/TranscriptPatch.swift`](../apps/mac/Sources/BaoCutCore/TranscriptPatch.swift)
`TranscriptPatch.plan(baseline:desired:)`：把 adapter 重建的整文档与磁盘基线
`document.transcriptDocument` 做 JSON 级差分：

- `words[]`：按 id 求最长公共前缀/后缀，中间段成为一次 splice（结构改动）；前后缀
  里 id 相同但字段不同的词进 `update`。一次去抖窗口内多处结构改动会合并成覆盖
  它们的一个 splice——仍以编辑区域为界，不是整份文件。
- 顶层表：`speakers/breaks/paraBreaks/hidden/stages` 一级稀疏差分，
  `trans/transAlign/transSrc/transDisplay/autoBreaks` 两级差分，`layoutProfile` 标量，
  `chapters` 整表（很小）。
- `media/lang/engine/bcutTranscript/createdAt` 或未知键有差异 → `.replace`，
  退回 `replaceTranscript`；两份完全相同 → `.unchanged`，不发请求。

`AppStore.applyTranscriptDocument` 据此选择 op；调用方
（`ShellProjectAdapter.scheduleProductDocumentSave`）与失败回退语义不变。
说话人改名的请求体从「整份转录稿」变成一条 `set.speakers.<id>`。

### 3.4 Studio Web 写失败回退

`store.jsx flush`：`put` 的非 409 失败（含 413）不再留着 `pendingMuts` 让 `finally`
每 400 ms 重试并刷 toast；丢弃这批变换、回退到服务器已知覆盖层并提示「改动已回退」，
与 Mac 语义一致。

### 3.5 写失败分类：瞬态先重试，裁决即回退（2026-08-18）

第一阶段之后仍有一类报告：在时间轴上分割片段（一次 `patchTranscript` 断点 +
一次 `replaceTimeline`）时偶发

```
无法保存你的编辑，改动已回退。（The network connection was lost.）
无法保存你的编辑，改动已回退。（serve HTTP 400：body too large）   ← 旧 serve
…timeout…
```

按 §3.1–3.3 的合成 5 小时项目实测，当前构建下这两笔写在 serve 端各约 1 s / 0.6 s，
请求体只有几百字节，413 也能被 URLSession 正常收到；剩下的「连接丢失 / 超时」
不是尺寸或裁决问题，而是**传输瞬态**：`bcut serve` 被同根异构建换代接管
（`serve.log` 里 CLI 与 App bundle 交替拉起数百次）、被别的会话重启、或项目锁被
flow 占住的瞬间。此前 Mac 把任何失败都当裁决——`applyTranscriptDocument` 返回
`false` → 回退到磁盘状态 → toast「改动已回退」——用户因一次瞬态直接丢一步。

现在三端统一为「瞬态先重试、裁决即回退」：

| 表面 | 分类 | 重试 |
| --- | --- | --- |
| Mac `AppStore.apply{Transcript,Timeline}Document` / `applySubtitleStyle` | 返回 `WriteOutcome`：`saved` / `rejected(reason)` / `retryable(reason)`。`WriteOutcome.classify`：URL 层错误（超时、连接丢失、连不上）、POSIX 错误、HTTP 409/423/5xx → `retryable`；其余 HTTP（400/404/413/500）、`serve 未运行`、解析失败 → `rejected` | `ShellProjectAdapter.scheduleProductDocumentSave`：`retryable` 时把同一份 desired 快照重新排队（若期间有更新的快照则让位），按 0.5/1/2/4/4 s 退避重新对磁盘基线做差分再发；连续 5 次瞬态才按 `rejected` 路径回退并 toast 一次 |
| GPUI `serve::apply::post_json` | `ureq::Error::Transport` 中 `ConnectionFailed`、非超时 `Io` 为瞬态；状态码与超时不重试 | 0.3 s、0.9 s 各一次 |
| Studio Web `apply-fetch.js` | `fetch` 抛异常为瞬态；有状态码不重试 | 0.3 s、0.9 s 各一次 |

重发是安全的：三个写端点都带 `baseRev` CAS。若首发其实已落地、只是应答没送到，
Mac 的重试会先重载磁盘文档再差分——差分为空则什么都不发（`transcript` 走
`TranscriptPatch.plan == .unchanged`，`timeline` 走 `timeline == refreshed.timelineDocument`）；
GPUI/Web 的重发得到 409 stale，按既有「重载」语义处理。任何情况下都不会写两次。

配套：`ServeError.http` 的 `errorDescription` 现在引用信封的 `error`/`reason` 文本
而不是整段 JSON，Mac toast 与 GPUI `status_error` 同款可读（例：
`serve HTTP 413：请求体过大：… 字节，上限 … 字节`）。

### 3.6 Mac timeline 差分提交：`patchTimeline`（2026-08-18）

`replaceTimeline` 是 §2 审计后 Mac 剩下的唯一整文档写单位（每次 clip 拖拽、分割、
元素移动都整份回传，连主源的 cut 出处一起）。现按 `patchTranscript` 的同一思路收口：

- 服务端 op `patchTimeline`（[`core/crates/bcut-timeline/src/patch.rs`](../../../core/crates/bcut-timeline/src/patch.rs)
  `apply_patch`）：`sources` 表 put/null，`clips` / `tracks` / 每轨 `elements` 是
  有序 id 数组 → 公共前后缀外一次 splice + 保留项字段级 `update`（null 删可选字段），
  `main` 整对象。补丁作用在文档 JSON 上，之后按闭合 schema 严格反序列化、
  `validate()`、按补丁后 sources 的时长重建投影，任一步失败 400 不落盘；未提及的
  字段原样保留。字段表见 [server reference](../cli/bcut-cli-server-reference.md) `timeline/apply`。
- Mac [`TimelinePatch.plan(baseline:desired:)`](../apps/mac/Sources/BaoCutCore/TimelinePatch.swift)
  把 `ProductTimelineAdapter.replacingTimeline` 的重建结果与磁盘基线
  `document.timelineDocument` 做 JSON 级差分；没有基线（还没有 timeline.json）、
  `bcutTimeline` 版本变化、未知顶层键、无 id 的项 → `.replace` 退回整文档；两份
  相同 → `.unchanged` 不发请求。`AppStore.applyTimelineDocument` 据此选 op，调用方
  不变。分割片段的请求从「整份 timeline.json」变成 `clips.update.<id>.out` +
  一条 `clips.splices[].after` 插入。
- GPUI 与 Studio Web 的时间轴写路径本就是细粒度 op（`splitClip`/`trimClip`/
  `patchElement`/`putSource`…），不受影响；GPUI `adapters::timeline_doc::replacing_timeline`
  只剩测试引用，不在写路径上。

至此审计表里仍是「整份」的写单位只剩：`style/apply {document}`（三端同款，
`studio/style.json` ≈ 5–8 KB 且契约本身就是「一份样式文档」）、Studio `put`
（`studio/edits.json` ≈ 数 KB，sha CAS）与 `export/video` 的完整预览投影（不是
编辑）。它们的尺寸与语义都不构成问题，保留在 §4 作为可选优化。

## 4. 后续收口（按收益排序）

1. ~~**Mac timeline 细粒度 op**~~：已由 §3.6 的 `patchTimeline` 收口。逐条 base
   校验/`skipped` 语义（§5.3）仍只在细粒度 op 上有，`patchTimeline` 与
   `patchTranscript` 一样只靠 `baseRev` CAS。
2. **Mac 保存后的重载成本**：每次成功写都 `DocumentModel.load` 全量重读
   `transcript.json`（还解析两遍：`TranscriptDocument` + 原始 `JSONValue`）、
   `data.json`、`timeline.json`，再 `mapDocument` 全量重投影。7 小时项目每次按键
   都是数十 MB 的解析。方向：apply 响应已带 `rev`，可只在 `rev` 变化时重读；把
   `transcriptDocument` 从解析结果改为「已应用补丁的本地副本」（服务端接受即等价），
   避免第二次全量解析；`mapDocument` 按 splice 范围增量重投影。
3. **`studio/poll` 全量回传 `data.json`**：任何 rev 变化都回整份投影。可加
   `since=<rev>` 返回 `{cues: [changed], removed: [...]}` 增量，或至少 gzip。
4. **`export/video` 载荷**：前端把整份派生投影 POST 回去，服务端其实能从磁盘投影
   重建绝大部分；应只提交 `patchRanges` 与与磁盘不同的覆盖字段。
5. **Studio `put` 的整文件重写**：`edits.json` 主要是样式覆盖与 Agent 请求，
   `requests[]` 只增不减；应把 `requests` 挪到独立文件或加清理，并让 `put` 支持
   JSON merge patch。
6. **Mac 死代码**：`ProjectsViewController` 与 `applySourceEdit/applyTranslationEdit`
   已无调用者，或删除，或把产品壳的原文/译文单元格编辑改接到这两个语义 op（比
   补丁更精确、能带 op 级 base）。
7. **Studio 409 stale 的恢复**：`applyTranscriptOps` 遇 stale 只 toast，用户输入丢失，
   靠下一次 poll 追平；可在 stale 时先拉最新 `rev` 再原样重放一次。
8. **AI 候选审阅的全量候选**：`ai/reviews/<kind>.json` 内嵌整份候选 transcript，
   accept 整份覆盖并抓全量 history 基线。chapters 已于 2026-08 改为覆盖层候选
   （`reviewVersion 4`：只存 `chapters` + `stages.chapters`，accept 只改这两个字段，
   基线按媒体身份），polish/translate 仍是全量候选；history journal 也仍按整文件
   记基线，长录音下每次 AI 接受仍是一次数十 MB 的写入。

## 5. 验证记录

- `cargo test -p bcut-flow-core patch`：5 项通过（补丁纯函数）。
- `apps/cli` router 测试 `transcript_apply_accepts_sparse_patches_and_keeps_history`
  已补；本机缺 Xcode/Metal 工具链无法编译 `bcut`（MLX 构建脚本需要 `metal`），
  该测试与 `cargo test -p bcut` 需在有完整 Xcode 的机器上跑。
- Mac：`swift build --target BaoCutCore` 通过；`TranscriptPatchTests` 8 项在无 XCTest
  的本机通过独立 `swiftc` 断言桩验证，XCTest 版本需 Xcode 环境执行。
- §3.5（2026-08-18）：合成 40k 词 / 5 小时项目起 `bcut serve` 实测 `patchTranscript`
  ≈1.0 s、`replaceTranscript`（5.9 MB）≈0.9 s、`replaceTimeline` ≈0.6 s；70 MB
  超限体经 curl 与 URLSession 均收到 413 信封。Mac：`WriteOutcomeTests` 4 项 +
  `ShellProjectSaveRetryTests` 4 项（URLProtocol 脚本化 serve：掐断后重试落地、
  应答丢失后重差分为空、预算耗尽只报一次、413 不重试且 toast 引用信封文本）+
  既有 `ShellProjectMediaAdapterTests` 通过。GPUI：`cargo test --features runtime-shaders
  serve::apply` 10 项（含真实 TCP 掐断服务）通过。Web：`node --test
  studio/apply-fetch.test.js` 3 项通过。
- §3.6（2026-08-18）：`cargo test -p bcut-timeline patch` 4 项、`cargo test -p bcut
  timeline_apply` 9 项（含 `timeline_apply_patch_is_sparse_validated_and_undoable`：
  分割 + 新 source + 元素改时长一笔落地、cut 出处保留、悬空引用与非法结果 400 不落盘、
  一步撤销）；Mac `TimelinePatchTests` 7 项通过。
