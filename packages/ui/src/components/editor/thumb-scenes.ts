import type { AssetRecord, Rate, VersionRef } from '@baocut/protocol';
import { thumbScene } from '../../model/caption-presets.ts';
import type { VisualLayer } from '../../model/new-items.ts';
import { poseOf, type PlacedItem } from '../../model/stage-pose.ts';
import { presetLayers, type MeasureText, type TextPreset } from '../../model/text-presets.ts';
import { CONFETTI_RANGES, confettiDefaults } from '../../render/confetti.ts';
import type { FrozenDocument, RenderPlanner } from '../../render/render-planner.ts';
import { STUDIO_STYLE, type Json, type LineKind } from '../../render/text-style.ts';
import { opaqueBounds, renderThumb, type ThumbLayer, type ThumbScene } from '../../render/thumbnails.ts';

/**
 * 各种缩略图怎么摆成渲染内核的一帧、再怎么贴进格子。尺寸都是格子的设备像素；返回要贴的几块画面，由组件画到画布上。
 * 与预览、导出同一个内核：格子里看到的就是落到画面上的样子。
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 把 `image` 的 `source` 区域贴到格子的 `target` 区域（缩放，可以越出格子）。 */
export interface Blit {
  image: ImageData;
  source: Rect;
  target: Rect;
}

/** 一张缩略图：要贴的画面与内核画不出来的东西（按层说明原因）。 */
export interface ThumbPicture {
  blits: Blit[];
  problems: string[];
}

type Size = { width: number; height: number };

/** 一帧最长边（设备像素）：小元素放大到格子时整帧会很大，超过就画小一点再放大贴。 */
export const MAX_SIDE = 1600;

/** 静止的缩略图停在哪一刻：各层长 10 秒，停在第 6 秒（进度六成；入场早已结束）。 */
const STILL = { seconds: 6, duration: 10 };

let sample: Uint8Array | null = null;

/**
 * 声波格没有声音可听：一份假的频谱（BCS1，帧都一样），频域一排起伏、时域一段正弦，画法照真的样式。频域按缺省的
 * dB 窗（−80 到 +40）给出两到八成五的高度，换算到 BCS1 的 canonical 窗（−120 到 +40）。
 */
export function sampleSpectrum(): Uint8Array {
  if (sample) return sample;
  const [frames, timeBins, freqBins] = [30, 128, 512];
  const out = new Uint8Array(40 + frames * (timeBins + freqBins));
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode('BCS1'), 0);
  view.setUint16(4, 1, true);
  [60, 48_000, 1024, timeBins, freqBins, frames].forEach((value, index) => view.setUint32(8 + index * 4, value, true));
  const time = Array.from({ length: timeBins }, (_, index) => {
    const u = index / timeBins;
    const value = 0.55 * Math.sin(Math.PI * 2 * 3 * u) * (0.6 + 0.4 * Math.sin(Math.PI * 2 * u + 1));
    return Math.round(128 + value * 127);
  });
  const freq = Array.from({ length: freqBins }, (_, index) => {
    const band = (index * 64) / freqBins;
    const level = 0.25 + 0.6 * Math.abs(Math.sin(Math.floor(band) * 0.42)) * (1 - band / 128);
    const db = -80 + 120 * level;
    return Math.round(((db + 120) / 160) * 255);
  });
  for (let frame = 0; frame < frames; frame++) {
    const at = 40 + frame * (timeBins + freqBins);
    out.set(time, at);
    out.set(freq, at + timeBins);
  }
  sample = out;
  return out;
}

function whole(image: ImageData): Rect {
  return { x: 0, y: 0, width: image.width, height: image.height };
}

/**
 * 新建的一层（元素格）：整帧按框缩到格子的 84%，框的中心对到格子中心；描边、阴影越出框也照样贴上。声波层用
 * [`sampleSpectrum`] 的假频谱。
 */
