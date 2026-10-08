import { spawn } from 'node:child_process';
import type { CredentialHelperCommand } from '@baocut/runtime-storage';
import { resolveCredentialHelperCommand } from './credentials.ts';

type LegacyKeychainRequest =
  | { op: 'legacy-accounts'; key: 'BaoCut' | 'VoiceInk' }
  | { op: 'legacy-read'; service: 'BaoCut' | 'VoiceInk' | 'bcut'; key: string };

/** Read-only background requests; the native helper disables macOS authorization dialogs. */
export async function legacyKeychainRequest(
  request: LegacyKeychainRequest,
  helper: CredentialHelperCommand | null = resolveCredentialHelperCommand(),
): Promise<{ secret?: string; accounts?: string[] } | null> {
  if (!helper) throw new Error('legacy-credential-unavailable');
  return new Promise((resolve, reject) => {
    const child = spawn(helper.command, helper.args ?? [], { stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    let settled = false;
    const finish = (value: { secret?: string; accounts?: string[] } | null, failed = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (failed) reject(new Error('legacy-credential-unavailable'));
      else resolve(value);
    };
    const timer = setTimeout(() => finish(null, true), 5000);
    child.once('error', () => finish(null, true));
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.length > 4 * 1024 * 1024) finish(null, true);
    });
    child.stdin.on('error', () => {});
    child.once('close', (code) => {
      try {
        const response = JSON.parse(output);
        if (code !== 0) throw new Error();
        if (!response.ok && response.error === 'not-found') {
          finish(null);
          return;
        }
        if (!response.ok) throw new Error();
        if (request.op === 'legacy-read') {
          if (typeof response.secret !== 'string' || !response.secret) throw new Error();
          finish({ secret: response.secret });
        } else {
          if (!Array.isArray(response.accounts) || response.accounts.some((account: unknown) => typeof account !== 'string')) throw new Error();
          finish({ accounts: response.accounts });
        }
      } catch {
        finish(null, true);
      }
    });
    child.stdin.end(JSON.stringify(request) + '\n');
  });
}

export async function readLegacyKeychainSecret(service: string, account: string): Promise<string | null> {
  if (!['BaoCut', 'VoiceInk', 'bcut'].includes(service)) throw new Error('legacy-credential-unavailable');
  const result = await legacyKeychainRequest({ op: 'legacy-read', service: service as 'BaoCut' | 'VoiceInk' | 'bcut', key: account });
  return result?.secret ?? null;
}
