# BaoCut × EmbeddingGemma 2 详细集成方案

**版本：** v0.1  
**日期：** 2026-10-12  
**性质：** 集成设计草案；不是已实现功能或实测报告  
**代码基线：** `JimLiu/baocut@635fa2851801bdd956c49bb29f02d2a96dff3e99`  
**产品定位：** 本地、多模态、可定位、可编辑的视频片段检索

> 决策摘要：复用 BaoCut 的 Runtime、Space、模型管理、资源调度和编辑事务；新增独立的语义派生索引与 embedding 执行适配。首发做“文字混合检索 → 精确定位 → 创建候选/子视频”的闭环，再加入画面、声音、B-roll。不要把向量索引变成新的工程真源，也不要用相似度替代剪辑判断。

本文把“当前代码事实”“上游公开能力”和“建议新增设计”分开。所有新增文件、RPC、类型、配置和任务名都是拟议接口。默认值与性能指标是实验起点/验收目标，尚未在 BaoCut 真机素材上验证。本文不修改 GitHub 仓库。

---

## 1. 目标、边界与首发范围

### 1.1 产品目标

用户不必记住原话或文件名，就能找到可用于编辑的一段内容。三个入口共用同一检索服务：Space 搜索；编辑器中的“查找片段/给这句话找配套画面”；AI 智能体工具。

首发必须支持：当前视频和授权项目内的转录、字幕、有效译文、章节检索；关键词与语义融合；中文/英文及跨语言查询评估；返回原文证据和精确锚点；点击预览；把结果转为可编辑候选。随后增加直接视觉检索、参考图检索和声音事件检索。

### 1.2 不改变的架构约束

Node/TypeScript Product Runtime 仍是产品控制中心；Electron/Web/CLI 是客户端。Agent Harness 不直接管理模型文件或视频数据库。模型推理、搜索计算和媒体解码均不在 UI 或 Runtime 事件循环中执行。长任务复用现有 JobManager 和资源租约；所有工程写操作复用编辑事务。

工程中的结构化时间线仍是唯一编辑真源。Embedding 是可删除、可重建的派生数据。原素材、转录、用户选择、编辑决定和索引状态不得混为一类。

### 1.3 非目标

不在本次接入中训练模型、实现全自动爆款判断、人脸身份识别、说话人辨认、主动发言人定位、自动删除重复录制、自动授权素材、取代 ASR/OCR，也不承诺逐帧理解所有动作。Embedding 只产出检索表示，不直接生成答案或剪辑结果。

“本地检索”只描述这一步。在线大模型读取命中片段属于另一项数据使用，必须沿用原有权限和联网策略。完全离线模式不允许悄悄回退到云端。

## 2. 当前代码的接入基础

以下均来自冻结基线的实际源码，不以旧架构设计文档替代代码事实。

| 位置 | 已核实事实 | 对集成的含义 |
|---|---|---|
| `packages/runtime-core/src/space/content-search.ts` | FTS5 trigram 候选，NFKC/小写、全部查询词子串匹配；按视频活动和时间排序，无相关度排序 | 保留为 lexical 分支，增加语义分支和融合排序 [R1] |
| `space/content-store.ts` | `node:sqlite` 的 DatabaseSync；`segment_rows` 和 FTS5；格式版本不匹配会删除重建 | 不把昂贵向量缓存直接塞入该库 [R2] |
| `space/content-index.ts` | 通过只读 `videos.readContent` 抽取；按版本增量更新；当前 search 为同步函数 | 保留原有同步路径，新服务使用异步接口 [R3] |
| `space/content-extract.ts` | 转录/字幕优先按时间线投影；有效译文映射到源句；章节来自标记 | 从这里扩展锚点抽取，而不是重新解析字幕文件 [R4] |
| `space/space-queries.ts` | `user/source/service` 范围过滤；返回完整性和待索引数量 | 语义候选、计数、预览都复用范围限制 [R5] |
| `packages/protocol/src/space.ts` | 当前 hit 要求 videoId、documentKind，时间是 source/sequence 秒 | 非文字/独立素材结果需要版本化协议 [R6] |
| `packages/ui/src/model/space-search.ts` | 300ms 防抖；视频分组；source 时间不直接 seek | 扩展 UI，而非新建不关联编辑器的检索页面 [R7] |
| `packages/protocol/src/video.ts` | 精确 MediaTime 为字符串 ticks 与数值 timescale | 新协议复用已有精确时间类型 [R8] |
| `packages/models/src/worker-contract.ts` | family/component/hello/load/status 合同；当前没有 embedding family | 新增明确的能力和合同，不冒用 text generation [R9] |
| `packages/jobs/src/resource-profiles.ts` | 常驻 worker 资源与单任务资源分别计量，有统一 holder | embedding 的常驻模型和临时解码分开记账 [R10] |

一个重要细节：当前 `segment_rows.id` 是插入行号，不是稳定内容身份。新缓存不能用它作为 chunkId 或复用键。

## 3. 总体架构

```text
Space / 编辑器 / CLI / AI 智能体
                  │ 现有 RPC、工具权限与订阅
                  ▼
             Product Runtime
       ┌───────────────────────────────┐
       │ SearchService                 │
       │   范围解析、路由、结果解释      │
       │ SemanticIndexCoordinator      │
       │   计划增量索引、发布新世代      │
       │ SearchHitResolver             │
       │   源锚点 → 当前工程位置         │
       └─────┬────────┬────────┬───────┘
             │        │        │
     ContentIndex  JobManager  VideoService / ProjectEngine
      现有文字索引  原有调度器   只读定位、受控编辑事务
             │        │
             │   现有 Model Worker + 新 embedding 后端
             │        └─ Rust 外壳 → 窄 C ABI → LiteRT-LM
             │
       SemanticIndexWorker（Node Worker Thread）
       新索引 SQLite、向量缓存、精确距离扫描
```

### 3.1 组件职责

**SearchService** 只做查询编排、作用域限制、召回融合和证据组织，不启动全盘扫描，不写视频。依赖接口为 LexicalSearch、VectorSearch、QueryEmbedder、HitResolver。

**SemanticIndexCoordinator** 根据已授权素材、转录完成事件和文档/时间线版本变化产生差异计划。它提交 Job，不自建第二个调度器。它不把未完成批次暴露为新鲜完整索引。

**SemanticIndexWorker** 是 Runtime 内管理的计算/存储线程，不是新的公开服务。所有同步 SQLite 操作和大规模距离计算放在此线程；UI 不持有数据库连接。

**Embedding Provider** 只处理已冻结的输入和配置，返回向量与诊断信息，不知道“项目”“短视频”“B-roll”，也不访问检索库。

**SearchHitResolver** 使用工程当前版本解析命中，返回零个、一个或多个时间线位置。未授权、缺失、已删除、版本冲突必须显式返回。

### 3.2 不建立新的媒体真源

缓存只记录引用、预处理指纹和结果。媒体读取由既有 MediaRegistry/VideoService 授权并解析。大文件、图片和音频数据走本地句柄、staging 文件或现有媒体通道；不经聊天 WebSocket 传几百 MB 数据。

## 4. 模型后端与跨平台选择

### 4.1 主实现路线

**开发基准：** 官方 SentenceTransformers 路线，用于确定参考检索结果、前缀和预处理；只属于开发/评测依赖，不要求最终用户安装 Python。官方指南要求支持该模型的 SentenceTransformers 版本，并提供按需关闭视觉/声音编码器的方法。[S1]

