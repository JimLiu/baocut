/**
 * 把一组像素的颜色分布搬到参考画面上（`assets_process` 的 `match-color`，架构设计 §7.9）。全部是公开论文里的算法，按论文的公式写，
 * 不含任何第三方实现的代码（hahnec/color-matcher 是 GPL-3.0，这里没有引用它）：
 *
 * - `histogram`：每个通道按累积分布对齐（经典的直方图规定化）。
 * - `reinhard`：线性 RGB → LMS → log → lαβ，逐通道对齐均值与标准差（Reinhard et al., "Color Transfer between Images", 2001）。
 * - `mkl`：把三个通道当作高斯分布，用 Monge-Kantorovich 线性解对齐均值与协方差（Pitié & Kokaram, "The linear
 *   Monge-Kantorovitch linear colour mapping for example-based colour transfer", 2007）。
 * - `hm-mkl-hm`：先直方图、再 MKL、再直方图，保住两端的形状又不偏色。
 *
 * 像素是 0–1 的 RGB，排成 `[r, g, b, r, g, b, …]`。每种方法都是逐像素的函数，所以能烘成 3D LUT（`.cube`），由 ffmpeg 的 `lut3d`
 * 作用到整段视频：不同帧的颜色关系不变，也不会在帧之间闪烁。
 */

export type ColorMethod = 'histogram' | 'reinhard' | 'mkl' | 'hm-mkl-hm';

/** 逐像素的颜色映射：写进 `out` 的 `[r, g, b]`。 */
export type ColorMap = (r: number, g: number, b: number, out: Float64Array) => void;

const BINS = 1024;
/** 特征值的下限：只防浮点误差出的负数与 0。真正防单色画面的是下面的 `COVARIANCE_RIDGE`，这里比它的平方还小。 */
const EIGEN_FLOOR = 1e-12;
/** 加到协方差对角线上的方差（约 2.5 个灰阶的标准差）：两边都接近单色时映射退回平移，不把压缩噪声当成分布。 */
const COVARIANCE_RIDGE = 1e-4;
/**
 * 增益的上限：接近单色的画面（白墙、过曝的天空）对到丰富的参考时，公式要的放大倍数可以到几十倍，几个灰阶的差别会被拉成色块。
 * 夹在这个倍数之内宁可对不准，也不出色块。
 */
const MAX_GAIN = 4;

/** `.cube` 的格点数：33 是调色软件的常用精度，文件约 1 MB。 */
export const LUT_SIZE = 33;

/** 一个方法把 `source` 的分布搬到 `reference` 的映射。 */
export function colorTransfer(method: ColorMethod, source: Float64Array, reference: Float64Array): ColorMap {
  switch (method) {
    case 'histogram':
      return histogramMap(source, reference);
    case 'reinhard':
      return reinhardMap(source, reference);
    case 'mkl':
      return mklMap(source, reference);
    case 'hm-mkl-hm': {
      const first = histogramMap(source, reference);
      const afterFirst = mapped(source, first);
      const second = mklMap(afterFirst, reference);
      const afterSecond = mapped(afterFirst, second);
      const third = histogramMap(afterSecond, reference);
      return compose(first, second, third);
    }
  }
}

/** 按映射处理一组像素，结果夹到 0–1。 */
export function mapped(pixels: Float64Array, map: ColorMap): Float64Array {
  const out = new Float64Array(pixels.length);
  const rgb = new Float64Array(3);
  for (let i = 0; i + 2 < pixels.length; i += 3) {
    map(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!, rgb);
    out[i] = clamp01(rgb[0]!);
    out[i + 1] = clamp01(rgb[1]!);
    out[i + 2] = clamp01(rgb[2]!);
  }
  return out;
}

function compose(...maps: ColorMap[]): ColorMap {
  return (r, g, b, out) => {
    let [x, y, z] = [r, g, b];
    for (const map of maps) {
      map(x, y, z, out);
      [x, y, z] = [clamp01(out[0]!), clamp01(out[1]!), clamp01(out[2]!)];
    }
    out[0] = x;
    out[1] = y;
    out[2] = z;
  };
}

