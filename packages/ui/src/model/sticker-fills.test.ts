import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { lottieFillColors, normHex, svgFillColors } from './sticker-fills.ts';

const stickers = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../stickers');
const provenance = (file: string): Record<string, { colors?: string[] }> => JSON.parse(fs.readFileSync(path.join(stickers, file), 'utf8'));

describe('素材贴纸的色卡', () => {
  it('随包的 301 张 SVG 与生成器记下的颜色一致（生成器按字母序记，色卡按出现次序）', () => {
    const entries = Object.entries(provenance('provenance.json'));
    expect(entries).toHaveLength(301);
    for (const [file, entry] of entries) {
      const svg = fs.readFileSync(path.join(stickers, file), 'utf8');
      expect([...svgFillColors(svg)].sort(), file).toEqual([...new Set((entry.colors ?? []).map(normHex))].sort());
    }
  });

  it('随包的 81 份 Lottie 与生成器记下的颜色一致', () => {
    const entries = Object.entries(provenance('anim/provenance.json'));
    expect(entries).toHaveLength(81);
    for (const [file, entry] of entries) {
      const json = fs.readFileSync(path.join(stickers, 'anim', file), 'utf8');
      expect(lottieFillColors(json), file).toEqual((entry.colors ?? []).slice(0, 8));
    }
  });

  it('SVG：同色归一组、按出现次序；`<image>` 与超过 15 种色都不给卡；style 只认 fill', () => {
    const svg = '<svg><circle fill="#FC0"/><path style="stroke:#111;fill:#fff"/><path fill="#FFFFFF"/><rect fill="url(#g)"/></svg>';
    expect(svgFillColors(svg)).toEqual(['#FFCC00', '#FFFFFF']);
    expect(svgFillColors('<svg><path fill="#f00"/><image href="x.png"/></svg>')).toEqual([]);
    const many = Array.from({ length: 16 }, (_, i) => `<path fill="#${i.toString(16).padStart(6, '0')}"/>`).join('');
    expect(svgFillColors(`<svg>${many}</svg>`)).toEqual([]);
  });

  it('Lottie：静态色按次数降序，带关键帧的跳过，0–255 写法也认', () => {
    const doc = {
      layers: [
        { ty: 1, sc: '#00ff00' },
        {
          ty: 4,
          shapes: [
            { ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] } },
            { ty: 'gr', it: [{ ty: 'st', c: { a: 0, k: [255, 0, 0] } }] },
            { ty: 'fl', c: { a: 1, k: [{ s: [0, 0, 1] }] } },
          ],
        },
      ],
    };
    expect(lottieFillColors(JSON.stringify(doc))).toEqual(['#FF0000', '#00FF00']);
    expect(lottieFillColors('not json')).toEqual([]);
  });
});
