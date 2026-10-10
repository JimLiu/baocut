/**
 * Agent 的 skill（架构设计 §3.8、§12.9，产品设计 §6.9）：教内置 Agent 按某种方法做事的一个文件夹。根目录有一份 `SKILL.md`
 * （YAML front matter 里的 `name`、`description`，可选 `version`；其后是正文），旁边可以有参考文件。
 *
 * - 开关开（`enabled`）：会话开始时 Agent 拿到它的名称与描述，相关时自己用 `skills_read` 取正文；
 * - 开关关：只有用户在输入框「+ › 使用 Skill」里点选它（`conversations.send` 的 `skill`）时才用。
 *
 * 这里是类型、上限与无依赖的 id 规则，随主入口进界面；入站校验在 `skill-schemas.ts`。
 */

/** skill 正文的文件名。没有它的目录不是 skill。 */
export const SKILL_FILE = 'SKILL.md';
/** BaoCut 自己记的来源（从哪个文件夹添加、从哪个 GitHub 地址与提交导入），放在 skill 目录里；点开头，不进文件清单，也不改用户的 `SKILL.md`。 */
export const SKILL_SOURCE_FILE = '.baocut-skill.json';

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
    };

/** 列表里的一个 skill。 */
export interface SkillSummary {
  id: string;
  /** front matter 的 `name`，原样。 */
  name: string;
  /** front matter 的 `description`，原样。 */
  description: string;
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
