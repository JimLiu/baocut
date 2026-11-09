import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { packagedResourceEnv as desktopResourceEnv, packagedResources } from '../../../desktop/src/main/packaged-resources.ts';
import { isDiscoveryLive, isEndpointRefused as storageEndpointRefused } from '../../../../packages/runtime-storage/src/discovery.ts';
import { installEntryOf } from '../../../../packages/runtime-storage/src/install-identity.ts';
import { CliError, EXIT, exitCodeFor } from '../envelope.ts';
import {
  checkInterfaceVersion,
  checkRuntimeNode,
  ensureRuntime,
  findRuntime,
  interfaceMismatch,
  isEndpointRefused,
  launchRuntime,
  lockHolderAlive,
  nodeSatisfies,
  ownCliCommand,
  ownStandalonePackage,
  packagedApps,
  packagedResourceEnv,
  resolveRuntimeLaunch,
  appCredentialHelperEnv,
  type LaunchSpec,
} from './connection.ts';

describe('Runtime 的入口与版本门', () => {
  it.each(['darwin', 'win32', 'linux'] as const)('%s 打包后的资源位置与桌面端一致', (platform) => {
    const resources = path.join(os.tmpdir(), 'BaoCut', 'resources');
    const env = packagedResourceEnv(resources, platform);
    expect(env).toEqual(desktopResourceEnv(packagedResources(resources), platform));
    expect(env.PMETAL_METALLIB_PATH).toBe(platform === 'darwin' ? path.join(resources, 'bin', 'mlx.metallib') : undefined);
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

  it('源码 Runtime 借装好的 App 里的凭据助手读链接账号（§7.1）：已经设了 BAOCUT_CREDENTIAL_HELPER 时不覆盖', () => {
    const seen: string[] = [];
    const helper = '/Applications/BaoCut.app/Contents/Resources/bin/credential-helper';
    const exists = (file: string) => {
      seen.push(file);
      return file === helper;
    };
    expect(appCredentialHelperEnv({}, 'darwin', '/repo/apps/cli/src/runtime', exists)).toEqual({ BAOCUT_CREDENTIAL_HELPER: helper });
    expect(seen[0]).toBe(helper);
    expect(appCredentialHelperEnv({ BAOCUT_CREDENTIAL_HELPER: '/x/helper' }, 'darwin', '/repo', exists)).toEqual({});
    expect(appCredentialHelperEnv({}, 'darwin', '/repo', () => false)).toEqual({});
    const win = appCredentialHelperEnv({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'win32', 'C:\\repo', (file) => file.endsWith('credential-helper.exe'));
    expect(win).toEqual({ BAOCUT_CREDENTIAL_HELPER: 'C:\\Users\\u\\AppData\\Local\\Programs\\BaoCut\\resources\\bin\\credential-helper.exe' });
    expect(appCredentialHelperEnv({}, 'linux', '/repo', () => true)).toEqual({});
  });

  it('源码入口：Node 不默认去掉类型标注时补 --experimental-strip-types；仓库的入口带上 engines.node', () => {
    const old = { version: '22.5.0', stripsTypes: false };
    const current = { version: '24.22.1', stripsTypes: true };
    const repo = resolveRuntimeLaunch({}, 'linux', undefined, old);
    expect(repo?.args).toEqual(['--experimental-strip-types', expect.stringMatching(/main\.ts$/)]);
    expect(repo?.nodeRange).toBe(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '..', '..', '..', 'package.json'), 'utf8')).engines.node);
    expect(resolveRuntimeLaunch({}, 'linux', undefined, current)?.args).toEqual([expect.stringMatching(/main\.ts$/)]);
    expect(resolveRuntimeLaunch({ BAOCUT_RUNTIME_ENTRY: '/x/runtime.ts' }, 'linux', undefined, old)?.args).toEqual([
      '--experimental-strip-types',
      path.resolve('/x/runtime.ts'),
    ]);
    expect(resolveRuntimeLaunch({ BAOCUT_RUNTIME_ENTRY: '/x/runtime.js' }, 'linux', undefined, old)?.args).toEqual([path.resolve('/x/runtime.js')]);
  });

  it('Node 版本不在 engines.node 里时不拉起，报出要哪个版本', () => {
    const range = '^22.23.4 || ^24.22.1 || ^26.12.1';
    expect(nodeSatisfies('22.23.4', range)).toBe(true);
    expect(nodeSatisfies('v24.30.0', range)).toBe(true);
    expect(nodeSatisfies('22.18.0', range)).toBe(false);
    expect(nodeSatisfies('23.11.0', range)).toBe(false);
    expect(nodeSatisfies('20.19.0', range)).toBe(false);
    expect(nodeSatisfies('27.0.0', range)).toBe(false);
    expect(nodeSatisfies('27.0.0', '>=22')).toBe(true);
    expect(nodeSatisfies('18.0.0', 'lts/*')).toBe(true);
    const spec = { command: process.execPath, args: ['main.ts'], env: {}, source: 'repo' as const, nodeRange: range };
    const error = catchError(() => checkRuntimeNode(spec, '20.19.0'));
    expect(error.code).toBe('RUNTIME_START_FAILED');
    expect(error.message).toContain(range);
    expect(error.message).toContain('20.19.0');
    expect(() => checkRuntimeNode(spec, '24.22.1')).not.toThrow();
    expect(() => checkRuntimeNode({ ...spec, nodeRange: undefined }, '20.19.0')).not.toThrow();
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

  it('接口版本不同而没有替换（CLI 独立使用与发布 §4.2）：写明对方是谁拉起的、手上有什么', () => {
    const busy = interfaceMismatch('1', '2', { launchedBy: 'cli', activeJobs: 2, connections: { desktop: 0, cli: 1, agent: 0 } });
    expect(busy.code).toBe('INTERFACE_VERSION_MISMATCH');
    expect(busy.extra).toMatchObject({ launchedBy: 'cli', activeJobs: 2, connections: { cli: 1 } });
    expect(busy.message).toContain('2');
    const byApp = interfaceMismatch('1', '2', { launchedBy: null });
    expect(byApp.extra).toMatchObject({ launchedBy: null });
    expect(byApp.message).not.toBe(busy.message);
    // 不知道对方是谁时只报版本门本身。
    expect(interfaceMismatch('1', '2').extra).not.toHaveProperty('launchedBy');
  });

  it('只有拉起这个 CLI 自己那份安装时才替换：仓库入口与包着 CLI 的 App 算，BAOCUT_RUNTIME_ENTRY 不算', () => {
    expect(resolveRuntimeLaunch({ BAOCUT_RUNTIME_ENTRY: '/tmp/runtime.js' })?.own).toBeUndefined();
    const repo = resolveRuntimeLaunch({ BAOCUT_HOME: path.join(os.tmpdir(), 'baocut-own-check') });
    expect(repo).toMatchObject({ source: 'repo', own: true });
    expect(packagedApps({}, 'darwin', '/Applications/Other.app/Contents/Resources/app.asar/out/main')[0]).toMatchObject({ own: true });
    expect(packagedApps({}, 'darwin', '/tmp/repo/apps/cli/src/runtime')[0]?.own).toBeUndefined();
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

const servers: net.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function listening(): Promise<string> {
  const server = net.createServer((socket) => socket.destroy());
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `ws://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
}

/** 刚刚还有人监听、现在已经关掉的端口。 */
async function closed(): Promise<string> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return `ws://127.0.0.1:${port}`;
}

describe('过期的发现文件与实例锁（架构设计 §2.2）', () => {
  const write = (home: string, at: string, endpoint: string) => {
    fs.writeFileSync(path.join(home, 'runtime.json'), JSON.stringify({ instanceId: 'rt_old', pid: process.pid, startedAt: at, endpoint }));
    fs.writeFileSync(path.join(home, 'runtime.lock'), JSON.stringify({ pid: process.pid, instanceId: 'rt_old', acquiredAt: at }));
  };

  it('上一次开机留下的：PID 现在有进程也不算 Runtime 还在', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-cli-stale-'));
    try {
      const beforeBoot = new Date(Date.now() - os.uptime() * 1000 - 10 * 60_000).toISOString();
      const endpoint = await listening();
      write(home, new Date().toISOString(), endpoint);
      expect((await findRuntime(home))?.instanceId).toBe('rt_old');
      expect(lockHolderAlive(home)).toBe(true);
      write(home, beforeBoot, endpoint);
      expect(await findRuntime(home)).toBeNull();
      expect(lockHolderAlive(home)).toBe(false);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('端点拒绝连接：进程在（PID 被复用）也不算 Runtime 还在', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-cli-stale-'));
    try {
      write(home, new Date().toISOString(), await closed());
      expect(await findRuntime(home)).toBeNull();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('与桌面端的判断一致（isDiscoveryLive）', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-cli-stale-'));
    try {
      const beforeBoot = new Date(Date.now() - os.uptime() * 1000 - 10 * 60_000).toISOString();
      const endpoints = [await listening(), await closed(), 'not a url', 'ws://127.0.0.1'];
      for (const endpoint of endpoints) {
        expect(await isEndpointRefused(endpoint)).toBe(await storageEndpointRefused(endpoint));
        for (const at of [new Date().toISOString(), beforeBoot]) {
          write(home, at, endpoint);
          const discovery = JSON.parse(fs.readFileSync(path.join(home, 'runtime.json'), 'utf8'));
          expect((await findRuntime(home)) !== null).toBe(await isDiscoveryLive(discovery));
        }
      }
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

describe.runIf(process.platform !== 'win32')('从仓库运行的 CLI 选哪个 Runtime（Agent 面设计 §5.6）', () => {
  let user: string;
  beforeEach(() => {
    user = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-cli-user-'));
    vi.stubEnv('HOME', user);
    const contents = path.join(user, 'Applications', 'BaoCut.app', 'Contents');
    fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
    fs.mkdirSync(path.join(contents, 'Resources', 'app.asar'), { recursive: true });
    fs.writeFileSync(path.join(contents, 'MacOS', 'BaoCut'), 'fixture');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(user, { recursive: true, force: true });
  });

  it('开发用的主目录：用仓库的 Runtime，装了应用也不用它（否则调不到还没发布的工具）', () => {
    const repo = resolveRuntimeLaunch({ BAOCUT_HOME: path.join(user, 'dev-home') }, 'darwin');
    expect(repo?.source).toBe('repo');
    expect(repo?.args[0]).toMatch(/apps[/\\]runtime[/\\]src[/\\]main\.ts$/);
  });

  it('默认的 ~/.baocut：用装好的应用，开发中的代码不碰真实数据', () => {
    expect(resolveRuntimeLaunch({}, 'darwin')?.source).toBe('packaged');
    expect(resolveRuntimeLaunch({ BAOCUT_HOME: path.join(user, '.baocut') }, 'darwin')?.source).toBe('packaged');
  });

  it('打包输出目录在仓库里时，包内的 CLI 仍用自己的 Runtime', () => {
    const root = path.join(user, 'checkout');
    fs.mkdirSync(path.join(root, 'apps', 'runtime', 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'apps', 'runtime', 'src', 'main.ts'), '');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'baocut' }));
    const contents = path.join(root, 'dist', 'BaoCut.app', 'Contents');
    const from = path.join(contents, 'Resources', 'app.asar', 'out', 'main');
    fs.mkdirSync(from, { recursive: true });
    fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
    fs.writeFileSync(path.join(contents, 'MacOS', 'BaoCut'), 'fixture');
    expect(resolveRuntimeLaunch({ BAOCUT_HOME: path.join(user, 'dev-home') }, 'darwin', from)).toMatchObject({
      command: path.join(contents, 'MacOS', 'BaoCut'),
      source: 'packaged',
    });
  });
});

describe('CLI shipped inside a relocated desktop app', () => {
  it('prefers its own Runtime over another installed app', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-cli-own-app-'));
    try {
      const contents = path.join(dir,'Moved app','BaoCut.app','Contents');
      const resources = path.join(contents,'Resources');
      const from = path.join(resources,'app.asar','out','main');
      const executable = path.join(contents,'MacOS','BaoCut');
      fs.mkdirSync(from,{recursive:true}); fs.mkdirSync(path.dirname(executable),{recursive:true}); fs.writeFileSync(executable,'fixture');
      fs.mkdirSync(path.join(resources,'skills'),{recursive:true});
      expect(packagedApps({},'darwin',from)[0]).toEqual({executable,resources,own:true});
      expect(resolveRuntimeLaunch({},'darwin',from)).toEqual({command:executable,args:[path.join(resources,'app.asar','out','main','runtime.js'),'--credential-store','keychain'],env:{ELECTRON_RUN_AS_NODE:'1',...packagedResourceEnv(resources,'darwin')},source:'packaged',own:true});
      expect(resolveRuntimeLaunch({BAOCUT_RUNTIME_ENTRY:'/explicit/runtime.js'},'darwin',from)?.source).toBe('env');
    } finally { fs.rmSync(dir,{recursive:true,force:true}); }
  });
  it('derives a portable Windows app before standard install directories', () => {
    const from = String.raw`D:\Portable Apps\BaoCut\resources\app.asar\out\main`;
    expect(packagedApps({LOCALAPPDATA:String.raw`C:\Users\test\Local`},'win32',from)[0]).toEqual({executable:String.raw`D:\Portable Apps\BaoCut\BaoCut.exe`,resources:String.raw`D:\Portable Apps\BaoCut\resources`,own:true});
  });
});

/** 一个独立 CLI 包（CLI 独立使用与发布 §9）的骨架：布局与清单，Node 与启动器只是占位文件。 */
function makeStandalone(dir: string, platform: 'darwin' | 'win32' = 'darwin') {
  const root = path.join(dir, 'versions', '3.17.0-build.93');
  const contents = path.join(root, 'BaoCut CLI.app', 'Contents');
  const app = platform === 'darwin' ? path.join(contents, 'Resources', 'app') : path.join(root, 'resources', 'app');
  const resources = path.dirname(app);
  const from = path.join(app, 'out', 'main');
  fs.mkdirSync(from, { recursive: true });
  const manifest = { schema: 1, product: 'baocut-cli', version: '3.17.0', build: 93, target: platform === 'darwin' ? 'aarch64-apple-darwin' : 'x86_64-pc-windows-msvc', variant: 'cpu', sourceCommit: null, node: '24.11.1' };
  fs.writeFileSync(path.join(app, 'baocut-standalone.json'), JSON.stringify(manifest));
  const macos = path.join(contents, 'MacOS');
  if (platform === 'darwin') {
    fs.mkdirSync(macos, { recursive: true });
    for (const name of ['node', 'baocut-cli', 'baocut-disclaim']) fs.writeFileSync(path.join(macos, name), 'fixture');
  }
  return { root, app, resources, from, macos, manifest };
}

describe('CLI shipped inside the standalone package', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-cli-standalone-')));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('认出自己所在的独立包；拉起包里的 Node 跑解开的 runtime.js，经 disclaim 助手，标明没有 Electron', () => {
    const pkg = makeStandalone(dir);
    expect(ownStandalonePackage('darwin', pkg.from)).toMatchObject({ root: pkg.root, app: pkg.app, manifest: pkg.manifest });
    expect(resolveRuntimeLaunch({}, 'darwin', pkg.from)).toEqual({
      command: path.join(pkg.macos, 'node'),
      args: [path.join(pkg.app, 'out', 'main', 'runtime.js'), '--credential-store', 'keychain'],
      env: { ...packagedResourceEnv(pkg.resources, 'darwin'), BAOCUT_PACKAGE_KIND: 'standalone' },
      source: 'standalone',
      disclaim: path.join(pkg.macos, 'baocut-disclaim'),
      // 拉起的就是这个 CLI 自己这一份：版本不同的空闲 CLI Runtime 照 §4.2 替换。
      own: true,
    });
    // 资源与命令行入口照 App 的找法：`BAOCUT_CLI_ENTRY` 正是独立包的启动器。
    expect(packagedResourceEnv(pkg.resources, 'darwin').BAOCUT_CLI_ENTRY).toBe(path.join(pkg.macos, 'baocut-cli'));
    expect(resolveRuntimeLaunch({ BAOCUT_RUNTIME_ENTRY: '/explicit/runtime.js' }, 'darwin', pkg.from)?.source).toBe('env');
    // 没有 disclaim 助手时直接拉起。
    fs.rmSync(path.join(pkg.macos, 'baocut-disclaim'));
    expect(resolveRuntimeLaunch({}, 'darwin', pkg.from)).not.toHaveProperty('disclaim');
  });

  it('MCP 的 stdio 形式拉起包的启动器；Runtime 的发现信息 `entry` 是包根，与 CLI 认出的独立包一致', () => {
    const pkg = makeStandalone(dir);
    expect(ownCliCommand('darwin', pkg.from)).toEqual({ command: path.join(pkg.macos, 'baocut-cli'), args: [], entry: path.join(pkg.macos, 'baocut-cli'), standalone: true });
    // `baocut update` 按发现信息的 `entry` 留下还在用的版本目录（`collectGarbage`）：它要落在版本目录里。
    expect(installEntryOf(path.join(pkg.from, 'runtime.js'), 'darwin')).toBe(pkg.root);
    // 没有清单的 `out/main`（仓库里开发态编出的）照旧往上找仓库根。
    fs.rmSync(path.join(pkg.app, 'baocut-standalone.json'));
    expect(installEntryOf(path.join(pkg.from, 'runtime.js'), 'darwin')).toBeNull();
  });

  it('清单不成形或布局不对时不算独立包', () => {
    const pkg = makeStandalone(dir);
    fs.writeFileSync(path.join(pkg.app, 'baocut-standalone.json'), '{"schema":2}');
    expect(ownStandalonePackage('darwin', pkg.from)).toBeNull();
    const loose = path.join(dir, 'loose', 'app', 'out', 'main');
    fs.mkdirSync(loose, { recursive: true });
    fs.writeFileSync(path.join(dir, 'loose', 'app', 'baocut-standalone.json'), JSON.stringify(pkg.manifest));
    expect(ownStandalonePackage('darwin', loose)).toBeNull();
    expect(ownStandalonePackage('linux', pkg.from)).toBeNull();
  });

  it('App 里有 disclaim 助手时经它拉起', () => {
    const contents = path.join(dir, 'BaoCut.app', 'Contents');
    const from = path.join(contents, 'Resources', 'app.asar', 'out', 'main');
    fs.mkdirSync(from, { recursive: true });
    fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
    fs.writeFileSync(path.join(contents, 'MacOS', 'BaoCut'), 'fixture');
    expect(resolveRuntimeLaunch({}, 'darwin', from)).not.toHaveProperty('disclaim');
    fs.writeFileSync(path.join(contents, 'MacOS', 'baocut-disclaim'), 'fixture');
    expect(resolveRuntimeLaunch({}, 'darwin', from)).toMatchObject({ source: 'packaged', disclaim: path.join(contents, 'MacOS', 'baocut-disclaim') });
  });

  it.skipIf(process.platform === 'win32')('经助手拉起时程序与参数排在助手后面，PID 不变，发现文件对得上', { timeout: 20_000 }, async () => {
    const home = path.join(dir, 'home');
    const marker = path.join(dir, 'disclaim-args.txt');
    // 假的助手：记下参数再 exec 程序（真的助手以 POSIX_SPAWN_SETEXEC 换掉自己，PID 同样不变）。
    const disclaim = path.join(dir, 'disclaim.sh');
    fs.writeFileSync(disclaim, `#!/bin/sh\nprintf '%s\\n' "$@" > '${marker}'\nexec "$@"\n`, { mode: 0o755 });
    const runtime = path.join(dir, 'fake-runtime.cjs');
    fs.writeFileSync(runtime, [
      "const fs=require('fs'),net=require('net'),path=require('path');",
      'const home=process.env.BAOCUT_HOME;',
      "const server=net.createServer(()=>{}).listen(0,'127.0.0.1',()=>{",
      "fs.mkdirSync(home,{recursive:true});",
      "fs.writeFileSync(path.join(home,'runtime.json'),JSON.stringify({pid:process.pid,startedAt:new Date().toISOString(),endpoint:'ws://127.0.0.1:'+server.address().port,token:'t',launchedBy:'cli'}));",
      'setTimeout(()=>process.exit(0),3000);});',
    ].join(''));
    const spec: LaunchSpec = { command: process.execPath, args: [runtime], env: {}, source: 'standalone', disclaim };
    const { discovery, started } = await launchRuntime(home, spec, 10_000);
    expect(started).toBe(true);
    expect(fs.readFileSync(marker, 'utf8').trim().split('\n')).toEqual([process.execPath, runtime, '--quiet', '--launched-by', 'cli', '--idle-exit']);
    expect(discovery.endpoint).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);
  });
});
