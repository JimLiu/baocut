/**
 * Agent 的 skill（架构设计 §3.8、§12.9，产品设计 §6.9）：教内置 Agent 按某种方法做事的一个文件夹。根目录有一份 `SKILL.md`
 * （YAML front matter 里的 `name`、`description`，可选 `version`；其后是正文），旁边可以有参考文件。
 *
 * - 开关开（`enabled`）：会话开始时 Agent 拿到它的名称与描述，相关时自己用 `skills_read` 取正文；
 * - 开关关：只有用户在输入框「+ › 使用 Skill」里点选它（`conversations.send` 的 `skill`）时才用。
 *
 * 这里是类型、上限与无依赖的 id 规则，随主入口进界面；入站校验在 `skill-schemas.ts`。
 */

import { isLocale, type Locale } from './i18n.ts';

/** skill 正文的文件名。没有它的目录不是 skill。 */
export const SKILL_FILE = 'SKILL.md';
/** BaoCut 自己记的来源（从哪个文件夹添加、从哪个 GitHub 地址与提交导入），放在 skill 目录里；点开头，不进文件清单，也不改用户的 `SKILL.md`。 */
export const SKILL_SOURCE_FILE = '.baocut-skill.json';
/**
 * 内置 skill 给界面看的名称与一句话介绍（`SkillLabels`），按出货语言各一份，放在内置 skill 目录里；点开头，不进文件清单，
 * 不交给智能体（智能体读 front matter 的 `name` 与 `description`）。用户目录里的不读。
 */
export const SKILL_META_FILE = '.baocut-meta.json';

/**
 * skill 从哪里来：
 * - `builtin`：随应用发布，可以关，不能移除；
 * - `personal`：用户从本地文件夹添加的，或自己放进 `<Runtime Home>/skills/` 的；
 * - `third-party`：从 GitHub 导入的。
 */
export const SKILL_ORIGINS = ['builtin', 'personal', 'third-party'] as const;
export type SkillOrigin = (typeof SKILL_ORIGINS)[number];

/** 各来源的默认开关：内置与自己添加的默认开，第三方默认关（只在点选时用）。用户改过的才存差量。 */
export const SKILL_DEFAULT_ENABLED: Readonly<Record<SkillOrigin, boolean>> = {
  builtin: true,
  personal: true,
  'third-party': false,
};

/** 上限。字符数按 UTF-16 码元计。 */
export const SKILL_LIMITS = {
  id: 64,
  name: 100,
  description: 1024,
  version: 64,
  /** `SKILL_META_FILE` 里每种语言的名称与一句话介绍。 */
  labelName: 40,
  labelSummary: 120,
  /** `SKILL_META_FILE` 的上限（字节，UTF-8）。 */
  metaFileBytes: 64 * 1024,
  /** `SKILL.md` 的上限（字节，UTF-8）：点选时全文交给智能体，不能无限大。 */
  skillFileBytes: 64 * 1024,
  /** 一个 skill 目录里最多多少个文件（含 `SKILL.md`；点开头的不算）。添加、导入与列目录都按它。 */
  files: 200,
  /** 一个 skill 目录里全部文件的总字节数上限。添加与导入按它。 */
  totalBytes: 8 * 1024 * 1024,
  /** `skills.readFile` 与 `skills_read` 一次能读的文本文件上限（字节）。 */
  readFileBytes: 256 * 1024,
  /** 文件在目录内的相对路径的长度上限。 */
  path: 300,
  /** 一条消息最多点选几个 skill（`conversations.send` 的 `skills`）。 */
  perMessage: 20,
} as const;

/**
 * skill id：小写的字母、数字与单个连字符（字母不限于拉丁字母），由目录名规范化而来（`normalizeSkillId`），也是
 * `<Runtime Home>/skills/<id>/` 的目录名。
 */
export const SKILL_ID_PATTERN = /^[\p{Ll}\p{Lo}\p{Lm}\p{M}\p{Nd}]+(?:-[\p{Ll}\p{Lo}\p{Lm}\p{M}\p{Nd}]+)*$/u;

/**
 * 目录名（或 GitHub 路径的最后一段）→ skill id：Unicode NFC、转小写，字母与数字以外的连续字符换成一个连字符，去掉首尾连字符，
 * 截到上限。规范化之后为空（例如全是标点）时返回 null。不同的名字可能得到同一个 id，冲突时由调用方拒绝。
 */
