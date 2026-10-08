import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { JsonLineWorker, WorkerExitedError, WorkerRequestError, WorkerTimeoutError, type WorkerEvent } from '@baocut/process-host';
import { CODE_BUNDLE_ERROR_CODES, type CodeBundleErrorCode, type FrameReceipt, type FrameTicket, type Rate } from '@baocut/protocol';
import { CodeBundleError, parseRate, type InspectedBundle } from './bundle-inspect.ts';
import { COMPOSITION_ADAPTER_SCRIPT, type AdapterPageInfo } from './composition-adapter.ts';
import { ADAPTER_PLACEHOLDER, COMPOSITION_HOST_SCRIPT } from './composition-host-script.ts';

/**
 * Electron 离屏宿主的 TypeScript 端（架构设计 §8.3–§8.4）：拉起 `<Electron> --composition-host host.cjs`（`hostSpawnArgs`），
 * 经 JSON 行协议打开会话、按票据取帧。
 *
 * 一个宿主进程可以开多个会话（每个会话一个窗口、一个隔离分区）；同一会话的取帧在宿主里串行。
 * 帧是 `capturePage()` 的 PNG；`receipt.sha256` 是 PNG bytes 的摘要——同一个 Electron 版本里 PNG 编码是确定的，
 * 所以同一画面得到同一摘要（换 Electron 版本后摘要可能整体变化，不能跨版本比对）。
 */

export interface CompositionHostOptions {
  /** Electron 可执行文件；不给时按 `resolveElectronBinary` 找，显式给 null 表示没有。 */
  electron?: string | null;
  /** 写宿主脚本的目录（默认系统临时目录）。 */
  cacheDir?: string;
  env?: NodeJS.ProcessEnv;
  /** 宿主 stderr 的每一行。 */
  log?: (line: string) => void;
  /** 启动与打开会话的超时（默认 20 s）。 */
  openTimeoutMs?: number;
  /** 一次取帧的超时（默认 10 s）。 */
  frameTimeoutMs?: number;
}

/** 页面报告并经清单核对后的合成信息。 */
export interface CompositionPage {
  width: number;
  height: number;
  fps: Rate;
  durationSeconds: number;
  compositionId: string;
}

export interface RenderedFrame {
  receipt: FrameReceipt;
  /** PNG bytes（RGBA，透明窗口时是直通 alpha）。 */
  png: Buffer;
  /** alpha 为 0 的像素数（窗口不透明时恒为 0）。 */
  transparentPixels: number;
  /** 0 < alpha < 255 的像素数。 */
  translucentPixels: number;
  /** 截图方式：恒为 `capturePage`（`paint` 事件的图像实测可能是旧帧，只用来等一次重绘）。 */
  captureMode: 'paint' | 'capturePage';
}

export interface CompositionSession {
  readonly id: string;
  readonly bundle: InspectedBundle;
  readonly page: CompositionPage;
  /** 页面原样报告的信息（没给的字段为 null）。 */
  readonly reportedPage: AdapterPageInfo;
  /** 到目前为止被拦截的请求 URL（打开期间与每次取帧后刷新）。 */
  readonly blockedRequests: readonly string[];
  frame(ticket: FrameTicket): Promise<RenderedFrame>;
  dispose(): Promise<void>;
}

export interface OpenSessionOptions {
  compositionId?: string;
  /** 页面报告的尺寸、帧率、时长与清单不一致时抛 `COMPOSITION_INTRINSIC_MISMATCH`（默认 true）。验证流程关掉它，自己逐项记录。 */
  strictIntrinsic?: boolean;
}

const DEFAULT_OPEN_TIMEOUT_MS = 20_000;
const DEFAULT_FRAME_TIMEOUT_MS = 10_000;
const KNOWN_CODES = new Set<string>(CODE_BUNDLE_ERROR_CODES);

/** 找 Electron：显式路径 → Electron 宿主 → 开发时已经安装的二进制；只读探测，不触发下载。 */
export function resolveElectronBinary(env: NodeJS.ProcessEnv = process.env, from: string = import.meta.url): string | null {
  if (env.BAOCUT_ELECTRON) return env.BAOCUT_ELECTRON;
  if (process.versions.electron) return process.execPath;
  try {
    // Electron 44 的入口在缺少二进制时同步运行 install.js；Runtime 启动与能力探测不能执行它。
    const packageDir = path.dirname(createRequire(from).resolve('electron'));
    const pathFile = path.join(packageDir, 'path.txt');
    const executable = fs.existsSync(pathFile) ? fs.readFileSync(pathFile, 'utf8').trim() : '';
    const resolved = env.ELECTRON_OVERRIDE_DIST_PATH
      ? path.join(env.ELECTRON_OVERRIDE_DIST_PATH, executable || 'electron')
      : executable ? path.join(packageDir, 'dist', executable) : null;
    if (resolved && fs.existsSync(resolved)) return resolved;
  } catch {
    // 没装 electron 包，或安装记录不可读。
  }
  return null;
}