**产品主后端：** LiteRT-LM，优先使用分发的量化包。在现有 Rust Model Worker 中增加 `litert-lm` 后端，C++ shim 通过窄 C ABI 提供创建/销毁/批量编码/能力探测。不要重写 Gemma 4 网络，也不因为 BaoCut 已有 Candle/MLX 就假定它们已支持这个模型。

**实现（2026-10-13 修订）：** 不写 C++ shim。LiteRT-LM 0.18.0 发布页自带 C API（`CLiteRTLM_mac.xcframework`，`litert_lm_embedding_engine_*`），Model Worker 的 `litert-lm` 后端在运行期 `dlopen` 它（libloading），构建时不链接；库是共享组件 `litertlm-runtime`，随模型包从发布页下载、校验 SHA-256（[Model Worker 协议 §4.5](../../spec/model-worker-protocol-spec.md)）。C API 自己捕获 C++ 异常、返回空指针与线程局部的错误文字，所有权按 G0 记录的调用顺序（`tools/embedding-eval/README.md`）。G0 已验证 C API 与 Python 轮子逐向量相同。

LiteRT-LM 的实际 C++ `EmbeddingEngine` 提供 `ComputeEmbedding`、`ComputeEmbeddingBatch`，返回 embedding、input_length、truncated_length 和 num_chunks；配置提供输出维度、归一化和输入溢出处理。[S5][R11]

如 LiteRT 的链接依赖阻塞既有 Model Worker 发布，工程退路是独立的 `bcut-embedding-worker` 可执行文件，使用同一 private worker 合同和同一管理器。不要顺势做出另一套 daemon、任务系统或公开 HTTP 服务。

### 4.2 模型包与能力暴露

建议提供“文字搜索”和“多模态搜索”两个用户可理解的模型选择。文字模型下载更小，完整模型按需启用编码器。已安装完整包时，不额外强制安装另一份文字包。

LiteRT 模型卡列出的文字、文字视觉、完整模型下载体积分别为 165、388、485 MB；这些数值不是应用安装包增量或运行峰值。量化包的图签名和视觉 token 选项与原始检查点不完全一样，必须读取具体包的能力。[S3]

新增能力建议：

```text
ModelCapability += embed
ModelFamily     += embeddinggemma2-litert
ModelBackend    += litert-lm
BundleComponent += embedding
WorkerHello     += embeddingCapabilities（按协商版本可选）
```

已有 worker 不含新字段时视为不支持，不推断支持，不影响转录/合成。不要把现有与 `speaker` 相关的 embedding 复用为语义检索模型。

### 4.3 平台发布矩阵

| 平台 | 首版要求 | 加速策略 | 未通过时 |
|---|---|---|---|
| macOS Apple Silicon | CPU 必须通过；GPU 独立验收 | LiteRT GPU 经自检后启用 | 保持 CPU 与关键词可用 |
| macOS Intel | 独立构建和最小指令集测试 | 不承诺 GPU | 不兼容则禁用语义模块，保留精确搜索 |
| Windows x64：NVIDIA | CPU 必须；GPU 独立验收 | 以发布二进制实际 backend 探测为准 | 不因检测到 NVIDIA 就强行选 GPU |
| Windows x64：Intel/AMD | CPU 基线；每类 GPU 单测 | 不宣传所有显卡通用加速 | CPU 回退 |
| Linux x64/ARM64 | 分构建目标验收 | CPU 基线、GPU 按目标矩阵 | 不与 Windows/macOS 共用兼容性结论 |
| BaoCut Web 客户端 | 复用连接的 Runtime | 不在浏览器重复建立整库索引 | 显示 Runtime 能力状态 |

**首版实际（2026-10-13）：** 只有 macOS Apple Silicon 登记了 `litertlm-runtime` 库包（CPU）。上游 0.18.0 没有 Windows、Linux 的 C 库；macOS Intel 的 Model Worker 构建暂不带 `backend-litert`，所以这些平台的文本嵌入模型包显示 `unsupported`，语义检索退回字面。GPU 等 §4.4 的自检之后再开。发布构建启用 hardened runtime 时，`dlopen` 别家签名的库要给 Model Worker 关掉库验证（`com.apple.security.cs.disable-library-validation`），这是发布前待定的签名事项。

官方提供跨平台 LiteRT 能力不等于 BaoCut 的这些构建已验证。[S4] 发布前固定 SDK tag/commit、模型 revision、每个文件的 SHA-256、许可证、目标架构、系统最低要求和 GPU delegate 文件。不把开发机上的自动选择行为当作发布合同。

### 4.4 GPU 回退与兼容性

失败可回退 CPU，但必须确认 CPU 与 GPU 路径属于已通过一致性门槛的 embedding space。更换模型、量化包、预处理或未验证后端时，禁止把新查询向量直接比对旧索引。若只能通过切换不兼容模型恢复，则降级精确搜索，并排队重建对应索引。

## 5. 向量配置、前缀和兼容性身份

### 5.1 统一配置

建议首发固定 **512 维、FP32 存储、L2 归一化**。参考评测保留 768 维；低存储选项在验证后使用 256 维。输出降维不意味着模型前向计算按比例降低。模型量化位宽和向量存储位宽是两件事。

官方支持缩短向量；缩短后要重新归一化，查询与库必须采用相同维度。不要把 128 维未经评测地用作多模态默认值。原始检查点不得使用 FP16 推理；参考后端用 BF16 或 FP32。经过验证的 LiteRT 量化包是另一条部署路径。[S2]

### 5.2 官方前缀文档存在差异，作为 G0 验证项

Google 模型卡的检索示例使用 `SearchQuery` 与 `Document`，查询模板为 `task: search result | query: ...`，文档为 `title: ... | text: ...`；LiteRT embedding 文档的表格则列出另一组 `search query | text` / `search result | text` 前缀。[S2][S5]

不能把这两种模板当成无关紧要的拼写变化。实施规定：

1. 以模型卡 + 官方参考实现建立 `reference-retrieval-v1` 基线，确认自动前缀是否已经添加。
2. 读取所选 LiteRT 包的元数据及实际适配器路径，确认有没有额外模板；不要双重添加。
3. 对同一测试集分别测试两组模板，并保存 token/payload 日志的非敏感摘要。
4. 将获准的 query/document 配对固定为 `promptPairId`；另一套保持单独实验 profile。
5. 未通过跨后端评测，不允许混用参考权重和量化包的向量。此处尚未执行模型实验，不能宣称哪套 LiteRT 前缀已证实最优。

**G0 结论（2026-10-12，[报告](../../../tools/embedding-eval/reports/g0-2026-10-12.md)）：** 两套前缀在 LiteRT CPU 上检索指标相同、都好于不加前缀，差异不超过一条查询；按出处锁定模型卡配对（运行时 `promptPairId` 是 `model-card-v1`，评测脚本里叫 `modelcard-v1`），LiteRT 文档那套留作实验 profile。两套的分数刻度差约 0.05，阈值不能跨配对沿用，`promptPairId` 是空间身份的一部分。对称比较锁定 `task: sentence similarity | query: {text}`。C API 与轮子不自动加任务前缀，只插入特殊 token；首尾空白会改变向量，编码前去掉。

