import { describe, expect, it } from 'vitest';
import { chunkLimitSec, parseSilences, planChunks, type PlannedChunk } from './chunk-plan.ts';

/** 每块都不超过上限、首尾相接、覆盖整段。 */
function expectValid(chunks: PlannedChunk[], duration: number, max: number) {
  expect(chunks[0]!.start).toBe(0);
  expect(chunks.at(-1)!.end).toBe(duration);
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]!;
    expect(c.end).toBeGreaterThan(c.start);
    expect(c.end - c.start).toBeLessThanOrEqual(max + 1e-9);
    if (i > 0) expect(c.start).toBe(chunks[i - 1]!.end);
  }
}

describe('planChunks', () => {
  it('不超过上限时只有一块', () => {
    expect(planChunks({ durationSec: 60, maxChunkSec: 60, silences: [] })).toEqual([{ start: 0, end: 60 }]);
    expect(planChunks({ durationSec: 0, maxChunkSec: 10, silences: [] })).toEqual([{ start: 0, end: 0 }]);
  });

  it('没有静音时在上限处硬切', () => {
    const chunks = planChunks({ durationSec: 250, maxChunkSec: 100, silences: [] });
    expect(chunks).toEqual([
      { start: 0, end: 100 },
      { start: 100, end: 200 },
      { start: 200, end: 250 },
    ]);
  });

  it('切在窗口里最靠后的静音的中点', () => {
    const chunks = planChunks({
      durationSec: 180,
      maxChunkSec: 100,
      silences: [
        { start: 30, end: 31 }, // 窗口（50–100）之前，不用
        { start: 60, end: 62 },
        { start: 80, end: 84 },
        { start: 140, end: 141 },
      ],
    });
    expect(chunks).toEqual([
      { start: 0, end: 82 },
      { start: 82, end: 180 },
    ]);
  });

  it('跨在窗口边上的静音取夹进窗口的点', () => {
    // 静音 95–110 的中点 102.5 在窗口外，夹到窗口末端 100。
    expect(planChunks({ durationSec: 150, maxChunkSec: 100, silences: [{ start: 95, end: 110 }] })[0]).toEqual({ start: 0, end: 100 });
    // 静音 40–52 的中点 46 在窗口前，夹到窗口起点 50。
    expect(planChunks({ durationSec: 150, maxChunkSec: 100, silences: [{ start: 40, end: 52 }] })[0]).toEqual({ start: 0, end: 50 });
  });

  it('开头的静音不影响切点', () => {
    const chunks = planChunks({ durationSec: 150, maxChunkSec: 100, silences: [{ start: 0, end: 5 }] });
    expect(chunks[0]).toEqual({ start: 0, end: 100 });
  });

  it('不留下太短的最后一块', () => {
    const chunks = planChunks({ durationSec: 100.2, maxChunkSec: 100, silences: [] });
    expectValid(chunks, 100.2, 100);
    expect(chunks.at(-1)!.end - chunks.at(-1)!.start).toBeGreaterThanOrEqual(1);
  });

  it('同样的输入得到同样的计划（静音的顺序无关）', () => {
    const silences = [
      { start: 70, end: 72 },
      { start: 55, end: 57 },
      { start: 170, end: 171 },
    ];
    const a = planChunks({ durationSec: 300, maxChunkSec: 100, silences });
    const b = planChunks({ durationSec: 300, maxChunkSec: 100, silences: [...silences].reverse() });
    expect(a).toEqual(b);
    expectValid(a, 300, 100);
  });

  it('长音频与密集静音：每块都在上限内并覆盖整段', () => {
    const silences = Array.from({ length: 400 }, (_, i) => ({ start: i * 9.3, end: i * 9.3 + 0.5 }));
    const chunks = planChunks({ durationSec: 3600, maxChunkSec: 540, silences });
    expectValid(chunks, 3600, 540);
    // 每个切点都落在某段静音里。
    for (const c of chunks.slice(0, -1)) expect(silences.some((s) => s.start <= c.end && c.end <= s.end)).toBe(true);
  });

  it('上限不合法时报错', () => {
    expect(() => planChunks({ durationSec: 10, maxChunkSec: 0, silences: [] })).toThrow();
  });
});

describe('chunkLimitSec', () => {
  it('时长与字节上限取小的，乘余量', () => {
    expect(chunkLimitSec({ maxDurationSec: 1800, maxInputBytes: null, bytesPerSec: 32000 })).toBeCloseTo(1620);
    expect(chunkLimitSec({ maxDurationSec: null, maxInputBytes: 3_200_000, bytesPerSec: 32000 })).toBeCloseTo(90);
    expect(chunkLimitSec({ maxDurationSec: 60, maxInputBytes: 3_200_000, bytesPerSec: 32000 })).toBeCloseTo(54);
  });

  it('偏好的块长更短时用它；都没有时不限', () => {
    expect(chunkLimitSec({ maxDurationSec: null, maxInputBytes: 25_000_000, bytesPerSec: 8000, preferredSec: 120 })).toBe(120);
    expect(chunkLimitSec({ maxDurationSec: null, maxInputBytes: null, bytesPerSec: 8000 })).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('parseSilences', () => {
  it('读出 silencedetect 的起止，没有收尾的延续到末尾', () => {
    const stderr = [
      '[silencedetect @ 0x1] silence_start: 1.5',
      '[silencedetect @ 0x1] silence_end: 2.25 | silence_duration: 0.75',
      'size=N/A time=00:00:05.00',
      '[silencedetect @ 0x1] silence_start: -0.01',
      '[silencedetect @ 0x1] silence_end: 0.4 | silence_duration: 0.41',
      '[silencedetect @ 0x1] silence_start: 9',
    ].join('\n');
    expect(parseSilences(stderr, 10)).toEqual([
      { start: 1.5, end: 2.25 },
      { start: 0, end: 0.4 },
      { start: 9, end: 10 },
    ]);
  });
});