/** 全部通道一条曲线的直方图规定化。 */
function histogramMap(source: Float64Array, reference: Float64Array): ColorMap {
  const curves = [0, 1, 2].map((channel) => matchCurve(cdf(source, channel), cdf(reference, channel)));
  return (r, g, b, out) => {
    out[0] = sampleCurve(curves[0]!, r);
    out[1] = sampleCurve(curves[1]!, g);
    out[2] = sampleCurve(curves[2]!, b);
  };
}

function cdf(pixels: Float64Array, channel: number): Float64Array {
  const counts = new Float64Array(BINS);
  let total = 0;
  for (let i = channel; i < pixels.length; i += 3) {
    counts[Math.min(BINS - 1, Math.floor(clamp01(pixels[i]!) * BINS))]! += 1;
    total += 1;
  }
  let running = 0;
  const out = new Float64Array(BINS);
  for (let i = 0; i < BINS; i++) {
    running += counts[i]!;
    out[i] = total === 0 ? (i + 1) / BINS : running / total;
  }
  return out;
}

/** 源的每个分箱对到参考里累积比例相同的位置（取两箱之间的线性插值）。 */
function matchCurve(source: Float64Array, reference: Float64Array): Float64Array {
  const curve = new Float64Array(BINS);
  let at = 0;
  for (let i = 0; i < BINS; i++) {
    const want = source[i]!;
    while (at < BINS - 1 && reference[at]! < want) at += 1;
    const lower = at === 0 ? 0 : reference[at - 1]!;
    const span = reference[at]! - lower;
    const fraction = span > 0 ? (want - lower) / span : 1;
    curve[i] = (at + Math.min(1, Math.max(0, fraction))) / BINS;
  }
  return curve;
}

function sampleCurve(curve: Float64Array, value: number): number {
  const position = clamp01(value) * BINS - 0.5;
  if (position <= 0) return curve[0]!;
  if (position >= BINS - 1) return curve[BINS - 1]!;
  const low = Math.floor(position);
  const fraction = position - low;
  return curve[low]! * (1 - fraction) + curve[low + 1]! * fraction;
}

// ---- Reinhard：lαβ 空间的均值与标准差 ----

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  const v = Math.max(0, value);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** log10 的下限：纯黑的 LMS 是 0，取对数会到负无穷。 */
const LMS_FLOOR = 1e-4;
const SQRT3 = Math.sqrt(3);
const SQRT6 = Math.sqrt(6);
const SQRT2 = Math.SQRT2;

function rgbToLab(r: number, g: number, b: number, out: Float64Array): void {
  const [lr, lg, lb] = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  const l = Math.log10(Math.max(LMS_FLOOR, 0.3811 * lr + 0.5783 * lg + 0.0402 * lb));
  const m = Math.log10(Math.max(LMS_FLOOR, 0.1967 * lr + 0.7244 * lg + 0.0782 * lb));
  const s = Math.log10(Math.max(LMS_FLOOR, 0.0241 * lr + 0.1288 * lg + 0.8444 * lb));
  out[0] = (l + m + s) / SQRT3;
  out[1] = (l + m - 2 * s) / SQRT6;
  out[2] = (l - m) / SQRT2;
}

function labToRgb(lightness: number, alpha: number, beta: number, out: Float64Array): void {
  const a = lightness / SQRT3;
  const b = alpha / SQRT6;
  const c = beta / SQRT2;
  const l = 10 ** (a + b + c);
  const m = 10 ** (a + b - c);
  const s = 10 ** (a - 2 * b);
  out[0] = linearToSrgb(4.4679 * l - 3.5873 * m + 0.1193 * s);
  out[1] = linearToSrgb(-1.2186 * l + 2.3809 * m - 0.1624 * s);
  out[2] = linearToSrgb(0.0497 * l - 0.2439 * m + 1.2045 * s);
}

