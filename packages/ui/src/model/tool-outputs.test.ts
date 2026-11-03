import { describe, expect, it } from 'vitest';
import type { EditOperation, Sequence, SpaceEntry } from '@baocut/protocol';
import { audioItem, sequence, track, videoItem } from '../testing/sequence-records.ts';
import { MUSIC_ROLE, SOUNDTRACK_EXTENSION } from './music-bed.ts';
import { addToMovieOperations, entriesOfJob, followUps, handoverText, newMovieBlock, outputDetail, outputProvenance, outputsDir } from './tool-outputs.ts';

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

  it('音频与视频文件以此新建视频、加到视频，生成的图片不接；写进视频的结果先打开编辑，再按产出它的工具接着做', () => {
    expect(followUps({ kind: 'audio' }).map((f) => f.label)).toEqual(['以此新建视频', '加到视频']);
    for (const kind of ['video-file', 'export'] as const) {
      expect(followUps({ kind }).map((f) => [f.id, f.kind])).toEqual([
        ['new-movie', 'action'],
        ['add-to-movie', 'action'],
      ]);
    }
    expect(followUps({ kind: 'image' })).toEqual([]);
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

  it('加到视频：时间线还空着时同一笔放上去，已经有片段时只导入，文件都留在原处', () => {
    const sequenceOf = (items: unknown[]) => ({ id: 'seq', tracks: [], items }) as unknown as Sequence;
    const audio = { name: 'voice.wav', fileName: 'voice.wav' };
    const empty = addToMovieOperations(sequenceOf([]), {}, audio, '/save/voice.wav', null);
    expect(empty.placed).toBe(true);
    expect(empty.operations).toEqual([
      { type: 'importAsset', path: '/save/voice.wav', ref: 'drop0', name: 'voice.wav' },
      { type: 'addItem', sequenceId: 'seq', asset: { ref: 'drop0' }, alignment: 'exact-frame' },
    ]);
    const busy = addToMovieOperations(sequenceOf([{ id: 'clip' }]), {}, audio, '/save/voice.wav', { origin: 'generated' });
    expect(busy.placed).toBe(false);
    expect(busy.operations).toEqual([{ type: 'importAsset', path: '/save/voice.wav', ref: 'drop0', name: 'voice.wav', provenance: { origin: 'generated' } }]);
    // 认不出种类的文件只导入，不猜放哪条轨。
    expect(addToMovieOperations(sequenceOf([]), {}, { name: 'x', fileName: 'x.bin' }, '/save/x.bin', null).placed).toBe(false);
  });

  describe('加到视频：生成的音乐铺上音乐轨', () => {
    const FPS = { num: 30, den: 1 };
    const withClip = sequence([track('t1', 'visual', 0)], [videoItem('v1', 't1', 0, 300)]);
    const music = {
      name: 'calm.wav',
      fileName: 'calm.wav',
      origin: { source: 'generated' as const, jobId: 'job_m', capability: 'generateMusic' },
      media: { durationSec: 4 },
    };
    const types = (operations: { type: string }[]) => operations.map((o) => o.type);

    it('同一笔导入并循环铺满：实例引用刚导入的素材，文件仍是链接', () => {
      expect(withClip.fps).toEqual(FPS);
      const plan = addToMovieOperations(withClip, {}, music, '/save/calm.wav', null);
      expect(plan.placed).toBe(true);
      expect(plan.bed?.totalSec).toBe(10);
      expect(types(plan.operations)).toEqual(['importAsset', 'addTrack', 'addTrack', 'insertItems']);
      expect(plan.operations[0]).toEqual({ type: 'importAsset', path: '/save/calm.wav', ref: 'drop0', name: 'calm.wav' });
      const insert = plan.operations.at(-1) as Extract<EditOperation, { type: 'insertItems' }>;
      expect(insert.items.map((i) => (i as { assetImportRef?: string }).assetImportRef)).toEqual(insert.items.map(() => 'drop0'));
      expect(insert.items.every((i) => !('assetRef' in i))).toBe(true);
      expect(insert.items[0]).toMatchObject({ type: 'audio', role: MUSIC_ROLE, extensions: { [SOUNDTRACK_EXTENSION]: { jobId: 'job_m' } } });
    });

    it('时间线还空着时放一段完整的音乐，不循环', () => {
      const plan = addToMovieOperations(sequence([track('t1', 'visual', 0)], []), {}, music, '/save/calm.wav', null);
      expect(plan.placed).toBe(true);
      expect(plan.bed?.totalSec).toBe(4);
      expect(plan.bed?.layout).toHaveLength(1);
      expect(types(plan.operations)).toEqual(['importAsset', 'addTrack', 'insertItems']);
    });

    it('这个任务的音乐已经在时间线上时不再铺，只有一个导入（引擎复用原素材，这一笔是空的）', () => {
      const laid = sequence(
        [track('t1', 'visual', 0), track('m1', 'audio', 1)],
        [videoItem('v1', 't1', 0, 300), audioItem('b1', 'm1', 0, 10, { extensions: { [SOUNDTRACK_EXTENSION]: { jobId: 'job_m' } } })],
      );
      const plan = addToMovieOperations(laid, {}, music, '/save/calm.wav', null);
      expect(plan).toMatchObject({ placed: false, bed: null, onTimeline: true });
      expect(types(plan.operations)).toEqual(['importAsset']);
    });

    it('不知道时长、或不是生成音乐的音频，走普通的导入', () => {
      const unknown = addToMovieOperations(withClip, {}, { ...music, media: {} }, '/save/calm.wav', null);
      expect(unknown).toMatchObject({ placed: false, bed: null });
      const speech = { ...music, origin: { ...music.origin, capability: 'synthesizeSpeech' } };
      const voice = addToMovieOperations(withClip, {}, speech, '/save/voice.wav', null);
      expect(voice).toMatchObject({ placed: false, bed: null });
      expect(types(voice.operations)).toEqual(['importAsset']);
    });
  });

  it('加到视频记的来源：生成的音频仍是那条生成记录，文件到文件的流程按用户导入', () => {
    const generated = {
      ref: { artifactId: 'sha256:aa' },
      origin: { source: 'generated', jobId: 'job1', capability: 'generateMusic', provider: { providerId: 'local', modelId: 'yue' } },
    } as const;
    expect(outputProvenance(generated, null)).toEqual({
      origin: 'generated',
      source: { jobId: 'job1', capability: 'generateMusic', providerId: 'local', modelId: 'yue', artifactId: 'sha256:aa' },
    });
    expect(outputProvenance({ ref: { artifactId: 'sha256:bb' }, origin: { source: 'generated', jobId: 'job2', capability: 'transcode' } }, null)).toBeNull();
    expect(outputProvenance({ origin: { source: 'imported', jobId: 'job3', capability: 'link-import' } }, null)).toBeNull();
    expect(outputProvenance({}, null)).toBeNull();
  });

  it('交给 Agent 预填的话按种类给，没有对应时给一句通用的', () => {
    expect(handoverText({ kind: 'subtitle' })).toContain('翻译');
    expect(handoverText({ kind: 'export' })).toContain('字幕');
    expect(handoverText({ kind: 'package' })).toBe('接着处理这个结果。');
  });
});
