import { M } from '../admin/skills-copy.ts';
import { cliInstallCommand, terminalLines, tildeOf } from '../admin/cli-entry.ts';
import { CliError, type ExitCode, type Output } from '../envelope.ts';
import { ownStandalonePackage, type StandalonePackage } from '../runtime/connection.ts';
import { StandaloneInstaller, type CommandRunner, type StandaloneEntryStatus } from './install.ts';
import { rollbackStandalone, updateStandalone, type UpdateDeps } from './update.ts';
import { S } from './standalone-copy.ts';

/**
 * 独立 CLI 包里的 `baocut cli install|status|remove` 与 `baocut update`（CLI 独立使用与发布 §9.3、§9.5）。不连 Runtime：入口与
 * 版本目录是独立包自己的事，Runtime 坏了也要能装、能更新。App 里的 CLI 照旧经 `cliEntry.*`（`admin/cli-entry.ts`）。
 */

export interface StandaloneIo {
  output: Output;
  env: NodeJS.ProcessEnv;
  /** Runtime Home。 */
  home: string;
  /** 测试换掉：本包、平台、命令、网络。 */
  own?: StandalonePackage | null;
  platform?: NodeJS.Platform;
  run?: CommandRunner;
  fetch?: typeof fetch;
  systemVersion?: UpdateDeps['systemVersion'];
}

function installerOf(io: StandaloneIo): StandaloneInstaller {
  return new StandaloneInstaller({ env: io.env, platform: io.platform, run: io.run });
}

function userHome(env: NodeJS.ProcessEnv): string {
  return env.HOME || env.USERPROFILE || '';
}

/** `3.17.0-build.93` → `3.17.0 (build 93)`。 */
export function versionLabel(name: string): string {
  const match = /^(.+)-build\.(\d+)$/.exec(name);
  return match ? S.version(match[1]!, Number(match[2])) : name;
}

// ---- baocut cli install|status|remove ----

export async function standaloneCli(io: StandaloneIo, own: StandalonePackage, sub: string | undefined): Promise<ExitCode | null> {
  const installer = installerOf(io);
  const tilde = tildeOf(userHome(io.env));
  if (sub === 'status') {
    const status = installer.status(installer.readState().current);
    // 入口不在时终端找不到 baocut：补救写本包启动器的完整路径。
    const next = status.state === 'current' ? null : cliInstallCommand(own.launcher, installer.platform);
    return io.output.report(status, statusLines(status, own, installer, io.env), next);
  }
  if (sub === 'install') {
    // 先看入口能不能放，再拷几百 MB 的包。
    if (installer.inspect(null).state === 'foreign') throw new CliError('CLI_ENTRY_TAKEN', S.entryTaken(installer.places.entry), { path: installer.places.entry });
    const name = await installer.adopt(own);
    const state = installer.readState();
    if (state.current !== name) installer.writeState({ current: name, previous: state.current });
    await installer.point(name);
    const status = installer.status(name);
    const lines: string[] = [];
    if (!installer.versionOf(own)) lines.push(S.copied(tilde(installer.versionPath(name)), tilde(own.root)));
    lines.push(M.cliInstalled(tilde(status.path), tilde(status.entry ?? '')));
    if (installer.platform === 'win32') lines.push(M.cliWindowsPath(installer.places.entry.replace(/\\[^\\]+$/, '')));
    lines.push(...terminalLines(status, userHome(io.env), installer.platform === 'win32'));
    return io.output.report(status, lines);
  }
  if (sub === 'remove') {
    const found = installer.inspect(installer.readState().current);
    if (found.state === 'foreign') throw new CliError('CLI_ENTRY_TAKEN', S.entryTaken(installer.places.entry), { path: installer.places.entry });
    if (found.state !== 'none') await installer.unplace();
    const status = installer.status(installer.readState().current);
    const at = tilde(installer.places.entry);
    return io.output.report(status, [
      found.state === 'none' ? M.cliNothingToRemove(at) : M.cliRemoved(at),
      S.versionsKept(tilde(installer.places.versions)),
    ]);
  }
  return null;
}

function statusLines(status: StandaloneEntryStatus, own: StandalonePackage, installer: StandaloneInstaller, env: NodeJS.ProcessEnv): string[] {
  const tilde = tildeOf(userHome(env));
  const { current, previous, versions, root } = status.installed;
  const lines = [
    M.cliStatusEntry(tilde(status.path), status.target && tilde(status.target), S.state[status.state === 'standalone' ? 'stale' : status.state]),
    S.statusPackage(versionLabel(installer.versionOf(own) ?? `${own.manifest.version}-build.${own.manifest.build}`), tilde(own.root)),
    versions.length === 0
      ? S.statusNoVersions(tilde(root))
      : S.statusVersions(
          versions.map((name) => `${versionLabel(name)}${name === current ? S.currentMark : name === previous ? S.previousMark : ''}`),
          tilde(root),
        ),
  ];
  lines.push(...terminalLines(status, userHome(env)));
  return lines;
}

// ---- baocut update [--check | --rollback] ----

export async function standaloneUpdate(io: StandaloneIo, args: readonly string[]): Promise<ExitCode> {
  const flags = new Set<string>();
  for (const token of args) {
    if (token !== '--check' && token !== '--rollback') throw new CliError('INVALID_ARGUMENTS', S.updateUsage(token));
    flags.add(token);
  }
  if (flags.size > 1) throw new CliError('INVALID_ARGUMENTS', S.updateUsage('--check --rollback'));
  const own = io.own === undefined ? ownStandalonePackage(io.platform) : io.own;
  if (!own) throw new CliError('UPDATE_UNAVAILABLE', S.updateUnavailable);
  const installer = installerOf(io);
  const tilde = tildeOf(userHome(io.env));
  const log = (line: string) => io.output.stderr.write(`${line}\n`);

  if (flags.has('--rollback')) {
    const result = await rollbackStandalone({ installer, own, home: io.home });
    const lines = [S.rolledBack(versionLabel(result.from), versionLabel(result.to)), ...entryLines(result.entry, tilde), ...runtimeLines(result.runtime)];
    return io.output.report(result, lines);
  }
  const result = await updateStandalone(
    { installer, own, env: io.env, home: io.home, fetch: io.fetch, run: io.run, systemVersion: io.systemVersion, log },
    { check: flags.has('--check') },
  );
  if (!result.updated) {
    const lines = [result.available ? S.available(versionLabel(result.latest), versionLabel(result.current)) : S.upToDate(versionLabel(result.current))];
    return io.output.report(result, lines, result.available ? 'baocut update' : null);
  }
  const lines = [S.updated(versionLabel(result.current), versionLabel(result.latest))];
  if (result.entry) lines.push(...entryLines(result.entry, tilde));
  if (result.removed?.length) lines.push(S.removedVersions(result.removed.map(versionLabel)));
  lines.push(...runtimeLines(result.runtime ?? null), S.rollbackHint);
  return io.output.report(result, lines);
}

function entryLines(entry: { path: string; state: string; switched: boolean }, tilde: (p: string) => string): string[] {
  if (entry.switched) return [S.entrySwitched(tilde(entry.path))];
  return [entry.state === 'none' ? S.entryNotInstalled(tilde(entry.path)) : S.entryLeftAlone(tilde(entry.path))];
}

function runtimeLines(runtime: { pid: number } | null | undefined): string[] {
  return runtime ? [S.runtimeStillRunning(runtime.pid)] : [];
}
