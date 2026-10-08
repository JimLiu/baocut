import { describe, expect, it } from 'vitest';
// @ts-expect-error 仓库的 Node 脚本没有类型声明
import { checkEnvironment } from './dev-check.mjs';

type Check = { label: string; ok: boolean; required: boolean; hint: string };
const failed = (checks: Check[]) => checks.filter((check) => check.required && !check.ok).map((check) => check.label);

describe('development prerequisites', () => {
  it('rejects Node versions without stable native TypeScript support', () => {
    for (const nodeVersion of ['20.19.0', '22.16.0', '22.17.0']) {
      expect(failed(checkEnvironment({ nodeVersion, lite: true }))).toEqual(['Node.js 22.18+']);
    }
    for (const nodeVersion of ['22.18.0', '22.20.0', '24.0.0']) {
      expect(failed(checkEnvironment({ nodeVersion, lite: true }))).toEqual([]);
    }
  });

  it('does not invoke native tools in lite mode', () => {
    const checks = checkEnvironment({ nodeVersion: '22.18.0', lite: true, probe: () => { throw new Error('native tool invoked'); } });
    expect(failed(checks)).toEqual([]);
    expect(checks).toHaveLength(1);
  });

  it('reports all missing prerequisites, with actionable Windows guidance', () => {
    const checks: Check[] = checkEnvironment({ nodeVersion: '22.18.0', platform: 'win32', arch: 'x64', probe: () => false });
    expect(failed(checks)).toEqual(['Cargo', 'rustc', 'CMake', 'MSVC C++ compiler']);
    expect(checks.find((check) => check.label === 'MSVC C++ compiler')?.hint).toContain('x64 Native Tools');
    expect(checks.filter((check) => !check.required).map((check) => check.label)).toEqual(['ffmpeg', 'ffprobe']);
  });

  it('requires Metal for Apple Silicon and C++ only for Intel macOS', () => {
    const options = { nodeVersion: '22.18.0', platform: 'darwin', probe: (_: string, args: string[]) => !args.includes('metal') };
    expect(failed(checkEnvironment({ ...options, arch: 'arm64' }))).toEqual(['Metal compiler (MLX)']);
    expect(failed(checkEnvironment({ ...options, arch: 'x64' }))).toEqual([]);
  });

  it('checks the Linux compiler and treats missing FFmpeg as a warning', () => {
    const checks = checkEnvironment({ nodeVersion: '24.0.0', platform: 'linux', arch: 'x64', probe: (command: string) => !['c++', 'ffmpeg', 'ffprobe'].includes(command) });
    expect(failed(checks)).toEqual(['C++ compiler']);
  });
});