export function normalizeSkillId(name: string): string | null {
  const lowered = name.normalize('NFC').toLowerCase();
  const id = lowered
    .replace(/[^\p{Ll}\p{Lo}\p{Lm}\p{M}\p{Nd}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SKILL_LIMITS.id)
    .replace(/-+$/, '');
  return id && SKILL_ID_PATTERN.test(id) ? id : null;
}

/** skill 是怎么装进来的（`SKILL_SOURCE_FILE` 里记的）。内置的与用户自己放进目录的没有。 */
export type SkillSource =
  | {
      kind: 'local';
      /** 添加时选的文件夹（绝对路径）。之后改那个文件夹不影响已经复制进来的 skill。 */
      path: string;
      addedAt: string;
    }
  | {
      kind: 'github';
      /** 用户给的地址，规范化成 `https://github.com/<owner>/<repo>[/tree/<ref>/<path>]`。 */
      url: string;
      owner: string;
      repo: string;
      /** 分支、标签或提交；地址里没写时是仓库的默认分支。 */
      ref: string;
      /** 导入时 `ref` 指向的提交（完整 sha）。 */
      commit: string;
      /** 仓库里的子目录；仓库根为空串。 */
      path: string;
      importedAt: string;
    }
  | {
      /** 在 BaoCut 里新建的（空白模板），或复制自另一个 skill（`from` 是那个 skill 的 id）。 */
      kind: 'created';
      createdAt: string;
      from: string | null;
    };

/**
 * 内置 skill 给界面看的文字（`SKILL_META_FILE`）：短名与一句话介绍，键是出货语言，都有英文（兜底）。front matter 的
 * `name` 是给智能体的 id 式名字，`description` 是给智能体的触发说明，都不适合直接放进菜单与列表。
 */
export interface SkillLabels {
  name: Partial<Record<Locale, string>> & { en: string };
  summary: Partial<Record<Locale, string>> & { en: string };
}

/**
 * `SKILL_META_FILE` 的内容 → `SkillLabels`：`name` 与 `summary` 都是「语言 → 文字」的对象，都要有英文；认不出的语言、空的或超长的
 * 文字丢掉。不合规时 null（界面退回 front matter），不让一份界面文字挡住 skill 本身。
 */
export function parseSkillLabels(raw: unknown): SkillLabels | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const pick = (value: unknown, limit: number): (Partial<Record<Locale, string>> & { en: string }) | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const out: Partial<Record<Locale, string>> = {};
    for (const [key, text] of Object.entries(value)) {
      if (!isLocale(key) || typeof text !== 'string') continue;
      const line = text.trim();
      if (line && !/[\r\n]/.test(line) && line.length <= limit) out[key] = line;
    }
    return out.en ? (out as Partial<Record<Locale, string>> & { en: string }) : null;
  };
  const record = raw as Record<string, unknown>;
  const name = pick(record.name, SKILL_LIMITS.labelName);
  const summary = pick(record.summary, SKILL_LIMITS.labelSummary);
  return name && summary ? { name, summary } : null;
}

/**
 * 界面上显示的名称与一句话介绍：按语言取 `labels`，缺这种语言时英文；没有 `labels` 时是 front matter 的 `name` 与 `description`
 * （由调用方截成一行）。
 */
export function skillLabel(
  skill: Pick<SkillSummary, 'name' | 'description' | 'labels'> & { title?: string | null },
  locale: Locale,
): { name: string; summary: string } {
  const labels = skill.labels;
  if (!labels) return { name: skill.title || skill.name, summary: skill.description };
  return {
    name: labels.name[locale] ?? labels.name.en,
    summary: labels.summary[locale] ?? labels.summary.en,
  };
}

