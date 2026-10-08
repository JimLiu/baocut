import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ paths: new Map<string, string>() }));
vi.mock('electron', () => ({ app: { setPath: (name: string, value: string) => env.paths.set(name, value) } }));
import { compositionHostProfileDir, compositionHostScript, runCompositionHost } from './composition-host-entry.ts';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  env.paths.clear();
});

describe('compositionHostScript', () => {
  it('没有开关时是 null：走桌面应用', () => {
    expect(compositionHostScript(['/app/BaoCut', '.'])).toBeNull();
    expect(compositionHostScript(['/app/BaoCut', '--composition-host=/tmp/host.cjs'])).toBeNull();
  });

  it('开关后面的下一个参数是脚本', () => {
    expect(compositionHostScript(['/app/BaoCut', '--composition-host', '/c/host-1.cjs'])).toBe('/c/host-1.cjs');
    // 开发态的 default_app 把应用文件放在前面；Chromium 也可能在前面插开关。
    expect(compositionHostScript(['/e/Electron', '/repo/out/main/index.js', '--no-sandbox', '--composition-host', 'C:\\c\\host.cjs'])).toBe(
      'C:\\c\\host.cjs',
    );
  });

  it('开关后面没有脚本时是空字符串', () => {
    expect(compositionHostScript(['/app/BaoCut', '--composition-host'])).toBe('');
    expect(compositionHostScript(['/app/BaoCut', '--composition-host', '--inspect'])).toBe('');
  });
});

describe('runCompositionHost', () => {
  it('Electron 数据目录设到脚本旁边的 profile/，再同步加载脚本', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-host-entry-'));
    temps.push(dir);
    const script = path.join(dir, 'host-test.cjs');
    const marker = `__baocutHostEntry${process.pid}`;
    fs.writeFileSync(script, `globalThis[${JSON.stringify(marker)}] = true;\n`);

    runCompositionHost(script);

    expect((globalThis as Record<string, unknown>)[marker]).toBe(true);
    const profile = compositionHostProfileDir(script);
    expect(profile).toBe(path.join(dir, 'profile'));
    expect(fs.statSync(profile).isDirectory()).toBe(true);
    expect(Object.fromEntries(env.paths)).toEqual({
      userData: path.join(profile, 'userData'),
      sessionData: path.join(profile, 'sessionData'),
      logs: path.join(profile, 'logs'),
      crashDumps: path.join(profile, 'crashDumps'),
    });
  });
});
