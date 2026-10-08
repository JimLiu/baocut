import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ELEMENT_TILES } from '../../model/element-catalog.ts';
import { TEXT_PRESETS } from '../../model/text-presets.ts';
import { RenderPlanner } from '../../render/render-planner.ts';
import { opaqueBounds, thumbSequence } from '../../render/thumbnails.ts';
import { captionThumb, confettiThumb, layerThumb, lottieMeta, lottieThumb, presetThumb, type ThumbPicture } from './thumb-scenes.ts';

// 缩略图由编出来的预览 WASM 画（与导出同一个内核）；Node 没有 ImageData，补一个装下像素的。
vi.stubGlobal('ImageData', function (data: Uint8ClampedArray, width: number, height: number) {
  return { data, width, height };
});

const wasm = fileURLToPath(new URL('../../render/generated/preview.wasm', import.meta.url));
const fonts = fileURLToPath(new URL('../../../../../crates/render-raster/assets/fonts/', import.meta.url));
const lottie = fileURLToPath(new URL('../../../../../crates/render-raster/tests/fixtures/lottie/cases/shapes.json', import.meta.url));
const built = existsSync(wasm);
if (!built) console.warn('没有找到预览 WASM，跳过缩略图测试：先运行 npm run build:wasm');

const canvas = { width: 1920, height: 1080 };
let planner: RenderPlanner;

/** 贴上去的第一块画面里不透明的像素数。 */
function opaque(picture: ThumbPicture, index = 0): number {
  const { data } = picture.blits[index]!.image;
  let count = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) count++;
  return count;
}

describe('缩略图的场景', () => {
  it('摆成的序列：每层一条轨道、从 0 开始、上下次序按数组，去掉延迟与动画', () => {
    const sequence = thumbSequence({
      canvas: { width: 160.4, height: 90 },
      layers: [
        { type: 'shape', delayFrames: 9, animate: { enter: {} } },
        { type: 'caption', documentId: 'd' },
      ],
      seconds: 1,
      duration: 2,
    });
    expect(sequence.canvas).toMatchObject({ width: 160, height: 90 });
    expect(sequence.tracks.map((track) => track.kind)).toEqual(['visual', 'subtitle']);
    expect(sequence.items.map((item) => [item.trackId, item.paintOrder, (item as { span?: unknown }).span])).toEqual([
      ['thumb_track_0', 0, { fromFrame: 0, durationFrames: 60 }],
      ['thumb_track_1', 1, { fromFrame: 0, durationFrames: 60 }],
    ]);
    expect(sequence.items[0]).not.toHaveProperty('delayFrames');
    expect(sequence.items[0]).not.toHaveProperty('animate');
  });

  it('Lottie 文件头：时长与尺寸，读不懂时为 null', () => {
    expect(lottieMeta(new TextEncoder().encode('{"ip":0,"op":60,"fr":30,"w":200,"h":100}'))).toEqual({
      seconds: 2,
      width: 200,
      height: 100,
    });
    expect(lottieMeta(new TextEncoder().encode('{"ip":0}'))).toBeNull();
    expect(lottieMeta(new TextEncoder().encode('not json'))).toBeNull();
  });
});

