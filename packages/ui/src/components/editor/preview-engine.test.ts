import type { AssetRecord, DocumentRecord, FontFaceQuery, Sequence } from '@baocut/protocol';
import { expect, test, vi } from 'vitest';
import type { LoadedFace, LocalFont } from '../../render/local-fonts.ts';
import { PlanFailure, type CaptionHit, type RenderPlanner } from '../../render/render-planner.ts';
import { PreviewEngine, audioKey, videoKey, type PreviewStatus } from './preview-engine.ts';

/** 内核转述来的提示（没有自己的引用）：`frameRender.itemNote` 前面写上实例，原话嵌在里面。 */
function kernelNote(item: string, note: string) {
  return { code: 'EXPORT_RENDER_NOTE', detail: `${item}: ${note}`, detailRef: { key: 'frameRender.itemNote', params: { item, note } } };
}

// 引擎跑在浏览器里；这里只走不碰媒体元素的那部分，补上 Node 没有的动画帧函数与 ImageData（装下像素就行）。
vi.stubGlobal('requestAnimationFrame', () => 0);
vi.stubGlobal('cancelAnimationFrame', () => {});
vi.stubGlobal('ImageData', function (data: Uint8ClampedArray, width: number, height: number) {
  return { data, width, height };
});

const sequence = {
  id: 'seq',
  name: '主序列',
  fps: { num: 30, den: 1 },
  canvas: { width: 1920, height: 1080 },
  tracks: [],
  items: [],
} as unknown as Sequence;

function fakePlanner(): RenderPlanner {
  return { onRecovered: null, setVideo: () => {}, planAt: () => ({ layers: [], voices: [] }) } as unknown as RenderPlanner;
}

test('停用之后接回来的引擎照常出计划：开发模式下效果会多跑一轮清理与建立', async () => {
  const planner = Promise.resolve(fakePlanner());
  const engine = new PreviewEngine({ onTime: () => {}, onEnded: () => {} }, () => planner);
  // StrictMode 的顺序：建立 → 清理（dispose）→ 再建立（resume），计划器在这之后才载入完。
  engine.dispose();
  engine.resume();
  const seen: PreviewStatus[] = [];
  engine.onStatus((status) => seen.push(status));
  engine.setVideo(sequence, {});
  await planner;
  await Promise.resolve();
  expect(seen.at(-1)).toEqual({ kind: 'ready' });
  engine.dispose();
});

test('停用了的引擎不再接计划器', async () => {
  const planner = Promise.resolve(fakePlanner());
  const engine = new PreviewEngine({ onTime: () => {}, onEnded: () => {} }, () => planner);
  engine.setVideo(sequence, {});
  engine.dispose();
  const seen: PreviewStatus[] = [];
  engine.onStatus((status) => seen.push(status));
  await planner;
  await Promise.resolve();
  expect(seen).toEqual([{ kind: 'loading' }]);
});

test('画面由帧计划器画：还在取的文档不报，跳过的层与内核的提示报出来', async () => {
  const layers = [
    { kind: 'caption', itemId: 'cap', matrix: [1, 0, 0, 1, 0, 0], opacity: 1, content: { documentId: 'doc_caption', sequenceSeconds: 0 } },
    { kind: 'shape', itemId: 'badge', matrix: [1, 0, 0, 1, 0, 0], opacity: 1, content: { shape: { shape: 'vendor-star' } } },
  ];
  const plan = { canvas: { width: 1920, height: 1080, background: '#000000', backgroundAlpha: 1 }, layers, voices: [] };
  const sentDocuments: unknown[] = [];
  const renders: number[][] = [];
  const planner = {
    onRecovered: null,
    setVideo: () => {},
    planAt: () => plan,
    setDocuments: (documents: unknown) => sentDocuments.push(documents),
    clearPictures: () => {},
    render: (_: number, width: number, height: number) => {
      renders.push([width, height]);
      return {
        plan,
        warnings: [kernelNote('badge', '字体换成了回退字体')],
        skipped: [
          {
            itemId: 'cap',
            scope: 'layer',
            layerKind: 'caption',
            reason: 'caption-document-missing',
            message: '字幕文档 doc_caption 不在了',
          },
          { itemId: 'badge', scope: 'layer', layerKind: 'shape', reason: 'preset-unknown', message: '形状「vendor-star」不在目录里' },
        ],
        spectra: [],
      };
    },
    frame: () => new Uint8ClampedArray(960 * 540 * 4),
  } as unknown as RenderPlanner;
  const loads: string[] = [];
  const documents = { peek: () => undefined, load: (id: string) => loads.push(id), subscribe: () => () => {} };
  const engine = new PreviewEngine({ onTime: () => {}, onEnded: () => {} }, () => Promise.resolve(planner), documents);
  const puts: unknown[] = [];
  const canvas = { width: 0, height: 0, getContext: () => context };
  const context = { canvas, putImageData: (image: unknown) => puts.push(image) };
  engine.attachCanvas(canvas as unknown as HTMLCanvasElement, 0.5);
  const seen: PreviewStatus[] = [];
  engine.onStatus((status) => seen.push(status));
  engine.setVideo(sequence, {}, { doc_caption: { id: 'doc_caption', kind: 'caption', currentRevision: 'r1' } as never });
  await new Promise((resolve) => setTimeout(resolve, 10));

  expect(renders.at(-1)).toEqual([960, 540]);
  expect([canvas.width, canvas.height]).toEqual([960, 540]);
  expect(puts.length).toBeGreaterThan(0);
  expect(loads).toContain('doc_caption');
  expect(sentDocuments[0]).toEqual([{ documentId: 'doc_caption', kind: 'caption', lineKind: 'original', body: null }]);
  expect(seen.at(-1)).toEqual({ kind: 'ready', problems: ['形状「vendor-star」不在目录里', 'badge：字体换成了回退字体'] });
  engine.dispose();
});

test('转写：按文稿触发的闪避、写了 speaker 的声波与字幕要时送进计划器（取到了的），都没有时不取也不送', async () => {
  const sentSpeech: unknown[] = [];
  const planner = { ...fakePlanner(), setSpeech: (transcripts: unknown) => sentSpeech.push(transcripts) } as unknown as RenderPlanner;
  const bodies: Record<string, unknown> = { doc_a: { schema: 'baocut.speech/1', words: [] } };
  const loads: string[] = [];
  const documents = { peek: (id: string) => bodies[id], load: (id: string) => loads.push(id), subscribe: () => () => {} };
  const engine = new PreviewEngine({ onTime: () => {}, onEnded: () => {} }, () => Promise.resolve(planner), documents);
  const records = {
    doc_a: { id: 'doc_a', kind: 'speech', sourceAssetId: 'asset_a', currentRevision: 'r1' },
    doc_b: { id: 'doc_b', kind: 'speech', currentRevision: 'r1' },
    doc_c: { id: 'doc_c', kind: 'caption', currentRevision: 'r1' },
  } as never;
  engine.setVideo({ ...sequence, ducking: [] } as Sequence, {}, records);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(sentSpeech).toEqual([]);
  expect(loads).toEqual([]);

  const rule = { id: 'duck', enabled: true, trigger: { kind: 'speech' }, target: { itemIds: ['music'] }, depth: 12 };
  const ducked = (rules: unknown[]) => ({ ...sequence, ducking: rules }) as unknown as Sequence;
  engine.setVideo(ducked([rule]), {}, records);
  expect(loads).toEqual(['doc_b']);
  expect(sentSpeech).toEqual([[{ documentId: 'doc_a', sourceAssetId: 'asset_a', body: bodies.doc_a }]]);
  // 正文没变不重送；另一份取到了再送一次。
  engine.setVideo(ducked([rule]), {}, records);
  expect(sentSpeech).toHaveLength(1);
  bodies.doc_b = { schema: 'baocut.speech/1', words: [] };
  engine.setVideo(ducked([rule]), {}, records);
  expect(sentSpeech.at(-1)).toEqual([
    { documentId: 'doc_a', sourceAssetId: 'asset_a', body: bodies.doc_a },
    { documentId: 'doc_b', body: bodies.doc_b },
  ]);
  // 规则停用：送一份空的，计划器不再压低。
  engine.setVideo(ducked([{ ...rule, enabled: false }]), {}, records);
  expect(sentSpeech.at(-1)).toEqual([]);
  // 写了 `speaker` 的声波也要转写（按说话人分开的区间）；没写的不要。
  const visualizer = (speaker?: string) =>
    ({
      ...sequence,
      items: [{ id: 'viz', type: 'visualizer', visualizer: { style: 'bars', ...(speaker ? { speaker } : {}) } }],
    }) as unknown as Sequence;
  engine.setVideo(visualizer(), {}, records);
  expect(sentSpeech.at(-1)).toEqual([]);
  engine.setVideo(visualizer('spk_a'), {}, records);
  expect(sentSpeech.at(-1)).toHaveLength(2);
  // 字幕要它派生自的那份转写（逐词动画按转写里的词推进），只送这一份；停用的字幕实例不要。
  const captioned = (enabled: boolean) =>
    ({ ...sequence, items: [{ id: 'cap', type: 'caption', enabled, documentId: 'doc_d' }] }) as unknown as Sequence;
  const withCaption = { ...(records as object), doc_d: { id: 'doc_d', kind: 'caption', sourceDocumentId: 'doc_a', currentRevision: 'r1' } };
  engine.setVideo(captioned(true), {}, withCaption as never);
  expect(sentSpeech.at(-1)).toEqual([{ documentId: 'doc_a', sourceAssetId: 'asset_a', body: bodies.doc_a }]);
  engine.setVideo(captioned(false), {}, withCaption as never);
  expect(sentSpeech.at(-1)).toEqual([]);
  engine.dispose();
});

