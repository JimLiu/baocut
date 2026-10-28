import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AddedModels, ModelAddError } from './added-models.ts';
import { ModelCatalog } from './model-catalog.ts';
import { ggufBytes } from './testing/gguf-bytes.ts';

const COMMIT = 'c'.repeat(40);
const SHA = 'd'.repeat(64);

/** 假的 Hugging Face 接口：版本解析成 `COMMIT`，`paths-info` 按 `files` 回答。 */
function fakeHub(files: Record<string, { size: number; lfs?: boolean }>, calls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/revision/')) return Response.json({ sha: COMMIT });
    if (url.includes('/paths-info/')) {
      const { paths } = JSON.parse(String(init?.body)) as { paths: string[] };
      return Response.json(
        paths.filter((p) => files[p]).map((p) => ({ type: 'file', path: p, size: files[p]!.size, ...(files[p]!.lfs ? { lfs: { oid: SHA, size: files[p]!.size } } : {}) })),
      );
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('AddedModels', () => {
  let root: string;
  let file: string;
  const catalogOf = () => new ModelCatalog({ root: path.join(root, 'models'), engineAvailable: () => true });
  const open = (catalog: ModelCatalog, hub: typeof fetch = fakeHub({})) =>
    new AddedModels({ file, catalog, endpoint: () => 'https://hub.example', fetch: hub });

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-added-'));
    file = path.join(root, 'store', 'added-models.json');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('目录里的包：登记进模型列表、写下记录，重开后照样在；再加一次是同一个', async () => {
    const catalog = catalogOf();
    const added = open(catalog);
    const id = await added.add({ source: 'catalog', packageId: 'yue2_main_bf16' });
    expect(id).toBe('yue2-main-bf16@audio-cpp');
    const status = (await catalog.status(id))!;
    expect(status).toMatchObject({ state: 'not-installed', capability: 'music', added: { kind: 'catalog', family: 'yue2', source: 'yue2_main_bf16' } });
    expect(status.estimatedBytes).toBeGreaterThan(1e9);
    expect(await added.add({ source: 'catalog', packageId: 'yue2_main_bf16' })).toBe(id);
    const record = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(record).toMatchObject({ format_version: 1, entries: [{ kind: 'catalog', packageId: 'yue2_main_bf16' }] });
    const again = catalogOf();
    open(again);
    expect((await again.status(id))?.added?.kind).toBe('catalog');
    expect(added.addable().families.find((f) => f.family === 'yue2')!.packages.find((p) => p.id === 'yue2_main_bf16')!.state).toBe('added');
  });

  it('拒绝：内置的包、不认识的包、用不上的族、自己指定文件时选音乐族', async () => {
    const added = open(catalogOf());
    const code = (work: Promise<unknown>) => work.then(() => null, (e: ModelAddError) => `${e.kind}:${e.code}`);
    expect(await code(added.add({ source: 'catalog', packageId: 'yue2_main_q8_0' }))).toBe('refused:MODEL_ADD_REFUSED');
    expect(await code(added.add({ source: 'catalog', packageId: 'nope' }))).toBe('refused:MODEL_ADD_REFUSED');
    expect(await code(added.add({ source: 'local-file', family: 'yue2', path: path.join(root, 'x.gguf') }))).toBe('refused:MODEL_ADD_REFUSED');
    expect(await code(added.add({ source: 'repo-file', family: 'qwen3_tts', address: 'https://example.com/a/b/c.gguf' }))).toBe('refused:MODEL_ADD_REFUSED');
    expect(await code(added.add({ source: 'repo-file', family: 'qwen3_tts', address: 'me/repo/model.safetensors' }))).toBe('refused:MODEL_ADD_REFUSED');
  });

  it('本机文件原地引用：加完就装好；大小变了报不完整；移出列表不碰文件', async () => {
    const gguf = path.join(root, 'voices', 'my voice.gguf');
    await fs.mkdir(path.dirname(gguf), { recursive: true });
    await fs.writeFile(gguf, Buffer.concat([Buffer.from('GGUF'), Buffer.alloc(60)]));
    const catalog = catalogOf();
    const added = open(catalog);
    const id = await added.add({ source: 'local-file', family: 'qwen3_tts', path: gguf });
    const status = (await catalog.status(id))!;
    expect(status.state).toBe('installed');
    expect(status.label).toBe('my voice');
    expect(status.license?.commercialUse).toBeNull();
    expect(status.components).toMatchObject([{ origin: 'local-file', file: gguf, state: 'installed', bytes: 64 }]);
    expect(await added.add({ source: 'local-file', family: 'qwen3_tts', path: gguf, label: 'again' })).toBe(id);
    // 读不懂的文件头不拒绝，按族配通用的特性。
    expect(JSON.parse(await fs.readFile(file, 'utf8')).entries[0].variant).toBeUndefined();

    await fs.appendFile(gguf, 'x');
    expect((await catalog.status(id))!.state).toBe('not-installed');

    await added.unlist(id);
    expect(await catalog.status(id)).toBeNull();
    expect((await fs.stat(gguf)).size).toBe(65);
    expect(JSON.parse(await fs.readFile(file, 'utf8')).entries).toEqual([]);
  });

  it('本机文件：从文件头认出是哪一只内置模型，记下来，按它的特性登记', async () => {
    const gguf = path.join(root, 'base-bf16.gguf');
    const config = '{"tts_model_type":"base"}';
    await fs.writeFile(
      gguf,
      ggufBytes([
        ['general.name', 'root'],
        ['audiocpp.embedded_files.names', { strings: ['config.json'] }],
        ['audiocpp.embedded_files.offsets', { u64: [0, config.length] }],
        ['audiocpp.embedded_files.data', { bytes: Buffer.from(config) }],
      ]),
    );
    const catalog = catalogOf();
    const id = await open(catalog).add({ source: 'local-file', family: 'qwen3_tts', path: gguf });
    expect(JSON.parse(await fs.readFile(file, 'utf8')).entries[0]).toMatchObject({ bundleId: id, variant: 'qwen3_tts_1_7b_base_q8_0' });
    expect(catalog.definition(id)!.speech).toMatchObject({ presets: 'builtin-reference', engine: { file: 'base-bf16.gguf' } });
    // 重启后按记下的登记。
    const again = catalogOf();
    open(again);
    expect(again.definition(id)!.speech!.presets).toBe('builtin-reference');
  });

  it('本机文件：不是 GGUF 的拒绝', async () => {
    const fake = path.join(root, 'fake.gguf');
    await fs.writeFile(fake, 'not a gguf');
    const added = open(catalogOf());
    await expect(added.add({ source: 'local-file', family: 'qwen3_tts', path: fake })).rejects.toMatchObject({ code: 'MODEL_ADD_REFUSED' });
    await expect(added.add({ source: 'local-file', family: 'qwen3_tts', path: path.join(root, 'missing.gguf') })).rejects.toMatchObject({ code: 'MODEL_ADD_REFUSED' });
  });

  it('Hugging Face 上的文件：读出提交、大小与 sha256，按它下载；不是 LFS 的拒绝；读不到是 unreachable', async () => {
    const calls: string[] = [];
    const catalog = catalogOf();
    const added = open(catalog, fakeHub({ 'q/v-q8.gguf': { size: 1234, lfs: true }, 'small.gguf': { size: 10 } }, calls));
    const id = await added.add({ source: 'repo-file', family: 'qwen3_tts', address: 'https://huggingface.co/me/voices/blob/main/q/v-q8.gguf' });
    expect(calls[0]).toBe('https://hub.example/api/models/me/voices/revision/main');
    expect(calls[1]).toBe(`https://hub.example/api/models/me/voices/paths-info/${COMMIT}`);
    const status = (await catalog.status(id))!;
    expect(status).toMatchObject({ state: 'not-installed', label: 'v-q8', estimatedBytes: 1234, added: { kind: 'repo-file', source: 'me/voices/q/v-q8.gguf' } });
    expect(status.components![0]!.revision).toBe(COMMIT);
    await expect(added.add({ source: 'repo-file', family: 'qwen3_tts', address: 'me/voices/small.gguf' })).rejects.toMatchObject({ code: 'MODEL_ADD_REFUSED' });
    await expect(added.add({ source: 'repo-file', family: 'qwen3_tts', address: 'me/voices/none.gguf' })).rejects.toMatchObject({ code: 'MODEL_ADD_REFUSED' });
    const offline = open(catalogOf(), (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch);
    await expect(offline.add({ source: 'repo-file', family: 'qwen3_tts', address: 'me/voices/q/v-q8.gguf' })).rejects.toMatchObject({ kind: 'unreachable', code: 'MODEL_ADD_UNREACHABLE' });
    await added.unlist(id);
    expect(await catalog.status(id)).toBeNull();
  });

  it('内置的模型包不能移出列表；记录文件坏了按空记录', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{broken');
    const catalog = catalogOf();
    const added = open(catalog);
    await expect(added.unlist('yue2-3b@audio-cpp-q8')).rejects.toMatchObject({ code: 'MODEL_ADD_REFUSED' });
    expect(catalog.definitions().some((d) => catalog.addedInfo(d.bundleId))).toBe(false);
  });
});
