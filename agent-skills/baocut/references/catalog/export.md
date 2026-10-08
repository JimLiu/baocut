---
description: 导出的机制：字幕、文稿、音频、成片、便携包与工程文件的种类与参数，范围与输出位置，交付前检查。导出文件之前读。
---

# 导出：字幕、文稿、音频、成片与便携包

## 何时用

- 用户要文件：字幕文件、文稿、音频、成片（mp4、webm）。
- 切好的几段短视频各出一个文件。
- 把整个视频打成便携包交给别人，或导出给 Premiere / Resolve 的工程文件。

## 前置检查

- {{tool:videos_inspect}}：要导出的文档（转写、译文、字幕层）在不在；只要译文的字幕文件时，画面上要已有这种语言的字幕层（先 {{tool:captions_create}}）。
- 成片要 ffmpeg 与编码器；缺了会在提交前就被拒（`EXPORT_TOOL_MISSING`）。
- 素材都在：链接的原文件被移动、删除或改过时提交前就被拒（`ASSET_MISSING` / `ASSET_CHANGED`）。
- 画幅、时长、语言按用户确认的来；横屏视频要出竖屏时先问清是加黑边还是重新取景（重新取景是剪辑，见 [editing](editing.md)）。

## 命令与例子

{{tool:export}}：{{arg:video}} + {{arg:kind}} + {{arg:format}}。

| 要的文件 | 关键参数 |
| --- | --- |
| 原文字幕 | {{arg:kind}} `subtitles`，{{arg:format}} `srt` / `vtt` / `ass` / `json`（带词时间） |
| 双语字幕 | 同上加 {{arg:bilingual}}（主文档是转写、副文档是译文，每句一条） |
| 只要译文的字幕 | {{arg:kind}} `subtitles`，{{arg:language}} 给译文语言 |
| 文稿 | {{arg:kind}} `transcript`，{{arg:format}} `md` / `txt` / `json`；段末时间码 {{arg:timestamps}}，章节小标题 {{arg:chapters}}，Markdown 文首元信息 {{arg:frontmatter}}；说话人默认写（{{arg:speakers}} `false` 不写）；默认跳过剪掉的部分，要整份原文给 {{arg:skipCut}} `false` |
| 音频 | {{arg:kind}} `audio`，{{arg:format}} `wav` / `mp3` / `m4a`；按时间线混音 |
| 成片 | {{arg:kind}} `video`，{{arg:format}} `mp4` / `webm` |
| 便携包 | {{arg:kind}} `portable`，{{arg:format}} `baocut`：整个视频连同素材一个文件，别处的 BaoCut 能打开 |
| 工程文件 | {{arg:kind}} `project`，{{arg:format}} `xmeml`：素材按本机路径引用，表达不了的逐项记成警告 |

通用选项：

- 用途：只为内部取帧、检查字幕排版或试听而导出时，必须给 {{arg:purpose}} `preview`；这类文件保留在后台任务里，不进入会话视频卡与「产物」。交给用户的文件（包括用户要求的预览、短片与分段）用 `deliverable`，也是省略时的默认值。不要按时长或文件名猜用途。
- 范围：{{arg:range}} 只导出时间线上的一段；{{arg:ranges}} 给几段、每段一个文件（切短视频用它）。时间是剪辑后时间线上的秒。
- 文档：有几份可选时 {{arg:documentId}} 指定主文档，或 {{arg:language}} 按语言挑。
- 位置：{{arg:dir}} 输出目录（要已存在），{{arg:fileName}} 文件名（只出一个文件时）；同名已存在时默认拒绝，用户同意替换才给 {{arg:overwrite}}。不给时写到工作目录下的 `exports/`，名字是「视频名.种类.扩展名」，重名加序号。
- 字幕的行宽：{{arg:maxCharsPerLine}}（全角字算 2，默认 42）。

成片的画面与声音：

- 尺寸：{{arg:width}} / {{arg:height}}；只给一边时另一边按画布比例。两边都给且比例与画布不同时是**加黑边**放进去，不裁切、不重排。
- 编码与质量：{{arg:codec}}（mp4 默认 h264，可选 hevc；webm 是 vp9），{{arg:crf}} 或 {{arg:videoBitrateKbps}} 二选一，{{arg:fps}} 改帧率。
- 字幕：{{arg:burnCaptions}} 默认把时间线上的字幕画进成片；用户要「干净画面 + 外挂字幕」时关掉，再单独导出字幕文件。
- 声音：{{arg:loudness}} 做响度标准化（发布到平台前建议开）；{{arg:source}} 只要原声或只要某一组配音（只影响这次导出，不改视频）。
- 画不出来的内容：{{arg:onUnsupported}} 默认 `fail`（拒绝并逐项列出）；`skip` 会整层不画、效果不施加、转场按硬切，**只在用户同意后用**。便携包缺素材的 {{arg:missingAssets}} 同理。

## 结果怎么读

- 提交时冻结视频的当前版本：之后的修改不影响这次导出；改完要重新导出。
- 完成时 `outputs` 里每个文件有 `path` 与校验结果。把 `path` 原样告诉用户，不自己拼路径。
- 内部检查文件不当成交付，也不把它们列在完成回复里；检查发现的问题按实际结果报告。
- 成片的进度按帧（`progress.unit` 为 `frames`）。
- 任务警告（跳过的内容、工程文件里表达不了的元素）要转告用户。

## 常见错误码

导出在提交前做预检，以下错误不建任务：

| 错误码 | 下一步 |
| --- | --- |
| `EXPORT_SOURCE_AMBIGUOUS` | 文档不止一份：用 `candidates` 里的 documentId 指定 |
| `EXPORT_NOTHING_TO_EXPORT`、`EXPORT_SOURCE_NOT_FOUND` | 没有可导出的文档：先转写或建字幕层 |
| `EXPORT_RANGE_EMPTY` | 范围里没有内容：核对时间线上的秒 |
| `EXPORT_DESTINATION_EXISTS` | 目标文件已存在：换名字，或问用户后给 {{tool:export}} 加 {{arg:overwrite}} |
| `EXPORT_DESTINATION_UNWRITABLE`、`EXPORT_INSUFFICIENT_SPACE` | 目录写不了或空间不够：告诉用户 |
| `ASSET_MISSING`、`ASSET_CHANGED` | 素材缺失或改过：请用户放回原文件；不要擅自换素材 |
| `EXPORT_TOOL_MISSING` | 缺 ffmpeg 或编码器：照 `remedy` 转告用户 |
| `EXPORT_UNSUPPORTED_CONTENT` | 成片里有画不出来的内容：把 `items` 告诉用户，问是否用 `skip` |

## 下一步

- 成片导出完：按下面的验收核对，再交付。
- 要给别人接着编辑：导出便携包；对方用打开便携包的方式建成新视频（见 [media](media.md)）。

## 验收（交付前检查）

- 文件真实存在，路径取自 `outputs`。
- 量出来的：时长、分辨率、帧率、文件大小、字幕条数与用户的要求对得上（读任务结果与文件的媒体事实）。
- 看过的：取帧（{{tool:videos_frames}}）只能核对时间线上的素材画面，不含字幕、文字与叠加的元素；字幕位置、挡没挡人脸要在成片里看，自己看不了就请用户看，报告里写明没看。
- 要人听的：配音、配乐与人声的平衡，剪点顺不顺。
- 画幅、时长、语言、交付物与用户确认的一致；没有为凑时长重复画面或变速。
