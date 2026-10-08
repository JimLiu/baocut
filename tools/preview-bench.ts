// 预览内核的逐帧基准（开发流程 §2 的可选检查）：在 Node 里用编好的预览 WASM（与编辑器同一份 `RenderPlanner`）连续画 N 帧，
// 按阶段记耗时：求计划（planAt）、送画面（setPicture，含预乘）、画帧（bc_render，含 WASM 里再求一次计划与结果 JSON）、
// 取帧（从 WASM 内存拷出，相当于 putImageData 那一份拷贝）；再按层做消融（停用一层或关掉字幕再画），得到每层的光栅开销。
//
// 场景：
// - 缺省是合成的场景，取自一致性夹具（`crates/frame-render/tests/fixtures/parity.json`，画面是竖条），放大到 `--size` 画；
// - `--video <视频目录>`（可多次）：本机的视频（只用副本），经引擎宿主的 `videos.open` 与 `exports.plan` 冻结，视频层的源画面
//   由 ffmpeg 解出来（按预览读像素的尺寸，循环用一小段），字幕与转写照导出冻结的那份送。要先 `cargo build -p engine-host`。
//
// 用法：node tools/preview-bench.ts [--video <目录>]... [--at <秒>] [--frames 60] [--size 1920x1080,960x540]
//       [--playback]（按预览播放时的尺寸规则另画一组）[--wasm <预览 WASM>]... [--no-ablate] [--json <输出文件>]
// `--wasm` 给两份以上时逐帧轮流画（同一场景、同一尺寸），用来比改动前后：机器忙的时候绝对值会飘，轮流画的比值仍然可信。
// 输出带上当时的负载（loadavg 与核数）。
// 环境：CARGO_TARGET_DIR（找 engine-host），BAOCUT_FFMPEG / BAOCUT_FFPROBE（缺省 PATH 里的 ffmpeg、ffprobe）。

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { RenderPlanner, type FrozenDocument } from '../packages/ui/src/render/render-planner.ts';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const WASM = join(ROOT, 'packages/ui/src/render/generated/preview.wasm');
const FONTS = join(ROOT, 'crates/render-raster/assets/fonts');
const FIXTURE = join(ROOT, 'crates/frame-render/tests/fixtures/parity.json');
const FFMPEG = process.env.BAOCUT_FFMPEG ?? 'ffmpeg';
const FFPROBE = process.env.BAOCUT_FFPROBE ?? 'ffprobe';

interface Options {
  videos: string[];
  at: number | null;
  frames: number;
  sizes: { width: number; height: number }[];
  playback: boolean;
  json: string | null;
  ablate: boolean;
  wasms: string[];
}

function parseOptions(argv: string[]): Options {
  const options: Options = { videos: [], at: null, frames: 60, sizes: [], playback: false, json: null, ablate: true, wasms: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--video') options.videos.push(resolve(argv[++i]!));
    else if (arg === '--at') options.at = Number(argv[++i]);
    else if (arg === '--frames') options.frames = Number(argv[++i]);
    else if (arg === '--size')
      options.sizes = argv[++i]!.split(',').map((size) => {
        const [width, height] = size.split('x').map(Number);
        return { width: width!, height: height! };
      });
    else if (arg === '--playback') options.playback = true;
    else if (arg === '--no-ablate') options.ablate = false;
    else if (arg === '--json') options.json = resolve(argv[++i]!);
    else if (arg === '--wasm') options.wasms.push(resolve(argv[++i]!));
    else throw new Error(`不认识的参数 ${arg}`);
  }
  return options;
}

/** 一个基准场景：视频、文档、素材字节，与每一帧各层的源画面。 */
interface Scene {
  name: string;
  fps: number;
  canvas: { width: number; height: number };
  start: number;
  video: { sequence: any; assets: Record<string, any> };
  documents: FrozenDocument[];
  assets: { asset: { id: string; revision: string }; bytes: Uint8Array }[];
  audioSpectra: { asset: { id: string; revision: string }; bytes: Uint8Array }[];
  /** 素材的文件（声波要的素材频谱从它的声音算）；合成场景没有。 */
  file?(asset: { id: string; revision: string }): string | null;
  /** 层的源画面：第 `index` 帧、实例、输出尺寸 → RGBA。 */
  picture(itemId: string, kind: string, asset: { id: string; revision: string }, index: number, seconds: number, out: Size): Picture | null;
  close(): void;
}

