---
description: 配乐与音效的机制：配乐从哪来、本机音乐生成怎么提交、风格描述怎么写、长视频怎么铺满、放上配乐轨后怎么在人声下压低、程序化音效、分析配乐的节拍与能量、许可与试听。给视频配乐、配音效或要一段音乐之前读。
---

# 配乐与音效：音乐生成、配乐轨、音效与节拍

## 何时用

- 给视频配背景音乐：剪口播、旁白成片、从零做的成片都一样。
- 要一段纯音乐或一首歌，交一个音频文件。
- 已有配乐要换、调音量，或在人声下压低。
- 给画面上的事件配音效（标题落版、转场、数字跳动、揭晓）。
- 剪辑点、代码画面要跟着配乐的拍子与能量走。

念一段话、配音见 [voice](voice.md)。音效用 {{tool:assets_sfx}} 的内置配方在本机合成（见下文「音效」），不到网上找音效。

## 前置检查

**先定配乐从哪来**，从上往下取第一个成立的：

| 情况 | 做法 |
| --- | --- |
| 用户没要配乐，所在任务的计划也没要 | 不加；剪口播与旁白片交付时可以提一句能加 |
| 用户给了音乐（本机文件、Space 里的音频、视频里已有的素材） | 用用户的，不另生成；来源与授权写进报告 |
| 本机能生成（{{tool:models_capabilities}} 的 `generateMusic` 有可用模型） | 按下文生成纯音乐 |
| 还不能生成（本机服务报 `not-installed`：模型包没下载；或引擎不在这台机器上） | BaoCut 能在本机生成，只差下载：照 [models](models.md) 告诉用户要装什么、多大、什么许可，同意了才装，不说本机没有音乐模型；不装就问用户有没有音乐，或者不加配乐，交付时说明 |

- 用户要配乐又没给音乐，或计划里已经定了要单独配乐（如 {{skill:video-production}}），直接生成，不再另问；用户没要时只提议，不主动花十几分钟生成。
- 不到网上找音乐，不用来路不明、没有授权的音乐。
- 素材原声里有要保留的音乐、环境声或动作声：保留，配乐叠在另一条轨上；只在确实冲突的那一段压低原声，不删、不替换整条原声。

**能力与许可**：{{tool:models_capabilities}}（能力 `generateMusic`）看可用的模型、单段上限 `maxDurationSec`、默认时长 `defaultDurationSec`、编排选项 `local.planning.options`、风格与歌词的字数上限（`maxStyleChars`、`maxLyricsChars`）和许可。目前唯一的模型 YuE2 是 CC-BY-NC-4.0，只许非商业用途：用户说要商用（广告、带货、客户项目）时动手前先告诉用户，由用户决定。

**读视频**：{{tool:videos_inspect}} 看总时长、人声与旁白在哪几条轨、已有哪些音频轨，确定配整片还是一段。

**定全片一套属性**：曲风、速度、调性与明暗、核心乐器（两三样）、氛围与空间、音质，再加一句情绪怎么走（开头、中段、收尾各是什么感觉）。{{skill:video-production}} 在全局定义与配乐情绪弧表里定这些；别的任务按视频内容写一行就够。

## 命令与例子

### 生成

{{tool:music}}（本机服务，带 {{arg:provider}} `local` 与 {{arg:model}}）：

- {{arg:mode}}：配在人声或旁白下面的一律 `instrumental`，带人声的歌会和说话的人抢。用户明确要一首歌时才用 `song`，并且必须给 {{arg:lyrics}}；歌词支持哪些语言上游没有逐个核对过（`lyricLanguages` 为 `unverified`），先告诉用户。
- {{arg:targetDurationSec}}：要配的长度（配整片就是成片时长）向上取到 5 秒。它是创作意图，不保证精确。
- {{arg:maxDurationSec}}：生成预算，比目标多留约两成，不超过模型上限。音乐宁长勿短，多出来的在时间线上截掉、淡出。比上限长的见下文「铺满长视频」。
- {{arg:planning}}：不给时用模型的默认（YuE2 是 `melody`）；`full` 更慢，只在要清楚起承转合的长段落用。
- {{arg:seed}}：记下来。不满意时换 seed 或改风格重生成，一次只改一样，才知道是哪一处起的作用。
- {{arg:video}}：给。结果导入为那个视频的候选素材，不自动放上时间线。

