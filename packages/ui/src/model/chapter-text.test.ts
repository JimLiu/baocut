import { describe, expect, it } from 'vitest';
import type { Marker } from '@baocut/protocol';
import { animationWithoutFixedText, chapterReading, chapterTextAt, chapterTitleLayer, hasChapters } from './chapter-text.ts';

const mark = (id: string, frame: number, label: string, extra: Partial<Marker> = {}): Marker => ({
  id,
  frame,
  label,
  kind: 'chapter',
  ...extra,
});

describe('章节文字（与引擎 marker.rs 同一套判据）', () => {
  it('每一帧画所在那一章：第一章之前不画，最后一章开到终点，别的标记不算章', () => {
    const markers = [mark('c2', 300, 'Second'), mark('n', 10, 'note', { kind: 'note' }), mark('c1', 30, 'First', { summary: 'Opening.' })];
    const title = { field: 'title' } as const;
    expect(chapterTextAt(markers, 0, title)).toBeNull();
    expect(chapterTextAt(markers, 29, title)).toBeNull();
    expect(chapterTextAt(markers, 30, title)).toBe('First');
    expect(chapterTextAt(markers, 299, title)).toBe('First');
    expect(chapterTextAt(markers, 300, title)).toBe('Second');
    expect(chapterTextAt(markers, 1_000_000, title)).toBe('Second');
    expect(chapterTextAt(markers, 40, { field: 'summary' })).toBe('Opening.');
    expect(chapterTextAt(markers, 400, { field: 'summary' })).toBeNull();
    expect(chapterTextAt(markers, 400, { field: 'number', numberFormat: '1/N' })).toBe('2/2');
    expect(chapterTextAt(markers, 400, { field: 'number', numberFormat: '01' })).toBe('02');
    expect(chapterTextAt(markers, 400, { field: 'number' })).toBe('2');
    expect(chapterTextAt([], 0, { field: 'number' })).toBeNull();
    expect(chapterTextAt([mark('c', 0, '  ')], 5, title)).toBeNull();
  });

  it('自带长度的章留出空档，几章重叠时取开始得晚的', () => {
    const title = { field: 'title' } as const;
    const gap = [mark('c1', 0, 'First', { durationFrames: 100 }), mark('c2', 200, 'Second')];
    expect(chapterTextAt(gap, 99, title)).toBe('First');
    expect(chapterTextAt(gap, 100, title)).toBeNull();
    const overlap = [mark('c1', 0, 'First', { durationFrames: 500 }), mark('c2', 200, 'Second')];
    expect(chapterTextAt(overlap, 250, title)).toBe('Second');
  });

  it('读数：此刻画什么、在哪一帧换、换成下一章还是空档或片尾', () => {
    const title = { field: 'title' } as const;
    const markers = [mark('a', 0, 'Intro'), mark('b', 300, 'Talk'), mark('c', 600, 'End', { summary: '' })];
    expect(chapterReading(markers, 10, title, 900)).toMatchObject({ kind: 'shown', text: 'Intro', changeFrame: 300, then: 'next' });
    expect(chapterReading(markers, 700, title, 900)).toMatchObject({ kind: 'shown', text: 'End', changeFrame: 900, then: 'last' });
    expect(chapterReading(markers, 700, { field: 'summary' }, 900)).toMatchObject({ kind: 'blank', range: { index: 2, count: 3 } });
    const gap = [mark('a', 0, 'Intro', { durationFrames: 100 }), mark('b', 300, 'Talk')];
    expect(chapterReading(gap, 50, title, 900)).toMatchObject({ changeFrame: 100, then: 'gap' });
    expect(chapterReading(gap, 150, title, 900)).toEqual({ kind: 'noChapter' });
    const overlap = [mark('a', 0, 'Intro', { durationFrames: 500 }), mark('b', 200, 'Talk')];
    expect(chapterReading(overlap, 50, title, 900)).toMatchObject({ text: 'Intro', changeFrame: 200, then: 'next' });
    expect(chapterReading([mark('a', 0, 'Intro', { durationFrames: 5000 })], 50, title, 900)).toMatchObject({ changeFrame: 900, then: 'last' });
  });

  it('切到章节前去掉打字机与逐词升起，循环照旧', () => {
    const fade = { preset: 'fade' };
    expect(animationWithoutFixedText(undefined)).toBeUndefined();
    expect(animationWithoutFixedText({ enter: fade })).toBeUndefined();
    expect(animationWithoutFixedText({ enter: { preset: 'typewriter' } })).toBeNull();
    expect(animationWithoutFixedText({ enter: { preset: 'typewriter' }, loop: { preset: 'pulse' } })).toEqual({ loop: { preset: 'pulse' } });
    expect(animationWithoutFixedText({ enter: fade, exit: { preset: 'riseWords' } })).toEqual({ enter: fade });
  });

  it('「添加章节标题」那一层绑章节标题、不写字；有章节才可用', () => {
    const layer = chapterTitleLayer();
    expect(layer).toMatchObject({ type: 'text', chapter: { field: 'title' }, verticalAlign: 'top' });
    expect('text' in layer).toBe(false);
    expect(hasChapters({ markers: [mark('n', 0, 'note', { kind: 'note' })] })).toBe(false);
    expect(hasChapters({ markers: [mark('c', 0, 'Intro')] })).toBe(true);
  });
});
