import { beforeEach, expect, it, vi } from 'vitest';
import { COPY_DEFAULTS } from '../model/transcript-copy-options.ts';
import { copyPrefsOf, useTranscriptCopyPrefs } from './transcript-copy-prefs-store.ts';

vi.hoisted(() => {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  } });
});

const KEY = 'baocut.transcript-copy';

beforeEach(async () => {
  // setState 也会写进存储：清掉再重载，回到没存过的样子。
  useTranscriptCopyPrefs.setState({ ...COPY_DEFAULTS });
  localStorage.removeItem(KEY);
  await useTranscriptCopyPrefs.persist.rehydrate();
});

it('没存过时是 Markdown、五个开关全开', () => {
  expect(copyPrefsOf(useTranscriptCopyPrefs.getState())).toEqual(COPY_DEFAULTS);
});

it('记住上一次选的格式与勾选，重新打开还是这一组', async () => {
  useTranscriptCopyPrefs.getState().set({ format: 'txt' });
  useTranscriptCopyPrefs.getState().set({ frontmatter: false, speakers: false });
  const saved = localStorage.getItem(KEY)!;
  expect(saved).not.toMatch(/"set"/);
  useTranscriptCopyPrefs.setState({ ...COPY_DEFAULTS });
  localStorage.setItem(KEY, saved);
  await useTranscriptCopyPrefs.persist.rehydrate();
  expect(copyPrefsOf(useTranscriptCopyPrefs.getState())).toEqual({ ...COPY_DEFAULTS, format: 'txt', frontmatter: false, speakers: false });
});