/** 把宿主脚本写到缓存目录；文件名带内容摘要，并发的宿主各自写临时文件再改名，不会读到半个脚本。 */
function writeHostScript(cacheDir: string | undefined): string {
  const source = COMPOSITION_HOST_SCRIPT.replace(ADAPTER_PLACEHOLDER, () => JSON.stringify(COMPOSITION_ADAPTER_SCRIPT));
  const digest = crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);
  const dir = path.join(cacheDir ?? os.tmpdir(), 'baocut-composition-host');
  const file = path.join(dir, `host-${digest}.cjs`);
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(dir, { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, source);
  fs.renameSync(temp, file);
  return file;
}

/**
 * 拉起宿主的参数：开关与脚本是两个独立参数（不写成 `--composition-host=<脚本>`）。
 * - 打包后的应用（Runtime 以 `ELECTRON_RUN_AS_NODE` 跑在应用自己的可执行文件里，`resolveElectronBinary` 拿到的就是它）不认命令行里的
 *   脚本，总是加载 asar 里的主进程入口；入口见到这个开关就只跑后面的脚本（`apps/desktop/src/main/composition-host-entry.ts`）。
 * - 开发态的 Electron（default_app）跳过 `-` 开头的未知参数，把下一个不带 `-` 的参数当应用文件，脚本照样直接加载。
 */
export function hostSpawnArgs(script: string): string[] {
  return ['--composition-host', script];
}

const isCode = (code: string): code is CodeBundleErrorCode => KNOWN_CODES.has(code);

/** 子进程错误 → `CodeBundleError`。 */
function mapError(error: unknown, worker: JsonLineWorker): CodeBundleError {
  if (error instanceof CodeBundleError) return error;
  if (error instanceof WorkerRequestError) {
    const code = isCode(error.code) ? error.code : 'COMPOSITION_SCRIPT_ERROR';
    return new CodeBundleError(code, error.body.message, error.body.details);
  }
  if (error instanceof WorkerTimeoutError) {
    return new CodeBundleError(
      'COMPOSITION_RENDER_TIMEOUT',
      `Composition host did not answer "${error.method}" within ${error.timeoutMs} ms`,
    );
  }
  if (error instanceof WorkerExitedError) {
    return new CodeBundleError('COMPOSITION_HOST_UNAVAILABLE', `Composition host exited: ${error.message}`, {
      stderr: worker.stderrTail().slice(-4000),
    });
  }
  return new CodeBundleError('COMPOSITION_SCRIPT_ERROR', error instanceof Error ? error.message : String(error));
}

interface OpenResult {
  sessionId: string;
  page: AdapterPageInfo;
  blockedRequests: string[];
}

interface FrameResult {
  png: string;
  width: number;
  height: number;
  sampledSeconds: number;
  targetSeconds: number;
  clamped: boolean;
  captureMode: 'paint' | 'capturePage';
  paintObserved: boolean;
  transparentPixels: number;
  translucentPixels: number;
  blockedRequests: string[];
}

const sameRate = (a: Rate, b: Rate) => a.num * b.den === b.num * a.den;

/** 页面报告与清单逐项比对；返回不一致的项。 */
export function intrinsicMismatches(
  bundle: InspectedBundle,
  page: CompositionPage,
): Array<{ field: string; manifest: unknown; page: unknown }> {
  const { intrinsic } = bundle.manifest;
  const out: Array<{ field: string; manifest: unknown; page: unknown }> = [];
  if (page.width !== intrinsic.width) out.push({ field: 'width', manifest: intrinsic.width, page: page.width });
  if (page.height !== intrinsic.height) out.push({ field: 'height', manifest: intrinsic.height, page: page.height });
  if (!sameRate(page.fps, intrinsic.fps)) out.push({ field: 'fps', manifest: intrinsic.fps, page: page.fps });
  const manifestSeconds = (intrinsic.durationFrames * intrinsic.fps.den) / intrinsic.fps.num;
  const frameSeconds = intrinsic.fps.den / intrinsic.fps.num;
  if (Math.abs(page.durationSeconds - manifestSeconds) > frameSeconds + 1e-9) {
    out.push({ field: 'duration', manifest: manifestSeconds, page: page.durationSeconds });
  }
  return out;
}

