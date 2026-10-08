import { describe, expect, it } from 'vitest';
import type { SpaceEntry } from '@baocut/protocol';
import { entriesOfJob, followUps, handoverText, newMovieBlock, outputDetail, outputsDir } from './tool-outputs.ts';

const entry = (id: string, patch: Partial<SpaceEntry> = {}, trashedAt: string | null = null): SpaceEntry => ({
  id,
  kind: 'subtitle',
  name: `${id}.srt`,
  fileName: `${id}.srt`,
  source: { projectId: null, conversationId: null },
  relPath: `${id}.srt`,
  size: 2048,
  lastActivityAt: '2026-10-01T00:00:00.000Z',
  status: null,
  origin: { source: 'generated', projectId: null, jobId: 'job1', capability: 'transcribe' },
  file: { path: `/Users/me/Movies/BaoCut/${id}.srt` },
  ...patch,
  user: { favorite: false, displayName: null, trashedAt },
});

describe('一次运行的产物', () => {
  it('按任务 ID 取 Space 条目：不列回收站、占位与视频，按名字排', () => {
    const list = [
      entry('b'),
      entry('a', { kind: 'document', name: 'a.txt' }),
      entry('other', { origin: { source: 'generated', projectId: null, jobId: 'job2' } }),
      entry('gone', {}, '2026-10-02T00:00:00.000Z'),
      entry('job1', { status: 'generating', ref: { jobId: 'job1' } }),
      entry('movie', { kind: 'video' }),
    ];
    expect(entriesOfJob(list, ['job1']).map((e) => e.id)).toEqual(['a', 'b']);
    expect(entriesOfJob(list, ['job1', 'job2']).map((e) => e.id)).toEqual(['a', 'b', 'other']);
    expect(entriesOfJob(list, [])).toEqual([]);
  });

  it('第二行写种类、大小、时长与所在目录；都在一个目录时给出它', () => {
    const audio = entry('voice', { kind: 'audio', name: 'voice.mp3', size: 1536, media: { durationSec: 75 } });
    expect(outputDetail(audio)).toBe('音频 · 1.5 KB · 1:15 · ~/Movies/BaoCut');
    expect(outputsDir([entry('a'), entry('b')])).toBe('/Users/me/Movies/BaoCut');
    expect(outputsDir([entry('a'), entry('b', { file: { path: '/tmp/b.srt' } })])).toBeNull();
    expect(outputsDir([])).toBeNull();
  });
});

describe('接着做', () => {
  it('文稿与字幕：翻译字幕只收字幕，生成语音两样都收；都能以此新建视频', () => {
    expect(followUps({ kind: 'subtitle' }).map((f) => f.id)).toEqual(['translate-subtitles', 'synthesize-speech', 'new-movie']);
    expect(followUps({ kind: 'document' }).map((f) => [f.id, f.kind])).toEqual([
      ['synthesize-speech', 'tool'],
      ['new-movie', 'action'],
    ]);
  });

  it('媒体文件以此新建视频；写进视频的结果先打开编辑，再按产出它的工具接着做', () => {
    expect(followUps({ kind: 'audio' }).map((f) => f.label)).toEqual(['以此新建视频']);
    expect(followUps({ kind: 'image' }).map((f) => f.id)).toEqual(['new-movie']);
    expect(followUps({ kind: 'video' }, 'transcribe').map((f) => f.id)).toEqual(['open-movie', 'translate-subtitles', 'dub']);
    expect(followUps({ kind: 'video' }, 'translate-subtitles').map((f) => f.id)).toEqual(['open-movie', 'dub']);
    expect(followUps({ kind: 'video' }, 'link-import').map((f) => f.id)).toEqual(['open-movie', 'transcribe']);
    expect(followUps({ kind: 'video' }, 'dub').map((f) => f.id)).toEqual(['open-movie']);
  });

  it('以此新建视频做不了时说原因', () => {
    const user = { favorite: false, displayName: null, trashedAt: null };
    expect(newMovieBlock({ kind: 'subtitle', status: null, user }, '/a.srt')).toMatch(/配上视频或音频/);
    expect(newMovieBlock({ kind: 'audio', status: null, user }, '/a.mp3')).toBeNull();
    expect(newMovieBlock({ kind: 'audio', status: 'generating', user }, '/a.mp3')).toMatch(/还在生成/);
    expect(newMovieBlock({ kind: 'audio', status: null, user: { ...user, trashedAt: 'x' } }, '/a.mp3')).toMatch(/回收站/);
    expect(newMovieBlock({ kind: 'image', status: 'missing', user }, '/a.png')).toMatch(/找不到/);
    expect(newMovieBlock({ kind: 'image', status: null, user }, null)).toMatch(/找不到/);
  });

  it('交给 Agent 预填的话按种类给，没有对应时给一句通用的', () => {
    expect(handoverText({ kind: 'subtitle' })).toContain('翻译');
    expect(handoverText({ kind: 'export' })).toContain('字幕');
    expect(handoverText({ kind: 'package' })).toBe('接着处理这个结果。');
  });
});
