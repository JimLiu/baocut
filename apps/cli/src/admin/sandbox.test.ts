import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../cli.ts';
import type { LaunchSpec } from '../runtime/connection.ts';
import { adminBucket } from './index.ts';
import { psQuote, sandboxCli, sandboxFiles, shQuote, type SandboxPlan } from './sandbox.ts';
import { M } from './sandbox-copy.ts';

let root: string;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-sandbox-')));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

/** 进程内跑 `runCli`（stdout 不是 TTY：JSON 信封）。环境里不带 `BAOCUT_RUNTIME_ENTRY`：沙盒只认仓库自己的 Runtime。 */
async function cli(argv: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number; json: any; stderr: string }> {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const chunks = { stdout: '', stderr: '' };
  stdout.on('data', (chunk) => (chunks.stdout += String(chunk)));
  stderr.on('data', (chunk) => (chunks.stderr += String(chunk)));
  const base: NodeJS.ProcessEnv = { ...process.env, BAOCUT_HOME: path.join(root, 'unused-home') };
  delete base.BAOCUT_RUNTIME_ENTRY;
  const code = await runCli(argv, adminBucket, { cwd: root, env: { ...base, ...env }, stdout, stderr });
  return { code, json: chunks.stdout ? JSON.parse(chunks.stdout) : null, stderr: chunks.stderr };
}

const file = (plan: SandboxPlan, name: string) => plan.files.find((f) => path.win32.basename(f.path) === name)!;

describe('sandbox files (CLI standalone §7.2)', () => {
  const cli = { command: '/opt/node 22/bin/node', args: ['--experimental-strip-types', "/src/it's/apps/cli/src/main.ts"] };

  it('quotes values for sh and PowerShell', () => {
    expect(shQuote("a b'c")).toBe(`'a b'\\''c'`);
    expect(psQuote("a b'c\u2019d")).toBe("'a b''c\u2019\u2019d'");
  });

  it('writes a sh wrapper, env.sh and env.ps1 on macOS and Linux', () => {
    const dir = "/tmp/my sand'box";
    const plan = sandboxFiles(dir, cli, 'darwin');
    expect(plan.files.map((f) => path.posix.relative(dir, f.path))).toEqual(['bin/baocut', 'env.sh', 'env.ps1']);
    expect(plan.env).toEqual({ BAOCUT_HOME: dir, BAOCUT_PROJECTS_DIR: `${dir}/projects`, BAOCUT_CLI: `${dir}/bin/baocut` });
    expect(file(plan, 'baocut').executable).toBe(true);
    expect(file(plan, 'baocut').content).toContain(
      `exec '/opt/node 22/bin/node' '--experimental-strip-types' '/src/it'\\''s/apps/cli/src/main.ts' "$@"`,
    );
    expect(file(plan, 'env.sh').content.split('\n').slice(1)).toEqual([
      `export BAOCUT_HOME='/tmp/my sand'\\''box'`,
      `export BAOCUT_PROJECTS_DIR='/tmp/my sand'\\''box/projects'`,
      `export BAOCUT_CLI='/tmp/my sand'\\''box/bin/baocut'`,
      `export PATH='/tmp/my sand'\\''box/bin':"$PATH"`,
      '',
    ]);
    const ps1 = file(plan, 'env.ps1').content;
    expect(ps1.startsWith('\ufeff')).toBe(true);
    expect(ps1).toContain(`$env:PATH = '/tmp/my sand''box/bin' + [IO.Path]::PathSeparator + $env:PATH`);
    expect(plan.use).toEqual([
      { shell: 'sh', command: `. '/tmp/my sand'\\''box/env.sh'` },
      { shell: 'powershell', command: `. '/tmp/my sand''box/env.ps1'` },
    ]);
  });

  it('writes baocut.cmd and env.ps1 on Windows', () => {
    const dir = 'C:\\Users\\me\\sand 100%';
    const plan = sandboxFiles(dir, { command: 'C:\\Program Files\\nodejs\\node.exe', args: ['C:\\src\\apps\\cli\\src\\main.ts'] }, 'win32');
    expect(plan.files.map((f) => f.path)).toEqual([`${dir}\\bin\\baocut.cmd`, `${dir}\\env.ps1`]);
    const cmd = file(plan, 'baocut.cmd').content;
    expect(cmd.split('\r\n')).toEqual([
      '@echo off',
      expect.stringMatching(/^rem /),
      'setlocal',
      'set "BAOCUT_HOME=C:\\Users\\me\\sand 100%%"',
      'set "BAOCUT_PROJECTS_DIR=C:\\Users\\me\\sand 100%%\\projects"',
      '"C:\\Program Files\\nodejs\\node.exe" "C:\\src\\apps\\cli\\src\\main.ts" %*',
      '',
    ]);
    expect(file(plan, 'env.ps1').content).toContain(`$env:BAOCUT_CLI = 'C:\\Users\\me\\sand 100%\\bin\\baocut.cmd'`);
    expect(plan.use).toEqual([{ shell: 'powershell', command: `. 'C:\\Users\\me\\sand 100%\\env.ps1'` }]);
  });

  it.skipIf(process.platform === 'win32')('env.sh and the wrapper work in a real sh, with a space and a quote in the path', () => {
    const dir = path.join(root, "my sand'box");
    // 用 sh 当「CLI」：打印它收到的环境与参数。
    const fake = { command: '/bin/sh', args: ['-c', 'printf "%s|%s|%s\\n" "$BAOCUT_HOME" "$BAOCUT_PROJECTS_DIR" "$1"', 'cli'] };
    const plan = sandboxFiles(dir, fake, process.platform);
    for (const f of plan.files) {
      fs.mkdirSync(path.dirname(f.path), { recursive: true });
      fs.writeFileSync(f.path, f.content, { mode: f.executable ? 0o755 : 0o644 });
    }
    const out = execFileSync('/bin/sh', ['-c', `${plan.use[0]!.command} && baocut "a b" && printf '%s\\n' "$BAOCUT_CLI"`], {
      encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin' },
    });
    expect(out.split('\n')).toEqual([`${dir}|${dir}/projects|a b`, `${dir}/bin/baocut`, '']);
  });
});

