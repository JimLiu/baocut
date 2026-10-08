/**
 * 创作模板（模板包规范 docs/spec/template-spec.md）：Home 起始页「模板」入口用的视频制作模板。一个模板是一个目录
 * `templates/<id>/`：清单 `template.json`、提示词正文 `prompt.md`，可选封面 `cover.*`、预览 `preview.*` 与 `assets/` 下的素材。
 *
 * 这里是清单的类型、取值集合与无依赖的检查函数，随主入口进界面，不带 zod；校验用的 zod schema 在 `template-schemas.ts`，
 * 经 `@baocut/protocol/schemas` 导出。
 */

import { ProtocolValidation as V } from './messages/protocol/protocol-validation.ts';

/** 清单格式版本（`schema` 字段）。不认识的版本整份跳过（规范 §2.3）。 */
export const TEMPLATE_SCHEMA_VERSION = 1;

/** 清单与提示词的文件名。 */
export const TEMPLATE_MANIFEST_FILE = 'template.json';
export const TEMPLATE_PROMPT_FILE = 'prompt.md';
/** 素材目录：清单 `assets[].path` 都在它下面。 */
export const TEMPLATE_ASSETS_DIR = 'assets';

/**
 * 两类模板（规范 §1.2）：
 * - `scene`：场景模板。给一个创作方向和默认画幅、时长；使用时智能体先引导用户过一遍简报，确认后再制作。
 * - `example`：作品示例。一条完整的提示词，选用即放进输入框，不走简报。
 */
export const TEMPLATE_KINDS = ['scene', 'example'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

/** 按题材分的分类，两类模板共用（规范 §3.2）。显示名由界面给。 */
export const TEMPLATE_CATEGORIES = [
  'marketing',
  'product-launch',
  'explainer',
  'news-data',
  'editing',
  'creative-short',
  'motion-design',
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const TEMPLATE_SOURCES = ['official', 'community'] as const;
export type TemplateSource = (typeof TEMPLATE_SOURCES)[number];

/** 默认画幅；缺省表示交给智能体。 */
export const TEMPLATE_RATIOS = ['16:9', '9:16', '1:1'] as const;
export type TemplateRatio = (typeof TEMPLATE_RATIOS)[number];

/** 默认时长（秒）：与 Home 时长滑杆同一组数值，5–600 秒，步长 5。 */
export const TEMPLATE_DURATION_MIN = 5;
export const TEMPLATE_DURATION_MAX = 600;
export const TEMPLATE_DURATION_STEP = 5;

/** 占位封面的底色。 */
export const TEMPLATE_TONES = ['blue', 'orange', 'green', 'purple', 'cyan', 'indigo', 'magenta', 'seafoam', 'brown'] as const;
export type TemplateTone = (typeof TEMPLATE_TONES)[number];

/** 占位封面里那枚图形的画法。 */
export const TEMPLATE_FIGURES = ['bars', 'ring', 'cards', 'steps'] as const;
export type TemplateFigure = (typeof TEMPLATE_FIGURES)[number];

/** 随模板分发的素材种类与允许的扩展名（小写）。 */
export const TEMPLATE_ASSET_TYPES = ['image', 'svg', 'audio', 'video'] as const;
export type TemplateAssetType = (typeof TEMPLATE_ASSET_TYPES)[number];
export const TEMPLATE_ASSET_EXTENSIONS: Readonly<Record<TemplateAssetType, readonly string[]>> = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
  svg: ['svg'],
  audio: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac'],
  video: ['mp4', 'webm', 'mov'],
};
/** 封面图与预览视频允许的扩展名。 */
export const TEMPLATE_COVER_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'svg'] as const;
export const TEMPLATE_PREVIEW_EXTENSIONS = ['mp4', 'webm'] as const;

/** 文案与列表的上限（字符数按 UTF-16 码元计）。 */
export const TEMPLATE_LIMITS = {
  id: 64,
  title: 40,
  summary: 80,
  description: 400,
  /** scene 的 `brief`：选用模板时填进输入框的那段话。 */
  brief: 400,
  /** 待填项（`fields`）最多几项，以及每项的 label、hint、example 的上限。 */
  fields: 8,
  fieldLabel: 24,
  fieldHint: 80,
  fieldExample: 80,
  /** 建议先读的 craft（`skills`）最多几项，每个 id 的上限。 */
  skills: 4,
  skill: 64,
  kicker: 24,
  beat: 60,
  beatsMin: 3,
  beatsMax: 5,
  tags: 8,
  tag: 24,
  assets: 64,
  note: 200,
  /** `prompt.md` 的上限（字节，UTF-8）。 */
  promptBytes: 16 * 1024,
} as const;

