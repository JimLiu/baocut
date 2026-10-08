import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveCredentialHelperCommand } from './credentials.ts';
import { readV1PreferenceValue, type LegacyObject } from './legacy-upgrade-sources.ts';
const execute = promisify(execFile);

export interface V1Key {
  provider: string;
  label: string;
  service: string;
  account: string;
}
export async function legacyAccounts(service: 'BaoCut' | 'VoiceInk'): Promise<string[]> {
  const helper = resolveCredentialHelperCommand();
  if (!helper) throw new Error('legacy-account-helper-unavailable');
  return new Promise((resolve, reject) => {
    const child = spawn(helper.command, helper.args ?? [], { stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    const fail = () => {
      child.kill('SIGKILL');
      reject(new Error('legacy-account-discovery-unavailable'));
    };
    const timer = setTimeout(fail, 5000);
    child.once('error', () => {
      clearTimeout(timer);
      fail();
    });
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.length > 1024 * 1024) fail();
    });
    child.stdin.on('error', () => {});
    child.once('exit', (code) => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(output);
        if (code !== 0 || !result.ok || !Array.isArray(result.accounts) || result.accounts.some((s: unknown) => typeof s !== 'string'))
          throw new Error();
        resolve(result.accounts);
      } catch {
        reject(new Error('legacy-account-discovery-unavailable'));
      }
    });
    child.stdin.end(JSON.stringify({ op: 'legacy-accounts', key: service }) + '\n');
  });
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
      const { stdout } = await execute('/usr/bin/security', ['find-generic-password', '-s', item.service, '-a', item.account, '-w'], {
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      });
      const value = stdout.trimEnd();
      if (!value) throw new Error();
      secrets[provider] = { fields: { apiKey: value } };
    } catch {
      pending.push(provider);
    }
  }
  return { secrets, pending };
}
