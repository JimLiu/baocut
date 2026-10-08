import { defineMessages, live, RpcError, SKILL_LIMITS, type SkillOrigin, type SkillSource, type SkillSummary } from '@baocut/protocol';
import { zhHans } from './agent-skills.zh-Hans.ts';
import { zhHant } from './agent-skills.zh-Hant.ts';
import { ja } from './agent-skills.ja.ts';
import { ko } from './agent-skills.ko.ts';
import { es } from './agent-skills.es.ts';
import { fr } from './agent-skills.fr.ts';
import { de } from './agent-skills.de.ts';
import { nl } from './agent-skills.nl.ts';
import { ptBR } from './agent-skills.pt-BR.ts';
import { it } from './agent-skills.it.ts';
import { ru } from './agent-skills.ru.ts';
import { pl } from './agent-skills.pl.ts';
import { tr } from './agent-skills.tr.ts';
import { vi } from './agent-skills.vi.ts';

/** Skills 设置与错误的文案（英文是键与类型的来源，译文在 `agent-skills.zh-Hans.ts`）。 */
const en = {
  origin: { builtin: 'Built-in', personal: 'Mine', 'third-party': 'Third-party' } as Record<SkillOrigin, string>,
  all: 'All',
  commit: (sha: string) => ` (${sha})`,
  bytes: (n: number) => (n === 1 ? '1 byte' : `${n} bytes`),
  action: {
    load: 'load skills',
    toggle: 'switch it',
    add: 'add it',
    import: 'import it',
    remove: 'remove it',
    read: 'open the file',
    send: 'send',
  } as Record<SkillAction, string>,
  exists: (id: string | null) =>
    `A skill named “${id ?? 'this'}” already exists and won’t be overwritten. Remove the old one first, or rename the folder and add it again.`,
  invalid: (issue: string) => `This isn’t a usable skill: ${issue}. The root folder needs a SKILL.md that starts with name and description.`,
  tooLarge: (files: number, total: string, skillFile: string) =>
    `This skill is too large: a skill can have at most ${files} files totaling ${total}, and SKILL.md itself can be at most ${skillFile}.`,
  githubNotFound: 'Couldn’t find this repository, branch, or folder on GitHub (it may be private). Check the address.',
  folderNotFound: 'Couldn’t find this folder. It may have been moved or deleted.',
  urlInvalid: 'The address wasn’t recognized. Use owner/repo, or https://github.com/owner/repo/tree/branch/folder.',
  network: 'Can’t reach GitHub. Check your network and try again.',
  rateLimited: 'GitHub’s anonymous access limit has been reached for now. Try importing again later.',
  offline: 'Strict offline mode is on, so you can’t import from GitHub.',
  builtinNotRemovable: 'Built-in skills can’t be removed, but you can turn them off.',
  notFound: 'This skill is gone; it may have just been removed.',
  fileNotFound: 'This file is gone.',
  fileTooLarge: 'This file is too large to show here. You can open it in its folder.',
  fileNotText: 'This isn’t a text file, so it isn’t shown here.',
  webNotAllowed: 'This can’t be done in the browser. Use the BaoCut desktop app instead.',
  webReadOnly: 'This browser session is read-only, so nothing can be changed.',
  failed: (action: string, raw: string) => `Couldn’t ${action}: ${raw}`,
  sendFailed: (raw: string) => `Couldn’t send: ${raw}`,
};
export type AgentSkillsMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 内置 Agent 自己用的 skill（产品设计 §6.9，原型 model-agent-skills.js）：设置 › Skills 的搜索、按来源筛选与计数，
 * 输入框「+ › 使用 Skill」的条目，以及 `skills.*` 错误码换成的人话。名称、描述按原样，不假定语言。
 */

/** 筛选页签：全部，或一种来源。 */
export type SkillTab = 'all' | SkillOrigin;

export const SKILL_ORIGIN_LABEL: Readonly<Record<SkillOrigin, string>> = live(() => M.origin);

export const SKILL_TABS: readonly { key: SkillTab; label: string }[] = (['all', 'builtin', 'personal', 'third-party'] as const).map((key) => ({
  key,
  get label() {
    return key === 'all' ? M.all : M.origin[key];
  },
}));

const ORIGIN_ORDER: Readonly<Record<SkillOrigin, number>> = { builtin: 0, personal: 1, 'third-party': 2 };