**旁白量好就提交。** 配乐的长度取决于成片时长：旁白合成并量好、各镜时长定下来就提交，不等画面做完；一段要几分钟到十几分钟，提交一次，生成期间去做代码画面与图片，用 {{tool:jobs_wait}} 等，不重复提交。它占 GPU，不和转写、语音合成、导出成片同时跑（图片生成也占 GPU，两者排队，先提交配乐）。

### 怎么写风格描述

{{tool:music}} 的 {{arg:style}} 在 YuE2 上最稳的写法是一行英文短语、逗号隔开，和 BaoCut「生成音乐」工具页的预设一样（例如 `calm solo piano, slow tempo, soft, cinematic`）。一般 5–10 个短语；`maxStyleChars` 是上限，不是要写满的长度。按下面的顺序，每类挑一两个：

1. 曲风：`ambient`、`lo-fi hip hop`、`cinematic orchestral`、`acoustic folk`、`modern electronic`
2. 速度与律动：`slow tempo`、`around 90 BPM`、`gentle pulse`、`steady driving beat`
3. 调性与明暗：`minor key`、`major key`、`warm`、`bright`
4. 情绪：`calm`、`hopeful`、`reflective`、`playful`、`tense`
5. 核心乐器：`soft piano, warm pads, light percussion`
6. 密度：`sparse arrangement`、`minimal layers`、`full arrangement`
7. 空间与音质：`intimate`、`wide stereo`、`clean modern mix`、`vintage tape texture`
8. 走向（可选，一个短语）：`starts sparse and slowly builds, gentle resolution`

- 时长与有没有人声不写进风格：时长由参数给，纯音乐由 {{arg:mode}} 决定。
- 不写时间戳分段脚本（`[0:00-0:12] …`），不写强度打分：模型不按时间执行。情绪要按段落变时分段生成（见下文）。
- 不要的东西直接不写。`no drums` 这类否定在短语式描述里不可靠，可能反而带出鼓；要没有打击乐写 `drumless` 或 `ambient pads only`。
- 不拿真实的歌手、乐队、曲名或品牌当风格参照。
- 用户用别的语言描述风格时，你译成英文短语；用户给的英文原样保留。

按用途的起点，照视频再调：

| 用途 | 风格起点 |
| --- | --- |
| 旁白、讲解、口播的底 | `ambient, soft piano, warm pads, slow tempo, sparse arrangement, steady dynamics, understated` |
| 产品介绍与发布 | `modern electronic, light plucked synth, soft kick, uplifting, steady 110 BPM, clean mix` |
| 课程、知识分享 | `calm acoustic, soft guitar and piano, minimal, gentle, unobtrusive` |
| 故事与情绪短片 | `cinematic, piano and strings, starts intimate, builds to an emotional swell` |
| Vlog 与生活记录 | `lo-fi, warm, relaxed groove, mellow keys, vinyl texture` |

有人说话的片子要稀疏、动态平稳：不要突出的主旋律，少用和人声同一音区、抢耳朵的独奏乐器（萨克斯、失真吉他、人声采样），段落之间不要突然变响。

### 铺满长视频与分段

- **不超过上限**：生成一段，放上配乐轨，截在结尾，片尾淡出 2–3 秒。
- **比上限长**：默认循环铺满。生成上限长度的一段，从开头起首尾相接地重复放到结尾；相邻两段重叠 2 秒，前一段 fadeOut、后一段 fadeIn（同一条轨不能重叠，两段交替放在两条配乐轨上）；最后一段截在结尾、淡出 3 秒。不变速、不拉伸。这与编辑器「生成配乐」的铺法相同。
- **情绪明显分段时可以分段生成**（有配乐情绪弧表，或口播前后两段的情绪确实不同）：一段一次提交，接缝放在镜间切换或段落停顿处，同样重叠 2 秒交叉淡化。各段锁住曲风、速度与音质，调性与核心乐器默认也不变（只增减层数）；情绪、密度与明暗按段变。相邻两段在接缝处要接得上：前一段的走向写到什么状态收（`ends sparse, piano only`），后一段就从那个状态开始（`starts sparse with solo piano`）。段数越多等得越久，先告诉用户大概要多久。
- 接缝都在时间线上做，不用 ffmpeg 或脚本把文件拼成一个：留在时间线上用户还能改。

