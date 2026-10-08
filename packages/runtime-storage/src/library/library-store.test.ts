import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RpcError, type LibraryEvent, type TranscriptionGlossary } from '@baocut/protocol';
import { composeTranscribeHint } from './glossary-hint.ts';
import { formatInvalid } from './library-errors.ts';
import { LibraryStore } from './library-store.ts';
import { storedZip } from '../testing/index.ts';
import { extensionOf, isDotLottie, sniffBytes } from './media-sniff.ts';
import { assertVoiceUploadAllowed, resolveVoiceClone } from './voice-access.ts';

/** 最小的 PNG 文件头：库只按文件头认类型，品牌图片不做解码校验。 */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
/** 只有文件头的 WAV：测试里的解码校验是假的，只看文件头。 */
const wav = (fill: number) => Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVEfmt ', 'latin1'), Buffer.alloc(64, fill)]);

const glossary: TranscriptionGlossary = {
  name: '产品术语',
  kind: 'transcription',
  language: 'zh',
  defaultEnabled: true,
  terms: [{ canonical: 'BaoCut', misheard: ['宝卡特', '包 cut'] }],
};

async function rejection(promise: Promise<unknown> | (() => unknown)): Promise<RpcError> {
  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (error) {
    if (error instanceof RpcError) return error;
    throw error;
  }
  throw new Error('应该被拒绝');
}

const codeOf = (error: RpcError) => (error.details as { code?: string } | undefined)?.code;

