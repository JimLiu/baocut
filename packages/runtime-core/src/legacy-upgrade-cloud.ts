import { readLegacyWindowsCredential } from './legacy-upgrade-windows.ts';
import { readV1Keys } from './legacy-upgrade-v1-keys.ts';
import path from 'node:path';
import type { ModelServiceStore } from '@baocut/models';
import type { DeclaredModel, OnlineCapability } from '@baocut/protocol';
import { COMPAT_VENDOR_IDS } from '@baocut/providers';
import { readJson } from '@baocut/runtime-storage';
import { readLegacyKeychain, type LegacyObject, type LegacySource } from './legacy-upgrade-sources.ts';

const BUILTINS = new Set<string>(['openai', 'google', 'elevenlabs', 'anthropic', ...COMPAT_VENDOR_IDS]);
const CAPABILITIES: Record<string, OnlineCapability> = {
  stt: 'transcribe',
  tts: 'synthesizeSpeech',
  llm: 'generateText',
  image: 'generateImage',
};
const mappedId = (id: string) =>
  id === 'gemini' ? 'google' : id === 'dashscope' ? 'qwen' : id === 'doubao' ? 'volcengine' : BUILTINS.has(id) ? id : `custom:${id}`;

export interface CloudImportResult {
  done: string[];
  pending: string[];
  unsupported: string[];
}

