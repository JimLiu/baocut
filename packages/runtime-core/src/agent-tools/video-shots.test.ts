import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SequenceItem, Track, VideoItem, VideoSnapshot } from '@baocut/protocol';
import { silentLogger } from '@baocut/harness';
import { MediaAnalysis, type SceneCut } from '../media-analysis.ts';
import type { DetectedFace, FaceDetector } from '../face-detection.ts';
import { ShotsError, detectShots, detectSpeakerShots, shotSegments, shotsRange, shotsToolError, type SpeakerShotsDeps } from './video-shots.ts';

const track = (id: string, order: number): Track => ({
  id,
  order,
  kind: 'visual',
  locked: false,
  visible: true,
  muted: false,
  solo: { enabled: false, group: 'visual' },
});

function clip(id: string, fromFrame: number, durationFrames: number, sourceSeconds: number, extra: Partial<VideoItem> = {}): VideoItem {
  return {
    enabled: true,
    locked: false,
    followPolicy: { kind: 'sequence-fixed' },
    id,
    trackId: 'trk_v1',
    paintOrder: 0,
    type: 'video',
    span: { fromFrame, durationFrames },
    place: {},
    assetRef: { id: 'asset_v', revision: '1' },
    timeMap: { kind: 'linear', sourceIn: { ticks: String(Math.round(sourceSeconds * 3000)), timescale: 3000 }, rate: { num: 1, den: 1 } },
    embeddedAudio: { enabled: true, volume: 1 },
    ...extra,
  };
}

function video(items: SequenceItem[]): VideoSnapshot {
  return {
    format: 'baocut.video',
    schemaVersion: 3,
    timeContractVersion: 1,
    id: 'video_1',
    name: 'V',
    revision: '3',
    rootSequenceId: 'seq_1',
    sequences: {
      seq_1: {
        id: 'seq_1',
        revision: '3',
        name: 'Main',
        fps: { num: 30, den: 1 },
        canvas: { width: 320, height: 180, workingSpace: 'srgb', background: '#000000' },
        durationPolicy: { kind: 'derived' },
        tracks: [track('trk_v1', 0), track('trk_v2', 1)],
        items,
        animationBindings: [],
        transitions: [],
        markers: [],
        ducking: [],
      },
    },
    assets: {
      asset_v: {
        id: 'asset_v',
        kind: 'video',
        name: 'cat.mp4',
        currentRevision: '1',
        revisions: {
          '1': {
            revision: '1',
            contentHash: `sha256:${'ab'.repeat(32)}`,
            byteLength: 10,
            mediaType: 'video/mp4',
            storage: { mode: 'linked', locator: { path: 'cat.mp4' }, frozen: false },
            duration: { ticks: '11', timescale: 2 },
            video: { width: 320, height: 180 },
          },
        },
      },
    },
    documents: {},
    fonts: {},
    localizationSets: {},
    canvasVariants: {},
    syncGroups: {},
    protections: {},
    checkpoints: {},
    links: [],
  } as unknown as VideoSnapshot;
}

/** 假的分析：记下每次的源区间，按给定的源时刻回切换点。 */
function fakeAnalysis(sceneAt: SceneCut[]) {
  const calls: { fromSec: number; durSec: number; threshold: number }[] = [];
  const analysis = {
    sceneCuts: async (_asset: unknown, options: { fromSec: number; durSec: number; threshold: number }) => {
      calls.push(options);
      return sceneAt.filter((c) => c.at >= options.fromSec && c.at < options.fromSec + options.durSec);
    },
  } as unknown as MediaAnalysis;
  return { calls, deps: { analysis, assetFile: async () => ({ root: '/', file: 'x' }) } };
}

