import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { VideoSnapshot } from '@baocut/protocol';
import { PlanFailure, RenderPlanner } from './render-planner.ts';

// 编出来的 WASM 与原生 Rust 对同一个夹具视频给出逐字节相同的计划（金标准由 `cargo test -p render-graph` 维护）。
const wasm = fileURLToPath(new URL('./generated/preview.wasm', import.meta.url));
const fixtures = fileURLToPath(new URL('../../../../crates/render-graph/tests/fixtures/', import.meta.url));
const fonts = fileURLToPath(new URL('../../../../crates/render-raster/assets/fonts/', import.meta.url));
const probeFont = fileURLToPath(new URL('../../../../crates/render-raster/tests/fixtures/fonts/ColrProbe.ttf', import.meta.url));
const built = existsSync(wasm);
if (!built) console.warn('没有找到预览 WASM，跳过一致性测试：先运行 npm run build:wasm');

async function setup(): Promise<{ planner: RenderPlanner; video: VideoSnapshot }> {
  const planner = await RenderPlanner.instantiate(readFileSync(wasm));
  const video = JSON.parse(readFileSync(`${fixtures}video.json`, 'utf8')) as VideoSnapshot;
  planner.setVideo({ sequence: video.sequences[video.rootSequenceId]!, assets: video.assets });
  return { planner, video };
}