export class CompositionHost {
  readonly #worker: JsonLineWorker;
  readonly #openTimeoutMs: number;
  readonly #frameTimeoutMs: number;

  private constructor(worker: JsonLineWorker, options: CompositionHostOptions) {
    this.#worker = worker;
    this.#openTimeoutMs = options.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS;
    this.#frameTimeoutMs = options.frameTimeoutMs ?? DEFAULT_FRAME_TIMEOUT_MS;
  }

  /** 拉起宿主并等它报告 `ready`；找不到 Electron 或启动失败时抛 `COMPOSITION_HOST_UNAVAILABLE`。 */
  static async start(options: CompositionHostOptions = {}): Promise<CompositionHost> {
    const baseEnv = options.env ?? process.env;
    const electron = options.electron === undefined ? resolveElectronBinary(baseEnv) : options.electron;
    if (!electron) {
      throw new CodeBundleError('COMPOSITION_HOST_UNAVAILABLE', 'Electron was not found; set BAOCUT_ELECTRON to the Electron executable');
    }
    const script = writeHostScript(options.cacheDir);
    const env: NodeJS.ProcessEnv = { ...baseEnv };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_ENABLE_LOGGING;
    let worker: JsonLineWorker;
    try {
      worker = await JsonLineWorker.start({
        command: electron,
        args: hostSpawnArgs(script),
        env,
        ...(options.log ? { onStderrLine: options.log } : {}),
      });
    } catch (error) {
      throw new CodeBundleError('COMPOSITION_HOST_UNAVAILABLE', `Could not start Electron: ${(error as Error).message}`, { electron });
    }
    const timeoutMs = options.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS;
    const ready = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => finish(false), timeoutMs);
      const offEvent = worker.onEvent((event: WorkerEvent) => {
        if (event.event === 'ready') finish(true);
      });
      const offExit = worker.onExit(() => finish(false));
      function finish(ok: boolean) {
        clearTimeout(timer);
        offEvent();
        offExit();
        resolve(ok);
      }
    });
    if (!ready) {
      await worker.kill();
      throw new CodeBundleError('COMPOSITION_HOST_UNAVAILABLE', 'Electron composition host did not become ready', {
        electron,
        stderr: worker.stderrTail().slice(-4000),
      });
    }
    return new CompositionHost(worker, options);
  }

  get alive(): boolean {
    return this.#worker.alive;
  }

  /** 宿主事件（`networkBlocked {sessionId, url}`），供日志与界面。 */
  onEvent(listener: (event: WorkerEvent) => void): () => void {
    return this.#worker.onEvent(listener);
  }

  async #request<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    try {
      return await this.#worker.request<T>(method, params, { timeoutMs });
    } catch (error) {
      throw mapError(error, this.#worker);
    }
  }

  /** 打开一个会话：加载入口、注入适配脚本、等合同就绪，再与清单交叉核对。 */
  async open(bundle: InspectedBundle, options: OpenSessionOptions = {}): Promise<CompositionSession> {
    const { manifest } = bundle;
    if (manifest.runtime.engine !== 'browser') {
      throw new CodeBundleError('BUNDLE_CONTRACT_UNSUPPORTED', `Runtime engine "${manifest.runtime.engine}" is not supported yet`);
    }
    const compositionId = options.compositionId ?? bundle.compositionId;
    const { intrinsic } = manifest;
    const opened = await this.#request<OpenResult>(
      'open',
      {
        root: bundle.root,
        entry: manifest.runtime.entry,
        compositionId,
        contract: manifest.runtime.contract,
        width: intrinsic.width,
        height: intrinsic.height,
        fps: intrinsic.fps,
        durationFrames: intrinsic.durationFrames,
        alpha: manifest.output.alpha,
        readyTimeoutMs: this.#openTimeoutMs,
      },
      this.#openTimeoutMs + 10_000,
    );
    const reported = opened.page;
    const page: CompositionPage = {
      width: reported.width ?? intrinsic.width,
      height: reported.height ?? intrinsic.height,
      fps: (reported.fps !== null && parseRate(reported.fps)) || intrinsic.fps,
      durationSeconds: reported.durationSeconds,
      compositionId,
    };
    const session = new HostSession(this, opened.sessionId, bundle, page, reported, opened.blockedRequests);
    if (options.strictIntrinsic ?? true) {
      const mismatches = intrinsicMismatches(bundle, page);
      if (mismatches.length > 0) {
        await session.dispose().catch(() => {});
        throw new CodeBundleError(
          'COMPOSITION_INTRINSIC_MISMATCH',
          `The page disagrees with the manifest on ${mismatches.map((m) => m.field).join(', ')}`,
          mismatches,
        );
      }
    }
    return session;
  }

  /** @internal 会话用。 */
  requestFrame(params: { sessionId: string; seconds: number; requestId: string; fps: Rate }): Promise<FrameResult> {
    return this.#request<FrameResult>('frame', params, this.#frameTimeoutMs);
  }

  /** @internal 会话用。 */
  async closeSession(sessionId: string): Promise<void> {
    if (!this.#worker.alive) return;
    await this.#request('close', { sessionId }, this.#frameTimeoutMs);
  }

  /** 关掉宿主（关 stdin，宿主销毁全部窗口后退出）。 */
  async close(): Promise<void> {
    await this.#worker.close(5_000);
  }
}