interface Size {
  width: number;
  height: number;
}

interface Picture {
  rgba: Uint8Array;
  width: number;
  height: number;
}

// ---------- 合成的场景 ----------

type Rgba = [number, number, number, number];

function bands(width: number, height: number, colours: Rgba[]): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const row = new Uint8Array(width * 4);
  for (let x = 0; x < width; x++) row.set(colours[Math.floor((x * colours.length) / width)]!, x * 4);
  for (let y = 0; y < height; y++) out.set(row, y * width * 4);
  return out;
}

/**
 * 合成场景：夹具里的场景按名字挑出来，把实例与文档并成一个序列（各场景的轨道与实例 ID 不冲突就直接并），画面是竖条。
 * 视频层的源画面按 1920×1080 给（与真实 1080p 素材同样的上传量）。
 */
function syntheticScenes(): Scene[] {
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const byName = new Map<string, any>(fixture.scenes.map((scene: any) => [scene.name, scene]));
  const merge = (name: string, parts: string[]): Scene => {
    const scenes = parts.map((part) => {
      const scene = byName.get(part);
      if (!scene) throw new Error(`夹具里没有场景 ${part}`);
      return scene;
    });
    const base = structuredClone(scenes[0].video.sequences[fixture.sequenceId]);
    const assets: Record<string, any> = { ...scenes[0].video.assets };
    for (const scene of scenes.slice(1)) {
      const sequence = scene.video.sequences[fixture.sequenceId];
      for (const track of sequence.tracks ?? []) if (!base.tracks.some((t: any) => t.id === track.id)) base.tracks.push(track);
      for (const item of sequence.items) if (!base.items.some((i: any) => i.id === item.id)) base.items.push(item);
      if (sequence.animationBindings?.length) base.animationBindings = [...(base.animationBindings ?? []), ...sequence.animationBindings];
      Object.assign(assets, scene.video.assets);
    }
    const pictures = new Map<string, { width: number; height: number; bands: Rgba[] }>();
    for (const scene of scenes) for (const picture of scene.pictures) pictures.set(picture.itemId, picture);
    const big = new Map<string, Picture>();
    return {
      name,
      fps: fixture.fps,
      canvas: { width: base.canvas.width, height: base.canvas.height },
      start: 0,
      video: { sequence: base, assets },
      documents: scenes.flatMap((scene) => scene.documents),
      assets: scenes.flatMap((scene) =>
        scene.assets.map((asset: any) => {
          const [id, revision] = asset.key.split('@');
          const bytes = asset.hex === undefined ? new TextEncoder().encode(asset.text) : new Uint8Array(Buffer.from(asset.hex, 'hex'));
          return { asset: { id, revision }, bytes };
        }),
      ),
      audioSpectra: scenes.flatMap((scene) =>
        scene.audioSpectra.map((spectrum: any) => {
          const [id, revision] = spectrum.key.split('@');
          return { asset: { id, revision }, bytes: new Uint8Array(Buffer.from(spectrum.hex, 'hex')) };
        }),
      ),
      picture(itemId, _kind, _asset, _index, _seconds, out) {
        const source = pictures.get(itemId);
        if (!source) return null;
        // 按预览读像素的规则：不比输出大，按铺满输出缩小（源当作 16:9 的 1080p）。
        const fit = Math.min(1, Math.max(out.width / 1920, out.height / 1080));
        const width = Math.max(1, Math.round(1920 * fit));
        const height = Math.max(1, Math.round(1080 * fit));
        const key = `${itemId}:${width}x${height}`;
        if (!big.has(key)) big.set(key, { rgba: bands(width, height, source.bands), width, height });
        return big.get(key)!;
      },
      close() {},
    };
  };
  return [
    merge('合成：视频 + 双语字幕', ['video-source-time', 'captions-bilingual']),
    merge('合成：视频 + 多种元素', [
      'video-source-time',
      'text-styled',
      'shape-rounded',
      'progress',
      'counter',
      'visualizer-spectrum',
      'sticker-lottie',
      'captions-studio',
    ]),
  ];
}

// ---------- 本机的视频（副本） ----------

