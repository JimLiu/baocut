import type { AssetRecord, Id, Rate, Sequence, SequenceItem, Track, VersionRef } from '@baocut/protocol';
import { loadRenderPlanner } from './preview-wasm.ts';
import type { FrozenDocument, RenderPlanner, SpeechTranscript } from './render-planner.ts';

/**
 * 界面里的缩略图（元素格、文字预设卡、字幕样式卡、品牌库的 Lottie 贴纸）也由渲染内核画：把要画的几层摆成一个只有
 * 这几层的序列，交给 WASM 画成透明底的一帧，再裁到格子里。与预览、导出同一个实现，缩略图看到的就是落到画面上的样子。
 *
 * 缩略图用同一个编译好的模块的另一个实例（字体照样注入），不与预览抢视频与文档。
 */

let planner: Promise<RenderPlanner> | null = null;

export function thumbnailPlanner(): Promise<RenderPlanner> {
  planner ??= loadRenderPlanner()
    .then((preview) => preview.fork())
    .catch((error: unknown) => {
      planner = null;
      throw error;
    });
  return planner;
}

/** 缩略图里的一层：实例自己的字段（不含 ID、轨道与时间段）。 */
export type ThumbLayer = Record<string, unknown> & { type: string };

/** 要画的场景：一块序列画布上的几层（低层在前，各占一条轨道，都从 0 开始、长 `duration` 秒）。 */
export interface ThumbScene {
  canvas: { width: number; height: number };
  fps?: Rate;
  layers: readonly ThumbLayer[];
  /** 画哪一刻（秒）。 */
  seconds: number;
  /** 各层多长（秒）：进度条、计时与入场出场动画按它算。 */
  duration: number;
  documents?: readonly FrozenDocument[];
  assets?: Record<Id, AssetRecord>;
  /** 素材的字节（Lottie）。 */
  assetBytes?: readonly { asset: VersionRef; bytes: Uint8Array }[];
  /** 声波层的频谱（BCS1）：给所有声波层。 */
  spectrum?: Uint8Array;
  /** 字幕的词从哪份转写来（字幕文档的 `sourceDocumentId` 指向它）：逐词动画按这些词推进。 */
  speech?: readonly SpeechTranscript[];
}

const FPS: Rate = { num: 30, den: 1 };

/** 场景摆成的序列。 */
export function thumbSequence(scene: ThumbScene): Sequence {
  const fps = scene.fps ?? FPS;
  const frames = Math.max(1, Math.round((scene.duration * fps.num) / fps.den));
  const tracks: Track[] = scene.layers.map((layer, index) => ({
    id: `thumb_track_${index}`,
    order: index,
    kind: layer.type === 'caption' ? 'subtitle' : 'visual',
    locked: false,
    visible: true,
    muted: false,
    solo: { enabled: false, group: 'visual' },
  }));
  const items = scene.layers.map((layer, index) => {
    const fields: Record<string, unknown> = { ...layer };
    // 缩略图是静止的一格：各层同时出现，不带动画。
    delete fields.delayFrames;
    delete fields.animate;
    return {
      ...fields,
      id: `thumb_item_${index}`,
      trackId: `thumb_track_${index}`,
      enabled: true,
      locked: false,
      paintOrder: index,
      followPolicy: { kind: 'sequence-fixed' },
      span: { fromFrame: 0, durationFrames: frames },
    } as unknown as SequenceItem;
  });
  return {
    id: 'thumb_sequence',
    revision: '1',
    name: '',
    fps,
    canvas: { width: Math.round(scene.canvas.width), height: Math.round(scene.canvas.height), workingSpace: 'srgb', background: '#000000' },
    durationPolicy: { kind: 'derived' },
    animationBindings: [],
    tracks,
    items,
    transitions: [],
    markers: [],
    ducking: [],
  };
}

const NO_SPEECH: readonly SpeechTranscript[] = [];

/** 各实例上一次送进去的场景（只比引用）与转写：同一张缩略图接着画下一刻时不再重送。 */
const loaded = new WeakMap<RenderPlanner, { scene: ThumbScene | null; speech: readonly SpeechTranscript[] }>();

