// i18n-ignore-file: Historical import report vocabulary is retained for compatibility with archived reports.
// 旧格式的时间是十进制秒（JSON 浮点数）。导入时先按十进制文本精确换成微秒，再落到新格式的两种时间上：
// 画面区间吸附到帧网格，声音与源时间保持微秒精度（视频格式规范 §2）。
// `insertItems` 按写入的帧与精确时间原样保存、不再量化，所以实例的量化在这里做，规则与引擎一致：最近的帧，同距取早。

export type Rate = { num: number; den: number };

export type MediaTime = { ticks: string; timescale: number };

const MICROS = 1_000_000n;

/** 十进制秒 → 微秒。按数值的最短十进制写法取整（半数进位），不经过浮点乘法。 */
export function micros(seconds: number): bigint {
  if (!Number.isFinite(seconds)) throw new Error(`不是有限的时间：${seconds}`);
  const text = String(seconds);
  if (/e/i.test(text)) return BigInt(Math.round(seconds * 1e6));
  const negative = text.startsWith('-');
  const [whole = '0', fraction = ''] = text.replace('-', '').split('.');
  const digits = (fraction + '0000000').slice(0, 7);
  let value = BigInt(whole) * MICROS + BigInt(digits.slice(0, 6));
  if (digits[6]! >= '5') value += 1n;
  return negative ? -value : value;
}

export function mediaTime(us: bigint): MediaTime {
  return reduce(us, MICROS);
}

export function seconds(us: bigint): number {
  return Number(us) / 1e6;
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

/** `num / den` 秒的规范 MediaTime（约分之后）。 */
export function reduce(num: bigint, den: bigint): MediaTime {
  if (den <= 0n) throw new Error('timescale 必须为正');
  const g = gcd(num, den) || 1n;
  const timescale = den / g;
  if (timescale > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('timescale 超出安全整数');
  return { ticks: String(num / g), timescale: Number(timescale) };
}

function divRound(num: bigint, den: bigint, mode: 'nearest' | 'floor' | 'ceil'): bigint {
  const q = num / den;
  const r = num % den;
  if (r === 0n) return q;
  const below = num < 0n ? q - 1n : q;
  if (mode === 'floor') return below;
  if (mode === 'ceil') return below + 1n;
  // 同距取早（视频格式规范 §2.6）。
  const rest = num - below * den;
  return rest * 2n > den ? below + 1n : below;
}

/** 微秒时刻落在第几帧。 */
export function frameAt(us: bigint, fps: Rate, mode: 'nearest' | 'floor' | 'ceil' = 'nearest'): number {
  return Number(divRound(us * BigInt(fps.num), BigInt(fps.den) * MICROS, mode));
}

/** 第 `frame` 帧开始的时刻（微秒，取最近的整数微秒，只用于报告误差与换算源时间）。 */
export function frameStart(frame: number, fps: Rate): bigint {
  return divRound(BigInt(frame) * BigInt(fps.den) * MICROS, BigInt(fps.num), 'nearest');
}

/** 音频的开始位置：所在帧，加上帧内的精确偏移（§2.10）。 */
export function audioStart(us: bigint, fps: Rate): { fromFrame: number; subframeOffset: MediaTime } {
  const fromFrame = frameAt(us, fps, 'floor');
  const num = us * BigInt(fps.num) - BigInt(fromFrame) * BigInt(fps.den) * MICROS;
  return { fromFrame, subframeOffset: reduce(num, MICROS * BigInt(fps.num)) };
}

const KNOWN_RATES: Rate[] = [
  { num: 24000, den: 1001 },
  { num: 24, den: 1 },
  { num: 25, den: 1 },
  { num: 30000, den: 1001 },
  { num: 30, den: 1 },
  { num: 50, den: 1 },
  { num: 60000, den: 1001 },
  { num: 60, den: 1 },
];

/** 旧格式把帧率存成浮点数（29.97002997…）：吸附到常见的精确帧率，差得远就按整数帧率取。 */
export function snapFps(value: number | null | undefined): { rate: Rate; snapped: boolean } | null {
  if (!value || !Number.isFinite(value) || value <= 0) return null;
  for (const rate of KNOWN_RATES) {
    if (Math.abs(rate.num / rate.den - value) < 0.005) return { rate, snapped: true };
  }
  return { rate: { num: Math.max(1, Math.round(value)), den: 1 }, snapped: false };
}

/** 十进制倍速（1.19）→ 精确的有理数。 */
export function rateOf(value: number | null | undefined): Rate {
  if (!value || !Number.isFinite(value) || value <= 0) return { num: 1, den: 1 };
  const us = micros(value);
  const g = gcd(us, MICROS);
  return { num: Number(us / g), den: Number(MICROS / g) };
}

/** 十进制秒的精确有理数 `num / den`（`den` 是 10 的幂），按数值的最短十进制写法读，不舍入。 */
export function decimal(value: number): { num: bigint; den: bigint } {
  if (!Number.isFinite(value)) throw new Error(`不是有限的数：${value}`);
  const text = decimalText(value);
  const negative = text.startsWith('-');
  const [whole = '0', fraction = ''] = text.replace('-', '').split('.');
  const num = BigInt(whole + fraction);
  return { num: negative ? -num : num, den: 10n ** BigInt(fraction.length) };
}

/** 数值的最短十进制写法，不用指数记法（引擎的十进制秒字符串不收 `1e-7`）。 */
export function decimalText(value: number): string {
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/i.exec(text);
  if (!match) return text;
  const [, sign = '', int = '', frac = '', exp] = match;
  const digits = int + frac;
  const point = int.length + Number(exp);
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/** dB → 线性倍数（外部项目的音量是 dB）。 */
export function linearOfDb(db: number): number {
  return Math.round(10 ** (db / 20) * 1e6) / 1e6;
}