export function layerThumb(planner: RenderPlanner, layer: VisualLayer, canvas: Size, width: number, height: number): ThumbPicture {
  const box = poseOf(layer as unknown as PlacedItem, canvas);
  const fit = Math.min((width * 0.84) / box.w, (height * 0.84) / box.h);
  const scale = Math.min(fit, MAX_SIDE / Math.max(canvas.width, canvas.height));
  const scene: ThumbScene = {
    canvas,
    layers: [layer as unknown as ThumbLayer],
    ...STILL,
    ...(layer.type === 'visualizer' ? { spectrum: sampleSpectrum() } : {}),
  };
  const { image, problems } = renderThumb(planner, scene, canvas.width * scale, canvas.height * scale);
  const target = { x: width / 2 - box.cx * fit, y: height / 2 - box.cy * fit, width: canvas.width * fit, height: canvas.height * fit };
  return { blits: [{ image, source: whole(image), target }], problems };
}

/** 彩纸格停在哪一刻：四种爆发间隔都已炸过且散开，连续款已进稳态。 */
export const CONFETTI_STILL = 4.5;
/** 悬停时播的那一段循环有多长。 */
export const CONFETTI_LOOP = 4;

/**
 * 彩纸格：铺满格子的一层粒子，同一枚种子（11）恒得同一幅。格子按短边 / 540 缩放后粒子只剩一两个像素，所以把
 * 「大小」推到上限好认款——只是画格子这一笔，落到画面上的仍是配方原样。
 */
export function confettiThumb(planner: RenderPlanner, styleKey: string, seconds: number, width: number, height: number): ThumbPicture {
  const props = { ...confettiDefaults(styleKey, 11), size: CONFETTI_RANGES.size[1] };
  const confetti = Object.fromEntries(Object.entries(props).filter(([, value]) => value !== null));
  const layer: ThumbLayer = { type: 'confetti', place: { x: 50, y: 50, w: 100 }, confetti };
  const scene: ThumbScene = { canvas: { width, height }, layers: [layer], seconds, duration: CONFETTI_STILL + CONFETTI_LOOP + 0.5 };
  const { image, problems } = renderThumb(planner, scene, width, height);
  return { blits: [{ image, source: whole(image), target: whole(image) }], problems };
}

/** Lottie 文件头里取停帧要的几项。读不懂时为 null。 */
export function lottieMeta(bytes: Uint8Array): { seconds: number; width: number; height: number } | null {
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    const [ip, op, fr, w, h] = [value.ip, value.op, value.fr, value.w, value.h].map(Number) as [number, number, number, number, number];
    if (![ip, op, fr, w, h].every(Number.isFinite) || fr <= 0 || op <= ip || w <= 0 || h <= 0) return null;
    return { seconds: (op - ip) / fr, width: w, height: h };
  } catch {
    return null;
  }
}

/** 同一个 URL 给同一个素材 ID（内核按素材缓存解好的动画）。 */
function lottieAsset(key: string, byteLength: number): { ref: VersionRef; record: AssetRecord } {
  let hash = 5381;
  for (let index = 0; index < key.length; index++) hash = ((hash * 33) ^ key.charCodeAt(index)) >>> 0;
  const id = `thumb_lottie_${hash.toString(16)}`;
  const record = {
    id,
    kind: 'lottie',
    name: `${id}.json`,
    currentRevision: 'r1',
    revisions: {
      r1: {
        revision: 'r1',
        contentHash: `thumb:${id}`,
        byteLength,
        mediaType: 'application/json',
        storage: { mode: 'managed' },
        provenance: { origin: 'import' },
      },
    },
  } as unknown as AssetRecord;
  return { ref: { id, revision: 'r1' }, record };
}

/**
 * 品牌库的 Lottie 贴纸：铺在格子里（按宽高比装下），停在动画正中那一帧（开头常常还是空的），`elapsed` 秒后接着循环。
 * `key` 是文件的地址，同一个文件只解一次。
 */
