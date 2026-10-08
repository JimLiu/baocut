import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtifactStore } from '@baocut/jobs';
import type { Id, JobRecord } from '@baocut/protocol';
import { StorageGc } from './storage-gc.ts';

const HOUR = 60 * 60 * 1000;

describe('StorageGc', () => {
  let dir: string;
  let artifacts: ArtifactStore;
  let jobs: JobRecord[];
  let ledgerRefs: Set<string>;
  let spaceRecords: unknown[];
  let pruned: ((evicted: ReadonlySet<Id>) => void) | null;
  let logs: { level: string; message: string; fields?: Record<string, unknown> }[];
  let gc: StorageGc | null;

  const age = async (file: string, ms: number) => {
    const at = new Date(Date.now() - ms);
    await fs.utimes(file, at, at);
  };
  const exists = (file: string) =>
    fs.stat(file).then(
      () => true,
      () => false,
    );

  const make = (options: { blocked?: string | null; maxBytes?: number } = {}) => {
    gc = new StorageGc({
      jobs: {
        artifacts,
        referencedArtifactIds: () => new Set(ledgerRefs),
        onPruned: (listener) => {
          pruned = listener;
          return () => (pruned = null);
        },
        list: () => jobs,
      },
      spaceArtifacts: { list: () => spaceRecords },
      ready: Promise.resolve(),
      artifactSweepBlocked: options.blocked ?? null,
      cacheDir: path.join(dir, 'cache'),
      cacheMaxBytes: () => options.maxBytes ?? 1024 * 1024,
      log: {
        info: (message, fields) => logs.push({ level: 'info', message, fields }),
        warn: (message, fields) => logs.push({ level: 'warn', message, fields }),
      },
      pruneDebounceMs: 0,
    });
    return gc;
  };

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-gc-'));
    artifacts = new ArtifactStore(path.join(dir, 'artifacts'));
    jobs = [];
    ledgerRefs = new Set();
    spaceRecords = [];
    pruned = null;
    logs = [];
    gc = null;
  });

  afterEach(async () => {
    await gc?.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('引用集合 = 账本 + Space 产物记录；其余超过宽限期的删掉，结果记 info', async () => {
    const orphan = await artifacts.put(Buffer.from('orphan'));
    const ledger = await artifacts.put(Buffer.from('ledger'));
    const space = await artifacts.put(Buffer.from('space'), 'wav');
    for (const file of [orphan.path, ledger.path, space.path]) await age(file, 2 * HOUR);
    ledgerRefs.add(ledger.artifactId);
    spaceRecords.push({ jobId: 'job_1', result: { artifactId: 'sha256:other', outputs: [{ artifactId: space.artifactId }] } });

    const result = await make().sweepArtifacts();
    expect(result).toMatchObject({ removed: 1 });
    expect(await exists(orphan.path)).toBe(false);
    expect(await exists(ledger.path)).toBe(true);
    expect(await exists(space.path)).toBe(true);
    expect(logs).toContainEqual(expect.objectContaining({ level: 'info', message: 'Artifact cleanup finished' }));
  });

  it('有排队或运行中的任务时推迟，任务结束、账本淘汰任务之后补跑', async () => {
    const orphan = await artifacts.put(Buffer.from('orphan'));
    await age(orphan.path, 2 * HOUR);
    jobs = [{ jobId: 'job_run', state: 'running' } as JobRecord];
    const instance = make();
    expect(await instance.sweepArtifacts()).toBeNull();
    expect(await exists(orphan.path)).toBe(true);

    instance.start();
    jobs = [{ jobId: 'job_run', state: 'completed' } as JobRecord];
    pruned?.(new Set(['job_old']));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await instance.sweepArtifacts();
    expect(await exists(orphan.path)).toBe(false);
  });

  it('产物记录读不了（引用不全）时不清产物库，记一次 warn', async () => {
    const orphan = await artifacts.put(Buffer.from('orphan'));
    await age(orphan.path, 2 * HOUR);
    const instance = make({ blocked: 'space-artifacts-quarantined' });
    expect(await instance.sweepArtifacts()).toBeNull();
    expect(await instance.sweepArtifacts()).toBeNull();
    expect(await exists(orphan.path)).toBe(true);
    expect(logs.filter((l) => l.level === 'warn')).toHaveLength(1);
  });

  it('缓存超过设置的上限时按修改时间删最旧的', async () => {
    const cache = path.join(dir, 'cache');
    await fs.mkdir(path.join(cache, 'media', 'aa'), { recursive: true });
    const old = path.join(cache, 'media', 'aa', 'old.jpg');
    const recent = path.join(cache, 'media', 'aa', 'recent.jpg');
    await fs.writeFile(old, Buffer.alloc(600));
    await fs.writeFile(recent, Buffer.alloc(600));
    await age(old, 5 * HOUR);
    const result = await make({ maxBytes: 1000 }).trimCache();
    expect(result).toMatchObject({ removed: 1, removedBytes: 600 });
    expect(await exists(old)).toBe(false);
    expect(await exists(recent)).toBe(true);
  });
});
