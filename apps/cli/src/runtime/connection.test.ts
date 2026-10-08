import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { packagedResourceEnv as desktopResourceEnv, packagedResources } from '../../../desktop/src/main/packaged-resources.ts';
import { CliError, EXIT, exitCodeFor } from '../envelope.ts';
import {
  checkInterfaceVersion,
  ensureRuntime,
  packagedApps,
  packagedResourceEnv,
  resolveAgentSkillsDir,
  resolveRuntimeLaunch,
} from './connection.ts';

describe('Runtime 的入口与版本门', () => {
  it('打包后的资源位置与桌面端一致', () => {
    const resources = path.join(os.tmpdir(), 'BaoCut', 'resources');
    expect(packagedResourceEnv(resources)).toEqual(desktopResourceEnv(packagedResources(resources)));
  });

  it('说明书的来源：BAOCUT_AGENT_SKILLS_DIR 优先；没有时回落到仓库里的 agent-skills/，都没有时 null', () => {
    expect(resolveAgentSkillsDir({ BAOCUT_AGENT_SKILLS_DIR: '/x/agent-skills' }, 'linux')).toBe('/x/agent-skills');
    const repo = resolveAgentSkillsDir({}, 'linux');
    expect(repo).toMatch(/agent-skills$/);
    expect(fs.existsSync(path.join(repo!, 'baocut', 'SKILL.md'))).toBe(true);
    expect(resolveAgentSkillsDir({}, 'linux', os.tmpdir())).toBeNull();
  });

  it('BAOCUT_RUNTIME_ENTRY 优先；没有时回落到仓库里的入口', () => {
    expect(resolveRuntimeLaunch({ BAOCUT_RUNTIME_ENTRY: '/x/runtime.ts' }, 'linux')).toEqual({
      command: process.execPath,
      args: [path.resolve('/x/runtime.ts')],
      env: {},
      source: 'env',
    });
    expect(resolveRuntimeLaunch({ BAOCUT_RUNTIME_ENTRY: '/opt/baocut-runtime' }, 'linux')).toMatchObject({
      command: path.resolve('/opt/baocut-runtime'),
      args: [],
    });
    const repo = resolveRuntimeLaunch({}, 'linux');
    expect(repo?.source).toBe('repo');
    expect(repo?.args[0]).toMatch(/apps[/\\]runtime[/\\]src[/\\]main\.ts$/);
    expect(fs.existsSync(repo!.args[0]!)).toBe(true);
  });

  it('装好的应用：Windows 按用户安装的位置，macOS 的 Applications', () => {
    const [win] = packagedApps({ LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, 'win32');
    expect(win).toEqual({
      executable: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\BaoCut.exe',
      resources: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources',
    });
    expect(packagedApps({}, 'darwin')[0]?.executable).toBe('/Applications/BaoCut.app/Contents/MacOS/BaoCut');
  });

  it('接口版本不同：退出码 3，说明哪一边要更新', () => {
    expect(() => checkInterfaceVersion('2', '2')).not.toThrow();
    const newer = catchError(() => checkInterfaceVersion('3', '2'));
    expect(newer.code).toBe('INTERFACE_VERSION_MISMATCH');
    expect(newer.extra).toMatchObject({ cli: '2', runtime: '3', update: 'cli' });
    expect(exitCodeFor(newer.code)).toBe(EXIT.runtimeUnavailable);
    expect(catchError(() => checkInterfaceVersion('1', '2')).extra.update).toBe('runtime');
  });

  it('--no-start 且没有 Runtime：RUNTIME_UNAVAILABLE（退出码 3），不拉起', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-cli-home-'));
    try {
      const error = await ensureRuntime(home, { start: false }).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).code).toBe('RUNTIME_UNAVAILABLE');
      expect(fs.existsSync(path.join(home, 'logs'))).toBe(false);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

function catchError(fn: () => void): CliError {
  try {
    fn();
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error('没有抛出');
}