/** 列表里的一个 skill。 */
export interface SkillSummary {
  id: string;
  /** front matter 的 `name`，原样。 */
  name: string;
  /** 界面给的显示名（新建、复制、另存为副本时起的），记在来源记录里；没有时 null，界面用 `labels` 或 `name`。 */
  title: string | null;
  /** front matter 的 `description`，原样。 */
  description: string;
  /** 内置 skill 的 `SKILL_META_FILE`；用户目录里的 skill、没有或读不了时为 null。界面用 `skillLabel` 取当前语言的文字。 */
  labels: SkillLabels | null;
  /** front matter 的 `version`；没有时为 null。 */
  version: string | null;
  origin: SkillOrigin;
  /** 现在的开关。 */
  enabled: boolean;
  /** 这个来源的默认开关（`SKILL_DEFAULT_ENABLED`）。 */
  defaultEnabled: boolean;
  /** 能不能移除：内置的不能。 */
  removable: boolean;
  /** skill 目录的绝对路径。 */
  path: string;
  source: SkillSource | null;
  /** 目录里的文件数（含 `SKILL.md`）。 */
  fileCount: number;
  /** 目录里文件的总字节数。 */
  bytes: number;
  /** 当前版本号（从 1 起）；内置的为 null。只有个人来源的能在应用里编辑、产生新版本。 */
  revision: number | null;
  /** `SKILL.md` 的修改时间。 */
  updatedAt: string;
}

/**
 * 跳过一个 skill 目录的原因：
 * - `invalid`：没有 `SKILL.md`、front matter 缺 `name` / `description`、超过上限、不是 UTF-8、含符号链接或特殊文件；
 * - `duplicate-id`：同一个目录里两个子目录规范化后 id 相同，两个都跳过；
 * - `builtin-conflict`：`<Runtime Home>/skills/` 里的与内置 skill 同 id，用户的这一份跳过。
 */
export const SKILL_DIAGNOSTIC_CODES = ['invalid', 'duplicate-id', 'builtin-conflict'] as const;
export type SkillDiagnosticCode = (typeof SKILL_DIAGNOSTIC_CODES)[number];

/** 一个没能加载的 skill 目录。`scope`：内置目录，或 `<Runtime Home>/skills/`。 */
export interface SkillDiagnostic {
  code: SkillDiagnosticCode;
  scope: 'builtin' | 'user';
  /** 目录名。 */
  dir: string;
  /** 目录的绝对路径。 */
  path: string;
  message: string;
  issues: string[];
}

export interface SkillListResult {
  skills: SkillSummary[];
  diagnostics: SkillDiagnostic[];
}

/** skill 目录里的一个文件。`text`：是不超过 `SKILL_LIMITS.readFileBytes` 的 UTF-8 文本，能经 `skills.readFile` 看。 */
export interface SkillFileEntry {
  /** 目录内的相对路径，`/` 分隔。 */
  path: string;
  size: number;
  text: boolean;
}

export interface SkillDetail {
  skill: SkillSummary;
  /** `SKILL.md` 全文（含 front matter）。 */
  content: string;
  /** 目录里的全部文件（含 `SKILL.md`），按路径排序；点开头的与 BaoCut 的来源记录不在其中。 */
  files: SkillFileEntry[];
}

export interface SkillFileContent {
  path: string;
  size: number;
  content: string;
}

/** 开关、添加、导入之后：改动的那个 skill，以及更新后的整份列表。 */
export interface SkillChangeResult extends SkillListResult {
  skill: SkillSummary;
}

/** 移除之后：删掉的目录，以及更新后的整份列表。 */
export interface SkillRemoveResult extends SkillListResult {
  removed: { id: string; path: string };
}

/**
 * 发送消息时点选的 skill（`conversations.send` 的 `skills` 每一项，或单个的 `skill`）：开着的、关着的都可以点。
 * 一条消息可以带几个，按挂上的顺序交给智能体，重复的 id 只算第一次。
 */
export interface SkillSendRef {
  id: string;
}

/** 用户消息上的 skill 标记：会话里每个显示一个「Skill：名称」，不含正文。 */
export interface SkillMessageRef {
  id: string;
  name: string;
  origin: SkillOrigin;
}

/**
 * `conversations.send` 点选的 skill 合成一份有序清单：单个的 `skill` 在前，`skills` 按顺序接在后面，重复的 id 只留第一次。
 * 两个都没给时是空清单。
 */
export function sendSkillRefs(params: { skill?: SkillSendRef; skills?: readonly SkillSendRef[] }): SkillSendRef[] {
  const seen = new Set<string>();
  const out: SkillSendRef[] = [];
  for (const ref of [...(params.skill ? [params.skill] : []), ...(params.skills ?? [])]) {
    if (seen.has(ref.id)) continue;
    seen.add(ref.id);
    out.push({ id: ref.id });
  }
  return out;
}

