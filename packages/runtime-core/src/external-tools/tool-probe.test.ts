import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { envValue, findOnPath, pathExtensions, windowsScriptKind } from './tool-probe.ts';

/** 在 PATH 里找工具：Windows 的 PATHEXT 用注入的平台在临时目录里核对（目录分隔仍按本机），不执行任何文件。 */

describe('在 PATH 里找工具', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-tool-probe-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function touch(...parts: string[]): Promise<string> {
    const file = path.join(dir, ...parts);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '', { mode: 0o755 });
    return file;
  }

  it('Windows：同一个目录里按 PATHEXT 的顺序补扩展名，原名最后', async () => {
    const cmd = await touch('a', 'yt-dlp.cmd');
    const exe = await touch('a', 'yt-dlp.exe');
    await touch('a', 'yt-dlp');
    const searchPath = path.join(dir, 'a');
    expect(await findOnPath('yt-dlp', searchPath, 'win32', '.COM;.EXE;.BAT;.CMD')).toBe(exe);
    expect(await findOnPath('yt-dlp', searchPath, 'win32', '.CMD;.EXE')).toBe(cmd);
    // 没有 PATHEXT 时用 .COM;.EXE;.BAT;.CMD。
    expect(await findOnPath('yt-dlp', searchPath, 'win32')).toBe(exe);
    // 带了扩展名的只找原名。
    expect(await findOnPath('yt-dlp.cmd', searchPath, 'win32')).toBe(cmd);
  });

  it('Windows：前面目录里的 .cmd 挡住后面目录里的 .exe（和命令行一样）；只有原名时找到原名', async () => {
    const cmd = await touch('a', 'yt-dlp.cmd');
    await touch('b', 'yt-dlp.exe');
    const bare = await touch('c', 'tool');
    const searchPath = [path.join(dir, 'a'), path.join(dir, 'b'), path.join(dir, 'c')].join(path.delimiter);
    expect(await findOnPath('yt-dlp', searchPath, 'win32', null)).toBe(cmd);
    expect(await findOnPath('tool', searchPath, 'win32', null)).toBe(bare);
  });

  it('其他系统不补扩展名', async () => {
    await touch('a', 'yt-dlp.exe');
    const plain = await touch('b', 'yt-dlp');
    const searchPath = [path.join(dir, 'a'), path.join(dir, 'b')].join(path.delimiter);
    expect(await findOnPath('yt-dlp', searchPath, 'darwin', '.EXE')).toBe(plain);
  });

  it('PATHEXT 的拆分、大小写不敏感的环境变量、Windows 上不能直接执行的文件', () => {
    expect(pathExtensions('.COM;.EXE;;exe;.Cmd;.EXE')).toEqual(['.com', '.exe', '.cmd']);
    expect(pathExtensions('')).toEqual(['.com', '.exe', '.bat', '.cmd']);
    expect(envValue({ PathExt: '.EXE' }, 'PATHEXT')).toBe('.EXE');
    expect(envValue({ PATHEXT: '.CMD', PathExt: '.EXE' }, 'PATHEXT')).toBe('.CMD');
    expect(envValue({}, 'PATHEXT')).toBeUndefined();
    expect(windowsScriptKind('C:\\bin\\yt-dlp.EXE')).toBeNull();
    expect(windowsScriptKind('C:\\bin\\yt-dlp.com')).toBeNull();
    expect(windowsScriptKind('C:\\bin\\yt-dlp.cmd')).toBe('batch');
    expect(windowsScriptKind('C:\\bin\\yt-dlp.BAT')).toBe('batch');
    expect(windowsScriptKind('C:\\bin\\yt-dlp.ps1')).toBe('other');
    expect(windowsScriptKind('C:\\bin\\yt-dlp')).toBe('other');
  });
});