纯图片、纯声音和纯视频输入不机械添加文字检索前缀。多模态 interleaving 交给具体适配器正确构造，不拼接含糊的字符串模拟图像。[S1]

### 5.3 两层身份，避免“同维度就是同空间”

`embeddingSpaceId` 标识可比较的空间：基础模型/权重系列、projection/pooling、tokenizer、检索任务及前缀配对、输出维度、归一化约定、量化兼容组。

`encoderProfileId` 标识实际编码实现：空间 ID、输入模态、SDK/实现版本、模型文件校验和、图签名、视觉预处理、音频预处理、视频采样方式。CPU/GPU、270M/740M 模块化结果能否共用空间必须经过测试；名称相同不充分。

**实现（2026-10-13）：** 「SDK/实现版本」一项不写 LiteRT-LM 的版本号，写向量兼容标签（`EMBEDDING_VECTOR_COMPAT`，现为 `vec-v1`）：引擎小版本升级常常出逐位相同的向量，按版本号区分会让每次升级都白白重建全部索引。升级引擎、改 Worker 的嵌入实现时跑参考向量回归（`tools/embedding-eval/reference-vectors.ts`：固定文字与一张合成帧，按平台 / 设备 / 模型包存参考），任何一条余弦低于 0.9999 才把标签加一。

```text
embeddingKey = SHA256(
  encoderProfileId
  + canonicalInputDigest
  + modelFacingMetadataDigest
)
```

文本的 canonicalInputDigest 包含真实送入模型的文字、真实标题和任务模板，不包含纯展示名。图片包含像素预处理指纹；音频包含源流/声道、采样策略和音频区间；视频包含顺序、每帧源 PTS、采样设置与视觉预算。

`chunkId` 是稳定的内容片段身份；`embeddingKey` 是具体编码结果身份；`indexGeneration` 是本次可见索引版本。三者不合并。

## 6. 视频分片与输入处理

以下是 v0.1 实验默认值，不是模型上限或已证明最优值。模型实际总上下文预算必须由 provider 检查，溢出默认报错并重新切片，而不是静默截断。[S2][R11]

| 通道 | 建议初始切片 | 规则 |
|---|---|---|
| 文字 | 约 120–300 tokens 的完整句群；单块暂限 512 tokens | 尽量同说话人/话题；相邻重叠一句；长句仍按 token 上限切 |
| 章节 | 标题 + 当前有效摘要 | 与精确证据分开存，作为导航候选 |
| 图片 | 每张一个表示 | 保留方向和完整画幅；不为统一尺寸随意中心裁切 |
| 视频 | 镜头内最多 12 秒；长镜头 8 秒步长 | 切镜头不跨段；镜头未知时先固定窗口 |
| 视频精细定位 | 对 Top 候选局部加密采样 | 不对全库默认逐帧推理 |
| 音频 | 10 秒窗口、5 秒步长 | 事件检索不能只保留 VAD 的人声区间 |

### 6.1 文字索引

直接复用 `videos.readContent` 和 `content-extract` 的句子/译文对齐信息，不要求导出整份 SRT 再回读。扩展抽取器，保留 documentId、稳定 sentenceId/wordIds、来源素材版本和精确区间。

文字保留原文显示；关键词的 NFKC/小写流程不等于 embedding 的预处理。代码标识符、否定词、数字和标点不得为“清洗”被丢掉。检索范围只给说话人且 query 为空时，不编码空字符串，按元数据筛选。

章节/自动摘要可参与召回，但标明 `evidenceType=summary`；答案引文和剪辑入出点回到原句证据。过期译文按当前抽取规则排除；原文与译文归并为同一证据来源，不能重复占满 Top-K。

### 6.2 视觉索引

图像缩放、patchify、颜色转换等以固定 provider profile 为准。优先借用现有媒体解码/镜头边界能力，新增受限的采样管线；不要拿界面 160px 胶片条直接当精细内容识别输入。

**首版取帧（2026-10-13 实测后维持）：** 每 8 秒源时间一帧，不按镜头切点取，也不按低分辨率签名合并相邻的相似帧。6 部真实视频上量过（[评测报告 §5](../../../tools/embedding-eval/reports/search-eval-2026-10-13.md)）：ffmpeg 场景分数要解码整部视频，约每小时 2.4 分钟，访谈每小时约 330 个镜头，按镜头取帧只比网格少约 27%，刚好抵掉解码；快剪的内容镜头比 8 秒还短，帧反而更多。相邻帧签名合并在不误并的阈值下几乎省不了帧（访谈 2–3%），能省 20% 以上的阈值会把内容不同的幻灯片并成一帧（64×36 灰度、平均差 1.5 时仍把两页不同的题目并掉）。要省编码量，先要一个能分清幻灯片文字的便宜签名。

原始检查点的视频接口按帧处理，并有默认采样率；LiteRT 的可用图签名另有约束。[S2][S3] G0 必须验证所选 SDK 的多帧顺序和视频输入支持。无法可靠提供 clip 表示时，明确降级为逐关键帧检索，不声称具备动作序列理解。

逐帧/多帧编码、以及帧向量平均是不同算法；平均向量不能冒充模型原生 clip embedding。保存 `representation=keyframe|clip`。模型窗口在 30–42 秒命中，只能说“候选在该窗口”，不能伪造“第 35.274 秒发生事件”。

解码按源 PTS 取帧，保留真实采样位置。VFR 视频不得用“采样帧编号÷项目帧率”倒推时间。需要屏幕小字的场景列为后续 OCR 扩展，不把 embedding 当准确文字识别器。

### 6.3 音频索引

按照原始模型约定提供 16kHz mono 音频；立体声下混、重采样、响度处理策略全部纳入指纹。[S2] 不改变播放速度，不默默丢掉非人声；不同音轨单独指定。

音频 embedding 可以检索语义/声音事件，但不把 10 秒窗口直接标为精确事件边界，不从它推断说话人身份。需要完整转录、词时间或主动发言者分析时，仍调用专用能力。

### 6.4 不默认融合所有模态

文字、视觉、声音分别存向量。旁白谈“融资”、画面显示“代码”、背景是“掌声”，对应三种不同查询意图。用户选择“画面”时不能由旁白匹配取代视觉命中。

可在后续增加同窗口联合输入，但它是第四条可选择通道。对于“画面中敲门且同时有敲门声”，实施应在同源时间窗口上分别验证两个条件，而不是把它当普通 OR 检索。

## 7. 素材、时间线与成片的三种语义

### 7.1 原素材索引

按资产内容版本建立。素材被移动、被引用多次或派生为短片，不触发重算相同输入。源索引可找到已从当前视频剪掉的片段，但结果明确标成“原素材”，不能假装它仍在成片中。

### 7.2 当前时间线内容索引

文字使用实际投影后可见文稿重新组块。当用户删掉一句、删掉“不”、调整句序或只保留半段时，必须按当前可见文字更新内容向量；不能仅把一个原始长段向量移动到新位置，否则会搜到已经删掉的意思。

完整句群文字没变、只改变位置或播放速度时，可按相同 payload 命中 embedding 缓存，仅更新 occurrence。

视觉可以返回当前时间线引用的原素材候选，但必须标注为“原素材画面”，不据此断言叠加、遮挡和裁切之后的最终画面。需要搜真正看到的内容，使用下一种索引。