describe('镜头切换：分段与切换点（假的分析）', () => {
  it('区间对到帧，空的与超过 20 分钟的拒绝', () => {
    const v = video([clip('a', 0, 300, 0)]);
    expect(shotsRange(v, { start: 1.01, end: 2.99 })).toMatchObject({ from: 30, to: 90 });
    expect(shotsRange(v, {})).toMatchObject({ from: 0, to: 300 });
    expect(() => shotsRange(v, { start: 20, end: 30 })).toThrow(ShotsError);
    const long = video([clip('a', 0, 30 * 60 * 21, 0)]);
    expect(() => shotsRange(long, {})).toThrow(expect.objectContaining({ code: 'SHOTS_RANGE_TOO_LONG' }));
    expect(() => shotsRange(v, { start: 3, end: 2 })).toThrow(expect.objectContaining({ code: 'SHOTS_RANGE_EMPTY' }));
    expect(shotsToolError(new ShotsError('SHOTS_RANGE_TOO_LONG'))).toMatchObject({ code: 'INVALID_ARGUMENTS', extra: { code: 'SHOTS_RANGE_TOO_LONG' } });
    const other = new Error('x');
    expect(shotsToolError(other)).toBe(other);
  });

  it('场景切换按片段的时间映射换回时间线（源起点不为 0、时间线起点不为 0），对到帧', async () => {
    // 时间线 2–6s 播源 10–14s；源 11.5s 与 13.0s 处有切换 → 时间线 3.5s、5s。
    const v = video([clip('a', 60, 120, 10)]);
    const { calls, deps } = fakeAnalysis([
      { at: 11.5, score: 0.6 },
      { at: 13.0, score: 0.4 },
    ]);
    const result = await detectShots(deps, v, { start: 2, end: 6 });
    expect(calls).toEqual([{ fromSec: 10, durSec: 4, threshold: 0.3 }]);
    expect(result.cuts).toEqual([
      { at: 3.5, score: 0.6, kind: 'scene' },
      { at: 5, score: 0.4, kind: 'scene' },
    ]);
    expect(result.shots.map((s) => [s.start, s.end])).toEqual([
      [2, 3.5],
      [3.5, 5],
      [5, 6],
    ]);
    // 取帧时刻在帧的正中：镜头 [2, 3.5) 的 20%、50%、80%。
    expect(result.shots[0]!.sampleAt).toEqual(['2.3167', '2.75', '3.2167']);
  });

  it('换了片段、源画面接不上的地方是 edit；同一素材源时间接续的拆分不算切换', async () => {
    // a：0–2s 播源 0–2s；b：2–4s 播源 2–4s（接续）；c：4–6s 播源 30–32s（跳）。
    const v = video([clip('a', 0, 60, 0), clip('b', 60, 60, 2), clip('c', 120, 60, 30)]);
    const { deps } = fakeAnalysis([]);
    const result = await detectShots(deps, v, {});
    expect(result.cuts).toEqual([{ at: 4, score: null, kind: 'edit' }]);
  });

  it('上层轨道盖住一段：盖住与移开的地方各一处 edit；分段按最上层的片段', async () => {
    const v = video([clip('a', 0, 180, 0), clip('pip', 60, 30, 50, { trackId: 'trk_v2' })]);
    expect(shotSegments(v, 0, 180).map((s) => [s.from, s.to, s.source?.item.id])).toEqual([
      [0, 60, 'a'],
      [60, 90, 'pip'],
      [90, 180, 'a'],
    ]);
    const { calls, deps } = fakeAnalysis([]);
    const result = await detectShots(deps, v, { minShot: 0 });
    expect(result.cuts.map((c) => [c.at, c.kind])).toEqual([
      [2, 'edit'],
      [3, 'edit'],
    ]);
    // 每段各自检测：a 的两截各一次，pip 一次。
    expect(calls.map((c) => [c.fromSec, c.durSec])).toEqual([
      [0, 2],
      [50, 1],
      [3, 3],
    ]);
  });

  it('短于 minShot 的镜头并进前一个，第一个并进后一个', async () => {
    const v = video([clip('a', 0, 300, 0)]);
    const { deps } = fakeAnalysis([
      { at: 0.3, score: 0.5 },
      { at: 4, score: 0.5 },
      { at: 4.5, score: 0.5 },
      { at: 8, score: 0.5 },
    ]);
    const result = await detectShots(deps, v, { minShot: 0.8 });
    // [0, 0.3) 太短并进后一个（去掉 0.3）；[4, 4.5) 太短并进前一个（去掉 4）。
    expect(result.cuts.map((c) => c.at)).toEqual([4.5, 8]);
    expect((await detectShots(deps, v, { minShot: 0 })).cuts.map((c) => c.at)).toEqual([0.3, 4, 4.5, 8]);
  });
});

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasFfmpeg)('镜头切换（真实 ffmpeg）', () => {
  let dir: string;
  let analysis: MediaAnalysis;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-shots-'));
    // testsrc 2s + 纯红 1.5s + 彩条 2s：切换点在源 2s 与 3.5s。关键帧间隔 300，跳转要从头解码到目标附近。
    execFileSync('ffmpeg', [
      ...['-v', 'error', '-y'],
      ...['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=2'],
      ...['-f', 'lavfi', '-i', 'color=c=red:size=320x180:rate=30:duration=1.5'],
      ...['-f', 'lavfi', '-i', 'smptebars=size=320x180:rate=30:duration=2'],
      ...['-filter_complex', '[0][1][2]concat=n=3:v=1:a=0', '-c:v', 'mpeg4', '-g', '300', path.join(dir, 'cat.mp4')],
    ]);
    analysis = new MediaAnalysis({
      cacheDir: path.join(dir, 'cache'),
      log: silentLogger,
      ffmpeg: async () => ({ command: 'ffmpeg', env: process.env }),
    });
  });

  afterAll(async () => {
    analysis.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const deps = () => ({ analysis, assetFile: async () => ({ root: dir, file: 'cat.mp4' }) });

  it('sceneCuts：切换点在源时钟上，跳转的偏移已加回', async () => {
    const asset = { contentHash: `sha256:${'cd'.repeat(32)}`, mediaType: 'video/mp4', durationSec: 5.5 };
    const cuts = await analysis.sceneCuts(asset, { fromSec: 1, durSec: 4, threshold: 0.3 }, async () => ({ root: dir, file: 'cat.mp4' }));
    expect(cuts.map((c) => Math.round(c.at * 30))).toEqual([60, 105]);
    for (const c of cuts) expect(c.score).toBeGreaterThan(0.3);
  });

  it('时间线起点不为 0、源从 1s 起播：切换点 ±1 帧，镜头与取帧时刻落在各自镜头里', async () => {
    // 时间线 3–7.5s 播源 1–5.5s：源 2s、3.5s 的切换 → 时间线 4s、5.5s。
    const v = video([clip('a', 90, 135, 1)]);
    // 前 3 秒是空的：从空到有画面也是一处 edit。
    expect((await detectShots(deps(), v, {})).cuts.map((c) => [c.at, c.kind])[0]).toEqual([3, 'edit']);
    const result = await detectShots(deps(), v, { start: 3 });
    expect(result.cuts.map((c) => c.kind)).toEqual(['scene', 'scene']);
    const frames = result.cuts.map((c) => c.at * 30);
    expect(Math.abs(frames[0]! - 120)).toBeLessThanOrEqual(1);
    expect(Math.abs(frames[1]! - 165)).toBeLessThanOrEqual(1);
    expect(result.shots).toHaveLength(3);
    for (const shot of result.shots) {
      for (const at of shot.sampleAt) {
        expect(Number(at)).toBeGreaterThanOrEqual(shot.start);
        expect(Number(at)).toBeLessThan(shot.end);
      }
    }
  });

  it('两个片段剪在一起：接口处是 edit，各段里的场景切换照常', async () => {
    // a：0–3s 播源 0–3s（含 2s 的切换）；b：3–5s 播源 3.5–5.5s（彩条）。接口处源从 3s 跳到 3.5s。
    const v = video([clip('a', 0, 90, 0), clip('b', 90, 60, 3.5)]);
    const result = await detectShots(deps(), v, {});
    expect(result.cuts.map((c) => [Math.round(c.at * 30), c.kind])).toEqual([
      [60, 'scene'],
      [90, 'edit'],
    ]);
  });
});

