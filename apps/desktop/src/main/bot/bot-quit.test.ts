import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setLocale } from '@baocut/protocol';
import { quitServiceConfirmed, quitServicePrompt, residentQuitChoice, residentQuitPrompt, workLines } from './bot-quit.ts';
import { botStatus } from './testing/fakes.ts';

beforeEach(() => {
  vi.stubEnv('BAOCUT_LOCALE', 'en');
  setLocale('en');
});

afterEach(() => {
  vi.unstubAllEnvs();
  setLocale('zh-Hans');
});

const status = botStatus({
  resident: true,
  workingThreads: [
    { workItemId: 'wi_1', channelId: 'c', title: 'Trim the intro' },
    { workItemId: 'wi_2', channelId: 'c', title: 'Translate subtitles' },
  ],
  nextSchedules: [{ scheduleId: 's_1', name: 'Weekly digest', nextAt: '2026-11-02T09:00:00.000Z' }],
});

it('resident quit: the Bot keeps working; Enter keeps it in the background, Esc cancels', () => {
  const options = residentQuitPrompt(status, 'darwin', 'UTC');
  expect(options).toMatchObject({
    message: 'The Bot keeps working in the background',
    buttons: ['Keep in Background', 'Quit Completely', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
  });
  expect(options.detail).toContain('menu bar');
  expect(residentQuitPrompt(null, 'win32').detail).toContain('notification area');
  expect([0, 1, 2, 7, -1].map(residentQuitChoice)).toEqual(['keep', 'quit', 'cancel', 'cancel', 'cancel']);
});

it('quit background service: lists working tasks and upcoming schedules; Cancel is the default', () => {
  const options = quitServicePrompt(status, 'UTC');
  expect(options).toMatchObject({ message: 'Quit the background service?', buttons: ['Quit Background Service', 'Cancel'], defaultId: 1, cancelId: 1 });
  expect(options.detail!.split('\n\n').slice(1)).toEqual([
    'These 2 working tasks will stop:\n• Trim the intro\n• Translate subtitles',
    'This scheduled task won’t run:\n• Weekly digest · Nov 2, 2026, 9:00 AM',
  ]);
  expect([0, 1, -1].map(quitServiceConfirmed)).toEqual([true, false, false]);
});

it('folds long lists and says nothing extra without work', () => {
  const many = botStatus({
    workingThreads: Array.from({ length: 7 }, (_, i) => ({ workItemId: `wi_${i}`, channelId: 'c', title: `Task ${i}` })),
  });
  const lines = workLines(many).trim().split('\n');
  expect(lines[0]).toBe('These 7 working tasks will stop:');
  expect(lines).toHaveLength(1 + 5 + 1);
  expect(lines.at(-1)).toBe('and 2 more');
  expect(workLines(botStatus())).toBe('');
  expect(workLines(null)).toBe('');
});

it('is translated', () => {
  vi.unstubAllEnvs();
  setLocale('zh-Hans');
  expect(residentQuitPrompt(null, 'darwin').buttons).toEqual(['保持后台', '彻底退出', '取消']);
  expect(quitServicePrompt(status, 'UTC').detail).toContain('这 2 个正在工作的任务会停下：');
});