describe.skipIf(!built)('帧计划器（WASM）', () => {
  it('中英文字幕自动补间距，与显式空格的实际像素一致', async () => {
    const { planner, video } = await setup();
    planner.addFonts(planner.fontFiles().map((name) => new Uint8Array(readFileSync(`${fonts}${name}`))));
    const sequence = video.sequences[video.rootSequenceId]!;
    planner.setVideo({
      sequence: {
        ...sequence,
        tracks: [{ id: 'trk_caption', order: 0, kind: 'subtitle', locked: false, visible: true, muted: false, solo: { enabled: false, group: 'visual' } }],
        items: [{
          id: 'item_caption', trackId: 'trk_caption', enabled: true, locked: false, paintOrder: 0,
          followPolicy: { kind: 'sequence-fixed' }, span: { fromFrame: 0, durationFrames: 90 },
          type: 'caption', documentId: 'doc_caption', scopeItemIds: [],
        }],
      },
      assets: {},
    });
    const render = (text: string, lineKind: 'original' | 'translation') => {
      planner.setDocuments([{
        documentId: 'doc_caption', kind: 'caption', lineKind,
        body: { schema: 'baocut.caption/1', clock: 'sequence', timescale: 1000, cues: [{ id: 'c1', start: 0, end: 3000, text }] },
      }]);
      const result = planner.render(1, 640, 360, { transparent: true });
      expect(result.skipped).toEqual([]);
      expect(result.captionHits).toHaveLength(1);
      return new Uint8ClampedArray(planner.frame());
    };
    for (const kind of ['original', 'translation'] as const) {
      const actual = render('让Claude创建一个Artifact', kind);
      expect(actual.some((byte, i) => i % 4 === 3 && byte > 0)).toBe(true);
      expect(Buffer.from(actual).equals(Buffer.from(render('让 Claude 创建一个 Artifact', kind)))).toBe(true);
    }
  });

  it('与原生 Rust 的金标准逐字节一致', async () => {
    const { planner } = await setup();
    const lines = readFileSync(`${fixtures}plan-golden.txt`, 'utf8').trimEnd().split('\n');
    expect(lines.length).toBeGreaterThan(10);
    for (const line of lines) {
      const [seconds, json] = line.split('\t') as [string, string];
      expect(planner.planJson(Number(seconds)), `t = ${seconds}`).toBe(json);
    }
  });

  it('计划里的层按合成顺序排列', async () => {
    const { planner } = await setup();
    const plan = planner.planAt(1.5);
    expect(plan.frame).toBe(45);
    expect(plan.layers.map((layer) => layer.itemId)).toEqual(['item_land_a', 'item_port', 'item_logo']);
    expect(plan.voices.map((voice) => voice.itemId)).toEqual(['item_land_a', 'item_music', 'item_hidden']);
  });

  it('错误带着引擎的代码；送不进去的视频不顶掉上一个', async () => {
    const { planner, video } = await setup();
    const sequence = video.sequences[video.rootSequenceId]!;
    const failure = (() => {
      try {
        planner.setVideo({ sequence: { ...sequence, tracks: 'oops' as never }, assets: video.assets });
      } catch (error) {
        return error;
      }
    })();
    expect(failure).toBeInstanceOf(PlanFailure);
    expect((failure as PlanFailure).code).toBe('INVALID_VIDEO');
    expect(planner.planAt(0).layers).toHaveLength(1);
    expect(() => planner.planAt(Number.NaN)).toThrow(PlanFailure);
  });

  it('非法的帧率是错误，不是陷阱', async () => {
    const { planner, video } = await setup();
    const sequence = video.sequences[video.rootSequenceId]!;
    planner.setVideo({ sequence: { ...sequence, fps: { num: 0, den: 1 } }, assets: video.assets });
    expect(() => planner.planAt(1)).toThrow(expect.objectContaining({ code: 'INVALID_TIME_VALUE' }));
  });

  it('画帧与导出同一个内核：字体注入之后才画，媒体层画送进去的画面，整帧不透明', async () => {
    const { planner } = await setup();
    expect(() => planner.render(1.5, 320, 180)).toThrow(expect.objectContaining({ code: 'INVALID_PARAMS' }));
    const files = planner.fontFiles();
    expect(files[0]).toBe('NotoSansSC-Variable.ttf');
    planner.addFonts([new Uint8Array(readFileSync(`${fonts}${files[0]}`))]);

    // 横版视频层送一张纯红的画面。
    const red = new Uint8Array(64 * 36 * 4).map((_, index) => (index % 4 === 0 || index % 4 === 3 ? 255 : 0));
    planner.setPicture('item_land_a', red, 64, 36);
    const rendered = planner.render(1.5, 320, 180);
    expect(rendered.plan.frame).toBe(45);
    const pixels = planner.frame();
    expect(pixels.length).toBe(320 * 180 * 4);
    let opaque = true;
    let reds = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] !== 255) opaque = false;
      if (pixels[i]! > 200 && pixels[i + 1]! < 40 && pixels[i + 2]! < 40) reds++;
    }
    expect(opaque).toBe(true);
    expect(reds).toBeGreaterThan(320 * 180 * 0.1);

    // 画面的字节数不对是错误。
    expect(() => planner.setPicture('item_land_a', red, 10, 10)).toThrow(expect.objectContaining({ code: 'INVALID_PICTURE' }));
  });

  it('素材频谱在临时实例里算；声波缺哪份报哪份，送进去之后照着声音画', async () => {
    const { planner, video } = await setup();
    planner.addFonts([new Uint8Array(readFileSync(`${fonts}${planner.fontFiles()[0]}`))]);
    // 合成的声音：一秒 440 Hz。立体声取两声道的平均，与单声道送平均值相同；同一份样本两次算出同样的字节。
    const left = Float32Array.from({ length: 48_000 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / 48_000));
    const right = left.map((v) => v * 0.5);
    const mono = left.map((v, i) => (v + right[i]!) / 2);
    const spectrum = await planner.analyzeAudio([left, right]);
    expect(new TextDecoder().decode(spectrum.subarray(0, 4))).toBe('BCS1');
    expect(spectrum.length).toBe(40 + 60 * 640);
    expect(await planner.analyzeAudio([mono])).toEqual(spectrum);
    await expect(planner.analyzeAudio([new Float32Array(0)])).rejects.toMatchObject({ code: 'INVALID_AUDIO' });

    const sequence = video.sequences[video.rootSequenceId]!;
    const viz = {
      id: 'item_viz',
      trackId: 'trk_g1',
      enabled: true,
      locked: false,
      paintOrder: 9,
      followPolicy: { kind: 'sequence-fixed' },
      type: 'visualizer',
      span: { fromFrame: 0, durationFrames: 60 },
      place: { w: 60 },
      visualizer: { style: 'bars', mainColor: '#FFFFFF', audio: 'asset_music' },
    };
    planner.setVideo({ sequence: { ...sequence, items: [...sequence.items, viz] } as never, assets: video.assets });
    const missing = planner.render(1, 160, 90);
    expect(missing.spectra).toEqual([{ itemId: 'item_viz', asset: { id: 'asset_music', revision: 'rev_1' } }]);
    expect(missing.warnings.some((w) => w.detail.startsWith('item_viz：'))).toBe(true);
    const asset = { id: 'asset_music', revision: 'rev_1' };
    expect(planner.setAudioSpectrum(asset, spectrum)).toBe(true);
    expect(planner.setAudioSpectrum(asset, spectrum)).toBe(false);
    const heard = planner.render(1, 160, 90);
    expect(heard.spectra).toEqual([]);
    expect(heard.warnings.some((w) => w.detail.startsWith('item_viz：'))).toBe(false);
    planner.clearAudioSpectra();
    expect(planner.render(1, 160, 90).spectra).toHaveLength(1);
  });

  it('本机字体：报缺的族与点了名的 face；送进来之后不缺，已经分出去的实例与之后分的实例都有，界面不留字节', async () => {
    const { planner, video } = await setup();
    planner.addFonts(planner.fontFiles().map((name) => new Uint8Array(readFileSync(`${fonts}${name}`))));
    const sequence = video.sequences[video.rootSequenceId]!;
    const title = {
      id: 'item_title',
      trackId: 'trk_g1',
      enabled: true,
      locked: false,
      paintOrder: 9,
      followPolicy: { kind: 'sequence-fixed' },
      type: 'text',
      span: { fromFrame: 0, durationFrames: 60 },
      place: { x: 50, y: 50, w: 60 },
      text: 'A',
      style: { fontSize: 60, fontFamily: 'ColrProbe', fontWeight: 700 },
    };
    const withTitle = { sequence: { ...sequence, items: [...sequence.items, title] } as never, assets: video.assets };
    planner.setVideo(withTitle);
    const before = planner.render(1, 160, 90);
    expect(before.fonts).toEqual(['ColrProbe']);
    expect(before.faces).toContainEqual({ family: 'ColrProbe', weight: 700, italic: false });
    const early = await planner.fork();
    early.setVideo(withTitle);
    expect(early.render(1, 160, 90).fonts).toEqual(['ColrProbe']);

    let loads = 0;
    const font = { key: 'probe', load: async () => (loads++, new Uint8Array(readFileSync(probeFont))) };
    expect(planner.addLocalFont(font, new Uint8Array(readFileSync(probeFont)))).toBe(true);
    expect(planner.addLocalFont(font, new Uint8Array(readFileSync(probeFont)))).toBe(false);
    expect(planner.render(1, 160, 90).fonts).toEqual([]);
    // 先分出去的缩略图实例也收到了（不用重新要）。
    expect(early.render(1, 160, 90).fonts).toEqual([]);
    expect(loads).toBe(0);
    // 之后分的实例按 `load` 重新要一次。
    const late = await planner.fork();
    late.setVideo(withTitle);
    expect(late.render(1, 160, 90).fonts).toEqual([]);
    expect(loads).toBe(1);
  });

  it('文字框由内核量：与画字同一批字体，没注入字体时量不了', async () => {
    const { planner } = await setup();
    const style = { fontSize: 24, fontWeight: 'bold', lineHeight: 1.2, backgroundColor: '#000000CC', backgroundPadding: 14 };
    const canvas = { width: 1920, height: 1080 };
    // 没注入字体时量不了。
    expect(() => planner.measureText('输入文字', style, null, canvas)).toThrow(expect.objectContaining({ code: 'INVALID_PARAMS' }));
    planner.addFonts(planner.fontFiles().map((name) => new Uint8Array(readFileSync(`${fonts}${name}`))));
    const one = planner.measureText('输入文字', style, null, canvas);
    expect(one.width).toBeGreaterThan(100);
    const wrapped = planner.measureText('输入文字', style, 60, canvas);
    expect(wrapped.width).toBe(60);
    expect(wrapped.height).toBeGreaterThan(one.height * 1.5);
  });
});