### 放上时间线与压低

一笔 {{tool:edits_apply}} 做完，每个操作的字段用 {{tool:edits_ops}} 查：

1. 生成时带了 video，结果里已有 `assetId`；没带时先 {{tool:assets_import}}，给 {{arg:artifactId}}。
2. `addTrack` 加一条单独的音频轨（如「配乐」），`addItem` 把配乐放上去，从需要的地方起（通常是片头），截在结尾。
3. `setAudioMix`：底音量先放低（`volume` 0.3 左右，约 −10 dB），片头 `fadeIn` 约 1 秒，片尾 `fadeOut` 2–3 秒。
4. `setDucking`：目标是配乐轨，`depth` 默认 10 dB。触发二选一：
   - 人声或旁白所在的轨道（`{"kind":"items","trackIds":[…]}`）：那条轨一发声就压低，有没有文稿都行，合成的旁白用它。
   - `{"kind":"speech"}`：按视频里转写文稿的词时间压低，只在说话时压、词间的呼吸与底噪不触发，剪掉的词不算；要先有转写（口播转写过的用它）。没有带时间的文稿时不压低，导出警告 `DUCK_NO_SPEECH`。
5. 原声、旁白、对白、配乐各在自己的轨上叠加，不删别的轨来腾位置。

### 音效

{{tool:assets_sfx}} 按配方在本机合成一段音效、导入视频（给 {{arg:place}} 时同时放上时间线），不联网、不用模型，没有版权问题。同样的参数与 {{arg:seed}} 出逐位相同的声音，换 seed 换一个变体。

| 画面上的事件 | 配方 |
| --- | --- |
| 屏幕录制里的鼠标点击、打字 | `click`、`keypress`（拟真） |
| 元素弹出、气泡、通知出现 | `pop`（拟真） |
| 重物落地、大标题砸下、揭晓的那一下 | `impact`（拟真） |
| 标题、数字、卡片落版 | `stamp`、`kick` |
| 转场、元素快速划过 | `whoosh`：最响处在正中，放在切点前它长度的一半处 |
| 切点前的蓄势 | `riser`：放在切点前它的长度处，末尾对准切点 |
| 数字跳动、计时 | `tick`、`blip` |
| 揭晓、完成、出现一个答案 | `ping` |
| 故障风、信号干扰 | `glitch`、`static` |
| 大场面、片头冲击 | `boom`、`crash` |

`click`、`keypress`、`pop`、`impact` 是物理建模的拟真配方：一次接触激励物体的振动，再过小房间与话筒，带一点底噪，听着像近距离录下来的。其余配方听得出是合成的，放在风格本来就电子、故障风或节奏型的片子里；产品演示与屏幕录制优先用拟真的。

- 少而准：一段视频里同一种事件用同一个配方，只配推动信息的那几下，不给每个动作都配。
- 发布片、产品演示与屏幕录制怎么配（UI 拟音、重音放哪、响度、配完怎么核对）见 {{skill:video-production}} 的声音设计参考。
- 时刻对到画面：代码画面的事件时刻读代码包自己的 `cues.json`（{{skill:video-production}} 的代码画面参考），或用 {{tool:assets_analyze}} 的 `onsets` 对到配乐的起音。
- 单独一条「音效」音频轨；音量比旁白低 6–12 dB（`setAudioMix`），旁白说话时不压音效，压的是配乐。
- {{arg:pitch}} 正的更亮更小，负的更沉更大；{{arg:space}} 的 `room` / `hall` 加空间，片子整体偏干时不加。

### 分析配乐的节拍与能量

{{tool:assets_analyze}} 把配乐（或任何一段音频）解码后算逐帧的响度、低中高三段频带与起音强度（每帧 0..1，帧率默认视频的），以及起音时刻、速度、拍、小节与段落，整份写成 JSON 文件，结果只回摘要。

