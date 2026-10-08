import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtifactStore, collectArtifactIds } from './artifact-store.ts';

/**
 * 产物库的写入持久性：临时文件写完 fsync → rename → fsync 目录。按发生顺序记下 open、sync 与 rename。
 */
describe('ArtifactStore 写入 fsync', () => {
  let dir: string;
  let events: string[];
  let proto: { sync: () => Promise<void> };

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-artifacts-'));
    events = [];
    const probe = await fs.open(path.join(dir, 'probe'), 'w');
    proto = Object.getPrototypeOf(probe) as { sync: () => Promise<void> };
    await probe.close();
    await fs.rm(path.join(dir, 'probe'));
    const paths = new WeakMap<object, string>();
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args);
      paths.set(handle, String(args[0]));
      return handle;
    });
    const sync = proto.sync;
    vi.spyOn(proto, 'sync').mockImplementation(async function (this: object) {
      events.push(`sync ${label(paths.get(this))}`);
      return sync.call(this);
    });
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      events.push(`rename ${label(String(from))} -> ${label(String(to))}`);
      return rename(from, to);
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const store = () => new ArtifactStore(path.join(dir, 'artifacts'));
  /** 路径的类别：产物目录、临时文件、产物文件。 */
  function label(file: string | undefined): string {
    if (!file) return '?';
    if (file === path.join(dir, 'artifacts')) return 'dir';
    if (file.endsWith('.tmp')) return 'tmp';
    return 'file';
  }

  it('put：fsync 临时文件，再改名，再 fsync 目录；内容完整', async () => {
    const bytes = Buffer.from('{"hello":"world"}');
    const { artifactId, path: file } = await store().put(bytes);
    expect(events).toEqual(['sync tmp', 'rename tmp -> file', 'sync dir']);
    expect(await fs.readFile(file)).toEqual(bytes);
    expect(artifactId).toBe(`sha256:${createHash('sha256').update(bytes).digest('hex')}`);
    expect(await store().verify(artifactId)).toBe(true);
    expect((await fs.readdir(path.join(dir, 'artifacts'))).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('putFile：克隆（或复制）之后同样 fsync、改名、fsync 目录', async () => {
    const source = path.join(dir, 'source.wav');
    await fs.writeFile(source, Buffer.alloc(4096, 7));
    events.length = 0;
    const { artifactId, path: file, byteLength } = await store().putFile(source, 'wav');
    expect(events).toEqual(['sync tmp', 'rename tmp -> file', 'sync dir']);
    expect(byteLength).toBe(4096);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o644);
    expect(await store().verify(artifactId)).toBe(true);
  });

  it('已经有同一内容时不再写，也不 fsync', async () => {
    const bytes = Buffer.from('same');
    await store().put(bytes);
    events.length = 0;
    await store().put(bytes);
    expect(events).toEqual([]);
  });

  it('fsync 失败时不改名，临时文件删掉', async () => {
    vi.mocked(proto.sync).mockRejectedValueOnce(
      Object.assign(new Error('EIO'), { code: 'EIO' }),
    );
    await expect(store().put(Buffer.from('broken'))).rejects.toMatchObject({ code: 'EIO' });
    expect(events.some((e) => e.startsWith('rename'))).toBe(false);
    expect(await fs.readdir(path.join(dir, 'artifacts'))).toEqual([]);
  });
});

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
