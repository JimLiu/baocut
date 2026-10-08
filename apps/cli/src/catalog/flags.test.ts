import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CliError, EXIT, exitCodeFor } from '../envelope.ts';
import { buildTree, lookup, type CatalogCommand } from './command-tree.ts';
import { defaultGlobals, extractGlobals, kebab, parseToolArgs, type GlobalFlags, type InputSource } from './flags.ts';
import { loadSnapshot } from './snapshot.ts';

/** 旗标派生（Agent 面设计 §5.3），按构建期快照（vitest 的 globalSetup 先写好）里的真实 schema 测。 */

const snapshot = loadSnapshot();
if (!snapshot) throw new Error('没有目录快照：先运行 npm run build:catalog');
const tree = buildTree(snapshot.tools);

function command(...words: string[]): CatalogCommand {
  const found = lookup(tree, words);
  if (found.kind !== 'command') throw new Error(`没有命令 ${words.join(' ')}`);
  return found.command;
}

function input(files: Record<string, string> = {}, stdin = ''): InputSource & { stdinReads: number } {
  const source = {
    cwd: '/work',
    stdinReads: 0,
    readFile: async (file: string) => {
      if (!(file in files)) throw new Error(`ENOENT: ${file}`);
      return files[file]!;
    },
    readStdin: async () => {
      source.stdinReads++;
      return stdin;
    },
  };
  return source;
}

async function parse(words: string[], argv: string[], options: { globals?: Partial<GlobalFlags>; source?: InputSource } = {}) {
  return parseToolArgs(command(...words), argv, { ...defaultGlobals(), ...options.globals }, options.source ?? input());
}

async function rejection(promise: Promise<unknown>): Promise<CliError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!(error instanceof CliError)) throw new Error(`期望 CliError，得到 ${String(error)}`);
  return error;
}

