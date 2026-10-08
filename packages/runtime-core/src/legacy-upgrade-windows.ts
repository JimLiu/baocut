import { spawn } from 'node:child_process';
import type { CredentialHelperCommand } from '@baocut/runtime-storage';
import { resolveCredentialHelperCommand } from './credentials.ts';
import type { LegacyObject } from './legacy-upgrade-sources.ts';

/** v2 stored UTF-16 JSON in Credential Manager under <provider>.bcut. Read only. */
export async function readLegacyWindowsCredential(
  provider: string,
  helper: CredentialHelperCommand | null = resolveCredentialHelperCommand(),
): Promise<LegacyObject | null> {
  if (!helper || !/^[a-z0-9-]+$/i.test(provider)) throw new Error('legacy-credential-unavailable');
  return new Promise((resolve, reject) => {
    const child = spawn(helper.command, helper.args ?? [], { stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    let settled = false;
    const finish = (value: LegacyObject | null, failed = false) => {
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
      if (output.length > 1024 * 1024) finish(null, true);
    });
    child.stdin.on('error', () => {});
    child.once('exit', (code) => {
      try {
        const response = JSON.parse(output);
        if (code !== 0) throw new Error();
        if (!response.ok && response.error === 'not-found') {
          finish(null);
          return;
        }
        if (!response.ok || typeof response.secret !== 'string') throw new Error();
        const secret = JSON.parse(response.secret);
        if (!secret || typeof secret !== 'object' || !secret.fields || typeof secret.fields !== 'object') throw new Error();
        finish(secret);
      } catch {
        finish(null, true);
      }
    });
    child.stdin.end(JSON.stringify({ op: 'legacy-get', key: provider }) + '\n');
  });
}
