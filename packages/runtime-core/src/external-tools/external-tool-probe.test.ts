import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JobManager } from '@baocut/jobs';
import type { Logger } from '@baocut/harness';
import { ExternalToolService } from './external-tool-service.ts';
import { BUILTIN_TOOL_MANIFESTS, YT_DLP, type ToolManifest } from './tool-manifests.ts';
import { probeVersion } from './tool-probe.ts';

/**
 * 版本探测超时（issue #142）：macOS 上 yt-dlp 的单文件可执行程序冷启动偶尔超过第一次的时限。假工具是一个 sh 脚本，
 * 前几次调用 `exec sleep`（被杀掉），之后打印版本，并把调用次数写进文件。只在 POSIX 上跑。
 */

const VERSION = '2026.10.26';
const FAST = [300, 300];

interface FakeTool {
  file: string;
  dir: string;
  calls: () => Promise<number>;
}

async function writeSlowTool(dir: string, slowCalls: number): Promise<FakeTool> {
  const bin = path.join(dir, 'bin');
  await fs.mkdir(bin, { recursive: true });
  const counter = path.join(dir, 'calls');
  const file = path.join(bin, 'yt-dlp');
  await fs.writeFile(
    file,
    [
      '#!/bin/sh',
      `n=$(/bin/cat '${counter}' 2>/dev/null || echo 0)`,
      'n=$((n + 1))',
      `echo "$n" > '${counter}'`,
      `if [ "$n" -le ${slowCalls} ]; then exec /bin/sleep 5; fi`,
      `echo ${VERSION}`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  return { file, dir: bin, calls: async () => Number((await fs.readFile(counter, 'utf8').catch(() => '0')).trim()) };
}

const noopLog = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger;
// 探测与状态只读任务列表（有没有在装、在更新）。
const noJobs = { list: () => [] } as unknown as JobManager;
// 不判断系统里那一份的安装方式（与探测无关）。
const manifest: ToolManifest = { ...BUILTIN_TOOL_MANIFESTS.find((m) => m.name === YT_DLP)!, update: undefined };

describe.skipIf(process.platform === 'win32')('版本探测超时', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-probe-timeout-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  function service(searchPath: string): ExternalToolService {
    return new ExternalToolService({
      toolsDir: path.join(dir, 'tools'),
      storeFile: path.join(dir, 'store', 'external-tools.json'),
      jobs: noJobs,
      log: noopLog,
      env: async () => ({ PATH: searchPath }),
      settings: () => ({ downloadEndpoint: null, offlineStrict: false }),
      overrides: {},
      manifests: [manifest],
      probeTimeoutsMs: FAST,
    });
  }

  it('probeVersion：只在超时后用下一个时限再试；启动失败与非零退出不重试', async () => {
    const once = await writeSlowTool(path.join(dir, 'once'), 1);
    expect(await probeVersion(once.file, ['--version'], {}, [], FAST)).toEqual({ ok: true, output: `${VERSION}\n` });
    expect(await once.calls()).toBe(2);

    const always = await writeSlowTool(path.join(dir, 'always'), 99);
    const timedOut = await probeVersion(always.file, ['--version'], {}, [], FAST);
    expect(timedOut).toMatchObject({ ok: false, timedOut: true });
    expect(await always.calls()).toBe(2);

    const failing = path.join(dir, 'failing');
    await fs.writeFile(failing, `#!/bin/sh\necho x >> '${failing}.calls'\nexit 3\n`, { mode: 0o755 });
    expect(await probeVersion(failing, ['--version'], {}, [], FAST)).toMatchObject({ ok: false });
    expect((await fs.readFile(`${failing}.calls`, 'utf8')).trim().split('\n')).toHaveLength(1);

    const missing = await probeVersion(path.join(dir, 'nope'), ['--version'], {}, [], FAST);
    expect(missing).toMatchObject({ ok: false });
    expect((missing as { timedOut?: boolean }).timedOut).toBeUndefined();
  });

  it('第一次超时、第二次给出版本：不打断流程；之后文件没变时不再执行 --version，重新检测总是执行', async () => {
    const tool = await writeSlowTool(dir, 1);
    const tools = service(tool.dir);
    // 同意时返回的状态里第一次探测：超时一次，重试通过。
    const { tool: consented } = await tools.consent({ name: YT_DLP, grant: true });
    expect(consented).toMatchObject({ state: 'installed', version: VERSION });
    expect(await tool.calls()).toBe(2);
    const resolved = await tools.resolveForUse(YT_DLP);
    expect(resolved).toMatchObject({ command: tool.file, version: VERSION, source: 'system' });
    expect(await tool.calls()).toBe(2);

    // 链接导入的准备、解析与下载各解析一次工具：文件没变，沿用上次通过的探测。
    await tools.resolveForUse(YT_DLP);
    expect((await tools.status(YT_DLP)).state).toBe('installed');
    expect(await tool.calls()).toBe(2);

    // 重新检测总是执行。
    expect((await tools.detect(YT_DLP))[0]).toMatchObject({ state: 'installed', version: VERSION });
    expect(await tool.calls()).toBe(3);

    // 文件换了（例如更新了）：重新执行。
    await fs.writeFile(tool.file, `#!/bin/sh\necho 2026.11.01\n`, { mode: 0o755 });
    expect((await tools.resolveForUse(YT_DLP)).version).toBe('2026.11.01');
  });

  it('重试之后仍超时：TOOL_UNAVAILABLE，补救是重新检测再试而不是重新安装；之后能运行了重新检测就恢复', async () => {
    const tool = await writeSlowTool(dir, 2);
    const tools = service(tool.dir);
    const error = await tools.resolveForUse(YT_DLP).then(
      () => null,
      (e: unknown) => e as { message: string; details: Record<string, unknown> },
    );
    expect(error?.details).toMatchObject({ code: 'TOOL_UNAVAILABLE', state: 'unavailable' });
    expect(String(error?.details.remedy)).toContain(`baocut external-tools detect ${YT_DLP}`);
    expect(String(error?.details.remedy)).not.toContain('install');
    expect(await tool.calls()).toBe(2);

    // 失败的探测不沿用：下一次解析重新执行，这次能运行了。
    expect((await tools.detect(YT_DLP))[0]).toMatchObject({ state: 'installed', version: VERSION });
    expect(await tool.calls()).toBe(3);
  });

  it('可执行文件确实不在：仍是没有安装，补救照旧是下载或指定路径', async () => {
    const empty = path.join(dir, 'empty');
    await fs.mkdir(empty);
    const status = await service(empty).status(YT_DLP);
    expect(status).toMatchObject({ state: 'missing' });
    expect(status.remedy).toContain('externalTools.install');
  });
});