describe('旗标派生', () => {
  it('camelCase → --kebab-case', () => {
    expect(kebab('documentId')).toBe('document-id');
    expect(kebab('layoutProfileId')).toBe('layout-profile-id');
    expect(kebab('video')).toBe('video');
  });

  it('快捷开关：transcribe --replace 即 --target replace，与那个字段的旗标二选一；派生的 --accept-edited、--name 照常', async () => {
    expect(await parse(['transcribe'], ['demo', '--replace', '--discard-translations', '--accept-edited'])).toEqual({
      video: 'demo',
      target: 'replace',
      translations: 'discard',
      acceptEdited: true,
    });
    expect(await parse(['transcribe'], ['demo', '--name', '第二版'])).toEqual({ video: 'demo', name: '第二版' });
    expect((await rejection(parse(['transcribe'], ['demo', '--replace', '--target', 'replace']))).code).toBe('INVALID_ARGUMENTS');
    expect((await rejection(parse(['transcribe'], ['demo', '--replace=yes']))).code).toBe('INVALID_ARGUMENTS');
  });

  it('位置参数与同名旗标都行，但只能给一个', async () => {
    expect(await parse(['videos', 'inspect'], ['demo'])).toEqual({ video: 'demo' });
    expect(await parse(['videos', 'inspect'], ['--video', 'demo', '--from-seconds', '1.5'])).toEqual({ video: 'demo', fromSeconds: 1.5 });
    expect(await parse(['videos', 'inspect'], ['--video=demo'])).toEqual({ video: 'demo' });
    const both = await rejection(parse(['videos', 'inspect'], ['demo', '--video', 'demo']));
    expect(both.code).toBe('INVALID_ARGUMENTS');
    expect((await rejection(parse(['videos', 'inspect'], ['a', 'b']))).code).toBe('INVALID_ARGUMENTS');
    expect((await rejection(parse(['videos', 'list'], ['extra']))).code).toBe('INVALID_ARGUMENTS');
  });

  it('不认识的旗标、缺值、类型不对都是 INVALID_ARGUMENTS，退出码 4', async () => {
    const unknown = await rejection(parse(['videos', 'inspect'], ['demo', '--bogus']));
    expect(unknown.code).toBe('INVALID_ARGUMENTS');
    expect(unknown.extra.flag).toBe('--bogus');
    expect(exitCodeFor(unknown.code)).toBe(EXIT.invalidArguments);
    expect((await rejection(parse(['videos', 'inspect'], ['demo', '--limit']))).code).toBe('INVALID_ARGUMENTS');
    expect((await rejection(parse(['videos', 'inspect'], ['demo', '--limit', '1.5']))).message).toContain('--limit');
    expect((await rejection(parse(['videos', 'inspect'], ['demo', '--from-seconds', 'abc']))).code).toBe('INVALID_ARGUMENTS');
    expect((await rejection(parse(['videos', 'frames'], ['demo', '--format', 'gif']))).code).toBe('INVALID_ARGUMENTS');
    expect((await rejection(parse(['videos', 'inspect'], ['demo', '--limit', '1', '--limit', '2']))).code).toBe('INVALID_ARGUMENTS');
  });

  it('缺必填参数时按旗标名说明', async () => {
    const missing = await rejection(parse(['documents', 'read'], ['demo']));
    expect(missing.code).toBe('INVALID_ARGUMENTS');
    expect(missing.extra.missing).toEqual(['--document-id']);
    expect((await rejection(parse(['videos', 'inspect'], []))).message).toContain('<video>');
  });

  it('布尔是开关，--no-x 给 false；字段名以 no 开头的按字段名匹配', async () => {
    expect(await parse(['captions', 'create'], ['demo', '--document-id', 'd1', '--bilingual'])).toEqual({
      video: 'demo',
      documentId: 'd1',
      bilingual: true,
    });
    expect(await parse(['captions', 'create'], ['demo', '--document-id', 'd1', '--no-bilingual'])).toEqual({
      video: 'demo',
      documentId: 'd1',
      bilingual: false,
    });
    expect(await parse(['captions', 'create'], ['demo', '--document-id', 'd1', '--bilingual=false'])).toMatchObject({ bilingual: false });
    expect(await parse(['transcribe'], ['--file', 'a.mp4', '--no-video', '--no-captions'])).toEqual({
      file: 'a.mp4',
      noVideo: true,
      noCaptions: true,
    });
    expect(await parse(['transcribe'], ['--file', 'a.mp4', '--diarize'])).toMatchObject({ diarize: true });
    // 既能是布尔又能是对象的：开关，或 --x=<JSON>。
    expect(await parse(['export'], ['demo', '--kind', 'subtitles', '--format', 'srt', '--bilingual'])).toMatchObject({ bilingual: true });
    expect(await parse(['export'], ['demo', '--kind', 'subtitles', '--format', 'srt', '--bilingual={"language":"en"}'])).toMatchObject({
      bilingual: { language: 'en' },
    });
  });

  it('数组可重复，也可以给 JSON 数组；枚举与固定格式的元素可以逗号分隔', async () => {
    expect(await parse(['videos', 'frames'], ['demo', '--at', '1', '--at', '2.5'])).toEqual({ video: 'demo', at: ['1', '2.5'] });
    expect(await parse(['videos', 'frames'], ['demo', '--at', '1,2.5,4'])).toEqual({ video: 'demo', at: ['1', '2.5', '4'] });
    expect(await parse(['videos', 'frames'], ['demo', '--at', '["3"]'])).toEqual({ video: 'demo', at: ['3'] });
    expect(await parse(['space', 'search'], ['词', '--kinds', 'caption,translation'])).toMatchObject({
      query: '词',
      kinds: ['caption', 'translation'],
    });
    // 没有固定格式的文本元素不按逗号切：文件名里可以有逗号。
    expect(await parse(['transcode'], ['a,b.mp4', 'c.mp4', '--merge'])).toEqual({ files: ['a,b.mp4', 'c.mp4'], merge: true });
    expect(await parse(['transcode'], ['--files', 'a.mp4', '--files', 'b.mp4'])).toEqual({ files: ['a.mp4', 'b.mp4'] });
    expect((await rejection(parse(['transcode'], ['a.mp4', '--files', 'b.mp4']))).code).toBe('INVALID_ARGUMENTS');
  });

  it('对象与对象数组：JSON 字面量、@文件、-（stdin）；范围写 a:b，帧率写 n/d', async () => {
    const ops = [{ type: 'renameVideo', name: '新名字' }];
    const source = input({ 'ops.json': JSON.stringify(ops) });
    expect(
      await parse(['edits', 'apply'], ['demo', '--expected-revision', 'r1', '--label', '改名', '--operations', '@ops.json'], { source }),
    ).toEqual({
      video: 'demo',
      expectedRevision: 'r1',
      label: '改名',
      operations: ops,
    });
    expect(
      await parse(
        ['translate'],
        [
          '--file',
          'a.srt',
          '--to',
          'en',
          '--glossary',
          '{"source":"宝玉","target":"Baoyu"}',
          '--glossary',
          '{"source":"剪辑","target":"edit"}',
        ],
      ),
    ).toMatchObject({
      glossary: [
        { source: '宝玉', target: 'Baoyu' },
        { source: '剪辑', target: 'edit' },
      ],
    });

    const stdin = input({}, '{"segments":[]}');
    expect(await parse(['documents', 'put'], ['demo', '--body', '-'], { source: stdin })).toEqual({
      video: 'demo',
      body: { segments: [] },
    });
    expect(stdin.stdinReads).toBe(1);
    expect((await rejection(parse(['documents', 'put'], ['demo', '--body', '{oops']))).code).toBe('INVALID_ARGUMENTS');
    expect((await rejection(parse(['documents', 'put'], ['demo', '--body', '@missing.json']))).code).toBe('INVALID_ARGUMENTS');

    const exported = await parse(['export'], ['demo', '--kind', 'video', '--format', 'mp4', '--range', '1.5:10', '--fps', '30000/1001']);
    expect(exported).toMatchObject({ range: { start: 1.5, end: 10 }, fps: { num: 30000, den: 1001 } });
    // 只有一个文本字段的对象直接写值；写 JSON 也行。
    const replaced = await parse(['compositions', 'import'], ['demo', '--path', 'g/2', '--replace', 'item_1']);
    expect(replaced).toEqual({ video: 'demo', path: 'g/2', replace: { itemId: 'item_1' } });
    const json = await parse(['compositions', 'import'], ['demo', '--path', 'g/2', '--replace', '{"itemId":"item_2"}']);
    expect(json).toMatchObject({ replace: { itemId: 'item_2' } });
    expect(
      await parse(
        ['export'],
        ['demo', '--kind', 'audio', '--format', 'wav', '--ranges', '0:1', '--ranges', '2:3', '--sample-rate', '44100'],
      ),
    ).toMatchObject({
      ranges: [
        { start: 0, end: 1 },
        { start: 2, end: 3 },
      ],
      sampleRate: 44100,
    });
    expect((await rejection(parse(['export'], ['demo', '--kind', 'audio', '--format', 'wav', '--sample-rate', '12345']))).code).toBe(
      'INVALID_ARGUMENTS',
    );
  });

  it('自由文本接受 @文件 与 -；stdin 只读一次；@@ 写字面的 @', async () => {
    const source = input({ 'line.txt': '你好' }, '来自 stdin');
    expect(await parse(['speak'], ['@line.txt'], { source })).toEqual({ text: '你好' });
    expect(await parse(['speak'], ['--text', '-'], { source })).toEqual({ text: '来自 stdin' });
    expect(await parse(['speak'], ['@@handle'])).toEqual({ text: '@handle' });
    const twice = input({}, '{}');
    expect((await rejection(parse(['documents', 'put'], ['demo', '--body', '-', '--name', '-'], { source: twice }))).code).toBe(
      'INVALID_ARGUMENTS',
    );
  });

  it('--dry-run 只给有 dryRun 字段的命令；--project 也交给有 project 字段的工具', async () => {
    const apply = ['demo', '--expected-revision', 'r1', '--label', 'x', '--operations', '[]'];
    expect(await parse(['edits', 'apply'], apply, { globals: { dryRun: true } })).toMatchObject({ dryRun: true });
    expect((await rejection(parse(['videos', 'inspect'], ['demo'], { globals: { dryRun: true } }))).code).toBe('INVALID_ARGUMENTS');
    expect(await parse(['videos', 'create'], ['样片'], { globals: { project: 'proj_1' } })).toEqual({ name: '样片', project: 'proj_1' });
    expect(await parse(['videos', 'create'], ['样片'], { globals: { project: path.parse(process.cwd()).root } })).toEqual({
      name: '样片',
      project: path.parse(process.cwd()).root,
    });
    expect(await parse(['videos', 'inspect'], ['demo'], { globals: { project: 'proj_1' } })).toEqual({ video: 'demo' });
  });
});

