import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { guardRunningApp, listProcesses, parseProcessList, processesRunning, type ProcessInfo } from './running-app-guard.ts';

const OUT = resolve('/repo/apps/desktop/out');
const SCRIPT = resolve(OUT, 'main/runtime.js');

/** 按 Vite 的调用方式跑插件的两个钩子；`this.error` 照 Rollup 抛出。 */
function runGuard(list: () => ProcessInfo[], outDir = resolve(OUT, 'main'), times = 1) {
  const plugin = guardRunningApp(list);
  const warnings: string[] = [];
  const context = {
    warn: (message: string) => void warnings.push(message),
    error: (message: string) => {
      throw new Error(message);
    },
  };
  (plugin.configResolved as (config: unknown) => void)({ root: '/repo/apps/desktop', build: { outDir } });
  for (let i = 0; i < times; i += 1) (plugin.buildStart as (this: typeof context) => void).call(context);
  return warnings;
}

afterEach(() => {
  vi.unstubAllEnvs();
  process.exitCode = undefined;
});

describe('构建前查有没有应用在用这份产物', () => {
  it('解析 ps 与 PowerShell 的输出，跳过没有命令行的进程', () => {
    const ps = `  6609 /Applications/Electron.app/Contents/MacOS/Electron ${SCRIPT} --quiet --credential-store file\n    1 /sbin/launchd\n`;
    expect(parseProcessList(ps)).toEqual([
      { pid: 6609, command: `/Applications/Electron.app/Contents/MacOS/Electron ${SCRIPT} --quiet --credential-store file` },
      { pid: 1, command: '/sbin/launchd' },
    ]);
    expect(parseProcessList('4 \r\n812 "C:\\BaoCut\\electron.exe" C:\\BaoCut\\out\\main\\runtime.js\r\n')).toEqual([
      { pid: 812, command: '"C:\\BaoCut\\electron.exe" C:\\BaoCut\\out\\main\\runtime.js' },
    ]);
  });

  it('只认这份产物的 runtime.js 作为完整参数，别的检出、路径前缀与自己不算', () => {
    const processes: ProcessInfo[] = [
      { pid: 10, command: `/x/Electron ${SCRIPT} --quiet` },
      { pid: 11, command: `/x/Electron /repo-wt/apps/desktop/out/main/runtime.js` },
      { pid: 12, command: `/x/Electron /tmp${SCRIPT}` },
      { pid: 13, command: `/x/Electron ${SCRIPT}.map` },
      { pid: 14, command: `/x/Electron "${SCRIPT}"` },
      { pid: 99, command: `/x/node ${SCRIPT}` },
    ];
    expect(processesRunning(SCRIPT, processes, 'darwin', 99).map(({ pid }) => pid)).toEqual([10, 14]);
  });

  it('路径里有空格也能认出', () => {
    const script = '/Users/a b/baocut/apps/desktop/out/main/runtime.js';
    expect(processesRunning(script, [{ pid: 7, command: `/x/Electron ${script} --quiet` }], 'darwin', 1)).toHaveLength(1);
  });

  it('Windows 上不分大小写与斜杠方向', () => {
    const script = 'C:\\Users\\Jim\\baocut\\apps\\desktop\\out\\main\\runtime.js';
    const command = '"C:\\Users\\Jim\\baocut\\node_modules\\electron\\dist\\electron.exe" c:/users/jim/baocut/apps/desktop/out/main/runtime.js --quiet';
    expect(processesRunning(script, [{ pid: 7, command }], 'win32', 1)).toHaveLength(1);
    expect(processesRunning(script, [{ pid: 7, command }], 'linux', 1)).toHaveLength(0);
  });

  it('有应用在跑时让构建失败，写明 pid 与出路', () => {
    const list = () => [{ pid: 6609, command: `/x/Electron ${SCRIPT} --quiet` }];
    expect(() => runGuard(list)).toThrow(/is in use: a BaoCut Runtime is running from .*runtime\.js \(pid 6609\)/);
    expect(() => runGuard(list)).toThrow(/--outDir <absolute path>/);
    expect(() => runGuard(list)).toThrow(/BAOCUT_BUILD_FORCE=1/);
    expect(process.exitCode).toBe(1);
  });

  it('没有应用在跑、产物改到别处或设了 BAOCUT_BUILD_FORCE=1 时照常构建', () => {
    const list = () => [{ pid: 6609, command: `/x/Electron ${SCRIPT} --quiet` }];
    expect(runGuard(() => [])).toEqual([]);
    expect(runGuard(list, '/tmp/desktop-out/main')).toEqual([]);
    vi.stubEnv('BAOCUT_BUILD_FORCE', '1');
    expect(runGuard(list)).toEqual([]);
  });

  it('只在第一次构建时查：watch 模式之后的重新构建遇到的是这次开发自己的应用', () => {
    const list = vi.fn(() => []);
    runGuard(list, undefined, 3);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('列不出进程时只提醒，不拦构建', () => {
    const warnings = runGuard(() => {
      throw new Error('spawn ps ENOENT');
    });
    expect(warnings).toEqual([expect.stringContaining('spawn ps ENOENT')]);
  });

  it('本机的进程列表里有这个测试进程自己', () => {
    expect(listProcesses().some(({ pid }) => pid === process.pid)).toBe(true);
  });
});