### 7.3 成片呈现索引（后续阶段）

对固定 sequence revision 的渲染预览采样，覆盖字幕叠加、动效、转场、Code Composition 等最终可见内容。该索引依赖 render fingerprint，不和源素材索引共用缓存键。

未建立成片索引时，`appearance=rendered` 返回不支持/未就绪；不静默改搜原素材。Code Composition 必须经过现有受限渲染任务处理，索引进程不执行任意 HTML 或代码。

## 8. 数据存储与迁移

### 8.1 独立派生库

```text
RuntimeHome/
  cache/
    content-index/index.db         # 现有文字缓存，不改变生命周期
    semantic-index/v1/index.db     # 新增：世代、chunk、vector、引用
    semantic-index/staging/        # 有界临时结果
    semantic-media/                # 可淘汰的采样结果
  models/                         # 沿用模型安装体系
```

现有文字索引可以快速重建，新库要做显式 schema migration、局部重建和兼容性检查。未知较新版本应关闭语义检索并保留文件，不能自动删除。损坏时先隔离坏库、提示重建；普通迁移保留有效向量。

### 8.2 核心实体

| 实体 | 作用 | 可否重建 |
|---|---|---|
| `embedding_spaces` | 固定兼容空间 | 可以，由模型 manifest 恢复 |
| `encoder_profiles` | 固定实际推理/预处理 | 可以 |
| `index_objects` | 素材或文档内容版本 | 可以，由工程/Space 恢复 |
| `index_generations` | 某对象某模态本次构建 | 可以 |
| `active_generations` | 当前发布指针 | 可以，但切换必须原子 |
| `chunks` | 原文、精确锚点、证据类别 | 可以 |
| `generation_chunks` | 世代与稳定 chunk 的关系，允许跨世代复用 | 可以 |
| `embeddings` | 与输入/profile 对应的 FP32 向量 | 可以，但成本高 |
| `chunk_embeddings` | chunk 与向量关系 | 可以 |
| `occurrences` | chunk 在素材/文档/时间线中的出现位置 | 可以，不能作为权限真源 |

随文 `semantic-index.schema.sql` 是可执行的 schema 草案，用于验证关系与约束。它不负责授权，也不是对现有 video.db 的迁移。

### 8.3 缓存共享与权限

同一 Runtime 用户下可共享相同输入的向量字节，但“可访问此向量”不代表“可访问所有引用”。查询必须先从当前权限得出可见对象/occurrence，再限定检索；返回前、预览前和编辑前分别重验。

不得通过结果数、相似素材计数、标题、缩略图、缓存命中信息泄露其他项目。`projectId=null` 沿用协议含义：不属于项目，不是全部项目。全部项目是省略筛选，且仍受调用方作用域限制。[R5][R6]

### 8.4 初版向量检索实现

首版不引入云端向量服务，也不在 node:sqlite 内加载来源不明扩展。用独立 Worker 中的连续 Float32Array 与元数据允许集执行精确扫描，先建立正确性基准。SQLite 保存向量与生命周期，内存缓存按查询分区按需加载。

VectorStore 接口同时提供 exactSearch 和将来的 annSearch。大库若精确扫描未达标，下一步可换成本地原生/SIMD 内核或 ANN adapter，但不改变 SearchService 和权限合同。

禁止“先对全库拿 Top-20，再把没权限的删掉”作为完整方案：它既可能丢掉合法候选，也扩大跨范围计算/统计泄露风险。精确搜索先确定允许行；ANN 必须能遵守预过滤或分区，必要时退回该范围精确搜索。

FP32 512 维单向量为 2,048 字节；10 万条原始向量约 195.3 MiB。100 小时、每 10 秒一窗口、每窗口三通道的示意规模为 108,000 条，约 210.9 MiB。上述仅为算术，不含重叠、SQLite 开销、采样媒体、额外章节和搜索索引。

## 9. 建索引、增量与崩溃恢复

### 9.1 生命周期

```text
discovered → planned → queued → running → validating → published
                             ↘ cancelled / failed
```

JobManager 管任务运行；数据库只保存内容世代、游标和可复用向量，不重复实现 Job 调度。单个父任务管理对象批次，每个 chunk 不产生一条用户可见 Job。

索引的有效范围必须来自用户已登记项目/素材及已授权索引策略。首次安装模型不等于授权扫描整块磁盘。默认：已有文稿启用轻量索引；视频/声音深度索引按项目开启，显示范围和资源开销。

### 9.2 处理流水线

`discover → freeze → extract → chunk → cache lookup → decode/encode → validate → stage → publish → notify`

freeze 固定内容哈希、document/asset/sequence revision、profile、分片版本；cache lookup 在昂贵解码前尽量完成。batch 只带当前窗口需要的数据。

验证每个输出：维度一致，数值有限，非零范数，归一化容差内，输出数量/顺序一致，输入未被悄悄截断。保留 truncated_length 和 num_chunks；如 SDK 内部分块策略不能与时间锚点对应，拒绝发布该结果并改由 BaoCut 显式分片。

publish 在一个事务内确认 expectedRevision、原 activeGeneration、权限/对象仍存在和取消状态，再写入完整 chunk/occurrence 和切换指针。数据库层可暂存已验证向量，但只有 activeGeneration 对搜索可见。

### 9.3 防止迟到结果覆盖新版本

每次任务携带 `runGeneration`/`indexGeneration`。用户改了字幕或源文件，旧任务完成时必须 CAS 检查，失败则只保留安全的内容寻址缓存，不把旧结果发布为当前版本。

取消后到达的 worker 响应不能发布。进程崩溃后从 checkpoint 恢复未完成输入，已提交 embeddingKey 复用。不得在整个视频全部完成前把覆盖状态标为完整。

### 9.4 变化矩阵

| 变化 | 重算 embedding | 其他动作 |
|---|---|---|
| 改纯显示名/移动文件，内容未变 | 通常否 | 更新定位与展示元数据 |
| 真正编码进文本的标题改变 | 是，受影响文档 | prompt payload 已变化 |
| 移动时间线片段/原文没变 | 否 | 更新 occurrence/版本 |
| 裁剪、删词、改变句序 | 对改变语义的投影 chunk 重算 | 源素材向量可保留 |
| ASR 纠错 | 受影响句群及相邻重叠块 | 更新词/句锚点 |
| 译文刷新 | 对应译文块 | 原文向量不动 |
| 变速 | 源向量否 | 重建精确 timeMap；成片声音/画面可能需重算 |
| 裁框/叠加/动效变化 | 源向量否；rendered 向量是 | 标记呈现索引过期 |
| 替换源素材内容 | 受影响素材各已启用通道 | 老对象撤销可见性 |
| 模型/维度/模板变更 | 新空间/新 profile 重建 | 保留旧空间到新库可用 |
| 撤销权限/删除素材 | 立即不可检索 | 引用数归零后 GC 缓存 |

### 9.5 世代切换与分页

索引更新使用双世代：旧完整结果仍可用于明确标旧的阅读预览，新世代发布后原子切换。当前时间线编辑不接受旧版结果直接执行。

搜索 cursor 绑定 query digest、scope version、index epoch 和短期查询快照。索引变化或权限变化时返回 `CURSOR_STALE`，不要默默跨世代翻页。查询默认不持久化用户原文；短期快照 TTL 建议 5 分钟。