class EngineHost {
  readonly #child;
  readonly #pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  #next = 1;
  constructor(binary: string) {
    this.#child = spawn(binary, [], { env: { ...process.env, BAOCUT_FFPROBE: FFPROBE }, stdio: ['pipe', 'pipe', 'inherit'] });
    createInterface({ input: this.#child.stdout! }).on('line', (line) => {
      const message = JSON.parse(line);
      const waiting = message.id == null ? undefined : this.#pending.get(message.id);
      if (!waiting) return;
      this.#pending.delete(message.id);
      if (message.error) waiting.reject(new Error(`${message.error.code} ${message.error.message}`));
      else waiting.resolve(message.result);
    });
  }
  request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const id = this.#next++;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#child.stdin!.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }
  close(): void {
    this.#child.stdin!.end();
  }
}

const probed = new Map<string, Size>();

/** 源的显示尺寸（按旋转换宽高），按路径记住：每帧都要用，不能每次起一个 ffprobe。 */
function probe(file: string): Size {
  const known = probed.get(file);
  if (known) return known;
  const result = spawnSync(
    FFPROBE,
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:stream_side_data=rotation', '-of', 'json', file],
    { encoding: 'utf8' },
  );
  const stream = JSON.parse(result.stdout).streams[0];
  const rotation = Math.abs(Number(stream.side_data_list?.find((d: any) => d.rotation !== undefined)?.rotation ?? 0));
  const size =
    rotation === 90 || rotation === 270 ? { width: stream.height, height: stream.width } : { width: stream.width, height: stream.height };
  probed.set(file, size);
  return size;
}

/** 从 `seconds` 起解 `count` 帧，缩到 `width`×`height` 的 RGBA。 */
function decodeRun(file: string, seconds: number, count: number, width: number, height: number): Uint8Array[] {
  const result = spawnSync(
    FFMPEG,
    [
      '-v',
      'error',
      '-ss',
      seconds.toFixed(3),
      '-i',
      file,
      '-frames:v',
      String(count),
      '-vf',
      `scale=${width}:${height}`,
      '-an',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      'pipe:1',
    ],
    { maxBuffer: 4 * 1024 * 1024 * 1024 },
  );
  const size = width * height * 4;
  const frames: Uint8Array[] = [];
  for (let offset = 0; offset + size <= result.stdout.length; offset += size)
    frames.push(new Uint8Array(result.stdout.subarray(offset, offset + size)));
  return frames;
}

/** 素材的声音解成 48 kHz 单声道 f32（预览用 Web Audio 解好后送进同一份分析）。 */
function decodeAudio(file: string): Float32Array {
  const result = spawnSync(FFMPEG, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1'], {
    maxBuffer: 4 * 1024 * 1024 * 1024,
  });
  const bytes = result.stdout;
  return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 4)).slice();
}

/** 真实视频里的声波：画一帧看缺哪些素材频谱，按预览的路子算好放进场景（不放的话声波按静止的样子画，量不到它）。 */
async function addAudioSpectra(base: RenderPlanner, scene: Scene): Promise<void> {
  if (!scene.file) return;
  const planner = await prepare(base, scene);
  const wanted = new Map<string, { id: string; revision: string }>();
  for (let seconds = scene.start; seconds < scene.start + 2; seconds += 0.5) {
    for (const { asset } of planner.render(seconds, 64, 36).spectra) wanted.set(`${asset.id}@${asset.revision}`, asset);
  }
  for (const asset of wanted.values()) {
    const file = scene.file(asset);
    if (!file) continue;
    scene.audioSpectra.push({ asset, bytes: await base.analyzeAudio([decodeAudio(file)]) });
  }
}

