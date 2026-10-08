import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AssetRecord, Sequence } from '@baocut/protocol';
import { hitAt } from '../model/stage-hit.ts';
import { type FrozenDocument, RenderPlanner, type RenderWarning, type SkippedItem, type SpeechTranscript } from './render-planner.ts';

// 预览与导出画出同一帧：夹具由 `cargo test -p frame-render --test parity` 按导出的路子（原生构建、`plan_frame`、
// 内置字体）画出来，记下每帧的 SHA-256；这里把同一份输入送进编出来的预览 WASM，逐帧比字节。
// 两边是同一份 Rust 代码；WASM 开了 SIMD（simd128），实测与原生构建逐字节一致，所以不留容差：哪一帧不同就是实现分叉了。
const wasm = fileURLToPath(new URL('./generated/preview.wasm', import.meta.url));
const fixture = fileURLToPath(new URL('../../../../crates/frame-render/tests/fixtures/parity.json', import.meta.url));
const fonts = fileURLToPath(new URL('../../../../crates/render-raster/assets/fonts/', import.meta.url));
const built = existsSync(wasm);
if (!built) console.warn('没有找到预览 WASM，跳过预览与导出的一致性测试：先运行 npm run build:wasm');

type Rgba = [number, number, number, number];

interface Shot {
  frame: number;
  width: number;
  height: number;
  captions: boolean;
  transparent: boolean;
  sha256: string;
  warnings: RenderWarning[];
  skipped: SkippedItem[];
}

interface Scene {
  name: string;
  video: { sequences: Record<string, Sequence>; assets: Record<string, AssetRecord> };
  documents: FrozenDocument[];
  pictures: { itemId: string; width: number; height: number; bands: Rgba[] }[];
  /** 文本素材给 `text`，二进制素材（如 `.lottie` 压缩包）给十六进制的 `hex`。 */
  assets: { key: string; text?: string; hex?: string }[];
  spectra: { itemId: string; hex: string }[];
  audioSpectra: { key: string; hex: string }[];
  /** 视频里的转写（声波的 `speaker` 用）；没有时不送。 */
  speech?: SpeechTranscript[];
  shots: Shot[];
}

interface Fixture {
  fps: number;
  sequenceId: string;
  scenes: Scene[];
}

/** 竖条画面：第 x 列的颜色是 `bands[floor(x * n / w)]`（与 Rust 那边同一个规则）。 */
function bands(width: number, height: number, colours: Rgba[]): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out.set(colours[Math.floor((x * colours.length) / width)]!, (y * width + x) * 4);
  }
  return out;
}

/** 把场景的视频、文档、素材、频谱与转写送进计划器。 */
function load(planner: RenderPlanner, scene: Scene, sequenceId: string): void {
  planner.setVideo({ sequence: scene.video.sequences[sequenceId]!, assets: scene.video.assets });
  planner.setDocuments(scene.documents);
  for (const asset of scene.assets) {
    const [id, revision] = asset.key.split('@') as [string, string];
    const bytes = asset.hex === undefined ? new TextEncoder().encode(asset.text) : new Uint8Array(Buffer.from(asset.hex, 'hex'));
    planner.setAsset({ id, revision }, bytes);
  }
  for (const spectrum of scene.spectra) planner.setSpectrum(spectrum.itemId, new Uint8Array(Buffer.from(spectrum.hex, 'hex')));
  for (const spectrum of scene.audioSpectra) {
    const [id, revision] = spectrum.key.split('@') as [string, string];
    planner.setAudioSpectrum({ id, revision }, new Uint8Array(Buffer.from(spectrum.hex, 'hex')));
  }
  if (scene.speech) planner.setSpeech(scene.speech);
}

/** 送上场景的画面，按镜头的尺寸与开关画 `seconds` 这一刻。 */
function draw(
  planner: RenderPlanner,
  scene: Scene,
  shot: Pick<Shot, 'width' | 'height' | 'captions' | 'transparent'>,
  seconds: number,
): ReturnType<RenderPlanner['render']> {
  planner.clearPictures();
  for (const picture of scene.pictures) {
    planner.setPicture(picture.itemId, bands(picture.width, picture.height, picture.bands), picture.width, picture.height);
  }
  return planner.render(seconds, shot.width, shot.height, { captions: shot.captions, transparent: shot.transparent });
}

