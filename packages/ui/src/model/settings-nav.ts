import { live } from '@baocut/protocol';
import { M } from './settings-nav-copy.ts';

/**
 * 设置分节表（产品设计 §2.1、§7.6）：模型配置并入设置，按「偏好设置 / Agent / 模型 / 应用」分四组。
 * 模型保留独立的类型与内容路由，URL 统一放在 /settings/models 下。
 */

export const SETTINGS_SECTIONS = ['general', 'shortcuts', 'fonts', 'agent', 'skills', 'glossary', 'privacy', 'diagnostics', 'about'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const MODEL_CATEGORIES = ['asr', 'tts', 'llm', 'image', 'sep', 'vision'] as const;
export type ModelCategory = (typeof MODEL_CATEGORIES)[number];
export const MODEL_PAGES = ['local', 'cloud', 'voices'] as const;
export type ModelPage = (typeof MODEL_PAGES)[number];

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
  categoryInfo('asr', ['local', 'cloud']),
  categoryInfo('tts', ['local', 'cloud', 'voices']),
  categoryInfo('llm', ['cloud']),
  categoryInfo('image', ['local', 'cloud']),
  categoryInfo('sep', ['local']),
  categoryInfo('vision', ['local']),
];

export const MODEL_PAGE_LABEL: Record<ModelPage, string> = live(() => M.page);

/** 只有一页的类在页首说一句为什么。 */
export const ONLY_PAGE_NOTE: Partial<Record<ModelPage, string>> = live(() => M.onlyPage);

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
 * 模型组的条目是 MODEL_CATEGORIES，由设置页自己插在 `agents` 与 `app` 之间。
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
  group('preferences', ['general', 'shortcuts', 'fonts']),
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
