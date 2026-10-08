import fs from 'node:fs/promises';
import path from 'node:path';
import {
  RpcError,
  WEB_READ_METHODS,
  webMethodAccess,
  webTopicAllowed,
  refOf,
  type Localized,
  type RpcMethod,
  type RpcParams,
  type ToolProblem,
  type ToolStatus,
  type WebServiceAccess,
} from '@baocut/protocol';
import { RcWeb } from '@baocut/protocol/messages/runtime-core';
import type { Harness } from '@baocut/harness';
import type { TrustedPrincipal } from '../gateway.ts';
import { sourceRoot as exportSourceRoot } from '../exports/export-publish.ts';
import type { RpcHandlers } from '../handlers.ts';
import type { VideoService } from '../videos/video-service.ts';

/**
 * Web 服务在网关处理函数上加的限制（架构设计 §4.8、§12.8）。处理函数本身与桌面界面是同一组，只多了这几条：
 *
 * - **白名单**（`webAuthorize`）：在网关分发之前查方法与订阅的主题，白名单之外 `forbidden`；配置改了立即生效。
 * - **没有项目目录之外的文件访问**：`projects.open` 只接受已登记的项目；`edits.apply` 里 `importAsset` / `relinkAsset`
 *   的路径（相对视频目录或绝对路径）按真实路径必须在视频所在的项目目录（或不属于项目的会话的工作目录）里；
 *   `exports.create` 的目标目录同样要在这个目录里，且不能是视频目录或 `.bcut`（不给时是项目的 `exports/`）。
 *   `space.import` 的文件按真实路径必须在项目目录里；`videos.importPackage` 的便携包按真实路径必须在新视频的来源目录
 *   （项目目录，或不属于项目的会话的工作目录）里。导出便携包与工程同样走 `exports.create` 的目标目录约束。
 * - **审计**：写入类的调用记一条最近的请求（方法、目标视频与结果），不记参数正文。
 */

export function webAuthorize(method: RpcMethod, params: unknown, access: WebServiceAccess): RpcError | null {
  const verdict = webMethodAccess(method, access);
  if (verdict === 'read-only') {
    return new RpcError('forbidden', RcWeb.webReadOnly({ method }), { code: 'WEB_READ_ONLY', method });
  }
  if (verdict === 'not-allowed') {
    return new RpcError('forbidden', RcWeb.methodNotAllowed({ method }), {
      code: 'WEB_METHOD_NOT_ALLOWED',
      method,
    });
  }
  if (method === 'subscribe') {
    const topic = (params as { topic: string }).topic;
    if (!webTopicAllowed(topic, access)) {
      return new RpcError('forbidden', RcWeb.topicNotAllowed({ topic }), { code: 'WEB_TOPIC_NOT_ALLOWED', topic });
    }
  }
  return null;
}

export interface WebHandlerDeps {
  uploadUrl?: (sessionId: string, url: string) => string;
  harness: Harness;
  videos: VideoService;
  /** 一次写入类调用结束：方法、主体、目标视频与结果（`ok` 或错误码）。 */
  record: (method: RpcMethod, principal: TrustedPrincipal, videoId: string | null, outcome: string) => void;
  /** 此刻的访问配置（白名单与只读）：工具目录据此标出浏览器里用不了的工具。 */
  access: () => WebServiceAccess;
}

const READ = new Set<string>(WEB_READ_METHODS);