test('声波要的素材频谱：在算时不报占位提示，算好了送进计划器再画一次；太大的素材不分析，报出来', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let engine: PreviewEngine | undefined;
  try {
    const layers = [
      { kind: 'generator', itemId: 'viz', matrix: [1, 0, 0, 1, 0, 0], opacity: 1, content: { generator: 'baocut.audio-visualizer' } },
    ];
    const plan = { canvas: { width: 1920, height: 1080, background: '#000000', backgroundAlpha: 1 }, layers, voices: [] };
    const music = { id: 'asset_music', revision: 'r1' };
    const huge = { id: 'asset_huge', revision: 'r1' };
    const heard = new Map<string, Uint8Array>();
    let renders = 0;
    const planner = {
      ...fakePlanner(),
      planAt: () => plan,
      setDocuments: () => {},
      clearPictures: () => {},
      analyzeAudio: async () => new Uint8Array(0),
      setAudioSpectrum: (asset: { id: string }, bytes: Uint8Array) => {
        if (heard.get(asset.id) === bytes) return false;
        heard.set(asset.id, bytes);
        return true;
      },
      render: () => {
        renders++;
        const spectra = [music, huge].filter((asset) => !heard.has(asset.id)).map((asset) => ({ itemId: 'viz', asset }));
        const warnings = spectra.length ? [kernelNote('viz', 'Element viz has no spectrum track; drawing a placeholder')] : [];
        return { plan, warnings, skipped: [], spectra };
      },
      frame: () => new Uint8ClampedArray(960 * 540 * 4),
    } as unknown as RenderPlanner;
    const spectrum = new Uint8Array([1, 2, 3]);
    let ready = false;
    const requested: { asset: string; decoder: string }[] = [];
    let notify = () => {};
    const assets = {
      get: (asset: { id: string }, decoder: { name: string }) => {
        requested.push({ asset: asset.id, decoder: decoder.name });
        return ready ? { state: 'ready', value: spectrum } : { state: 'loading' };
      },
      subscribe: (listener: () => void) => ((notify = listener), () => {}),
    };
    engine = new PreviewEngine({ onTime: () => {}, onEnded: () => {} }, () => Promise.resolve(planner), null, assets as never);
    const canvas = { width: 0, height: 0, getContext: () => context };
    const context = { canvas, putImageData: () => {} };
    engine.attachCanvas(canvas as unknown as HTMLCanvasElement, 0.5);
    const seen: PreviewStatus[] = [];
    engine.onStatus((status) => seen.push(status));
    const record = (id: string, byteLength: number) => ({ id, revisions: { r1: { revision: 'r1', byteLength } } });
    engine.setVideo(sequence, { asset_music: record('asset_music', 1000), asset_huge: record('asset_huge', 2 ** 30) } as never);
    await vi.advanceTimersByTimeAsync(10);

    // 太大的那份不去取；在算的那份不报占位提示。
    expect(requested).toEqual([{ asset: 'asset_music', decoder: 'spectrum' }]);
    const tooLarge = '声波 viz 听的素材 asset_huge 超过 512 MB，预览不分析它的声音；导出照常';
    expect(seen.at(-1)).toEqual({ kind: 'ready', problems: [tooLarge] });

    // 算好了：送进计划器，再画一次。
    ready = true;
    const before = renders;
    notify();
    await vi.advanceTimersByTimeAsync(10);
    expect(heard.get('asset_music')).toBe(spectrum);
    expect(renders).toBeGreaterThanOrEqual(before + 2);
  } finally {
    engine?.dispose();
    vi.useRealTimers();
  }
});

test('写了 speaker 的声波：转写还在取时不报「没有转写」，取到了（暂停中）这一帧就送上并按转写报', async () => {
  const layers = [
    { kind: 'generator', itemId: 'viz', matrix: [1, 0, 0, 1, 0, 0], opacity: 1, content: { generator: 'baocut.audio-visualizer' } },
  ];
  const plan = { canvas: { width: 1920, height: 1080, background: '#000000', backgroundAlpha: 1 }, layers, voices: [] };
  let speech: unknown[] = [];
  const planner = {
    ...fakePlanner(),
    planAt: () => plan,
    setDocuments: () => {},
    clearPictures: () => {},
    setSpeech: (transcripts: unknown[]) => (speech = transcripts),
    // 内核的样子：一份转写都没有时当作视频里没有转写；有转写而里面没有这位说话人时报另一句。
    render: () => {
      const [key, detail] =
        speech.length === 0
          ? ['frameRender.speakerNoTranscript', 'viz: This video has no transcript, so it’s unknown when speaker spk_a talks; the waveform is drawn silent']
          : ['frameRender.speakerNotInSequence', 'viz: The transcript has no speech from speaker spk_a in this sequence; the waveform is drawn silent'];
      const detailRef = { key: 'frameRender.itemNote', params: { item: 'viz', note: { key, params: { speaker: 'spk_a' } } } };
      return { plan, warnings: [{ code: 'EXPORT_RENDER_NOTE', detail, detailRef }], skipped: [], spectra: [] };
    },
    frame: () => new Uint8ClampedArray(960 * 540 * 4),
  } as unknown as RenderPlanner;
  const bodies: Record<string, unknown> = {};
  let notify = () => {};
  const documents = {
    peek: (id: string) => bodies[id],
    load: () => {},
    subscribe: (listener: () => void) => ((notify = listener), () => {}),
  };
  const engine = new PreviewEngine({ onTime: () => {}, onEnded: () => {} }, () => Promise.resolve(planner), documents);
  const canvas = { width: 0, height: 0, getContext: () => context };
  const context = { canvas, putImageData: () => {} };
  engine.attachCanvas(canvas as unknown as HTMLCanvasElement, 0.5);
  const seen: PreviewStatus[] = [];
  engine.onStatus((status) => seen.push(status));
  const video = {
    ...sequence,
    items: [{ id: 'viz', type: 'visualizer', visualizer: { style: 'bars', speaker: 'spk_a' } }],
  } as unknown as Sequence;
  engine.setVideo(video, {}, { doc_a: { id: 'doc_a', kind: 'speech', currentRevision: 'r1' } } as never);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(seen.at(-1)).toEqual({ kind: 'ready' });

  bodies.doc_a = { schema: 'baocut.speech/1', words: [] };
  notify();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(speech).toEqual([{ documentId: 'doc_a', body: bodies.doc_a }]);
  expect(seen.at(-1)).toEqual({ kind: 'ready', problems: ['viz：转写里没有说话人 spk_a 在这条序列上说的话，声波按无声画'] });
  engine.dispose();
});

test.each([
  ['SVG', 'image/svg+xml'],
  ['GIF', 'image/gif'],
])('%s 图片层：送素材字节、不读图片元素的像素；字节还在取时先留着上一帧', async (_label, mediaType) => {
  const svg = { id: 'asset_svg', revision: 'r1' };
  const layers = [{ kind: 'image', itemId: 'sticker', asset: svg, matrix: [1, 0, 0, 1, 0, 0], opacity: 1 }];
  const plan = { canvas: { width: 1920, height: 1080, background: '#000000', backgroundAlpha: 1 }, layers, voices: [] };
  const sentAssets: { asset: unknown; bytes: Uint8Array }[] = [];
  const pictures: string[] = [];
  let renders = 0;
  const planner = {
    ...fakePlanner(),
    planAt: () => plan,
    setDocuments: () => {},
    clearPictures: () => {},
    setPicture: (itemId: string) => pictures.push(itemId),
    setAsset: (asset: unknown, bytes: Uint8Array) => sentAssets.push({ asset, bytes }),
    render: () => (renders++, { plan, warnings: [], skipped: [], spectra: [] }),
    frame: () => new Uint8ClampedArray(960 * 540 * 4),
  } as unknown as RenderPlanner;
  const bytes = new TextEncoder().encode('<svg/>');
  let ready = false;
  let notify = () => {};
  const requested: string[] = [];
  const assets = {
    get: (asset: { id: string }, decoder: { name: string }) => {
      requested.push(`${asset.id}:${decoder.name}`);
      return ready ? { state: 'ready', value: bytes } : { state: 'loading' };
    },
    subscribe: (listener: () => void) => ((notify = listener), () => {}),
  };
  const engine = new PreviewEngine({ onTime: () => {}, onEnded: () => {} }, () => Promise.resolve(planner), null, assets as never);
  const canvas = { width: 0, height: 0, getContext: () => context };
  const context = { canvas, putImageData: () => {} };
  engine.attachCanvas(canvas as unknown as HTMLCanvasElement, 0.5);
  const record = { id: 'asset_svg', revisions: { r1: { revision: 'r1', mediaType, byteLength: 6 } } };
  engine.setVideo(sequence, { asset_svg: record } as never);
  await new Promise((resolve) => setTimeout(resolve, 10));

  // 还在取：先不画（等字节，最多等一会儿），也不找图片元素。
  expect(requested).toContain('asset_svg:bytes');
  expect(renders).toBe(0);

  ready = true;
  notify();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(renders).toBeGreaterThan(0);
  expect(sentAssets.at(-1)).toEqual({ asset: svg, bytes });
  expect(pictures).toEqual([]);
  engine.dispose();
});

