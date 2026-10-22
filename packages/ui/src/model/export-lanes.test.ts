import { describe, expect, it } from 'vitest';
import { audioItem, captionItem, documentRecord, sequence, track, videoItem } from '../testing/sequence-records.ts';
import { exportLanes, laneOn, soundLanes } from './export-lanes.ts';

const docs = { d1: documentRecord('d1', 'caption', '访谈字幕', { language: 'zh' }) };

describe('导出清单（只读，跟着时间轴）', () => {
  it('字幕在上、画面、音频在下；带声音的画面轨也算一条声音', () => {
    const seq = sequence(
      [track('v', 'visual', 0), track('a', 'audio', 0), track('s', 'subtitle', 0)],
      [videoItem('i1', 'v', 0, 300), videoItem('i2', 'v', 300, 300), audioItem('m', 'a', 0, 10), captionItem('c', 's', 'd1')],
    );
    const lanes = exportLanes(seq, docs);
    expect(lanes.map((l) => [l.kind, l.sub, l.picture, l.sound, l.reason])).toEqual([
      ['subtitle', '访谈字幕', true, null, null],
      ['visual', '2 个片段', true, true, null],
      ['audio', '1 段声音', null, true, null],
    ]);
    expect(soundLanes(lanes).map((l) => l.kind)).toEqual(['visual', 'audio']);
  });

  it('隐藏只关画面、静音只关声音；独显 / 独听让别的轨关掉', () => {
    const seq = sequence(
      [
        track('v1', 'visual', 0, { muted: true }),
        track('v2', 'visual', 1, { solo: { enabled: true, group: 'visual' } }),
        track('a', 'audio', 0, { muted: true }),
        track('s', 'subtitle', 0, { visible: false }),
      ],
      [
        videoItem('i1', 'v1', 0, 300),
        videoItem('i2', 'v2', 0, 300, { embeddedAudio: { enabled: false, volume: 1 } }),
        audioItem('m', 'a', 0, 10),
        captionItem('c', 's', 'd1'),
      ],
    );
    const byTrack = Object.fromEntries(exportLanes(seq, docs).map((l) => [l.trackId, l]));
    expect(byTrack.v1).toMatchObject({ picture: false, sound: false, reason: '别的轨在独显' });
    expect(byTrack.v2).toMatchObject({ picture: true, sound: null, reason: null });
    expect(byTrack.a).toMatchObject({ sound: false, reason: '时间轴上静音' });
    expect(byTrack.s).toMatchObject({ key: 'group:original:zh', picture: false, reason: '时间轴上隐藏' });
    expect(laneOn(byTrack.a!)).toBe(false);
  });

  it('画面在、声音被静音：理由写声音那一半', () => {
    const seq = sequence([track('v', 'visual', 0, { muted: true })], [videoItem('i1', 'v', 0, 300)]);
    expect(exportLanes(seq, {})[0]).toMatchObject({ picture: true, sound: false, reason: '声音：时间轴上静音' });
  });

  it('字幕按层列、与轨条同名：同一层字幕散在几条轨上（纪录片每段一条轨）并成一行，排在时间轴上最靠上的那条轨的位置；整层都停用才算关', () => {
    const layered = {
      a: documentRecord('a', 'caption', '片段 A', { language: 'en' }),
      b: documentRecord('b', 'caption', '片段 B', { language: 'en' }),
      aZh: documentRecord('aZh', 'caption', '片段 A 中文', { language: 'zh' }),
      bZh: documentRecord('bZh', 'caption', '片段 B 中文', { language: 'zh' }),
      solo: documentRecord('solo', 'caption', '片尾字幕', { language: 'ja' }),
    };
    const seq = sequence(
      [
        track('s1', 'subtitle', 1),
        track('s2', 'subtitle', 2, { visible: false }),
        track('s3', 'subtitle', 3, { visible: false }),
        track('s4', 'subtitle', 4, { visible: false }),
        track('s5', 'subtitle', 5),
        track('v', 'visual', 0),
      ],
      [
        captionItem('ca', 's1', 'a', 0),
        captionItem('cb', 's2', 'b', 300),
        captionItem('caz', 's3', 'aZh', 0),
        captionItem('cbz', 's4', 'bZh', 300),
        captionItem('cs', 's5', 'solo', 600),
        videoItem('i1', 'v', 0, 900),
      ],
    );
    const lanes = exportLanes(seq, layered);
    expect(lanes.filter((l) => l.kind === 'subtitle').map((l) => [l.key, l.trackId, l.sub, l.picture, l.reason])).toEqual([
      ['group:original:ja', 's5', '片尾字幕', true, null],
      ['group:original:zh', 's4', '2 段', false, '时间轴上隐藏'],
      ['group:original:en', 's2', '2 段', true, null],
    ]);
    expect(lanes.filter((l) => l.kind === 'subtitle').map((l) => l.label)).toEqual(['原文（日本語）', '原文（中文）', '原文（English）']);
    expect(new Set(lanes.map((l) => l.key)).size).toBe(lanes.length);
  });

  it('一条轨上同一层的几份文档也是一行，写段数', () => {
    const layered = {
      a: documentRecord('a', 'caption', '旁白 1', { language: 'zh' }),
      b: documentRecord('b', 'caption', '旁白 2', { language: 'zh' }),
    };
    const seq = sequence([track('s', 'subtitle', 1)], [captionItem('ca', 's', 'a', 0), captionItem('cb', 's', 'b', 300)]);
    expect(exportLanes(seq, layered).map((l) => [l.key, l.label, l.sub])).toEqual([['group:original:zh', '原文', '2 段']]);
  });

  it('字幕找不到文档时按轨列', () => {
    const seq = sequence([track('s', 'subtitle', 1)], [captionItem('c', 's', 'gone')]);
    expect(exportLanes(seq, {}).map((l) => [l.key, l.sub])).toEqual([['s', '字幕']]);
  });

  it('没有启用实例的轨道不列', () => {
    const seq = sequence([track('v', 'visual', 0), track('a', 'audio', 0)], [videoItem('i1', 'v', 0, 300, { enabled: false })]);
    expect(exportLanes(seq, {})).toEqual([]);
  });
});
