import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BundleDefinition } from './bundle-registry.ts';
import { INSTALL_RECORD_FILE, readInstallRecord, updateInstallRecord } from './install-record.ts';
import {
  MOVE_JOURNAL_FILE,
  MOVING_DIR,
  moveModels,
  nestedDirs,
  planMove,
  recoverMove,
  removeSources,
  scanModelsDir,
} from './models-dir.ts';
import { syntheticBytes, writeSyntheticRepo, type SyntheticRepo } from './testing/fake-model-source.ts';

const ASR: SyntheticRepo = {
  repo: 'test/asr',
  revision: 'a'.repeat(40),
  files: { 'config.json': Buffer.from('{}'), 'weights/model.safetensors': syntheticBytes(50_000, 1) },
};
const VAD: SyntheticRepo = { repo: 'test/vad', revision: 'b'.repeat(40), files: { 'model.bin': syntheticBytes(20_000, 2) } };
const OTHER: SyntheticRepo = { repo: 'someone/else', revision: 'c'.repeat(40), files: { 'x.bin': syntheticBytes(1_000, 3) } };
const BUNDLES: BundleDefinition[] = [
  {
    bundleId: 'asr@mlx',
    capability: 'transcribe',
    backend: 'mlx',
    device: 'metal',
    label: 'ASR',
    components: {
      asr: { family: 'qwen3-asr', repo: ASR.repo, revision: ASR.revision },
      vad: { family: 'silero-vad', repo: VAD.repo, revision: VAD.revision },
    },
  },
];
const size = (r: SyntheticRepo) => Object.values(r.files).reduce((n, b) => n + b.length, 0);

let tmp: string;
let from: string;
let to: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-models-dir-'));
  from = path.join(tmp, 'from');
  to = path.join(tmp, 'to');
  await fs.mkdir(from);
  await fs.mkdir(to);
  for (const repo of [ASR, VAD, OTHER]) await writeSyntheticRepo(from, repo);
  await updateInstallRecord(from, (r) => {
    r.bundles['asr@mlx'] = { installedAt: '2026-10-01T00:00:00.000Z' };
  });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const exists = (p: string) =>
  fs.stat(p).then(
    () => true,
    () => false,
  );