test('本机字体：报缺的族里排字点了名的 face 向宿主要一次，到了注入计划器再画；取的时候不报缺字体，取不到的照报', async () => {
  const layers = [{ kind: 'text', itemId: 'title', matrix: [1, 0, 0, 1, 0, 0], opacity: 1, content: {} }];
  const plan = { canvas: { width: 1920, height: 1080, background: '#000000', backgroundAlpha: 1 }, layers, voices: [] };
  const note = (family: string) => ({
    code: 'EXPORT_RENDER_NOTE',
    detail: `title: Font "${family}" isn’t in the font library; using Noto Sans SC instead`,
    detailRef: { key: 'frameRender.itemNote', params: { item: 'title', note: { key: 'frameRender.missingFont', params: { family, fallback: 'Noto Sans SC' } } } },
  });
  const face = (family: string, weight = 400) => ({ family, weight, italic: false });
  const injected: string[] = [];
  let renders = 0;
  let bold = false;
  const planner = {
    ...fakePlanner(),
    planAt: () => plan,
    setDocuments: () => {},
    clearPictures: () => {},
    addLocalFont: (font: LocalFont) => injected.push(font.key),
    render: () => {
      renders++;
      const missing = injected.length > 0 ? ['Nowhere'] : ['Climate Crisis', 'Nowhere'];
      // 内置的族与已经有了的族也会点名；之后出现的粗体，它的族已经不缺了，也要去要。
      const faces = [face('Climate Crisis'), face('Nowhere'), face('Permanent Marker'), ...(bold ? [face('Climate Crisis', 700)] : [])];
      return { plan, warnings: missing.map(note), skipped: [], spectra: [], fonts: missing, faces };
    },
    frame: () => new Uint8ClampedArray(960 * 540 * 4),
  } as unknown as RenderPlanner;
  const asked: FontFaceQuery[][] = [];
  let deliver: (faces: LoadedFace[]) => void = () => {};
  const fonts = {
    load: (faces: readonly FontFaceQuery[]) => (asked.push([...faces]), new Promise<LoadedFace[]>((resolve) => (deliver = resolve))),
  };
  const engine = new PreviewEngine({ onTime: () => {}, onEnded: () => {} }, () => Promise.resolve(planner), null, null, fonts);
  const canvas = { width: 0, height: 0, getContext: () => context };
  const context = { canvas, putImageData: () => {} };
  engine.attachCanvas(canvas as unknown as HTMLCanvasElement, 0.5);
  const seen: PreviewStatus[] = [];
  engine.onStatus((status) => seen.push(status));
  engine.setVideo(sequence, {});
  await new Promise((resolve) => setTimeout(resolve, 10));

  // 在取：两个缺的族的 face 一起问一次（内置的族不问），提示先不报。
  expect(asked).toEqual([[face('Climate Crisis'), face('Nowhere')]]);
  expect(seen.at(-1)).toEqual({ kind: 'ready' });
  const before = renders;
  const loaded = (query: FontFaceQuery): LoadedFace => ({
    query,
    font: { key: `${query.family}/${query.weight}`, load: async () => new Uint8Array() },
    bytes: new Uint8Array([7]),
  });
  deliver([loaded(face('Climate Crisis'))]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  // 到了：注入，再画一次；找不到的族照报，也不再问。
  expect(injected).toEqual(['Climate Crisis/400']);
  expect(renders).toBeGreaterThan(before);
  expect(asked).toHaveLength(1);
  // 按界面语言显示（测试跑在简体中文）。
  expect(seen.at(-1)).toEqual({ kind: 'ready', problems: ['title：字体 "Nowhere" 在当前字体库中不可用，将使用 Noto Sans SC 代替'] });
  // 同一个族的粗体后来才排到：照样去要。
  bold = true;
  engine.seek(0.1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(asked.at(-1)).toEqual([face('Climate Crisis', 700)]);
  deliver([]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  // 报缺的族后来下载好了（字体条的「下载」、导出里下载的）：忘掉问过的，重画时再要一次。别的族不动。
  const count = asked.length;
  engine.retryFonts(['Permanent Marker']);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(asked).toHaveLength(count);
  engine.retryFonts(['nowhere']);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(asked.at(-1)).toEqual([face('Nowhere')]);
  engine.dispose();
});

/** 能一个个推进的动画帧与时钟：`tick(ms)` 把时钟拨到 `ms` 再跑排着的回调。 */
function manualFrames() {
  let callbacks: FrameRequestCallback[] = [];
  let now = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => callbacks.push(callback));
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  return {
    tick(ms: number) {
      now = ms;
      const due = callbacks;
      callbacks = [];
      for (const callback of due) callback(now);
    },
    restore() {
      clock.mockRestore();
      vi.stubGlobal('requestAnimationFrame', () => 0);
    },
  };
}

/** 播放用的计划器：计划的帧号按 30 fps 从时刻求，记下每次画的时刻与尺寸。 */
function playablePlanner() {
  const renders: { seconds: number; width: number; height: number }[] = [];
  const planAt = (seconds: number) => ({
    sequenceId: 'seq',
    sequenceRevision: 'r1',
    frame: Math.floor(seconds * 30 + 1e-6),
    canvas: { width: 1920, height: 1080, background: '#000000', backgroundAlpha: 1 },
    layers: [{ kind: 'text', itemId: 'title', matrix: [1, 0, 0, 1, 0, 0], opacity: 1, content: {} }],
    voices: [],
  });
  const planner = {
    ...fakePlanner(),
    planAt,
    setDocuments: () => {},
    clearPictures: () => {},
    render: (seconds: number, width: number, height: number) => {
      renders.push({ seconds, width, height });
      return { plan: planAt(seconds), warnings: [], skipped: [], spectra: [], fonts: [] };
    },
    frame: () => new Uint8ClampedArray(4),
  } as unknown as RenderPlanner;
  return { planner, renders };
}

const playable = {
  ...sequence,
  items: [{ id: 'title', type: 'text', enabled: true, trackId: 't', span: { fromFrame: 0, durationFrames: 300 } }],
} as unknown as Sequence;

test('播放中同一个视频帧只画一次；有东西变了（文档、素材、字体、尺寸）的那一帧照画', async () => {
  const frames = manualFrames();
  const { planner, renders } = playablePlanner();
  let notify = () => {};
  const documents = { peek: () => undefined, load: () => {}, subscribe: (listener: () => void) => ((notify = listener), () => {}) };
  const engine = new PreviewEngine({ onTime: () => {}, onEnded: () => {} }, () => Promise.resolve(planner), documents);
  const canvas = { width: 0, height: 0, getContext: () => ({ canvas, putImageData: () => {} }) };
  engine.attachCanvas(canvas as unknown as HTMLCanvasElement, 0.5);
  engine.setVideo(playable, {});
  await new Promise((resolve) => setTimeout(resolve, 10));
  renders.length = 0;

  engine.play();
  // 60 Hz 的刷新放 30 fps 的视频：0.1 秒里 6 个 tick，跨 3 个视频帧（第 0 帧停住时已经画好）。
  for (let i = 1; i <= 6; i++) frames.tick(i * (1000 / 60));
  expect(renders.map((render) => Math.floor(render.seconds * 30 + 1e-6))).toEqual([1, 2, 3]);
  expect(engine.stats.repeated).toBe(3);
  expect(engine.stats.presented).toBe(3);

  // 正文到了：同一帧也重画。
  notify();
  frames.tick(6.5 * (1000 / 60));
  expect(renders).toHaveLength(4);
  engine.pause();
  frames.restore();
  engine.dispose();
});

test('播放中按像素预算降分辨率画；停下来画回原尺寸的那一帧', async () => {
  const frames = manualFrames();
  const { planner, renders } = playablePlanner();
  const engine = new PreviewEngine({ onTime: () => {}, onEnded: () => {} }, () => Promise.resolve(planner));
  const canvas = { width: 0, height: 0, getContext: () => ({ canvas, putImageData: () => {} }) };
  engine.attachCanvas(canvas as unknown as HTMLCanvasElement, 1);
  engine.setVideo(playable, {});
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(renders.at(-1)).toMatchObject({ width: 1920, height: 1080 });
  expect(canvas).toMatchObject({ width: 1920, height: 1080 });
  renders.length = 0;

  engine.play();
  for (let i = 1; i <= 4; i++) frames.tick(i * (1000 / 30));
  expect(renders.map(({ width, height }) => `${width}×${height}`)).toEqual(Array(4).fill('960×540'));
  expect(canvas).toMatchObject({ width: 960, height: 540 });
  expect(engine.stats.size).toEqual({ width: 960, height: 540 });

  // 停下：停住的那一帧按原尺寸重画（与导出同一帧），时刻是停下的那一刻。
  engine.pause();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(renders).toHaveLength(5);
  expect(renders[4]).toEqual({ seconds: renders[3]!.seconds, width: 1920, height: 1080 });
  expect(canvas).toMatchObject({ width: 1920, height: 1080 });
  frames.restore();
  engine.dispose();
});

/**
 * 假的媒体元素（Node 里没有）：定位要等 `land()` 才落地，读出的画面记着读的时候元素在哪一刻。放的时候 `currentTime` 不会自己走，
 * 由测试 `advance()`（时钟的台子按 `playbackRate` 乘 `speed` 拨，冻住的不拨）。
 */
function fakeMedia() {
  class FakeMedia {
    static HAVE_METADATA = 1;
    static HAVE_CURRENT_DATA = 2;
    static HAVE_FUTURE_DATA = 3;
    readyState = 4;
    seeking = false;
    error = null;
    paused = true;
    ended = false;
    duration = 60;
    muted = false;
    volume = 1;
    playbackRate = 1;
    /** 没在出声（起播的延迟、缓冲、`play()` 被拦下）：时钟的台子不让它往前走。 */
    frozen = false;
    /** 元素自己的时钟比墙钟快慢多少（声卡的时钟、起播之后的偏差）。 */
    speed = 1;
    #time = 0;
    /** 放了这么多秒（不报定位）。 */
    advance(seconds: number) {
      this.#time += seconds;
    }
    #listeners: (() => void)[] = [];
    get currentTime() {
      return this.#time;
    }
    set currentTime(seconds: number) {
      this.#time = seconds;
      this.seeking = true;
    }
    /** 定位落地：报 `seeked`。 */
    land() {
      this.seeking = false;
      for (const listener of this.#listeners) listener();
    }
    pause() {
      this.paused = true;
    }
    play() {
      this.paused = false;
      return Promise.resolve();
    }
    addEventListener(type: string, listener: () => void) {
      if (type === 'seeked') this.#listeners.push(listener);
    }
    removeEventListener() {}
  }
  class FakeVideo extends FakeMedia {
    videoWidth = 1920;
    videoHeight = 1080;
  }
  class FakeImage {}
  vi.stubGlobal('HTMLMediaElement', FakeMedia);
  vi.stubGlobal('HTMLVideoElement', FakeVideo);
  vi.stubGlobal('HTMLImageElement', FakeImage);
  let drawn: FakeVideo | null = null;
  const scratch = {
    canvas: { width: 0, height: 0 },
    clearRect: () => {},
    drawImage: (element: FakeVideo) => (drawn = element),
    getImageData: (_x: number, _y: number, width: number, height: number) => ({ data: { at: drawn!.currentTime }, width, height }),
  };
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => scratch }) });
  return { video: new FakeVideo(), media: () => new FakeMedia(), clip: () => new FakeVideo() };
}

type FakeElement = ReturnType<ReturnType<typeof fakeMedia>['media']>;

/** 测试换掉的全局还原成文件开头那几个。 */
function restoreGlobals(): void {
  vi.unstubAllGlobals();
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('ImageData', function (data: Uint8ClampedArray, width: number, height: number) {
    return { data, width, height };
  });
}