async function videoScene(host: EngineHost, dir: string, at: number | null, frames: number): Promise<Scene> {
  const opened = await host.request<any>('videos.open', { path: dir });
  const snapshot = opened.snapshot;
  const sequence = snapshot.sequences[snapshot.rootSequenceId];
  const rate = sequence.fps;
  const fps = rate.num / rate.den;
  const plan = await host.request<any>('exports.plan', { videoId: opened.videoId, kind: 'video' });
  await host.request('videos.close', { videoId: opened.videoId });
  const frozen = plan.document.sequences[plan.sequenceId];
  const paths = new Map<string, any>(plan.assets.map((a: any) => [`${a.assetId}@${a.revision}`, a]));
  const assets: Scene['assets'] = [];
  for (const asset of plan.assets) {
    const type = asset.mediaType ?? '';
    if (/json|lottie|svg|gif/.test(type) || /\.(json|lottie|svg|gif)$/i.test(asset.path)) {
      assets.push({ asset: { id: asset.assetId, revision: asset.revision }, bytes: new Uint8Array(readFileSync(asset.path)) });
    }
  }
  const canvas = { width: frozen.canvas.width, height: frozen.canvas.height };
  const decoded = new Map<string, Uint8Array[]>();
  const stills = new Map<string, Picture>();
  // 源画面循环用的帧数：真实的解码内容对光栅耗时影响很小，不必把每一帧都放进内存。
  const run = Math.min(frames, 24);
  return {
    name: dir.split('/').pop()!,
    fps,
    canvas,
    start: at ?? 0,
    video: { sequence: frozen, assets: plan.document.assets },
    documents: plan.documents,
    assets,
    audioSpectra: [],
    file: (asset) => paths.get(`${asset.id}@${asset.revision}`)?.path ?? null,
    picture(itemId, kind, asset, index, seconds, out) {
      const entry = paths.get(`${asset.id}@${asset.revision}`);
      if (!entry) return null;
      const size = probe(entry.path);
      const fit = Math.min(1, Math.max(out.width / size.width, out.height / size.height));
      const width = Math.max(2, Math.round(size.width * fit));
      const height = Math.max(2, Math.round(size.height * fit));
      if (kind === 'image') {
        const key = `${itemId}:${width}x${height}`;
        if (!stills.has(key)) stills.set(key, { rgba: decodeRun(entry.path, 0, 1, width, height)[0]!, width, height });
        return stills.get(key)!;
      }
      const key = `${itemId}:${width}x${height}`;
      if (!decoded.has(key)) decoded.set(key, decodeRun(entry.path, seconds, run, width, height));
      const list = decoded.get(key)!;
      if (list.length === 0) return null;
      return { rgba: list[index % list.length]!, width, height };
    },
    close() {},
  };
}

// ---------- 计时 ----------

