import fs from 'node:fs';
import path from 'node:path';
import type { ParseArgsOptionsConfig } from 'node:util';
import type { LinkProviderAccountsResult } from '@baocut/protocol';
import { CliError, type ExitCode } from '../envelope.ts';
import {
  connectRuntime,
  isDefaultHome,
  launchCredentialStore,
  launchEntry,
  ownCliCommand,
  resolveRuntimeLaunch,
  type LaunchSpec,
} from '../runtime/connection.ts';
import { absolutePath, defineNoun, type AdminRun, type AdminValues } from './context.ts';
import { linkResultLines } from './models.ts';
import { M } from './sandbox-copy.ts';

const OPTIONS = {
  'link-accounts-from': { type: 'string' },
} as const satisfies ParseArgsOptionsConfig;

type Ctx = AdminRun<AdminValues<typeof OPTIONS>>;

/**
 * 管理桶 `baocut sandbox create <目录> [--link-accounts-from <home>]`（CLI 独立使用与发布 §7.2）：给开发与测试搭一个隔离的
 * Runtime Home。建目录与里面的 `projects`，写 `bin/baocut`（用这份仓库的 CLI、带上这个 Home 的包装脚本）和切换 shell 用的
 * `env.sh` / `env.ps1`，按需只读地链接另一个 Home 的账号。
 *
 * 只从仓库运行：App 自带的 CLI 拉起的是 App 的 Runtime，密钥放在所有 Home 共用的钥匙串里，沙盒里删账号会删掉真实的密钥。
 * 包装脚本而不是 shell 函数：从这个 shell 启动的 Agent 是子进程，只继承环境变量与 PATH，看不到函数。
 */
export const sandbox = defineNoun({
  name: 'sandbox',
  verbs: ['create'],
  // 用法错误也不能去连当前的 Home（可能是默认的 ~/.baocut）；链接账号时自己连沙盒。
  offline: true,
  get usage() {
    return M.help;
  },
  options: OPTIONS,
  async run(ctx): Promise<ExitCode> {
    const [sub, target, ...extra] = ctx.args;
    if (sub !== 'create' || !target || extra.length > 0) throw ctx.usageError();
    // 先判断，再建任何东西：默认 Home、不对的 CLI、别人的文件夹都什么也不留下。
    const dir = absolutePath(target, ctx.cwd);
    if (isDefaultHome(dir)) throw ctx.usageError(M.defaultHome(dir));
    const env = { ...ctx.env, BAOCUT_HOME: dir };
    const cli = sandboxCli(env);
    const existed = checkFolder(dir);

    const plan = sandboxFiles(dir, cli);
    fs.mkdirSync(plan.projectsDir, { recursive: true });
    for (const file of plan.files) writeFile(file);
    const result: SandboxResult = {
      home: dir,
      projectsDir: plan.projectsDir,
      cli: plan.wrapper,
      env: plan.env,
      files: plan.files.map((file) => file.path),
      refreshed: existed,
    };
    const lines = [existed ? M.refreshed(dir) : M.created(dir), M.projects(plan.projectsDir), M.cli(plan.wrapper)];

    const from = ctx.values['link-accounts-from'];
    if (from !== undefined) {
      const source = absolutePath(from, ctx.cwd);
      try {
        result.linked = await linkAccounts(ctx, dir, env, source);
      } catch (error) {
        // 沙盒已经建好，不回滚：报出链接没成，修好来源后再跑一次（重跑只刷新文件）。
        ctx.log(M.linkFailed(dir));
        throw error;
      }
      lines.push(...linkResultLines(result.linked, source));
    }

    lines.push(M.useHeader, ...plan.use.map(({ command, shell }) => (shell === 'powershell' ? M.usePowerShell(command) : M.useShell(command))));
    lines.push(M.useNote);
    return ctx.done(result, lines, plan.use[0]!.command);
  },
});

export interface SandboxResult {
  home: string;
  projectsDir: string;
  /** 包装脚本：在任何 shell 里都用这个 Home 跑这份仓库的 CLI（`env.*` 把它放进 PATH，并设成 `BAOCUT_CLI`）。 */
  cli: string;
  /** `env.*` 设的环境变量。 */
  env: Record<'BAOCUT_HOME' | 'BAOCUT_PROJECTS_DIR' | 'BAOCUT_CLI', string>;
  files: string[];
  /** 目录原本就是 BaoCut Home 或沙盒：这次只刷新了文件。 */
  refreshed: boolean;
  linked?: LinkProviderAccountsResult;
}