/** `skills.list` 的顺序不是合同：按来源（内置、我的、第三方），再按名称排，名称相同按 id。 */
export function sortSkills(list: readonly SkillSummary[]): SkillSummary[] {
  return [...list].sort(
    (a, b) => ORIGIN_ORDER[a.origin] - ORIGIN_ORDER[b.origin] || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
}

/** 先按页签（来源）筛，再按名称、描述、id 搜（不分大小写）；顺序不变。 */
export function filterSkills(list: readonly SkillSummary[], query: string, tab: SkillTab): SkillSummary[] {
  const q = query.trim().toLocaleLowerCase();
  return list.filter(
    (s) => (tab === 'all' || s.origin === tab) && (!q || [s.name, s.description, s.id].some((v) => v.toLocaleLowerCase().includes(q))),
  );
}

/** 各页签的计数；给了搜索词就是搜索之后的计数。 */
export function countSkills(list: readonly SkillSummary[], query: string): Record<SkillTab, number> {
  const rows = filterSkills(list, query, 'all');
  return {
    all: rows.length,
    builtin: rows.filter((s) => s.origin === 'builtin').length,
    personal: rows.filter((s) => s.origin === 'personal').length,
    'third-party': rows.filter((s) => s.origin === 'third-party').length,
  };
}

/** 一行放得下的描述：折掉换行与连续空白，超过 `max` 个字符时截断加省略号（按码点截，不切坏表情或增补字符）。 */
export function clipLine(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : flat;
}

export interface SkillMenuItem {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

/** 输入框「+ › 使用 Skill」的条目：全部 skill，开着的在前，组内保持列表顺序；描述截成一行。 */
export function skillMenuItems(list: readonly SkillSummary[]): SkillMenuItem[] {
  const rows = list.map((s) => ({ id: s.id, name: s.name, description: clipLine(s.description), enabled: s.enabled }));
  return [...rows.filter((s) => s.enabled), ...rows.filter((s) => !s.enabled)];
}

/** 卡片底部的一行：来源 · 版本。 */
export function skillMetaLine(skill: Pick<SkillSummary, 'origin' | 'version'>): string {
  return [SKILL_ORIGIN_LABEL[skill.origin], skill.version ? `v${skill.version}` : null].filter(Boolean).join(' · ');
}

/** 详情里的来源：本地文件夹的路径，或 GitHub 地址@ref（提交取前 7 位）。内置与自己放进目录的为 null。 */
export function skillSourceLine(source: SkillSource | null): string | null {
  if (!source) return null;
  if (source.kind === 'local') return source.path;
  const commit = source.commit ? M.commit(source.commit.slice(0, 7)) : '';
  return `${source.url}@${source.ref}${commit}`;
}

/** `SKILL.md` 去掉开头的 front matter（名称、描述、版本已在详情顶上），只留正文。 */
export function skillBody(content: string): string {
  const text = content.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const match = /^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(text);
  return (match ? text.slice(match[0].length) : text).replace(/^\n+/, '');
}

/** 文件大小：字节、KB、MB。 */
export function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return M.bytes(bytes);
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export type SkillAction = 'load' | 'toggle' | 'add' | 'import' | 'remove' | 'read' | 'send';

const ACTION_LABEL: Readonly<Record<SkillAction, string>> = live(() => M.action);

/** `RpcError.details.code`（Runtime 的细分错误码）；没有时为 null。 */
export function skillErrorCode(error: unknown): string | null {
  if (!(error instanceof RpcError)) return null;
  const details = error.details;
  return details && typeof details === 'object' && typeof (details as { code?: unknown }).code === 'string'
    ? (details as { code: string }).code
    : null;
}

function detailsOf(error: unknown): Record<string, unknown> {
  const details = error instanceof RpcError ? error.details : null;
  return details && typeof details === 'object' ? (details as Record<string, unknown>) : {};
}

/**
 * `skills.*` 的错误 → 一句人话（产品设计 §6.9：超限、缺 SKILL.md、地址不对、网络或访问次数受限都如实说明）。
 * 认不出的错误码退回 Runtime 自己的说明。
 */
export function skillErrorMessage(error: unknown, action: SkillAction): string {
  const code = skillErrorCode(error);
  const details = detailsOf(error);
  const issues = Array.isArray(details.issues) ? details.issues.filter((i): i is string => typeof i === 'string') : [];
  const id = typeof details.skillId === 'string' ? details.skillId : null;
  const raw = error instanceof Error ? error.message : String(error);
  switch (code) {
    case 'SKILL_EXISTS':
      return M.exists(id);
    case 'SKILL_INVALID':
      return M.invalid(issues[0] ?? raw);
    case 'SKILL_TOO_LARGE':
      return M.tooLarge(SKILL_LIMITS.files, fileSizeLabel(SKILL_LIMITS.totalBytes), fileSizeLabel(SKILL_LIMITS.skillFileBytes));
    case 'SKILL_SOURCE_NOT_FOUND':
      return action === 'import' ? M.githubNotFound : M.folderNotFound;
    case 'SKILL_GITHUB_URL_INVALID':
      return M.urlInvalid;
    case 'SKILL_GITHUB_NETWORK':
      return M.network;
    case 'SKILL_GITHUB_RATE_LIMITED':
      return M.rateLimited;
    case 'OFFLINE_STRICT':
      return M.offline;
    case 'SKILL_BUILTIN_NOT_REMOVABLE':
      return M.builtinNotRemovable;
    case 'SKILL_NOT_FOUND':
      return M.notFound;
    case 'SKILL_FILE_NOT_FOUND':
      return M.fileNotFound;
    case 'SKILL_FILE_TOO_LARGE':
      return M.fileTooLarge;
    case 'SKILL_FILE_NOT_TEXT':
      return M.fileNotText;
    case 'WEB_METHOD_NOT_ALLOWED':
      return M.webNotAllowed;
    case 'WEB_READ_ONLY':
      return M.webReadOnly;
    default:
      return M.failed(ACTION_LABEL[action], raw);
  }
}

/** 发送失败的提示：点选的 skill 出了问题（例如刚被移除）时说 skill 的原因，其余照旧「没能发送：…」。 */
export function sendFailureMessage(error: unknown): string {
  return skillErrorCode(error)?.startsWith('SKILL_')
    ? skillErrorMessage(error, 'send')
    : M.sendFailed(error instanceof Error ? error.message : String(error));
}