/** 用户消息上的 skill 标记，按挂上的顺序；兼容只写了单个 `skill` 的旧记录。 */
export function messageSkills(message: { skill?: SkillMessageRef; skills?: readonly SkillMessageRef[] }): SkillMessageRef[] {
  if (message.skills?.length) return [...message.skills];
  return message.skill ? [message.skill] : [];
}

/** skill 里一个文件的类别（界面的文件树、预览与素材栏，Runtime 的素材与脚本判断共用）。 */
export type SkillFileKind = 'skill' | 'doc' | 'svg' | 'image' | 'audio' | 'video' | 'font' | 'data' | 'script' | 'code' | 'other';

const SKILL_FILE_KINDS: Readonly<Record<string, SkillFileKind>> = {
  md: 'doc',
  markdown: 'doc',
  txt: 'doc',
  svg: 'svg',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  flac: 'audio',
  ogg: 'audio',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  ttf: 'font',
  otf: 'font',
  woff2: 'font',
  json: 'data',
  yaml: 'data',
  yml: 'data',
  csv: 'data',
  toml: 'data',
  js: 'script',
  mjs: 'script',
  cjs: 'script',
  ts: 'script',
  py: 'script',
  sh: 'script',
  rb: 'script',
  ps1: 'script',
  bat: 'script',
  html: 'code',
  css: 'code',
};

/** 按扩展名分类；根目录的 `SKILL.md` 是 `skill`。 */
export function skillFileKind(path: string): SkillFileKind {
  if (path === SKILL_FILE) return 'skill';
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? '';
  return SKILL_FILE_KINDS[ext] ?? 'other';
}

/** 素材：图片（含 svg）、音频、视频与字体。智能体可以直接导入它们。 */
export function isSkillAssetPath(path: string): boolean {
  const kind = skillFileKind(path);
  return kind === 'svg' || kind === 'image' || kind === 'audio' || kind === 'video' || kind === 'font';
}

/** 脚本：BaoCut 从不运行它们；从 skill 生成 `BRAND.md` 时不带。 */
export function isSkillScriptPath(path: string): boolean {
  return skillFileKind(path) === 'script';
}

/* ---------- 版本、上传包与项目品牌（架构设计 §3.8「版本」「上传包」「项目品牌」，产品设计 §6.9） ---------- */

/** 一个 skill 最多保留几个版本（含当前版本）；超出时最早的先删。 */
export const SKILL_MAX_VERSIONS = 20;

/** 每个版本是怎么来的：新建、上传（含更新同名）、在应用里编辑、恢复旧版本、复制、从 GitHub 导入。界面按它出文案。 */
export const SKILL_VERSION_KINDS = ['create', 'upload', 'edit', 'restore', 'duplicate', 'import'] as const;
export type SkillVersionKind = (typeof SKILL_VERSION_KINDS)[number];

/** `skills.versions` 的一项。新的在前。 */
export interface SkillVersion {
  revision: number;
  savedAt: string;
  kind: SkillVersionKind;
  /** 用户写的「这次改了什么」，或上传的文件名；没有时空串。 */
  note: string;
  /** `restore` 恢复的版本号、`duplicate` 复制自的 skill id；其余为 null。 */
  from: number | string | null;
  fileCount: number;
  bytes: number;
  current: boolean;
}

export interface SkillVersionsResult {
  versions: SkillVersion[];
}

/**
 * 写一个 skill（或项目品牌）里的文件：`text` 写文本（UTF-8），`from` 从本机的绝对路径复制（素材、二进制），`remove` 删掉。
 * 路径同 `skills.readFile`；同一路径只能出现一次。
 */
export type SkillFileChange = { path: string; text: string } | { path: string; from: string } | { path: string; remove: true };

/** 上传包里一个候选不能装的原因。 */
export const SKILL_CANDIDATE_ISSUES = ['no-description', 'too-many-files', 'too-large', 'unsafe-path', 'invalid'] as const;
export type SkillCandidateIssueCode = (typeof SKILL_CANDIDATE_ISSUES)[number];

