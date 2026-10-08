import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import { RpcError, SPACE_EXCERPT_MAX_BYTES, newId, type JobRecord, type Project, type SpaceThumbnail } from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import { resolveExportWorkerCommand } from '../exports/video-export.ts';
import { startRuntime, type RunningRuntime } from '../runtime.ts';
import { decodeText, excerptOf, subtitleDialogue } from './space-thumbnails.ts';

/**
 * Space 条目的缩略图（`space.thumbnail`）。文字摘要与字幕台词是纯函数；其余是端到端：真实的 engine-host 与 ffmpeg，
 * 视频的封面在视频关着时取（引擎的只读查询找素材文件），成片要 Render Worker。缺哪个跳过哪部分。
 */

describe('文字摘要', () => {
  it('UTF-8 去掉 BOM；带 BOM 的 UTF-16 也认；有 NUL 或不是 UTF-8 的不猜', () => {
    expect(decodeText(Buffer.from('﻿你好', 'utf8'), true)).toBe('你好');
    expect(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('字幕', 'utf16le')]), true)).toBe('字幕');
    const be = Buffer.from('ab', 'utf16le').swap16();
    expect(decodeText(Buffer.concat([Buffer.from([0xfe, 0xff]), be]), true)).toBe('ab');
    expect(decodeText(Buffer.from([0x61, 0x00, 0x62]), true)).toBeNull();
    expect(decodeText(Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20]), true)).toBeNull();
    // 读到一半截断的：末尾半个字符丢掉，不算解不开。
    const cut = Buffer.from('剪辑', 'utf8').subarray(0, 4);
    expect(decodeText(cut, false)).toBe('剪');
    expect(decodeText(cut, true)).toBeNull();
  });

  it('摘要统一换行、去掉首尾空白，截在字符边界上', () => {
    expect(excerptOf('  a\r\nb\rc  \n')).toBe('a\nb\nc');
    const long = '剪'.repeat(1000);
    const excerpt = excerptOf(long);
    expect(Buffer.byteLength(excerpt, 'utf8')).toBeLessThanOrEqual(SPACE_EXCERPT_MAX_BYTES);
    expect(excerpt).toBe('剪'.repeat(Math.floor(SPACE_EXCERPT_MAX_BYTES / 3)));
    // 四字节的字符：截断处的半个字符丢掉，不留替换符。
    expect(excerptOf(`x${'😀'.repeat(600)}`)).toBe(`x${'😀'.repeat(Math.floor((SPACE_EXCERPT_MAX_BYTES - 1) / 4))}`);
  });

  it('SRT 与 WebVTT 只留台词：序号、标识、时间码、头部、注释与标签都去掉', () => {
    const srt =
      '1\r\n00:00:01,000 --> 00:00:02,000\r\n<i>大家好</i>\r\n\r\n2\r\n00:00:02,500 --> 00:00:03,000\r\n{\\an8}今天讲剪辑\r\n第二行\r\n';
    expect(subtitleDialogue(srt, 'srt')).toBe('大家好\n今天讲剪辑\n第二行');
    const vtt = [
      'WEBVTT - 标题',
      '',
      'NOTE 这是注释',
      '它不止一行',
      '',
      'STYLE',
      '::cue { color: red }',
      '',
      'intro',
      '00:01.000 --> 00:02.000 align:start',
      '<v 宝玉>欢迎 &amp; 再见',
      '',
      '00:02.000 --> 00:03.000',
      '<c.yellow>Hello</c> <00:02.500>world',
    ].join('\n');
    expect(subtitleDialogue(vtt, 'vtt')).toBe('欢迎 & 再见\nHello world');
  });

  it('ASS / SSA 只取对白行的文字字段（按 Format 行找位置）', () => {
    const ass = [
      '[Script Info]',
      'Title: 测试',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize',
      'Style: Default,Arial,20',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Comment: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,不显示',
      'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\b1}你好，{\\i1}世界\\N第二行',
      'Dialogue: 0,0:00:02.00,0:00:03.00,Default,,0,0,0,,a\\hb, c',
    ].join('\n');
    expect(subtitleDialogue(ass, 'ass')).toBe('你好，世界\n第二行\na b, c');
  });
});

const engine = resolveEngineHostCommand();
const worker = resolveExportWorkerCommand(engine);
const ffmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
if (!engine || !ffmpeg) console.warn('跳过 Space 缩略图的端到端测试：没有构建 engine-host 或没有 ffmpeg');

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