test('停着定位：视频还在定位时先用它上一张画面马上画，落地了画精确的那一帧；拖动中降分辨率，停下画回原尺寸', async () => {
  const { video } = fakeMedia();
  const asset = { id: 'asset_v', revision: 'r1' };
  const renders: { seconds: number; width: number; picture: number | null }[] = [];
  let picture: number | null = null;
  const planAt = (seconds: number) => ({
    sequenceId: 'seq',
    sequenceRevision: 'r1',
    frame: Math.floor(seconds * 30 + 1e-6),
    canvas: { width: 1920, height: 1080, background: '#000000', backgroundAlpha: 1 },
    layers: [{ kind: 'video', itemId: 'clip', asset, sourceSeconds: seconds, sourceRate: 1, matrix: [1, 0, 0, 1, 0, 0], opacity: 1 }],
    voices: [],
  });
  const planner = {
    ...fakePlanner(),
    planAt,
    setDocuments: () => {},
    clearPictures: () => (picture = null),
    setPicture: (_: string, data: { at: number }) => (picture = data.at),
    render: (seconds: number, width: number) => {
      renders.push({ seconds, width, picture });
      return { plan: planAt(seconds), warnings: [], skipped: [], spectra: [], fonts: [] };
    },
    frame: () => new Uint8ClampedArray(4),
  } as unknown as RenderPlanner;
  const engine = new PreviewEngine({ onTime: () => {}, onEnded: () => {} }, () => Promise.resolve(planner));
  const canvas = { width: 0, height: 0, getContext: () => ({ canvas, putImageData: () => {} }) };
  engine.attachCanvas(canvas as unknown as HTMLCanvasElement, 1);
  engine.register(videoKey(asset, 0), video as unknown as HTMLVideoElement);
  engine.setVideo(sequence, {});
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(renders.at(-1)).toEqual({ seconds: 0, width: 1920, picture: 0 });
  expect(engine.exact).toBe(true);

  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    // 点一下：元素还在定位，不等，先拿上一张画面按播放的分辨率画。
    renders.length = 0;
    engine.seek(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(renders).toEqual([{ seconds: 2, width: 960, picture: 0 }]);
    expect(engine.exact).toBe(false);
    // 落地：画精确的那一帧；停下时已经是了，不再画。
    video.land();
    await vi.advanceTimersByTimeAsync(0);
    expect(renders.at(-1)).toEqual({ seconds: 2, width: 1920, picture: 2 });
    expect(engine.exact).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(renders).toHaveLength(2);

    // 拖动：接连定位都马上画，降分辨率（落地了的也一样）。
    renders.length = 0;
    for (const seconds of [3, 4, 5]) {
      engine.seek(seconds);
      await vi.advanceTimersByTimeAsync(0);
      video.land();
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(renders.map(({ seconds, width }) => `${seconds}@${width}`)).toEqual(['3@960', '3@1920', '4@960', '4@960', '5@960', '5@960']);
    expect(engine.exact).toBe(false);
    // 停下：按原尺寸画停住的那一帧，与导出同一帧。
    await vi.advanceTimersByTimeAsync(300);
    expect(renders.at(-1)).toEqual({ seconds: 5, width: 1920, picture: 5 });
    expect(engine.exact).toBe(true);

    // 停下时还没落地：等它落地再画精确的那一帧。
    renders.length = 0;
    engine.seek(9);
    await vi.advanceTimersByTimeAsync(300);
    expect(renders).toEqual([{ seconds: 9, width: 960, picture: 5 }]);
    expect(engine.exact).toBe(false);
    video.land();
    await vi.advanceTimersByTimeAsync(0);
    expect(renders.at(-1)).toEqual({ seconds: 9, width: 1920, picture: 9 });
    expect(engine.exact).toBe(true);
  } finally {
    vi.useRealTimers();
    engine.dispose();
    vi.unstubAllGlobals();
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('ImageData', function (data: Uint8ClampedArray, width: number, height: number) {
      return { data, width, height };
    });
  }
});

test('字幕命中框随实际出帧通知；换帧先清空旧框，没有几何的帧不沿用旧字幕', async () => {
  const plan = { sequenceId: 'seq', sequenceRevision: 'r1', frame: 0, canvas: sequence.canvas, layers: [], voices: [] };
  const hits: CaptionHit[] = [{ layerId: 'cap', itemId: 'cap', documentId: 'doc', cueId: 'c1', cx: 960, cy: 900, w: 800, h: 50, rotation: 0 }];
  let captionHits: CaptionHit[] = hits;
  let frame = 0;
  const planner = {
    onRecovered: null,
    setVideo: () => {},
    setDocuments: () => {},
    clearPictures: () => {},
    planAt: () => ({ ...plan, frame }),
    render: () => ({ plan: { ...plan, frame }, captionHits, warnings: [], skipped: [], spectra: [] }),
    frame: () => new Uint8ClampedArray(960 * 540 * 4),
  } as unknown as RenderPlanner;
  const engine = new PreviewEngine({ onTime: () => {}, onEnded: () => {} }, () => Promise.resolve(planner));
  const context = { canvas: { width: 0, height: 0 }, putImageData: () => {} };
  engine.attachCanvas({ getContext: () => context } as unknown as HTMLCanvasElement, 0.5);
  const seen: (readonly CaptionHit[])[] = [];
  const stop = engine.onCaptionHits((hits) => seen.push(hits));
  engine.setVideo(sequence, {});
  await vi.waitFor(() => expect(engine.captionHits).toEqual(hits));
  // 输出像素已在内核换回序列坐标，引擎不重复乘预览缩放。
  expect(seen.at(-1)?.[0]?.cx).toBe(960);
  frame = 30;
  captionHits = [];
  engine.seek(1);
  expect(engine.captionHits).toEqual([]);
  await vi.waitFor(() => expect(seen.at(-1)).toEqual([]));
  stop();
  engine.dispose();
});

test('转录中的临时字幕：叠进送给计划器的序列，文档不向 Runtime 取，点选与提示都不算它，收起后照原样送', async () => {
  const live = {
    kind: 'caption',
    itemId: 'bc-live-caption',
    matrix: [1, 0, 0, 1, 0, 0],
    opacity: 1,
    content: { documentId: 'bc-live-caption-document', styleDocumentId: 'bc-live-caption-style', sequenceSeconds: 0 },
  };
  const plan = { canvas: { width: 1920, height: 1080, background: '#000000', backgroundAlpha: 1 }, layers: [live], voices: [] };
  const videos: Sequence[] = [];
  const sentDocuments: Array<Array<{ documentId: string; body: unknown }>> = [];
  const hit: CaptionHit = {
    layerId: 'bc-live-caption',
    itemId: 'bc-live-caption',
    documentId: 'bc-live-caption-document',
    cueId: 'live-0',
    cx: 1,
    cy: 1,
    w: 10,
    h: 10,
    rotation: 0,
  } as CaptionHit;
  const planner = {
    onRecovered: null,
    setVideo: ({ sequence: s }: { sequence: Sequence }) => videos.push(s),
    planAt: () => plan,
    setDocuments: (documents: Array<{ documentId: string; body: unknown }>) => sentDocuments.push(documents),
    setSpeech: () => {},
    clearPictures: () => {},
    render: () => ({
      plan,
      captionHits: [hit],
      warnings: [kernelNote('bc-live-caption', '字体换成了回退字体')],
      skipped: [],
      spectra: [],
    }),
    frame: () => new Uint8ClampedArray(960 * 540 * 4),
  } as unknown as RenderPlanner;
  const loads: string[] = [];
  const documents = { peek: () => undefined, load: (id: string) => loads.push(id), subscribe: () => () => {} };
  const engine = new PreviewEngine({ onTime: () => {}, onEnded: () => {} }, () => Promise.resolve(planner), documents);
  const canvas = { width: 0, height: 0, getContext: () => context };
  const context = { canvas, putImageData: () => {} };
  engine.attachCanvas(canvas as unknown as HTMLCanvasElement, 0.5);
  const seen: PreviewStatus[] = [];
  engine.onStatus((status) => seen.push(status));
  const timed = {
    ...sequence,
    revision: '3',
    items: [{ id: 'v', trackId: 't', type: 'video', span: { fromFrame: 0, durationFrames: 300 } }],
  } as unknown as Sequence;
  engine.setVideo(timed, {});
  await new Promise((resolve) => setTimeout(resolve, 10));
  engine.setLiveCaption('job_t', [{ key: 'a', start: 1, end: 3, text: '你好' }]);
  await new Promise((resolve) => setTimeout(resolve, 10));

  const sent = videos.at(-1)!;
  expect(sent.revision).toBe('3');
  expect(sent.items.map((item) => item.id)).toEqual(['v', 'bc-live-caption']);
  expect(loads).toEqual([]);
  const docs = sentDocuments.at(-1)!;
  expect(docs.map((d) => d.documentId)).toEqual(['bc-live-caption-document', 'bc-live-caption-style']);
  expect(docs[0]!.body).toMatchObject({ clock: 'sequence', cues: [{ start: 1000, end: 3000, text: '你好' }] });
  expect(engine.captionHits).toEqual([]);
  expect(seen.at(-1)).toEqual({ kind: 'ready' });

  // 舞台隐藏字幕（`off`）时临时字幕也不叠，放开后接着叠。
  engine.setCaptionView('off');
  expect(videos.at(-1)!.items.map((item) => item.id)).toEqual(['v']);
  engine.setCaptionView(null);
  expect(videos.at(-1)!.items.map((item) => item.id)).toEqual(['v', 'bc-live-caption']);

  engine.setLiveCaption('job_t', null);
  expect(videos.at(-1)).toBe(timed);
  engine.dispose();
});

test('倍速：播放中从换的那一刻起按新倍速走钟，媒体元素跟着乘上倍速', async () => {
  const { video } = fakeMedia();
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  let now = 1000;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const asset = { id: 'asset_v', revision: 'r1' };
  const planAt = (seconds: number) => ({
    sequenceId: 'seq',
    sequenceRevision: 'r1',
    frame: Math.floor(seconds * 30 + 1e-6),
    canvas: { width: 1920, height: 1080, background: '#000000', backgroundAlpha: 1 },
    layers: [{ kind: 'video', itemId: 'clip', asset, sourceSeconds: seconds, sourceRate: 1.5, matrix: [1, 0, 0, 1, 0, 0], opacity: 1 }],
    voices: [],
  });
  const planner = { ...fakePlanner(), planAt } as unknown as RenderPlanner;
  const times: number[] = [];
  const engine = new PreviewEngine({ onTime: (seconds) => times.push(seconds), onEnded: () => {} }, () => Promise.resolve(planner));
  engine.register(videoKey(asset, 0), video as unknown as HTMLVideoElement);
  const timed = {
    ...sequence,
    items: [{ id: 'clip', trackId: 't', type: 'video', assetRef: asset, span: { fromFrame: 0, durationFrames: 300 } }],
  } as unknown as Sequence;
  try {
    engine.setVideo(timed, {});
    await new Promise((resolve) => setTimeout(resolve, 10));
    engine.play();
    expect(video.playbackRate).toBe(1.5);
    now = 2000;
    engine.setRate(2);
    expect(engine.rate).toBe(2);
    expect(video.playbackRate).toBe(3);
    // 换倍速之前走了 1 秒，之后的 1 秒按 2 倍走。
    now = 3000;
    frames.at(-1)!(now);
    expect(times.at(-1)).toBeCloseTo(3);
    engine.setRate(100);
    expect(engine.rate).toBe(16);
  } finally {
    engine.dispose();
    clock.mockRestore();
    vi.unstubAllGlobals();
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('ImageData', function (data: Uint8ClampedArray, width: number, height: number) {
      return { data, width, height };
    });
  }
});

/** 与 `element` 同一种的新假媒体元素（`fakeMedia()` 里的类）。 */
function fakeElementLike(element: FakeElement): FakeElement {
  return new (element.constructor as new () => FakeElement)();
}

/** 播放时钟测试的一个 tick：60 Hz 的刷新。 */
const FRAME_MS = 1000 / 60;

/** 一个在响的声音（与 render-graph 给的一样）：实例从 `start` 秒起，源从 `from` 秒起按 `rate` 走。 */
function voiceAt(
  t: number,
  itemId: string,
  start: number,
  options: { source?: 'audio' | 'embedded'; asset?: { id: string; revision: string }; from?: number; rate?: number } = {},
) {
  const rate = options.rate ?? 1;
  return {
    itemId,
    source: options.source ?? 'audio',
    asset: options.asset ?? { id: `asset_${itemId}`, revision: 'r1' },
    sourceSeconds: (options.from ?? 0) + (t - start) * rate,
    sourceRate: rate,
    gainDb: 0,
  };
}

/** 序列上的音频实例：从 `start` 秒起放 `seconds` 秒（30 fps）。 */
function audioItem(id: string, trackId: string, start: number, seconds: number) {
  return {
    id,
    trackId,
    type: 'audio',
    enabled: true,
    assetRef: { id: `asset_${id}`, revision: 'r1' },
    fromFrame: start * 30,
    subframeOffset: { ticks: 0, timescale: 30 },
    playDuration: { ticks: seconds * 30, timescale: 30 },
  };
}

/** 序列上只出画面的视频实例与它的层（素材探测过、没有音轨）。 */
const brollAsset = { id: 'asset_broll', revision: 'r1' };
const brollItem = { id: 'broll', trackId: 'v1', type: 'video', enabled: true, assetRef: brollAsset, span: { fromFrame: 0, durationFrames: 300 } };
const brollAssets = {
  asset_broll: { id: 'asset_broll', revisions: { r1: { revision: 'r1', video: { displayWidth: 1920, displayHeight: 1080 } } } },
};
function brollLayer(t: number) {
  return { kind: 'video', itemId: 'broll', asset: brollAsset, sourceSeconds: t, sourceRate: 1, matrix: [1, 0, 0, 1, 0, 0], opacity: 1 };
}

/**
 * 播放时钟的台子：假的媒体元素、手动的动画帧与墙钟、按时刻给层与声音的计划器（层与声音由测试按 render-graph 的样子给）。
 * `to(ms)` 把墙钟拨到 `ms`，每 1/60 秒一个 tick；tick 之前，没停、没在定位、没冻住、数据够的元素按 `playbackRate` 乘 `speed` 往前走。
 */
async function clockRig(options: {
  items: unknown[];
  tracks?: { id: string; order: number }[];
  assets?: Record<string, unknown>;
  layers?: (t: number) => unknown[];
  voices: (t: number) => unknown[];
  elements: (media: ReturnType<typeof fakeMedia>) => Record<string, FakeElement>;
}) {
  const media = fakeMedia();
  const elements = options.elements(media);
  const frames = manualFrames();
  const times: number[] = [];
  const planAt = (seconds: number) => ({
    sequenceId: 'seq',
    sequenceRevision: 'r1',
    frame: Math.floor(seconds * 30 + 1e-6),
    canvas: { width: 1920, height: 1080, background: '#000000', backgroundAlpha: 1 },
    layers: options.layers?.(seconds) ?? [],
    voices: options.voices(seconds),
  });
  const planner = { ...fakePlanner(), planAt } as unknown as RenderPlanner;
  const engine = new PreviewEngine({ onTime: (seconds) => times.push(seconds), onEnded: () => {} }, () => Promise.resolve(planner));
  for (const [key, element] of Object.entries(elements)) engine.register(key, element as unknown as HTMLAudioElement);
  const video = { ...sequence, tracks: options.tracks ?? [], items: options.items } as unknown as Sequence;
  engine.setVideo(video, (options.assets ?? {}) as Record<string, AssetRecord>);
  await new Promise((resolve) => setTimeout(resolve, 10));
  // 落地会报 `seeked`，引擎再对一次元素，可能又定位一次：落到都不在定位为止。
  const land = () => {
    for (let round = 0; round < 5; round++) for (const element of Object.values(elements)) if (element.seeking) element.land();
  };
  land();
  let wall = 0;
  const step = (ms: number) => {
    const seconds = (ms - wall) / 1000;
    wall = ms;
    for (const element of Object.values(elements))
      if (!element.paused && !element.seeking && !element.frozen && element.readyState >= 3) element.advance(seconds * element.playbackRate * element.speed);
    frames.tick(ms);
  };
  return {
    engine,
    elements,
    times,
    land,
    get wall() {
      return wall;
    },
    /** 一个个 tick 走到墙钟的 `ms`；每个 tick 之后调 `each`。 */
    to(ms: number, each?: () => void) {
      while (wall + FRAME_MS <= ms + 1e-9) {
        step(wall + FRAME_MS);
        each?.();
      }
    },
    dispose() {
      engine.dispose();
      frames.restore();
      restoreGlobals();
    },
  };
}

/**
 * 引擎时间一个 tick 一个 tick 地看：不倒退，每一步不比墙钟的一个 tick 多走超过交接靠拢的 5%；`steady` 时也不少走超过 5%
 * （没有停下来等的时候：交接是靠拢过去，不是停住等新来源追上）。
 */
function expectSmooth(times: readonly number[], from = 0, steady = false): void {
  const frame = FRAME_MS / 1000;
  for (let i = Math.max(1, from); i < times.length; i++) {
    const step = times[i]! - times[i - 1]!;
    expect(step).toBeGreaterThanOrEqual(steady ? frame * 0.95 - 1e-9 : 0);
    expect(step).toBeLessThanOrEqual(frame * 1.05 + 1e-9);
  }
}

test('播放时钟：只有一个声音时引擎时间按它的 currentTime 换算，不按墙钟（声卡的时钟比墙钟慢也跟着它）', async () => {
  const rig = await clockRig({
    items: [audioItem('narration', 'a1', 0, 10)],
    tracks: [{ id: 'a1', order: 0 }],
    // 源从第 2 秒起、按 2 倍走：t = (currentTime − 2) / 2。
    voices: (t) => [voiceAt(t, 'narration', 0, { from: 2, rate: 2 })],
    elements: ({ media }) => ({ [audioKey('narration')]: Object.assign(media(), { speed: 0.98 }) }),
  });
  const narration = rig.elements[audioKey('narration')]!;
  try {
    rig.engine.play();
    rig.to(1000);
    expect(narration.playbackRate).toBe(2);
    expect(rig.engine.time).toBeCloseTo((narration.currentTime - 2) / 2, 9);
    expect(rig.engine.time).toBeLessThan(0.985);
    // 起钟那一下从它已经放出的那一点开始，之后一步步跟着走。
    expectSmooth(rig.times, 2);
  } finally {
    rig.dispose();
  }
});

test('播放时钟：没有声音时按墙钟走；没有音轨的视频不出声，按只出画面的元素静音、调速追', async () => {
  const rig = await clockRig({
    items: [brollItem],
    tracks: [{ id: 'v1', order: 0 }],
    assets: brollAssets,
    layers: (t) => [brollLayer(t)],
    // 视频实例自带的声音开着，但素材没有音轨。
    voices: (t) => [voiceAt(t, 'broll', 0, { source: 'embedded', asset: brollAsset })],
    elements: ({ clip }) => ({ [videoKey(brollAsset, 0)]: Object.assign(clip(), { speed: 0.9 }) }),
  });
  const broll = rig.elements[videoKey(brollAsset, 0)]!;
  try {
    rig.engine.play();
    rig.to(1000);
    expect(rig.engine.time).toBeCloseTo(1, 9);
    expect(broll.muted).toBe(true);
    // 它比墙钟慢：调快追上。
    expect(broll.playbackRate).toBeGreaterThan(1);
  } finally {
    rig.dispose();
  }
});

test('播放时钟：预览静音（监听静音）不换时钟来源，元素静音了照样跟着它走', async () => {
  const rig = await clockRig({
    items: [audioItem('narration', 'a1', 0, 10)],
    tracks: [{ id: 'a1', order: 0 }],
    voices: (t) => [voiceAt(t, 'narration', 0)],
    elements: ({ media }) => ({ [audioKey('narration')]: Object.assign(media(), { speed: 0.97 }) }),
  });
  const narration = rig.elements[audioKey('narration')]!;
  try {
    rig.engine.setMonitor({ volume: 0.5, muted: true });
    rig.engine.play();
    rig.to(500);
    rig.engine.setMonitor({ volume: 0, muted: false });
    rig.to(1000);
    rig.engine.setMonitor({ volume: 1, muted: true });
    rig.to(1500);
    expect(narration.muted).toBe(true);
    expect(rig.engine.time).toBeCloseTo(narration.currentTime, 9);
    expect(rig.engine.time).toBeLessThan(1.46);
  } finally {
    rig.dispose();
  }
});

test('播放时钟：不重叠的前后两段，前一段放完时钟不跳，按墙钟接着走，下一段起播之后以 5%/秒靠拢过去', async () => {
  const rig = await clockRig({
    items: [audioItem('a', 'a1', 0, 1), audioItem('b', 'a1', 1, 5)],
    tracks: [{ id: 'a1', order: 0 }],
    voices: (t) => (t < 1 ? [voiceAt(t, 'a', 0)] : t < 6 ? [voiceAt(t, 'b', 1)] : []),
    elements: ({ media }) => ({
      [audioKey('a')]: Object.assign(media(), { speed: 0.97 }),
      // 下一段起播要 80 ms 才出声。
      [audioKey('b')]: Object.assign(media(), { frozen: true }),
    }),
  });
  const a = rig.elements[audioKey('a')]!;
  const b = rig.elements[audioKey('b')]!;
  try {
    rig.engine.play();
    rig.to(800);
    // 前一段：跟着它（比墙钟慢）。
    expect(rig.engine.time).toBeCloseTo(a.currentTime, 9);
    while (rig.engine.time < 1) rig.to(rig.wall + FRAME_MS);
    const handoff = rig.times.length;
    rig.to(rig.wall + 80);
    expect(a.paused).toBe(true);
    expect(b.paused).toBe(false);
    b.frozen = false;
    rig.to(rig.wall + 2 * FRAME_MS);
    // 跟上了下一段：引擎比它领先起播的那一截，不跳回去。
    const lead = rig.engine.time - (1 + b.currentTime);
    expect(lead).toBeGreaterThan(0.05);
    expect(lead).toBeLessThan(0.12);
    rig.to(rig.wall + 3000);
    expect(rig.engine.time).toBeCloseTo(1 + b.currentTime, 9);
    expectSmooth(rig.times, handoff, true);
    expect(rig.engine.stats.resyncs).toBe(0);
  } finally {
    rig.dispose();
  }
});

test('播放时钟：声音重叠时主声音有粘性，放完才换；挑的时候先比开始时刻、再比轨道顺序（与谁先有元素无关）', async () => {
  const rig = await clockRig({
    items: [audioItem('dialog', 'a1', 1, 7), audioItem('music', 'a2', 0, 3), audioItem('sfx', 'a3', 1, 7)],
    tracks: [
      { id: 'a1', order: 0 },
      { id: 'a2', order: 1 },
      { id: 'a3', order: 2 },
    ],
    // 与 render-graph 一样按轨道、实例 ID 排。
    voices: (t) => [
      ...(t >= 1 && t < 8 ? [voiceAt(t, 'dialog', 1)] : []),
      ...(t < 3 ? [voiceAt(t, 'music', 0)] : []),
      ...(t >= 1 && t < 8 ? [voiceAt(t, 'sfx', 1)] : []),
    ],
    // 各自的时钟快慢不同：引擎跟着谁，看得出来。配乐的元素晚到（地址还在取）。
    elements: ({ media }) => ({
      [audioKey('dialog')]: Object.assign(media(), { speed: 1.03 }),
      [audioKey('sfx')]: media(),
    }),
  });
  const dialog = rig.elements[audioKey('dialog')]!;
  try {
    rig.engine.play();
    rig.to(900);
    // 配乐还没有元素：没有能跟的声音，按墙钟。
    expect(rig.engine.time).toBeCloseTo(0.9, 9);
    // 对白与音效同时开始：对白的轨道靠前，跟它。
    rig.to(1500);
    expect(rig.engine.time).toBeCloseTo(1 + dialog.currentTime, 9);
    // 配乐的元素到了：按规则它开始得最早，但对白还没放完，不换。
    const music = Object.assign(fakeElementLike(dialog), { speed: 0.98 });
    rig.elements[audioKey('music')] = music;
    rig.engine.register(audioKey('music'), music as unknown as HTMLAudioElement);
    rig.land();
    rig.to(2500);
    expect(music.paused).toBe(false);
    expect(rig.engine.time).toBeCloseTo(1 + dialog.currentTime, 9);

    // 播放中定位到三个都在的第 2 秒：重新挑，配乐开始得最早（轨道靠后也一样）。
    rig.engine.seek(2);
    rig.land();
    rig.to(rig.wall + 500);
    expect(rig.engine.time).toBeCloseTo(music.currentTime, 9);
    // 配乐放完：对白与音效开始得一样早，对白的轨道靠前，交给它。
    while (rig.engine.time < 3) rig.to(rig.wall + FRAME_MS);
    rig.to(rig.wall + 3000);
    expect(rig.engine.time).toBeCloseTo(1 + dialog.currentTime, 9);
  } finally {
    rig.dispose();
  }
});

test('播放时钟：别的声音按要的速度自由走、不调速，偏离引擎时钟超过 0.25 秒才重新定位；主声音不重新定位', async () => {
  const rig = await clockRig({
    items: [audioItem('music', 'a1', 0, 10), audioItem('sfx', 'a2', 0, 10)],
    tracks: [
      { id: 'a1', order: 0 },
      { id: 'a2', order: 1 },
    ],
    voices: (t) => [voiceAt(t, 'music', 0), voiceAt(t, 'sfx', 0)],
    elements: ({ media }) => ({
      [audioKey('music')]: media(),
      // 每秒多走 0.25 秒。
      [audioKey('sfx')]: Object.assign(media(), { speed: 1.25 }),
    }),
  });
  const music = rig.elements[audioKey('music')]!;
  const sfx = rig.elements[audioKey('sfx')]!;
  try {
    rig.engine.setRate(1.5);
    rig.engine.play();
    const rates = new Set<number>();
    rig.to(500, () => rates.add(sfx.playbackRate));
    expect([...rates]).toEqual([1.5]);
    expect(sfx.currentTime - rig.engine.time).toBeGreaterThan(0.15);
    expect(rig.engine.stats.resyncs).toBe(0);
    let reseatedAt: number | null = null;
    rig.to(1000, () => {
      if (sfx.seeking) reseatedAt ??= rig.engine.time;
    });
    expect(rig.engine.stats.resyncs).toBe(1);
    expect(sfx.seeking).toBe(true);
    expect(sfx.currentTime).toBeCloseTo(reseatedAt!, 9);
    expect(music.seeking).toBe(false);
    expect(music.playbackRate).toBe(1.5);
  } finally {
    rig.dispose();
  }
});

test('播放时钟：没有声音的一段之后声音进来，偏得多先重新定位它，不慢慢追；跟上之后靠拢不倒退，放完回墙钟也不跳', async () => {
  const rig = await clockRig({
    // 序列到第 5 秒（标题），旁白只在 1–3 秒。
    items: [audioItem('vo', 'a1', 1, 2), { id: 'title', type: 'text', enabled: true, trackId: 't1', span: { fromFrame: 0, durationFrames: 150 } }],
    tracks: [
      { id: 'a1', order: 0 },
      { id: 't1', order: 1 },
    ],
    voices: (t) => (t >= 1 && t < 3 ? [voiceAt(t, 'vo', 1)] : []),
    elements: ({ media }) => ({ [audioKey('vo')]: media() }),
  });
  const vo = rig.elements[audioKey('vo')]!;
  try {
    // 元素停在离它要的源时刻 3 秒远的地方。
    vo.currentTime = 3;
    vo.land();
    rig.engine.play();
    rig.to(1000);
    expect(rig.engine.time).toBeCloseTo(1, 9);
    rig.to(rig.wall + FRAME_MS);
    expect(rig.engine.stats.resyncs).toBe(1);
    expect(vo.seeking).toBe(true);
    // 定位要 50 ms 才落地：这期间按墙钟接着走。
    rig.to(rig.wall + 50);
    vo.land();
    rig.to(rig.wall + 2 * FRAME_MS);
    const lead = rig.engine.time - (1 + vo.currentTime);
    expect(lead).toBeGreaterThan(0.04);
    expect(lead).toBeLessThan(0.1);
    rig.to(rig.wall + 1800);
    expect(rig.engine.time).toBeCloseTo(1 + vo.currentTime, 9);
    rig.to(4000);
    expect(rig.engine.time).toBeGreaterThan(3.8);
    expect(rig.engine.stats.resyncs).toBe(1);
    expectSmooth(rig.times, 0, true);
  } finally {
    rig.dispose();
  }
});

test('播放时钟：起播等主声音真正走起来再起钟，只出画面的元素一起等；最多等 0.5 秒，之后先按墙钟走', async () => {
  const rig = await clockRig({
    items: [audioItem('narration', 'a1', 0, 10), brollItem],
    tracks: [
      { id: 'a1', order: 0 },
      { id: 'v1', order: 0 },
    ],
    assets: brollAssets,
    layers: (t) => [brollLayer(t)],
    voices: (t) => [voiceAt(t, 'narration', 0)],
    elements: ({ media, clip }) => ({
      [audioKey('narration')]: Object.assign(media(), { frozen: true }),
      [videoKey(brollAsset, 0)]: clip(),
    }),
  });
  const narration = rig.elements[audioKey('narration')]!;
  const broll = rig.elements[videoKey(brollAsset, 0)]!;
  try {
    rig.engine.play();
    rig.to(200);
    expect(rig.times.every((t) => t === 0)).toBe(true);
    expect(narration.paused).toBe(false);
    expect(broll.paused).toBe(true);
    // 出声了：从它这一刻起钟，画面跟上。
    narration.frozen = false;
    rig.to(400);
    expect(rig.engine.time).toBeGreaterThan(0.15);
    expect(rig.engine.time).toBeCloseTo(narration.currentTime, 9);
    expect(broll.paused).toBe(false);

    // 再来一次，这回它一直不出声：等 0.5 秒，之后按墙钟走。
    rig.engine.pause();
    rig.engine.seek(0);
    rig.land();
    narration.frozen = true;
    const begun = rig.wall;
    rig.engine.play();
    rig.to(begun + 480);
    expect(rig.engine.time).toBe(0);
    rig.to(begun + 1000);
    expect(rig.engine.time).toBeGreaterThan(0.45);
    expect(rig.engine.time).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(broll.paused).toBe(false);
  } finally {
    rig.dispose();
  }
});

test('播放时钟：播放中定位一小段（不到 0.25 秒）也把元素对到新位置，时钟从那里起，不被主声音拉回原处', async () => {
  const rig = await clockRig({
    items: [audioItem('narration', 'a1', 0, 10)],
    tracks: [{ id: 'a1', order: 0 }],
    voices: (t) => [voiceAt(t, 'narration', 0)],
    elements: ({ media }) => ({ [audioKey('narration')]: media() }),
  });
  const narration = rig.elements[audioKey('narration')]!;
  try {
    rig.engine.play();
    rig.to(1000);
    const target = rig.engine.time + 0.1;
    rig.engine.seek(target);
    expect(narration.currentTime).toBeCloseTo(target, 9);
    rig.land();
    rig.to(rig.wall + 300);
    expect(rig.engine.time).toBeGreaterThan(target + 0.2);
    expect(rig.engine.time).toBeCloseTo(narration.currentTime, 9);
  } finally {
    rig.dispose();
  }
});

test('播放时钟：跟着的主声音缓冲卡住时时钟也停，画面与别的声音一起停；数据到了接着走，不跳', async () => {
  const rig = await clockRig({
    items: [audioItem('narration', 'a1', 0, 10), audioItem('music', 'a2', 0, 10), brollItem],
    tracks: [
      { id: 'a1', order: 0 },
      { id: 'a2', order: 1 },
      { id: 'v1', order: 0 },
    ],
    assets: brollAssets,
    layers: (t) => [brollLayer(t)],
    voices: (t) => [voiceAt(t, 'narration', 0), voiceAt(t, 'music', 0)],
    elements: ({ media, clip }) => ({
      [audioKey('narration')]: media(),
      [audioKey('music')]: media(),
      [videoKey(brollAsset, 0)]: clip(),
    }),
  });
  const narration = rig.elements[audioKey('narration')]!;
  const music = rig.elements[audioKey('music')]!;
  const broll = rig.elements[videoKey(brollAsset, 0)]!;
  try {
    rig.engine.play();
    rig.to(500);
    // 没数据了（readyState 掉到 HAVE_CURRENT_DATA）。
    narration.readyState = 2;
    rig.to(rig.wall + 2 * FRAME_MS);
    const stalled = rig.engine.time;
    rig.to(rig.wall + 1000);
    expect(rig.engine.time).toBe(stalled);
    expect(broll.paused).toBe(true);
    expect(music.paused).toBe(true);
    expect(narration.paused).toBe(false);
    narration.readyState = 4;
    rig.to(rig.wall + 500);
    expect(rig.engine.time).toBeCloseTo(narration.currentTime, 9);
    expect(rig.engine.time - stalled).toBeGreaterThan(0.45);
    expect(broll.paused).toBe(false);
    expect(music.paused).toBe(false);
    expectSmooth(rig.times, 2);
    expect(rig.engine.stats.resyncs).toBe(0);
  } finally {
    rig.dispose();
  }
});

test('播放时钟：只出画面的静音视频元素照旧调速追引擎时钟（跟着主声音），出声的元素只按要的速度放（调速会在声音里留下爆音）', async () => {
  const rig = await clockRig({
    items: [audioItem('narration', 'a1', 0, 10), brollItem],
    tracks: [
      { id: 'a1', order: 0 },
      { id: 'v1', order: 0 },
    ],
    assets: brollAssets,
    layers: (t) => [brollLayer(t)],
    voices: (t) => [voiceAt(t, 'narration', 0)],
    elements: ({ media, clip }) => ({
      // 声音的时钟比墙钟慢 5%，画面元素按墙钟走：画面会跑到声音前面。
      [audioKey('narration')]: Object.assign(media(), { speed: 0.95 }),
      [videoKey(brollAsset, 0)]: clip(),
    }),
  });
  const narration = rig.elements[audioKey('narration')]!;
  const broll = rig.elements[videoKey(brollAsset, 0)]!;
  try {
    rig.engine.setRate(1.5);
    rig.engine.play();
    const rates = new Set<number>();
    rig.to(2000, () => rates.add(narration.playbackRate));
    expect([...rates]).toEqual([1.5]);
    expect(rig.engine.time).toBeCloseTo(narration.currentTime, 9);
    expect(broll.playbackRate).toBeLessThan(1.5);
    expect(Math.abs(broll.currentTime - rig.engine.time)).toBeLessThan(0.05);
    expect(rig.engine.stats.resyncs).toBe(0);
  } finally {
    rig.dispose();
  }
});

test('字幕档位：送给计划器的序列上停用不该露的字幕，换视频时照样停，收起后照原样送', async () => {
  const videos: Sequence[] = [];
  const planner = { ...fakePlanner(), setVideo: ({ sequence: s }: { sequence: Sequence }) => videos.push(s) } as unknown as RenderPlanner;
  const engine = new PreviewEngine({ onTime: () => {}, onEnded: () => {} }, () => Promise.resolve(planner));
  const documents = {
    speech: { id: 'speech', kind: 'speech' },
    trans: { id: 'trans', kind: 'translation' },
    orig: { id: 'orig', kind: 'caption', sourceDocumentId: 'speech' },
    en: { id: 'en', kind: 'caption', sourceDocumentId: 'trans' },
  } as unknown as Record<string, DocumentRecord>;
  const captioned = {
    ...sequence,
    items: [
      { id: 'a', trackId: 's', type: 'caption', enabled: true, documentId: 'orig', span: { fromFrame: 0, durationFrames: 30 } },
      { id: 'b', trackId: 's', type: 'caption', enabled: true, documentId: 'en', span: { fromFrame: 0, durationFrames: 30 } },
    ],
  } as unknown as Sequence;
  const enabled = (s: Sequence | undefined) => s?.items.map((item) => `${item.id}:${item.enabled}`);
  engine.setVideo(captioned, {}, documents);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(videos.at(-1)).toBe(captioned);

  engine.setCaptionView('trans');
  expect(enabled(videos.at(-1))).toEqual(['a:false', 'b:true']);
  const edited = { ...captioned, revision: '2' } as Sequence;
  engine.setVideo(edited, {}, documents);
  expect(videos.at(-1)?.revision).toBe('2');
  expect(enabled(videos.at(-1))).toEqual(['a:false', 'b:true']);

  engine.setCaptionView(null);
  expect(videos.at(-1)).toBe(edited);
  engine.dispose();
});

test('图层开关关了配乐：送给计划器的序列上停用配乐实例，与字幕档位叠在一起，打开后照原样送', async () => {
  const videos: Sequence[] = [];
  const planner = { ...fakePlanner(), setVideo: ({ sequence: s }: { sequence: Sequence }) => videos.push(s) } as unknown as RenderPlanner;
  const engine = new PreviewEngine({ onTime: () => {}, onEnded: () => {} }, () => Promise.resolve(planner));
  const scored = {
    ...sequence,
    items: [
      { id: 'c', trackId: 's', type: 'caption', enabled: true, documentId: 'orig', span: { fromFrame: 0, durationFrames: 30 } },
      { id: 'm', trackId: 'a', type: 'audio', role: 'music', enabled: true, span: { fromFrame: 0, durationFrames: 30 } },
      { id: 'v', trackId: 'a', type: 'audio', enabled: true, span: { fromFrame: 0, durationFrames: 30 } },
    ],
  } as unknown as Sequence;
  const enabled = (s: Sequence | undefined) => s?.items.map((item) => `${item.id}:${item.enabled}`);
  engine.setVideo(scored, {});
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(videos.at(-1)).toBe(scored);

  engine.setMusicView(true);
  expect(enabled(videos.at(-1))).toEqual(['c:true', 'm:false', 'v:true']);
  engine.setCaptionView('off');
  expect(enabled(videos.at(-1))).toEqual(['c:false', 'm:false', 'v:true']);
  engine.setCaptionView(null);
  engine.setMusicView(false);
  expect(videos.at(-1)).toBe(scored);
  engine.dispose();
});

test('监听音量变了时通知订阅者；订阅时先给一次当前的', () => {
  const engine = new PreviewEngine({ onTime: () => {}, onEnded: () => {} }, () => Promise.resolve(fakePlanner()));
  const seen: { volume: number; muted: boolean }[] = [];
  const stop = engine.onMonitor((monitor) => seen.push(monitor));
  engine.setMonitor({ volume: 0.4, muted: true });
  stop();
  engine.setMonitor({ volume: 1, muted: false });
  expect(seen).toEqual([
    { volume: 1, muted: false },
    { volume: 0.4, muted: true },
  ]);
  engine.dispose();
});

test('字幕场景按样式文档的冻结素材版本加载字节', async () => {
  const cap = { type: 'caption', id: 'cap', enabled: true, documentId: 'caption', styleDocumentId: 'style', span: { fromFrame: 0, durationFrames: 90 } };
  const scene = { ...sequence, items: [cap] } as unknown as Sequence;
  const layers = [{ kind: 'caption', itemId: 'cap', matrix: [1, 0, 0, 1, 0, 0], opacity: 1, content: { documentId: 'caption', styleDocumentId: 'style', sequenceSeconds: 0 } }];
  const plan = { canvas: { width: 1920, height: 1080, background: '#000000', backgroundAlpha: 1 }, layers, voices: [] };
  const sent: unknown[] = [];
  const planner = { ...fakePlanner(), planAt: () => plan, setDocuments: () => {}, clearPictures: () => {},
    setAsset: (asset: unknown) => sent.push(asset), render: () => ({ plan, warnings: [], skipped: [], spectra: [] }),
    frame: () => new Uint8ClampedArray(960 * 540 * 4) } as unknown as RenderPlanner;
  const documents = { peek: () => ({}), load: () => {}, subscribe: () => () => {} };
  const assets = { get: () => ({ state: 'ready', value: new Uint8Array([1, 2, 3]) }), subscribe: () => () => {} };
  const engine = new PreviewEngine({ onTime: () => {}, onEnded: () => {} }, () => Promise.resolve(planner), documents, assets as never);
  const canvas = { width: 0, height: 0, getContext: () => ({ canvas, putImageData: () => {} }) };
  engine.attachCanvas(canvas as unknown as HTMLCanvasElement, 0.5);
  engine.setVideo(scene, {}, {
    caption: { id: 'caption', kind: 'caption', currentRevision: '1', revisions: {} },
    style: { id: 'style', kind: 'caption-style', currentRevision: '2', revisions: { '2': { assetRefs: [{ id: 'badge', revision: 'old-version' }] } } },
  } as never);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(sent).toContainEqual({ id: 'badge', revision: 'old-version' });
  engine.dispose();
});

/** 实时合成层测试里替身（预渲染）的素材版本。 */
const standInAsset = { id: 'baked', revision: '1' };

/**
 * 实时合成层用的计划器（与 render-graph 同一规则）：开了实时层、这件合成没拉黑、这一帧切得开（`cut`）时，计划的底层是它，不看替身；
 * 记下每次画是不是透明底，可按要求抛发光错误。
 */
function livePlanner() {
  const setLive: { enabled: boolean; blocked: string[] }[] = [];
  const renders: { frame: number; transparent: boolean }[] = [];
  const state = { enabled: false, cut: true, blocked: new Set<string>(), emissive: false, standIn: 'none' as 'none' | 'stale' | 'usable' };
  const planAt = (seconds: number) => {
    const frame = Math.floor(seconds * 30 + 1e-6);
    const live = state.enabled && state.cut && !state.blocked.has('comp');
    return {
      sequenceId: 'seq',
      sequenceRevision: 'r1',
      frame,
      canvas: { width: 1920, height: 1080, background: '#000000', backgroundAlpha: live ? 0 : 1 },
      layers: [
        // 不切实时层、替身可用：底是替身的视频层。
        ...(!live && state.standIn === 'usable'
          ? [{ kind: 'video', itemId: 'comp', asset: standInAsset, sourceSeconds: seconds, sourceRate: 1, matrix: [1920, 0, 0, 1080, 0, 0], opacity: 1 }]
          : []),
        { kind: 'text', itemId: 'title', matrix: [1, 0, 0, 1, 0, 0], opacity: 1, content: {} },
      ],
      voices: [],
      ...(live
        ? {
            live: {
              itemId: 'comp',
              asset: { id: 'bundle', revision: '1' },
              sourceSeconds: seconds,
              sourceRate: 1,
              matrix: [1920, 0, 0, 1080, 0, 0],
              opacity: 1,
              width: 1280,
              height: 720,
              standIn: state.standIn,
            },
          }
        : {}),
    };
  };
  const planner = {
    ...fakePlanner(),
    planAt,
    setDocuments: () => {},
    clearPictures: () => {},
    setPicture: () => {},
    setLive: (next: { enabled: boolean; blocked: string[] }) => {
      setLive.push(next);
      state.enabled = next.enabled;
      state.blocked = new Set(next.blocked);
    },
    render: (seconds: number, _w: number, _h: number, options?: { transparent?: boolean }) => {
      const plan = planAt(seconds);
      if (plan.live && state.emissive) throw new PlanFailure({ code: 'EMISSIVE_STRAIGHT_ALPHA_UNSUPPORTED', message: 'emissive' });
      renders.push({ frame: plan.frame, transparent: options?.transparent === true });
      return { plan, warnings: [], skipped: [], spectra: [], fonts: [] };
    },
    frame: () => new Uint8ClampedArray(4),
  } as unknown as RenderPlanner;
  return { planner, setLive, renders, state };
}

/** 假的实时层宿主：记下预载名单、每次 show 的层与帧号；失败由测试触发。 */
function fakeLiveHost() {
  const prepared: string[][] = [];
  const shown: [string | null, number][] = [];
  const listeners = new Set<(itemId: string, reason: string) => void>();
  const loadingListeners = new Set<(loading: boolean) => void>();
  return {
    prepared,
    shown,
    host: {
      prepare: (candidates: readonly { itemId: string }[]) => void prepared.push(candidates.map((c) => c.itemId)),
      show: (layer: { itemId: string } | null, frame: number) => void shown.push([layer?.itemId ?? null, frame]),
      onFailure: (listener: (itemId: string, reason: string) => void) => (listeners.add(listener), () => listeners.delete(listener)),
      onLoading: (listener: (loading: boolean) => void) => (loadingListeners.add(listener), listener(false), () => loadingListeners.delete(listener)),
    },
    fail: (itemId: string, reason: string) => listeners.forEach((listener) => listener(itemId, reason)),
    loading: (loading: boolean) => loadingListeners.forEach((listener) => listener(loading)),
  };
}

const withComposition = {
  ...sequence,
  items: [
    { id: 'title', type: 'text', enabled: true, trackId: 't', span: { fromFrame: 0, durationFrames: 300 } },
    {
      id: 'comp',
      type: 'composition',
      enabled: true,
      trackId: 'b',
      span: { fromFrame: 0, durationFrames: 300 },
      source: { kind: 'bundle', assetRef: { id: 'bundle', revision: '1' } },
      parameterValues: {},
      timeMap: { kind: 'identity' },
    },
  ],
} as unknown as Sequence;
const bundleAssets = {
  bundle: {
    id: 'bundle',
    kind: 'video',
    name: 'bundle',
    currentRevision: '1',
    revisions: {
      '1': {
        revision: '1',
        bundle: {
          bundleId: 'b',
          revision: '7',
          runtime: { engine: 'browser', contract: 'hyperframes/1', entry: 'index.html' },
          intrinsic: { width: 1280, height: 720, fps: { num: 30, den: 1 }, durationFrames: 300 },
        },
      },
    },
  },
} as unknown as Record<string, AssetRecord>;

async function liveEngine() {
  const frames = manualFrames();
  const { planner, setLive, renders, state } = livePlanner();
  const live = fakeLiveHost();
  const seen: PreviewStatus[] = [];
  const engine = new PreviewEngine({ onTime: () => {}, onEnded: () => {} }, () => Promise.resolve(planner));
  engine.onStatus((status) => seen.push(status));
  const canvas = { width: 0, height: 0, getContext: () => ({ canvas, putImageData: () => {} }) };
  engine.attachCanvas(canvas as unknown as HTMLCanvasElement, 0.5);
  engine.setVideo(withComposition, bundleAssets);
  await new Promise((resolve) => setTimeout(resolve, 10));
  return { frames, planner, setLive, renders, state, live, seen, engine };
}

test('实时合成层：接上宿主才开实时层；底是实时层的那一帧画透明底，拆掉宿主后画回不透明的', async () => {
  const { frames, setLive, renders, live, seen, engine } = await liveEngine();
  expect(setLive).toEqual([]);
  expect(renders.at(-1)).toEqual({ frame: 0, transparent: false });
  expect(seen.at(-1)).toEqual({ kind: 'ready' });

  engine.attachLive(live.host);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(setLive).toEqual([{ enabled: true, blocked: [] }]);
  expect(renders.at(-1)).toEqual({ frame: 0, transparent: true });
  expect(live.prepared).toEqual([['comp']]);
  expect(live.shown.at(-1)).toEqual(['comp', 0]);
  expect(engine.live?.itemId).toBe('comp');
  // 实时档：状态报 live，没有别的提示。
  expect(seen.at(-1)).toEqual({ kind: 'ready', live: true });

  engine.attachLive(null);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(setLive.at(-1)).toEqual({ enabled: false, blocked: [] });
  expect(renders.at(-1)).toEqual({ frame: 0, transparent: false });
  expect(live.shown.at(-1)).toEqual([null, -1]);
  expect(seen.at(-1)).toEqual({ kind: 'ready' });
  frames.restore();
  engine.dispose();
});

test('实时合成层：播放中每个 tick 都把这一帧的实时层与帧号交给宿主（同一帧只定位一次由宿主保证），帧号不回头', async () => {
  const { frames, live, engine } = await liveEngine();
  engine.attachLive(live.host);
  await new Promise((resolve) => setTimeout(resolve, 10));
  live.shown.length = 0;
  engine.play();
  // 60 Hz 的刷新放 30 fps 的视频：0.1 秒里 6 个 tick，跨 3 个视频帧。
  for (let i = 1; i <= 6; i++) frames.tick(i * (1000 / 60));
  const shownFrames = live.shown.map(([, frame]) => frame);
  expect([...new Set(shownFrames)]).toEqual([0, 1, 2, 3]);
  expect(shownFrames).toEqual([...shownFrames].sort((a, b) => a - b));
  expect(live.shown.every(([itemId]) => itemId === 'comp')).toBe(true);
  engine.pause();
  frames.restore();
  engine.dispose();
});

test('实时合成层：宿主报失败的合成拉黑，重送 setLive，下一个计划没有实时层、画回不透明底；retry 解除', async () => {
  const { frames, setLive, renders, live, seen, engine } = await liveEngine();
  engine.attachLive(live.host);
  await new Promise((resolve) => setTimeout(resolve, 10));
  live.fail('comp', 'ready-timeout');
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(setLive.at(-1)).toEqual({ enabled: true, blocked: ['comp'] });
  expect(engine.live).toBeNull();
  expect(renders.at(-1)).toEqual({ frame: 0, transparent: false });
  expect(live.shown.at(-1)).toEqual([null, 0]);
  // 拉黑后不再预载它。
  expect(live.prepared.at(-1)).toEqual([]);
  expect(seen.at(-1)).toEqual({ kind: 'ready' });

  engine.retry();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(setLive.at(-1)).toEqual({ enabled: true, blocked: [] });
  expect(engine.live?.itemId).toBe('comp');
  expect(live.prepared.at(-1)).toEqual(['comp']);
  frames.restore();
  engine.dispose();
});

test('实时合成层：透明底上有发光像素时这件合成拉黑、重算计划再画，不进错误状态', async () => {
  const { frames, setLive, renders, state, live, seen, engine } = await liveEngine();
  state.emissive = true;
  engine.attachLive(live.host);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(setLive).toEqual([
    { enabled: true, blocked: [] },
    { enabled: true, blocked: ['comp'] },
  ]);
  expect(renders.at(-1)).toEqual({ frame: 0, transparent: false });
  expect(engine.live).toBeNull();
  expect(seen.some((status) => status.kind === 'error')).toBe(false);
  expect(seen.at(-1)).toEqual({ kind: 'ready' });
  frames.restore();
  engine.dispose();
});

test('实时合成层：宿主报在视的页面在载入时引擎跟着报（舞台盖载入面板），画好第一帧撤；在视的失败了退回替身、替身到之前画面算没出来', async () => {
  const { video } = fakeMedia();
  const { frames, state, live, engine } = await liveEngine();
  state.standIn = 'usable';
  const loading: boolean[] = [];
  engine.onLiveLoading((value) => loading.push(value));
  const pictured: boolean[] = [];
  engine.onPicture((value) => pictured.push(value));
  engine.attachLive(live.host);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(engine.live?.itemId).toBe('comp');
  // 实时层上面没有还在来的媒体：画面算出来了，iframe 里有没有东西看 liveLoading。
  expect(pictured.at(-1)).toBe(true);
  live.loading(true);
  expect(engine.liveLoading).toBe(true);
  live.loading(false);
  expect(loading).toEqual([false, true, false]);

  // 在视的那件放不出来：退回替身，替身还没挂上，舞台重新给载入面板；替身到了画上就撤。
  live.loading(true);
  live.fail('comp', 'ready-timeout');
  live.loading(false);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(engine.live).toBeNull();
  expect(pictured.at(-1)).toBe(false);
  engine.register(videoKey(standInAsset, 0), video as unknown as HTMLVideoElement);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(pictured.at(-1)).toBe(true);

  // 拆掉宿主：不再报在载入。
  live.loading(true);
  engine.attachLive(null);
  expect(engine.liveLoading).toBe(false);
  frames.restore();
  engine.dispose();
});

test('实时合成层：替身可用也不看它，播放、暂停与定位落地都是实时层、不提醒烘焙，也不去要替身；宿主放不出来才退回替身', async () => {
  const { video } = fakeMedia();
  let currentTime = 0;
  Object.defineProperty(video, 'currentTime', { get: () => currentTime, set: (seconds: number) => (currentTime = seconds) });
  const { frames, setLive, renders, state, live, seen, engine } = await liveEngine();
  state.standIn = 'usable';
  const standInKey = videoKey(standInAsset, 0);
  // 计划里有没有替身层（有才会去要替身、让 Runtime 转播放副本）。
  let standInPlanned = false;
  engine.onPlan((plan) => (standInPlanned = plan.layers.some((layer) => layer.itemId === 'comp')));
  engine.attachLive(live.host);
  await new Promise((resolve) => setTimeout(resolve, 10));
  // 停着：实时层，透明底，替身可用所以不提醒「导出前要烘焙」；计划里没有替身层，也就没有要替身的元素。
  expect(setLive).toEqual([{ enabled: true, blocked: [] }]);
  expect(engine.live?.standIn).toBe('usable');
  expect(renders.at(-1)).toEqual({ frame: 0, transparent: true });
  expect(live.shown.at(-1)).toEqual(['comp', 0]);
  expect(seen.at(-1)).toEqual({ kind: 'ready' });
  expect(standInPlanned).toBe(false);

  // 播放、暂停、停着定位落地：设置不变不重送，一直是实时层，iframe 不收。
  engine.play();
  frames.tick(1000 / 60);
  engine.pause();
  engine.seek(1);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(setLive).toEqual([{ enabled: true, blocked: [] }]);
  expect(engine.live?.itemId).toBe('comp');
  expect(renders.at(-1)).toEqual({ frame: 30, transparent: true });
  expect(live.shown.at(-1)).toEqual(['comp', 30]);
  expect(live.shown.some(([itemId]) => itemId === null)).toBe(false);

  // 宿主放不出来：拉黑，退回替身那一帧（这时才要替身）。
  live.fail('comp', 'ready-timeout');
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(setLive.at(-1)).toEqual({ enabled: true, blocked: ['comp'] });
  expect(engine.live).toBeNull();
  expect(standInPlanned).toBe(true);
  engine.register(standInKey, video as unknown as HTMLVideoElement);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(renders.at(-1)).toEqual({ frame: 30, transparent: false });

  // 替身不可用时这才提醒烘焙。
  state.standIn = 'stale';
  engine.retry();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(engine.live?.standIn).toBe('stale');
  expect(seen.at(-1)).toEqual({ kind: 'ready', live: true });
  frames.restore();
  engine.dispose();
});

test('实时合成层：iframe 露着、这一帧却切不开而要画替身时，替身还在来就让实时层撑着（画面算出来了）；撑着时宿主失败重新给载入面板，替身到了才画那一帧、收起 iframe', async () => {
  const { video } = fakeMedia();
  let currentTime = 0;
  Object.defineProperty(video, 'currentTime', { get: () => currentTime, set: (seconds: number) => (currentTime = seconds) });
  const { frames, renders, state, live, engine } = await liveEngine();
  state.standIn = 'usable';
  const pictured: boolean[] = [];
  engine.onPicture((value) => pictured.push(value));
  engine.attachLive(live.host);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(live.shown.at(-1)).toEqual(['comp', 0]);

  // 这一帧切不开（如进了转场）：计划换回替身层，替身的元素还没挂上。
  const order: string[] = [];
  const show = live.host.show;
  live.host.show = (layer, frame) => {
    order.push(layer ? 'show' : 'hide');
    show(layer, frame);
  };
  state.cut = false;
  engine.seek(0);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(engine.live).toBeNull();
  expect(renders.at(-1)).toEqual({ frame: 0, transparent: true });
  expect(order).not.toContain('hide');
  expect(pictured.at(-1)).toBe(true);

  // 撑着时宿主失败：撤掉，替身还没到，画面又没了。
  live.fail('comp', 'ready-timeout');
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(pictured.at(-1)).toBe(false);

  // 重试：又切得开，再露实时层；再切不开、替身到了：画不透明的那一帧，然后收起 iframe。
  state.cut = true;
  engine.retry();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(live.shown.at(-1)?.[0]).toBe('comp');
  state.cut = false;
  engine.seek(0);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(live.shown.at(-1)?.[0]).toBe('comp');
  video.readyState = 4;
  engine.register(videoKey(standInAsset, 0), video as unknown as HTMLVideoElement);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(renders.at(-1)).toEqual({ frame: 0, transparent: false });
  expect(live.shown.at(-1)?.[0]).toBeNull();
  frames.restore();
  engine.dispose();
});