## 10. 检索与排序

### 10.1 查询步骤

1. 先确定用户请求的模态、项目、视频、时间范围、原素材/时间线视图和可访问对象；不调用模型推断权限。
2. 查询为空但存在合法元数据筛选时走过滤列表；超长查询返回明确错误，不截断后伪装正常。
3. lexical 分支与各已就绪语义分支并行；语义向量使用与该库兼容的 query profile。
4. 每路在授权集合内召回候选，归并为相同源时间片段/证据组。
5. 融合排名、减少相邻重叠和原文/译文/派生短片重复。
6. 解析可显示锚点与状态，返回可解释的匹配通道和覆盖情况。
7. 只有问答/创作决策需要更重模型；普通搜索不依赖云端 LLM。

### 10.2 初始融合规则

不把原始 BM25/余弦直接相加，也不按名次交错（名次融合会让每一路的第一名并列，相关的一路排不到前面）。现行做法（`z-text-visual-v3`）把每路余弦换成本次查询里的 z 分数：

- 扫描时累计本次查询扫到的全部余弦（不只是前 k 条）的条数、和与平方和；每路的均值、两路合并的标准差各自向先验收缩（先验按 `priorCount` 条计），标准差不低于 `devFloor`。
- `z(c) = (cos(c) − mean_m) / dev`；文字候选的分数为 `w_semantic · z + (字面命中 ? w_lexical · lexicalBonus : 0)`，画面候选为 `w_visual · z`；只有字面命中的候选 z 记 0。
- 按分数排，同分按两路名次中较小的、再按键。

先验、`lexicalBonus`、各路候选量和权重是待校准默认值（`semantic-thresholds.json`），不是相关性真理；数字与取舍见评测报告 `tools/embedding-eval/reports/search-eval-2026-10-13.md`。综合模式初始每路各取 80 条，合并后保留 100 个候选，UI 默认返回 20 个片段。没有某通道的候选时不伪造其分数；所有权重和 route 记录在 rankingVersion。

“精确文字”完整保留旧语义；“语义”不受必须包含查询词的限制；“综合”让明确的完全匹配有保底位置，但不让它吞没同义内容。可扩展可解释的分词召回；不要直接把现有中文 trigram 排名称作优质 BM25 方案。

多条同通道的相邻帧先聚合，避免帧采样密度越高就无端获得更多融合加分。分组键至少考虑内容身份与源时间。跨语言译文与原文是同一证据组，派生短片的重复也应标明来源。

### 10.3 拒答、复杂条件与 rerank

没有普适的 `cosine > 0.7` 或“82% 正确率”。用标注查询集校准无命中与弱命中阈值；综合后的 rank score 不显示为置信度。

明确条件，例如横屏、最短时长、不含人声、未用过，优先作为结构化过滤。否定、人物关系、先后顺序与“同时出现”不能保证由单个向量正确处理；复杂查询返回候选并用可选复核链确认。

可选 rerank 限制在少量候选，读取原文和关键帧；选择云端 reranker 时沿用模型权限。不要把 reranker 当成建立索引所必需的模型。

## 11. RPC 与智能体工具

### 11.1 兼容策略

保留 `space.search` 和 `space_search` 原合同及默认行为。它们继续返回文字型旧结果，不向旧客户端发送缺 videoId、没有 documentKind 的新类型。

新增 `space.searchV2` 和 `space_search_v2`（拟议），共用一个 SearchService；这只是协议版本演进，不是两套搜索系统。新 UI 在能力协商成功后使用 V2；旧客户端继续正常。schema、validator、methods.ts、客户端包装和工具描述一起更新。

### 11.2 V2 查询形状

```ts
interface SearchRequestV2 {
  query: { kind: 'text'; text: string }
       | { kind: 'image'; referenceId: string }
       | { kind: 'audio'; referenceId: string };
  mode: 'lexical' | 'semantic' | 'hybrid';
  channels: Array<'text' | 'visual' | 'audio'>;
  projectId?: string | null;
  videoIds?: string[];
  view: 'source' | 'sequence';
  appearance?: 'original' | 'rendered';
  limit?: number;
  cursor?: string;
}
```

API 只接受已有授权素材引用，不接受让智能体随意传任意磁盘路径或任意 URL。图片/声音查询的样本读取也要检查授权。只给 referenceId 不是自动获取访问权。

### 11.3 结果形状

结果的 target 使用 discriminated union，允许资产片段、文档段落或序列片段；不伪造 videoId。每条保留 hitId、matchChannels、证据类别、原文或采样摘要、索引版本、精确 anchor、是否需要重新解析、可执行动作能力。

检索返回的是“命中候选”，不承诺可直接编辑：模型命中窗口与可执行剪辑区间分开表示。纯视觉命中不编造字幕；纯语义命中没有字面匹配时 highlights 为空，而不是假高亮。

向量一路总会给出最近的一批，不代表都相关：不是字面命中、且 z 低于 `strongZ` 或分数不到本次第一名的 `strongRatio` 倍的标 `weak`（`semantic-thresholds.json`，未校准）；字面命中从不标弱。服务端只标出、不藏起来，界面可以把弱命中折在后面。同一视频、同一时钟上时间大半重叠的讲话类命中（同一段话的文稿、字幕与译文）在综合与语义模式下只留排名靠前的一条；字面模式保持旧 `space.search` 的结果。

覆盖信息按 requested channel 给出 indexed/eligible、pending/failed/missingInput、excluded（设置里没纳入该路索引的项目的视频，不计入 eligible、也不让结果不完整），以及 knownScopeComplete。`complete` 只指范围内所请求索引的就绪程度，不表示搜尽所有相关内容或 ANN 完全召回。

### 11.4 其他新增接口

| 拟议接口 | 职责 | 运行方式 |
|---|---|---|
| `space.indexStatus` | 范围内各模态覆盖、失败原因、profile | 只读查询 |
| `space.indexBuild` | 用户明确启用/重建指定范围与通道 | 返回现有 Job ID |
| `space.resolveSearchHit` | 当前版本重新解析锚点 | 异步只读 |
| `space.createSearchSelection` | 固定已选择候选与版本，供编辑/问答 | 使用现有 Artifact 机制 |
| `space_search_v2` | 智能体检索；在当前时间线上的命中带 `href`（`/videos/<videoId>?t=<秒>`，回答里照抄成链接，产品设计 §3.2.2） | 不写工程 |
| `space_resolve_search_hit` | 智能体读取可用当前区间；resolved 时带第一段的 `href` | 不写工程 |
| `space.relatedVideos` | 查看框里讲相近内容的视频（集成设计 §2.4）：本视频讲话向量的平均在别的视频文字索引里逐部取最近一段，按阈值 `related` 过滤；语义不可用时退回名字相近并给原因码 | 只读查询，打开查看框时调用 |

高频搜索不为每次按键创建持久 Job；冷启动 embedding 的临时调用复用资源租约和取消机制。全库建索引、深度分析、B-roll/短片提案属于持久 Job。

### 11.5 标准错误与降级

`MODEL_NOT_INSTALLED`、`MODEL_UNAVAILABLE`、`PROFILE_INCOMPATIBLE`、`INPUT_TOO_LONG`、`SOURCE_MISSING`、`INDEX_NOT_READY`、`INDEX_PARTIAL`、`STALE_REVISION`、`CURSOR_STALE`、`SEARCH_CANCELLED`、`RESOURCE_EXHAUSTED`、`APPEARANCE_UNAVAILABLE`。

