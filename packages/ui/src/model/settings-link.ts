import type { Route } from '../state/shell-store.ts';
import { S } from '../components/shell-copy.ts';
import {
  isLegacyModelPage,
  isModelCategory,
  isModelPage,
  isSettingsSection,
  modelCategory,
  MODEL_PAGE_LABEL,
  SETTINGS_SECTION_INFO,
} from './settings-nav.ts';

/**
 * Agent 回复中的设置深链（产品设计 §3.2.2）：严格识别，未知地址不能误跳到通用设置。旧的本地 / 云端页签
 * （`/settings/models/<类>/local|cloud`）落到那种能力的能力页。
 */
export function settingsLink(href: string): { route: Route; trail: string } | null {
  const match = /^\/settings\/([a-z]+)(?:\/([a-z]+)(?:\/([a-z]+))?)?\/?$/.exec(href);
  if (!match) return null;
  const [, section, category, legacyOrPage] = match;
  if (section === 'models') {
    if (!isModelCategory(category)) return null;
    const info = modelCategory(category);
    const page = isLegacyModelPage(legacyOrPage) ? undefined : legacyOrPage;
    if (page && (!isModelPage(page) || !info.pages.includes(page))) return null;
    // 只有一页的类不写页名；语音合成的两页都写（模型 / 我的声音）。
    const named = page && isModelPage(page) && info.pages.length > 1 ? page : null;
    const route: Route = page && isModelPage(page) ? { tab: 'models', category, page } : { tab: 'models', category };
    const trail = [S.common.settings, S.settingsPage.models, info.label, ...(named ? [MODEL_PAGE_LABEL[named]] : [])];
    return { route, trail: trail.join(' › ') };
  }
  if (!isSettingsSection(section) || category) return null;
  return {
    route: { tab: 'settings', section },
    trail: [S.common.settings, SETTINGS_SECTION_INFO.find((item) => item.key === section)!.label].join(' › '),
  };
}