describe('模型目录的盘上操作', () => {
  it('按清单认出模型：登记过的仓库计入大小与模型包，别的仓库只列出；不在的文件夹是空的', async () => {
    const scan = await scanModelsDir(from, BUNDLES);
    expect(scan.repos.map((r) => [r.repo, r.known])).toEqual([
      ['someone/else', false],
      ['test/asr', true],
      ['test/vad', true],
    ]);
    expect(scan.bundleIds).toEqual(['asr@mlx']);
    expect(scan.bytes).toBe(size(ASR) + size(VAD));
    expect(await scanModelsDir(path.join(tmp, 'nope'), BUNDLES)).toEqual({ repos: [], bundleIds: [], bytes: 0 });
  });

  it('互相包含的目录', () => {
    expect(nestedDirs('/a/b', '/a/b')).toBe('same');
    expect(nestedDirs('/a/b', '/a/b/c')).toBe('nested');
    expect(nestedDirs('/a/b/c', '/a/b')).toBe('nested');
    expect(nestedDirs('/a/b', '/a/bc')).toBeNull();
  });

  it('计划：目标里已有同一版本的不再搬；同名的别的版本留在原处', async () => {
    await writeSyntheticRepo(to, VAD);
    await writeSyntheticRepo(to, { ...ASR, revision: 'd'.repeat(40) });
    const plan = await planMove(from, to, BUNDLES);
    expect(plan.move).toEqual([]);
    expect(plan.present.map((r) => r.repo)).toEqual(['test/vad']);
    expect(plan.blocked.map((r) => r.repo)).toEqual(['test/asr']);
  });

  for (const same of [true, false]) {
    const label = same ? '同一块盘（改名）' : '跨盘（复制、校验）';

    it(`${label}：搬过去、合并安装记录、进度按字节；换过去之后删原目录`, async () => {
      await updateInstallRecord(to, (r) => {
        r.bundles['other@mlx'] = { installedAt: '2026-09-01T00:00:00.000Z' };
      });
      const plan = await planMove(from, to, BUNDLES);
      const progress: number[] = [];
      await moveModels({
        from,
        to,
        repos: plan.move,
        sameVolume: same,
        signal: new AbortController().signal,
        onProgress: (p) => progress.push(p.done),
      });
      expect((await scanModelsDir(to, BUNDLES)).bundleIds).toEqual(['asr@mlx']);
      expect(Object.keys((await readInstallRecord(to)).bundles).sort()).toEqual(['asr@mlx', 'other@mlx']);
      expect(progress.at(-1)).toBe(plan.bytes);
      expect(await exists(path.join(to, MOVING_DIR))).toBe(false);
      // 日志留到换过去之后；不认识的仓库不动。
      expect(await exists(path.join(from, MOVE_JOURNAL_FILE))).toBe(true);
      expect(await exists(path.join(from, 'someone', 'else'))).toBe(true);
      expect(await exists(path.join(from, 'test', 'asr'))).toBe(!same);
      expect(
        await removeSources(
          from,
          plan.move.map((r) => r.repo),
        ),
      ).toEqual([]);
      expect(await exists(path.join(from, 'test'))).toBe(false);
      expect(await exists(path.join(from, INSTALL_RECORD_FILE))).toBe(false);
    });

    it(`${label}：中途失败时回滚，原目录原样，目标里不留东西`, async () => {
      const plan = await planMove(from, to, BUNDLES);
      const failing = moveModels({
        from,
        to,
        repos: plan.move,
        sameVolume: same,
        signal: new AbortController().signal,
        beforePlace: (repo) => {
          if (repo === 'test/vad') throw new Error('注入的失败');
        },
      });
      await expect(failing).rejects.toThrow('注入的失败');
      expect((await scanModelsDir(from, BUNDLES)).bundleIds).toEqual(['asr@mlx']);
      expect((await scanModelsDir(to, BUNDLES)).repos).toEqual([]);
      expect(await exists(path.join(to, MOVING_DIR))).toBe(false);
      expect(await exists(path.join(to, INSTALL_RECORD_FILE))).toBe(false);
      expect(await exists(path.join(from, MOVE_JOURNAL_FILE))).toBe(false);
    });

    it(`${label}：取消时回滚`, async () => {
      const plan = await planMove(from, to, BUNDLES);
      const abort = new AbortController();
      const cancelled = moveModels({
        from,
        to,
        repos: plan.move,
        sameVolume: same,
        signal: abort.signal,
        beforePlace: (repo) => {
          if (repo === 'test/vad') abort.abort(new Error('取消'));
          abort.signal.throwIfAborted();
        },
      });
      await expect(cancelled).rejects.toThrow('取消');
      expect((await scanModelsDir(from, BUNDLES)).bundleIds).toEqual(['asr@mlx']);
      expect((await scanModelsDir(to, BUNDLES)).repos).toEqual([]);
    });
  }

  it('跨盘复制出来的文件校验不符时失败并回滚', async () => {
    const plan = await planMove(from, to, BUNDLES);
    // 原目录里的文件被改坏（大小不变）：复制出来的与清单对不上。
    const file = path.join(from, 'test', 'vad', 'model.bin');
    const bytes = await fs.readFile(file);
    bytes[0] = bytes[0]! ^ 0xff;
    await fs.writeFile(file, bytes);
    await expect(moveModels({ from, to, repos: plan.move, sameVolume: false, signal: new AbortController().signal })).rejects.toThrow(
      'Checksum of model.bin',
    );
    expect((await scanModelsDir(to, BUNDLES)).repos).toEqual([]);
    expect(await exists(path.join(to, MOVING_DIR))).toBe(false);
    expect(await exists(path.join(from, 'test', 'asr', 'config.json'))).toBe(true);
  });

  it('启动时按日志回滚上次没做完的移动：同一块盘时改名回来', async () => {
    // 假装改名过去了一个仓库就崩溃了。
    await fs.writeFile(
      path.join(from, MOVE_JOURNAL_FILE),
      JSON.stringify({ format_version: 1, to, sameVolume: true, repos: ['test/asr', 'test/vad'] }),
    );
    await fs.mkdir(path.join(to, 'test'), { recursive: true });
    await fs.rename(path.join(from, 'test', 'asr'), path.join(to, 'test', 'asr'));
    await fs.mkdir(path.join(to, MOVING_DIR), { recursive: true });
    expect(await recoverMove(from)).toEqual({ restored: ['test/asr'] });
    expect((await scanModelsDir(from, BUNDLES)).bundleIds).toEqual(['asr@mlx']);
    expect(await exists(path.join(to, 'test', 'asr'))).toBe(false);
    expect(await exists(path.join(to, MOVING_DIR))).toBe(false);
    expect(await exists(path.join(from, MOVE_JOURNAL_FILE))).toBe(false);
    expect(await recoverMove(from)).toBeNull();
  });
});