describe.skipIf(!engine || !ffmpeg)('Space 缩略图（真实引擎 + ffmpeg）', () => {
  let fixtures: string;
  let clip: string;
  let dir: string;
  let runtime: RunningRuntime;
  let client: BaoCutClient;
  let project: Project;

  const ffmpegTo = (file: string, args: string[]) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, file]);

  beforeAll(async () => {
    fixtures = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-thumb-fixtures-'));
    clip = path.join(fixtures, 'clip.mp4');
    ffmpegTo(clip, [
      ...['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=2'],
      ...['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2'],
      ...['-c:v', 'mpeg4', '-c:a', 'aac', '-shortest'],
    ]);
  });

  afterAll(async () => {
    await fs.rm(fixtures, { recursive: true, force: true });
  });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-thumb-'));
    runtime = await startRuntime({
      home: resolveRuntimeHome({ BAOCUT_HOME: dir }),
      drivers: () => [],
      watchSpace: false,
      engineHost: engine,
      videoGraceMs: 100,
      modelWorker: null,
      initiator: { discoverer: null },
      nodes: { host: '127.0.0.1', advertiser: null },
    });
    const { endpoint, token } = runtime.discovery;
    client = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'desktop', name: 'test', version: '0' },
      reconnect: false,
    });
    await client.connect();
    ({ project } = await client.request('projects.create', { name: '缩略图测试' }));
  });

  afterEach(async () => {
    client.close();
    await runtime.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function settle() {
    await client.request('space.rescan', {});
    await runtime.space.idle();
  }

  async function entryOf(fileName: string) {
    const { entries } = await client.request('space.list', {});
    const entry = entries.find((e) => e.fileName === fileName);
    if (!entry) throw new Error(`Space 里没有 ${fileName}：${entries.map((e) => e.fileName).join('、')}`);
    return entry;
  }

  const thumbnail = async (fileName: string) => client.request('space.thumbnail', { entryId: (await entryOf(fileName)).id });

  function expectImage(result: SpaceThumbnail, mimeType: string, width: number, height: number) {
    expect(result).toMatchObject({ kind: 'image', mimeType, width, height });
    const bytes = Buffer.from((result as Extract<SpaceThumbnail, { kind: 'image' }>).data, 'base64');
    expect(bytes.subarray(0, 2)).toEqual(mimeType === 'image/png' ? Buffer.from([0x89, 0x50]) : Buffer.from([0xff, 0xd8]));
  }

  it('来源目录里的文件：视频与图片取一帧，文档与字幕取开头的文字，别的没有', async () => {
    const at = (name: string) => path.join(project.path, name);
    await fs.copyFile(clip, at('素材.mp4'));
    ffmpegTo(at('透明.png'), ['-f', 'lavfi', '-i', 'color=c=red@0.5:s=640x480,format=rgba', '-frames:v', '1']);
    ffmpegTo(at('照片.jpg'), ['-f', 'lavfi', '-i', 'testsrc=size=1000x500:rate=1:duration=1', '-frames:v', '1']);
    ffmpegTo(at('声音.wav'), ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1']);
    const notes = `# 剪辑笔记\n\n${'今天讲剪辑技巧。'.repeat(200)}`;
    await fs.writeFile(at('笔记.md'), `﻿${notes}`);
    await fs.writeFile(at('台词.srt'), '1\n00:00:01,000 --> 00:00:02,000\n<b>大家好</b>\n\n2\n00:00:02,000 --> 00:00:03,000\n今天讲剪辑\n');
    await fs.writeFile(
      at('台词.ass'),
      '[Events]\nFormat: Layer, Start, End, Style, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,{\\i1}你好\\N世界\n',
    );
    await fs.writeFile(at('旧编码.txt'), Buffer.from([0xbd, 0xf1, 0xcc, 0xec]));
    await fs.writeFile(at('说明.pdf'), '%PDF-1.4\n');
    await fs.writeFile(at('矢量.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    await fs.writeFile(at('假图.png'), `#EXTM3U\n#EXTINF:2,\nfile://${clip}\n`);
    await settle();

    expectImage(await thumbnail('素材.mp4'), 'image/jpeg', 320, 180);
    expectImage(await thumbnail('透明.png'), 'image/png', 320, 240);
    expectImage(await thumbnail('照片.jpg'), 'image/jpeg', 320, 160);

    const excerpt = await thumbnail('笔记.md');
    expect(excerpt.kind).toBe('text');
    const text = (excerpt as Extract<SpaceThumbnail, { kind: 'text' }>).excerpt;
    expect(notes.startsWith(text)).toBe(true);
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(SPACE_EXCERPT_MAX_BYTES);
    expect(Buffer.byteLength(text, 'utf8')).toBeGreaterThan(SPACE_EXCERPT_MAX_BYTES - 4);
    expect(await thumbnail('台词.srt')).toEqual({ kind: 'text', excerpt: '大家好\n今天讲剪辑' });
    expect(await thumbnail('台词.ass')).toEqual({ kind: 'text', excerpt: '你好\n世界' });

    for (const name of ['声音.wav', '旧编码.txt', '说明.pdf', '矢量.svg', '假图.png'])
      expect(await thumbnail(name), name).toEqual({ kind: 'none' });

    // 结果里没有本机路径。
    const all = JSON.stringify(await Promise.all(['素材.mp4', '笔记.md'].map(thumbnail)));
    expect(all).not.toContain(project.path);
    expect(all).not.toContain(dir);
  });

  it('视频条目：关着的视频取工作稿的封面（复制进来的与链接的素材都行），没有片段的没有；不存在的条目是 not-found', async () => {
    const make = async (name: string, storage: 'managed' | 'linked' | null) => {
      const created = await client.request('videos.create', { projectId: project.id, name });
      if (storage) {
        const source = path.join(fixtures, `${name}.mp4`);
        await fs.copyFile(clip, source);
        await client.request('edits.apply', {
          videoId: created.ref.videoId,
          commandId: newId('cmd'),
          expectedRevision: created.snapshot.video.revision,
          operations: [
            { type: 'importAsset', path: source, storage, ref: 'clip' },
            { type: 'addItem', sequenceId: created.snapshot.video.rootSequenceId, asset: { ref: 'clip' }, alignment: 'nearest-frame' },
          ],
        });
      }
      await client.request('videos.close', { videoId: created.ref.videoId });
      return created.ref;
    };
    const managed = await make('复制', 'managed');
    const linked = await make('链接', 'linked');
    const empty = await make('空白', null);
    await settle();

    const ofVideo = async (videoId: string) => {
      const [entry] = (await client.request('space.list', { videoId, kind: 'video' })).entries;
      return client.request('space.thumbnail', { entryId: entry!.id });
    };
    expectImage(await ofVideo(managed.videoId), 'image/jpeg', 320, 180);
    expectImage(await ofVideo(linked.videoId), 'image/jpeg', 320, 180);
    expect(await ofVideo(empty.videoId)).toEqual({ kind: 'none' });

    // 取封面不打开视频、不占写锁：照样能打开来编辑。
    const reopened = await client.request('videos.open', { projectId: project.id, path: managed.relPath });
    expect(reopened.ref.videoId).toBe(managed.videoId);
    await client.request('videos.close', { videoId: managed.videoId });

    const missing = await client.request('space.thumbnail', { entryId: 'sp_none' }).then(
      () => null,
      (error: RpcError) => error,
    );
    expect(missing?.code).toBe('not-found');
  });

  it.skipIf(!worker)(
    '成片：取 1 秒与时长 10% 中较早的一帧',
    async () => {
      const created = await client.request('videos.create', { projectId: project.id, name: '成片' });
      const videoId = created.ref.videoId;
      await client.request('edits.apply', {
        videoId,
        commandId: newId('cmd'),
        expectedRevision: created.snapshot.video.revision,
        operations: [
          { type: 'importAsset', path: clip, ref: 'clip' },
          { type: 'addItem', sequenceId: created.snapshot.video.rootSequenceId, asset: { ref: 'clip' }, alignment: 'nearest-frame' },
        ],
      });
      const { jobId } = await client.request('exports.create', {
        videoId,
        commandId: newId('cmd'),
        settings: { kind: 'video', format: 'mp4' },
      });
      let job: JobRecord | null = null;
      for (let i = 0; i < 1200 && !job; i++) {
        const record = await client.request('exports.get', { jobId });
        if (TERMINAL.has(record.state)) job = record;
        else await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(job?.state, JSON.stringify(job?.error)).toBe('completed');
      await settle();
      const { entries } = await client.request('space.list', { kind: 'export' });
      expect(entries).toHaveLength(1);
      expectImage(await client.request('space.thumbnail', { entryId: entries[0]!.id }), 'image/jpeg', 320, 180);
    },
    120_000,
  );
});