function labStats(pixels: Float64Array): { mean: number[]; deviation: number[] } {
  const lab = new Float64Array(3);
  const sum = [0, 0, 0];
  const square = [0, 0, 0];
  const count = Math.floor(pixels.length / 3);
  for (let i = 0; i < count * 3; i += 3) {
    rgbToLab(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!, lab);
    for (let c = 0; c < 3; c++) {
      sum[c]! += lab[c]!;
      square[c]! += lab[c]! * lab[c]!;
    }
  }
  const divisor = Math.max(1, count);
  const mean = sum.map((value) => value / divisor);
  const deviation = square.map((value, c) => Math.sqrt(Math.max(0, value / divisor - mean[c]! * mean[c]!)));
  return { mean, deviation };
}

function reinhardMap(source: Float64Array, reference: Float64Array): ColorMap {
  const from = labStats(source);
  const to = labStats(reference);
  const gain = from.deviation.map((deviation, c) => (deviation > 1e-6 ? Math.min(MAX_GAIN, Math.max(1 / MAX_GAIN, to.deviation[c]! / deviation)) : 1));
  const lab = new Float64Array(3);
  return (r, g, b, out) => {
    rgbToLab(r, g, b, lab);
    labToRgb(
      (lab[0]! - from.mean[0]!) * gain[0]! + to.mean[0]!,
      (lab[1]! - from.mean[1]!) * gain[1]! + to.mean[1]!,
      (lab[2]! - from.mean[2]!) * gain[2]! + to.mean[2]!,
      out,
    );
  };
}

// ---- Monge-Kantorovich 线性解 ----

type Matrix3 = [number, number, number, number, number, number, number, number, number];

function multiply(a: Matrix3, b: Matrix3): Matrix3 {
  const out = new Array<number>(9).fill(0) as Matrix3;
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      for (let k = 0; k < 3; k++) out[row * 3 + column]! += a[row * 3 + k]! * b[k * 3 + column]!;
    }
  }
  return out;
}

/** 对称矩阵的特征分解（循环 Jacobi）：`vectors` 按列放特征向量。 */
export function symmetricEigen(matrix: Matrix3): { values: [number, number, number]; vectors: Matrix3 } {
  const a = [...matrix] as Matrix3;
  const v: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 32; sweep++) {
    const off = Math.abs(a[1]) + Math.abs(a[2]) + Math.abs(a[5]);
    if (off < 1e-14) break;
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ] as const) {
      const pq = a[p * 3 + q]!;
      if (Math.abs(pq) < 1e-18) continue;
      const theta = (a[q * 3 + q]! - a[p * 3 + p]!) / (2 * pq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k * 3 + p]!;
        const akq = a[k * 3 + q]!;
        a[k * 3 + p] = c * akp - s * akq;
        a[k * 3 + q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p * 3 + k]!;
        const aqk = a[q * 3 + k]!;
        a[p * 3 + k] = c * apk - s * aqk;
        a[q * 3 + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k * 3 + p]!;
        const vkq = v[k * 3 + q]!;
        v[k * 3 + p] = c * vkp - s * vkq;
        v[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  }
  return { values: [a[0], a[4], a[8]], vectors: v };
}

/** 对称半正定矩阵的幂：特征值夹到 `EIGEN_FLOOR` 再取幂。 */
function symmetricPower(matrix: Matrix3, power: number): Matrix3 {
  const { values, vectors } = symmetricEigen(matrix);
  const d = values.map((value) => Math.max(value, EIGEN_FLOOR) ** power);
  const scaled = [...vectors] as Matrix3;
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) scaled[row * 3 + column]! *= d[column]!;
  }
  const transpose: Matrix3 = [vectors[0], vectors[3], vectors[6], vectors[1], vectors[4], vectors[7], vectors[2], vectors[5], vectors[8]];
  return multiply(scaled, transpose);
}

