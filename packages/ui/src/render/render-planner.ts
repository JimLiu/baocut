import type { AssetRecord, FontFaceQuery, Id, Sequence, VersionRef } from '@baocut/protocol';
import type { FramePlan, PlanErrorBody } from './frame-plan.ts';
import type { LocalFont } from './local-fonts.ts';
import { R } from './render-copy.ts';

/** `bindings/preview-wasm` 导出的函数。JSON 与字节经线性内存进出，返回 0 表示成功。 */
interface PreviewExports {
  memory: WebAssembly.Memory;
  bc_alloc(len: number): number;
  bc_free(ptr: number, len: number): void;
  bc_set_video(ptr: number, len: number): number;
  bc_plan(seconds: number): number;
  bc_font_files(): number;
  bc_add_font(ptr: number, len: number): number;
  bc_set_documents(ptr: number, len: number): number;
  bc_set_speech(ptr: number, len: number): number;
  bc_set_picture(keyPtr: number, keyLen: number, ptr: number, len: number, width: number, height: number): number;
  bc_clear_pictures(): void;
  bc_set_asset(keyPtr: number, keyLen: number, ptr: number, len: number): void;
  bc_set_spectrum(keyPtr: number, keyLen: number, ptr: number, len: number): void;
  bc_clear_spectra(): void;
  bc_set_audio_spectrum(keyPtr: number, keyLen: number, ptr: number, len: number): void;
  bc_clear_audio_spectra(): void;
  bc_spectrum_begin(): void;
  bc_spectrum_push(ptr: number, len: number): number;
  bc_spectrum_finish(): number;
  bc_render(seconds: number, width: number, height: number, flags: number): number;
  bc_measure_text(ptr: number, len: number): number;
  bc_frame_ptr(): number;
  bc_frame_len(): number;
  bc_output_ptr(): number;
  bc_output_len(): number;
}

/** 一份转写：文档 ID、它描述的素材与当前版本的正文（与 `bindings/preview-wasm` 的 `SpeechInput` 对应）。 */
export interface SpeechTranscript {
  documentId: Id;
  sourceAssetId?: Id;
  body: unknown;
}

/** 合成要读的文档（字幕与字幕样式）的冻结正文，与 Rust `frame_render::FrozenDocument` 对应。正文还没取到时是 `null`。 */
export interface FrozenDocument {
  documentId: Id;
  kind?: string;
  schema?: string;
  /** 字幕行是原文还是译文（派生自译文的字幕是 `translation`）。 */
  lineKind?: 'original' | 'translation';
  /** 文档头的 `sourceDocumentId`：字幕的句子用 `words` 指向这份转写里的词（转写经 `setSpeech` 送进去）。 */
  sourceDocumentId?: Id;
  /** 文档头的 `sourceAssetId`。 */
  sourceAssetId?: Id;
  body: unknown;
}

/** 渲染内核的提示（字体替换、缺字、没有频谱的声波等），画面照常出。 */
export interface RenderWarning {
  code: string;
  detail: string;
}

/** 这一帧没画的东西（`frame_render::UnsupportedItem`）：整层不画、跳过一个效果、转场按硬切，或素材解不出来。 */
export interface SkippedItem {
  itemId: Id;
  scope: 'layer' | 'effect' | 'transition' | 'asset';
  layerKind: string;
  effectId?: Id;
  transitionId?: Id;
  kind?: string;
  reason: string;
  message: string;
}

/** 声波用到、还没送进来的素材频谱（`setAudioSpectrum`）。 */
export interface MissingSpectrum {
  itemId: Id;
  asset: VersionRef;
}

/** 字幕渲染器给出的真实行框，坐标是序列画布像素；旋转绕行中心。 */
export interface CaptionHit {
  /** 同组字幕只在第一层合成，命中也用这一层的叠放顺序。 */
  layerId: Id;
  itemId: Id;
  documentId: Id;
  cueId: Id;
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation: number;
}

