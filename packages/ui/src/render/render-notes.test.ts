import { describe, expect, it } from 'vitest';
import { formatRef } from '@baocut/protocol';
import { isSpeakerNote, missingFontFamily, renderNote } from './render-notes.ts';

const missingFont = {
  key: 'frameRender.itemNote',
  params: { item: 'title', note: { key: 'frameRender.missingFont', params: { family: 'Lobster', fallback: 'Noto Sans SC' } } },
};
// 元素内核的提示也带引用；没有引用的原话作为字符串参数嵌进来。
const kernel = { key: 'frameRender.itemNote', params: { item: 'viz', note: { key: 'timelineRender.spectrumNotInjected', params: { element: 'viz' } } } };
const forwarded = { key: 'frameRender.itemNote', params: { item: 'shape_1', note: 'kernel note' } };

describe('渲染内核的提示', () => {
  it('按引用认出实例与说明', () => {
    expect(renderNote(missingFont)).toEqual({ item: 'title', key: 'frameRender.missingFont', params: { family: 'Lobster', fallback: 'Noto Sans SC' } });
    expect(renderNote(forwarded)).toEqual({ item: 'shape_1', key: null, params: {} });
    expect(renderNote({ key: 'frameRender.layerUnsupported' })).toBeNull();
    expect(renderNote(undefined)).toBeNull();
    expect(missingFontFamily(missingFont)).toBe('Lobster');
    expect(missingFontFamily(forwarded)).toBeNull();
    expect(isSpeakerNote({ key: 'frameRender.itemNote', params: { item: 'viz', note: { key: 'frameRender.speakerNotInSequence', params: { speaker: 's' } } } })).toBe(true);
    expect(isSpeakerNote(missingFont)).toBe(false);
  });

  it('按读者的语言显示，转述的原话照嵌', () => {
    expect(formatRef(missingFont, '', 'en')).toBe('title: Font "Lobster" isn’t in the font library; using Noto Sans SC instead');
    expect(formatRef(missingFont, '', 'zh-Hans')).toBe('title：字体 "Lobster" 在当前字体库中不可用，将使用 Noto Sans SC 代替');
    expect(formatRef(kernel, '', 'zh-Hans')).toBe('viz：元素 viz 没有频谱轨，画了占位块');
    expect(formatRef(forwarded, '', 'en')).toBe('shape_1: kernel note');
  });
});
