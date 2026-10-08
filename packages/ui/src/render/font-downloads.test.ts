import { expect, test } from 'vitest';
import type { FontFaceQuery, FontsResolveResult } from '@baocut/protocol';
import { downloadingResolve } from './font-downloads.ts';

type Face = FontsResolveResult['faces'][number];

function face(query: FontFaceQuery, source: 'local' | 'downloaded'): Face {
  return {
    ...query,
    faceIndex: 0,
    fileSize: 10,
    size: 10,
    header: '',
    tables: [],
    source,
    file: { url: `http://127.0.0.1/${query.family}`, fileName: `${query.family}.ttf`, byteLength: 10, expiresAt: '2100-01-01T00:00:00Z' },
  } as unknown as Face;
}

test('下载中的 face 隔一会儿再问，直到下载结束；本机有的、失败的照原样合进结果', async () => {
  const local = { family: 'PingFang SC', weight: 400, italic: false };
  const lobster = { family: 'Lobster', weight: 400, italic: false };
  const broken = { family: 'Broken Font', weight: 700, italic: false };
  const asked: { faces: FontFaceQuery[]; download: boolean }[] = [];
  const answers: FontsResolveResult[] = [
    {
      faces: [face(local, 'local')],
      missing: [
        { ...lobster, reason: 'downloading', jobId: 'job_1' },
        { ...broken, reason: 'downloading', jobId: 'job_2' },
      ],
    },
    {
      faces: [],
      missing: [
        { ...lobster, reason: 'downloading', jobId: 'job_1' },
        { ...broken, reason: 'download-failed', code: 'FONT_DOWNLOAD_SOURCE' },
      ],
    },
    { faces: [face(lobster, 'downloaded')], missing: [] },
  ];
  const sleeps: number[] = [];
  const resolve = downloadingResolve(async (params) => (asked.push(params), answers.shift()!), {
    pollMs: 5,
    sleep: async (ms) => void sleeps.push(ms),
  });
  const result = await resolve([local, lobster, broken]);
  expect(asked.map((a) => a.faces.map((f) => f.family))).toEqual([
    ['PingFang SC', 'Lobster', 'Broken Font'],
    ['Lobster', 'Broken Font'],
    ['Lobster'],
  ]);
  // 只有第一次带 download：再问只等已经开始的下载，刚取消的不会被再问重新开始。
  expect(asked.map((a) => a.download)).toEqual([true, false, false]);
  expect(sleeps).toEqual([5, 5]);
  expect(result.faces.map((f) => [f.family, f.source])).toEqual([
    ['PingFang SC', 'local'],
    ['Lobster', 'downloaded'],
  ]);
  expect(result.missing).toEqual([{ ...broken, reason: 'download-failed', code: 'FONT_DOWNLOAD_SOURCE' }]);
});

test('等的时候下载被取消：再问不带 download，Runtime 答「可以下载」就照回退字体画，不重新开始', async () => {
  const lobster = { family: 'Lobster', weight: 400, italic: false };
  const asked: boolean[] = [];
  const answers: FontsResolveResult[] = [
    { faces: [], missing: [{ ...lobster, reason: 'downloading', jobId: 'job_1' }] },
    { faces: [], missing: [{ ...lobster, reason: 'downloadable' }] },
  ];
  const resolve = downloadingResolve(async (params) => (asked.push(params.download), answers.shift()!), {
    pollMs: 5,
    sleep: async () => {},
  });
  const result = await resolve([lobster]);
  expect(asked).toEqual([true, false]);
  expect(result).toEqual({ faces: [], missing: [{ ...lobster, reason: 'downloadable' }] });
});

test('等到上限就不再等：还在下载的记为 downloading，照回退字体画', async () => {
  const lobster = { family: 'Lobster', weight: 400, italic: false };
  let calls = 0;
  const resolve = downloadingResolve(
    async () => (calls++, { faces: [], missing: [{ ...lobster, reason: 'downloading', jobId: 'job_1' }] }),
    { pollMs: 10, maxWaitMs: 30, sleep: async () => {} },
  );
  const result = await resolve([lobster]);
  expect(calls).toBe(4);
  expect(result).toEqual({ faces: [], missing: [{ ...lobster, reason: 'downloading' }] });
});

test('同一批里先到的 face 先交出去：本机的不等下载，等的时候先下载完的也先给', async () => {
  const local = { family: 'PingFang SC', weight: 400, italic: false };
  const lobster = { family: 'Lobster', weight: 400, italic: false };
  const mashan = { family: 'Ma Shan Zheng', weight: 400, italic: false };
  const answers: FontsResolveResult[] = [
    {
      faces: [face(local, 'local')],
      missing: [
        { ...lobster, reason: 'downloading', jobId: 'job_1' },
        { ...mashan, reason: 'downloading', jobId: 'job_2' },
      ],
    },
    { faces: [face(lobster, 'downloaded')], missing: [{ ...mashan, reason: 'downloading', jobId: 'job_2' }] },
    { faces: [face(mashan, 'downloaded')], missing: [] },
  ];
  const partial: string[][] = [];
  const resolve = downloadingResolve(async () => answers.shift()!, { pollMs: 5, sleep: async () => {} });
  const result = await resolve([local, lobster, mashan], (faces) => partial.push(faces.map((f) => f.family)));
  expect(partial).toEqual([['PingFang SC'], ['Lobster']]);
  expect(result.faces.map((f) => f.family)).toEqual(['PingFang SC', 'Lobster', 'Ma Shan Zheng']);
});

test('没有要等的就不分批交：结果一次给', async () => {
  const local = { family: 'PingFang SC', weight: 400, italic: false };
  const partial: unknown[] = [];
  const resolve = downloadingResolve(async () => ({ faces: [face(local, 'local')], missing: [] }), { sleep: async () => {} });
  const result = await resolve([local], (faces) => partial.push(faces));
  expect(partial).toEqual([]);
  expect(result.faces).toHaveLength(1);
});
