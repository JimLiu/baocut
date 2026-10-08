import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale, type ExternalToolOffer, type ExternalToolStatus } from '@baocut/protocol';
import { formatGrants } from './grants-output.ts';
import {
  formatToolList,
  formatToolOffer,
  formatToolStatus,
  formatToolUpdatePlan,
  installToolPrompt,
  newCommandLines,
  parseToolsArgs,
  updateOutcomeLine,
  updateToolPrompt,
} from './external-tools-output.ts';

const offer: ExternalToolOffer = {
  version: '2026.07.04',
  fileName: 'yt-dlp_macos',
  url: 'https://mirror.example.com/yt-dlp/2026.07.04/yt-dlp_macos',
  sizeBytes: 36 * 1024 * 1024,
  estimatedBytes: 36 * 1024 * 1024,
  sha256: 'a'.repeat(64),
  license: 'Unlicense（源码）；独立可执行文件含 GPLv3+ 组件，整体按 GPLv3+',
  homepage: 'https://github.com/yt-dlp/yt-dlp',
  blockedReason: null,
};

const status = (patch: Partial<ExternalToolStatus> = {}): ExternalToolStatus => ({
  name: 'yt-dlp',
  label: 'yt-dlp',
  purpose: '从链接导入',
  state: 'missing',
  reason: '没有找到 yt-dlp',
  path: null,
  version: null,
  source: null,
  minVersion: '2024.10.22',
  installable: true,
  offer,
  consentRequired: true,
  consent: null,
  managed: null,
  userPath: null,
  installJobId: null,
  update: null,
  updateJobId: null,
  platform: 'darwin',
  remedy: '用 baocut external-tools install yt-dlp 下载',
  ...patch,
});

describe('baocut external-tools 的参数', () => {
  const resolve = (file: string) => `/cwd/${file}`;

  it('子命令与用法错误', () => {
    expect(parseToolsArgs([], {}, resolve)).toEqual({ kind: 'list' });
    expect(parseToolsArgs(['detect'], {}, resolve)).toEqual({ kind: 'detect' });
    expect(parseToolsArgs(['detect', 'yt-dlp'], {}, resolve)).toEqual({ kind: 'detect', name: 'yt-dlp' });
    expect(parseToolsArgs(['install', 'yt-dlp'], {}, resolve)).toEqual({ kind: 'install', name: 'yt-dlp' });
    expect(parseToolsArgs(['update', 'yt-dlp'], {}, resolve)).toEqual({ kind: 'update', name: 'yt-dlp' });
    expect(parseToolsArgs(['path', 'yt-dlp', 'bin/yt-dlp'], {}, resolve)).toEqual({
      kind: 'path',
      name: 'yt-dlp',
      file: '/cwd/bin/yt-dlp',
    });
    expect(parseToolsArgs(['path', 'yt-dlp'], { clear: true }, resolve)).toEqual({ kind: 'path', name: 'yt-dlp', file: null });
    expect(parseToolsArgs(['remove', 'yt-dlp'], {}, resolve)).toEqual({ kind: 'remove', name: 'yt-dlp' });
    expect(parseToolsArgs(['consent', 'yt-dlp'], {}, resolve)).toEqual({ kind: 'consent', name: 'yt-dlp', grant: true });
    expect(parseToolsArgs(['consent', 'yt-dlp'], { revoke: true }, resolve)).toEqual({ kind: 'consent', name: 'yt-dlp', grant: false });
    for (const bad of [['install'], ['update'], ['path', 'yt-dlp'], ['frobnicate'], ['remove', 'a', 'b'], ['list', 'x']]) {
      expect(() => parseToolsArgs(bad, {}, resolve), bad.join(' ')).toThrow(/用法/);
    }
    expect(() => parseToolsArgs(['path', 'yt-dlp', 'f'], { clear: true }, resolve)).toThrow('--clear');
  });
});

