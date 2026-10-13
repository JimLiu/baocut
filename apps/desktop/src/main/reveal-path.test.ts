import { describe, expect, it, vi } from 'vitest';
import { revealPath, showInFolder } from './reveal-path.ts';

describe('native shell reveal paths', () => {
  it.each([
    [String.raw`\\?\C:\Users\Example\AppData\Roaming\BCUT\projects\Demo.bcut`, String.raw`C:\Users\Example\AppData\Roaming\BCUT\projects\Demo.bcut`],
    [String.raw`\\?\D:\项目 文件夹\source.mp3`, String.raw`D:\项目 文件夹\source.mp3`],
    ["\\\\?\\C:\\", "C:\\"],
    ["//?/C:/Projects/项目/data/../Demo.bcut", "C:\\Projects\\项目\\Demo.bcut"],
    [String.raw`\\?\UNC\server\share\Project Folder\clip.mov`, String.raw`\\server\share\Project Folder\clip.mov`],
    [String.raw`\\?\unc\服务器\共享\项目`, String.raw`\\服务器\共享\项目`],
    [String.raw`C:\Downloads\source.mp3`, String.raw`C:\Downloads\source.mp3`],
    ['D:/Projects/Demo.bcut/media/clip.mov', String.raw`D:\Projects\Demo.bcut\media\clip.mov`],
    [String.raw`\\server\share\Project Folder`, String.raw`\\server\share\Project Folder`],
  ])('maps %s to a shell path', (input, expected) => {
    expect(revealPath(input, 'win32')).toBe(expected);
  });

  it.each([String.raw`\\?\Volume{example}\folder`, String.raw`\\.\pipe\named`, String.raw`\\?\GLOBALROOT\Device\HarddiskVolume1\file`])('retains an unknown namespace instead of stripping it: %s', (input) => {
    expect(revealPath(input, 'win32')).toBe(input);
  });

  it.each(['darwin', 'linux'] as const)('keeps POSIX names and normalizes POSIX separators on %s', (platform) => {
    expect(revealPath('/tmp/项目 folder/../Clip.mov', platform)).toBe('/tmp/Clip.mov');
    expect(revealPath(String.raw`/tmp/\\?\C:\literal`, platform)).toBe(String.raw`/tmp/\\?\C:\literal`);
  });

  it.each(['win32', 'darwin', 'linux'] as const)('does not pass relative, non-string or NUL-containing paths to the shell on %s', (platform) => {
    const show = vi.fn();
    for (const value of [null, 12, '', 'relative/file.mp4', 'C:relative', '/tmp/file\0.mov']) showInFolder(value, show, platform);
    expect(show).not.toHaveBeenCalled();
  });

  it('sends converted file and directory paths to the same shell callback', () => {
    const show = vi.fn();
    showInFolder(String.raw`\\?\C:\项目\Demo.bcut`, show, 'win32');
    showInFolder(String.raw`\\?\C:\项目\clip.mp4`, show, 'win32');
    expect(show.mock.calls).toEqual([[String.raw`C:\项目\Demo.bcut`], [String.raw`C:\项目\clip.mp4`]]);
  });
});