export function webHandlers(base: RpcHandlers, deps: WebHandlerDeps): RpcHandlers {
  const methods = { ...base.methods } as Record<string, (params: unknown, principal: TrustedPrincipal) => unknown>;

  methods['attachments.prepare'] = async (params, principal) => {
    if (!principal.sessionId || !deps.uploadUrl) throw new RpcError('forbidden', RcWeb.loginRequired());
    const result = await base.methods['attachments.prepare'](params as RpcParams<'attachments.prepare'>, principal);
    return { ...result, uploadUrl: deps.uploadUrl(principal.sessionId, result.uploadUrl) };
  };
  const openProject = base.methods['projects.open'];
  methods['projects.open'] = async (params, principal) => {
    const p = params as RpcParams<'projects.open'>;
    if (!(await registeredProject(deps.harness, p.path))) {
      throw new RpcError('forbidden', RcWeb.projectNotRegistered(), {
        code: 'PROJECT_NOT_REGISTERED',
      });
    }
    return openProject(p, principal);
  };

  const apply = base.methods['edits.apply'];
  methods['edits.apply'] = async (params, principal) => {
    const p = params as RpcParams<'edits.apply'>;
    return apply({ ...p, operations: await confinePaths(deps, p) }, principal);
  };

  const createExport = base.methods['exports.create'];
  methods['exports.create'] = async (params, principal) => {
    const p = params as RpcParams<'exports.create'>;
    const dir = await confineExportDir(deps, p);
    return createExport(dir === undefined ? p : { ...p, destination: { ...p.destination, dir } }, principal);
  };

  const importFile = base.methods['space.import'];
  methods['space.import'] = async (params, principal) => {
    const p = params as RpcParams<'space.import'>;
    return importFile({ ...p, path: await confineImport(deps, p) }, principal);
  };

  // 工具目录（§7.9）：执行方法在浏览器里调不了的工具标为不可用（例如固定流程 `pipelines.*` 不在默认集合里）；
  // 保存位置不在任何已登记的项目目录里时，把结果写到保存位置的流程标出来（浏览器拿不到那里的文件）。
  const listTools = base.methods['tools.list'];
  methods['tools.list'] = async (params, principal) => {
    const result = await listTools(params as RpcParams<'tools.list'>, principal);
    const access = deps.access();
    const saveOutside = result.saveDirectory !== undefined && !(await insideRegisteredProject(deps.harness, result.saveDirectory));
    // 外部工具的说明可能带本机路径（探测失败的原因）：浏览器里只给错误码与工具名，同 `externalTools.*` 不对浏览器开放。
    const confine = (problems: ToolProblem[]): ToolProblem[] =>
      problems.map((p) => (p.tool ? { ...problemOf(p.code, RcWeb.externalToolUnavailable({ tool: p.tool })), tool: p.tool } : p));
    return {
      tools: result.tools.map((listed) => {
        let tool = { ...listed, problems: confine(listed.problems), limitations: confine(listed.limitations) };
        if (saveOutside) tool = gateSaveLocation(tool);
        const verdict = webMethodAccess(tool.execution.method, access);
        if (verdict === 'allowed') return tool;
        const problem =
          verdict === 'read-only'
            ? problemOf('WEB_READ_ONLY', RcWeb.webReadOnly({ method: tool.execution.method }))
            : problemOf('WEB_METHOD_NOT_ALLOWED', RcWeb.toolMethodNotAllowed({ method: tool.execution.method }));
        return { ...tool, available: false, problems: [...tool.problems, problem] };
      }),
    };
  };

  // 直接任务的 `saveDir`（§7.9）：浏览器只能让副本写进已登记的项目目录。
  for (const name of ['models.synthesizeSpeech', 'models.generateImage', 'models.generateText'] as const) {
    const submit = base.methods[name] as (params: unknown, principal: TrustedPrincipal) => unknown;
    methods[name] = async (params, principal) => {
      const saveDir = (params as { saveDir?: unknown }).saveDir;
      if (typeof saveDir === 'string' && !(await insideRegisteredProject(deps.harness, saveDir))) {
        throw new RpcError('forbidden', RcWeb.saveDirOutsideProject(), { code: 'PATH_OUTSIDE_PROJECT' });
      }
      return submit(params, principal);
    };
  }

  const importPackage = base.methods['videos.importPackage'];
  methods['videos.importPackage'] = async (params, principal) => {
    const p = params as RpcParams<'videos.importPackage'>;
    return importPackage({ ...p, path: await confinePackage(deps, p) }, principal);
  };

  for (const [name, handler] of Object.entries(methods)) {
    if (READ.has(name)) continue;
    methods[name] = async (params, principal) => {
      const videoId = videoIdOf(params);
      try {
        const result = await handler(params, principal);
        deps.record(name as RpcMethod, principal, videoId, 'ok');
        return result;
      } catch (error) {
        deps.record(name as RpcMethod, principal, videoId, outcomeOf(error));
        throw error;
      }
    };
  }
  return { methods: methods as unknown as RpcHandlers['methods'], subscribe: base.subscribe };
}

function saveLocationProblem(): ToolProblem {
  return problemOf('PATH_OUTSIDE_PROJECT', RcWeb.saveLocationOutsideProject());
}

/** 一条不可用的原因：文字连同引用（浏览器按自己的界面语言重新生成，Runtime 的语言可能与它不同）。 */
function problemOf(code: string, message: Localized): ToolProblem {
  return { code, message: message.text, messageRef: refOf(message) };
}

