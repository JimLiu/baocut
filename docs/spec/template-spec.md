# BaoCut 模板包规范

> 创作模板是 Home 起始页「模板」入口里的视频制作模板。它的形态接近 skill：以一段提示词为主，可以配封面、预览视频和图片、SVG、音频等素材，由 Runtime 提供目录。本规范定义模板包的目录布局、清单字段、取值与约束，以及 Runtime 使用模板时的语义。

格式标识：模板目录里的 `template.json`，`schema: 1`。

本规范只定义**包的格式与使用语义**。Home 的交互见[产品设计](../product/product-design.md) §3.2.1；清单的类型与校验在 `@baocut/protocol`（`template.ts`、`template-schemas.ts`）。用语见[文档约定](../README.md#文档约定)，术语见[术语表](../glossary.md)。

## 目录

- [1. 范围与约定](#1-范围与约定)
- [2. 目录与文件](#2-目录与文件)
- [3. 清单](#3-清单)
- [4. 约束](#4-约束)
- [5. 使用语义](#5-使用语义)
- [6. 目录来源与加载](#6-目录来源与加载)
- [7. 新增与校验](#7-新增与校验)
- [8. 待评审事项](#8-待评审事项)

---

## 1. 范围与约定

### 1.1 创作模板是什么

创作模板帮用户从一个创作方向起步：选一个模板，补上自己的内容，交给智能体去做。模板只提供提示词与展示用的元数据，不是视频的一部分，选用后不在视频里留下引用。

它与下面两样东西不同，不共用格式：

- 产品设计 §5.9 的「模板」〔AST-04〕：把视频里的原生结构或代码包保存成带参数的可复用对象；
- 架构设计 §8.7 的 `CreativeCatalogue`：经过验证的原生模板与代码配方目录。

### 1.2 两类模板

| `kind` | 名称 | 用法 |
| --- | --- | --- |
| `scene` | 场景模板 | 给一个创作方向和默认的画幅、时长。选用后智能体**先引导用户过一遍简报**，与用户确认后再开始制作（§5.2） |
| `example` | 作品示例 | 一条可以直接拿来用的完整提示词。选用即把提示词放进输入框，不走简报；画幅、时长可以不指定，交给智能体（§5.1） |

两类模板用同一份清单格式与同一张分类表（§3.2），差别只在 §3.1 标注的必填项与 §5 的使用语义。

### 1.3 类型的地位

类型用 TypeScript 写法表达，是 DTO 概要；权威定义是 `@baocut/protocol` 的 `TemplateManifest` 与 `templateManifestSchema`，两者由编译期检查保持一致。本规范与代码不一致时按缺陷处理，在同一任务里改齐。

---

## 2. 目录与文件

### 2.1 布局

一个模板是一个目录，目录名就是模板 `id`：

```text
templates/<id>/
  template.json      清单（必须）
  prompt.md          提示词正文（必须）
  cover.<ext>        封面图（可选）：png、jpg、jpeg、webp、svg
  preview.<ext>      预览视频（可选）：mp4、webm
  assets/            随模板分发的素材（可选），每个文件都在清单 assets 里登记
  locales/           别的语言的文案（可选）：每种语言一对 <语言>.json 与 <语言>.md，§3.6
```

- 目录里不得有清单没有登记的文件（`locales/` 下按 §3.6 命名的译文算登记过）；以 `.` 开头的隐藏文件（例如系统生成的 `.DS_Store`）加载时忽略，不得入库。
- 封面与预览只能放在目录根，文件名固定为 `cover` 与 `preview`；素材只能放在 `assets/` 下，可以再分子目录。
- 文件名与目录名遵守[仓库约定 §3](../repo-conventions.md#3-命名)：全小写，单词之间用 `-`。

### 2.2 `prompt.md`

提示词正文是模板的主体，UTF-8 编码的 Markdown，不带 front matter（元数据都在清单里），不得为空，不超过 16 KiB。

- `scene`：写给智能体的制作要求，第二人称（「你要做一条……」）。建议分「结构」「画面与声音」「注意」几小段：结构写几幕各讲什么，画面与声音写视觉、字幕、旁白、音乐的要求，注意写事实、授权与语言等约束。不写简报引导，那一段由 Runtime 统一拼接（§5.2）。正文里不得出现占位符 `{{`：留给用户填的项写在清单的 `brief` 里（§3.1）。
- `example`：用户口吻的一段完整请求（「做一条……，你可以……」），会原样放进输入框，用户可以在发送前修改。写成一到三段连续文字，不用标题与列表。该由用户决定的内容（主题或话题、素材、产品名、时长、成片语言等）写成占位符 `{{label}}`，例如「旁白与字幕用{{成片语言}}」，每个占位符都在清单 `fields` 里声明（§3.1、§5.5）。
- 两类都不写画幅与时长以外的界面参数；画幅与时长写在清单里（§5.3）。`example` 的清单值只用于卡片与详情的显示，不随消息发出：要智能体按某个画幅或时长做，就写进正文，并与清单一致。

### 2.3 `schema` 与未知字段

- `schema` 是清单格式的版本，整数。这一版只认识 `1`。`schema` 缺失或不认识时，Runtime 跳过这个模板并记一条诊断（`unsupported-schema`），不让整个目录加载失败。
- 清单的顶层与各个子对象都不接受未知字段：拼错的字段、别家格式带来的字段（质量档位、外链地址之类）一律判为不合规，模板跳过并记诊断（`invalid`）。
- 新增字段即升 `schema`。Runtime 可以同时认识多个版本；不认识的版本照上一条跳过。格式发布之前的增补（例如 §3.5 的验证记录、§3.1 的 `brief`、`fields` 与 `skills`、§3.6 的语言版本）仍记为 `1`。

---

## 3. 清单

### 3.1 字段

```ts
interface TemplateManifest {
  schema: 1;
  id: string;                 // kebab-case，≤ 64，等于目录名
  version: string;            // 模板自身的版本，semver（1.0.0）
  kind: 'scene' | 'example';
  title: string;              // ≤ 40
  summary: string;            // 卡片上的一句话，≤ 80
  description: string;        // 详情里的一小段，≤ 400
  language: string;           // 文案的语言标签，BCP 47（zh-CN）
  category: TemplateCategory; // §3.2
  ratio?: '16:9' | '9:16' | '1:1';
  durationSeconds?: number;   // 整数，5–600，5 的倍数
  brief?: string;             // 选用时填进输入框的那段话，用 {{label}} 留出待填项，≤ 400
  fields?: TemplateField[];   // 待填项，≤ 8 项
  skills?: string[];          // 建议先读的 craft（skills/<id>），≤ 4 项
  author: string;             // ≤ 80
  source: 'official' | 'community';
  license: string;            // SPDX 标识，可用 AND / OR / WITH 组合
  tags: string[];             // ≤ 8 个，每个 ≤ 24，不重复
  cover: TemplateCover;       // §3.3
  preview: TemplatePreview;   // §3.3
  assets?: TemplateAsset[];   // §3.4，≤ 64 项
  verification?: TemplateVerification; // §3.5
}

interface TemplateField {
  label: string;              // 占位符里的名字，≤ 24，模板内唯一，不含 `{`、`}` 与换行
  hint?: string;              // 给用户看的「填什么」，≤ 80
  example?: string;           // 示例值，≤ 80
}
```

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| `schema` | 是 | 固定为 `1`（§2.3） |
| `id` | 是 | 小写字母开头，小写字母、数字与单个 `-`；等于目录名；在同一目录来源里唯一。发布后不改名 |
| `version` | 是 | `主.次.修订`。改提示词或清单内容时递增；只改错别字可以只加修订号 |
| `kind` | 是 | §1.2 |
| `title`、`summary`、`description` | 是 | 非空，首尾无空白，不超过上表长度。产品口吻、第二人称，不用感叹号与 emoji |
| `language` | 是 | 只标注清单文案与 `prompt.md` 的语言（别的语言版本见 §3.6），**不是成片的语言**（§4.3） |
| `category` | 是 | 取自 §3.2 |
| `ratio` | `scene` 必填 | 默认画幅。缺省表示自动，交给智能体 |
| `durationSeconds` | `scene` 必填 | 默认时长（秒）：5–600 秒，步长 5。缺省表示自动 |
| `brief` | `scene` 必填；`example` 不得有 | 选用模板时填进输入框的那段话：用户口吻，一到三句，用 `{{label}}` 留出待填项（§5.5），例如「给{{产品或服务}}做一条推广短片，目标是{{希望观众做什么}}，受众是{{受众}}。」。待填项按题材定，通常两到五项 |
| `fields` | 否 | 待填项的声明，见下文。`scene` 对应 `brief` 里的占位符，`example` 对应 `prompt.md` 里的占位符 |
| `skills` | 否 | 做这类成片建议先读的 craft，取仓库根 `skills/` 下的 `id`（kebab-case，≤ 64，不重复）。智能体用 `skills_read` 读（§5.2）。协议只校验形状；内置模板写的每一项都要在 `skills/` 里，由 §7 的测试检查 |
| `author` | 是 | 官方模板写 `BaoCut`；社区模板写作者的公开署名，不写邮箱或联系方式 |
| `source` | 是 | `official`：随应用分发、由仓库维护；`community`：来自社区（§6） |
| `license` | 是 | 模板文案与随附素材的许可。内置原创模板用 `LicenseRef-BaoCut-Community-1.0`，对应仓库 [LICENSE](../../LICENSE)，允许将模板元素用于商业作品；第三方素材保留自己的许可 |
| `tags` | 是 | 搜索用的关键词，可以为空数组 |
| `cover` | 是 | §3.3 |
| `preview` | 是 | §3.3 |
| `assets` | 否 | §3.4 |
| `verification` | 否 | 最近一次用真实智能体验证的记录，§3.5 |

字符长度按 UTF-16 码元计。

**待填项**。`fields` 的每项是一个 `TemplateField`：`label` 是占位符里的名字，`hint` 告诉用户填什么，`example` 是示例值。占位符写成 `{{label}}`（双花括号包住 label，不留空格），规则如下：

- 文本里的每个 `{{…}}` 都必须对应一个声明的 `label`；声明的每项至少被引用一次（`scene` 看 `brief`，`example` 看 `prompt.md`）；拆不成占位符的 `{{` 也不合规。
- `label` 在模板内不重复；同一个 `label` 可以在文本里出现多次，指同一项。
- 把 `brief`（`example` 是 `prompt.md`）里的每个占位符换成该项的 `example`、没有 `example` 的换成 `label`，就是「可以这样说」的示例句，界面在详情里显示它；所以 `example` 要能直接代进句子读通。
- `label`、`hint` 与 `example` 和其余文案同一种语言（`language`）；别的语言的待填项写在那种语言的译文里（§3.6），界面不另行翻译。

### 3.2 分类

两类模板共用一张分类表，按题材分。键是协议的一部分，发布后不改名、不复用；显示名由界面层按界面语言给出，下表的中文名是示意。

| 键 | 显示名（示意） | 放什么 |
| --- | --- | --- |
| `marketing` | 营销推广 | 广告、产品展示、活动回顾等促成行动或传播品牌的视频 |
| `product-launch` | 产品发布 | 新品发布、软件演示、功能更新 |
| `explainer` | 知识讲解 | 知识科普、分步教程、技术讲解 |
| `news-data` | 资讯与数据 | 新闻快评、热点讲解、数据故事 |
| `editing` | 剪辑整理 | 以用户已有素材为主的剪辑：口播精华、Vlog、混剪 |
| `creative-short` | 创意短片 | 故事短片、电影感场景、预告片 |
| `motion-design` | 动效设计 | 动态图形、代码动画、排版动效 |

一个模板只属于一个分类。新增分类要同时改本表、`TEMPLATE_CATEGORIES` 与界面的显示名。

### 3.3 封面与预览

```ts
interface TemplateCover {
  file?: string;    // 'cover.<ext>'
  tone?: 'blue' | 'orange' | 'green' | 'purple' | 'cyan' | 'indigo' | 'magenta' | 'seafoam' | 'brown';
  figure?: 'bars' | 'ring' | 'cards' | 'steps';
  kicker?: string;  // 封面左上角的小字，≤ 24
}

interface TemplatePreview {
  file?: string;    // 'preview.<ext>'
  beats?: string[]; // 3–5 句分镜要点，每句 ≤ 60
}
```

- 有 `cover.file` 时界面显示封面图；没有时用 `tone`（底色）、`figure`（图形画法）与 `kicker` 画一张占位封面，所以没有封面图的模板必须给出 `tone` 与 `figure`。有封面图时也应给出 `tone`，供图片加载前与加载失败时使用。
- 有 `preview.file` 时界面播放预览视频；没有时按 `beats` 轮播占位预览，所以没有预览视频的模板必须给出 `beats`。有预览视频时也应给出 `beats`，供详情里列出分镜要点。`beats` 只用于展示，**不拼进提示词**：模板的制作要求以 `prompt.md` 为准。
- `tone` 与 `figure` 的取值集合与界面的占位封面实现一致；新增取值要同时改协议常量与界面。
- 体积上限：封面图不超过 150 KiB，预览视频不超过 2 MiB（`TEMPLATE_FILE_MAX_BYTES`）。预览是一段压缩过的示意，不是成片本身；内置模板由 §7 的测试检查，Runtime 加载时也检查（§6），超过的模板判为不合规。
- 内置模板的预览与封面通常取自验证（§3.5）时做出的成片，按下面的做法压缩，保证同一份成片得到确定的结果：

  ```sh
  # 预览：取成片最有代表性的一段，不超过 15 秒（-ss 起点，-t 长度）；最长边 640，偶数像素；H.264 + yuv420p + faststart。
  # 超过 2 MiB 时把 crf 每次加 2 再压（28 → 30 → 32 …），仍超过时把最长边降到 540。
  # 成片有声音时用低码率 AAC：把 -an 换成 -c:a aac -b:a 64k -ac 2。
  ffmpeg -y -ss 0 -t 15 -i film.mp4 \
    -vf "scale='if(gte(iw,ih),640,-2)':'if(gte(iw,ih),-2,640)':flags=lanczos,fps=30" \
    -c:v libx264 -preset slow -crf 28 -profile:v high -pix_fmt yuv420p -movflags +faststart -an preview.mp4

  # 封面：取一帧有代表性的画面（-ss 是它在成片里的时刻），最长边 640 的 JPEG；超过 150 KiB 时把 -q:v 加大（4 → 6 → 8）。
  ffmpeg -y -ss 7 -i film.mp4 -frames:v 1 \
    -vf "scale='if(gte(iw,ih),640,-2)':'if(gte(iw,ih),-2,640)':flags=lanczos" -q:v 4 cover.jpg
  ```

- 有封面图与预览视频时照样保留 `tone`、`figure`、`kicker` 与 `beats`（上两条），清单允许它们并存。

### 3.4 素材

```ts
interface TemplateAsset {
  path: string;                                   // 'assets/...'
  type: 'image' | 'svg' | 'audio' | 'video';
  note: string;                                   // 用途说明，≤ 200
}
```

| `type` | 扩展名 |
| --- | --- |
| `image` | png、jpg、jpeg、webp、gif |
| `svg` | svg |
| `audio` | mp3、m4a、aac、wav、ogg、flac |
| `video` | mp4、webm、mov |

- `assets/` 下的每个文件都必须登记，登记的每个文件都必须存在；路径不重复。
- `note` 写这个素材做什么用（「片尾标志」「背景音乐，约 30 秒」），给用户看，也随提示词交给智能体（§5.4）。
- 素材必须是模板作者有权按 `license` 分发的内容。

### 3.5 验证记录

内置模板发布前用真实的智能体按模板做一条视频，记下这次的输入、条件与结果，作为模板的一部分维护：

```ts
interface TemplateVerification {
  date: string;              // 验证日期，YYYY-MM-DD
  version: string;           // 跑的是哪个模板版本（semver）；之后按发现改了模板时，清单的 version 会比它新
  engine: string;            // 智能体引擎的小写 id，例如 'codex'，≤ 32；不写引擎版本
  input: string;             // 发给智能体的话，≤ 4000
  materials: TemplateVerificationMaterial[]; // 用到的公开素材，≤ 16 项，可以为空
  capabilities: TemplateVerificationCapability[]; // 缺失、因而降级或跳过的能力，不重复，可以为空
  outcome: 'pass' | 'partial' | 'fail';
  output?: { ratio: string; durationSeconds: number }; // 成片实测：宽高约分后的 W:H 与时长（秒）
  notes: string;             // 发现的问题与对模板做的修改，≤ 1000
}

interface TemplateVerificationMaterial {
  title: string;             // ≤ 120
  url: string;               // 素材页的 https 地址，≤ 500
  license: string;           // 例如 CC0-1.0、Public-Domain，或素材站自己的许可名，≤ 60
  note?: string;             // 用在哪里，≤ 200
}

type TemplateVerificationCapability =
  'transcribe' | 'synthesizeSpeech' | 'generateImage' | 'generateText' | 'generateVideo' | 'generateMusic' | 'generateSoundEffect';
```

- `input`：`scene` 写用户消息的原话（发送时挂上这个模板）；`example` 写「按提示词原样」，有改动或附加的说明（例如指定成片语言、测试环境缺哪些能力）时写明改了什么。
- `outcome`：`pass` 是成片符合模板的画幅、时长与必需的制作要求；模板写成可选的部分（例如「可以生成配乐」）因为缺能力跳过、并且告诉了用户，仍算 `pass`。`partial` 是做出了成片，但有必需的要求没做到（例如必须有旁白却没有语音合成、画幅或时长不符、要人工另补一步才有成片）。`fail` 是没有做出能用的成片。`fail` 时可以没有 `output`，其余两种必须给出。
- 只补验证记录、预览与封面时，清单的 `version` 不变；按验证的发现改了 `prompt.md` 或其他清单内容时照 §3.1 递增，`verification.version` 仍写跑的那个版本。
- `output` 用 ffprobe 量出的值，不抄清单。
- `materials` 只记来源与许可，素材本身不随模板分发；只用许可明确允许再分发的素材（CC0 或公有领域），因为预览里会出现它们。
- 前四种能力与模型服务的能力同名；视频、音乐与音效生成还没有对应的服务，先占名字。
- 验证记录只供维护与展示，不拼进提示词，也不影响 §5 的使用语义；再验证一次就整份替换。

---

## 4. 约束

### 4.1 路径

清单里的所有路径（`cover.file`、`preview.file`、`assets[].path`）都必须是模板目录内的相对路径：

- 用 `/` 分隔，不得以 `/`、`~` 或盘符（`C:`）开头；
- 不得含 `..`、`.`、空段、反斜杠或控制字符；
- 不得是符号链接；加载时解析后仍须落在模板目录内。

### 4.2 不带密钥与机器路径

清单、`prompt.md` 与素材都不得含 API 密钥、令牌、密码、个人联系方式或某台机器上的绝对路径。提示词需要外部能力时写能力描述（「用视频生成能力做一个跳舞的动画角色」），不写具体的模型、服务或产品名；也不写真实品牌与他人作品名，开源技术名（例如 JavaScript、p5.js）可以保留。

### 3.6 语言版本

一个模板可以带多种界面语言的文案：`template.json` 与 `prompt.md` 是原文（语言见 `language`），别的语言的译文放在 `locales/` 下，每种语言一对文件：

```text
templates/<id>/locales/
  en.json            清单文案的译文
  en.md              prompt.md 的译文
  zh-hant.json
  zh-hant.md
  ...
```

- 语言取应用的出货语言（`zh-Hans`、`zh-Hant`、`en`、`ja`、`ko`、`es`、`fr`、`de`、`nl`、`pt-BR`、`it`、`ru`、`pl`、`tr`、`vi`），文件名用小写（`pt-br.json`）。别的文件名不认，按未登记的文件处理（§2.1）。
- 两个文件成对出现；不放与 `language` 同一种语言的译文（`zh-CN` 的模板不放 `zh-hans.*`）。
- 译文 JSON 只收文案，未知字段一律拒绝；没列的字段（`id`、`version`、`kind`、`category`、画幅、时长、`skills`、封面与预览文件、`verification` 等）只写在清单里，各语言共用：

```ts
interface TemplateTranslation {
  title: string;
  summary: string;
  description: string;
  brief?: string;                    // scene 必填，example 不得有
  fields?: TemplateField[];          // 与清单的 fields 项数、顺序一一对应
  tags: string[];
  cover?: { kicker?: string };       // 不给时沿用清单的角标
  preview?: { beats?: string[] };    // 与清单的 beats 条数相同
  assets?: { path: string; note: string }[];  // 只能是清单登记过的素材；没给的沿用清单的 note
}
```

- 长度上限同清单（§3.1、§4.4）；占位符对照译文自己的 `fields`（`scene` 看译文的 `brief`，`example` 看译文的 `.md`）；译文 `.md` 的写法与限制同 `prompt.md`（§2.2、§4.4）。
- 任何一份译文不合规时整个模板不合规（§6 的 `invalid`），诊断里每条问题前面带上文件名。改了原文要同步改各个译文，并递增 `version`。

**挑语言**。`templates.list`、`templates.get` 与 `conversations.send` 的 `template` 可以带 `language`（BCP 47），没带时用 Runtime 的界面语言。Runtime 依次找：同一种出货语言的译文；同一主语言的另一种写法（例如繁体缺译文时用简体）；英文；都没有时用原文。找的过程中碰到原文的语言就用原文。挑中译文时，清单的文案换成译文、`language` 改成那种语言，其余字段不变，正文换成译文的 `.md`。列表的每项另带 `languages`：这个模板有哪些语言，原文的 `language` 在前。

界面按界面语言要目录，取提示词与发送时带上目录里这个模板的 `language`，三处用同一个语言版本；换了界面语言后重新取目录。

### 4.3 语言中立

模板的文案有一种语言（`language`），成片的语言与它无关，遵守[开发流程 §4](../development-workflow.md#4-语言与平台)：

- 清单与 `prompt.md` 不得把某种语言设为成片的默认语言，也不得写死面向某个语言市场的平台；发布去向写「社交平台」「视频平台」。
- 需要提到语言时留出槽位：`scene` 的正文写「使用简报里确认的语言」，`example` 的正文写成待填项 `{{成片语言}}`。成片语言可以留成待填项，不写死；这一项不给 `example`，免得示例句把某种语言写成默认。
- 译文（§3.6）同样遵守：照译这些槽位，不因译文的语言把成片写成那种语言。
- 用户没有指定语言时，智能体按开发流程 §4 的顺序决定：用户的明确要求，其次已记录的偏好，再从任务上下文推断；简报引导里可以把语言作为一项确认（§5.2）。

### 4.4 上限

| 项 | 上限 |
| --- | --- |
| `prompt.md` | 16 KiB（UTF-8） |
| `brief` | 400 |
| `fields` | 8 项；`label` 24，`hint` 80，`example` 80 |
| `skills` | 4 项，每个 64 |
| `beats` | 3–5 句，每句 60 |
| `tags` | 8 个，每个 24 |
| `assets` | 64 项 |
| 封面图 | 150 KiB |
| 预览视频 | 2 MiB |
| `verification.materials` | 16 项 |

其余文案长度见 §3.1。

---

## 5. 使用语义

### 5.1 作品示例

选用 `example` 模板时，客户端把 `prompt.md`（或所选语言的译文，§3.6）的全文连同其中的占位符放进输入框，占位符显示成待填项（§5.5）。之后就是一条普通的用户消息：用户可以替换待填项、修改别的文字，发送时不附加简报引导。

### 5.2 场景模板与简报引导

选用 `scene` 模板时，客户端把模板挂在输入框上（显示标题），把 `brief` 填进输入框（占位符显示成待填项，§5.5）；用户替换待填项、补充或改写别的文字、附上文件（可以不附）。发送时客户端只传模板 `id`（与 `version`、`language`）和用户输入，由 Runtime 读取那个语言版本的正文（§3.6），在前面拼上统一的**简报引导前言**，再交给智能体。前言不写进每个 `prompt.md`，也不在界面里复制。

发送走 `conversations.send` 的可选参数 `template: { id, version?, assets?, language? }`（[命令与协议规范 §4.1](command-protocol-spec.md#41-方法)）：

- `text` 仍是输入框里用户的话（填进去的 `brief` 连同用户的替换与改写，没填的待填项按 §5.5 写成「[label]」），照常必填（用户把文字删光、只附了材料时由客户端补一句，与不挂模板时相同）。会话里的用户消息就是 `text`，另带一个模板标记 `template: { id, version, title, kind, origin }`（`title` 是所用语言版本的标题），界面据此显示「模板：标题」；前言、正文与素材清单只交给智能体，不进 `text`。
- Runtime 在 `text` 后面附上一段 `<baocut-template id="…" version="…">`：模板标题、前言、模板的默认画幅与时长、建议先读的做法（`skills`，有才列）、`prompt.md` 正文，以及素材清单（§5.4）。编辑器上下文与 Space 引用照旧附在它之后。
- `version` 只是参考：Runtime 总用目录里当前的模板，实际用的版本记在模板标记上；版本不同不报错。
- 没有这个模板（或它没能加载）时 `not-found`（`TEMPLATE_NOT_FOUND`）。`example` 模板的正文本来就是用户输入（§5.1），挂上它发送是 `invalid-request`（`TEMPLATE_NOT_SCENE`），客户端应当把正文放进输入框直接发送。
- 前言的文案是 Runtime 里的一个常量（`SCENE_BRIEF_PREAMBLE`），以中文写成；它要求智能体跟随用户的语言提问与回复，不因前言或正文的语言改用别的语言。

前言的语义（Runtime 按此实现，措辞可以调整）：

1. 这是一个场景模板任务。先和用户确认简报，确认之前不开始制作，不调用会产生费用或修改视频的工具。
2. 简报包含四项：**主题**（做什么）、**目标**（希望观众看完做什么或记住什么）、**受众**、**手头的材料**（文件、链接或文字；没有也可以）。另外确认画幅与时长：以清单的默认值为准，用户可以改；必要时确认成片的语言（§4.3）。
3. 用户消息与附件里已经给出的信息不再重复询问；能从材料里读出的先读。
4. 缺的项合并成一轮提问，问题简短，给出可选的默认值；不逐项来回追问。
5. 用用户的语言提问。
6. 把整理好的简报复述给用户，等用户确认或修改；用户明确说「直接做」时，按已知信息与默认值继续，并在复述里写明哪些是默认的。
7. 确认后按模板正文制作；简报与正文冲突时以用户确认的简报为准。
8. 模板正文要求的某项能力没有配置时不中断：没有语音合成就用字幕承担旁白与对白；没有配乐或音效生成就先考虑用代码合成，做不到再跳过；没有转写、图片或视频生成时改用用户给的材料或代码画面。在复述简报与交付时写明哪些要求因此降级，以及配置哪项能力后可以补上。
9. 动手制作前先用 baocut 工具 `skills_read` 读 `video-production`（从简报到成片的做法）；模板段里列出了建议先读的做法（`skills`）时也一并读。
10. 用户消息里形如「[受众]」的方括号项，是模板留给用户填、用户没有填的待填项（§5.5）：归入简报缺项一起问，不当作已有信息，也不原样抄进成片。

### 5.3 画幅与时长

Home 没有画幅与时长的设置：智能体从用户的话里看出画幅与时长，用户没说的按内容决定。场景模板清单的 `ratio` 与 `durationSeconds` 是默认值，由 Runtime 写进 `<baocut-template>` 段（§5.2），用户在消息里另说了的以用户为准；缺省表示自动，由智能体按内容决定。作品示例的清单值不随消息发出（§2.2）。

### 5.4 素材

模板带 `assets` 时，Runtime 把素材作为这次任务可读的输入交给智能体，并附上每项的 `path`、`type` 与 `note`；用户可以在发送前去掉不想用的素材。素材不自动写进视频，由智能体按提示词决定怎么用。

这一版的做法：模板段里列出每项素材在本机的绝对路径（模板目录里的文件，只读）、`type` 与 `note`，不复制进项目。`template.assets` 给出时只列这些（必须是清单登记的路径，否则 `invalid-request`，`TEMPLATE_FILE_NOT_FOUND`），给空数组时一项也不列，不给时全部列出。

### 5.5 待填项

模板文字里的 `{{label}}`（§3.1）是留给用户填的待填项：`scene` 的在 `brief` 里，`example` 的在 `prompt.md` 里。

- **在输入框里**：客户端把文字放进输入框时，每个占位符显示成一个可点击替换的标记，标记上是 `label`。点它就地输入替换；Tab / Shift+Tab 在待填项之间前后跳，填进去的文字之后与普通文字无异。同一个 `label` 出现多处时各自独立替换。标记以外的文字照常可以改；换选另一个 `scene` 模板会换掉输入框里的文字（可撤销），把挂着的模板摘掉则不动文字。
- **提示与示例句**：模板详情里按清单顺序列出待填项（`label` 与 `hint`），并显示「可以这样说」的示例句，拼法见 §3.1。输入框下方的提示行也列出还没填的 `label`。
- **没填也能发送**：发送时客户端把没填的项写成「[label]」（方括号里是 `label`）放进 `text`，不保留 `{{`；界面提示还有几处没填并说明「不填也能发送，Agent 会先问你」，不拦发送。
- **智能体怎么对待**：挂着 `scene` 模板时，前言第 10 条（§5.2）要求智能体把「[label]」归入简报缺项一起问。`example` 不附前言，「[label]」作为消息里的普通文字交给智能体，由它照常追问或按上下文决定。

---

## 6. 目录来源与加载

- **内置模板**（`origin: 'builtin'`）：仓库根的 `templates/` 目录，随应用分发，`source` 为 `official`，`author` 为 `BaoCut`。Runtime 依次找环境变量 `BAOCUT_TEMPLATES_DIR`、打包后的资源目录里的 `templates/`、开发时往上找到的仓库根（同时有 `package.json` 与 `templates/` 的目录）。都没有时没有内置模板。
- **用户模板**（`origin: 'user'`）：Runtime Home 下的 `templates/`（`<BAOCUT_HOME>/templates`），用户自己放进来的模板，格式与校验同内置模板；`source` 以清单为准。目录不存在时当作空目录，Runtime 不替用户创建。
- **社区模板**〔P1〕：来源、下载、安装位置与信任规则待定（§8）；`source` 为 `community`。

Runtime 加载一个目录来源时：

1. 逐个读取子目录；不是目录的条目与隐藏条目忽略。是符号链接的条目不跟随，记一条诊断（说明模板为什么没出现）。
2. 按 §2.3 判断 `schema`，按 §3–§4 校验清单与文件：`id` 等于目录名，`prompt.md` 是非空的 UTF-8 且不超过上限、占位符与待填项对得上（§2.2、§3.1），`locales/` 里的译文成对且合规（§3.6），登记的文件都在、封面与预览不超过体积上限（§3.3），没有未登记的文件，模板目录里任何一层都没有符号链接。不合规的模板跳过并记诊断，其余照常提供。
3. 同一来源里 `id` 重复时，两个都跳过并记诊断。
4. 用户目录里的模板与内置模板同 `id` 时，内置的优先，用户的那一份跳过并记诊断：会话里的模板标记按 `id` 引用模板，不能让用户目录悄悄换掉官方模板的含义。要改一个内置模板，复制一份换个 `id`。
5. 列表顺序由界面决定；Runtime 给出的顺序不是排序合同。

诊断随 `templates.list` 返回：`{ code, origin, dir, path, message, issues }`。`code` 取 `unsupported-schema`（§2.3）、`invalid`（清单、正文或文件不合规）、`duplicate-id`（第 3 条）、`builtin-conflict`（第 4 条）；`dir` 是模板目录名，`path` 是它的绝对路径，`issues` 是逐条的问题。

Runtime 不缓存目录：每次 `templates.list`、`templates.get`、`templates.openHandle` 都重新读取，用户放进或改了模板之后再列一次就能看到。随附文件（`cover.file`、`preview.file`、`assets[].path`）经 `templates.openHandle({ id, path })` 换成媒体通道的短期地址；只认清单登记的路径，`prompt.md` 与清单本身不经这条路。方法的参数与返回见[命令与协议规范 §4.1](command-protocol-spec.md#41-方法)。

---

## 7. 新增与校验

新增一个内置模板：

1. 在 `templates/` 下建 `<id>/`，写 `template.json` 与 `prompt.md`（JSON 两空格缩进）；
2. 有封面、预览或素材时放进对应位置，并在清单里登记；
3. 用真实的智能体按模板做一条视频，把成片按 §3.3 的做法压成 `preview.mp4` 与 `cover.jpg`，在清单里写 `verification`（§3.5）；
4. 运行 `npm test -- packages/protocol`：`template.test.ts` 会逐个校验 `templates/` 下的全部目录（清单合法、`id` 等于目录名且不重复、`prompt.md` 非空且不超限、占位符与 `fields` 对得上（`scene` 的 `brief` 在清单校验里查，`prompt.md` 不得有 `{{`；`example` 查 `prompt.md`）、`skills` 含 `video-production`、登记的文件存在、封面与预览不超过体积上限、没有未登记的文件）。`npm test -- packages/runtime-core/src/templates` 再用 Runtime 的加载器（§6）读一遍，要求全部加载、没有诊断，并检查 `skills` 写的每一项都在仓库根 `skills/` 里。
5. 给原文以外的每种出货语言写译文（§3.6），内置模板要齐全。`template.test.ts` 按「模板 · 语言」逐条校验（只跑一种语言：`npx vitest run packages/protocol/src/template.test.ts -t ' · ja：'`）：两个文件都在、译文合法且与清单对得上、每项待填项的 `hint` 与 `example` 有无和原文一致、占位符对得上；原文角标是中文时要给译文的角标；中文与日文以外的译文不得残留汉字。

文案的语言中立、不出现真实品牌与他人作品名等要求（§4.2、§4.3）与译文的质量测试查不全，提交前人工审阅。

---

## 8. 待评审事项

- 社区模板的来源、下载、签名或信任规则；社区模板是否装进用户目录（§6），装进去时同 `id` 的处理是否沿用「内置优先」。
- 素材交给智能体的方式：这一版只列本机路径（§5.4），智能体读项目目录以外的文件时可能要用户审批；是否在发送时把选用的素材复制进项目，待定。
- 「模板」一词在产品设计 §5.9〔AST-04〕与本规范中指两种东西，术语表尚无条目，需要定一个区分的叫法。
