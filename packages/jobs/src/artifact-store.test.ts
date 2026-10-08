import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtifactStore, collectArtifactIds } from './artifact-store.ts';

const HOUR = 60 * 60 * 1000;

describe('ArtifactStore.sweep', () => {
  let dir: string;
  let store: ArtifactStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-artifacts-'));
    store = new ArtifactStore(path.join(dir, 'artifacts'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** 把文件的修改时间往前拨。 */
  const age = async (file: string, ms: number) => {
    const at = new Date(Date.now() - ms);
    await fs.utimes(file, at, at);
  };
  const exists = (file: string) =>
    fs.stat(file).then(
      () => true,
      () => false,
    );

  it('删掉没有引用、超过 1 小时的产物；有引用的与刚发布的留着', async () => {
    const orphan = await store.put(Buffer.from('orphan'), 'json');
    const byLedger = await store.put(Buffer.from('ledger'), 'wav');
    const bySpace = await store.put(Buffer.from('space'), 'png');
    const fresh = await store.put(Buffer.from('fresh'), 'mp3');
    for (const file of [orphan.path, byLedger.path, bySpace.path]) await age(file, 2 * HOUR);

    const hex = bySpace.artifactId.slice('sha256:'.length);
    const result = await store.sweep(new Set([byLedger.artifactId, hex]));

    expect(result).toMatchObject({ scanned: 4, removed: 1, removedBytes: 'orphan'.length, temporaryRemoved: 0, failed: 0 });
    expect(await exists(orphan.path)).toBe(false);
    expect(await exists(byLedger.path)).toBe(true);
    expect(await exists(bySpace.path)).toBe(true);
    expect(await exists(fresh.path)).toBe(true);
  });

  it('重新发布已有的内容刷新修改时间，宽限期照样成立', async () => {
    const first = await store.put(Buffer.from('same bytes'), 'json');
    await age(first.path, 3 * HOUR);
    await store.put(Buffer.from('same bytes'), 'json');
    expect(await store.sweep(new Set())).toMatchObject({ removed: 0 });
    expect(await exists(first.path)).toBe(true);
  });

  it('残留的 .tmp 超过 1 小时删掉，新的留着；名字不是产物形状的文件与目录不动', async () => {
    const artifacts = path.join(dir, 'artifacts');
    await fs.mkdir(path.join(artifacts, 'nested'), { recursive: true });
    const hex = 'a'.repeat(64);
    const oldTmp = path.join(artifacts, `${hex}.json.1234.tmp`);
    const newTmp = path.join(artifacts, `${hex}.wav.5678.tmp`);
    const other = path.join(artifacts, 'README');
    const odd = path.join(artifacts, `${hex}.exe`);
    for (const file of [oldTmp, newTmp, other, odd]) await fs.writeFile(file, 'x');
    for (const file of [oldTmp, other, odd]) await age(file, 2 * HOUR);

    const result = await store.sweep(new Set());
    expect(result).toMatchObject({ scanned: 0, removed: 0, temporaryRemoved: 1 });
    expect(await exists(oldTmp)).toBe(false);
    expect(await exists(newTmp)).toBe(true);
    expect(await exists(other)).toBe(true);
    expect(await exists(odd)).toBe(true);
    expect(await exists(path.join(artifacts, 'nested'))).toBe(true);
  });

  it('产物目录还不存在时什么也不做', async () => {
    expect(await store.sweep(new Set())).toEqual({ scanned: 0, removed: 0, removedBytes: 0, temporaryRemoved: 0, failed: 0 });
  });

  it('collectArtifactIds：在嵌套的值里找出全部产物 id', () => {
    const a = `sha256:${'1'.repeat(64)}`;
    const b = `sha256:${'2'.repeat(64)}`;
    const ids = collectArtifactIds({ result: { artifactId: a }, steps: [{ output: { units: [{ vocalsArtifactId: b }] } }], other: 'sha256:short' });
    expect([...ids].sort()).toEqual([a, b]);
  });
});