// ---- 按说话人切段（by: "speaker"，docs/design/shorts-framing §2.5） ----

/** 讲话转写：说话人 `turns[k]` 从 `k × every` 秒起说到 `(k + 1) × every − 0.1` 秒，每 0.3 秒一个词。 */
function speechBody(turns: string[], every: number, speakers = ['spk_a', 'spk_b']) {
  const words: { id: string; start: number; end: number; text: string; speaker: string }[] = [];
  turns.forEach((speaker, k) => {
    for (let t = k * every; t < (k + 1) * every - 0.1 - 1e-9; t += 0.3) {
      words.push({ id: `w${words.length}`, start: Math.round(t * 1e6), end: Math.round(Math.min((k + 1) * every - 0.1, t + 0.3) * 1e6), text: 'x', speaker });
    }
  });
  return { schema: 'baocut.speech/1', clock: 'source-asset', timescale: 1_000_000, speakers: speakers.map((id) => ({ id, name: id.toUpperCase() })), words };
}

/** 带一份讲话转写的视频：素材长 `seconds` 秒，片段从时间线 0 起播源 0 起。 */
function speakerVideo(seconds: number): VideoSnapshot {
  const v = video([clip('a', 0, seconds * 30, 0)]);
  const asset = v.assets['asset_v']!;
  asset.revisions['1']!.duration = { ticks: String(seconds), timescale: 1 };
  v.documents = {
    doc_speech: { id: 'doc_speech', kind: 'speech', name: 'Transcript', sourceAssetId: 'asset_v', currentRevision: '1', revisions: {} },
  } as unknown as VideoSnapshot['documents'];
  return v;
}