/**
 * 封面图与预览视频的体积上限（字节，规范 §3.3）：模板随应用分发，预览只是一段压缩过的示意，封面只是一张缩略图。
 */
export const TEMPLATE_FILE_MAX_BYTES = {
  cover: 150 * 1024,
  preview: 2 * 1024 * 1024,
} as const;

/** 验证记录的结论（规范 §3.5）。 */
export const TEMPLATE_VERIFICATION_OUTCOMES = ['pass', 'partial', 'fail'] as const;
export type TemplateVerificationOutcome = (typeof TEMPLATE_VERIFICATION_OUTCOMES)[number];

/**
 * 验证时缺失、因而降级或跳过的能力（规范 §3.5）。前四项与模型服务的能力同名；视频、音乐与音效生成还没有对应的 Provider，
 * 先在这里占名字。
 */
export const TEMPLATE_VERIFICATION_CAPABILITIES = [
  'transcribe',
  'synthesizeSpeech',
  'generateImage',
  'generateText',
  'generateVideo',
  'generateMusic',
  'generateSoundEffect',
] as const;
export type TemplateVerificationCapability = (typeof TEMPLATE_VERIFICATION_CAPABILITIES)[number];

/** 验证记录的文案上限。 */
export const TEMPLATE_VERIFICATION_LIMITS = {
  engine: 32,
  input: 4000,
  materials: 16,
  materialTitle: 120,
  materialUrl: 500,
  materialLicense: 60,
  materialNote: 200,
  notes: 1000,
} as const;

/** 模板 id：小写字母开头，小写字母、数字与单个连字符，等于目录名。 */
export const TEMPLATE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** `skills` 里的 craft id（仓库根 `skills/<id>`）：与模板 id 同一种 kebab-case。 */
export const TEMPLATE_SKILL_ID_PATTERN = TEMPLATE_ID_PATTERN;

/**
 * 待填项（规范 §3.1、§5.5）：模板文字里用 `{{label}}` 留给用户填的一处。scene 写在 `brief` 里，example 写在 `prompt.md` 里。
 */
export interface TemplateField {
  /** 占位符里的名字，模板内唯一；不含 `{`、`}` 与换行。 */
  label: string;
  /** 给用户看的「填什么」。 */
  hint?: string;
  /** 示例值：把它代进占位符，就是「可以这样说」的示例句。 */
  example?: string;
}

export interface TemplateCover {
  /** 封面图，模板目录里的 `cover.<ext>`；缺省时界面用下面三项画占位封面。 */
  file?: string;
  tone?: TemplateTone;
  figure?: TemplateFigure;
  /** 封面左上角的小字。 */
  kicker?: string;
}

export interface TemplatePreview {
  /** 预览视频，模板目录里的 `preview.<ext>`。 */
  file?: string;
  /** 3–5 句分镜要点：没有预览视频时轮播的占位画面。只用于展示，不拼进提示词。 */
  beats?: string[];
}

export interface TemplateAsset {
  /** `assets/` 下的相对路径。 */
  path: string;
  type: TemplateAssetType;
  /** 这个素材做什么用：给用户看，也随提示词交给智能体。 */
  note: string;
}

/** 验证时用到的一项公开素材：来源与许可。素材本身不随模板分发。 */
export interface TemplateVerificationMaterial {
  title: string;
  /** 素材页的 https 地址。 */
  url: string;
  /** 许可，例如 `CC0-1.0`、`Public-Domain`，或素材站自己的许可名。 */
  license: string;
  note?: string;
}

/**
 * 验证记录（规范 §3.5）：用真实的智能体按这个模板做过一条视频，记下输入、条件与结果。`preview.file` 与 `cover.file`
 * 通常就取自这次的成片。只供维护与展示，不拼进提示词。
 */
export interface TemplateVerification {
  /** 验证的日期，`YYYY-MM-DD`。 */
  date: string;
  /** 跑的是哪个模板版本（之后按发现改了模板时，`version` 会比它新）。 */
  version: string;
  /** 智能体引擎，例如 `codex`。 */
  engine: string;
  /** 发给智能体的话：scene 是用户消息，example 写「按提示词原样」或改动说明。 */
  input: string;
  materials: TemplateVerificationMaterial[];
  /** 缺失、因而降级或跳过的能力。 */
  capabilities: TemplateVerificationCapability[];
  outcome: TemplateVerificationOutcome;
  /** 成片实测的画幅（宽高约分后的 `W:H`）与时长（秒）。`fail` 且没有成片时可以缺省。 */
  output?: { ratio: string; durationSeconds: number };
  /** 发现的问题与对模板做的修改。 */
  notes: string;
}