/** 两个场景除了画哪一刻都相同（同一份层、文档、素材，同样大小与长度）。 */
function sameScene(a: ThumbScene, b: ThumbScene): boolean {
  return (
    a.layers === b.layers &&
    a.documents === b.documents &&
    a.assets === b.assets &&
    a.assetBytes === b.assetBytes &&
    a.spectrum === b.spectrum &&
    a.fps === b.fps &&
    a.duration === b.duration &&
    a.canvas.width === b.canvas.width &&
    a.canvas.height === b.canvas.height
  );
}

/**
 * 把场景画成 `width`×`height` 的透明底画面（与场景画布同比例）。`problems` 是画不出来的东西与内核的提示。
 * 画面复制出来，之后再调 WASM 也不受影响。只换了 `seconds` 的同一个场景（动起来的缩略图）不重送序列与文档。
 */
export function renderThumb(
  planner: RenderPlanner,
  scene: ThumbScene,
  width: number,
  height: number,
): { image: ImageData; problems: string[] } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const last = loaded.get(planner) ?? { scene: null, speech: NO_SPEECH };
  const speech = scene.speech ?? NO_SPEECH;
  // 转写留在实例里：没带转写的场景要清掉上一张字幕卡送进去的那份。
  if (speech !== last.speech) planner.setSpeech(speech);
  if (!last.scene || !sameScene(last.scene, scene)) {
    planner.setVideo({ sequence: thumbSequence(scene), assets: scene.assets ?? {} });
    planner.setDocuments(scene.documents ?? []);
    for (const { asset, bytes } of scene.assetBytes ?? []) planner.setAsset(asset, bytes);
    if (scene.spectrum) {
      for (const [index, layer] of scene.layers.entries())
        if (layer.type === 'visualizer') planner.setSpectrum(`thumb_item_${index}`, scene.spectrum);
    }
  }
  loaded.set(planner, { scene, speech });
  planner.clearPictures();
  const rendered = planner.render(scene.seconds, w, h, { transparent: true });
  const image = new ImageData(new Uint8ClampedArray(planner.frame()), w, h);
  const problems = [...rendered.skipped.map((item) => item.message), ...rendered.warnings.map((warning) => warning.detail)];
  return { image, problems };
}

/** 不透明像素的包围盒（像素）；全透明时是 null。 */
export function opaqueBounds(image: ImageData): { x: number; y: number; width: number; height: number } | null {
  const { data, width, height } = image;
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

let stage: CanvasRenderingContext2D | null = null;

/**
 * 把画面的 `source` 区域画到 `context` 的 `target` 区域（缩放、可以越出画面）。经一块不挂到页面上的画布转一道：
 * `putImageData` 不缩放，也不按透明度叠。
 */
export function drawImage(
  context: CanvasRenderingContext2D,
  image: ImageData,
  source: { x: number; y: number; width: number; height: number },
  target: { x: number; y: number; width: number; height: number },
): void {
  stage ??= document.createElement('canvas').getContext('2d');
  if (!stage) return;
  if (stage.canvas.width !== image.width || stage.canvas.height !== image.height) {
    stage.canvas.width = image.width;
    stage.canvas.height = image.height;
  }
  stage.putImageData(image, 0, 0);
  context.drawImage(stage.canvas, source.x, source.y, source.width, source.height, target.x, target.y, target.width, target.height);
}

const queue: (() => void)[] = [];
let draining = false;

/**
 * 排队画一张缩略图：一次画一张、之间让出主线程，一屏几十个格子不会一口气卡住界面。返回取消函数（还没轮到的不画）。
 */
export function scheduleThumb(task: () => void): () => void {
  let live = true;
  queue.push(() => live && task());
  if (!draining) {
    draining = true;
    setTimeout(drain, 0);
  }
  return () => {
    live = false;
  };
}

function drain(): void {
  const task = queue.shift();
  if (!task) {
    draining = false;
    return;
  }
  try {
    task();
  } finally {
    setTimeout(drain, 0);
  }
}
