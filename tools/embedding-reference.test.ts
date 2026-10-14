import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EMBEDDING_VECTOR_COMPAT } from '@baocut/models';
import {
  compareReference,
  computeReference,
  openProviders,
  readReference,
  REFERENCE_MIN_COSINE,
  referenceKey,
} from './embedding-eval/reference-vectors.ts';

// 真的模型包只在本机有：设了这两个变量（模型目录、装着 litertlm-runtime 的 Runtime Home `tools/`）才跑，CI 上跳过。
const models = process.env.BAOCUT_EMBED_REFERENCE_MODELS;
const tools = process.env.BAOCUT_EMBED_REFERENCE_TOOLS;

describe('参考向量', () => {
  it('参考文件：每一份都带当前的兼容标签，向量是单位长度', async () => {
    const file = await readReference();
    for (const [key, entry] of Object.entries(file.entries)) {
      expect(entry.encoderProfileId.text, key).toContain(`/${EMBEDDING_VECTOR_COMPAT}/`);
      for (const v of entry.vectors) expect(Math.hypot(...v.vector), `${key} ${v.id}`).toBeCloseTo(1, 4);
    }
    expect(compareReference([{ id: 'a', kind: 'text', role: 'query', vector: [1, 0] }], [{ id: 'a', kind: 'text', role: 'query', vector: [0.9, 0.1] }])).toEqual([
      { id: 'text:a', cosine: expect.any(Number) },
    ]);
    expect(REFERENCE_MIN_COSINE).toBeGreaterThan(0.999);
  });

  it.skipIf(!models || !tools)(
    '本机模型包编出的向量与参考一致（不一致就把 EMBEDDING_VECTOR_COMPAT 加一）',
    async () => {
      const work = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-embed-reference-'));
      const opened = await openProviders(models!, tools!, work);
      try {
        const file = await readReference();
        let compared = 0;
        for (const bundle of opened.bundles) {
          const computed = await computeReference(bundle.provider, { vision: bundle.vision });
          const stored = file.entries[referenceKey(bundle.bundleId, (await bundle.provider.profile('retrieval')).device ?? 'cpu')];
          if (!stored) continue;
          expect(compareReference(stored.vectors, computed.vectors), bundle.bundleId).toEqual([]);
          compared++;
        }
        expect(compared).toBeGreaterThan(0);
      } finally {
        await opened.close();
        await fs.rm(work, { recursive: true, force: true });
      }
    },
    300_000,
  );
});