/** 上传包里的一个 skill（`skills.inspectPackage`）。 */
export interface SkillPackageCandidate {
  /** 包里的目录（`/` 结尾；包根是空串）。`installPackage` 的 `picks` 按它选。 */
  prefix: string;
  /** 装进来时的 id（front matter 的 `name` 或目录名规范化）；得不出时空串（`issue` 为 `invalid`）。 */
  id: string;
  name: string;
  description: string;
  fileCount: number;
  bytes: number;
  /** 素材（图片、音频、视频、字体）与脚本的个数。 */
  assets: number;
  scripts: number;
  issue: { code: SkillCandidateIssueCode; message: string } | null;
  /** 同 id 的已有 skill；只有个人来源的能 `update`。`copyId` 是另存为副本时用的 id。 */
  conflict: { id: string; origin: SkillOrigin; canUpdate: boolean; nextRevision: number; copyId: string } | null;
}

export interface SkillPackageInspection {
  kind: 'zip' | 'folder';
  /** zip 的文件名或文件夹名。 */
  name: string;
  /** 略过的系统与隐藏条目（`__MACOSX/`、`.DS_Store`、点开头的目录），按包里的路径。 */
  ignored: string[];
  candidates: SkillPackageCandidate[];
}

/** `installPackage` 的一项选择：新装、更新同名的个人 skill（存一个新版本）、另存为副本。 */
export interface SkillPackagePick {
  prefix: string;
  mode: 'new' | 'update' | 'copy';
  /** 显示名（副本的「… 副本」由界面按语言给）。 */
  title?: string;
}

export interface SkillInstallResult extends SkillListResult {
  installed: SkillSummary[];
}

/** 项目根目录的品牌文件名，与素材的惯例目录。 */
export const PROJECT_BRAND_FILE = 'BRAND.md';
export const PROJECT_BRAND_DIR = 'brand';
/** `BRAND.md` 交给智能体时最多取多少字节。 */
export const PROJECT_BRAND_MAX_BYTES = 64 * 1024;

/** 有 `BRAND.md` 的一个项目（`brands.list`）。 */
export interface ProjectBrandSummary {
  projectId: string;
  projectName: string;
  projectPath: string;
  /** `BRAND.md` 的绝对路径。 */
  path: string;
  /** front matter 的 `description`，没有时第一段正文（跳过标题、列表、表格与代码）。 */
  summary: string;
  updatedAt: string;
  /** `BRAND.md` 加 `brand/` 里的文件。 */
  fileCount: number;
  bytes: number;
}

export interface ProjectBrandDetail {
  projectId: string;
  /** 没有 `BRAND.md` 时 null。 */
  brand: ProjectBrandSummary | null;
  content: string | null;
  /** `BRAND.md` 与 `brand/` 里的文件，相对项目根目录；点开头的不在其中。 */
  files: SkillFileEntry[];
}

/** 用户消息上的项目品牌标记：这条消息带了（`applied`）或用户摘掉了（`skipped`）项目的 `BRAND.md`。 */
export interface MessageBrandRef {
  state: 'applied' | 'skipped';
  /** `BRAND.md` 的绝对路径。 */
  path: string;
}

/**
 * 一句话介绍：front matter 的 `description`，没有时第一段正文（跳过标题、列表、表格、代码与引用）。
 * 与原型 `model-project-brand.js` 的 `summaryOf` 相同。
 */
export function projectBrandSummary(content: string): string {
  const text = content.replace(/\r\n/g, '\n');
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (fm) {
    for (const line of fm[1]!.split('\n')) {
      const kv = /^description:\s*(.*)$/.exec(line);
      const value = kv?.[1]?.replace(/^["']|["']$/g, '').trim();
      if (value) return value;
    }
  }
  const body = fm ? text.slice(fm[0].length) : text;
  const para: string[] = [];
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t) {
      if (para.length) break;
      continue;
    }
    if (/^(#|[-*](\s|$)|\d+[.)](\s|$)|\||```|>)/.test(t)) {
      if (para.length) break;
      continue;
    }
    para.push(t);
  }
  return para.join(' ');
}

/** 用户消息上的项目品牌标记；没有或形状不对（旧记录、别的版本写的）时 null。 */
export function messageBrand(message: { brand?: unknown }): MessageBrandRef | null {
  const brand = message.brand as Partial<MessageBrandRef> | undefined;
  if (!brand || (brand.state !== 'applied' && brand.state !== 'skipped') || typeof brand.path !== 'string') return null;
  return { state: brand.state, path: brand.path };
}