describe('sandboxCli: only the repository CLI with a file credential store', () => {
  const repoLaunch: LaunchSpec = { command: 'node', args: ['/src/apps/runtime/src/main.ts'], env: {}, source: 'repo', own: true };
  const source = { command: 'node', args: ['/src/apps/cli/src/main.ts'], entry: null };

  it('accepts the repository CLI', () => {
    expect(sandboxCli({}, source, repoLaunch)).toEqual({ command: 'node', args: ['/src/apps/cli/src/main.ts'] });
  });

  it("refuses the app's CLI, a keychain Runtime and an unknown entry", () => {
    const packaged = { command: '/Applications/BaoCut.app/Contents/MacOS/baocut-cli', args: [], entry: '/Applications/BaoCut.app/Contents/MacOS/baocut-cli' };
    const keychain: LaunchSpec = { command: 'BaoCut', args: ['runtime.js', '--credential-store', 'keychain'], env: {}, source: 'packaged' };
    const entry: LaunchSpec = { command: 'node', args: ['/elsewhere/main.ts'], env: {}, source: 'env' };
    expect(() => sandboxCli({}, packaged, keychain)).toThrow(expect.objectContaining({ code: 'SANDBOX_NEEDS_SOURCE_CLI' }));
    expect(() => sandboxCli({}, null, repoLaunch)).toThrow(expect.objectContaining({ code: 'SANDBOX_NEEDS_SOURCE_CLI' }));
    expect(() => sandboxCli({}, source, keychain)).toThrow(expect.objectContaining({ code: 'SANDBOX_NEEDS_SOURCE_CLI' }));
    expect(() => sandboxCli({}, source, entry)).toThrow(M.unknownStore('/elsewhere/main.ts'));
  });
});