class HostSession implements CompositionSession {
  readonly id: string;
  readonly bundle: InspectedBundle;
  readonly page: CompositionPage;
  readonly reportedPage: AdapterPageInfo;
  readonly #host: CompositionHost;
  #blocked: string[];
  #disposed = false;

  constructor(
    host: CompositionHost,
    id: string,
    bundle: InspectedBundle,
    page: CompositionPage,
    reported: AdapterPageInfo,
    blocked: string[],
  ) {
    this.#host = host;
    this.id = id;
    this.bundle = bundle;
    this.page = page;
    this.reportedPage = reported;
    this.#blocked = blocked;
  }

  get blockedRequests(): readonly string[] {
    return this.#blocked;
  }

  /** 按票据的 `localTime` 取一帧（输出尺寸恒为包的固有尺寸；票据的宽高只做记录）。 */
  async frame(ticket: FrameTicket): Promise<RenderedFrame> {
    if (this.#disposed) throw new CodeBundleError('COMPOSITION_SCRIPT_ERROR', 'The composition session has been disposed');
    const requestedSeconds = Number(ticket.localTime.ticks) / ticket.localTime.timescale;
    const result = await this.#host.requestFrame({
      sessionId: this.id,
      seconds: requestedSeconds,
      requestId: ticket.requestId,
      fps: ticket.fps,
    });
    this.#blocked = result.blockedRequests;
    const png = Buffer.from(result.png, 'base64');
    return {
      receipt: {
        requestId: ticket.requestId,
        sampledSeconds: result.sampledSeconds,
        requestedSeconds,
        clampedToDuration: result.clamped,
        width: result.width,
        height: result.height,
        pixelFormat: 'png',
        alphaMode: this.bundle.manifest.output.alpha ? 'straight' : 'opaque',
        sha256: crypto.createHash('sha256').update(png).digest('hex'),
      },
      png,
      transparentPixels: result.transparentPixels,
      translucentPixels: result.translucentPixels,
      captureMode: result.captureMode,
    };
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    await this.#host.closeSession(this.id);
  }
}

/** 按秒数构造一张取帧票据（`localTime` 以输出帧率为时间基时精确；其余用微秒）。 */
export function frameTicketAt(
  bundle: InspectedBundle,
  time: { frameIndex: number; fps: Rate } | { seconds: number },
  options: { requestId?: string; compositionId?: string; quality?: FrameTicket['quality'] } = {},
): FrameTicket {
  const { intrinsic } = bundle.manifest;
  const exact = 'frameIndex' in time;
  const fps = exact ? time.fps : intrinsic.fps;
  const localTime = exact
    ? { ticks: String(time.frameIndex * time.fps.den), timescale: time.fps.num }
    : { ticks: String(Math.round(time.seconds * 1_000_000)), timescale: 1_000_000 };
  const frameIndex = exact ? time.frameIndex : Math.round((time.seconds * fps.num) / fps.den);
  return {
    requestId: options.requestId ?? `frame_${crypto.randomUUID()}`,
    bundleRef: { id: bundle.manifest.bundleId, revision: bundle.manifest.revision },
    compositionId: options.compositionId ?? bundle.compositionId,
    localTime,
    frameIndex,
    fps,
    width: intrinsic.width,
    height: intrinsic.height,
    parametersHash: crypto.createHash('sha256').update('{}').digest('hex'),
    quality: options.quality ?? 'export-exact',
  };
}
