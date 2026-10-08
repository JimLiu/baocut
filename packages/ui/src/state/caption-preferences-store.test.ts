import { beforeEach, expect, it, vi } from 'vitest';
import { asObject } from '../render/text-style.ts';
import { DEFAULT_CAPTION_STYLE } from '../model/property-values.ts';
import { withNewCaptionStyle } from '../model/caption-preferences.ts';
import { newCaptionStyle, useCaptionPreferences } from './caption-preferences-store.ts';
import type { EditOperation } from '@baocut/protocol';

vi.hoisted(() => {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  } });
});

beforeEach(() => useCaptionPreferences.setState({ preferences: {} }));

it('默认隐藏普通标点，重载后新字幕沿用修改过的属性而不是旧视频的其他属性', async () => {
  expect(asObject(newCaptionStyle().style).punct).toBe(true);
  const before = { ...asObject(DEFAULT_CAPTION_STYLE.style), width: 42, origStyle: { fontFamily: 'old-font' } };
  const after = { ...before, punct: false, y: 75, order: 'orig', gap: 12, displayTiming: { leadIn: 0.8, tail: 1.5 }, origStyle: { fontFamily: 'old-font', fontColor: '#FF0000' }, transStyle: { fontColor: '#00FF00' }, cues: { secret: true }, language: 'ja', documentId: 'old' };
  useCaptionPreferences.getState().remember(before, after);
  const saved = localStorage.getItem('baocut.captionPreferences')!;
  useCaptionPreferences.setState({ preferences: {} });
  localStorage.setItem('baocut.captionPreferences', saved);
  await useCaptionPreferences.persist.rehydrate();
  expect(newCaptionStyle().style).toMatchObject({ punct: false, y: 75, order: 'orig', gap: 12, displayTiming: { leadIn: 0.8, tail: 1.5 }, origStyle: { fontColor: '#FF0000' }, transStyle: { fontColor: '#00FF00' } });
  expect(asObject(newCaptionStyle().style)).not.toHaveProperty('width');
  expect(asObject(asObject(newCaptionStyle().style).origStyle)).not.toHaveProperty('fontFamily');
  expect(saved).not.toMatch(/secret|language|documentId|old-font/);
  useCaptionPreferences.getState().remember(after, { ...after, origStyle: {}, transStyle: {} });
  expect(asObject(newCaptionStyle().style)).not.toHaveProperty('origStyle');
  expect(asObject(newCaptionStyle().style)).not.toHaveProperty('transStyle');
});

it('新字幕与偏好同一笔事务保存；双语共用旧样式时保持视频原样', () => {
  const unstyled: EditOperation[] = [{ type: 'insertItems', sequenceId: 'seq', items: [{ type: 'caption', documentRef: 'caption', trackRef: 'track', span: { fromFrame: 0, durationFrames: 30 } }] }];
  const operations = withNewCaptionStyle(unstyled, newCaptionStyle());
  expect(operations[0]).toMatchObject({ type: 'putDocument', kind: 'caption-style', body: DEFAULT_CAPTION_STYLE });
  expect(operations[1]).toMatchObject({ items: [{ styleDocumentRef: 'caption-preferences-style' }] });
  const existing: EditOperation[] = [{ type: 'insertItems', sequenceId: 'seq', items: [{ type: 'caption', documentRef: 'caption', trackRef: 'track', styleDocumentId: 'existing-style', span: { fromFrame: 0, durationFrames: 30 } }] }];
  expect(withNewCaptionStyle(existing, newCaptionStyle())).toBe(existing);
  const fresh: EditOperation[] = [{ type: 'putDocument', ref: 'style', kind: 'caption-style', body: DEFAULT_CAPTION_STYLE }, ...existing];
  expect(withNewCaptionStyle(fresh, { ...DEFAULT_CAPTION_STYLE, style: { punct: false } })[0]).toMatchObject({ ref: 'style', body: { style: { punct: false } } });
});

it('损坏的持久化字段不带入字幕内容或非有限数值', async () => {
  localStorage.setItem('baocut.captionPreferences', JSON.stringify({ version: 1, state: { preferences: { y: 77, text: 'private', cues: {}, origStyle: { fontColor: '#FF0000', cues: 'private' }, dropShadow: { on: true, private: 'private' } } } }));
  await useCaptionPreferences.persist.rehydrate();
  expect(useCaptionPreferences.getState().preferences).toEqual({ y: 77, origStyle: { fontColor: '#FF0000' }, dropShadow: { on: true } });
});


it('单语原文的外观修改也单独记住，不染到下次的译文', () => {
  const before = asObject(DEFAULT_CAPTION_STYLE.style);
  useCaptionPreferences.getState().remember(before, { ...before, fontColor: '#FF0000', fontSize: 40 }, 'original');
  expect(newCaptionStyle().style).toMatchObject({ fontColor: '#FFFFFF', origStyle: { fontColor: '#FF0000', fontSize: 40 } });
  expect(asObject(newCaptionStyle().style)).not.toHaveProperty('transStyle');
});
