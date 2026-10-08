import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { CodeBundleError, CompositionHost, resolveElectronBinary } from '@baocut/code-runtime';
import { editorSemantics, locateEditorWasm } from '@baocut/editor-wasm';
import { resolveSpeechWorkerCommand } from '@baocut/jobs';
import { WORKER_CONTRACT_VERSION, resolveModelAssetsDir } from '@baocut/models';
import { resolveCredentialHelperCommand } from './credentials.ts';
import { resolveExportWorkerCommand } from './exports/video-export.ts';
import { resolveModelWorkerCommand } from './models/model-worker.ts';
import { resolveWebDist } from './services/web-static.ts';
import { resolveBuiltinAgentSkillsDir } from './skills/agent-skill-renderer.ts';
import { resolveBuiltinSkillsDir } from './skills/skill-catalog.ts';
import { resolveBuiltinTemplatesDir } from './templates/template-catalog.ts';
import { resolveEngineHostCommand } from './videos/engine-host.ts';

/**
 * Runtime 的自检（`runtime --self-check [--probe]`）：不启动 Runtime，只用它找东西的同一批解析函数，报告随应用分发的原生程序
 * （Worker、凭据助手）、内置模板与 skill、模型数据、Web 客户端与 `editor.wasm` 解析到哪里、在不在。给了 `probe` 时再把每个原生程序
 * 起一次、走一遍它的握手，证明在这台机器上能启动（缺 DLL、架构不对都在这里暴露）；代码包的 Electron 离屏宿主也起一次、等到 ready 再关掉
 * （`probeCompositionHost`），打包后走的是主进程入口的 `--composition-host` 分支。
 *
 * 主要给打包产物用：桌面应用的检查脚本（`apps/desktop/tools/check-packaged-app.mjs`）以应用的可执行文件按 Node 方式运行打进
 * asar 的 `runtime.js`，环境变量与主进程启动 Runtime 时给的一样。不碰 Runtime Home、不联网。
 */

export interface SelfCheckProbe {
  ok: boolean;
  detail: string;
  reply?: unknown;
}

export interface SelfCheckReport {
  platform: NodeJS.Platform;
  arch: string;
  binaries: Record<string, string | null>;
  dirs: Record<string, string | null>;
  editorWasm: string | null;
  probes: Record<string, SelfCheckProbe>;
  /** 不对的项；空表示通过。 */
  problems: string[];
}

const PROBE_TIMEOUT_MS = 20_000;

interface ProbeSpec {
  args: string[];
  /** 写给它的一行请求；null 表示不写，只关掉 stdin 看退出码。 */
  request: unknown;
  /** 回复算不算成功。 */
  accept?: (reply: unknown) => boolean;
  /** 不写请求时期望的退出码。 */
  exitCode?: number;
}

function probe(command: string, spec: ProbeSpec): Promise<SelfCheckProbe> {
  return new Promise((resolve) => {
    let settled = false;
    let stderr = '';
    const child = spawn(command, spec.args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const finish = (result: SelfCheckProbe) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, detail: `timed out (${PROBE_TIMEOUT_MS} ms): ${stderr.trim()}` }), PROBE_TIMEOUT_MS);
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-2000);
    });
    child.once('error', (error) => finish({ ok: false, detail: `failed to start: ${error.message}` }));
    // 用 close（stdio 都关了之后）而不是 exit：答一行就退出的程序，回复要先读到。Windows 上缺 DLL 是 0xC0000135（-1073741515）。
    child.once('close', (code, signal) => {
      if (spec.request === null && code === spec.exitCode) finish({ ok: true, detail: `exit code ${code}` });
      else finish({ ok: false, detail: `exited (${signal ?? `exit code ${code}`}): ${stderr.trim()}` });
    });
    child.stdin.on('error', () => {});
    if (spec.request === null) {
      child.stdin.end();
      return;
    }
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let reply: unknown;
      try {
        reply = JSON.parse(line);
      } catch {
        return;
      }
      const ok = spec.accept ? spec.accept(reply) : true;
      finish({ ok, detail: ok ? 'ok' : 'unexpected reply', reply });
    });
    child.stdin.write(`${JSON.stringify(spec.request)}\n`);
  });
}

/**
 * 离屏宿主：按 Runtime 同样的方式（`resolveElectronBinary`、`CompositionHost.start` 的默认超时）拉起，等到 `ready` 再关掉。
 * 宿主脚本与它的 Electron 数据目录写在系统临时目录（不给 `cacheDir`），不碰 Runtime Home。
 */