export function meanAndCovariance(pixels: Float64Array): { mean: [number, number, number]; covariance: Matrix3 } {
  const count = Math.floor(pixels.length / 3);
  const mean: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < count * 3; i += 3) {
    mean[0] += pixels[i]!;
    mean[1] += pixels[i + 1]!;
    mean[2] += pixels[i + 2]!;
  }
  const divisor = Math.max(1, count);
  mean[0] /= divisor;
  mean[1] /= divisor;
  mean[2] /= divisor;
  const covariance = new Array<number>(9).fill(0) as Matrix3;
  for (let i = 0; i < count * 3; i += 3) {
    const d = [pixels[i]! - mean[0], pixels[i + 1]! - mean[1], pixels[i + 2]! - mean[2]];
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 3; column++) covariance[row * 3 + column]! += d[row]! * d[column]!;
    }
  }
  return { mean, covariance: covariance.map((value) => value / divisor) as Matrix3 };
}

/** `T = Σs^(-1/2) · (Σs^(1/2) · Σt · Σs^(1/2))^(1/2) · Σs^(-1/2)`，`f(x) = T(x − μs) + μt`。 */
export function mklMatrix(source: Matrix3, reference: Matrix3): Matrix3 {
  const from = withRidge(source);
  const half = symmetricPower(from, 0.5);
  const inverseHalf = symmetricPower(from, -0.5);
  const middle = symmetricPower(multiply(multiply(half, withRidge(reference)), half), 0.5);
  return clampGain(multiply(multiply(inverseHalf, middle), inverseHalf));
}

function withRidge(matrix: Matrix3): Matrix3 {
  const out = [...matrix] as Matrix3;
  out[0] += COVARIANCE_RIDGE;
  out[4] += COVARIANCE_RIDGE;
  out[8] += COVARIANCE_RIDGE;
  return out;
}

/** 把对称矩阵的特征值夹进 `[1 / MAX_GAIN, MAX_GAIN]`。 */
function clampGain(matrix: Matrix3): Matrix3 {
  // 浮点误差让结果不完全对称：取对称部分再分解。
  const symmetric = matrix.map((value, i) => (value + matrix[(i % 3) * 3 + Math.floor(i / 3)]!) / 2) as Matrix3;
  const { values, vectors } = symmetricEigen(symmetric);
  const d = values.map((value) => Math.min(MAX_GAIN, Math.max(1 / MAX_GAIN, value)));
  const scaled = [...vectors] as Matrix3;
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) scaled[row * 3 + column]! *= d[column]!;
  }
  const transpose: Matrix3 = [vectors[0], vectors[3], vectors[6], vectors[1], vectors[4], vectors[7], vectors[2], vectors[5], vectors[8]];
  return multiply(scaled, transpose);
}

function mklMap(source: Float64Array, reference: Float64Array): ColorMap {
  const from = meanAndCovariance(source);
  const to = meanAndCovariance(reference);
  const t = mklMatrix(from.covariance, to.covariance);
  return (r, g, b, out) => {
    const dr = r - from.mean[0];
    const dg = g - from.mean[1];
    const db = b - from.mean[2];
    out[0] = t[0] * dr + t[1] * dg + t[2] * db + to.mean[0];
    out[1] = t[3] * dr + t[4] * dg + t[5] * db + to.mean[1];
    out[2] = t[6] * dr + t[7] * dg + t[8] * db + to.mean[2];
  };
}

// ---- LUT ----

/**
 * 把映射烘成 `.cube`（Adobe/IRIDAS 3D LUT，红色变化最快）。`amount` 是和原色的混合比例（1 全用映射，0 不变）。
 */
export function formatCube(map: ColorMap, amount: number, size = LUT_SIZE): string {
  const lines = [`LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0'];
  const rgb = new Float64Array(3);
  const last = size - 1;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const [x, y, z] = [r / last, g / last, b / last];
        map(x, y, z, rgb);
        lines.push(
          `${channel(x, rgb[0]!, amount)} ${channel(y, rgb[1]!, amount)} ${channel(z, rgb[2]!, amount)}`,
        );
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

function channel(original: number, target: number, amount: number): string {
  return clamp01(original * (1 - amount) + clamp01(target) * amount).toFixed(6);
}

/** `rgb24` 的字节换成 0–1 的像素。 */
export function pixelsFromRgb24(bytes: Uint8Array): Float64Array {
  const count = bytes.length - (bytes.length % 3);
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) out[i] = bytes[i]! / 255;
  return out;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
