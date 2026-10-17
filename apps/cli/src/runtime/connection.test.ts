import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { packagedResourceEnv as desktopResourceEnv, packagedResources } from '../../../desktop/src/main/packaged-resources.ts';
import { CliError, EXIT, exitCodeFor } from '../envelope.ts';
import {
  checkInterfaceVersion,
  ensureRuntime,
  findRuntime,
  lockHolderAlive,
  packagedApps,
  packagedResourceEnv,
  resolveAgentSkillsDir,
  resolveRuntimeLaunch,
} from './connection.ts';

describe('Runtime 的入口与版本门', () => {
  it.each(['darwin', 'win32', 'linux'] as const)('%s 打包后的资源位置与桌面端一致', (platform) => {
    const resources = path.join(os.tmpdir(), 'BaoCut', 'resources');
    const env = packagedResourceEnv(resources, platform);
    expect(env).toEqual(desktopResourceEnv(packagedResources(resources), platform));
    expect(env.PMETAL_METALLIB_PATH).toBe(platform === 'darwin' ? path.join(resources, 'bin', 'mlx.metallib') : undefined);
  });

  it('说明书的来源：BAOCUT_AGENT_SKILLS_DIR 优先；没有时回落到仓库里的 skills/，都没有时 null', () => {
    expect(resolveAgentSkillsDir({ BAOCUT_AGENT_SKILLS_DIR: '/x/skills' }, 'linux')).toBe('/x/skills');
    const repo = resolveAgentSkillsDir({}, 'linux');
    expect(repo).toMatch(/[/\\]skills$/);
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

describe('上一次开机留下的发现文件与实例锁（架构设计 §2.2）', () => {
  it('PID 现在有进程也不算 Runtime 还在', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-cli-stale-'));
    try {
      const beforeBoot = new Date(Date.now() - os.uptime() * 1000 - 10 * 60_000).toISOString();
      const now = new Date().toISOString();
      const write = (at: string) => {
        fs.writeFileSync(path.join(home, 'runtime.json'), JSON.stringify({ instanceId: 'rt_old', pid: process.pid, startedAt: at, endpoint: 'ws://127.0.0.1:1' }));
        fs.writeFileSync(path.join(home, 'runtime.lock'), JSON.stringify({ pid: process.pid, instanceId: 'rt_old', acquiredAt: at }));
      };
      write(now);
      expect(findRuntime(home)?.instanceId).toBe('rt_old');
      expect(lockHolderAlive(home)).toBe(true);
      write(beforeBoot);
      expect(findRuntime(home)).toBeNull();
      expect(lockHolderAlive(home)).toBe(false);
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

describe('CLI shipped inside a relocated desktop app', () => {
  it('prefers its own Runtime and skills over another installed app', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-cli-own-app-'));
    try {
      const contents = path.join(dir,'Moved app','BaoCut.app','Contents');
      const resources = path.join(contents,'Resources');
      const from = path.join(resources,'app.asar','out','main');
      const executable = path.join(contents,'MacOS','BaoCut');
      fs.mkdirSync(from,{recursive:true}); fs.mkdirSync(path.dirname(executable),{recursive:true}); fs.writeFileSync(executable,'fixture');
      fs.mkdirSync(path.join(resources,'skills'),{recursive:true});
      expect(packagedApps({},'darwin',from)[0]).toEqual({executable,resources});
      expect(resolveRuntimeLaunch({},'darwin',from)).toEqual({command:executable,args:[path.join(resources,'app.asar','out','main','runtime.js'),'--credential-store','keychain'],env:{ELECTRON_RUN_AS_NODE:'1',...packagedResourceEnv(resources,'darwin')},source:'packaged'});
      expect(resolveAgentSkillsDir({},'darwin',from)).toBe(path.join(resources,'skills'));
      expect(resolveRuntimeLaunch({BAOCUT_RUNTIME_ENTRY:'/explicit/runtime.js'},'darwin',from)?.source).toBe('env');
    } finally { fs.rmSync(dir,{recursive:true,force:true}); }
  });
  it('derives a portable Windows app before standard install directories', () => {
    const from = String.raw`D:\Portable Apps\BaoCut\resources\app.asar\out\main`;
    expect(packagedApps({LOCALAPPDATA:String.raw`C:\Users\test\Local`},'win32',from)[0]).toEqual({executable:String.raw`D:\Portable Apps\BaoCut\BaoCut.exe`,resources:String.raw`D:\Portable Apps\BaoCut\resources`});
  });
});
