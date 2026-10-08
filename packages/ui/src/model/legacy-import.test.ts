import { describe, expect, it } from 'vitest';
import { displayDirectory, legacyImportDecision } from './legacy-import.ts';

describe('legacy import prompt', () => {
  it('imports, skips for this launch, or records never', () => {
    expect(legacyImportDecision('import', false)).toBe('import');
    // 勾了「不再提醒」又点「导入」：照常导入。
    expect(legacyImportDecision('import', true)).toBe('import');
    // 跳过不发请求：下次启动再问。
    expect(legacyImportDecision('skip', false)).toBeNull();
    expect(legacyImportDecision('skip', true)).toBe('never');
  });

  it('shortens the home folder on macOS and Linux and keeps Windows paths as they are', () => {
    expect(displayDirectory('/Users/jim/Documents/BaoCut/', 'darwin')).toBe('~/Documents/BaoCut');
    expect(displayDirectory('/home/jim/Documents/BaoCut', 'linux')).toBe('~/Documents/BaoCut');
    expect(displayDirectory('/Volumes/ExtremeSSD/BaoCut', 'darwin')).toBe('/Volumes/ExtremeSSD/BaoCut');
    expect(displayDirectory('C:\\Users\\jim\\Documents\\BaoCut\\', 'win32')).toBe('C:\\Users\\jim\\Documents\\BaoCut');
    expect(displayDirectory('\\\\nas\\video\\BaoCut', 'win32')).toBe('\\\\nas\\video\\BaoCut');
    expect(displayDirectory('D:\\', 'win32')).toBe('D:\\');
    expect(displayDirectory('/', 'darwin')).toBe('/');
  });
});
