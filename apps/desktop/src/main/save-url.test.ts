import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { downloadToFile, runtimeMediaUrl } from './save-url.ts';

describe('界面要存下来的地址', () => {
  const endpoint = 'ws://127.0.0.1:63726';
  it('只收这个 Runtime 媒体通道的句柄，去掉查询串', () => {
    expect(runtimeMediaUrl('http://127.0.0.1:63726/media/AbC-_1/%E7%8C%AB.png?download=1#x', endpoint)?.href).toBe(
      'http://127.0.0.1:63726/media/AbC-_1/%E7%8C%AB.png',
    );
    expect(runtimeMediaUrl('http://127.0.0.1:63726/media/AbC', endpoint)?.pathname).toBe('/media/AbC');
  });
  it.each([
    ['别的端口', 'http://127.0.0.1:1234/media/AbC/a.png'],
    ['别的主机', 'http://localhost:63726/media/AbC/a.png'],
    ['外部网址', 'https://example.org/media/AbC/a.png'],
    ['不是媒体通道', 'http://127.0.0.1:63726/slides/AbC/a.png'],
    ['多层路径', 'http://127.0.0.1:63726/media/AbC/x/a.png'],
    ['本机文件', 'file:///etc/passwd'],
    ['不是网址', 'media/AbC/a.png'],
  ])('%s不收', (_name, value) => {
    expect(runtimeMediaUrl(value, endpoint)).toBeNull();
  });
  it('还没连上 Runtime、不是字符串时不收', () => {
    expect(runtimeMediaUrl('http://127.0.0.1:63726/media/AbC/a.png', null)).toBeNull();
    expect(runtimeMediaUrl(42, endpoint)).toBeNull();
  });
});

describe('把地址的内容写进文件', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'baocut-save-url-'));
  });
  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });
  const url = new URL('http://127.0.0.1:1/media/AbC/a.png');
  const respond = (response: Response): typeof fetch => async () => response;

  it('写完换名，覆盖用户同意覆盖的文件，不留临时文件', async () => {
    const file = path.join(dir, '猫.png');
    await fsp.writeFile(file, 'old');
    await downloadToFile(url, file, respond(new Response(new Uint8Array([1, 2, 3]))));
    expect([...(await fsp.readFile(file))]).toEqual([1, 2, 3]);
    expect(await fsp.readdir(dir)).toEqual(['猫.png']);
  });

  it('取不到时抛出状态码，原文件不动', async () => {
    const file = path.join(dir, 'a.png');
    await fsp.writeFile(file, 'old');
    await expect(downloadToFile(url, file, respond(new Response('gone', { status: 404 })))).rejects.toThrow('HTTP 404');
    expect(await fsp.readFile(file, 'utf8')).toBe('old');
    expect(await fsp.readdir(dir)).toEqual(['a.png']);
  });

  it('传到一半断开时删掉临时文件，原文件不动', async () => {
    const file = path.join(dir, 'a.mp4');
    await fsp.writeFile(file, 'old');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.error(new Error('socket hang up'));
      },
    });
    await expect(downloadToFile(url, file, respond(new Response(body)))).rejects.toThrow('socket hang up');
    expect(await fsp.readFile(file, 'utf8')).toBe('old');
    expect(await fsp.readdir(dir)).toEqual(['a.mp4']);
  });
});
