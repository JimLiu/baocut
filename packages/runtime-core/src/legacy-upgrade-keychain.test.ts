import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { legacyKeychainRequest } from './legacy-upgrade-keychain.ts';

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-legacy-keychain-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

it('uses the native silent-read protocol and keeps secret-bearing failures out of errors', async () => {
  const file = path.join(dir, 'helper.cjs');
  await fs.writeFile(file, `process.stdin.once('data', input => {
    const request = JSON.parse(input);
    if (request.op !== 'legacy-read' || request.service !== 'BaoCut' || request.key !== '__provider-vault-v1') process.exit(2);
    process.stdout.write(process.argv[2]);
  });`);
  const run = (response: unknown) => legacyKeychainRequest(
    { op: 'legacy-read', service: 'BaoCut', key: '__provider-vault-v1' },
    { command: process.execPath, args: [file, JSON.stringify(response)] },
  );
  expect(await run({ ok: true, secret: 'fixture-secret' })).toEqual({ secret: 'fixture-secret' });
  expect(await run({ ok: false, error: 'not-found' })).toBeNull();
  for (const response of [
    { ok: false, error: 'denied', message: 'fixture-secret' },
    { ok: true, secret: { value: 'fixture-secret' } },
  ]) await expect(run(response)).rejects.toThrow(/^legacy-credential-unavailable$/);
  await expect(legacyKeychainRequest({ op: 'legacy-accounts', key: 'BaoCut' }, null)).rejects.toThrow('legacy-credential-unavailable');
});

it('validates account-only discovery responses', async () => {
  const file = path.join(dir, 'helper.cjs');
  await fs.writeFile(file, `process.stdin.once('data', input => {
    const request = JSON.parse(input);
    if (request.op !== 'legacy-accounts' || request.key !== 'VoiceInk') process.exit(2);
    process.stdout.write(process.argv[2]);
  });`);
  const run = (accounts: unknown) => legacyKeychainRequest(
    { op: 'legacy-accounts', key: 'VoiceInk' },
    { command: process.execPath, args: [file, JSON.stringify({ ok: true, accounts })] },
  );
  expect(await run(['openai:personal'])).toEqual({ accounts: ['openai:personal'] });
  await expect(run(['openai:personal', 1])).rejects.toThrow('legacy-credential-unavailable');
});