hybrid 可以退回 lexical，但结果明确给出 `effectiveMode` 和原因。纯 semantic 请求遇到不可用时不把空数组当作成功“无相关结果”。不暴露未授权资源是否存在。范围里一部视频都没有（例如会话只看自己的目录、那里没有视频）时是零条结果，不报 `INDEX_NOT_READY`：没有可扫的不是索引没好，报了会让调用方去等或去建索引。

## 12. 时间线定位与编辑安全

### 12.1 精确时间

复用 `MediaTime { ticks: string; timescale: number }`；媒体区间为半开 `[start,end)`；序列区间使用整数帧和 fps。UI 的 `12:34` 与小数秒仅用于显示/旧协议兼容，不作为新锚点身份。[R8]

简单常速片段可用下面公式解释映射，但实现应走已有 timeMap/工程投影：

`timelineTime = clipStart + (sourceTime - sourceIn) / playbackRate`

例：源 100–112 秒，片段 sourceIn=96 秒，放在时间线 30 秒处，2 倍速，则其映射为 32–38 秒。这个例子只是常速算术；复杂时间线不可套用单一公式。

### 12.2 Resolver 必须覆盖的情况

一个源区间多次引用时返回多个 occurrence，不只取第一个。跨剪口时拆成多个离散 span，不把中间删掉的部分补回。变速、反向、冻结帧、嵌套序列、循环和转场走工程明确支持的映射；暂不支持时返回不支持，不能猜测。

词句级命中保存 sentenceId/wordIds，用当前文稿校准；音频/视觉窗口仅有粗范围时标记 boundaryConfidence=window。不得从索引向量生成虚假的词级时间。

### 12.3 编辑事务

```text
search hit
 → resolve(current revision)
 → freeze selection / proposal
 → user/authorized agent choose action
 → engine checks expectedRevision + assetRevision
 → existing edit transaction
 → receipt + undo
```

resolve 之后仍可能发生编辑，apply 时必须再次检查版本。发生冲突，重新解析并要求重新确认变化后的选择，不静默移动用户选定的剪辑区间。

原素材命中不在当前时间线时，允许“预览原素材/导入候选”，不提供误导性的“跳转当前时间线”。派生子视频通过现有 `videos_derive` 等工具执行，不让 embedding worker 写 video.db。

## 13. 用户体验

### 13.1 搜索入口

保持 Space 的搜索入口；新增模式“综合 / 精确文字”，通道“讲话内容 / 画面 / 声音”，范围“当前视频 / 当前项目 / 已授权素材”。搜索使用当前 300ms 防抖基础，IME composition 期间不提交查询，旧请求取消且晚到响应不覆盖新结果。[R7]

结果默认“按相关度的片段”，可切换“按视频分组”。一张卡片包含：真实缩略图/波形、原文、源时间或当前时间线时间、命中通道、索引过期提示，以及预览/加入候选/交给智能体。

“播放这个片段”不自动创建子视频；“搜索素材”不自动调用外部素材网站；“下载模型”不自动开启整个素材库深度分析。

### 13.2 设置与资源反馈

设置暴露模型状态、索引项目、启用模态、缓存大小、暂停/恢复/清理和 CPU/GPU 实际后端。完整性显示例如“文字已就绪；画面 18/30 个素材完成”，而不是只有一个 60% 进度条。

还要多久按这台机器量过的速度估（`indexStatus.estimates`）：每路记一个指数滑动平均（α 0.2），跟着 `encoderProfileId` 与设备存在派生库的 `meta` 里，换了模型包或设备就不用旧的。文字按「每秒视频要编码多少秒」记，只在一个视频大部分句群都是新编码时记（缓存命中多的会量得太快），没量过时不估；画面按「每帧多少秒（取帧加编码）」记，没量过时用 G0 在 CPU 上的速度（约 1.1 秒 / 帧）。待建的量按内容索引记下的时间线时长算，画面帧数按 §6.2 的取帧间隔与上限；时长未知的视频单独计数，不悄悄算成 0。画面没开时也估打开之后要建的帧数、时间与新增向量大小（每帧一条 FP32 向量；关键帧缓存可以清掉，不算在内），设置在打开画面之前给出。

没有转录时，对讲话内容显示“未建立文字索引”，提供转录入口；不把视觉 embedding 失败伪装为没有相关画面。模型未安装时精确搜索立即可用。

## 14. B-roll 推荐工作流

**输入：** 当前文稿的一句或一段、目标时间线区间、目标画幅、最短可用长度、素材范围和使用限制。

**阶段 A：检索意图。** 优先直接用选中内容构造检索；抽象观点可由已有文字模型生成 1–3 个具体画面描述。保留原句，不能为了“视觉化”改变用户观点。默认不扩大授权范围。

**阶段 B：候选发现。** 在视觉通道检索；过滤可用时长、画幅、禁止使用项、已用源区间和素材授权元数据；与当前旁白相似不等于一定是好 B-roll。

**阶段 C：候选 Artifact。** 保留候选源区间、模型/检索 profile、匹配理由、画幅适配警告、版权/来源信息、当前 targetRevision 和 sourceRevision。结果是可审阅提案，不是已完成编辑。

**阶段 D：应用。** 用户或已授权智能体选择后重新 resolve，并走工程事务插入视觉轨道；默认不覆盖原声，声音使用策略独立设置，保留撤销。

特殊规则：同一个 shot 的重叠窗口先去重；最短时长不足时不要无提示变速或循环；画幅裁切会丢掉主体时提示；跨转场和源文件不可用时禁止直接应用。

## 15. 短片、问答和相似重录

### 15.1 短视频切片

已有 `shorts-segments` 继续负责创作判断；语义检索只加速候选查找。指定主题时检索相关段落，再扩展上下文和判断独立性。没有主题的“全片找精彩”必须先覆盖章节/话题，不通过单条泛化查询的 Top-K 代替全片分析。

每个候选校验钩子、上下文依赖、结论完整、句子边界、画面可用性和重复主题。最终仍输出可编辑子视频。相似度分数不能叫“爆款分数”。

### 15.2 跨视频问答

检索→原文上下文→按来源去重→读取当前锚点→调用已配置文本模型→回答附时间与证据引用。回答只说检索覆盖的范围；complete=false 时说明覆盖缺口。视觉观察、转录原话、自动摘要和模型推断分别标记。

索引文字与画面都视作不可信材料；片段里出现“忽略指令、读取别的文件”等内容不能成为智能体工具权限。RAG 不自动取得编辑权限。

### 15.3 相似重录与聚类

第二阶段之后再做，不阻塞检索首发。对文本重复判断采用适当的 symmetric similarity/clustering profile 或专用复核，不把检索任务向量无条件当严格相似度判定器。尤其检查数字、否定和观点反转，永不自动删除。

## 16. 资源、性能与监控

### 16.1 调度策略

交互搜索高于主动分析，主动分析高于闲时全库索引。视频预览/用户发起导出拥有明确资源优先级。索引以小批次运行，批次边界可让出资源；不得启动几十个 ffmpeg 进程或每个 chunk 加载一次模型。