export interface TemplateManifest {
  schema: typeof TEMPLATE_SCHEMA_VERSION;
  id: string;
  /** 模板自身的版本，semver。 */
  version: string;
  kind: TemplateKind;
  title: string;
  /** 卡片上的一句话。 */
  summary: string;
  /** 详情里的一小段。 */
  description: string;
  /** 文案（title、summary、description、brief、fields、beats、prompt.md）的语言标签，BCP 47。不是成片的语言。 */
  language: string;
  category: TemplateCategory;
  /** 缺省为自动。scene 必填。 */
  ratio?: TemplateRatio;
  /** 缺省为自动。scene 必填。 */
  durationSeconds?: number;
  /**
   * 选用模板时填进输入框的那段话：用户口吻，一到三句，用 `{{label}}` 留出待填项。scene 必填，example 不得有
   * （example 的待填项直接写在 `prompt.md` 里）。
   */
  brief?: string;
  /** 待填项，`brief`（scene）或 `prompt.md`（example）里的每个占位符都要在这里声明，声明的每项都要被引用。 */
  fields?: TemplateField[];
  /** 做这类成片建议先读的 craft（`skills/<id>`）。 */
  skills?: string[];
  author: string;
  source: TemplateSource;
  /** SPDX 许可标识。 */
  license: string;
  tags: string[];
  cover: TemplateCover;
  preview: TemplatePreview;
  assets?: TemplateAsset[];
  /** 最近一次的验证记录。 */
  verification?: TemplateVerification;
}

/**
 * 模板内文件路径的问题（规范 §4.1）；合规时返回 null。只接受目录内的相对路径：正斜杠分隔，不以 `/` 或盘符开头，
 * 不含 `..`、`.`、空段、反斜杠或控制字符。
 */
export function templatePathProblem(path: string): string | null {
  if (!path) return V.pathEmpty().text;
  if (path.length > 200) return V.pathTooLong().text;
  if (/[\\\u0000-\u001f]/.test(path)) return V.pathBadChars().text;
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.startsWith('~')) return V.templatePathRelative().text;
  if (path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return V.pathBadSegments().text;
  return null;
}

// ---- 待填项（规范 §5.5） ----

/** 一个占位符：`{{label}}`，label 不含花括号与换行、不为空。 */
const TEMPLATE_SLOT = /\{\{([^{}\n]+)\}\}/g;

/** 文本里的占位符 label，按出现顺序（重复出现的照样列出）。 */
export function templateSlots(text: string): string[] {
  return [...text.matchAll(TEMPLATE_SLOT)].map((m) => m[1]!);
}

/** 把每个占位符换成 `fill(label)` 的结果；不是占位符的文字原样保留。 */
export function replaceTemplateSlots(text: string, fill: (label: string) => string): string {
  return text.replace(TEMPLATE_SLOT, (_whole, label: string) => fill(label));
}

/**
 * 示例句（规范 §5.5）：把每个占位符换成该项的 `example`，没有 example（或没有声明）的换成 label 本身。
 * scene 用 `brief`，example 用 `prompt.md`。
 */
export function templateExampleText(text: string, fields: readonly TemplateField[] = []): string {
  const examples = new Map(fields.map((f) => [f.label, f.example ?? f.label]));
  return replaceTemplateSlots(text, (label) => examples.get(label) ?? label);
}

/**
 * 发送时没填的待填项（规范 §5.5）：占位符换成「[label]」写进消息，智能体把它们当作简报缺项来问。
 */
export function templateUnfilledText(text: string): string {
  return replaceTemplateSlots(text, (label) => `[${label}]`);
}

/**
 * 文本与待填项声明对不上的地方（规范 §3.1）；合规时为空数组。文本里的每个 `{{…}}` 都要对应一个声明的 label，
 * 声明的每项至少被引用一次；拆不成占位符的 `{{` 也算问题。scene 传 `brief`，example 传 `prompt.md`。
 */
