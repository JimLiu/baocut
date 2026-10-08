import type { SettingKey } from '@baocut/protocol';
import { localeOfTag } from '@baocut/protocol';
import { settingValueSchemas } from '@baocut/protocol/schemas';
import os from 'node:os';
import path from 'node:path';
import { SettingsStore } from '@baocut/runtime-storage';
import { legacyPath, type LegacyObject, type LegacySource } from './legacy-upgrade-sources.ts';

/** Only settings with the same meaning in v3 are adopted; target user values win. */
export async function importLegacySettings(
  store: SettingsStore,
  source: LegacySource,
  v1: LegacyObject = {},
  platform = process.platform,
  userHome = os.homedir(),
): Promise<string[]> {
  const { config: c, preferences: p } = source;
  const language = p.language ?? v1['vk-lang'];
  const patch: Partial<Record<SettingKey, unknown>> = {
    'models.dir': legacyPath(c['models.dir'] ?? v1['vk-models-dir'], source.root, undefined, platform),
    'downloads.directory': legacyDownloads(p['vk-url-savedir'] ?? c['download.dir'] ?? v1['vk-url-savedir'], source.root, platform, userHome),
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

/**
 * The old default (`~/Downloads`) is not a user choice: leave the setting empty so v3 follows the host's Downloads folder,
 * including a relocated Windows known folder.
 */
function legacyDownloads(value: unknown, root: string, platform: NodeJS.Platform, userHome: string): string | null {
  const resolved = legacyPath(value, root, userHome, platform);
  if (resolved === null) return null;
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const fallback = paths.join(userHome, 'Downloads');
  const same = platform === 'linux' ? resolved === fallback : resolved.toLowerCase() === fallback.toLowerCase();
  return same ? null : resolved;
}