/** 包装脚本里怎么启动 CLI。 */
export interface SandboxCommand {
  command: string;
  args: string[];
}

/**
 * 沙盒用哪个 CLI：只认从仓库运行的这一份（`ownCliCommand` 的 `entry` 为 null），而且它在这个 Home 上拉起的 Runtime 把密钥
 * 存在文件里。App 自带的 CLI、`BAOCUT_RUNTIME_ENTRY` 指的入口（不知道它把密钥放哪）都拒绝。
 */
export function sandboxCli(
  env: NodeJS.ProcessEnv,
  own: ReturnType<typeof ownCliCommand> = ownCliCommand(),
  launch: LaunchSpec | null = resolveRuntimeLaunch(env),
): SandboxCommand {
  if (own && own.entry === null && launch && launchCredentialStore(launch) === 'file') return { command: own.command, args: own.args };
  const message = launch?.source === 'env' ? M.unknownStore(launchEntry(launch)) : M.needsSourceCli;
  throw new CliError('SANDBOX_NEEDS_SOURCE_CLI', message);
}

/** 目录能不能用：不存在或是空的（点开头的不算）→ false；已经是 BaoCut Home 或沙盒 → true（只刷新）；别的拒绝。 */
function checkFolder(dir: string): boolean {
  let entries: string[];
  try {
    if (!fs.statSync(dir).isDirectory()) throw new CliError('INVALID_ARGUMENTS', M.notFolder(dir));
    entries = fs.readdirSync(dir).filter((name) => !name.startsWith('.'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  if (entries.length === 0) return false;
  if (entries.some((name) => HOME_MARKERS.includes(name))) return true;
  throw new CliError('INVALID_ARGUMENTS', M.notEmpty(dir));
}

/** 认得出是 BaoCut Home（Runtime 跑过）或沙盒（`sandbox create` 写过）的条目。 */
const HOME_MARKERS = ['store', 'runtime.json', 'env.sh', 'env.ps1'];

export interface SandboxFile {
  path: string;
  content: string;
  executable?: boolean;
}

export interface SandboxPlan {
  projectsDir: string;
  wrapper: string;
  env: SandboxResult['env'];
  files: SandboxFile[];
  /** 切换 shell 的命令，第一条是这个平台默认 shell 的（也是 `next`）。 */
  use: { shell: 'sh' | 'powershell'; command: string }[];
}

/**
 * 要写的文件。macOS 与 Linux：`bin/baocut`（sh）、`env.sh`、`env.ps1`（PowerShell 7）；Windows：`bin\baocut.cmd`、`env.ps1`。
 * 值都按各自的引号规则写（路径里可以有空格与引号）；`env.ps1` 带 BOM，Windows PowerShell 5.1 才按 UTF-8 读。
 */
export function sandboxFiles(dir: string, cli: SandboxCommand, platform: NodeJS.Platform = process.platform): SandboxPlan {
  const win = platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const projectsDir = p.join(dir, 'projects');
  const bin = p.join(dir, 'bin');
  const wrapper = p.join(bin, win ? 'baocut.cmd' : 'baocut');
  const env = { BAOCUT_HOME: dir, BAOCUT_PROJECTS_DIR: projectsDir, BAOCUT_CLI: wrapper };
  const ps1 = p.join(dir, 'env.ps1');
  const powershell = { shell: 'powershell' as const, command: `. ${psQuote(ps1)}` };
  if (win) {
    return {
      projectsDir,
      wrapper,
      env,
      files: [
        { path: wrapper, content: cmdWrapper(env, cli) },
        { path: ps1, content: envPs1(env, bin) },
      ],
      use: [powershell],
    };
  }
  const sh = p.join(dir, 'env.sh');
  return {
    projectsDir,
    wrapper,
    env,
    files: [
      { path: wrapper, content: shWrapper(env, cli), executable: true },
      { path: sh, content: envSh(env, bin) },
      { path: ps1, content: envPs1(env, bin) },
    ],
    use: [{ shell: 'sh', command: `. ${shQuote(sh)}` }, powershell],
  };
}

/** sh 的单引号：`'` 写成 `'\''`。 */
export function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** PowerShell 的单引号：`'` 写两次（弯引号 PowerShell 也当单引号）。 */
export function psQuote(value: string): string {
  return `'${value.replace(/['‘’‚‛]/g, '$&$&')}'`;
}

/** cmd 的值：放在双引号里，`%` 写成 `%%`（Windows 路径里没有双引号）。 */
function cmdValue(value: string): string {
  return value.replaceAll('%', '%%');
}

function shWrapper(env: SandboxResult['env'], cli: SandboxCommand): string {
  return [
    '#!/bin/sh',
    '# BaoCut sandbox (written by baocut sandbox create): runs this checkout\'s CLI on the sandbox home.',
    `BAOCUT_HOME=${shQuote(env.BAOCUT_HOME)}`,
    `BAOCUT_PROJECTS_DIR=${shQuote(env.BAOCUT_PROJECTS_DIR)}`,
    'export BAOCUT_HOME BAOCUT_PROJECTS_DIR',
    `exec ${[cli.command, ...cli.args].map(shQuote).join(' ')} "$@"`,
    '',
  ].join('\n');
}

function cmdWrapper(env: SandboxResult['env'], cli: SandboxCommand): string {
  return [
    '@echo off',
    "rem BaoCut sandbox (written by baocut sandbox create): runs this checkout's CLI on the sandbox home.",
    'setlocal',
    `set "BAOCUT_HOME=${cmdValue(env.BAOCUT_HOME)}"`,
    `set "BAOCUT_PROJECTS_DIR=${cmdValue(env.BAOCUT_PROJECTS_DIR)}"`,
    `${[cli.command, ...cli.args].map((part) => `"${cmdValue(part)}"`).join(' ')} %*`,
    '',
  ].join('\r\n');
}

function envSh(env: SandboxResult['env'], bin: string): string {
  return [
    '# BaoCut sandbox (written by baocut sandbox create). Source this file to use the sandbox in this shell.',
    `export BAOCUT_HOME=${shQuote(env.BAOCUT_HOME)}`,
    `export BAOCUT_PROJECTS_DIR=${shQuote(env.BAOCUT_PROJECTS_DIR)}`,
    `export BAOCUT_CLI=${shQuote(env.BAOCUT_CLI)}`,
    `export PATH=${shQuote(bin)}:"$PATH"`,
    '',
  ].join('\n');
}

function envPs1(env: SandboxResult['env'], bin: string): string {
  return `﻿${[
    '# BaoCut sandbox (written by baocut sandbox create). Dot-source this file to use the sandbox in this session.',
    `$env:BAOCUT_HOME = ${psQuote(env.BAOCUT_HOME)}`,
    `$env:BAOCUT_PROJECTS_DIR = ${psQuote(env.BAOCUT_PROJECTS_DIR)}`,
    `$env:BAOCUT_CLI = ${psQuote(env.BAOCUT_CLI)}`,
    `$env:PATH = ${psQuote(bin)} + [IO.Path]::PathSeparator + $env:PATH`,
    '',
  ].join('\n')}`;
}

function writeFile(file: SandboxFile): void {
  fs.mkdirSync(path.dirname(file.path), { recursive: true });
  fs.writeFileSync(file.path, file.content, file.executable ? { mode: 0o755 } : {});
  // 已有的文件 writeFileSync 不改权限。
  if (file.executable) fs.chmodSync(file.path, 0o755);
}

/** 在沙盒的 Runtime 上只读地链接来源 Home 的账号（与 `models accounts link --from` 同一个方法）。 */
async function linkAccounts(
  ctx: Ctx,
  dir: string,
  env: NodeJS.ProcessEnv,
  source: string,
): Promise<LinkProviderAccountsResult> {
  const session = await connectRuntime({ home: dir, start: ctx.values['no-start'] !== true, env });
  ctx.output.runtimeStarted = session.started;
  try {
    return await session.client.request('models.linkAccounts', { home: source });
  } finally {
    session.client.close();
  }
}
