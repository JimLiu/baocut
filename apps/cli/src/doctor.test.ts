import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { MCP_INTERFACE_VERSION, PROTOCOL_VERSION, setLocale, type ComponentBuild, type RuntimeInfo } from '@baocut/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminBucket } from './admin/index.ts';
import { runCli } from './cli.ts';
import { M } from './cli-copy.ts';
import {
  appBundleOf,
  doctorNext,
  doctorReport,
  findOnPath,
  forwarderTarget,
  probeCredentialHelper,
  runSelfCheck,
  selfCheckRemedy,
  terminalAppName,
  type DoctorInputs,
} from './doctor.ts';
import { D } from './doctor-copy.ts';
import type { LaunchSpec } from './runtime/connection.ts';

let dir: string;
beforeEach(() => {
  setLocale('en');
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-doctor-'));
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

const APP = '/Applications/BaoCut.app/Contents/MacOS/baocut-cli';
const PACKAGED: LaunchSpec = {
  command: '/Applications/BaoCut.app/Contents/MacOS/BaoCut',
  args: ['/Applications/BaoCut.app/Contents/Resources/app.asar/out/main/runtime.js', '--credential-store', 'keychain'],
  env: { BAOCUT_BIN_DIR: '/Applications/BaoCut.app/Contents/Resources/bin' },
  source: 'packaged',
};
const REPO: LaunchSpec = { command: '/usr/bin/node', args: ['/repo/apps/runtime/src/main.ts'], env: {}, source: 'repo', nodeRange: '^22.18.0 || >=24.6.0' };

function info(overrides: Partial<RuntimeInfo> = {}): RuntimeInfo {
  return {
    runtimeVersion: '0.5.0',
    protocolVersion: '0.6',
    home: '/Users/me/.baocut',
    projectsDir: '/Users/me/BaoCut',
    logsDir: '/Users/me/.baocut/logs',
    pid: 4242,
    startedAt: '2026-11-08T10:00:00.000Z',
    launchedBy: null,
    ...overrides,
  } as RuntimeInfo;
}

function inputs(overrides: Partial<DoctorInputs> = {}): DoctorInputs {
  return {
    platform: 'darwin',
    home: '/Users/me/.baocut',
    terminal: { found: '/Users/me/.local/bin/baocut', target: APP },
    app: { entry: APP, version: '3.16.4' },
    terminalApp: { root: '/Applications/BaoCut.app', version: '3.16.4' },
    standalone: null,
    terminalStandalone: null,
    launch: PACKAGED,
    node: '24.6.0',
    runtime: { state: 'stopped' },
    credentials: { store: 'keychain', helper: '/Applications/BaoCut.app/Contents/Resources/bin/credential-helper', probe: { ok: true } },
    terminalProgram: 'Apple_Terminal',
    build: null,
    ...overrides,
  };
}

const check = (result: ReturnType<typeof doctorReport>, id: string) => result.checks.find((c) => c.id === id)!;

describe('doctorReport（CLI 独立使用与发布 §8.1）', () => {
  it('一切正常：终端找到的就是 App 的入口，Runtime 没在跑时说会用哪个入口拉起，钥匙串答话；完全磁盘访问要等 Runtime 在跑', () => {
    const result = doctorReport(inputs());
    expect(result.ok).toBe(true);
    expect(result.checks.map((c) => [c.id, c.level])).toEqual([
      ['entry', 'ok'],
      ['runtime', 'ok'],
      ['credentials', 'ok'],
      ['fullDiskAccess', 'skip'],
      ['build', 'skip'],
    ]);
    expect(check(result, 'entry').message).toContain('3.16.4');
    expect(check(result, 'runtime').message).toContain('/Applications/BaoCut.app/Contents/MacOS/BaoCut');
    expect(check(result, 'runtime').details).toMatchObject({ launch: { source: 'packaged', credentialStore: 'keychain' } });
    expect(doctorNext(result)).toBeNull();
  });

  it('终端找不到 baocut：warn，补救是用 App 入口的完整路径跑 cli install；没有 App 时只能 skip', () => {
    const missing = doctorReport(inputs({ terminal: null }));
    expect(check(missing, 'entry')).toMatchObject({ level: 'warn', remedy: `'${APP}' cli install` });
    expect(doctorNext(missing)).toBe(`'${APP}' cli install`);
    expect(check(doctorReport(inputs({ terminal: null, app: null })), 'entry').level).toBe('skip');
  });

  it('终端先找到别的 baocut：warn，点名两边，补救是 App 入口的 cli status', () => {
    const other = doctorReport(
      inputs({ terminal: { found: '/usr/local/bin/baocut', target: '/Volumes/Old/BaoCut.app/Contents/MacOS/baocut-cli' }, terminalApp: { root: '/Volumes/Old/BaoCut.app', version: '3.10.0' } }),
    );
    const entry = check(other, 'entry');
    expect(entry.level).toBe('warn');
    expect(entry.message).toContain('/usr/local/bin/baocut');
    expect(entry.message).toContain('3.10.0');
    expect(entry.remedy).toBe(`'${APP}' cli status`);
  });

  it('独立包里的 doctor 拿终端的 baocut 与独立包比，不与 App 比；补救写本包启动器的完整路径', () => {
    const versions = '/Users/me/.local/share/baocut/versions';
    const own = `${versions}/3.17.0-build.93/BaoCut CLI.app/Contents/MacOS/baocut-cli`;
    const standalone = { launcher: own, version: '3.17.0 (build 93)' };
    const installed = doctorReport(
      inputs({ standalone, terminal: { found: '/Users/me/.local/bin/baocut', target: own }, terminalStandalone: { root: `${versions}/3.17.0-build.93`, version: '3.17.0 (build 93)' } }),
    );
    expect(check(installed, 'entry')).toMatchObject({ level: 'ok', details: { terminalVersion: '3.17.0 (build 93)' } });
    expect(check(installed, 'entry').message).toContain('3.17.0 (build 93)');
    const missing = check(doctorReport(inputs({ standalone, terminal: null, app: null })), 'entry');
    expect(missing).toMatchObject({ level: 'warn', message: D.entryMissingStandalone, remedy: `'${own}' cli install` });
    // 终端先找到 App 的入口：点名，补救是本包的 cli status。
    const app = check(doctorReport(inputs({ standalone })), 'entry');
    expect(app).toMatchObject({ level: 'warn', remedy: `'${own}' cli status` });
    expect(app.message).toContain(APP);
  });

  it('Runtime 在跑：报版本、拉起者与项目目录；接口版本不同是 fail', () => {
    const running = doctorReport(inputs({ runtime: { state: 'running', info: info({ launchedBy: 'cli' }), interfaceVersion: MCP_INTERFACE_VERSION, access: null } }));
    expect(check(running, 'runtime')).toMatchObject({ level: 'ok', details: { launchedBy: 'cli', projectsDir: '/Users/me/BaoCut', pid: 4242 } });
    expect(check(running, 'runtime').message).toBe(D.runtimeRunning('0.5.0', 4242, 'cli'));
    const mismatch = doctorReport(inputs({ runtime: { state: 'running', info: info(), interfaceVersion: '999', access: null } }));
    expect(check(mismatch, 'runtime').level).toBe('fail');
    expect(mismatch.ok).toBe(false);
  });

  it('连不上、没有能拉起的入口、仓库入口的 Node 不合要求：fail', () => {
    expect(check(doctorReport(inputs({ runtime: { state: 'unreachable', pid: 7, code: 'RUNTIME_UNAVAILABLE', message: 'ECONNRESET' } })), 'runtime')).toMatchObject({
      level: 'fail',
      remedy: 'baocut runtime status',
    });
    expect(check(doctorReport(inputs({ launch: null, credentials: { store: null, helper: null, probe: null } })), 'runtime').level).toBe('fail');
    const oldNode = check(doctorReport(inputs({ launch: REPO, node: '20.11.0', credentials: { store: 'file', helper: null, probe: null } })), 'runtime');
    expect(oldNode.level).toBe('fail');
    expect(oldNode.message).toContain('20.11.0');
  });

  it('凭据：文件后端说出文件位置；助手缺失或连不上是 fail；钥匙串拒绝（SSH）是 warn，带解锁命令', () => {
    expect(check(doctorReport(inputs({ launch: REPO, credentials: { store: 'file', helper: null, probe: null } })), 'credentials')).toMatchObject({
      level: 'ok',
      details: { file: path.join('/Users/me/.baocut', 'store', 'model-credentials.json') },
    });
    expect(check(doctorReport(inputs({ credentials: { store: 'keychain', helper: null, probe: null } })), 'credentials').level).toBe('fail');
    expect(check(doctorReport(inputs({ credentials: { store: 'keychain', helper: '/x', probe: { ok: false, error: 'unavailable', message: 'boom' } } })), 'credentials')).toMatchObject({
      level: 'fail',
    });
    expect(check(doctorReport(inputs({ credentials: { store: 'keychain', helper: '/x', probe: { ok: false, error: 'denied', message: 'locked' } } })), 'credentials')).toMatchObject({
      level: 'warn',
      remedy: 'security unlock-keychain',
    });
    expect(check(doctorReport(inputs({ launch: { ...REPO, source: 'env' }, credentials: { store: null, helper: null, probe: null } })), 'credentials').level).toBe('skip');
  });

  it('完全磁盘访问：缺失时按拉起者说算在谁头上；只在 macOS 上有这一项', () => {
    const byApp = doctorReport(inputs({ runtime: { state: 'running', info: info(), interfaceVersion: MCP_INTERFACE_VERSION, access: { platform: 'darwin', fullDiskAccess: 'missing' } } }));
    expect(check(byApp, 'fullDiskAccess')).toMatchObject({ level: 'warn' });
    expect(check(byApp, 'fullDiskAccess').message).toContain('BaoCut.app');
    const byCli = doctorReport(
      inputs({ runtime: { state: 'running', info: info({ launchedBy: 'cli' }), interfaceVersion: MCP_INTERFACE_VERSION, access: { platform: 'darwin', fullDiskAccess: 'missing' } } }),
    );
    expect(check(byCli, 'fullDiskAccess').message).toContain('Terminal');
    expect(check(byCli, 'fullDiskAccess').message).toContain('baocut doctor');
    // 经 disclaim 助手拉起：Runtime 自己负责，算在它所在的包头上，不是终端。
    const cliMissing = { state: 'running', info: info({ launchedBy: 'cli' }), interfaceVersion: MCP_INTERFACE_VERSION, access: { platform: 'darwin', fullDiskAccess: 'missing' } } as const;
    const disclaimed = doctorReport(inputs({ runtime: cliMissing, launch: { ...REPO, source: 'standalone', disclaim: '/x/baocut-disclaim' } }));
    expect(check(disclaimed, 'fullDiskAccess')).toMatchObject({ level: 'warn', message: D.fdaMissingOwn('BaoCut CLI'), details: { attributedTo: 'BaoCut CLI' } });
    const disclaimedApp = doctorReport(inputs({ runtime: cliMissing, launch: { ...REPO, source: 'packaged', disclaim: '/x/baocut-disclaim' } }));
    expect(check(disclaimedApp, 'fullDiskAccess').message).toBe(D.fdaMissingOwn('BaoCut'));
    const granted = doctorReport(inputs({ runtime: { state: 'running', info: info(), interfaceVersion: MCP_INTERFACE_VERSION, access: { platform: 'darwin', fullDiskAccess: 'granted' } } }));
    expect(check(granted, 'fullDiskAccess').level).toBe('ok');
    expect(doctorReport(inputs({ platform: 'win32' })).checks.map((c) => c.id)).not.toContain('fullDiskAccess');
    expect(terminalAppName('iTerm.app')).toBe('iTerm');
    expect(terminalAppName('something-else')).toBeNull();
  });

  it('构建（开发态）：自检的核心组件有问题是 fail、其余是 warn，各带重建命令；构建比源码旧是 warn；都好是 ok', () => {
    const fresh = (component: ComponentBuild['component'], rebuild: string, extra: Partial<ComponentBuild> = {}): ComponentBuild => ({
      component,
      path: `/repo/${component}`,
      state: 'fresh',
      build: 'abc1234',
      protocolVersion: PROTOCOL_VERSION,
      builtAt: '2026-11-08T10:00:00.000Z',
      rebuild,
      ...extra,
    });
    const builds = [fresh('workers', 'npm run build:engine'), fresh('web', 'npm run build:web')];
    const repo = (build: DoctorInputs['build']) => check(doctorReport(inputs({ launch: REPO, credentials: { store: 'file', helper: null, probe: null }, build })), 'build');

    expect(repo({ state: 'done', problems: [], builds })).toMatchObject({ level: 'ok', message: D.buildOk(2), details: { entry: '/repo/apps/runtime/src/main.ts' } });
    expect(repo({ state: 'done', problems: ['audiocpp-cli: did not resolve to an existing file (null)'], builds })).toMatchObject({
      level: 'warn',
      remedy: 'npm run build:audiocpp',
    });
    // 先点名核心组件的问题：没有它做不了事。
    const core = repo({ state: 'done', problems: ['credential-helper: did not resolve to an existing file (null)', 'engine-host: does not start (exit 1)'], builds });
    expect(core).toMatchObject({ level: 'fail', remedy: 'npm run build:engine', message: D.buildProblems(2, 'engine-host: does not start (exit 1)') });

    const stale = fresh('web', 'npm run build:web', { state: 'stale', reason: 'inputs', changed: ['apps/web/src/main.tsx'], changedCount: 3 });
    expect(repo({ state: 'done', problems: [], builds: [builds[0]!, stale] })).toMatchObject({
      level: 'warn',
      message: M.buildStale('web', 3, 'npm run build:web'),
      remedy: 'npm run build:web',
    });
    const unverified = fresh('workers', 'npm run build:engine', { state: 'unverified', reason: 'no-stamp', build: null });
    const both = repo({ state: 'done', problems: [], builds: [unverified, stale] });
    // 先给过期的那个的重建命令，比不了的排在后面。
    expect(both).toMatchObject({ level: 'warn', remedy: 'npm run build:web', message: D.buildMore(M.buildUnverified('workers', 'npm run build:engine'), 1) });

    expect(repo({ state: 'failed', message: 'boom' })).toMatchObject({ level: 'fail', message: D.buildFailed('boom') });
    expect(selfCheckRemedy('editor.wasm: failed to load (null): x')).toBe('npm run build:wasm');
    expect(selfCheckRemedy('composition-host: does not start (x)')).toBe('npm install');
    expect(selfCheckRemedy('modelAssets: did not resolve to an existing directory (null)')).toBe('npm run setup');
  });

  it('next 先取 fail 的补救，再取 warn 的', () => {
    const result = doctorReport(
      inputs({
        terminal: null,
        runtime: { state: 'unreachable', pid: 7, code: 'RUNTIME_UNAVAILABLE', message: 'x' },
      }),
    );
    expect(doctorNext(result)).toBe('baocut runtime status');
  });
});

describe('收集事实', () => {
  it('findOnPath 按 PATH 顺序找第一个可执行的 baocut，解析软链接；不可执行、坏链接跳过', () => {
    const a = path.join(dir, 'a');
    const b = path.join(dir, 'b');
    const c = path.join(dir, 'c');
    for (const d of [a, b, c]) fs.mkdirSync(d);
    const real = path.join(dir, 'real-baocut');
    fs.writeFileSync(real, '#!/bin/sh\n');
    fs.chmodSync(real, 0o755);
    fs.writeFileSync(path.join(a, 'baocut'), 'not executable');
    fs.symlinkSync(path.join(dir, 'gone'), path.join(b, 'baocut'));
    fs.symlinkSync(real, path.join(c, 'baocut'));
    expect(findOnPath('baocut', { PATH: [a, b, c].join(':') }, 'darwin')).toEqual({ found: path.join(c, 'baocut'), target: fs.realpathSync(real) });
    expect(findOnPath('baocut', { PATH: a }, 'darwin')).toBeNull();
  });

  it('Windows 的转发脚本：只认 BaoCut 写的那种，取它转发到的入口', () => {
    expect(forwarderTarget('@echo off\r\nrem BaoCut command line forwarder\r\n"C:\\Program Files\\BaoCut\\baocut.cmd" %*\r\n')).toBe('C:\\Program Files\\BaoCut\\baocut.cmd');
    expect(forwarderTarget('@echo off\r\n"C:\\other\\baocut.cmd" %*\r\n')).toBeNull();
    expect(forwarderTarget(null)).toBeNull();
  });

  it('appBundleOf 读 Info.plist 的版本；不在 .app 里时 null', () => {
    const contents = path.join(dir, 'BaoCut.app', 'Contents');
    fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
    fs.writeFileSync(path.join(contents, 'Info.plist'), '<plist><dict><key>CFBundleShortVersionString</key>\n    <string>3.16.4</string></dict></plist>');
    expect(appBundleOf(path.join(contents, 'MacOS', 'baocut-cli'))).toEqual({ root: path.join(dir, 'BaoCut.app'), version: '3.16.4' });
    expect(appBundleOf('/usr/local/bin/baocut')).toBeNull();
  });

  it('probeCredentialHelper 只发一次 has，键是编出来的；按助手的回答分类，超时就杀掉', async () => {
    const seen = path.join(dir, 'seen.json');
    const helper = (body: string) => {
      const file = path.join(dir, `helper-${Math.random().toString(36).slice(2)}.mjs`);
      fs.writeFileSync(
        file,
        `import fs from 'node:fs';\nlet input = '';\nprocess.stdin.on('data', (d) => (input += d));\nprocess.stdin.on('end', () => {\n  fs.writeFileSync(${JSON.stringify(seen)}, input);\n  ${body};\n});\n`,
      );
      return { command: process.execPath, args: [file] };
    };
    expect(await probeCredentialHelper(helper(`process.stdout.write(JSON.stringify({ok:true,exists:false})+'\\n')`))).toEqual({ ok: true });
    const request = JSON.parse(fs.readFileSync(seen, 'utf8'));
    expect(request.op).toBe('has');
    expect(request.key).toMatch(/^doctor-probe-[0-9a-f]{12}$/);
    expect(Object.keys(request)).toEqual(['op', 'key']);
    expect(await probeCredentialHelper(helper(`process.stdout.write(JSON.stringify({ok:false,error:'denied',message:'User interaction is not allowed.'})+'\\n')`))).toMatchObject({
      ok: false,
      error: 'denied',
    });
    expect(await probeCredentialHelper(helper(`process.exit(1)`))).toMatchObject({ ok: false, error: 'unavailable' });
    expect(await probeCredentialHelper(helper(`setTimeout(()=>{},60000)`), 200)).toMatchObject({ ok: false, error: 'timeout' });
    expect(await probeCredentialHelper({ command: path.join(dir, 'no-helper') })).toMatchObject({ ok: false, error: 'missing' });
  });
});

describe('runSelfCheck', () => {
  /** 一个假的 Runtime 入口：记下参数与 BAOCUT_HOME，再照 `body` 回答。 */
  const fakeRuntime = (body: string): LaunchSpec => {
    const file = path.join(dir, `runtime-${Math.random().toString(36).slice(2)}.mjs`);
    const seen = path.join(dir, 'self-check-seen.json');
    fs.writeFileSync(
      file,
      `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ args: process.argv.slice(2), home: process.env.BAOCUT_HOME, extra: process.env.FROM_LAUNCH }));\n${body}\n`,
    );
    return { command: process.execPath, args: [file], env: { FROM_LAUNCH: 'yes' }, source: 'repo' };
  };
  const seen = () => JSON.parse(fs.readFileSync(path.join(dir, 'self-check-seen.json'), 'utf8'));

  it('用拉起 Runtime 的命令加 --self-check --probe，读最后一行 JSON；有问题时以 1 退出也照读', async () => {
    const launch = fakeRuntime(
      `console.log('noise');\nconsole.log(JSON.stringify({ problems: ['speech-worker: does not start (x)'], builds: [{ component: 'web', state: 'fresh' }] }));\nprocess.exitCode = 1;`,
    );
    const result = await runSelfCheck(launch, { PATH: process.env.PATH }, path.join(dir, 'home'));
    expect(result).toEqual({ state: 'done', problems: ['speech-worker: does not start (x)'], builds: [{ component: 'web', state: 'fresh' }] });
    expect(seen()).toEqual({ args: ['--self-check', '--probe'], home: path.join(dir, 'home'), extra: 'yes' });
  });

  it('没有报告时给出 stderr 的最后一行或退出码；超时就杀掉', async () => {
    expect(await runSelfCheck(fakeRuntime(`console.error('first');\nconsole.error('Cannot find module x');\nprocess.exit(3);`), {}, dir)).toEqual({
      state: 'failed',
      message: 'Cannot find module x',
    });
    expect(await runSelfCheck(fakeRuntime(`process.exit(3);`), {}, dir)).toEqual({ state: 'failed', message: M.exitedWith(3) });
    expect(await runSelfCheck(fakeRuntime(`setTimeout(() => {}, 60000);`), {}, dir, 300)).toEqual({ state: 'failed', message: D.buildTimedOut(0) });
  });
});

describe('baocut doctor', () => {
  async function cli(argv: string[], env: NodeJS.ProcessEnv) {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const chunks = { stdout: '', stderr: '' };
    stdout.on('data', (chunk) => (chunks.stdout += String(chunk)));
    stderr.on('data', (chunk) => (chunks.stderr += String(chunk)));
    const code = await runCli(argv, adminBucket, { cwd: dir, env, stdout, stderr });
    return { code, ...chunks };
  }

  it('不拉起 Runtime、不写主目录；信封里是各项检查，next 是第一个问题的补救', async () => {
    const home = path.join(dir, 'home');
    fs.mkdirSync(home);
    const entry = path.join(dir, 'app-entry');
    fs.writeFileSync(entry, '#!/bin/sh\n');
    fs.chmodSync(entry, 0o755);
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    const env = {
      ...process.env,
      BAOCUT_HOME: home,
      BAOCUT_RUNTIME_ENTRY: path.join(dir, 'no-such-runtime.ts'),
      BAOCUT_CLI_ENTRY: entry,
      PATH: path.join(dir, 'empty-bin'),
    };
    const result = await cli(['doctor', '--json'], env);
    expect(result.code).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.runtime).toBeUndefined();
    expect(envelope.result.checks.map((c: { id: string }) => c.id).slice(0, 3)).toEqual(['entry', 'runtime', 'credentials']);
    expect(envelope.result.checks[0]).toMatchObject({ id: 'entry', level: 'warn' });
    expect(envelope.next).toBe(`'${entry}' cli install`);
    expect(envelope.result.checks[2]).toMatchObject({ id: 'credentials', level: 'skip' });
    expect(fs.readdirSync(home)).toEqual([]);

    const human = await cli(['doctor', '--no-json'], env);
    expect(human.stdout).toMatch(/^! Command line: /);
    expect(human.stdout).toContain(`    fix: '${entry}' cli install`);

    expect((await cli(['doctor', 'extra', '--json'], env)).code).not.toBe(0);
    expect((await cli(['help', 'doctor'], env)).stdout).toMatch(/^baocut doctor\n/);
  });
});
