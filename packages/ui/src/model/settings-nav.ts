import { live } from '@baocut/protocol';
import { M } from './settings-nav-copy.ts';

/**
 * 设置分节表（产品设计 §2.1、§7.6）：模型配置并入设置，按「偏好设置 / Agent / 模型 / 应用」分四组。
 * 「模型」组依次是 API 提供方、用量（两个普通分节，`/settings/providers`、`/settings/usage`），然后每种能力一页
 * （`/settings/models/<类>`，本机模型与 API 提供方的模型在同一页，不分本地 / 云端两个页签；语音合成另有「我的声音」）。
 */

export const SETTINGS_SECTIONS = [
  'general',
  'shortcuts',
  'fonts',
  'downloader',
  'semantic',
  'agent',
  'skills',
  'providers',
  'usage',
  'glossary',
  'privacy',
  'diagnostics',
  'about',
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** 「模型」组里排在能力页前面的两个分节。 */
export const MODEL_GROUP_SECTIONS = ['providers', 'usage'] as const satisfies readonly SettingsSection[];

export const MODEL_CATEGORIES = ['asr', 'tts', 'llm', 'image', 'music', 'sep', 'vision'] as const;
export type ModelCategory = (typeof MODEL_CATEGORIES)[number];
/** 能力页的页签：只有语音合成有两页（模型、我的声音）。 */
export const MODEL_PAGES = ['models', 'voices'] as const;
export type ModelPage = (typeof MODEL_PAGES)[number];
/** 旧的本地 / 云端页签（深链、Agent 回复里的设置链接）：都落到那一类的能力页。 */
export const LEGACY_MODEL_PAGES = ['local', 'cloud'] as const;

export interface ModelCategoryInfo {
  key: ModelCategory;
  label: string;
  description: string;
  /** 这一类有哪几页，按页签顺序。 */
  pages: readonly ModelPage[];
}

const categoryInfo = (key: ModelCategory, pages: readonly ModelPage[]): ModelCategoryInfo => ({
  key,
  get label() {
    return M.category[key].label;
  },
  get description() {
    return M.category[key].description;
  },
  pages,
});

export const MODEL_CATEGORY_INFO: readonly ModelCategoryInfo[] = [
  categoryInfo('asr', ['models']),
  categoryInfo('tts', ['models', 'voices']),
  categoryInfo('llm', ['models']),
  categoryInfo('image', ['models']),
  categoryInfo('music', ['models']),
  categoryInfo('sep', ['models']),
  categoryInfo('vision', ['models']),
];

export const MODEL_PAGE_LABEL: Record<ModelPage, string> = live(() => M.page);

/** 只有一种来源的类在页首说一句为什么：只有本机模型（`local`），或只有云端模型（`cloud`，文本生成）。 */
export const ONLY_SOURCE_NOTE: Record<'local' | 'cloud', string> = live(() => M.onlyPage);

export interface SettingsSectionInfo {
  key: SettingsSection;
  label: string;
}

export const SETTINGS_SECTION_INFO: readonly SettingsSectionInfo[] = SETTINGS_SECTIONS.map((key) => ({
  key,
  get label() {
    return M.section[key];
  },
}));

/**
 * 组 id 不能与条目 key 相同（S2 SideNav 的 section 与 item 共用一个 id 空间，撞名会抛 RangeError），所以 Agent 组叫 `agents`。
 * 模型组的条目是 MODEL_GROUP_SECTIONS 加 MODEL_CATEGORIES，由设置页自己插在 `agents` 与 `app` 之间。
 */
type SettingsGroupId = 'preferences' | 'agents' | 'app';
const group = (id: SettingsGroupId, keys: readonly SettingsSection[]) => ({
  id,
  get label() {
    return M.group[id];
  },
  keys,
});
export const SETTINGS_GROUPS: readonly { id: SettingsGroupId; label: string; keys: readonly SettingsSection[] }[] = [
  group('preferences', ['general', 'shortcuts', 'fonts', 'downloader', 'semantic']),
  group('agents', ['agent', 'skills']),
  group('app', ['glossary', 'privacy', 'diagnostics', 'about']),
];

/** 旧链接 `/settings/agent/<页>`（Agent & Skills 还分页签时的深链）现在的去处；认不出的页落到 Agent 提供方。 */
export function legacyAgentSection(page: string | undefined): SettingsSection {
  if (page === 'skills') return 'skills';
  if (page === 'permissions') return 'privacy';
  return 'agent';
}

export function modelCategory(key: ModelCategory): ModelCategoryInfo {
  return MODEL_CATEGORY_INFO.find((c) => c.key === key)!;
}

/** 某一类该停在哪一页：给的页属于这一类就用它，否则用上次停的页，再不行用第一页。 */
export function modelPageFor(category: ModelCategory, page?: ModelPage | null, last?: ModelPage | null): ModelPage {
  const { pages } = modelCategory(category);
  return [page, last].find((p): p is ModelPage => !!p && pages.includes(p)) ?? pages[0]!;
}

export function isSettingsSection(value: string | undefined): value is SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(value ?? '');
}

export function isModelCategory(value: string | undefined): value is ModelCategory {
  return (MODEL_CATEGORIES as readonly string[]).includes(value ?? '');
}

export function isModelPage(value: string | undefined): value is ModelPage {
  return (MODEL_PAGES as readonly string[]).includes(value ?? '');
}

export function isLegacyModelPage(value: string | undefined): boolean {
  return (LEGACY_MODEL_PAGES as readonly string[]).includes(value ?? '');
}