describe.skipIf(!built)('缩略图由渲染内核画', () => {
  beforeAll(async () => {
    planner = await RenderPlanner.instantiate(readFileSync(wasm));
    planner.addFonts(planner.fontFiles().map((file) => new Uint8Array(readFileSync(`${fonts}${file}`))));
  });

  it('元素格：每一格都画出东西，框缩到格子里居中', () => {
    for (const tile of ELEMENT_TILES) {
      if (tile.confetti) continue;
      const picture = layerThumb(planner, tile.layer(canvas), canvas, 200, 120);
      expect(opaque(picture), tile.key).toBeGreaterThan(0);
      const { image, target } = picture.blits[0]!;
      const bounds = opaqueBounds(image)!;
      // 画出来的东西贴到格子里后大致居中、不超出格子太多（描边与阴影可以越出框一点）。
      const sx = target.width / image.width;
      const sy = target.height / image.height;
      const cx = target.x + (bounds.x + bounds.width / 2) * sx;
      const cy = target.y + (bounds.y + bounds.height / 2) * sy;
      expect(Math.abs(cx - 100), tile.key).toBeLessThan(20);
      expect(Math.abs(cy - 60), tile.key).toBeLessThan(20);
      expect(bounds.width * sx, tile.key).toBeLessThan(200 * 1.05);
    }
  });

  it('声波格用假频谱画：各款都不报没有频谱，画出来的款与款不同', () => {
    const waves = ELEMENT_TILES.filter((t) => t.group === 'wave').map((tile) => layerThumb(planner, tile.layer(canvas), canvas, 200, 120));
    expect(waves.length).toBeGreaterThan(3);
    for (const picture of waves) expect(picture.problems).toEqual([]);
    expect(new Set(waves.map((picture) => opaque(picture))).size).toBeGreaterThan(waves.length / 2);
  });

  it('彩纸格：同一刻恒得同一幅，往后播画面会变', () => {
    const a = confettiThumb(planner, 'rainbow-paper', 4.5, 160, 160);
    const b = confettiThumb(planner, 'rainbow-paper', 4.5, 160, 160);
    const c = confettiThumb(planner, 'rainbow-paper', 6, 160, 160);
    expect(opaque(a)).toBeGreaterThan(20);
    expect(b.blits[0]!.image.data).toEqual(a.blits[0]!.image.data);
    expect(c.blits[0]!.image.data).not.toEqual(a.blits[0]!.image.data);
  });

  it('字幕样式卡：双语两行上下排，太长时整体缩进格子，不折行', () => {
    const one = captionThumb(planner, {}, ['original'], 26, 320, 132);
    const two = captionThumb(planner, {}, ['original', 'translation'], 26, 320, 132);
    const single = opaqueBounds(one.blits[0]!.image)!;
    const double = opaqueBounds(two.blits[0]!.image)!;
    expect(one.problems).toEqual([]);
    expect(double.height).toBeGreaterThan(single.height * 1.5);
    // 字号推得很大：缩到格子的 92% 以内，还是一行。
    const huge = opaqueBounds(captionThumb(planner, {}, ['original'], 120, 320, 132).blits[0]!.image)!;
    expect(huge.width).toBeLessThanOrEqual(Math.ceil(320 * 0.92) + 2);
    expect(huge.width).toBeGreaterThan(320 * 0.8);
    expect(huge.height).toBeLessThan(single.height * 2.5);
  });

  it('品牌库的 Lottie 贴纸：停在正中那一帧，播起来画面会变', () => {
    const bytes = new Uint8Array(readFileSync(lottie));
    const still = lottieThumb(planner, 'file://shapes.json', bytes, 0, 120, 120);
    expect(still.problems).toEqual([]);
    expect(opaque(still)).toBeGreaterThan(50);
    const later = lottieThumb(planner, 'file://shapes.json', bytes, 0.4, 120, 120);
    expect(later.blits[0]!.image.data).not.toEqual(still.blits[0]!.image.data);
  });

  it('文字预设卡：字样卡一行一块，场景卡整帧裁到包围盒', () => {
    const stack = TEXT_PRESETS.find((preset) => preset.layout === 'stack')!;
    const rows = stack.layers.filter((layer) => layer.kind === 'text').length;
    const picture = presetThumb(planner, stack, { num: 30, den: 1 }, 2, 360, 200);
    expect(picture.blits).toHaveLength(rows);
    for (const blit of picture.blits) expect(blit.target.width).toBeLessThanOrEqual(360);
    const scene = TEXT_PRESETS.find((preset) => preset.layout !== 'stack')!;
    const framed = presetThumb(planner, scene, { num: 30, den: 1 }, 2, 360, 200);
    expect(framed.blits).toHaveLength(1);
    expect(opaque(framed)).toBeGreaterThan(0);
  });
});