/**
 * 一个手写的小模块，只有量文字与送字体用到的导出：输入超过 100 字节时 `bc_measure_text` 陷阱（`unreachable`），否则答一个固定的框。
 * 陷阱之后的重新载入不依赖编出来的预览 WASM。
 */
function trappingModule(): WebAssembly.Module {
  const answer = [...new TextEncoder().encode('{"width":12,"height":34}')];
  const uleb = (value: number): number[] => {
    const out: number[] = [];
    do {
      let byte = value & 0x7f;
      value >>>= 7;
      if (value) byte |= 0x80;
      out.push(byte);
    } while (value);
    return out;
  };
  const vec = (items: number[][]): number[] => [...uleb(items.length), ...items.flat()];
  const section = (id: number, body: number[]): number[] => [id, ...uleb(body.length), ...body];
  const name = (text: string): number[] => [...uleb(text.length), ...new TextEncoder().encode(text)];
  const [i32, fn] = [0x7f, 0x60];
  const body = (code: number[]): number[] => [...uleb(code.length + 1), 0, ...code];
  const exported = ['bc_alloc', 'bc_free', 'bc_output_ptr', 'bc_output_len', 'bc_measure_text', 'bc_add_font'];
  return new WebAssembly.Module(
    new Uint8Array([
      ...[0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00],
      // 类型：(i32)→i32、(i32 i32)→()、()→i32、(i32 i32)→i32
      ...section(
        1,
        vec([
          [fn, 1, i32, 1, i32],
          [fn, 2, i32, i32, 0],
          [fn, 0, 1, i32],
          [fn, 2, i32, i32, 1, i32],
        ]),
      ),
      ...section(3, vec([[0], [1], [2], [2], [3], [3]])),
      ...section(5, vec([[0x00, 1]])),
      ...section(7, vec([[...name('memory'), 0x02, 0], ...exported.map((text, index) => [...name(text), 0x00, index])])),
      ...section(
        10,
        vec([
          body([0x41, ...uleb(1024), 0x0b]), // bc_alloc：固定在 1024
          body([0x0b]), // bc_free
          body([0x41, 0, 0x0b]), // bc_output_ptr：答案在 0
          body([0x41, answer.length, 0x0b]), // bc_output_len
          // bc_measure_text：len > 100 时 unreachable，否则返回 0
          body([0x20, 1, 0x41, 0xe4, 0x00, 0x4a, 0x04, 0x40, 0x00, 0x0b, 0x41, 0, 0x0b]),
          body([0x41, 0, 0x0b]), // bc_add_font：收下
        ]),
      ),
      ...section(11, vec([[0, 0x41, 0, 0x0b, ...uleb(answer.length), ...answer]])),
    ]),
  );
}

