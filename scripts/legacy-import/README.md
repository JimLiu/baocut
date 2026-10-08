# legacy-import

把 baocut-app 的 `.bcut` 项目和外部视频项目目录导入成视频（`baocut.video`）。这里保留手动批量导入入口；可复用的转换核心已移到 [`@baocut/legacy-import`](../../packages/legacy-import/README.md)，也供 Runtime 启动迁移使用。它只通过 `engine-host` 的公开协议写视频，不直接碰 `video.db`。

写出来的是视频格式第 3 版（`schemaVersion: 3`）的实例模型。逐字段的映射规则见 [元素模型映射](../../docs/design/timeline/element-model-mapping.md) 第 5 节，下面「映射」一节是摘要。

启动时的 v1 / v2 检测、设置与凭据迁移、完成标记见[架构设计 §2.7](../../docs/architecture/architecture-design.md#27-历史版本的启动迁移)。下面的 CLI 用法保持不变。

## 用法

需要 Node 22.18+（直接跑 `.ts`）、`ffprobe`，以及编好的引擎：

```bash
cargo build --release -p engine-host
```

先预演（不写任何视频，只出报告和每个视频的写入计划）：

```bash
node scripts/legacy-import/import.ts \
  --bcut "$HOME/Library/Application Support/BaoCut/projects" \
  --external /path/to/external-project \
  --report /tmp/legacy-import-dry --dry-run
```

正式导入到一个项目文件夹（每个旧项目一个视频，一个子目录）：

```bash
node scripts/legacy-import/import.ts \
  --bcut "$HOME/Library/Application Support/BaoCut/projects" \
  --external /path/to/external-project \
  --out /Volumes/ExtremeSSD/BaoCut/projects/legacy-import
```

导入之后核对（素材都按原路径找得到、没有进视频目录，文档正文都读得出来，实例都是第 3 版的字段，剪口集合的正文成立）。目录里有 `import-report.json` 时，同时核对报告中的视频已写出、没有导入失败和缺失素材；存在这些问题或目录里没有视频时退出码为 1，不能因跳过了缺失素材就把整批导入报告为完整：

```bash
node scripts/legacy-import/verify.ts /Volumes/ExtremeSSD/BaoCut/projects/legacy-import
```

| 参数                 | 含义                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `--bcut <目录>`      | 一个 `.bcut` 项目目录，或装着它们的目录；可以给多次                                         |
| `--external <目录>`  | 一个外部视频项目目录（里面有 `project.json`）；可以给多次                                   |
| `--out <项目文件夹>` | 视频写到哪里                                                                                |
| `--report <目录>`    | 报告写到哪里，默认同 `--out`                                                                |
| `--only <名字片段>`  | 只导入名字里带这个片段的项目；可以给多次                                                    |
| `--dry-run`          | 预演：不启动引擎，报告写成 `import-report.dry-run.md`，并在 `plans/` 下留每个视频的写入计划 |
| `--replace`          | 目标视频已存在时删掉重建（默认是接着上次的导入）                                            |
| `--engine <路径>`    | `engine-host` 可执行文件，默认 `target/release/engine-host`                                 |
| `--ffprobe <路径>`   | 默认取 `BAOCUT_FFPROBE` 或 `PATH` 里的 `ffprobe`                                            |

有项目导入失败时退出码是 1。报告是 `import-report.md`（给人看）和 `import-report.json`（逐项目的明细）。

## 它做什么、不做什么

- **素材只链接，不复制**：所有素材以 `storage: 'linked'` 登记在原路径，视频目录的 `blobs/` 是空的。之后想收进视频目录，用引擎的 `collectAssets`；文件挪了地方，用 `relinkAsset`。
- **可以重复跑**：每一步是一笔事务，`commandId` 固定为 `legacy-import:<步骤>`，标签里带内容摘要。标签的 200 字符上限优先保留摘要，过长的文件名说明截短。重跑时已经提交过、内容没变的步骤直接跳过；内容变了会停下来要求 `--replace`，不会悄悄叠一份。
- **只经过引擎写**：每个实例、关键帧、转场、闪避规则、剪口集合都走 `engine-host` 的操作，引擎的校验照常生效，不写引擎不收的视频。
- **超出范围的值夹住或丢掉，都记账**：报告里「夹到范围里的值」「没有写进去的」逐项计数，逐条说明在警告里。引擎退回一个实例时，逐组去掉可选字段（`fx`、`mask`、`animate`、包络、跟随策略……）重试，去掉了哪组也记在「没有写进去的」里；还是写不进去才算失败。
- **导入扩展里只有来源说明**：`extensions["baocut.import"]` 只留旧 ID（`sourceId`）以及 `bcfClip`、`mediaId`、`itemCount` 这几项来源信息，不放元素数据；`bcfClip` 是认领的句子 ID，对应关系另外写成音画联动组（见下表）。导入时估算出来的值（画布尺寸、没有终点的音频长度）在「导入时估算的」里计数。每个视频带一份 `import-record` 文档，记着旧项目的路径和这个视频的导入明细。
- **不导入**的旧数据（撤销历史、AI 中间结果、任务与日志、波形缩略图缓存等可再生或与成片无关的文件）列在报告的「没有导入的旧数据」里。
- **字幕投影兼容**：句子的词成员优先取 `sourceWordIds`，旧投影只有 `cueIds` 时按字幕行恢复。缺行、空词引用或引用失效时放弃对应投影并报告，保留原始转写。换行、分段、阶段指纹与词的贴前标记写入视频格式 §5.2 已定义的正式字段。
- **长标题**：`.bcut` 项目标题超过 200 个 Unicode 字符时截短视频显示名，计入 `clamped.video-name`；完整原标题保留在报告与视频内的 `import-record` 文档。

## 映射

| 旧数据                                                    | 写成                                                                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 主媒体与 `clips`                                          | 按剪口拆开的 `video`（或 `audio`）实例，`role: 'a-roll'`；默认位置写 `mode: 'fullscreen'`、`fit: 'contain'`、`bg` 取 `main.background` 或黑色 |
| 元素 `place`、`fx`、`mask`、`tile`、`animate`、`mode`、`fit`、`bg` | 同名实例字段，原样带过来；`opacity` 夹到 [0, 1]，未知的 `place` 键丢掉                                                                     |
| 元素 `kind`                                               | 同名实例类型；`text` 带 `counter` 时写 `counter` 不写 `text`；素材贴纸指向图片、视频或 Lottie 素材，`loop`、`fillOverrides` 原样，`srcStart`、`rate` 没有对应（计入「没有写进去的」） |
| 代码项目（`entry` + `data.json`）                         | `composition` 实例，来源是代码包，预渲染替身是渲染出来的成片：取 `media` 记着的项目内文件；没记或文件不在时，取项目根与 `out/` 下唯一的视频，有几个时取文件名等于合成 ID 的那个。找不到成片的合成不导入、代码包也不登记，计入「没有写进去的」（`没有预渲染替身的代码合成`），警告里逐个写出项目与合成；只有这种合成的项目照样导入成视频 |
| Lottie 源                                                 | 和别的源一样链接登记，引擎按内容认成 `lottie` 素材，尺寸与时长用渲染内核读出                                                                       |
| 元素 `keyframes`（`x`、`y`、`scale`、`scaleY`、`rot`、`opacity`、`radius`） | 序列上的关键帧绑定；秒落到实例内的帧（落到同一帧的只留第一个），百分比保留；缓动不在缓动表里的按线性                         |
| 音量 `volume` 与音量关键帧                                 | 线性倍数夹到 [0, 4]；音量关键帧成实例的 `envelope`；淡入淡出夹到 [0, 5] 秒                                                                       |
| 视频元素 `transitions.in` / `out`                         | 单侧转场，`in` 落在实例开头、`out` 落在结尾；长度夹到 [0.1, 2] 秒；实例不够长时引擎缩短生效长度，报告逐条列出                                   |
| 音频元素 `duck`                                           | 闪避规则：`under: 'speech'` 用转写触发，`under: <轨道>` 用那条轨道的实例触发；深度夹到 [0, 60] dB，同一触发与参数的实例归成一条                  |
| 词锚点 `~源:词`                                           | `speech-anchor` 跟随策略，指向转写文档的当前版本；跨过剪口求出成片时刻；求不出的元素不导入                                                       |
| 源上的 `cuts`                                             | 每个源一份剪口集合文档（`baocut.cut-set/1`，精确刻度），作用于这个源的音视频实例；其他实例 `follow-cuts`                                         |
| 没有终点的元素                                            | `untilSequenceEnd`                                                                                                                                |
| 元素与轨道的隐藏、静音、锁定                              | 实例 `enabled: false`；轨道的 `visible` / `muted` / `locked`                                                                                      |
| `template`                                                | 序列的模板层，原样带过来                                                                                                                          |
| 外部项目的 dB 音量                                        | 线性倍数                                                                                                                                          |
| 外部项目的代码合成（`hyperframes`）                       | 不导入：外部项目不记渲染结果，合成没有预渲染替身，计入「没有写进去的」（`没有预渲染替身的代码合成`），代码包不登记，只放合成的轨道不建             |
| 配音的 `bcfClip`（认领代码合成里的口播句子）              | 带替身的合成实例与认领它的配音实例写同一个 `linkGroupId`（`narration:<合成 ID>`），合成的声音关掉，计入「写进序列的对象」；合成没有导入时配音按普通音频导入，计入「不适用」。按句扣声音、钉住位置、重新生成配音等跟着代码走的行为不移植 |
| 外部项目的字幕                                            | 一份字幕文档（序列时钟）、一份定位框样式文档（`baocut.boxed-caption-style/<N>`）与一个字幕实例；字幕动画预设 `animationPresetId` 不带过来（外部工具的预设名不说明逐词动画的画法，成片里也没有逐词效果），计入「没有写进去的」，每个预设一条警告 |

## 测试

```bash
BAOCUT_ENGINE_HOST=<engine-host> node --test scripts/legacy-import/legacy-import.test.ts
```

测试在临时目录里用 `ffmpeg` 合成旧项目（每种元素、几何、效果、转场与缩短、闪避、关键帧、词锚点、剪口集合），只看计划的那组不需要引擎；经过引擎的那组导入三遍（首次、原样重跑、`--replace`），再跑核对脚本。没有 `BAOCUT_ENGINE_HOST` 或 `ffmpeg` 时对应的组跳过。

## 文件

| 文件               | 内容                                              |
| ------------------ | ------------------------------------------------- |
| `import.ts`        | 命令行入口：收集计划、执行、写报告                |
| `bcut-project.ts`  | `.bcut` 项目 → 导入计划                           |
| `external-project.ts` | 外部视频项目 → 导入计划                        |
| `video-plan.ts`    | 计划与报告的数据结构（纯数据，不碰引擎）          |
| `video-writer.ts`  | 把计划经 `engine-host` 写成视频（幂等的分步事务） |
| `engine-host.ts`   | `engine-host` 的 stdio JSON-lines 客户端          |
| `exact-time.ts`    | 浮点秒 → 精确时间（帧、MediaTime、有理数帧率）    |
| `verify.ts`        | 导入之后的核对                                    |
| `legacy-import.test.ts` | 合成旧项目的导入测试                         |

类型检查：`npx tsc -p scripts/legacy-import`。
