import { legacyKeychainRequest, readLegacyKeychainSecret } from './legacy-upgrade-keychain.ts';
import { readV1PreferenceValue, type LegacyObject } from './legacy-upgrade-sources.ts';

export interface V1Key {
  provider: string;
  label: string;
  service: string;
  account: string;
}
export async function legacyAccounts(service: 'BaoCut' | 'VoiceInk'): Promise<string[]> {
  return (await legacyKeychainRequest({ op: 'legacy-accounts', key: service }))?.accounts ?? [];
}

/** Same ordering as v1→v2: selected label, BaoCut service, stable label order. */
export function selectV1Keys(items: V1Key[], preferences: LegacyObject): Map<string, V1Key> {
  const selected = new Map<string, V1Key>();
  items.sort(
    (a, b) =>
      Number(b.label === preferences[`vk-keyinuse-${b.provider}`]) - Number(a.label === preferences[`vk-keyinuse-${a.provider}`]) ||
      Number(a.service !== 'BaoCut') - Number(b.service !== 'BaoCut') ||
      a.label.localeCompare(b.label, 'en'),
  );
  for (const item of items) if (!selected.has(item.provider)) selected.set(item.provider, item);
  return selected;
}

export async function readV1Keys(preferenceFiles: string[], exclude: Set<string>): Promise<{ secrets: LegacyObject; pending: string[] }> {
  const items: V1Key[] = [];
  const pending: string[] = [];
  for (const service of ['BaoCut', 'VoiceInk'] as const) {
    try {
      for (const account of await legacyAccounts(service)) {
        const split = account.indexOf(':');
        if (split <= 0) continue;
        const provider = account.slice(0, split);
        if (!/^[a-z0-9-]+$/.test(provider) || exclude.has(provider)) continue;
        items.push({ provider, label: account.slice(split + 1), account, service });
      }
    } catch {
      pending.push(service);
    }
  }
  const preferences: LegacyObject = {};
  for (const provider of new Set(items.map((item) => item.provider))) {
    const key = `vk-keyinuse-${provider}`;
    for (const file of preferenceFiles) {
      const value = await readV1PreferenceValue(file, key);
      if (value !== null) preferences[key] = value;
    }
  }
  const secrets: LegacyObject = {};
  for (const [provider, item] of selectV1Keys(items, preferences)) {
    try {
      const value = await readLegacyKeychainSecret(item.service, item.account);
      if (!value) throw new Error();
      secrets[provider] = { fields: { apiKey: value } };
    } catch {
      pending.push(provider);
    }
  }
  return { secrets, pending };
}