/**
 * 保存位置在项目目录之外时（§7.9，浏览器只碰已登记的项目目录）：结果只写到保存位置的流程不可用；还能写进视频的
 * （转录、翻译字幕）照样可用，文件输入受限、写进限制。直接任务的结果在产物库里、浏览器照样能读，不受影响。
 */
function gateSaveLocation<T extends Pick<ToolStatus, 'execution' | 'results' | 'problems' | 'limitations' | 'available'>>(tool: T): T {
  if (tool.execution.kind !== 'pipeline' || !tool.results.includes('artifact')) return tool;
  if (tool.results.includes('video')) return { ...tool, limitations: [...tool.limitations, saveLocationProblem()] };
  return { ...tool, available: false, problems: [...tool.problems, saveLocationProblem()] };
}

/** 目录（可以还不存在：按最近的已有上级取真实路径）在某个已登记的项目目录里。 */
async function insideRegisteredProject(harness: Harness, dir: string): Promise<boolean> {
  if (!path.isAbsolute(dir)) return false;
  let existing = path.resolve(dir);
  let rest = '';
  let real: string | null = null;
  for (;;) {
    real = await fs.realpath(existing).catch(() => null);
    if (real || path.dirname(existing) === existing) break;
    rest = path.join(path.basename(existing), rest);
    existing = path.dirname(existing);
  }
  if (!real) return false;
  const target = path.join(real, rest);
  for (const project of harness.listProjects()) {
    const root = await fs.realpath(project.path).catch(() => null);
    if (root && within(target, root)) return true;
  }
  return false;
}

/** 已登记的项目（按真实路径比较）。 */
async function registeredProject(harness: Harness, target: string): Promise<boolean> {
  if (!path.isAbsolute(target)) return false;
  const real = await fs.realpath(target).catch(() => null);
  if (!real) return false;
  for (const project of harness.listProjects()) {
    if ((await fs.realpath(project.path).catch(() => null)) === real) return true;
  }
  return false;
}

/**
 * `space.import` 的文件：相对项目目录或绝对路径，按真实路径必须在项目目录里（浏览器不能把项目之外的文件复制进来）。
 * 换成真实路径交给处理函数，检查与使用之间不再经过符号链接。
 */
async function confineImport(deps: WebHandlerDeps, params: RpcParams<'space.import'>): Promise<string> {
  const project = deps.harness.listProjects().find((p) => p.id === params.projectId);
  if (!project) throw new RpcError('not-found', RcWeb.projectNotFound());
  const rootReal = await fs.realpath(project.path).catch(() => null);
  const real = await fs.realpath(path.resolve(project.path, params.path)).catch(() => null);
  if (!rootReal || !real) throw new RpcError('not-found', RcWeb.fileMissing());
  if (real === rootReal || !within(real, rootReal)) {
    throw new RpcError('forbidden', RcWeb.importOutsideProject(), { code: 'PATH_OUTSIDE_PROJECT' });
  }
  return real;
}

/**
 * `videos.importPackage` 的包：相对来源目录或绝对路径，按真实路径必须在新视频的来源目录里（浏览器不能读项目之外的文件，
 * 也不能经符号链接指到别处）。换成真实路径交给处理函数。
 */
async function confinePackage(deps: WebHandlerDeps, params: RpcParams<'videos.importPackage'>): Promise<string> {
  let root: string;
  if (params.projectId) {
    const project = deps.harness.listProjects().find((p) => p.id === params.projectId);
    if (!project) throw new RpcError('not-found', RcWeb.projectNotFound());
    root = project.path;
  } else {
    const { conversation } = deps.harness.getConversation(params.conversationId!);
    root = conversation.projectId
      ? sourceRoot(deps.harness, { projectId: conversation.projectId, conversationId: null })
      : conversation.cwd;
  }
  const rootReal = await fs.realpath(root).catch(() => null);
  const real = await fs.realpath(path.isAbsolute(params.path) ? params.path : path.resolve(root, params.path)).catch(() => null);
  if (!rootReal || !real) throw new RpcError('not-found', RcWeb.packageNotFound(), { code: 'PACKAGE_NOT_FOUND' });
  if (real === rootReal || !within(real, rootReal)) {
    throw new RpcError('forbidden', RcWeb.packageOutsideProject(), { code: 'PATH_OUTSIDE_PROJECT' });
  }
  return real;
}

