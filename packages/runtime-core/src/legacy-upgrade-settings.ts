import type { SettingKey } from '@baocut/protocol';
import { localeOfTag } from '@baocut/protocol';
import { settingValueSchemas } from '@baocut/protocol/schemas';
import { SettingsStore } from '@baocut/runtime-storage';
import { legacyPath, type LegacyObject, type LegacySource } from './legacy-upgrade-sources.ts';

/** Only settings with the same meaning in v3 are adopted; target user values win. */
export async function importLegacySettings(
  store: SettingsStore,
  source: LegacySource,
  v1: LegacyObject = {},
  platform = process.platform,
): Promise<string[]> {
  const { config: c, preferences: p } = source;
  const language = p.language ?? v1['vk-lang'];
  const patch: Partial<Record<SettingKey, unknown>> = {
    'models.dir': legacyPath(c['models.dir'] ?? v1['vk-models-dir'], source.root, undefined, platform),
    'downloads.directory': legacyPath(p['vk-url-savedir'] ?? c['download.dir'] ?? v1['vk-url-savedir'], source.root, undefined, platform),
    'ui.language': language === 'system' ? 'system' : localeOfTag(typeof language === 'string' ? language : undefined),
    'updates.autoDownload': p.appAutoUpdate,
    'agent.defaultDriver': p.agentChatDefaults?.provider,
    'agent.defaultModel': p.agentChatDefaults?.model,
    'agent.defaultEffort': p.agentChatDefaults?.effort,
    'agent.defaultAccessMode': p.agentLastMode,
  };
  // The old endpoint is an enum, not a URL. Only HF has identical semantics.
  const endpoint = c['models.endpoint'] ?? (v1['vk-download-source'] === 'custom' ? v1['vk-custom-mirror'] : v1['vk-download-source']);
  if (endpoint === 'hf' || endpoint === 'huggingface') patch['models.downloadEndpoint'] = 'https://huggingface.co';
  else if (typeof endpoint === 'string' && /^https?:\/\//.test(endpoint)) patch['models.downloadEndpoint'] = endpoint;
  const accepted: Partial<Record<SettingKey, unknown>> = {};
  for (const [key, value] of Object.entries(patch) as [SettingKey, unknown][]) {
    if (value == null || store.snapshot([key]).sources[key] === 'user') continue;
    const parsed = settingValueSchemas[key].safeParse(value);
    if (parsed.success) accepted[key] = parsed.data;
  }
  await store.set(accepted);
  return Object.keys(accepted);
}
