import { afterEach, expect, it, vi } from 'vitest';
import { setLocale } from '@baocut/protocol';
import { quitChoice, quitPrompt, relaunchPrompt, restartChoice } from './quit-prompt.ts';
import type { RemoteCall } from './runtime-supervisor.ts';

afterEach(() => {
  vi.unstubAllEnvs();
  setLocale('zh-Hans');
});

function english() {
  vi.stubEnv('BAOCUT_LOCALE', 'en');
  setLocale('en');
}

it('does not ask when its own Runtime has nothing running or cannot be asked', () => {
  expect(quitPrompt(null)).toBeNull();
  expect(quitPrompt({ jobs: 0, tasks: 0, remote: [] })).toBeNull();
});

it('asks with running jobs and tasks counted together; Enter keeps them running, Esc cancels', () => {
  english();
  const options = quitPrompt({ jobs: 1, tasks: 2, remote: [] })!;
  expect(options).toMatchObject({
    message: '3 tasks are still running',
    buttons: ['Keep Running in Background', 'Stop and Quit', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
  });
  expect(options.detail).not.toContain('billed');
  expect(quitPrompt({ jobs: 0, tasks: 1, remote: [] })!.message).toBe('1 task is still running');
  expect([0, 1, 2, 3, -1].map(quitChoice)).toEqual(['background', 'stop', 'cancel', 'cancel', 'cancel']);
});

it('lists calls already sent to a provider by step, task kind, or as an Agent task, and folds the rest', () => {
  english();
  const remote: RemoteCall[] = [
    { kind: 'pipeline-step', provider: 'Codex', step: { label: 'Translate subtitles' } },
    { kind: 'transcribe', provider: 'OpenAI' },
    { kind: null, provider: 'Claude' },
    { kind: 'export', provider: 'Google' },
    { kind: 'generateImage', provider: 'Google' },
    { kind: 'synthesizeSpeech', provider: 'ElevenLabs' },
    { kind: 'voiceClone', provider: 'ElevenLabs' },
  ];
  const detail = quitPrompt({ jobs: 3, tasks: 1, remote })!.detail!;
  expect(detail.split('\n\n')[1]!.split('\n')).toEqual([
    'Already sent out. Stopping won’t cancel these at the provider, and they may still be billed:',
    '• Translate subtitles · Codex',
    '• Transcribe · OpenAI',
    '• Agent task · Claude',
    '• Task · Google',
    '• Generate image · Google',
    'and 2 more',
  ]);
});

it('restarting for a new permission offers only stop-and-restart or cancel, and never asks with nothing running', () => {
  english();
  expect(relaunchPrompt(null)).toBeNull();
  expect(relaunchPrompt({ jobs: 0, tasks: 0, remote: [] })).toBeNull();
  const options = relaunchPrompt({ jobs: 1, tasks: 0, remote: [] })!;
  expect(options).toMatchObject({ message: '1 task is still running', buttons: ['Stop and Restart', 'Cancel'], defaultId: 0, cancelId: 1 });
  expect(options.detail).toContain('new permission');
  expect(restartChoice(0)).toBe('restart');
  expect(restartChoice(1)).toBe('cancel');
  expect(restartChoice(9)).toBe('cancel');
});