/** `importAsset` / `relinkAsset` 的路径换成真实路径，并确认在视频的来源目录里。 */
async function confinePaths(deps: WebHandlerDeps, params: RpcParams<'edits.apply'>): Promise<RpcParams<'edits.apply'>['operations']> {
  const ops = params.operations as unknown as Record<string, unknown>[];
  if (!ops.some(hasPath)) return params.operations;
  const ref = deps.videos.ref(params.videoId);
  if (!ref) throw new RpcError('not-found', RcWeb.videoNotOpen());
  const root = sourceRoot(deps.harness, ref.source);
  const rootReal = await fs.realpath(root).catch(() => null);
  if (!rootReal) throw new RpcError('not-found', RcWeb.videoProjectDirMissing());
  const prefix = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  const confined: Record<string, unknown>[] = [];
  for (const [index, op] of ops.entries()) {
    if (!hasPath(op)) {
      confined.push(op);
      continue;
    }
    const given = op.path as string;
    const real = await fs.realpath(path.isAbsolute(given) ? given : path.resolve(ref.path, given)).catch(() => null);
    if (!real || (real !== rootReal && !real.startsWith(prefix))) {
      throw new RpcError('forbidden', RcWeb.operationOutsideProject({ ordinal: index + 1 }), {
        code: 'PATH_OUTSIDE_PROJECT',
        index,
      });
    }
    confined.push({ ...op, path: real });
  }
  return confined as unknown as RpcParams<'edits.apply'>['operations'];
}

/**
 * `exports.create` 的目标目录：给了的按真实路径必须在视频的来源目录里、已经存在、不在视频目录（含 `video.db`）或 `.bcut` 里，
 * 换成真实路径交给导出服务；不给时检查默认的 `exports/`（已经存在时）没有经符号链接指到别处。
 */
async function confineExportDir(deps: WebHandlerDeps, params: RpcParams<'exports.create'>): Promise<string | undefined> {
  const ref = deps.videos.ref(params.videoId);
  if (!ref) return undefined; // 视频没有打开：交给导出服务回答
  const rootReal = await fs.realpath(sourceRoot(deps.harness, ref.source)).catch(() => null);
  if (!rootReal) throw new RpcError('not-found', RcWeb.videoProjectDirMissing());
  const refuse = () => new RpcError('forbidden', RcWeb.exportOutsideProject(), { code: 'PATH_OUTSIDE_PROJECT' });
  const given = params.destination?.dir;
  if (given === undefined) {
    const real = await fs.realpath(path.join(exportSourceRoot(ref), 'exports')).catch(() => null);
    if (real !== null && !within(real, rootReal)) throw refuse();
    return undefined;
  }
  const target = path.isAbsolute(given) ? given : path.resolve(rootReal, given);
  const real = await fs.realpath(target).catch(() => null);
  if (!real) {
    if (!within(path.resolve(target), rootReal)) throw refuse();
    throw new RpcError('conflict', RcWeb.exportDirMissing(), {
      code: 'EXPORT_DESTINATION_UNWRITABLE',
      recovery: RcWeb.exportDirRecovery().text,
    });
  }
  if (!within(real, rootReal)) throw refuse();
  const relative = path.relative(rootReal, real);
  if (relative.split(path.sep).includes('.bcut')) throw refuse();
  for (let dir = real; ; dir = path.dirname(dir)) {
    if (
      await fs.stat(path.join(dir, 'video.db')).then(
        () => true,
        () => false,
      )
    )
      throw refuse();
    if (dir === rootReal) break;
  }
  return real;
}

function within(real: string, rootReal: string): boolean {
  return real === rootReal || real.startsWith(rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep);
}

function hasPath(op: Record<string, unknown>): boolean {
  return (op.type === 'importAsset' || op.type === 'relinkAsset') && typeof op.path === 'string';
}

function sourceRoot(harness: Harness, source: { projectId: string | null; conversationId: string | null }): string {
  if (source.projectId) {
    const project = harness.listProjects().find((p) => p.id === source.projectId);
    if (project) return project.path;
  }
  if (source.conversationId) return harness.getConversation(source.conversationId).conversation.cwd;
  throw new RpcError('not-found', RcWeb.videoProjectMissing());
}

function videoIdOf(params: unknown): string | null {
  // `compositions.*` 的视频参数叫 `video`（与工具相同）。
  const p = params as { videoId?: unknown; video?: unknown } | null;
  const videoId = p?.videoId ?? p?.video;
  return typeof videoId === 'string' ? videoId : null;
}

function outcomeOf(error: unknown): string {
  if (!(error instanceof RpcError)) return 'internal';
  const code = (error.details as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : error.code;
}
