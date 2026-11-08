import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WINDOWS_PROBE, hostEnvironment, parseAppleLanguages, parseLanguageList, parseWindowsProbe, type CommandRunner } from './host-environment.ts';

const user = path.resolve('/Users/me');

function runner(outputs: Record<string, string | null>): CommandRunner & { calls: string[] } {
  const calls: string[] = [];
  const run = (async (command: string, args: readonly string[]) => {
    const key = [command.split(/[\\/]/).pop(), ...args].join(' ');
    calls.push(key);
    return outputs[key] ?? null;
  }) as CommandRunner & { calls: string[] };
  run.calls = calls;
  return run;
}

describe('主机文件夹与系统语言（CLI 独立使用与发布 §5.2）', () => {
  it('macOS：语言取 AppleLanguages，文件夹不补', async () => {
    const run = runner({ 'defaults read -g AppleLanguages': '(\n    "zh-Hans-CN",\n    en,\n    "ja-JP"\n)\n' });
    expect(await hostEnvironment({ env: {}, platform: 'darwin', userHome: user, run })).toEqual({
      BAOCUT_SYSTEM_LANGUAGES: 'zh-Hans-CN,en,ja-JP',
    });
  });

  it('桌面端给了的不动，也不去查', async () => {
    const run = runner({});
    const env = { BAOCUT_DOWNLOADS_DIR: '/d', BAOCUT_DOCUMENTS_DIR: '/o', BAOCUT_SYSTEM_LANGUAGES: 'fr-FR' };
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      expect(await hostEnvironment({ env, platform, userHome: user, run })).toEqual({});
    }
    expect(run.calls).toEqual([]);
  });

  it('Windows：读注册表的已知文件夹与语言列表，文件夹要存在', async () => {
    const output = JSON.stringify({ downloads: 'D:\\下载', documents: 'C:\\Users\\me\\OneDrive\\文档', languages: ['zh-Hans-CN', 'en-US'] });
    const run = runner({ [`powershell.exe -NoProfile -NonInteractive -Command ${WINDOWS_PROBE}`]: `\uFEFF${output}\r\n` });
    const env = { SystemRoot: 'C:\\Windows' };
    const all = await hostEnvironment({ env, platform: 'win32', userHome: 'C:\\Users\\me', run, isDirectory: () => true });
    expect(all).toEqual({
      BAOCUT_DOWNLOADS_DIR: 'D:\\下载',
      BAOCUT_DOCUMENTS_DIR: 'C:\\Users\\me\\OneDrive\\文档',
      BAOCUT_SYSTEM_LANGUAGES: 'zh-Hans-CN,en-US',
    });
    const missing = await hostEnvironment({ env, platform: 'win32', userHome: 'C:\\Users\\me', run, isDirectory: (dir) => dir.startsWith('D:') });
    expect(missing).toEqual({ BAOCUT_DOWNLOADS_DIR: 'D:\\下载', BAOCUT_SYSTEM_LANGUAGES: 'zh-Hans-CN,en-US' });
  });

  it('Windows：PowerShell 失败或输出认不出时不补', async () => {
    expect(await hostEnvironment({ env: {}, platform: 'win32', userHome: 'C:\\Users\\me', run: runner({}), isDirectory: () => true })).toEqual({});
    expect(parseWindowsProbe('not json')).toEqual({ downloads: null, documents: null, languages: [] });
    expect(parseWindowsProbe('{"downloads":"%USERPROFILE%","documents":null,"languages":"en-US"}')).toEqual({
      downloads: '%USERPROFILE%',
      documents: null,
      languages: ['en-US'],
    });
    // 没展开的值不是绝对路径：不补。
    const run = runner({ [`powershell.exe -NoProfile -NonInteractive -Command ${WINDOWS_PROBE}`]: '{"downloads":"%USERPROFILE%\\\\Downloads"}' });
    expect(await hostEnvironment({ env: {}, platform: 'win32', userHome: 'C:\\Users\\me', run, isDirectory: () => true })).toEqual({});
  });

  it('Linux：xdg-user-dir 报主目录时当作没配置；语言取 LANGUAGE', async () => {
    const run = runner({ 'xdg-user-dir DOWNLOAD': '/home/me/下载\n', 'xdg-user-dir DOCUMENTS': '/home/me\n' });
    expect(await hostEnvironment({ env: { LANGUAGE: 'zh_CN:en' }, platform: 'linux', userHome: '/home/me', run, isDirectory: () => true })).toEqual({
      BAOCUT_DOWNLOADS_DIR: '/home/me/下载',
      BAOCUT_SYSTEM_LANGUAGES: 'zh_CN,en',
    });
    expect(await hostEnvironment({ env: {}, platform: 'linux', userHome: '/home/me', run: runner({}) })).toEqual({});
  });

  it('解析', () => {
    expect(parseAppleLanguages('(\n    "en-US",\n    "zh-Hans-US"\n)')).toEqual(['en-US', 'zh-Hans-US']);
    expect(parseAppleLanguages('')).toEqual([]);
    expect(parseLanguageList('C:POSIX')).toEqual([]);
    expect(parseLanguageList(undefined)).toEqual([]);
  });
});