const sha256 = (pixels: Uint8Array | Uint8ClampedArray) => createHash('sha256').update(pixels).digest('hex');

describe.skipIf(!built)('预览与导出逐字节一致', () => {
  const data = built ? (JSON.parse(readFileSync(fixture, 'utf8')) as Fixture) : { fps: 30, sequenceId: 'seq', scenes: [] };

  it('夹具覆盖每类场景', () => {
    const names = data.scenes.map((scene) => scene.name);
    expect(names.length).toBeGreaterThan(40);
    for (const prefix of [
      'image-',
      'text-',
      'shape-',
      'fx-',
      'mask-',
      'tile',
      'animate-',
      'keyframes',
      'transition-',
      'captions-',
      'template-',
      'visualizer-audio',
    ]) {
      expect(
        names.some((name) => name.startsWith(prefix)),
        prefix,
      ).toBe(true);
    }
  });

  it('真实 WASM 字幕行框能选中所属实例，预览缩放后仍使用序列画布坐标', async () => {
    const planner = await RenderPlanner.instantiate(readFileSync(wasm));
    planner.addFonts(planner.fontFiles().map((name) => new Uint8Array(readFileSync(`${fonts}${name}`))));
    const scene = data.scenes.find((scene) => scene.name === 'captions-studio')!;
    load(planner, scene, data.sequenceId);
    const shot = scene.shots.find((shot) => shot.captions && shot.frame > 0)!;
    const seconds = shot.frame / data.fps;
    const frame = draw(planner, scene, shot, seconds);
    expect(frame.captionHits?.length).toBeGreaterThan(0);
    for (const hit of frame.captionHits!) {
      expect(hitAt(frame.plan.layers, { x: hit.cx, y: hit.cy }, { captionHits: frame.captionHits })).toBe(hit.itemId);
      expect(scene.documents.some((doc) => doc.documentId === hit.documentId)).toBe(true);
    }
    const smaller = draw(planner, scene, { ...shot, width: shot.width / 2, height: shot.height / 2 }, seconds);
    expect(smaller.captionHits?.length).toBe(frame.captionHits!.length);
    for (const [i, hit] of smaller.captionHits!.entries()) {
      expect(hit.itemId).toBe(frame.captionHits![i]!.itemId);
      expect(hit.cx).toBeCloseTo(frame.captionHits![i]!.cx, 1);
      expect(hit.cy).toBeCloseTo(frame.captionHits![i]!.cy, 1);
    }
    expect(draw(planner, scene, { ...shot, captions: false }, seconds).captionHits).toEqual([]);
  });

  it('逐词动画在几个阶段各取一帧，帧帧不同', () => {
    // 定位框样式的逐字显现：起点什么都不画、之后一个词一个词亮出来；四帧都在下面逐字节比。
    const reveal = data.scenes.find((scene) => scene.name === 'captions-boxed-reveal');
    expect(reveal?.shots.map((shot) => shot.frame)).toEqual([0, 15, 31, 75]);
    expect(new Set(reveal?.shots.map((shot) => shot.sha256)).size).toBe(4);
  });

  it('每个场景的每一帧与原生导出相同', async () => {
    const base = await RenderPlanner.instantiate(readFileSync(wasm));
    base.addFonts(base.fontFiles().map((name) => new Uint8Array(readFileSync(`${fonts}${name}`))));
    for (const scene of data.scenes) {
      // 每个场景一个新实例：缓存（Lottie、频谱轨）不跨场景，与原生那边每个场景一个渲染器相同。
      const planner = await base.fork();
      load(planner, scene, data.sequenceId);
      for (const shot of scene.shots) {
        const rendered = draw(planner, scene, shot, shot.frame / data.fps);
        const label = `${scene.name} 第 ${shot.frame} 帧 ${shot.width}×${shot.height}`;
        expect(rendered.skipped, label).toEqual(shot.skipped);
        expect(rendered.warnings, label).toEqual(shot.warnings);
        expect(rendered.spectra, label).toEqual([]);
        const pixels = planner.frame();
        expect(pixels.length, label).toBe(shot.width * shot.height * 4);
        expect(sha256(pixels), label).toBe(shot.sha256);
      }
    }
  }, 120_000);

  it('播放、停住与改窗口大小时几种尺寸来回画：停住的那一帧照样与原生导出相同', async () => {
    const base = await RenderPlanner.instantiate(readFileSync(wasm));
    base.addFonts(base.fontFiles().map((name) => new Uint8Array(readFileSync(`${fonts}${name}`))));
    for (const scene of data.scenes) {
      const planner = await base.fork();
      load(planner, scene, data.sequenceId);
      for (const shot of scene.shots) {
        // 按降过的分辨率画下一帧（播放中），窗口改了大小再画一帧（第三种尺寸换掉最久没用的那台），再停在这一帧画原尺寸。
        const scaled = (factor: number) => ({ ...shot, width: Math.round(shot.width * factor), height: Math.round(shot.height * factor) });
        draw(planner, scene, scaled(0.75), (shot.frame + 1) / data.fps);
        draw(planner, scene, scaled(0.5), (shot.frame + 2) / data.fps);
        draw(planner, scene, shot, shot.frame / data.fps);
        expect(sha256(planner.frame()), `${scene.name} 第 ${shot.frame} 帧`).toBe(shot.sha256);
      }
    }
  }, 120_000);

  it('样式、文字、关键帧、字幕文档变了：两种尺寸各自的渲染器画出的都与新实例相同', async () => {
    const base = await RenderPlanner.instantiate(readFileSync(wasm));
    base.addFonts(base.fontFiles().map((name) => new Uint8Array(readFileSync(`${fonts}${name}`))));
    const sceneNamed = (name: string) => data.scenes.find((scene) => scene.name === name)!;
    const items = (scene: Scene) => scene.video.sequences[data.sequenceId]!.items as unknown as Record<string, any>[];
    const changes: { name: string; scene: string; change: (scene: Scene) => void }[] = [
      { name: '样式', scene: 'text-styled', change: (scene) => (items(scene)[0]!.style.fontColor = '#00FF00') },
      { name: '文字', scene: 'text-styled', change: (scene) => (items(scene)[0]!.text = 'HHHI') },
      {
        name: '关键帧',
        scene: 'keyframes',
        change: (scene) => (scene.video.sequences[data.sequenceId]!.animationBindings[0]!.keyframes.at(-1)!.value = 60),
      },
      {
        name: '字幕正文',
        scene: 'captions-studio',
        change: (scene) => {
          for (const cue of (scene.documents[0]!.body as { cues: { text: string }[] }).cues) cue.text = `改 ${cue.text}`;
        },
      },
      {
        name: '字幕样式',
        scene: 'captions-studio',
        change: (scene) => ((scene.documents[1]!.body as { style: { fontSize: number } }).style.fontSize = 60),
      },
    ];
    for (const { name, scene: sceneName, change } of changes) {
      const original = sceneNamed(sceneName);
      // 画字幕、内容动得最晚的那一帧（关键帧的终点）。
      const shot = original.shots.filter((shot) => shot.captions).at(-1)!;
      const seconds = shot.frame / data.fps;
      const playback = { ...shot, width: Math.round(shot.width * 0.75), height: Math.round(shot.height * 0.75) };
      const warm = await base.fork();
      load(warm, original, data.sequenceId);
      for (const size of [playback, shot, playback, shot]) draw(warm, original, size, seconds);
      const before = sha256(warm.frame());
      expect(before, name).toBe(shot.sha256);

      const changed = structuredClone(original);
      change(changed);
      load(warm, changed, data.sequenceId);
      const fresh = await base.fork();
      load(fresh, changed, data.sequenceId);
      // 播放的那台刚画过；停住的那台闲着，也要按新的内容画。
      for (const size of [playback, shot]) {
        draw(warm, changed, size, seconds);
        draw(fresh, changed, size, seconds);
        expect(sha256(warm.frame()), `${name} ${size.width}×${size.height}`).toBe(sha256(fresh.frame()));
      }
      expect(sha256(warm.frame()), `${name} 改了看得出来`).not.toBe(before);
    }
  }, 60_000);
});
