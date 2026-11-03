import { describe, expect, it } from 'vitest';
import { colorTransfer, formatCube, LUT_SIZE, mapped, meanAndCovariance, mklMatrix, pixelsFromRgb24, symmetricEigen, type ColorMethod } from './color-transfer.ts';

/**
 * 颜色对齐（`match-color`）：只有确定性的数学，不碰文件。伪随机的像素（固定种子）对齐到偏暖、偏亮的参考之后，均值与方差应当
 * 接近参考；同分布时映射接近恒等；`.cube` 的头与格点次序。
 */

function pixels(count: number, seed: number, shape: (u: number, v: number, w: number) => [number, number, number]): Float64Array {
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const out = new Float64Array(count * 3);
  for (let i = 0; i < count; i++) {
    const [r, g, b] = shape(next(), next(), next());
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }
  return out;
}

const source = pixels(20000, 1, (u, v, w) => [0.2 + 0.3 * u, 0.25 + 0.3 * v, 0.3 + 0.3 * w]);
const reference = pixels(20000, 2, (u, v, w) => [0.5 + 0.2 * u, 0.4 + 0.15 * v, 0.2 + 0.1 * w]);

const stats = (data: Float64Array) => {
  const { mean, covariance } = meanAndCovariance(data);
  return { mean, deviation: [covariance[0], covariance[4], covariance[8]].map(Math.sqrt) };
};

describe('颜色对齐', () => {
  it.each<ColorMethod>(['histogram', 'mkl', 'hm-mkl-hm', 'reinhard'])('%s 把均值搬到参考附近', (method) => {
    const result = stats(mapped(source, colorTransfer(method, source, reference)));
    const target = stats(reference);
    // 伽马空间里的 Reinhard 只保证 lαβ 里的统计量，RGB 的均值留宽一些。
    const tolerance = method === 'reinhard' ? 0.03 : 0.012;
    for (const c of [0, 1, 2]) expect(Math.abs(result.mean[c]! - target.mean[c]!)).toBeLessThan(tolerance);
  });

  it('mkl 同时对齐协方差', () => {
    const result = stats(mapped(source, colorTransfer('mkl', source, reference)));
    const target = stats(reference);
    for (const c of [0, 1, 2]) expect(Math.abs(result.deviation[c]! - target.deviation[c]!)).toBeLessThan(0.006);
  });

  it.each<ColorMethod>(['histogram', 'mkl', 'hm-mkl-hm', 'reinhard'])('%s 对同一份分布接近恒等', (method) => {
    const out = new Float64Array(3);
    colorTransfer(method, source, source)(0.3, 0.4, 0.5, out);
    for (const [c, want] of [0.3, 0.4, 0.5].entries()) expect(Math.abs(out[c]! - want)).toBeLessThan(0.02);
  });

  it('单色的素材不炸：特征值有下限，结果仍在 0–1', () => {
    const flat = pixels(1000, 3, () => [0.5, 0.5, 0.5]);
    const result = mapped(flat, colorTransfer('hm-mkl-hm', flat, reference));
    for (const value of result) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('接近单色的素材对到丰富的参考：增益有上限，不把几个灰阶拉成色块', () => {
    const wall = pixels(5000, 4, (u, v, w) => [0.8 + 0.004 * u, 0.8 + 0.004 * v, 0.8 + 0.004 * w]);
    const busy = pixels(5000, 5, (u, v, w) => [u, v, w]);
    const out = new Float64Array(3);
    const map = colorTransfer('mkl', wall, busy);
    const low = new Float64Array(3);
    map(0.8, 0.8, 0.8, low);
    map(0.804, 0.804, 0.804, out);
    for (const c of [0, 1, 2]) expect(out[c]! - low[c]!).toBeLessThanOrEqual(0.004 * 4 + 1e-9);
  });

  it('两边都是单色时只是平移', () => {
    const red = pixels(1000, 6, () => [0.75, 0.19, 0.13]);
    const blue = pixels(1000, 7, () => [0.13, 0.25, 0.75]);
    const out = new Float64Array(3);
    colorTransfer('mkl', red, blue)(0.75, 0.19, 0.13, out);
    expect(out[0]).toBeCloseTo(0.13, 6);
    expect(out[2]).toBeCloseTo(0.75, 6);
    colorTransfer('mkl', red, blue)(0.76, 0.19, 0.13, out);
    expect(out[0]).toBeCloseTo(0.14, 6);
  });

  it('对称矩阵的特征分解能还原矩阵', () => {
    const matrix = [4, 1, 2, 1, 3, 0.5, 2, 0.5, 5] as Parameters<typeof symmetricEigen>[0];
    const { values, vectors } = symmetricEigen(matrix);
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 3; column++) {
        let sum = 0;
        for (let k = 0; k < 3; k++) sum += vectors[row * 3 + k]! * values[k]! * vectors[column * 3 + k]!;
        expect(sum).toBeCloseTo(matrix[row * 3 + column]!, 9);
      }
    }
  });

  it('两个相同的协方差给出单位矩阵', () => {
    const covariance = [0.04, 0.01, 0, 0.01, 0.03, 0.005, 0, 0.005, 0.02] as Parameters<typeof mklMatrix>[0];
    const t = mklMatrix(covariance, covariance);
    for (const [i, want] of [1, 0, 0, 0, 1, 0, 0, 0, 1].entries()) expect(t[i]!).toBeCloseTo(want, 6);
  });

  it('.cube：头、行数与红色变化最快的次序；amount 0 是恒等', () => {
    const lines = formatCube(colorTransfer('mkl', source, reference), 0, 3).trim().split('\n');
    expect(lines.slice(0, 3)).toEqual(['LUT_3D_SIZE 3', 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0']);
    expect(lines).toHaveLength(3 + 27);
    expect(lines[3]).toBe('0.000000 0.000000 0.000000');
    expect(lines[4]).toBe('0.500000 0.000000 0.000000');
    expect(lines[6]).toBe('0.000000 0.500000 0.000000');
    expect(lines.at(-1)).toBe('1.000000 1.000000 1.000000');
    expect(LUT_SIZE).toBe(33);
  });

  it('rgb24 的字节换成 0–1，丢掉不成三个的尾巴', () => {
    expect([...pixelsFromRgb24(Uint8Array.from([0, 255, 51, 9]))]).toEqual([0, 1, 0.2]);
  });
});