export async function probeCompositionHost(env: NodeJS.ProcessEnv = process.env): Promise<SelfCheckProbe> {
  if (!resolveElectronBinary(env)) return { ok: false, detail: 'Electron was not found; set BAOCUT_ELECTRON to the Electron executable' };
  const started = Date.now();
  let host: CompositionHost;
  try {
    host = await CompositionHost.start({ env });
  } catch (error) {
    if (!(error instanceof CodeBundleError)) return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    const { stderr } = (error.details ?? {}) as { stderr?: unknown };
    const tail = typeof stderr === 'string' && stderr.trim() ? `: ${stderr.trim().slice(-1500)}` : '';
    return { ok: false, detail: `${error.code}: ${error.message}${tail}` };
  }
  const readyMs = Date.now() - started;
  await host.close();
  return { ok: true, detail: `ready in ${readyMs} ms` };
}

/** JSON 行 Worker 的回复：有 `result`、没有 `error`。 */
function hasResult(reply: unknown): boolean {
  return typeof reply === 'object' && reply !== null && 'result' in reply && !('error' in reply && (reply as { error?: unknown }).error);
}

export async function runtimeSelfCheck(options: { probe?: boolean; env?: NodeJS.ProcessEnv } = {}): Promise<SelfCheckReport> {
  const env = options.env ?? process.env;
  const engineHost = resolveEngineHostCommand(env);
  const binaries: Record<string, string | null> = {
    'engine-host': engineHost,
    'export-worker': resolveExportWorkerCommand(engineHost, env),
    'model-worker': resolveModelWorkerCommand(env)?.command ?? null,
    'speech-worker': resolveSpeechWorkerCommand(engineHost, env),
    'credential-helper': resolveCredentialHelperCommand(env)?.command ?? null,
    // 代码包的离屏宿主用的 Electron：打包后是应用自己的可执行文件。
    electron: resolveElectronBinary(env),
  };
  const dirs: Record<string, string | null> = {
    templates: resolveBuiltinTemplatesDir(env),
    skills: resolveBuiltinSkillsDir(env),
    agentSkills: resolveBuiltinAgentSkillsDir(env),
    modelAssets: resolveModelAssetsDir(env),
    web: resolveWebDist(env),
  };
  const editorWasm = locateEditorWasm();

  const problems: string[] = [];
  for (const [name, file] of Object.entries(binaries)) {
    if (!file || !isFile(file)) problems.push(`${name}: did not resolve to an existing file (${file ?? 'null'})`);
  }
  for (const [name, dir] of Object.entries(dirs)) {
    if (!dir || !isDirectory(dir)) problems.push(`${name}: did not resolve to an existing directory (${dir ?? 'null'})`);
  }
  if (dirs.web && !isFile(path.join(dirs.web, 'index.html'))) problems.push(`web: no index.html in the directory (${dirs.web})`);
  try {
    editorSemantics();
  } catch (error) {
    problems.push(`editor.wasm: failed to load (${editorWasm ?? 'null'}): ${error instanceof Error ? error.message : String(error)}`);
  }

  const probes: Record<string, SelfCheckProbe> = {};
  if (options.probe) {
    const specs: Record<string, ProbeSpec> = {
      'engine-host': { args: [], request: { id: 1, method: 'host.hello', params: {} }, accept: hasResult },
      'model-worker': {
        args: ['--parent-pid', String(process.pid)],
        request: { id: 1, method: 'worker.hello', params: { contractVersion: WORKER_CONTRACT_VERSION } },
        accept: hasResult,
      },
      'speech-worker': { args: [], request: { id: 1, method: 'hello', params: {} }, accept: hasResult },
      // Render Worker 每次一个命令、没有握手：不给参数时打印用法并以 2 退出，足以证明能启动。
      'export-worker': { args: [], request: null, exitCode: 2 },
      // 凭据助手答一行就退出。macOS 以外答 unsupported 也算能启动：凭据不可用由 Runtime 如实报告（架构设计 §6.8）。
      'credential-helper': {
        args: [],
        request: { op: 'has', key: 'baocut.self-check' },
        accept: (reply) => typeof reply === 'object' && reply !== null && typeof (reply as { ok?: unknown }).ok === 'boolean',
      },
    };
    for (const [name, spec] of Object.entries(specs)) {
      const file = binaries[name];
      if (!file) continue;
      const result = await probe(file, spec);
      probes[name] = result;
      if (!result.ok) problems.push(`${name}: does not start (${result.detail})`);
    }
    const host = await probeCompositionHost(env);
    probes['composition-host'] = host;
    if (!host.ok) problems.push(`composition-host: does not start (${host.detail})`);
  }

  return { platform: process.platform, arch: process.arch, binaries, dirs, editorWasm, probes, problems };
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