describe('用户库的存储', () => {
  let dir: string;
  let events: LibraryEvent[];
  let store: LibraryStore;
  let fixtures: string;

  const open = () =>
    LibraryStore.open({
      dir: path.join(dir, 'library'),
      onEvent: (event) => events.push(event),
      validateAudio: async (_file, mediaType) => {
        if (mediaType !== 'audio/wav') throw formatInvalid('假的解码校验只认 wav');
      },
    });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-library-'));
    fixtures = path.join(dir, 'fixtures');
    await fs.mkdir(fixtures);
    events = [];
    store = await open();
  });

  afterEach(async () => {
    await store.idle();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('术语表：新建、不变不出新版本、修改出新版本、乐观并发、删除', async () => {
    const created = await store.put({ library: 'glossaries', content: glossary });
    expect(created).toMatchObject({ created: true, changed: true, entry: { library: 'glossaries', version: 1 } });
    expect(created.entry.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const id = created.entry.id;

    const same = await store.put({
      library: 'glossaries',
      id,
      content: { ...glossary, terms: [{ canonical: ' BaoCut ', misheard: ['宝卡特', '包 cut', '宝卡特'] }] },
    });
    expect(same).toMatchObject({ created: false, changed: false, entry: { version: 1, contentHash: created.entry.contentHash } });

    const changed = await store.put({ library: 'glossaries', id, expectedVersion: 1, content: { ...glossary, defaultEnabled: false } });
    expect(changed.entry.version).toBe(2);
    expect(changed.entry.contentHash).not.toBe(created.entry.contentHash);

    const stale = await rejection(store.put({ library: 'glossaries', id, expectedVersion: 1, content: glossary }));
    expect(stale.code).toBe('conflict');
    expect(codeOf(stale)).toBe('LIBRARY_VERSION_CONFLICT');

    // 没被固定的旧版本已经清掉。
    expect((await rejection(() => store.get({ library: 'glossaries', id, version: 1 }))).code).toBe('not-found');
    expect(store.list('glossaries')).toEqual([
      expect.objectContaining({ id, version: 2, name: '产品术语', kind: 'transcription', termCount: 1, defaultEnabled: false }),
    ]);

    const dup = await rejection(
      store.put({ library: 'glossaries', content: { ...glossary, terms: [...glossary.terms, { canonical: 'BaoCut', misheard: [] }] } }),
    );
    expect(codeOf(dup)).toBe('LIBRARY_FORMAT_INVALID');

    await store.remove('glossaries', id);
    expect((await rejection(() => store.get({ library: 'glossaries', id }))).code).toBe('not-found');
    expect(store.list()).toEqual([]);
    await expect(fs.stat(path.join(dir, 'library', 'glossaries', id))).rejects.toThrow();
    expect(events.map((e) => e.type)).toEqual(['entry.upsert', 'entry.upsert', 'entry.removed']);
  });

  it('翻译用术语表要有目标语言', async () => {
    const entry = await store.put({
      library: 'glossaries',
      content: {
        name: '中译英',
        kind: 'translation',
        sourceLanguage: 'zh',
        targetLanguage: 'en',
        defaultEnabled: false,
        terms: [{ source: '剪辑', target: 'edit', note: '' }],
      },
    });
    expect(entry.entry.content).toMatchObject({ terms: [{ source: '剪辑', target: 'edit', note: null }] });
    const bad = await rejection(
      store.put({
        library: 'glossaries',
        content: { name: 'x', kind: 'translation', sourceLanguage: null, targetLanguage: '', defaultEnabled: false, terms: [] },
      }),
    );
    expect(codeOf(bad)).toBe('LIBRARY_FORMAT_INVALID');
  });

  it('品牌库：图片按内容认类型并按摘要存放，颜色与字幕样式，叠加模板被拒绝', async () => {
    const source = path.join(fixtures, 'logo.dat');
    await fs.writeFile(source, PNG);
    const image = await store.put({ library: 'brand', content: { name: '标志', kind: 'image' }, file: { path: source } });
    const file = store.fileOf(image.entry)!;
    expect(file).toMatchObject({ mediaType: 'image/png', byteLength: PNG.length, fileName: 'logo.dat' });
    const stored = store.filePath(image.entry, file);
    expect(path.basename(stored)).toBe(`${file.sha256.slice('sha256:'.length)}.png`);
    expect(await fs.readFile(stored)).toEqual(PNG);

    // 只改名字：沿用文件，出新版本。
    const renamed = await store.put({ library: 'brand', id: image.entry.id, content: { name: '新标志', kind: 'image' } });
    expect(renamed.entry).toMatchObject({ version: 2, content: { name: '新标志', file } });
    // PNG 不能当字体。
    expect(codeOf(await rejection(store.put({ library: 'brand', id: image.entry.id, content: { name: 'x', kind: 'font' } })))).toBe(
      'LIBRARY_FORMAT_INVALID',
    );
    // 新的图片要给文件。
    expect(codeOf(await rejection(store.put({ library: 'brand', content: { name: 'x', kind: 'image' } })))).toBe('LIBRARY_FORMAT_INVALID');
    // 认不出的文件不收，也不留下半个条目。
    await fs.writeFile(path.join(fixtures, 'junk.png'), 'not an image');
    expect(
      codeOf(
        await rejection(
          store.put({ library: 'brand', content: { name: 'x', kind: 'image' }, file: { path: path.join(fixtures, 'junk.png') } }),
        ),
      ),
    ).toBe('LIBRARY_FORMAT_INVALID');
    expect(await fs.readdir(path.join(dir, 'library', 'brand'))).toEqual([image.entry.id]);

    const color = await store.put({ library: 'brand', content: { name: '主色', kind: 'color', value: '#ff6600' } });
    expect(color.entry.content).toEqual({ name: '主色', kind: 'color', value: '#FF6600' });
    const style = await store.put({
      library: 'brand',
      content: { name: '大字幕', kind: 'captionStyle', style: { schema: 'baocut.studio-style/1', style: { fontSize: 64 } } },
    });
    expect(style.entry.content).toMatchObject({ kind: 'captionStyle', style: { schema: 'baocut.studio-style/1' } });
    expect(
      codeOf(
        await rejection(store.put({ library: 'brand', content: { name: 'x', kind: 'captionStyle', style: { fontSize: 1 } as never } })),
      ),
    ).toBe('LIBRARY_FORMAT_INVALID');

    const reserved = await rejection(store.put({ library: 'brand', content: { name: '片头', kind: 'overlayTemplate', template: {} } }));
    expect(reserved.code).toBe('invalid-request');
    expect(codeOf(reserved)).toBe('LIBRARY_KIND_RESERVED');
    expect(reserved.message).toContain('§14');

    expect(store.list('brand').map((s) => s.kind)).toEqual(expect.arrayContaining(['image', 'color', 'captionStyle']));
    expect(store.list('brand', 'color')).toHaveLength(1);
  });

  it('音色：授权声明、参考录音变了克隆转为 stale、库音色的解析', async () => {
    const ref = path.join(fixtures, 'ref.bin');
    await fs.writeFile(ref, wav(1));
    // 新的音色要给参考录音。
    const content = { name: '我的声音', language: 'zh-CN', transcript: '你好', origin: 'recorded' as const, consent: { declared: false } };
    expect(codeOf(await rejection(store.put({ library: 'voices', content })))).toBe('LIBRARY_FORMAT_INVALID');
    // 解码校验不过的不收。
    await fs.writeFile(path.join(fixtures, 'ref.flac'), Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(32)]));
    expect(codeOf(await rejection(store.put({ library: 'voices', content, file: { path: path.join(fixtures, 'ref.flac') } })))).toBe(
      'LIBRARY_FORMAT_INVALID',
    );

    const voice = await store.put({ library: 'voices', content, file: { path: ref } });
    const id = voice.entry.id;
    expect(voice.entry.content).toMatchObject({
      consent: { declared: false, declaredAt: null, statement: null },
      reference: { mediaType: 'audio/wav' },
    });

    // 没有授权声明：不能上传（克隆），也不能用于合成。
    const noConsent = await rejection(() => assertVoiceUploadAllowed(store.get({ library: 'voices', id }), 'openai'));
    expect(noConsent.code).toBe('conflict');
    expect(codeOf(noConsent)).toBe('VOICE_CONSENT_REQUIRED');
    expect(codeOf(await rejection(store.recordClone(id, 'openai', 'v-1')))).toBe('VOICE_CONSENT_REQUIRED');

    const declared = await store.put({
      library: 'voices',
      id,
      content: { ...content, consent: { declared: true, statement: '这是我自己的声音' } },
    });
    expect(declared.entry.content.consent.declaredAt).not.toBeNull();
    expect(declared.entry.content.reference).toEqual(voice.entry.content.reference);

    // 没有克隆
    const missing = await rejection(() => resolveVoiceClone(store.get({ library: 'voices', id }), 'openai'));
    expect(codeOf(missing)).toBe('VOICE_CLONE_REQUIRED');
    expect(missing.details).toMatchObject({ reason: 'missing', providerId: 'openai' });
    // 有效的克隆
    await store.recordClone(id, 'openai', 'v-1');
    expect(resolveVoiceClone(store.get({ library: 'voices', id }), 'openai')).toMatchObject({
      voiceId: 'v-1',
      entry: { library: 'voices', id, version: 2 },
    });
    expect(store.list('voices')[0]).toMatchObject({ consentDeclared: true, clones: [{ providerId: 'openai', state: 'valid' }] });

    // 只改名字：克隆仍有效。换参考录音：克隆过期。
    await store.put({
      library: 'voices',
      id,
      content: { ...content, name: '新名字', consent: { declared: true, statement: '这是我自己的声音' } },
    });
    expect(store.get({ library: 'voices', id }).clones!.openai!.state).toBe('valid');
    const ref2 = path.join(fixtures, 'ref2.wav');
    await fs.writeFile(ref2, wav(2));
    await store.put({
      library: 'voices',
      id,
      content: { ...content, consent: { declared: true, statement: '这是我自己的声音' } },
      file: { path: ref2 },
    });
    expect(store.get({ library: 'voices', id }).clones!.openai!.state).toBe('stale');
    const stale = await rejection(() => resolveVoiceClone(store.get({ library: 'voices', id }), 'openai'));
    expect(codeOf(stale)).toBe('VOICE_CLONE_REQUIRED');
    expect(stale.details).toMatchObject({ reason: 'stale' });

    // 删除：克隆转为 stale，留下只有条目头的墓碑（等远端删除克隆）；重启后仍在、但不出现在列表里。
    await store.recordClone(id, 'google', 'g-1');
    await store.remove('voices', id);
    const header = JSON.parse(await fs.readFile(path.join(dir, 'library', 'voices', id, 'entry.json'), 'utf8'));
    expect(header).toMatchObject({
      removedAt: expect.any(String),
      versions: [],
      clones: { openai: { state: 'stale' }, google: { state: 'stale' } },
    });
    await expect(fs.stat(path.join(dir, 'library', 'voices', id, 'files'))).rejects.toThrow();
    await store.idle();
    store = await open();
    expect(store.list('voices')).toEqual([]);
    expect((await rejection(() => store.get({ library: 'voices', id }))).code).toBe('not-found');
  });

  it('固定的旧版本保留，解除固定后清掉；删除了的条目等固定解除再删', async () => {
    const source = path.join(fixtures, 'a.png');
    await fs.writeFile(source, PNG);
    const v1 = (await store.put({ library: 'brand', content: { name: 'a', kind: 'image' }, file: { path: source } })).entry;
    const v1File = store.filePath(v1, store.fileOf(v1)!);
    expect(store.pin('job-1', [{ library: 'brand', id: v1.id }])).toEqual([
      { library: 'brand', id: v1.id, version: 1, contentHash: v1.contentHash },
    ]);
    expect(store.pinCount({ library: 'brand', id: v1.id, version: 1 })).toBe(1);

    const other = path.join(fixtures, 'b.png');
    await fs.writeFile(other, Buffer.concat([PNG, Buffer.from('b')]));
    const v2 = (await store.put({ library: 'brand', id: v1.id, content: { name: 'a', kind: 'image' }, file: { path: other } })).entry;
    expect(v2.version).toBe(2);
    // 旧版本还在，文件也在。
    expect(store.get({ library: 'brand', id: v1.id, version: 1 }).contentHash).toBe(v1.contentHash);
    await expect(fs.stat(v1File)).resolves.toBeTruthy();

    await store.unpin('job-1');
    expect((await rejection(() => store.get({ library: 'brand', id: v1.id, version: 1 }))).code).toBe('not-found');
    await expect(fs.stat(v1File)).rejects.toThrow();
    await expect(fs.stat(path.join(dir, 'library', 'brand', v1.id, 'versions', '1.json'))).rejects.toThrow();
    expect(store.get({ library: 'brand', id: v1.id }).version).toBe(2);

    // 固定着的条目被删除：按版本还能读到，解除后目录删掉。
    store.pin('job-2', [{ library: 'brand', id: v1.id }]);
    await store.remove('brand', v1.id);
    expect(store.list()).toEqual([]);
    expect(store.get({ library: 'brand', id: v1.id, version: 2 }).version).toBe(2);
    await store.unpin('job-2');
    await expect(fs.stat(path.join(dir, 'library', 'brand', v1.id))).rejects.toThrow();
  });

  it('重启之后数据还在；没写完的条目与没被引用的文件清掉', async () => {
    const g = (await store.put({ library: 'glossaries', content: glossary })).entry;
    await store.put({ library: 'glossaries', id: g.id, content: { ...glossary, name: '改名' } });
    store.pin('job', [{ library: 'glossaries', id: g.id }]);
    await store.put({ library: 'glossaries', id: g.id, content: { ...glossary, name: '再改' } });
    await store.idle();
    // 没写完的新条目（没有条目头）与残留的临时文件
    await fs.mkdir(path.join(dir, 'library', 'brand', 'brd_partial', 'files'), { recursive: true });
    await fs.writeFile(path.join(dir, 'library', 'glossaries', g.id, 'versions', 'stray.tmp'), '');

    store = await open();
    expect(store.list()).toEqual([expect.objectContaining({ id: g.id, version: 3, name: '再改' })]);
    // 固定只在内存里：重启后旧版本清掉。
    expect(await fs.readdir(path.join(dir, 'library', 'glossaries', g.id, 'versions'))).toEqual(['3.json']);
    await expect(fs.stat(path.join(dir, 'library', 'brand', 'brd_partial'))).rejects.toThrow();
  });

  it('识别提示：用户提示在前，规范写法去重后接上，放不下的计数', () => {
    const terms = (names: string[]): TranscriptionGlossary => ({
      ...glossary,
      terms: names.map((canonical) => ({ canonical, misheard: [] })),
    });
    expect(composeTranscribeHint('访谈', [terms(['BaoCut', 'Rust']), terms(['Rust', 'Tauri'])])).toEqual({
      hint: '访谈\nBaoCut、Rust、Tauri',
      terms: 3,
      dropped: 0,
    });
    expect(composeTranscribeHint(undefined, [terms(['甲甲', '乙乙', '丙丙'])], 5)).toEqual({ hint: '甲甲、乙乙', terms: 2, dropped: 1 });
    expect(composeTranscribeHint(undefined, [])).toEqual({ hint: undefined, terms: 0, dropped: 0 });
  });

  it('文件头识别', () => {
    expect(sniffBytes(PNG)?.mediaType).toBe('image/png');
    expect(sniffBytes(wav(0))?.mediaType).toBe('audio/wav');
    expect(sniffBytes(Buffer.from('wOF2xxxx'))?.mediaType).toBe('font/woff2');
    expect(sniffBytes(Buffer.from('\0\0\0\x18ftypisom', 'latin1'))?.mediaType).toBe('video/mp4');
    expect(sniffBytes(Buffer.from('\0\0\0\x18ftypM4A ', 'latin1'))?.mediaType).toBe('audio/mp4');
    expect(sniffBytes(Buffer.from('# hello'))).toBeNull();
  });

  it('`.lottie` 压缩包：中央目录里有 animations/*.json（或第 2 版的 a/*.json）才算', () => {
    expect(
      isDotLottie(
        storedZip([
          ['manifest.json', '{}'],
          ['animations/wave.json', '{}'],
        ]),
      ),
    ).toBe(true);
    expect(isDotLottie(storedZip([['a/wave.json', '{}']]))).toBe(true);
    expect(
      isDotLottie(
        storedZip([
          ['manifest.json', '{}'],
          ['images/a.png', 'x'],
        ]),
      ),
    ).toBe(false);
    expect(isDotLottie(storedZip([['animations/deep/wave.json', '{}']]))).toBe(false);
    expect(isDotLottie(Buffer.from('PK\x03\x04 truncated', 'latin1'))).toBe(false);
    expect(extensionOf('application/zip')).toBe('lottie');
  });
});