export function lottieThumb(
  planner: RenderPlanner,
  key: string,
  bytes: Uint8Array,
  elapsed: number,
  width: number,
  height: number,
): ThumbPicture {
  const meta = lottieMeta(bytes);
  const { ref, record } = lottieAsset(key, bytes.length);
  const w = meta ? Math.min(100, 100 * (height / width) * (meta.width / meta.height)) : 100;
  const layer: ThumbLayer = { type: 'sticker', place: { x: 50, y: 50, w }, sticker: { source: 'asset' }, assetRef: ref };
  const scene: ThumbScene = {
    canvas: { width, height },
    layers: [layer],
    seconds: (meta ? meta.seconds / 2 : 0) + elapsed,
    duration: 3600,
    assets: { [ref.id]: record },
    assetBytes: [{ asset: ref, bytes }],
  };
  const { image, problems } = renderThumb(planner, scene, width, height);
  return { blits: [{ image, source: whole(image), target: whole(image) }], problems };
}

/** 场景卡放大的倍数：卡片裁到这一组包围盒的 1.35 倍宽，标题与缩在角落的下三分落到格子里字号同一量级。 */
const CROP = 1.35;

/**
 * 文字预设卡。字样卡（`stack`）：各行字单独画，字号正好是预设的 `previewSize`（乘像素密度），排成一列居中，放不下
 * 再整体缩。场景卡：整帧按预设画（16:9），裁到这一组的包围盒。框宽由同一个内核实例量（与新建时同一个量法）。
 */
export function presetThumb(
  planner: RenderPlanner,
  preset: TextPreset,
  fps: Rate,
  ratio: number,
  width: number,
  height: number,
): ThumbPicture {
  const measureOn =
    (canvas: Size): MeasureText =>
    (text, style, wrapWidth) =>
      planner.measureText(text, style, wrapWidth, canvas);
  return preset.layout === 'stack'
    ? stackThumb(planner, preset, measureOn, ratio, width, height)
    : sceneThumb(planner, preset, fps, measureOn, width, height);
}

function stackThumb(
  planner: RenderPlanner,
  preset: TextPreset,
  measureOn: (canvas: Size) => MeasureText,
  ratio: number,
  width: number,
  height: number,
): ThumbPicture {
  const problems: string[] = [];
  const rows: { image: ImageData; bounds: Rect }[] = [];
  for (const layer of preset.layers) {
    if (layer.kind !== 'text') continue;
    const style = layer.style ?? {};
    const fontSize = typeof style.fontSize === 'number' ? style.fontSize : 24;
    // 画布短边取多大，这一行的字号正好是 previewSize。
    const short = (540 * (layer.previewSize ?? 12) * ratio) / fontSize;
    const box = measureOn({ width: (short * 16) / 9, height: short })(layer.text ?? '', style, null);
    const canvas = { width: Math.max((short * 16) / 9, box.width * 1.5), height: short };
    // 框宽留一成余量：量字的画布按整像素取，与画的尺寸差一点舍入时也不折行（画完按不透明的范围裁，框宽不影响摆放）。
    const w = ((box.width * 1.1) / canvas.width) * 100;
    const text: ThumbLayer = { type: 'text', text: layer.text ?? '', style, place: { x: 50, y: 50, w } };
    const rendered = renderThumb(planner, { canvas, layers: [text], ...STILL }, canvas.width, canvas.height);
    problems.push(...rendered.problems);
    const bounds = opaqueBounds(rendered.image);
    if (bounds) rows.push({ image: rendered.image, bounds });
  }
  const gap = 3 * ratio;
  const total = rows.reduce((sum, row) => sum + row.bounds.height, 0) + gap * Math.max(0, rows.length - 1);
  const widest = Math.max(1, ...rows.map((row) => row.bounds.width));
  const margin = 12 * ratio;
  const fit = Math.min(1, (width - margin) / widest, (height - margin) / Math.max(1, total));
  let top = height / 2 - (total * fit) / 2;
  const blits = rows.map(({ image, bounds }): Blit => {
    const target = { x: width / 2 - (bounds.width * fit) / 2, y: top, width: bounds.width * fit, height: bounds.height * fit };
    top += (bounds.height + gap) * fit;
    return { image, source: bounds, target };
  });
  return { blits, problems };
}