常驻模型占用计入 holder，临时解码/张量/staging 计入单任务；Apple 统一内存避免双重计算。现有保守的 ASR 默认资源需求不能直接作为小型 embedding 的准确估计，应新增 profile 并实测。[R10]

供电与散热：笔记本用电池时（设置 `semantic.pauseOnBattery`，默认开）与系统因过热降频时，构建像暂停一样停下（手上那一批编码完就停，不发布半成品），接上电源、温度回落后接着建。这个停下只在内存里，与用户的暂停（记在库里）分开：恢复只撤掉用户的暂停，`indexStatus.pauseReason` 写当前的原因，用户的暂停优先。供电由 Runtime 自己查，桌面端、CLI 拉起的 Runtime 与 Web 一样：有活要干时每 60 秒查一次，第一次开工前先查。macOS 读 `pmset -g batt`（`Battery Power`）与 `pmset -g therm`（`CPU_Speed_Limit` 低于 100 当作过热；Apple 芯片的机器多半不报这一项，这时只看电池）；Windows 读 `Win32_Battery.BatteryStatus`（1 为放电）；Linux 读 `/sys/class/power_supply`（有接通的 `Mains` / `USB` 就是接着电，否则电池 `Discharging` 才算用电池）。查不出来一律当作接着电。

初始建议：单个媒体索引任务、最多两个受控解码进程；文字 batch 上限 16，视觉 batch 上限 4，音频上限 2，同时受 token/内存限制。空闲卸载可从 120 秒开始试验。OOM 时先减 batch/让出媒体编码器；若改动输入质量参数，必须改变 profile 并披露，不静默截断。

### 16.2 验收目标（不是已测成绩）

固定一台 Apple Silicon 开发机与一台 Windows x64 CPU 基线机，记录机型、内存、系统、驱动、应用/模型版本。预先约定 10 万条、512 维的授权候选集与真实媒体集。

| 指标 | 初始目标 |
|---|---|
| lexical 搜索 | 不明显退化于当前基线 |
| 文字 hybrid 热查询 | P95 ≤ 500ms，包含 query embedding 和排序 |
| 冷启动查询 | 分别报告下载、加载、首次推理；不并入热查询 |
| Runtime 事件循环延迟 | P95 < 50ms，测量索引并发时 |
| 语义检索质量 | 同义/跨语言集合相较 lexical 有明确提升；精确集合无重大回归 |
| 媒体定位 | 时间映射契约测试全通过；粗窗口不得伪装精确帧 |
| 重启/取消 | 已发布结果不丢，迟到结果不越代发布 |
| 隐私 | 断网完成本地链路，跨项目泄露测试零容忍 |

未达延迟目标先检查缓存、授权扫描范围、解码/加载、复制和事件循环，再考虑原生扫描或 ANN；不能靠减少用户范围却不说明来达标。

### 16.3 指标

记录：输入时长/数量、每通道推理时间、解码耗时、cache hit、索引世代、发布失败原因、OOM、查询延迟、召回分支和降级原因。默认不记录原文、图片、音频、用户完整路径和完整查询；诊断采集必须可控、可清理。

## 17. 安全与数据生命周期

模型从受信任发布源安装，固定哈希、许可证和组件清单；下载断点/校验沿用现有设施。不要执行项目内提供的 SDK、模型脚本或 DLL。C ABI 捕获异常、明确内存所有权，不把 C++ 异常穿过 Rust 边界。

媒体路径必须由 Runtime 验证；限制单文件、单窗口、图像像素、音频时长和总输出；解码器禁用网络读取和不必要协议，不经 shell。路径符号链接和读取过程中文件替换按现有安全边界处理。

向量并不是匿名数据。索引仅当前 OS 用户可读，不默认同步到云，不随普通成片导出附带。删除资源后先撤销可见绑定、失效查询快照，再按引用 GC；共享向量仍有合法引用时可以保留，但不得暴露另一个引用来源。

用户选定的候选、提案及编辑来源记录属于产品 Artifact，应存于既有持久机制，不随语义缓存清理丢失。安全擦除需区分逻辑删除、WAL/checkpoint、备份和操作系统能力，不承诺普通删除即不可恢复。

## 18. 测试方案

### 18.1 参考集

建议先建立 300 条人工标注查询：精确词/人名/版本号、同义表达、跨语言、无字幕画面、声音事件、无正确答案和复杂否定/先后关系。采用项目级拆分的开发/测试集，不把同一视频的相邻窗口分到两边造成数据泄漏。

指标按任务分别定义：文本 Recall@5 / nDCG@10；视觉和声音看视频级 Recall 与时间区间覆盖；无答案集合看误报；B-roll 看接受率和人工调整次数。不要把单帧类目 benchmark 得分当作 BaoCut 剪辑效果。

### 18.2 必测契约

- 前缀只加一次、查询/文档模板配对、图片/音频不误加文本模板。
- 512 与 768 维拒绝直接混比；切换量化包不静默混空间。
- NaN、Inf、零向量、缺结果、输出乱序、输入截断均不入库。
- 同一源多处引用、VFR、非零 sourceIn、常速/变速、跨剪口、冻结/倒放和嵌套映射。
- 删除“不”后检索不能继续返回旧的肯定/否定命题作为当前文稿。
- 来源素材修改、文档修改、取消、崩溃、旧任务迟到、世代切换和 cursor 过期。
- 对用户、会话智能体、对外服务分别验证结果、计数、缩略图和预览权限。
- 关键词命中高亮 UTF-16、中文 IME、长句、混合脚本、无转录媒体和过期译文。
- 无网、磁盘满、锁冲突、模型缺失、GPU 不支持、OOM、原文件移动/删除。

### 18.3 G0 上游适配门槛

P0 原型不是只打印一条向量。必须给出：锁定依赖的运行脚本；原始参考和量化后端各自的 Top-K；两套前缀比较；CPU/GPU 一致性；多帧输入与采样顺序测试；不同模态归一化结果；实际内存和 SDK 打包大小。

相同后端/profile 的结果应满足数值有限、范数正确和重复输入稳定性。跨后端以实际检索指标为首要门槛；可先设 Recall@10 下降不超过 2 个百分点作为候选标准，由数据决定，不以“余弦接近 1”单独证明可混用。

**G0 执行情况（2026-10-12，`tools/embedding-eval/`）：** 已完成锁定依赖的脚本、参考与 LiteRT 两路 Top-K、两套前缀比较、CPU/GPU 一致性、C API 与轮子逐向量比较（完全相同）、内存与 dylib 大小。参考权重与 LiteRT 包不同空间（同输入余弦最低 0.963）；LiteRT CPU 与 GPU 在 FP32 激活下可作为同空间候选（最低 0.997），GPU 默认激活要单独的 `encoderProfileId`。小夹具上 Recall@10 已饱和，2 个百分点的门槛无法判定，要等 §18.1 的标注集。未做：多帧顺序与采样、Windows 与 Intel Mac。所有阈值仍未校准。