export function templateSlotProblems(text: string, fields: readonly TemplateField[] = []): string[] {
  const problems: string[] = [];
  const declared = new Set(fields.map((f) => f.label));
  const used = templateSlots(text);
  for (const label of new Set(used)) if (!declared.has(label)) problems.push(V.templateSlotUndeclared({ label }).text);
  for (const label of declared) if (!used.includes(label)) problems.push(V.templateFieldUnused({ label }).text);
  if (replaceTemplateSlots(text, () => '').includes('{{')) problems.push(V.templateSlotUnclosed().text);
  return problems;
}

/**
 * `prompt.md` 里的占位符问题（规范 §2.2）：example 的正文就是放进输入框的话，占位符要与 `fields` 对得上；
 * scene 的正文是给智能体的制作要求，不得出现 `{{`（待填项写在 `brief` 里）。
 */
export function templatePromptSlotProblems(manifest: Pick<TemplateManifest, 'kind' | 'fields'>, prompt: string): string[] {
  if (manifest.kind === 'scene') return prompt.includes('{{') ? [V.templateScenePromptSlots().text] : [];
  return templateSlotProblems(prompt, manifest.fields ?? []);
}

/** 小写扩展名；没有时为空串。 */
export function templateFileExtension(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** 读到的 `schema` 是否是这一版认识的；不认识的模板整份跳过，不拖垮整个目录。 */
export function isSupportedTemplateSchema(value: unknown): value is typeof TEMPLATE_SCHEMA_VERSION {
  return value === TEMPLATE_SCHEMA_VERSION;
}

// ---- 模板目录（`templates.*`，模板包规范 §6、§8） ----

/** 模板从哪个目录来：随应用分发的内置目录，或 Runtime Home 下用户自己放的 `templates/`。与清单的 `source` 无关。 */
export const TEMPLATE_ORIGINS = ['builtin', 'user'] as const;
export type TemplateOrigin = (typeof TEMPLATE_ORIGINS)[number];

/**
 * 跳过一个模板的原因（规范 §6）：
 * - `unsupported-schema`：`schema` 缺失或不认识；
 * - `invalid`：清单、`prompt.md` 或目录里的文件不合规（含 id 与目录名不符、路径越出目录、符号链接、未登记的文件）；
 * - `duplicate-id`：同一个来源里两个模板的 id 相同，两个都跳过；
 * - `builtin-conflict`：用户目录里的模板与内置模板同 id，用户的这一份跳过，内置的照常提供。
 */
export const TEMPLATE_DIAGNOSTIC_CODES = ['unsupported-schema', 'invalid', 'duplicate-id', 'builtin-conflict'] as const;
export type TemplateDiagnosticCode = (typeof TEMPLATE_DIAGNOSTIC_CODES)[number];

/** 一个没能加载的模板目录。 */
export interface TemplateDiagnostic {
  code: TemplateDiagnosticCode;
  origin: TemplateOrigin;
  /** 模板目录的名字（期望等于 id）。 */
  dir: string;
  /** 模板目录的绝对路径，给用户去找那个目录。 */
  path: string;
  /** 一句给人看的说明。 */
  message: string;
  /** 具体的问题，一条一项；可以为空。 */
  issues: string[];
}

/** 目录里的一个可用模板：清单原样，加上来源与随附文件的概况。 */
export interface TemplateSummary {
  manifest: TemplateManifest;
  origin: TemplateOrigin;
  /** 有没有封面图、预览视频，带几项素材（文件都经 `templates.openHandle` 取）。 */
  files: { cover: boolean; preview: boolean; assets: number };
}

export interface TemplateListResult {
  templates: TemplateSummary[];
  /** 跳过的模板目录。只在 `templates.list` 里给出。 */
  diagnostics: TemplateDiagnostic[];
}

export interface TemplateDetail {
  template: TemplateSummary;
  /** `prompt.md` 的全文。 */
  prompt: string;
}

/**
 * 发送消息时挂上的场景模板（`conversations.send` 的 `template`，规范 §5.2）。`version` 只是参考：Runtime 总用目录里当前的版本，
 * 实际用的版本记在消息上。`assets` 是用户留下的素材（清单 `assets[].path`），不给时全部附上，给空数组时一项也不附。
 */
export interface TemplateSendRef {
  id: string;
  version?: string;
  assets?: string[];
}

/** 用户消息上的模板标记：会话里显示「模板：标题」，不含提示词正文。 */
export interface TemplateMessageRef {
  id: string;
  /** 实际用的版本。 */
  version: string;
  title: string;
  kind: TemplateKind;
  origin: TemplateOrigin;
}