function sceneThumb(
  planner: RenderPlanner,
  preset: TextPreset,
  fps: Rate,
  measureOn: (canvas: Size) => MeasureText,
  width: number,
  height: number,
): ThumbPicture {
  const crop = Math.min(100, Math.max(preset.box.w * CROP, 20));
  const inner = width * (100 / crop);
  const canvas = { width: inner, height: (inner * 9) / 16 };
  const layers = presetLayers(preset, canvas, fps, measureOn(canvas)) as unknown as ThumbLayer[];
  const scale = Math.min(1, MAX_SIDE / inner);
  const { image, problems } = renderThumb(planner, { canvas, layers, ...STILL }, canvas.width * scale, canvas.height * scale);
  // 包围盒的中心对到卡片中心。
  const target = {
    x: width / 2 - (preset.box.x / 100) * canvas.width,
    y: height / 2 - (preset.box.y / 100) * canvas.height,
    width: canvas.width,
    height: canvas.height,
  };
  return { blits: [{ image, source: whole(image), target }], problems };
}

/** 字幕样张的场景：每种行一份字幕文档（一句，从 0 到 10 秒），共用一份样式文档。 */
function captionScene(root: Json, lines: readonly { kind: LineKind; text: string }[], canvas: Size): ThumbScene {
  // 样张是静止的：不带入场与逐词高亮（卡片画的是样式，不是某一刻）。
  const style = { ...root, anim: { name: 'None' } };
  const documents: FrozenDocument[] = [
    { documentId: 'thumb_style', kind: 'caption-style', schema: STUDIO_STYLE, body: { schema: STUDIO_STYLE, style } },
    ...lines.map((line): FrozenDocument => ({
      documentId: `thumb_${line.kind}`,
      kind: 'caption',
      schema: 'baocut.caption/1',
      lineKind: line.kind,
      body: {
        schema: 'baocut.caption/1',
        clock: 'sequence',
        timescale: 1000,
        cues: [{ id: 'c0', start: 0, end: 10_000, text: line.text }],
      },
    })),
  ];
  const layers = lines.map((line): ThumbLayer => ({
    type: 'caption',
    documentId: `thumb_${line.kind}`,
    styleDocumentId: 'thumb_style',
    scopeItemIds: [],
  }));
  return { canvas, layers, documents, seconds: 5, duration: 10 };
}

/**
 * 字幕样式卡：按这份样式画英中样张，大的那一行 `px` 设备像素。缩略图不折行：先在四倍宽的画布上画一遍量出样张的
 * 宽高，放不下就整体缩小再画。底色由组件铺。
 */
export function captionThumb(
  planner: RenderPlanner,
  root: Json,
  kinds: readonly LineKind[],
  px: number,
  width: number,
  height: number,
): ThumbPicture {
  const scene = thumbScene(root, kinds, { width, height }, px);
  const wide = renderThumb(planner, captionScene(scene.root, scene.lines, { width: width * 4, height }), width * 4, height);
  const bounds = opaqueBounds(wide.image);
  const fit = bounds ? Math.min(1, (width * 0.92) / bounds.width, (height * 0.9) / bounds.height) : 1;
  const sized = fit < 1 ? { ...scene.root, scale: (typeof scene.root.scale === 'number' ? scene.root.scale : 1) * fit } : scene.root;
  const { image, problems } = renderThumb(planner, captionScene(sized, scene.lines, { width, height }), width, height);
  return { blits: [{ image, source: whole(image), target: whole(image) }], problems };
}
