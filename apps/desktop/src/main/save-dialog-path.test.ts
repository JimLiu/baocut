import { describe, expect, it } from 'vitest';
import { saveDialogPath } from './save-dialog-path.ts';

describe('系统保存窗口初始路径', () => {
  it('使用选定目录，文件名不能带入其他目录', () => {
    expect(saveDialogPath('/other/访谈.mp4', '/Volumes/成片 disk', 'darwin')).toBe('/Volumes/成片 disk/访谈.mp4');
    expect(saveDialogPath('访谈.mp4', 'relative', 'darwin')).toBe('访谈.mp4');
    expect(saveDialogPath('访谈.mp4', '/bad\0dir', 'darwin')).toBe('访谈.mp4');
    expect(saveDialogPath(undefined, undefined, 'darwin')).toBeUndefined();
  });
  it.each([
    ['C:\\成片 disk', 'C:\\成片 disk\\访谈.mp4'],
    ['C:/成片 disk', 'C:\\成片 disk\\访谈.mp4'],
    ['\\\\server\\共享', '\\\\server\\共享\\访谈.mp4'],
    ['\\\\?\\C:\\成片', '\\\\?\\C:\\成片\\访谈.mp4'],
    ['\\\\?\\UNC\\server\\共享', '\\\\?\\UNC\\server\\共享\\访谈.mp4'],
  ])('Windows 初始目录 %s', (dir, expected) => {
    expect(saveDialogPath('D:/other/访谈.mp4', dir, 'win32')).toBe(expected);
  });
});