/** 素材时钟与时间线重合（片段从 0 起播源 0 起），时间线上的词就是转写的词。 */
function speakerDeps(
  body: unknown,
  faces: FaceDetector | undefined,
  base: { analysis: MediaAnalysis; assetFile: SpeakerShotsDeps['assetFile'] },
  revision = '1',
): SpeakerShotsDeps {
  const words = ((body as ReturnType<typeof speechBody>).words ?? []).map((w) => ({ start: w.start / 1e6, end: w.end / 1e6, speaker: w.speaker }));
  return {
    ...base,
    faces,
    document: async () => ({ revision, body }),
    words: async (_id, range) => words.filter((w) => w.end > range.start && w.start < range.end),
  };
}

/** 假的人脸检测：每个文件都回同样几张脸；记下调用次数。 */
function fixedFaces(perFile: (index: number) => DetectedFace[]) {
  const calls: number[] = [];
  const detector: FaceDetector = {
    detect: async (files) => {
      calls.push(files.length);
      return { detector: 'yunet', faces: files.map((_, i) => perFile(i)) };
    },
  };
  return { detector, calls };
}

// 320×180 的画面里两张「脸」：左脸 x 40–90、右脸 x 230–280，y 都是 40–90 像素。
const LEFT_FACE = { x: 40 / 320, y: 40 / 180, w: 50 / 320, h: 50 / 180, score: 0.9 };
const RIGHT_FACE = { x: 230 / 320, y: 40 / 180, w: 50 / 320, h: 50 / 180, score: 0.9 };

