import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RpcError, type GlossaryContent, type LibraryEntry } from '@baocut/protocol';
import { storedZip } from '../testing/index.ts';
import { decodeGlossaryMarkdown, encodeGlossaryMarkdown } from './glossary-markdown.ts';
import { readLibraryImport, writeLibraryExport } from './library-exchange.ts';
import { formatInvalid } from './library-errors.ts';
import { LibraryStore } from './library-store.ts';
import { decodeVoicePackage } from './voice-package.ts';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const WAV = Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVEfmt ', 'latin1'), Buffer.alloc(64, 3)]);

const transcription: GlossaryContent = {
  name: '产品 | 术语 "一"',
  kind: 'transcription',
  language: 'zh',
  defaultEnabled: true,
  terms: [
    { canonical: 'BaoCut', misheard: ['宝卡特', '包, cut', '包、卡'] },
    { canonical: 'A|B\\C', misheard: [] },
  ],
};
const translation: GlossaryContent = {
  name: '中译英',
  kind: 'translation',
  sourceLanguage: null,
  targetLanguage: 'en',
  defaultEnabled: false,
  terms: [
    { source: '剪辑', target: 'edit', note: '动词 | 名词' },
    { source: '成片', target: 'final cut', note: null },
  ],
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

describe('术语表的 Markdown', () => {
  it('两种术语表往返不变（含转义）', () => {
    for (const content of [transcription, translation]) {
      const text = encodeGlossaryMarkdown(content);
      expect(text.startsWith('---\nformat: baocut.glossary\nversion: 1\n')).toBe(true);
      expect(decodeGlossaryMarkdown(text)).toEqual(content);
    }
    expect(encodeGlossaryMarkdown(transcription)).toContain('| BaoCut | 宝卡特, 包\\, cut, 包\\、卡 |');
  });

  it('手写的文件：表头大小写、表格前的标题、全角分隔符', () => {
    const text = [
      '---',
      'format: baocut.glossary',
      'version: 1',
      'kind: transcription',
      'default: false',
      '---',
      '',
      '# 我的术语',
      '',
      '| term | MISHEARD |',
      '|:---|---:|',
      '| 宝玉 | 宝余，包玉 |',
      '| Rust | |',
    ].join('\r\n');
    expect(decodeGlossaryMarkdown(text, '文件名')).toEqual({
      name: '文件名',
      kind: 'transcription',
      language: null,
      defaultEnabled: false,
      terms: [
        { canonical: '宝玉', misheard: ['宝余', '包玉'] },
        { canonical: 'Rust', misheard: [] },
      ],
    });
  });

  it.each([
    ['没有 front matter', '| Term | Misheard |\n| --- | --- |\n| a | b |\n'],
    ['没有格式标识', '---\nkind: transcription\n---\n| Term | Misheard |\n| --- | --- |\n'],
    ['更高的版本', '---\nformat: baocut.glossary\nversion: 2\nkind: transcription\n---\n| Term | Misheard |\n| --- | --- |\n'],
    ['未知的 kind', '---\nformat: baocut.glossary\nversion: 1\nkind: glossary\n---\n| Term | Misheard |\n| --- | --- |\n'],
    ['列不对', '---\nformat: baocut.glossary\nversion: 1\nkind: transcription\n---\n| Term | Misheard | Note |\n| --- | --- | --- |\n'],
    ['种类与列不符', '---\nformat: baocut.glossary\nversion: 1\nkind: translation\ntarget: en\n---\n| Term | Misheard |\n| --- | --- |\n'],
    [
      '行的列数不对',
      '---\nformat: baocut.glossary\nversion: 1\nkind: transcription\n---\n| Term | Misheard |\n| --- | --- |\n| a | b | c |\n',
    ],
    ['没有分隔行', '---\nformat: baocut.glossary\nversion: 1\nkind: transcription\n---\n| Term | Misheard |\n| a | b |\n'],
    ['空的规范写法', '---\nformat: baocut.glossary\nversion: 1\nkind: transcription\n---\n| Term | Misheard |\n| --- | --- |\n|  | b |\n'],
    ['没有表格', '---\nformat: baocut.glossary\nversion: 1\nkind: transcription\nname: x\n---\n只有说明\n'],
    [
      '两张表格',
      '---\nformat: baocut.glossary\nversion: 1\nkind: transcription\nname: x\n---\n| Term | Misheard |\n| --- | --- |\n\n| Term | Misheard |\n| --- | --- |\n',
    ],
    [
      '翻译没有目标语言',
      '---\nformat: baocut.glossary\nversion: 1\nkind: translation\nname: x\n---\n| Source | Target | Note |\n| --- | --- | --- |\n',
    ],
  ])('拒绝坏文件：%s', async (_label, text) => {
    const error = await rejection(() => decodeGlossaryMarkdown(text, 'x'));
    expect(error.code).toBe('invalid-request');
    expect(codeOf(error)).toBe('LIBRARY_FORMAT_INVALID');
  });
});

describe('交换文件的导入与导出', () => {
  let dir: string;
  let store: LibraryStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-library-exchange-'));
    store = await LibraryStore.open({
      dir: path.join(dir, 'library'),
      validateAudio: async (_file, mediaType) => {
        if (mediaType !== 'audio/wav') throw formatInvalid('假的解码校验只认 wav');
      },
    });
  });

  afterEach(async () => {
    await store.idle();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const importFile = async (name: string, data: string | Buffer): Promise<LibraryEntry> => {
    const file = path.join(dir, name);
    await fs.writeFile(file, data);
    const candidate = await readLibraryImport(file);
    return (
      await store.put({
        library: candidate.library,
        content: candidate.content,
        ...(candidate.file ? { file: candidate.file } : {}),
        ...(candidate.consentDeclaredAt !== undefined ? { consentDeclaredAt: candidate.consentDeclaredAt } : {}),
      })
    ).entry;
  };

  it('按内容识别，不看扩展名', async () => {
    // 术语表放在 .png 里，图片放在 .md 里。
    const glossary = await importFile('terms.png', encodeGlossaryMarkdown(translation));
    expect(glossary).toMatchObject({ library: 'glossaries', content: translation });
    const image = await importFile('logo.md', PNG);
    expect(image).toMatchObject({ library: 'brand', content: { name: 'logo', kind: 'image', file: { mediaType: 'image/png' } } });
    const lottie = await importFile('wave.txt', JSON.stringify({ v: '5.7.0', fr: 30, ip: 0, op: 60, w: 100, h: 100, layers: [] }));
    expect(lottie).toMatchObject({ library: 'brand', content: { kind: 'sticker', file: { mediaType: 'application/json' } } });
    const archive = storedZip([
      ['animations/wave.json', JSON.stringify({ v: '5.7.0', fr: 30, ip: 0, op: 60, w: 100, h: 100, layers: [] })],
    ]);
    const dotLottie = await importFile('wave.zip', archive);
    expect(dotLottie).toMatchObject({ library: 'brand', content: { kind: 'sticker', file: { mediaType: 'application/zip' } } });
    const font = await importFile('font.bin', Buffer.concat([Buffer.from('OTTO'), Buffer.alloc(32)]));
    expect(font).toMatchObject({ content: { kind: 'font', file: { mediaType: 'font/otf' } } });
  });

  it.each([
    ['空文件', ''],
    ['普通文本', '# 只是一篇 Markdown\n'],
    ['不认识的 JSON', '{"hello": 1}'],
    ['坏 JSON', '{"format": '],
    ['单独的音频', WAV],
    ['WOFF 字体', Buffer.concat([Buffer.from('wOFF'), Buffer.alloc(32)])],
    ['随机字节', Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9])],
    ['没有动画的 zip', storedZip([['notes.txt', 'hello']])],
  ])('拒绝认不出的文件：%s', async (_label, data) => {
    const file = path.join(dir, 'bad.glossary.md');
    await fs.writeFile(file, data);
    const error = await rejection(readLibraryImport(file));
    expect(codeOf(error)).toBe('LIBRARY_FORMAT_INVALID');
  });

  it('术语表与品牌条目导出后再导入，内容相同；目标存在时不覆盖', async () => {
    const g = (await store.put({ library: 'glossaries', content: transcription })).entry;
    const target = path.join(dir, 'out.md');
    expect(await writeLibraryExport(store, g, target)).toMatchObject({
      path: target,
      format: 'glossary-markdown',
      entry: { id: g.id, version: 1 },
    });
    const back = await importFile('copy-of-out', await fs.readFile(target));
    expect(back.contentHash).toBe(g.contentHash);
    expect((await rejection(writeLibraryExport(store, g, target))).code).toBe('conflict');
    expect((await rejection(writeLibraryExport(store, g, 'relative.md'))).code).toBe('invalid-request');

    const color = (await store.put({ library: 'brand', content: { name: '主色', kind: 'color', value: '#112233' } })).entry;
    const colorFile = path.join(dir, 'color.json');
    expect((await writeLibraryExport(store, color, colorFile)).format).toBe('library-item');
    expect((await importFile('color-copy', await fs.readFile(colorFile))).contentHash).toBe(color.contentHash);

    const image = await importFile('logo', PNG);
    const imageFile = path.join(dir, 'logo-out');
    expect(await writeLibraryExport(store, image, imageFile)).toMatchObject({ format: 'media', byteLength: PNG.length });
    expect(await fs.readFile(imageFile)).toEqual(PNG);
  });

  it('音色包：往返，摘要、长度与类型不符时拒绝', async () => {
    const ref = path.join(dir, 'ref');
    await fs.writeFile(ref, WAV);
    const voice = (
      await store.put({
        library: 'voices',
        content: { name: '声音', language: 'zh', transcript: '你好', origin: 'recorded', consent: { declared: true, statement: '本人' } },
        file: { path: ref, fileName: 'ref.wav' },
      })
    ).entry;
    await store.recordClone(voice.id, 'openai', 'v-1');
    const packageFile = path.join(dir, 'me.bcvoice');
    expect((await writeLibraryExport(store, voice, packageFile)).format).toBe('voice-package');
    const json = JSON.parse(await fs.readFile(packageFile, 'utf8'));
    expect(json).toMatchObject({ format: 'baocut.voice-package', version: 1, reference: { mediaType: 'audio/wav', fileName: 'ref.wav' } });
    // 克隆不导出。
    expect(JSON.stringify(json)).not.toContain('v-1');

    const back = await importFile('whatever.zip', await fs.readFile(packageFile));
    expect(back.library).toBe('voices');
    // 内容（含授权时间与参考录音的摘要）与原来的相同；克隆没有带过来。
    expect(back.contentHash).toBe(voice.contentHash);
    expect(back.clones).toEqual({});

    const tamper = (patch: (v: Record<string, any>) => void) => {
      const copy = structuredClone(json);
      patch(copy);
      return copy;
    };
    const bad = [
      tamper((v) => (v.reference.sha256 = `sha256:${'0'.repeat(64)}`)),
      tamper((v) => (v.reference.byteLength = 3)),
      tamper((v) => (v.reference.mediaType = 'audio/mpeg')),
      tamper((v) => (v.reference.data = Buffer.from('not audio at all').toString('base64'))),
      tamper((v) => (v.version = 2)),
      tamper((v) => delete v.consent),
      tamper((v) => (v.origin = 'stolen')),
    ];
    for (const value of bad) expect(codeOf(await rejection(() => decodeVoicePackage(value)))).toBe('LIBRARY_FORMAT_INVALID');
  });
});
