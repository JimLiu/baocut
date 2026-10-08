import { beforeEach, expect, it, vi } from 'vitest';
import { readV1Keys, selectV1Keys } from './legacy-upgrade-v1-keys.ts';
import { legacyKeychainRequest, readLegacyKeychainSecret } from './legacy-upgrade-keychain.ts';
vi.mock('./legacy-upgrade-keychain.ts', () => ({ legacyKeychainRequest: vi.fn(), readLegacyKeychainSecret: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); });
it('selects the active v1 label before service priority, with a stable fallback', () => {
  const make = (provider: string, label: string, service: string) => ({ provider, label, service, account: `${provider}:${label}` });
  const result = selectV1Keys(
    [
      make('gemini', 'personal', 'BaoCut'),
      make('gemini', 'work', 'VoiceInk'),
      make('openai', 'z', 'VoiceInk'),
      make('openai', 'z', 'BaoCut'),
      make('openai', 'a', 'BaoCut'),
    ],
    { 'vk-keyinuse-gemini': 'work' },
  );
  expect(result.get('gemini')).toMatchObject({ label: 'work', service: 'VoiceInk' });
  expect(result.get('openai')).toMatchObject({ label: 'a', service: 'BaoCut' });
});

it('reads only selected unmigrated v1 accounts through the silent helper and retains denied keys for retry', async () => {
  vi.mocked(legacyKeychainRequest).mockImplementation(async (request) => ({
    accounts: request.key === 'BaoCut' ? ['openai:personal', 'anthropic:work', 'gemini:personal'] : [],
  }));
  vi.mocked(readLegacyKeychainSecret).mockImplementation(async (_service, account) => {
    if (account === 'anthropic:work') throw new Error('secret-bearing-denial');
    return 'v1-fixture-secret';
  });
  const result = await readV1Keys([], new Set(['openai']));
  expect(result.secrets).toEqual({ gemini: { fields: { apiKey: 'v1-fixture-secret' } } });
  expect(result.pending).toEqual(['anthropic']);
  expect(readLegacyKeychainSecret).not.toHaveBeenCalledWith('BaoCut', 'openai:personal');
  expect(readLegacyKeychainSecret).toHaveBeenCalledWith('BaoCut', 'gemini:personal');
  expect(JSON.stringify(result)).not.toContain('secret-bearing-denial');
});
