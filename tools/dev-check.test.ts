import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error 仓库的 Node 脚本没有类型声明
import { checkEnvironment } from './dev-check.mjs';

type Check = { label: string; ok: boolean; required: boolean; hint: string };
const failed = (checks: Check[]) => checks.filter((check) => check.required && !check.ok).map((check) => check.label);

describe('development prerequisites', () => {
  it('requires the October 2026 security patches in each supported Node line', () => {
    for (const nodeVersion of ['20.19.0', '22.23.3', '22.22.9', '23.11.0', '24.22.0', '24.21.9', '25.9.0', '26.12.0', '26.11.9']) {
      expect(failed(checkEnvironment({ nodeVersion, lite: true }))).toEqual(['Node.js 22.23.4+, 24.22.1+ or 26.12.1+']);
    }
    for (const nodeVersion of ['22.23.4', '22.23.5', '22.24.0', '24.22.1', '24.22.2', '24.23.0', '26.12.1', '26.12.2', '26.13.0']) {
      expect(failed(checkEnvironment({ nodeVersion, lite: true }))).toEqual([]);
    }
  });

  it('enables type stripping for npm scripts that run TypeScript directly', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(manifest.engines.node).toBe('^22.23.4 || ^24.22.1 || ^26.12.1');
    const scripts: string[] = Object.values(manifest.scripts);
    const typedScripts = scripts.filter((script) => /^node .*\.ts$/.test(script));
    expect(typedScripts.length).toBeGreaterThan(0);
    for (const script of typedScripts) expect(script).toMatch(/^node --experimental-strip-types /);
  });

  it('returns the correct CLI exit status for supported and unsupported Node versions', () => {
    const script = fileURLToPath(new URL('./dev-check.mjs', import.meta.url));
    for (const [nodeVersion, status] of [['24.22.1', 0], ['24.22.0', 1], ['26.11.1', 1]] as const) {
      const preload = `Object.defineProperty(process.versions, 'node', { value: '${nodeVersion}' });`;
      const result = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, script, '--lite'], { encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(status);
      expect(result.stdout).toContain(`[${status === 0 ? 'OK' : 'MISSING'}] Node.js 22.23.4+, 24.22.1+ or 26.12.1+`);
    }
  });

  it('stops npm run dev before builds or launch when doctor fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'baocut-dev-check-'));
    try {
      const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
      const script = fileURLToPath(new URL('./dev-check.mjs', import.meta.url));
      writeFileSync(join(root, 'unsupported-node.mjs'), "Object.defineProperty(process.versions, 'node', { value: '22.11.0' });\n");
      writeFileSync(join(root, 'doctor.mjs'), `
import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['--import', './unsupported-node.mjs', ${JSON.stringify(script)}, '--lite'], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
`);
      writeFileSync(join(root, 'sentinel.mjs'), "console.log('BUILD_OR_DEV_RAN');\n");
      writeFileSync(join(root, 'package.json'), JSON.stringify({
        scripts: {
          predev: manifest.scripts.predev,
          setup: manifest.scripts.setup,
          doctor: 'node doctor.mjs',
          'build:engine': 'node sentinel.mjs',
          'build:wasm': 'node sentinel.mjs',
          dev: 'node sentinel.mjs',
        },
      }));
      const result = spawnSync(process.execPath, [process.env.npm_execpath!, 'run', 'dev'], { cwd: root, encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(1);
      expect(result.stdout).toContain('[MISSING] Node.js 22.23.4+, 24.22.1+ or 26.12.1+');
      expect(result.stdout).not.toContain('BUILD_OR_DEV_RAN');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not invoke native tools in lite mode', () => {
    const checks = checkEnvironment({ nodeVersion: '24.22.1', lite: true, probe: () => { throw new Error('native tool invoked'); } });
    expect(failed(checks)).toEqual([]);
    expect(checks).toHaveLength(1);
  });

  it('reports all missing prerequisites, with actionable Windows guidance', () => {
    const checks: Check[] = checkEnvironment({ nodeVersion: '24.22.1', platform: 'win32', arch: 'x64', probe: () => false });
    expect(failed(checks)).toEqual(['Cargo', 'rustc', 'CMake', 'MSVC C++ compiler']);
    expect(checks.find((check) => check.label === 'MSVC C++ compiler')?.hint).toContain('x64 Native Tools');
    expect(checks.filter((check) => !check.required).map((check) => check.label)).toEqual(['ffmpeg', 'ffprobe']);
  });

  it('requires Metal for Apple Silicon and C++ only for Intel macOS', () => {
    const options = { nodeVersion: '24.22.1', platform: 'darwin', probe: (_: string, args: string[]) => !args.includes('metal') };
    expect(failed(checkEnvironment({ ...options, arch: 'arm64' }))).toEqual(['Metal compiler (MLX)']);
    expect(failed(checkEnvironment({ ...options, arch: 'x64' }))).toEqual([]);
  });

  it('checks the Linux compiler and treats missing FFmpeg as a warning', () => {
    const checks = checkEnvironment({ nodeVersion: '24.22.1', platform: 'linux', arch: 'x64', probe: (command: string) => !['c++', 'ffmpeg', 'ffprobe'].includes(command) });
    expect(failed(checks)).toEqual(['C++ compiler']);
  });
});
