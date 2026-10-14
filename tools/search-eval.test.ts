import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HashingEmbeddingProvider } from '@baocut/models';
import {
  answersOf,
  metricsOf,
  openEvalSpace,
  runRoutes,
  textDataset,
  type EvalDataset,
  type EvalSpace,
} from './embedding-eval/search-eval.ts';

let dir: string | null = null;
let space: EvalSpace | null = null;
afterEach(async () => {
  await space?.close();
  space = null;
  if (dir) await fs.rm(dir, { recursive: true, force: true });
  dir = null;
});

describe('产品级检索评测脚本', () => {
  it('仓库里的文字夹具：每个句群一部视频，查询的答案指向视频', async () => {
    const dataset = await textDataset();
    expect(dataset.videos.length).toBeGreaterThan(50);
    const ids = new Set(dataset.videos.map((v) => v.videoId));
    for (const query of dataset.queries) for (const id of query.relevant) expect(ids.has(id)).toBe(true);
    expect(dataset.queries.some((q) => q.relevant.length === 0)).toBe(true);
  });

  it('画面命中按源时间窗口对回第几帧（每帧在 i * 8 + 4 秒）', () => {
    const hit = (start: number, end: number) =>
      ({
        target: { kind: 'asset-span', videoId: 'f-v1', assetId: 'a1', representation: 'keyframe' },
        anchor: { startSec: start, endSec: end },
      }) as never;
    expect(answersOf(hit(0, 8))).toEqual(['f-v1#0']);
    expect(answersOf(hit(8, 24))).toEqual(['f-v1#1', 'f-v1#2']);
    expect(answersOf({ target: { kind: 'document-span', videoId: 't-a' }, anchor: { startSec: 0, endSec: 1 } } as never)).toEqual(['t-a']);
  });

  it('指标：R@k、MRR、弱命中的两面', () => {
    const m = metricsOf([
      { id: 'a', category: 'x', firstRelevant: 1, firstRelevantWeak: false, strong: 2, hasAnswer: true },
      { id: 'b', category: 'x', firstRelevant: 4, firstRelevantWeak: true, strong: 0, hasAnswer: true },
      { id: 'c', category: 'x', firstRelevant: null, firstRelevantWeak: null, strong: 1, hasAnswer: false },
    ]);
    expect(m).toMatchObject({ queries: 3, r1: 0.5, r5: 1, r10: 1, mrr: 0.625, strongPerQuery: 1, relevantWeak: 0.5, noAnswerStrong: 1 });
  });

  it('端到端：真的 searchV2 建索引、检索文字与画面，按路线出分数', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-search-eval-'));
    // 散列 Provider 把「图片」文件的内容当文字编码：帧就是写着画面描述的文本文件。
    const frame = async (name: string, text: string) => {
      const file = path.join(dir!, 'src', `${name}.jpg`);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, text);
      return { id: name, file };
    };
    const dataset: EvalDataset = {
      videos: [
        { videoId: 't-a', text: 'the camera battery died during the interview', language: 'en', frames: [] },
        { videoId: 't-b', text: 'cooking pasta with fresh tomatoes', language: 'en', frames: [] },
        {
          videoId: 'f-v1',
          text: null,
          language: 'en',
          frames: [await frame('x0', 'red bicycle near a brick wall'), await frame('x1', 'a slide with quarterly results')],
        },
      ],
      queries: [
        { id: 'q1', text: 'camera battery', target: 'text', category: 'exact-word', relevant: ['t-a'] },
        { id: 'q2', text: 'quarterly results slide', target: 'visual', category: 'visual', relevant: ['f-v1#1'] },
      ],
    };
    space = await openEvalSpace(dataset, new HashingEmbeddingProvider({ dims: 64 }), path.join(dir, 'work'), path.join(dir, 'frames'));
    const { reports, details } = await runRoutes(space, dataset);
    const route = (name: string, target: string) => reports.find((r) => r.route === name && r.target === target)!;
    expect(route('text/lexical', 'text').overall.r1).toBe(1);
    expect(route('text/semantic', 'text').overall.r1).toBe(1);
    expect(route('visual/semantic', 'visual').overall.r1).toBe(1);
    expect(route('visual/semantic', 'visual').failures).toEqual({});
    expect(Object.keys(details)).toContain('text+visual/hybrid:visual');
  });
});