/** 一帧画完：这一刻的计划，与画的时候报出来的东西。画面经 `frame()` 取。 */
export interface RenderedFrame {
  plan: FramePlan;
  warnings: RenderWarning[];
  skipped: SkippedItem[];
  spectra: MissingSpectrum[];
  /** 这一帧用到、字体库里没有的字体族（照回退字体画了，`warnings` 里有提示）。 */
  fonts: string[];
  /**
   * 到目前为止排字时点了名的 face（常设，含字幕与模板层）：界面对照报过缺的族去要本机字体的那一个 face，
   * `addLocalFont` 送进来再画。
   */
  faces?: FontFaceQuery[];
  captionHits?: CaptionHit[];
}

/** 一次送进 WASM 的样本数（10 秒）：算频谱时 WASM 里只留一个窗口，不放整段声音。 */
const SPECTRUM_BLOCK = 480_000;

/**
 * 计划失败：`code` 来自 Rust（`SEQUENCE_NOT_FOUND`、`INVALID_VIDEO` 之类），或者是 `PLANNER_CRASHED`
 * （WASM 陷阱，正在重新载入）。
 */
export class PlanFailure extends Error {
  readonly code: string;
  constructor(body: PlanErrorBody) {
    super(body.message);
    this.code = body.code;
  }
}

/** 计划只读序列与素材；其余文档不送进 WASM。 */
export interface PlanVideo {
  sequence: Sequence;
  assets: Record<Id, AssetRecord>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * 帧计划器与画帧：Rust 的 `render-graph` 与 `frame-render` 编成 WASM（架构设计 §2「纯语义模块编译为 WASM」），
 * 预览每一帧问它一次。计划与像素都和导出出自同一个实现；WASM 不持有视频的写入权，视频随快照整份送进来，
 * 媒体元素这一刻的画面、Lottie 的字节与字体由界面送进来。
 *
 * Rust 里的 panic 在 WASM 里是陷阱，之后实例的状态不可信：丢掉它，从已编译的模块重新实例化，把字体、视频、文档、
 * 转写、素材字节、频谱与素材频谱送回去（画面每一帧都重送；本机字体不留字节，按 `LocalFont.load` 重新要），好了之后调用 `onRecovered`。重新载入期间的调用抛 `PLANNER_CRASHED`，
 * 要等的调用方用 `recovered()`。
 */
export class RenderPlanner {
  readonly #module: WebAssembly.Module;
  #exports: PreviewExports | null;
  /** 随内核发布的字体（几 MB，留着字节）。 */
  #fonts: Uint8Array[] = [];
  /** 送进来过的本机字体：不留字节（大的字体集合抽出来的一个 face 也有十几 MB），要再送时按 `load` 重新要。 */
  readonly #local = new Map<string, LocalFont>();
  /** 从这个实例分出去的实例（缩略图）：之后送进来的本机字体也送给它们。 */
  readonly #forks = new Set<RenderPlanner>();
  #videoInput: Uint8Array | null = null;
  #documentsInput: Uint8Array | null = null;
  #speechInput: Uint8Array | null = null;
  readonly #assets = new Map<string, Uint8Array>();
  readonly #spectra = new Map<string, Uint8Array>();
  readonly #audioSpectra = new Map<string, Uint8Array>();
  /** 在等重新载入的 `recovered()`。 */
  readonly #waiting: { resolve: () => void; reject: (error: unknown) => void }[] = [];
  /** 重新载入失败的原因：之后实例不再能用，`recovered()` 一律拒绝。 */
  #lost: { error: unknown } | null = null;
  onRecovered: (() => void) | null = null;

  private constructor(module: WebAssembly.Module, instance: WebAssembly.Instance) {
    this.#module = module;
    this.#exports = instance.exports as unknown as PreviewExports;
  }

  static async instantiate(bytes: BufferSource | WebAssembly.Module): Promise<RenderPlanner> {
    if (bytes instanceof WebAssembly.Module) return new RenderPlanner(bytes, await WebAssembly.instantiate(bytes, {}));
    const { module, instance } = await WebAssembly.instantiate(bytes, {});
    return new RenderPlanner(module, instance);
  }