- 配乐导入之后分析它（给 {{arg:asset}}）；还没导入的文件给 {{arg:path}}。超过 20 分钟分段给 {{arg:range}}。
- 剪辑点：镜头切换对到 `beats.times` 或 `bars` 的开始；段落（`sections`）的边界放章节或大的转场。
- 代码画面跟着声音动：把文件拷进代码包，先换成源文件时间 `s` = 时间线时间 − 片段在时间线上的开始 + 片段的源起点，帧号 = `floor((s − source.offset) × fps)`，读 `frames.bass` 做脉动、`frames.onset` 做闪动、`frames.level` 做整体亮度。
- 讲话与环境声通常没有稳定的拍（`beats` 为 null，`beatsError` 说原因），只用 `frames` 与 `onsets`。
- 重音（`accents`）是明显高出前面底子的起音：大的剪辑点、揭晓与 Logo 落在它们上，比落在随便一个起音上更有力。

### 核对时刻、画听音表

- {{arg:cues}}：要对上的时刻（源文件里的秒，与 {{arg:range}} 同一个时钟）。每个对到最近的起音，`sync` 回各自的状态（ok、near、none、outside）与 `delta`（起音减去时刻，正的是声音晚到），以及 `hitRate` 与 `chance`。起音很密时随便放一个时刻也容易落在起音旁边，`hitRate` 只比 `chance` 高一点就是没对上。
- {{arg:sheet}}：另画一张听音表 PNG（最长 120 秒，长片分段给 {{arg:range}}），用看图的工具看。时刻是贯穿全图的竖线：绿 ok、琥珀 near、红 none。
- 核对整条时间线的声画对位：先导出时间线的音频再分析它，步骤见 {{skill:video-production}} 的声音设计参考。

## 结果怎么读

- {{tool:music}}：`outputs` 里是一个 WAV 的 `artifactId`；带了 video 时还有 `assetId`。
- {{tool:assets_sfx}}：回执另有 `assetId`、`itemId`（没放上时间线为 null）与 `durationSeconds`。
- {{tool:assets_analyze}}：`file` 是整份结果的路径；结果里的 `onsets` 只列前 120 条，`onsetCount` 是总数；`accents` 只列前 60 条，`accentCount` 是总数；给了 {{arg:cues}} 时 `sync.misses` 只列前 60 个没对上的，全部在文件的 `sync.cues` 里；给了 {{arg:sheet}} 时 `sheet` 是 PNG 的路径。
- 实际时长看素材的媒体事实（{{tool:videos_inspect}} 的素材时长），不按 targetDurationSec 算；短于要配的长度时按上文循环或重生成，不变速拉长。
- `warnings` 里有 `output-truncated`：生成到了时长预算，结尾可能收得急。在时间线上截在前一个乐句并淡出，或加大 maxDurationSec 重生成（不超过上限）。

## 常见错误码

| 错误 | 下一步 |
| --- | --- |
| `CAPABILITY_NOT_CONFIGURED`，`remedy.action` 为 `install-model` | 音乐模型包没装：照 [models](models.md) 的「音乐生成」把大小告诉用户，同意后再装 |
| 能力报 `unsupported`，说找不到 audio.cpp 引擎 | 引擎不在这台机器上：照 [models](models.md) 的表处理 |
| 风格或歌词超长 | 缩到 `maxStyleChars`、`maxLyricsChars` 以内再交；风格本来就该是一行短语 |

其余照 [conventions](../conventions.md) 的「错误对象怎么用」。

## 下一步

- 配乐上了时间线：用 {{tool:export}} 导出两三处人声与配乐重叠的预览片段（purpose 为 preview）听平衡，再导出成片，见 [export](export.md)。
- 只要一个音乐文件：交 WAV 的路径，或按用户要的格式转码（[media](media.md)），不建视频。

## 验收

- 配乐来源写进报告：用户给的（附授权）、本机生成的（模型、风格、seed、实际时长、几段、怎么铺），或为什么没加。
- 本机生成的配乐写明非商业许可（YuE2 是 CC-BY-NC-4.0）；音效是程序合成的，没有许可限制。
- 读回 {{tool:videos_inspect}}：配乐在单独的轨上，铺到成片结尾，有淡入淡出，闪避规则的触发与目标对。
- 配乐音量与人声的平衡、接缝顺不顺、情绪对不对，属于**要人听的**；你自己听不了时如实写没听过，不把「量过」写成「听过」。