describe('外部工具的输出', () => {
  it('状态：版本与来源、路径、同意、原因与补救', () => {
    expect(formatToolStatus(status())).toEqual([
      'yt-dlp  未安装  从链接导入',
      '  同意：还没有同意（用之前要同意：baocut external-tools consent yt-dlp）',
      '  原因：没有找到 yt-dlp',
      '  补救：用 baocut external-tools install yt-dlp 下载',
    ]);
    const installed = status({
      state: 'installed',
      reason: null,
      remedy: null,
      path: '/home/tools/yt-dlp/2026.07.04/yt-dlp',
      version: '2026.07.04',
      source: 'managed',
      consent: { state: 'granted', at: '2026-10-03T00:00:00.000Z', via: 'cli' },
      managed: { version: '2026.07.04', path: '/home/tools/yt-dlp/2026.07.04/yt-dlp', installedAt: '2026-10-03T00:00:00.000Z' },
    });
    expect(formatToolStatus(installed)).toEqual([
      'yt-dlp  已安装 2026.07.04（BaoCut 下载的副本）  从链接导入',
      '  路径：/home/tools/yt-dlp/2026.07.04/yt-dlp',
      '  同意：已同意（2026-10-03T00:00:00.000Z，在 CLI 里）',
    ]);
    const ffmpeg = status({ name: 'ffmpeg', label: 'ffmpeg', purpose: '媒体', consentRequired: false, offer: null, installable: false });
    expect(formatToolList([ffmpeg])[0]).toBe('ffmpeg  未安装  媒体');
    expect(formatToolList([])).toEqual(['没有登记的外部工具']);
  });

  it('下载说明：来源、版本、大小、许可；清单不全时说明原因', () => {
    const lines = formatToolOffer('yt-dlp', offer);
    expect(lines[0]).toBe('将下载 yt-dlp 2026.07.04');
    expect(lines).toContain('  来源：https://mirror.example.com/yt-dlp/2026.07.04/yt-dlp_macos');
    expect(lines).toContain('  大小：36.0 MB');
    expect(lines.some((l) => l.includes('GPLv3+'))).toBe(true);
    const blocked = formatToolOffer('yt-dlp', { ...offer, sizeBytes: null, sha256: null, blockedReason: '没有可信的 sha256' });
    expect(blocked).toContain('  大小：约 36.0 MB（大小未知，按估计）');
    expect(blocked).toContain('  不能下载：没有可信的 sha256');
    expect(installToolPrompt('yt-dlp', offer)).toBe('同意下载并使用 yt-dlp 2026.07.04（36.0 MB）？[y/N] ');
  });

  it('更新：状态里的办法、确认前的说明、不能代为执行时交给终端', () => {
    const plan = {
      method: 'homebrew' as const,
      argv: ['/opt/homebrew/bin/brew', 'upgrade', 'yt-dlp'],
      command: '/opt/homebrew/bin/brew upgrade yt-dlp',
      runnable: true,
      reason: null,
    };
    const system = status({
      state: 'outdated',
      reason: '2024.01.01 低于最低版本 2024.10.22',
      remedy: null,
      path: '/opt/homebrew/bin/yt-dlp',
      version: '2024.01.01',
      source: 'system',
      consentRequired: false,
      update: plan,
    });
    expect(formatToolStatus(system)).toContain('  更新：/opt/homebrew/bin/brew upgrade yt-dlp（Homebrew）');
    expect(formatToolStatus({ ...system, updateJobId: 'job_1' })).toContain('  正在更新：任务 job_1');
    expect(formatToolStatus({ ...system, updateJobId: 'job_1' }).some((l) => l.startsWith('  更新：'))).toBe(false);
    expect(formatToolUpdatePlan(system, plan)).toEqual([
      '将按原安装方式（Homebrew）更新 yt-dlp 2024.01.01',
      '  路径：/opt/homebrew/bin/yt-dlp',
      '  执行：/opt/homebrew/bin/brew upgrade yt-dlp',
    ]);
    expect(updateToolPrompt('yt-dlp')).toBe('在本机执行这条命令更新 yt-dlp？[y/N] ');

    const manual = {
      method: 'standalone' as const,
      argv: ['/usr/local/bin/yt-dlp', '-U'],
      command: 'sudo /usr/local/bin/yt-dlp -U',
      runnable: false,
      reason: '这份 yt-dlp 所在的 /usr/local/bin 要管理员权限才能改写，BaoCut 不替你提权。',
    };
    expect(formatToolStatus({ ...system, update: manual })).toContain('  更新：sudo /usr/local/bin/yt-dlp -U（官方独立程序，要在终端里自己执行）');
    expect(formatToolUpdatePlan(system, manual)).toEqual([
      `不能代为更新 yt-dlp：${manual.reason}`,
      '在终端里执行：',
      '  sudo /usr/local/bin/yt-dlp -U',
      '完成后重新检测：baocut external-tools detect yt-dlp',
    ]);
  });

  it('更新：逐行跟随输出，截掉的行用一行说明代替；结束时说更新到了哪个版本', () => {
    const run = (output: string, lines: number) => ({ line: 'brew upgrade yt-dlp', output, lines, truncated: false, exitCode: null });
    // 只打印写完的行；没写完的那一行留到结束。
    expect(newCommandLines(run('a\nb\nprogress 50%', 2), 0, false)).toEqual({ lines: ['a', 'b'], printed: 2 });
    expect(newCommandLines(run('a\nb\nc\n', 3), 2, false)).toEqual({ lines: ['c'], printed: 3 });
    expect(newCommandLines(run('a\nb\nc\ndone', 3), 3, true)).toEqual({ lines: ['done'], printed: 4 });
    // 任务记录只留末尾：前面截掉而没打印过的行。
    expect(newCommandLines(run('y\nz\n', 10), 3, false)).toEqual({ lines: ['…（省略 5 行）', 'y', 'z'], printed: 10 });
    expect(newCommandLines(run('y\nz\n', 10), 9, false)).toEqual({ lines: ['z'], printed: 10 });
    expect(newCommandLines(run('', 0), 0, true)).toEqual({ lines: [], printed: 0 });

    expect(updateOutcomeLine('yt-dlp', '2024.01.01', '2026.09.01')).toBe('已更新 yt-dlp：2024.01.01 → 2026.09.01');
    expect(updateOutcomeLine('yt-dlp', null, '2026.09.01')).toBe('已更新 yt-dlp：未知版本 → 2026.09.01');
    expect(updateOutcomeLine('yt-dlp', '2026.09.01', '2026.09.01')).toBe('yt-dlp 已是最新版本 2026.09.01');
  });
});

describe('English output', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
  });

  it('prints CLI text in English when the locale is en', () => {
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
    expect(formatToolList([])).toEqual(['No external tools registered']);
    expect(updateToolPrompt('yt-dlp')).toBe('Run this command on this computer to update yt-dlp? [y/N] ');
    expect(updateOutcomeLine('yt-dlp', '2026.01.01', '2026.07.04')).toBe('Updated yt-dlp: 2026.01.01 → 2026.07.04');
    expect(() => parseToolsArgs(['bogus'], {}, (f) => f)).toThrow(/^Usage: baocut external-tools/);
    expect(formatGrants([])[0]).toMatch(/^No grants: /);
  });
});