  /**
   * 同一个已编译模块的另一个实例（缩略图用，不与预览抢视频），字体照样注入：内置的一批照送，已经送进来的本机字体
   * 重新要一次再送（要不到的跳过）；之后送进这个实例的本机字体也送给它。
   */
  async fork(): Promise<RenderPlanner> {
    const planner = await RenderPlanner.instantiate(this.#module);
    planner.addFonts(this.#fonts);
    this.#forks.add(planner);
    await Promise.allSettled([...this.#local.values()].map(async (font) => planner.addLocalFont(font, await font.load())));
    return planner;
  }

  /** 要注入的字体文件名，次序即注入次序（第一份是回退字体）。 */
  fontFiles(): string[] {
    return JSON.parse(this.#call((exports) => exports.bc_font_files())) as string[];
  }

  /**
   * 注入随内核发布的字体：按 `fontFiles()` 的次序注入，全部注入之后再画。重新载入时按注入的次序全部送回去。
   */
  addFonts(fonts: readonly Uint8Array[]): void {
    for (const font of fonts) {
      this.#call((exports) => giveBytes(exports, font, (ptr, len) => exports.bc_add_font(ptr, len)));
      this.#fonts.push(font);
    }
  }

  /**
   * 注入一个本机字体 face（按 `RenderedFrame.faces` 要来的），下一帧按新的字体库重排；分出去的实例也送一份。字节拷进
   * WASM 之后这里不留（调用方也不必留）：重新载入或新分实例时按 `font.load` 重新要。同一个 `key` 只送一次，送了返回 true。
   * 正在重新载入时只记下，重新载入时一并要回来。
   */
  addLocalFont(font: LocalFont, bytes: Uint8Array): boolean {
    if (this.#local.has(font.key)) return false;
    this.#local.set(font.key, font);
    const exports = this.#exports;
    if (exports) giveBytes(exports, bytes, (ptr, len) => exports.bc_add_font(ptr, len));
    for (const fork of this.#forks) fork.addLocalFont(font, bytes);
    return true;
  }

  /** 送进视频。之后的计划都按这个序列求。 */
  setVideo(video: PlanVideo): void {
    const { sequence, assets } = video;
    const document = { rootSequenceId: sequence.id, sequences: { [sequence.id]: sequence }, assets };
    const input = encoder.encode(JSON.stringify({ video: document, sequenceId: sequence.id }));
    this.#call((exports) => withBytes(exports, input, (ptr, len) => exports.bc_set_video(ptr, len)));
    // 送不进去的视频不记：WASM 那边还是上一个，重新载入时也送上一个。
    this.#videoInput = input;
  }

  /** 换一批字幕与字幕样式文档。 */
  setDocuments(documents: readonly FrozenDocument[]): void {
    const input = encoder.encode(JSON.stringify(documents));
    this.#call((exports) => withBytes(exports, input, (ptr, len) => exports.bc_set_documents(ptr, len)));
    this.#documentsInput = input;
  }

  /**
   * 视频里的转写（`kind: speech` 的文档，当前版本的正文）。投到序列上的有效词流是按文稿触发的闪避的触发区间，
   * 与导出的声音计划同一份，所以预览与导出在同一时刻压低得一样多。
   */
  setSpeech(transcripts: readonly SpeechTranscript[]): void {
    const input = encoder.encode(JSON.stringify(transcripts));
    this.#call((exports) => withBytes(exports, input, (ptr, len) => exports.bc_set_speech(ptr, len)));
    this.#speechInput = input;
  }

  /** 实例这一刻的画面（非预乘的 RGBA，`width`×`height`）。键是实例 ID。 */
  setPicture(itemId: Id, rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): void {
    const key = encoder.encode(itemId);
    this.#call((exports) =>
      withBytes(exports, key, (keyPtr, keyLen) =>
        withBytes(exports, rgba, (ptr, len) => exports.bc_set_picture(keyPtr, keyLen, ptr, len, width, height)),
      ),
    );
  }

  /** 清掉上一帧送进来的画面。 */
  clearPictures(): void {
    this.#call((exports) => (exports.bc_clear_pictures(), 0));
  }

  /** 素材的原始字节（Lottie 要读）。 */
  setAsset(asset: VersionRef, bytes: Uint8Array): void {
    const name = assetKey(asset);
    if (this.#assets.get(name) === bytes) return;
    const key = encoder.encode(name);
    this.#call((exports) =>
      withBytes(exports, key, (keyPtr, keyLen) =>
        withBytes(exports, bytes, (ptr, len) => (exports.bc_set_asset(keyPtr, keyLen, ptr, len), 0)),
      ),
    );
    this.#assets.set(name, bytes);
  }

  /** 声波实例的整轨频谱（BCS1，键是实例 ID）。同一份字节再送不重推。 */
  setSpectrum(itemId: string, bytes: Uint8Array): void {
    if (this.#spectra.get(itemId) === bytes) return;
    const key = encoder.encode(itemId);
    this.#call((exports) =>
      withBytes(exports, key, (keyPtr, keyLen) =>
        withBytes(exports, bytes, (ptr, len) => (exports.bc_set_spectrum(keyPtr, keyLen, ptr, len), 0)),
      ),
    );
    this.#spectra.set(itemId, bytes);
  }

  /** 清掉全部频谱。 */
  clearSpectra(): void {
    if (this.#spectra.size === 0) return;
    this.#call((exports) => (exports.bc_clear_spectra(), 0));
    this.#spectra.clear();
  }

  /**
   * 素材频谱（BCS1，`analyzeAudio` 算的）。声波按序列的声音计划从它拼出自己听到的声音，与导出同一份代码。
   * 同一份字节再送不重拼（返回 false）。
   */
  setAudioSpectrum(asset: VersionRef, bytes: Uint8Array): boolean {
    const name = assetKey(asset);
    if (this.#audioSpectra.get(name) === bytes) return false;
    const key = encoder.encode(name);
    this.#call((exports) =>
      withBytes(exports, key, (keyPtr, keyLen) =>
        withBytes(exports, bytes, (ptr, len) => (exports.bc_set_audio_spectrum(keyPtr, keyLen, ptr, len), 0)),
      ),
    );
    this.#audioSpectra.set(name, bytes);
    return true;
  }

  /** 清掉全部素材频谱。 */
  clearAudioSpectra(): void {
    if (this.#audioSpectra.size === 0) return;
    this.#call((exports) => (exports.bc_clear_audio_spectra(), 0));
    this.#audioSpectra.clear();
  }

  /**
   * 算一份素材频谱：`channels` 是 48 kHz 的各声道样本，单声道原样、多声道取平均，按块送进同一模块的一个临时实例
   * （分析用的内存随实例丢掉，不留在画帧的实例里）。分析与导出是同一份 Rust 代码；解码不是（这里是浏览器解的），
   * 有损格式的样本与导出那边略有出入，频谱因此相近而不逐字节相同。
   */
  async analyzeAudio(channels: readonly Float32Array[]): Promise<Uint8Array> {
    const instance = await WebAssembly.instantiate(this.#module, {});
    const exports = instance.exports as unknown as PreviewExports;
    const length = Math.min(...channels.map((channel) => channel.length));
    const read = (status: number): Uint8Array => {
      const output = new Uint8Array(exports.memory.buffer, exports.bc_output_ptr(), exports.bc_output_len()).slice();
      if (status !== 0) throw new PlanFailure(JSON.parse(decoder.decode(output)) as PlanErrorBody);
      return output;
    };
    exports.bc_spectrum_begin();
    const block = new Float32Array(SPECTRUM_BLOCK);
    for (let start = 0; start < length; start += SPECTRUM_BLOCK) {
      const size = Math.min(SPECTRUM_BLOCK, length - start);
      const mono = block.subarray(0, size);
      if (channels.length === 1) mono.set(channels[0]!.subarray(start, start + size));
      else {
        mono.fill(0);
        for (const channel of channels) for (let i = 0; i < size; i++) mono[i]! += channel[start + i]!;
        for (let i = 0; i < size; i++) mono[i]! /= channels.length;
      }
      read(withBytes(exports, new Uint8Array(mono.buffer, 0, size * 4), (ptr, len) => exports.bc_spectrum_push(ptr, len)));
    }
    return read(exports.bc_spectrum_finish());
  }

  /**
   * 一段文字作为文字元素在 `canvas`（序列画布）上要多大的框（序列像素，含底板留白）：与画字同一台排版引擎、同一批字体
   * （`frame_render::text_measure`）。给了 `wrapWidth` 就按它折行、框宽就是它；否则排成不折的一块。要先注入字体。
   */
  measureText(
    text: string,
    style: Record<string, unknown>,
    wrapWidth: number | null,
    canvas: { width: number; height: number },
  ): { width: number; height: number } {
    const input = encoder.encode(JSON.stringify({ text, style, wrapWidth, canvas: { width: canvas.width, height: canvas.height } }));
    return JSON.parse(this.#call((exports) => withBytes(exports, input, (ptr, len) => exports.bc_measure_text(ptr, len)))) as {
      width: number;
      height: number;
    };
  }

  /**
   * 求 `seconds` 这一刻的计划并画成 `width`×`height`（与序列画布同比例）。画不出来的东西跳过，报在结果里。
   * `captions: false` 不画字幕层；`transparent` 不铺背景（缩略图）。
   */
  render(seconds: number, width: number, height: number, options: { captions?: boolean; transparent?: boolean } = {}): RenderedFrame {
    const flags = (options.captions === false ? 0 : 1) | (options.transparent ? 2 : 0);
    return JSON.parse(this.#call((exports) => exports.bc_render(seconds, width, height, flags))) as RenderedFrame;
  }

  /**
   * 上一次 `render` 画好的帧：非预乘的 RGBA（不铺背景时有透明处，否则不透明）。是 WASM 内存的视图，不复制：
   * 下一次调用 WASM 之前用完（内存增长时旧视图会失效）。
   */
  frame(): Uint8ClampedArray<ArrayBuffer> {
    const exports = this.#exports;
    if (!exports) return new Uint8ClampedArray(0);
    return new Uint8ClampedArray(exports.memory.buffer as ArrayBuffer, exports.bc_frame_ptr(), exports.bc_frame_len());
  }

  /** `seconds` 这一刻的计划。 */
  planAt(seconds: number): FramePlan {
    return JSON.parse(this.planJson(seconds)) as FramePlan;
  }

  /** 计划的 JSON 原文（与原生 Rust 的输出逐字节一致，金标准测试用）。 */
  planJson(seconds: number): string {
    return this.#call((exports) => exports.bc_plan(seconds));
  }

  /**
   * 实例能用时兑现：平时立刻兑现；抛过 `PLANNER_CRASHED` 之后等重新载入好了（在 `onRecovered` 之前），
   * 重新载入失败时（之后也一样）拒绝。不占用 `onRecovered`（那是预览引擎的）。
   */
  recovered(): Promise<void> {
    if (this.#exports) return Promise.resolve();
    if (this.#lost) return Promise.reject(this.#lost.error);
    return new Promise((resolve, reject) => this.#waiting.push({ resolve, reject }));
  }

  /** 调一次导出函数，读输出区；失败时抛 `PlanFailure`。 */
  #call(invoke: (exports: PreviewExports) => number): string {
    const exports = this.#exports;
    if (!exports) throw new PlanFailure({ code: 'PLANNER_CRASHED', message: R.planner.reloading });
    let status: number;
    try {
      status = invoke(exports);
    } catch (error) {
      if (!(error instanceof WebAssembly.RuntimeError)) throw error;
      this.#restart();
      throw new PlanFailure({ code: 'PLANNER_CRASHED', message: R.planner.crashed(error.message) });
    }
    // 内存可能在调用中增长，旧的 ArrayBuffer 会失效：每次都从 memory.buffer 重新取。
    const output = decoder.decode(new Uint8Array(exports.memory.buffer, exports.bc_output_ptr(), exports.bc_output_len()));
    if (status !== 0) throw new PlanFailure(JSON.parse(output) as PlanErrorBody);
    return output;
  }

  #restart(): void {
    this.#exports = null;
    // 模块已经编译过，重新实例化很快；主线程上只能异步做。
    const restored = WebAssembly.instantiate(this.#module, {}).then(async (instance) => {
      const exports = instance.exports as unknown as PreviewExports;
      for (const font of this.#fonts) giveBytes(exports, font, (ptr, len) => exports.bc_add_font(ptr, len));
      // 本机字体不留字节：重新要（要的期间又送来的也要），要不到的跳过（照回退字体画，缺字体的提示照报）。
      const given = new Set<string>();
      for (;;) {
        const todo = [...this.#local.values()].filter((font) => !given.has(font.key));
        if (todo.length === 0) break;
        const loaded = await Promise.allSettled(todo.map((font) => font.load()));
        todo.forEach((font, i) => {
          given.add(font.key);
          const result = loaded[i]!;
          if (result.status === 'fulfilled') giveBytes(exports, result.value, (ptr, len) => exports.bc_add_font(ptr, len));
        });
      }
      if (this.#videoInput) withBytes(exports, this.#videoInput, (ptr, len) => exports.bc_set_video(ptr, len));
      if (this.#documentsInput) withBytes(exports, this.#documentsInput, (ptr, len) => exports.bc_set_documents(ptr, len));
      if (this.#speechInput) withBytes(exports, this.#speechInput, (ptr, len) => exports.bc_set_speech(ptr, len));
      for (const [name, bytes] of this.#assets) {
        const key = encoder.encode(name);
        withBytes(exports, key, (keyPtr, keyLen) =>
          withBytes(exports, bytes, (ptr, len) => (exports.bc_set_asset(keyPtr, keyLen, ptr, len), 0)),
        );
      }
      for (const [itemId, bytes] of this.#spectra) {
        const key = encoder.encode(itemId);
        withBytes(exports, key, (keyPtr, keyLen) =>
          withBytes(exports, bytes, (ptr, len) => (exports.bc_set_spectrum(keyPtr, keyLen, ptr, len), 0)),
        );
      }
      for (const [name, bytes] of this.#audioSpectra) {
        const key = encoder.encode(name);
        withBytes(exports, key, (keyPtr, keyLen) =>
          withBytes(exports, bytes, (ptr, len) => (exports.bc_set_audio_spectrum(keyPtr, keyLen, ptr, len), 0)),
        );
      }
      this.#exports = exports;
      for (const { resolve } of this.#waiting.splice(0)) resolve();
      this.onRecovered?.();
    });
    restored.catch((error: unknown) => {
      if (this.#exports) return;
      console.warn(R.planner.reloadFailed, error);
      this.#lost = { error };
      for (const { reject } of this.#waiting.splice(0)) reject(error);
    });
  }
}

/** 素材字节的键（与 Rust 那边一致）。 */
export function assetKey(asset: VersionRef): string {
  return `${asset.id}@${asset.revision}`;
}

/** 把字节写进 WASM 的一块缓冲交给 `invoke`，之后缓冲归 WASM（`bc_add_font`：大字体不再多拷一份），不释放。 */
function giveBytes(exports: PreviewExports, input: Uint8Array, invoke: (ptr: number, len: number) => number): number {
  const ptr = exports.bc_alloc(input.length);
  try {
    new Uint8Array(exports.memory.buffer, ptr, input.length).set(input);
  } catch (error) {
    exports.bc_free(ptr, input.length);
    throw error;
  }
  return invoke(ptr, input.length);
}

/** 把字节写进 WASM 的一块临时缓冲，调用完释放。 */
function withBytes(exports: PreviewExports, input: Uint8Array | Uint8ClampedArray, invoke: (ptr: number, len: number) => number): number {
  const ptr = exports.bc_alloc(input.length);
  try {
    new Uint8Array(exports.memory.buffer, ptr, input.length).set(input);
    return invoke(ptr, input.length);
  } finally {
    exports.bc_free(ptr, input.length);
  }
}