describe('按说话人切段的拒绝（假的分析）', () => {
  const base = { analysis: { keyframeFile: async () => '/missing.jpg' } as unknown as MediaAnalysis, assetFile: async () => ({ root: '/', file: 'x' }) };

  it('没有转写、转写里不到 2 个说话人：SHOTS_NO_SPEAKERS，next 请用户先识别说话人', async () => {
    const none = video([clip('a', 0, 300, 0)]);
    await expect(detectSpeakerShots(speakerDeps({}, fixedFaces(() => []).detector, base), none, {})).rejects.toMatchObject({ code: 'SHOTS_NO_SPEAKERS' });
    const single = speechBody(['spk_a', 'spk_a'], 5, ['spk_a']);
    const error = await detectSpeakerShots(speakerDeps(single, fixedFaces(() => []).detector, base), speakerVideo(10), {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ShotsError);
    expect(shotsToolError(error)).toMatchObject({ code: 'SHOTS_NO_SPEAKERS', extra: { next: expect.stringContaining('识别说话人') } });
  });

  it('人脸检测不可用：SHOTS_FACES_UNAVAILABLE', async () => {
    const body = speechBody(['spk_a', 'spk_b', 'spk_a', 'spk_b'], 5);
    await expect(detectSpeakerShots(speakerDeps(body, undefined, base), speakerVideo(20), {})).rejects.toMatchObject({ code: 'SHOTS_FACES_UNAVAILABLE' });
    const broken: FaceDetector = { detect: async () => null };
    const error = await detectSpeakerShots(speakerDeps(body, broken, base), speakerVideo(20), {}).catch((e: unknown) => e);
    expect(shotsToolError(error)).toMatchObject({ code: 'SHOTS_FACES_UNAVAILABLE', extra: { next: expect.stringContaining('整支分屏') } });
  });

  it('多数取样不是同样 2–4 张主脸：SHOTS_NOT_SINGLE_CAMERA', async () => {
    const body = speechBody(['spk_a', 'spk_b', 'spk_a', 'spk_b', 'spk_a', 'spk_b'], 5);
    const closeUps = fixedFaces((i) => (i % 3 === 0 ? [LEFT_FACE, RIGHT_FACE] : [LEFT_FACE]));
    await expect(detectSpeakerShots(speakerDeps(body, closeUps.detector, base), speakerVideo(30), {})).rejects.toMatchObject({
      code: 'SHOTS_NOT_SINGLE_CAMERA',
    });
  });
});

describe.skipIf(!hasFfmpeg)('按说话人切段（真实 ffmpeg）', () => {
  let dir: string;
  let analysis: MediaAnalysis;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-speaker-shots-'));
    // 40 秒、每秒 12 帧：每 5 秒换一张脸的嘴部逐帧闪（128 ↔ 188），先右脸、再左脸，轮流。
    const mouth = (x0: number, x1: number, block: number) => `between(X,${x0},${x1})*between(Y,74,90)*eq(mod(floor(T/5),2),${block})`;
    execFileSync('ffmpeg', [
      ...['-v', 'error', '-y'],
      ...['-f', 'lavfi', '-i', `nullsrc=s=320x180:r=12:d=40,format=gray,geq=lum='128+60*mod(N,2)*(${mouth(52, 78, 1)}+${mouth(242, 268, 0)})'`],
      ...['-pix_fmt', 'yuv420p', '-c:v', 'mpeg4', '-q:v', '2', path.join(dir, 'talk.mp4')],
    ]);
    analysis = new MediaAnalysis({
      cacheDir: path.join(dir, 'cache'),
      log: silentLogger,
      ffmpeg: async () => ({ command: 'ffmpeg', env: process.env }),
    });
  });

  afterAll(async () => {
    analysis.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const base = () => ({ analysis, assetFile: async () => ({ root: dir, file: 'talk.mp4' }) });

  it('grayBurst：按每秒帧数解出 1.2 秒的灰度画面，每帧 宽 × 高 个字节', async () => {
    const asset = { contentHash: `sha256:${'ef'.repeat(32)}`, mediaType: 'video/mp4', durationSec: 40 };
    const frames = await analysis.grayBurst(asset, { fromSec: 2, durSec: 1.2, fps: 12, width: 320, height: 180 }, async () => ({
      root: dir,
      file: 'talk.mp4',
    }));
    expect(frames.length).toBeGreaterThanOrEqual(14);
    expect(frames.length).toBeLessThanOrEqual(16);
    for (const frame of frames) expect(frame.length).toBe(320 * 180);
  });

  it('认出每个说话人是哪张脸，按说话人切段，每段对准正在说的人；同一素材与转写第二次用缓存', async () => {
    const body = speechBody(['spk_a', 'spk_b', 'spk_a', 'spk_b', 'spk_a', 'spk_b', 'spk_a', 'spk_b'], 5);
    const faces = fixedFaces(() => [RIGHT_FACE, LEFT_FACE]);
    const result = await detectSpeakerShots(speakerDeps(body, faces.detector, base()), speakerVideo(40), {});
    expect(result.detector).toBe('mouth-motion');
    expect(result.faces.map((f) => f.speaker)).toEqual(['spk_b', 'spk_a']);
    expect(result.faces[0]!.box.x).toBeCloseTo(LEFT_FACE.x, 3);
    expect(result.speakers).toEqual([
      { id: 'spk_a', name: 'SPK_A', face: 1, probes: 8, contrast: expect.any(Number) },
      { id: 'spk_b', name: 'SPK_B', face: 0, probes: 8, contrast: expect.any(Number) },
    ]);
    expect(result.confidence).toBeGreaterThan(2);
    expect(result.shots.map((s) => [s.start, s.end, s.speaker, s.face])).toEqual(
      Array.from({ length: 8 }, (_, k) => [k * 5, (k + 1) * 5, k % 2 ? 'spk_b' : 'spk_a', k % 2 ? 0 : 1]),
    );

    const again = await detectSpeakerShots(speakerDeps(body, faces.detector, base()), speakerVideo(40), { start: 10, end: 20, split: false });
    expect(again.range).toEqual({ start: 10, end: 20 });
    expect(again.shots.map((s) => [s.start, s.end, s.face])).toEqual([
      [10, 15, 1],
      [15, 20, 0],
    ]);
    expect(faces.calls).toEqual([16]);
  });

  it('说话人与嘴部的动静对不上：SHOTS_SPEAKERS_UNMATCHED', async () => {
    // 每人说 10 秒，跨过两张脸各闪 5 秒：两个取样一个落在左脸闪时、一个落在右脸闪时。转写换了修订，不用上一条的缓存。
    const body = speechBody(['spk_a', 'spk_b', 'spk_a', 'spk_b'], 10);
    const deps = speakerDeps(body, fixedFaces(() => [LEFT_FACE, RIGHT_FACE]).detector, base(), '2');
    const error = await detectSpeakerShots(deps, speakerVideo(40), {}).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'SHOTS_SPEAKERS_UNMATCHED' });
    expect(shotsToolError(error)).toMatchObject({ code: 'SHOTS_SPEAKERS_UNMATCHED', extra: { next: expect.stringContaining('整支分屏') } });
  });
});