interface Stages {
  plan: number[];
  upload: number[];
  render: number[];
  readback: number[];
  total: number[];
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

function summary(values: number[]): { p50: number; p95: number; max: number } {
  const round = (value: number) => Math.round(value * 100) / 100;
  return { p50: round(quantile(values, 0.5)), p95: round(quantile(values, 0.95)), max: round(Math.max(0, ...values)) };
}

async function prepare(base: RenderPlanner, scene: Scene): Promise<RenderPlanner> {
  const planner = await base.fork();
  planner.setVideo(scene.video);
  planner.setDocuments(scene.documents);
  for (const { asset, bytes } of scene.assets) planner.setAsset(asset, bytes);
  for (const { asset, bytes } of scene.audioSpectra) planner.setAudioSpectrum(asset, bytes);
  return planner;
}

/** 画一帧：与预览引擎一帧里的 WASM 调用相同（求计划、送画面、画、取帧），返回各段耗时。 */
function frame(planner: RenderPlanner, scene: Scene, index: number, seconds: number, size: Size, captions = true) {
  const t0 = performance.now();
  const plan = planner.planAt(seconds);
  const t1 = performance.now();
  planner.clearPictures();
  const layers = plan.layers.flatMap((layer: any) => (layer.transition?.partner ? [layer, layer.transition.partner] : [layer]));
  for (const layer of layers) {
    if (layer.kind !== 'video' && layer.kind !== 'image') continue;
    const picture = scene.picture(layer.itemId, layer.kind, layer.asset, index, layer.sourceSeconds ?? 0, size);
    if (picture) planner.setPicture(layer.itemId, picture.rgba, picture.width, picture.height);
  }
  const t2 = performance.now();
  const rendered = planner.render(seconds, size.width, size.height, { captions });
  const t3 = performance.now();
  const pixels = new Uint8ClampedArray(planner.frame());
  const t4 = performance.now();
  return { plan: t1 - t0, upload: t2 - t1, render: t3 - t2, readback: t4 - t3, total: t4 - t0, layers, rendered, pixels };
}

/** 没给 `--at` 时从层最多的一刻开始（每 0.25 秒看一次计划，最多看前 20 分钟）。 */
async function busiest(base: RenderPlanner, scene: Scene): Promise<number> {
  const planner = await prepare(base, scene);
  let best = { seconds: 0, layers: -1 };
  for (let seconds = 0; seconds < 1200; seconds += 0.25) {
    let plan;
    try {
      plan = planner.planAt(seconds);
    } catch {
      break;
    }
    if (plan.layers.length === 0 && plan.voices.length === 0 && seconds > 0) break;
    const layers = plan.layers.length + plan.layers.filter((layer: any) => layer.transition?.partner).length;
    if (layers > best.layers) best = { seconds, layers };
  }
  return best.seconds;
}

/** 一份预览 WASM：标签（文件名）与载入好字体的计划器。 */
interface Kernel {
  label: string;
  base: RenderPlanner;
}

/**
 * 量一个场景在一个尺寸上的耗时：每份 WASM 先各画第一帧（另记），之后逐帧轮流画 `frames` 帧，最后按层消融。
 * 轮流画让机器的忙闲对各份 WASM 一样。
 */
async function measure(kernels: Kernel[], scene: Scene, size: Size, frames: number, ablate: boolean) {
  const runs = [];
  for (const kernel of kernels) {
    const planner = await prepare(kernel.base, scene);
    // 预热：建排版引擎、编字幕、解 Lottie（第一帧另记，只算内核画的那一段，不算取画面）。
    const firstMs = frame(planner, scene, 0, scene.start, size).render;
    runs.push({
      kernel,
      planner,
      firstMs,
      layerCount: 0,
      stages: { plan: [], upload: [], render: [], readback: [], total: [] } as Stages,
    });
  }
  for (let i = 0; i < frames; i++) {
    const seconds = scene.start + i / scene.fps;
    for (const run of runs) {
      const result = frame(run.planner, scene, i, seconds, size);
      for (const key of ['plan', 'upload', 'render', 'readback', 'total'] as const) run.stages[key].push(result[key]);
      run.layerCount = Math.max(run.layerCount, result.layers.length);
    }
  }
  const results = [];
  for (const run of runs) {
    // 播放与停住来回切：先按另一个尺寸（降过的分辨率）画一帧，再切回这个尺寸画同一帧，取三次的中位数。
    const other = {
      width: Math.max(2, Math.round((size.width * 0.73) / 2) * 2),
      height: Math.max(2, Math.round((size.height * 0.73) / 2) * 2),
    };
    const middle = Math.floor(frames / 2);
    const mid = scene.start + middle / scene.fps;
    // 第一次按另一个尺寸画（停着之后第一次播放）：那个尺寸的渲染器还是空的。
    const newSizeMs = frame(run.planner, scene, middle, mid, other).render;
    const switches: number[] = [];
    for (let k = 0; k < 3; k++) {
      frame(run.planner, scene, middle, mid, other);
      switches.push(frame(run.planner, scene, middle, mid, size).total);
    }
    // 消融：在中间一刻逐层停用（字幕层用开关），各画几次取中位数，差值就是这一层的光栅开销。
    const layers: Record<string, number> = {};
    if (ablate) {
      const { planner } = run;
      const median = (once: () => number) => quantile([once(), once(), once(), once(), once()], 0.5);
      const full = median(() => frame(planner, scene, middle, mid, size).render);
      const plan = planner.planAt(mid);
      const captions = plan.layers.some((layer: any) => layer.kind === 'caption');
      if (captions) layers['captions'] = full - median(() => frame(planner, scene, middle, mid, size, false).render);
      for (const layer of plan.layers) {
        if (layer.kind === 'caption') continue;
        const sequence = structuredClone(scene.video.sequence);
        const item = sequence.items.find((candidate: any) => candidate.id === layer.itemId);
        if (!item) continue;
        item.enabled = false;
        const ablated = await prepare(run.kernel.base, { ...scene, video: { sequence, assets: scene.video.assets } });
        frame(ablated, scene, middle, mid, size);
        const without = median(() => frame(ablated, scene, middle, mid, size).render);
        const label = `${layer.kind}${layer.kind === 'generator' ? `:${(layer as any).content.generator.replace('baocut.', '')}` : ''}:${layer.itemId.slice(0, 6)}`;
        layers[label] = Math.round((full - without) * 100) / 100;
      }
      layers['(整帧)'] = Math.round(full * 100) / 100;
    }
    results.push({
      scene: scene.name,
      kernel: run.kernel.label,
      start: scene.start,
      size: `${size.width}x${size.height}`,
      fps: Math.round(scene.fps * 100) / 100,
      layers: run.layerCount,
      firstFrameMs: Math.round(run.firstMs),
      newSizeMs: Math.round(newSizeMs),
      switchMs: Math.round(quantile(switches, 0.5) * 10) / 10,
      load: load(),
      stages: Object.fromEntries(Object.entries(run.stages).map(([key, values]) => [key, summary(values)])),
      perLayer: layers,
    });
  }
  return results;
}

/** 当时的负载：1 分钟 loadavg 与核数（超过核数时绝对值不可信，只看轮流画的比值）。 */
function load(): string {
  return `${loadavg()[0]!.toFixed(1)}/${cpus().length}`;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const wasms = options.wasms.length > 0 ? options.wasms : [WASM];
  const kernels: Kernel[] = [];
  for (const wasm of wasms) {
    if (!existsSync(wasm)) throw new Error(`没有 ${wasm}：先运行 npm run build:wasm`);
    const base = await RenderPlanner.instantiate(readFileSync(wasm));
    base.addFonts(base.fontFiles().map((name) => new Uint8Array(readFileSync(join(FONTS, name)))));
    kernels.push({ label: wasm.split('/').pop()!, base });
  }

  const scenes: Scene[] = [];
  let host: EngineHost | null = null;
  if (options.videos.length > 0) {
    const target = process.env.CARGO_TARGET_DIR ?? join(ROOT, 'target');
    const binary = join(target, 'debug/engine-host');
    if (!existsSync(binary)) throw new Error(`没有 ${binary}：先 cargo build -p engine-host`);
    // 引擎宿主的 Home 放进临时目录，不碰真实的应用数据。
    const home = mkdtempSync(join(tmpdir(), 'baocut-preview-bench-'));
    process.env.BAOCUT_HOME = home;
    host = new EngineHost(binary);
    for (const dir of options.videos) scenes.push(await videoScene(host, dir, options.at, options.frames));
    host.close();
    rmSync(home, { recursive: true, force: true });
  } else scenes.push(...syntheticScenes());

  const results = [];
  for (const scene of scenes) {
    if (options.at === null) scene.start = await busiest(kernels[0]!.base, scene);
    await addAudioSpectra(kernels[0]!.base, scene);
    const sizes = options.sizes.length > 0 ? [...options.sizes] : [scaled(scene.canvas, 1080), scaled(scene.canvas, 540)];
    if (options.playback) {
      // 预览播放时的尺寸：按编辑器常见的画布（约 960 CSS 像素宽、2 倍像素比）求出来的那一档。
      const display = { width: 960, height: Math.round((960 * scene.canvas.height) / scene.canvas.width) };
      sizes.push(display);
    }
    for (const size of sizes) {
      for (const result of await measure(kernels, scene, size, options.frames, options.ablate)) {
        results.push(result);
        print(result, kernels.length > 1);
      }
    }
    scene.close();
  }
  if (options.json) writeFileSync(options.json, JSON.stringify(results, null, 1));
}

/** 序列画布按短边缩放到 `short` 像素（偶数；合成场景的画布很小，会放大）。 */
function scaled(canvas: Size, short: number): Size {
  const scale = short / Math.min(canvas.width, canvas.height);
  return {
    width: Math.max(2, Math.round((canvas.width * scale) / 2) * 2),
    height: Math.max(2, Math.round((canvas.height * scale) / 2) * 2),
  };
}

function print(result: Awaited<ReturnType<typeof measure>>[number], labelled: boolean): void {
  const stage = (name: string) => {
    const s = (result.stages as any)[name];
    return `${name} ${s.p50}/${s.p95}`;
  };
  console.log(
    `${result.scene}${labelled ? ` [${result.kernel}]` : ''} @ ${result.size} t=${result.start}s ` +
      `(${result.fps} fps, ${result.layers} 层, 首帧 ${result.firstFrameMs} ms, 新尺寸首帧 ${result.newSizeMs} ms, 切尺寸 ${result.switchMs} ms, 负载 ${result.load}) ms p50/p95: ` +
      ['plan', 'upload', 'render', 'readback', 'total'].map(stage).join(' · '),
  );
  if (Object.keys(result.perLayer).length > 0) {
    console.log(
      `  每层（消融）：${Object.entries(result.perLayer)
        .map(([key, value]) => `${key} ${Math.round(value * 100) / 100}`)
        .join(' · ')}`,
    );
  }
}

await main();