/** No provider requests, verification calls or key deletion during upgrade. */
export async function importLegacyCloud(
  source: LegacySource,
  store: ModelServiceStore,
  completed: string[],
  checkpoint: (id: string) => Promise<void>,
  options: {
    platform?: string;
    keychain?: typeof readLegacyKeychain;
    windowsCredential?: typeof readLegacyWindowsCredential;
    allowKeychain?: boolean;
    defaultsFile?: string;
  } = {},
): Promise<CloudImportResult> {
  const result: CloudImportResult = { done: [], pending: [], unsupported: [] };
  const file = (await readJson<LegacyObject>(path.join(source.root, 'secrets.json'))) ?? {};
  const debug = (await readJson<LegacyObject>(path.join(source.root, 'secrets.debug.json'))) ?? {};
  const masks = (await readJson<LegacyObject>(path.join(source.root, 'key-masks.json'))) ?? {};
  const readKeychain = options.keychain ?? readLegacyKeychain;
  let vault: LegacyObject = {};
  // Decide what still needs a secret before opening the shared vault. Remote tokens belong to node migration.
  const needsCredential = (id: string) =>
    /^[a-z0-9-]+$/.test(id) && !id.startsWith('remote-') && !completed.includes(id) && !store.provider(mappedId(id)) && !file[id];
  const maskedPending = Object.keys(masks.keys ?? {}).filter(needsCredential);
  if ((options.platform ?? process.platform) === 'darwin' && options.allowKeychain !== false && maskedPending.length) {
    try {
      vault = (await readKeychain('BaoCut', '__provider-vault-v1'))?.providers ?? {};
    } catch {
      // Individual entries may still be readable. Only unresolved providers remain pending below.
    }
  }
  const v1 =
    source.v1PreferenceFiles?.length && options.allowKeychain !== false && (options.platform ?? process.platform) === 'darwin'
      ? await readV1Keys(
          source.v1PreferenceFiles,
          new Set([
            ...completed,
            ...store.providerIds(),
            ...(store.provider('google') ? ['gemini'] : []),
            ...(store.provider('qwen') ? ['dashscope'] : []),
            ...(store.provider('volcengine') ? ['doubao'] : []),
            ...Object.keys(file),
            ...Object.keys(debug),
            ...Object.keys(vault),
          ]),
        )
      : { secrets: {}, pending: [] };
  result.pending.push(...v1.pending.map((id) => `v1:${id}`));
  const providers: LegacyObject[] = source.cloud.providers ?? [];
  const ids = new Set([
    ...providers.map((p) => p.id),
    ...Object.keys(file),
    ...Object.keys(debug),
    ...Object.keys(masks.keys ?? {}),
    ...Object.keys(vault),
    ...Object.keys(v1.secrets),
  ]);
  for (const id of ids) {
    if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id) || id.startsWith('remote-')) continue;
    if (completed.includes(id)) continue;
    const targetId = mappedId(id);
    // A crash after saving the provider but before its marker must not replace its account.
    if (store.provider(targetId)) {
      await checkpoint(id);
      result.done.push(id);
      continue;
    }
    try {
      let secret = vault[id] ?? file[id] ?? (masks.keys?.[id] ? undefined : debug[id]) ?? v1.secrets[id];
      if (!secret && masks.keys?.[id]) {
        if (options.allowKeychain === false) throw new Error('credential-unavailable');
        if ((options.platform ?? process.platform) === 'win32') {
          secret = await (options.windowsCredential ?? readLegacyWindowsCredential)(id);
        } else if ((options.platform ?? process.platform) === 'darwin') {
          secret = (await readKeychain('BaoCut', id)) ?? (await readKeychain('bcut', id));
        } else throw new Error('credential-unavailable');
        if (!secret) throw new Error('credential-unavailable');
      }
      const credential = secret?.fields?.apiKey ?? secret?.fields?.token;
      if (secret && typeof credential !== 'string') {
        result.unsupported.push(id);
        continue;
      }
      const provider = providers.find((p) => p.id === id);
      const sdk = source.config[`llm.providers.${id}.sdk`] ?? provider?.sdk;
      if (!BUILTINS.has(targetId) && sdk && !['openai', 'OpenAiCompatible'].includes(sdk)) {
        result.unsupported.push(id);
        continue;
      }
      const endpoint =
        source.config[`llm.providers.${id}.baseUrl`] ??
        (id === 'minimax' && source.cloud.providerPrefs?.[id]?.region === 'cn' ? 'https://api.minimaxi.com/v1' : undefined);
      if (endpoint !== undefined) {
        const url = new URL(endpoint);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid-endpoint');
      }
      if (!BUILTINS.has(targetId) && !endpoint) {
        result.unsupported.push(id);
        continue;
      }
      const models: DeclaredModel[] = (provider?.models ?? []).flatMap((m: LegacyObject) =>
        CAPABILITIES[m.kind] && typeof m.id === 'string'
          ? [{ modelId: m.id, label: m.name || m.id, capability: CAPABILITIES[m.kind] }]
          : [],
      );
      if (store.provider(targetId)) {
        await checkpoint(id);
        result.done.push(id);
        continue;
      }
      await store.updateProvider(targetId, {
        enabled: typeof credential === 'string' && credential.length > 0,
        ...(credential ? { credential } : {}),
        ...(endpoint ? { endpoint } : {}),
        ...(provider?.name ? { label: provider.name } : {}),
        ...(!BUILTINS.has(targetId) ? { models } : {}),
      });
      await checkpoint(id);
      result.done.push(id);
    } catch {
      result.pending.push(id);
    }
  }
  const explicitDefaults = options.defaultsFile
    ? ((await readJson<{ defaults?: LegacyObject }>(options.defaultsFile))?.defaults ?? {})
    : {};
  const defaults: [OnlineCapability, unknown][] = [
    ['transcribe', source.cloud.sttDefault],
    ['synthesizeSpeech', source.cloud.ttsDefault],
    ['generateImage', source.cloud.imageDefault],
    ['generateText', source.config['llm.default']],
  ];
  for (const [capability, value] of defaults) {
    if (Object.hasOwn(explicitDefaults, capability) || store.getDefault(capability) || typeof value !== 'string') continue;
    const match = /^(?:(?:cloud|provider):)?([^/:]+)\/(.+)$/.exec(value);
    if (!match) continue;
    const providerId = mappedId(match[1]!);
    if (store.provider(providerId)) await store.setDefault(capability, { providerId, modelId: match[2]!.split(/[·→\s]/)[0]! });
  }
  return result;
}