describe('帧计划器的重新载入', () => {
  it('陷阱之后抛 PLANNER_CRASHED，`recovered()` 在重新载入好了之后兑现，`onRecovered` 照旧调用', async () => {
    const planner = await RenderPlanner.instantiate(trappingModule());
    const canvas = { width: 1920, height: 1080 };
    await planner.recovered();
    expect(planner.measureText('字', {}, null, canvas)).toEqual({ width: 12, height: 34 });

    const onRecovered = vi.fn();
    planner.onRecovered = onRecovered;
    const long = '字'.repeat(60);
    expect(() => planner.measureText(long, {}, null, canvas)).toThrow(expect.objectContaining({ code: 'PLANNER_CRASHED' }));
    // 重新载入期间的调用照样抛 PLANNER_CRASHED。
    expect(() => planner.measureText('字', {}, null, canvas)).toThrow(expect.objectContaining({ code: 'PLANNER_CRASHED' }));
    let ready = false;
    const waiting = planner.recovered().then(() => {
      ready = true;
      // 兑现在 `onRecovered` 之后才轮到等它的人。
      expect(onRecovered).toHaveBeenCalledTimes(1);
    });
    expect(ready).toBe(false);
    await waiting;
    expect(planner.measureText('字', {}, null, canvas)).toEqual({ width: 12, height: 34 });
  });

  it('本机字体不留字节：重新载入时按 `load` 重新要（要的期间送来的也要），都要回来之后才算好；要不到的跳过', async () => {
    const planner = await RenderPlanner.instantiate(trappingModule());
    const canvas = { width: 1920, height: 1080 };
    const loads: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const font = (key: string, fail = false) => ({
      key,
      load: async () => {
        loads.push(key);
        await gate;
        if (fail) throw new Error('取不到');
        return new Uint8Array([1, 2, 3]);
      },
    });
    planner.addLocalFont(font('a'), new Uint8Array([1]));
    planner.addLocalFont(font('gone', true), new Uint8Array([1]));
    const onRecovered = vi.fn();
    planner.onRecovered = onRecovered;
    expect(() => planner.measureText('字'.repeat(60), {}, null, canvas)).toThrow(expect.objectContaining({ code: 'PLANNER_CRASHED' }));
    const recovered = planner.recovered();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(loads).toEqual(['a', 'gone']);
    // 重新载入期间送来的只记下，一并要回来。
    expect(planner.addLocalFont(font('b'), new Uint8Array([1]))).toBe(true);
    expect(onRecovered).not.toHaveBeenCalled();
    release();
    await recovered;
    expect(loads).toEqual(['a', 'gone', 'b']);
    expect(onRecovered).toHaveBeenCalledTimes(1);
    expect(planner.measureText('字', {}, null, canvas)).toEqual({ width: 12, height: 34 });
  });

  it('重新载入失败：在等的与之后才来等的 `recovered()` 都拒绝，不会一直等下去', async () => {
    const planner = await RenderPlanner.instantiate(trappingModule());
    const canvas = { width: 1920, height: 1080 };
    const instantiate = vi.spyOn(WebAssembly, 'instantiate').mockRejectedValueOnce(new Error('重新实例化失败'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() => planner.measureText('字'.repeat(60), {}, null, canvas)).toThrow(expect.objectContaining({ code: 'PLANNER_CRASHED' }));
      await expect(planner.recovered()).rejects.toThrow('重新实例化失败');
      await expect(planner.recovered()).rejects.toThrow('重新实例化失败');
      expect(() => planner.measureText('字', {}, null, canvas)).toThrow(expect.objectContaining({ code: 'PLANNER_CRASHED' }));
      expect(warn).toHaveBeenCalled();
    } finally {
      instantiate.mockRestore();
      warn.mockRestore();
    }
  });
});