describe('CLI 自己的旗标', () => {
  it('出现在哪里都行，其余原样留下', () => {
    const { globals, rest } = extractGlobals([
      '--json',
      'videos',
      'inspect',
      'demo',
      '--project',
      'p',
      '--yes',
      '--no-wait',
      '--timeout=30',
      '--progress',
      'jsonl',
      '--max-bytes',
      '1024',
      '--result-file',
      'o.json',
      '--no-start',
      '--dry-run',
      '--limit',
      '3',
    ]);
    expect(rest).toEqual(['videos', 'inspect', 'demo', '--limit', '3']);
    expect(globals).toEqual({
      json: true,
      project: 'p',
      yes: true,
      wait: false,
      timeout: 30,
      progress: 'jsonl',
      maxBytes: 1024,
      resultFile: 'o.json',
      noStart: true,
      dryRun: true,
      help: false,
    });
    expect(extractGlobals(['-h']).globals.help).toBe(true);
    expect(extractGlobals(['speak', '--', '--json']).rest).toEqual(['speak', '--', '--json']);
  });

  it('取值不对时 INVALID_ARGUMENTS', () => {
    expect(() => extractGlobals(['--timeout', 'soon'])).toThrow(CliError);
    expect(() => extractGlobals(['--progress', 'bars'])).toThrow(CliError);
    expect(() => extractGlobals(['--max-bytes'])).toThrow(CliError);
    expect(() => extractGlobals(['--yes=no'])).toThrow(CliError);
  });
});