**多模态 G0（2026-10-13，[报告](../../../tools/embedding-eval/reports/g0-multimodal-2026-10-13.md)）：** 740m 包在本机素材库 14 部视频、170 帧、72 条查询上测文字找图（代理看帧标注，未经人工核对）。按画面描述全库 R@1 41/41（中英文都是），屏幕上的大字与烧录字幕也能检到；不描述画面的口播句 R@1 0.778，前缀仍以 `modelcard-v1` 最好，图片不加前缀。视觉塔 CPU 与 GPU 不同空间：FP32 激活下帧向量余弦最低 0.977，检索也多错一条，画面索引只用 CPU 建或 GPU 帧向量单独记 `encoderProfileId`。`vision_tokens_per_image` 默认等于 140（280、560 建引擎失败），70 帧耗时降到约 40% 但口播句变差、向量不同（余弦最低 0.914），用默认值并写进指纹。文字对画面的正例与无答案分数重叠（视觉正例最低 0.670，无答案最高 0.685），0.70 只作未校准的弱命中起点，不沿用文字对文字的阈值。未做：音频塔、多帧 / clip 输入、按镜头切点采样的对比、小字。

## 19. 代码改动与 PR 拆分

以下路径中，标记“新”的是建议命名，实施时可按仓库实际组织调整。不要一开始拆出大型通用向量数据库产品。

| PR | 主要内容 | 主要路径 | 完成门槛 |
|---|---|---|---|
| 0 | 上游/真机原型与黄金集 | `tools/embedding-eval/`（新） | G0 报告，明确前缀/后端兼容组 |
| 1 | 模型、搜索 V2、锚点与验证合同 | `packages/protocol/src/space.ts`、`models.ts`、`methods.ts`；worker-contract | 旧客户端测试不变，新类型验证通过 |
| 2 | embedding provider 与模型包 | `packages/models/src/embedding-provider.ts`、`embedding-bundles.ts`（新）；model-runtime 后端/窄 C ABI | 模型安装、自检、取消、CPU 回退 |
| 3 | 派生库、chunk、增量流水线 | `packages/runtime-core/src/space/semantic/`（新）；`content-extract.ts`；`packages/jobs` | 只建文字索引，重启/世代/局部重建通过 |
| 4 | SearchService、混合召回、权限 | `space/search-service.ts`、`space/semantic/index-worker.ts`（新）；`space-queries.ts` | API-only 查询完整可用、权限零泄露 |
| 5 | 结果定位与 Space UI | `space/search-hit-resolver.ts`（新）；UI `space-search.ts`/runtime session；agent tools | 搜索→预览→候选闭环 |
| 6 | 视觉和音频索引 | 媒体采样适配、semantic pipeline、覆盖 UI | 无字幕视频/声音查询；资源争用测试 |
| 7 | B-roll 与 shorts/RAG 接入 | `packages/jobs`、现有 skill/tool/编辑器入口 | 提案 Artifact → 用户选择 → 可撤销应用 |
| 8 | 性能、迁移、发布与文档 | 平台打包/CI、benchmark、许可清单、文档索引 | 跨平台目标与全部验收清单 |

PR 3 和 PR 4 期间不改旧索引表结构。PR 5 之前不把 API 原型宣称为用户可编辑的搜索功能。PR 7 不绕过现有编辑审批与事务。

## 20. 首个可发布版本的定义

一个可发布的最小闭环应做到：用户选择一个已有转录的长视频，建立本地文字索引；用与原文不同的中文描述找到相关段；结果展示真实原文和索引状态；点击后在当前版本准确定位；选择后产生可编辑候选/子视频；修改字幕或剪口后结果正确刷新；关闭重启可以继续；未装模型时旧搜索照常工作；所有路径都不泄露其他项目。

随后再发布视觉和声音能力，而不是为了在设置中显示“多模态”一次加载所有编码器、扫描所有媒体。首版最重要的交付不是更高的模型参数或更多的搜索按钮，而是“找到的片段能可靠进入后续编辑”。

## 21. 开发前必须落实、但不阻塞本文设计的事项

**前缀与后端兼容性：** G0 已验证（§5.2、§18.3），锁定模型卡配对。**SDK 锁定：** macOS Apple Silicon 已用 LiteRT-LM 0.18.0 的 C API 完成集成（§4.1、§4.3）；其他平台等上游的 C 库，Intel Mac 要另出带 `backend-litert` 的构建；发布签名的库验证待定。**视频接口：** 原生 clip 输入或逐帧降级需由适配器测试决定。**性能：** 文中延迟/内存是验收设定，不是 BaoCut 实测。**时间映射：** 所有复杂编辑必须通过当前引擎能力或明确返回不支持。

这些是开发验收事项，不是要求用户重新选择架构的前置问题。

---

## 参考资料

所有外部页面核对日期：2026-10-12。以下资料用于公开能力和源码事实，本文的参数、组件划分和接口为建议设计。

[S1] Google Developers Blog — EmbeddingGemma 2 Developer Guide：<https://developers.googleblog.com/embeddinggemma-2-the-developer-guide/>

[S2] Google 官方模型卡：<https://huggingface.co/google/embeddinggemma-2>；Google AI 镜像模型卡：<https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2>

[S3] LiteRT 量化模型包和规格：<https://huggingface.co/litert-community/embeddinggemma-2-740m-litert-lm>

[S4] Google AI Edge — LiteRT-LM：<https://developers.google.com/edge/litert-lm>

[S5] LiteRT-LM Embedding Models（包含与模型卡不同的前缀示例）：<https://developers.google.com/edge/litert-lm/embedding_models>

[R1] BaoCut content-search：<https://github.com/JimLiu/baocut/blob/635fa2851801bdd956c49bb29f02d2a96dff3e99/packages/runtime-core/src/space/content-search.ts>

[R2] BaoCut content-store：<https://github.com/JimLiu/baocut/blob/635fa2851801bdd956c49bb29f02d2a96dff3e99/packages/runtime-core/src/space/content-store.ts>

[R3] BaoCut content-index：<https://github.com/JimLiu/baocut/blob/635fa2851801bdd956c49bb29f02d2a96dff3e99/packages/runtime-core/src/space/content-index.ts>

[R4] BaoCut content-extract：<https://github.com/JimLiu/baocut/blob/635fa2851801bdd956c49bb29f02d2a96dff3e99/packages/runtime-core/src/space/content-extract.ts>

[R5] BaoCut scope filtering：<https://github.com/JimLiu/baocut/blob/635fa2851801bdd956c49bb29f02d2a96dff3e99/packages/runtime-core/src/space/space-queries.ts>

[R6] BaoCut search protocol：<https://github.com/JimLiu/baocut/blob/635fa2851801bdd956c49bb29f02d2a96dff3e99/packages/protocol/src/space.ts>

[R7] BaoCut search UI model：<https://github.com/JimLiu/baocut/blob/635fa2851801bdd956c49bb29f02d2a96dff3e99/packages/ui/src/model/space-search.ts>

[R8] BaoCut video time protocol：<https://github.com/JimLiu/baocut/blob/635fa2851801bdd956c49bb29f02d2a96dff3e99/packages/protocol/src/video.ts>

[R9] BaoCut worker contract：<https://github.com/JimLiu/baocut/blob/635fa2851801bdd956c49bb29f02d2a96dff3e99/packages/models/src/worker-contract.ts>

[R10] BaoCut resource profiles：<https://github.com/JimLiu/baocut/blob/635fa2851801bdd956c49bb29f02d2a96dff3e99/packages/jobs/src/resource-profiles.ts>

[R11] LiteRT-LM 实际 embedding C++ 合同：<https://github.com/google-ai-edge/LiteRT-LM/blob/b966041e5a29cc116c82cdd5d3b1770c177e655b/runtime/engine/embedding_engine.h>