describe('baocut sandbox create', () => {
  it('creates the home, projects folder and files, and refreshes them on a second run', async () => {
    const dir = path.join(root, 'sb');
    const first = await cli(['sandbox', 'create', 'sb']);
    expect(first.code).toBe(0);
    expect(first.json.result).toMatchObject({ home: dir, projectsDir: path.join(dir, 'projects'), refreshed: false });
    expect(first.json.result.linked).toBeUndefined();
    expect(first.json.next).toBe(process.platform === 'win32' ? `. '${dir}\\env.ps1'` : `. '${dir}/env.sh'`);
    expect(fs.statSync(path.join(dir, 'projects')).isDirectory()).toBe(true);
    for (const f of first.json.result.files) expect(fs.existsSync(f)).toBe(true);
    if (process.platform !== 'win32') {
      expect(fs.statSync(first.json.result.cli).mode & 0o777).toBe(0o755);
      // 包装脚本跑的是这份仓库的 CLI。
      expect(fs.readFileSync(first.json.result.cli, 'utf8')).toContain(path.join('apps', 'cli', 'src', 'main.ts'));
    }
    // 没有拉起 Runtime：只写了这几样。
    expect(fs.readdirSync(dir).sort()).toEqual(process.platform === 'win32' ? ['bin', 'env.ps1', 'projects'] : ['bin', 'env.ps1', 'env.sh', 'projects']);

    const second = await cli(['sandbox', 'create', dir]);
    expect(second.code).toBe(0);
    expect(second.json.result.refreshed).toBe(true);
  });

  it('refuses the default home before creating anything', async () => {
    const fakeUser = path.join(root, 'user');
    vi.spyOn(os, 'homedir').mockReturnValue(fakeUser);
    const result = await cli(['sandbox', 'create', '~/.baocut']);
    expect(result.code).toBe(4);
    expect(result.json.error).toMatchObject({ code: 'INVALID_ARGUMENTS' });
    expect(result.json.error.message).toContain(path.join(fakeUser, '.baocut'));
    expect(fs.existsSync(fakeUser)).toBe(false);
  });

  it('refuses a folder with someone else’s files, and BAOCUT_RUNTIME_ENTRY, leaving them untouched', async () => {
    const busy = path.join(root, 'busy');
    fs.mkdirSync(busy);
    fs.writeFileSync(path.join(busy, 'notes.txt'), 'mine');
    const notEmpty = await cli(['sandbox', 'create', busy]);
    expect(notEmpty.code).toBe(4);
    expect(fs.readdirSync(busy)).toEqual(['notes.txt']);

    // 已经是 BaoCut Home（Runtime 跑过）的可以。
    fs.mkdirSync(path.join(busy, 'store'));
    expect((await cli(['sandbox', 'create', busy])).json.result.refreshed).toBe(true);

    const entry = await cli(['sandbox', 'create', path.join(root, 'other')], { BAOCUT_RUNTIME_ENTRY: path.join(root, 'runtime.ts') });
    expect(entry.code).toBe(1);
    expect(entry.json.error.code).toBe('SANDBOX_NEEDS_SOURCE_CLI');
    expect(fs.existsSync(path.join(root, 'other'))).toBe(false);
  });

  it('usage errors and help do not create anything', async () => {
    for (const argv of [['sandbox'], ['sandbox', 'create'], ['sandbox', 'create', 'a', 'b'], ['sandbox', 'remove', 'a']]) {
      expect((await cli(argv)).code, argv.join(' ')).toBe(4);
    }
    const stdout = new PassThrough();
    let text = '';
    stdout.on('data', (chunk) => (text += String(chunk)));
    await runCli(['help', 'sandbox'], adminBucket, { cwd: root, env: { ...process.env, BAOCUT_HOME: path.join(root, 'h') }, stdout, stderr: new PassThrough() });
    expect(text).toContain(M.help.split('\n')[1]!.trim());
    expect(fs.readdirSync(root)).toEqual([]);
  });
});
