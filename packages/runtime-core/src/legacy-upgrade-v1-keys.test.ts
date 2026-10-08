import { expect, it } from 'vitest';
import { selectV1Keys } from './legacy-upgrade-v1-keys.ts';
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
