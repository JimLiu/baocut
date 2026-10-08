import fs from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import {
  MODEL_API_DEFAULT_MAX_CONCURRENT,
  MODEL_API_INTERFACE_VERSION,
  MODEL_API_MAX_JSON_BYTES,
  MODEL_API_MAX_UPLOAD_BYTES,
  RUNTIME_VERSION,
  RpcError,
  newId,
  nowIso,
  type Id,
  type JobRecord,
  type JobSubmitter,
  type Localized,
  type ModelApiAlias,
  type ModelApiConnectionInfo,
  type ModelApiStatus,
  type ModelServiceCapability,
  type ServiceClient,
  type ServiceConfigureParams,
} from '@baocut/protocol';
import { RcModelApi, RcServices } from '@baocut/protocol/messages/runtime-core';
import type { AsrResult } from '@baocut/models';
import { localizedOf } from '../localized.ts';
import type { Logger } from '@baocut/harness';
import { loopbackHost } from '../agent-tools/mcp-endpoint.ts';
import type { ServicePrincipal } from '../agent-tools/tool-scope.ts';
import type { ModelJobs } from '../models/model-jobs.ts';
import { ApiError, fromJobError, fromRpcError } from './model-api-errors.ts';
import {
  chatCompletion,
  chatCompletionStream,
  chatRequest,
  imageRequest,
  jsonObject,
  modelName,
  speechRequest,
  transcriptionBody,
  transcriptionOptions,
  type ChatOutcome,
} from './model-api-openai.ts';
import { listModels, resolveModel, type ModelApiTarget } from './model-api-routing.ts';
import type { JobGrantHint } from '@baocut/jobs';
import { grantRequiredDetails } from '../grants/grant-errors.ts';
import { outboundPurpose, type OutboundPlan } from '../grants/grant-service.ts';
import { MalformedUpload, UploadTooLarge, consume, multipartBoundary, readMultipart } from './multipart-upload.ts';
import type { ServiceApprovals } from './service-approvals.ts';
import { LOOPBACK_HOST as HOST, RecentRequests, ServiceClients, closeLoopback, listenLoopback } from './service-clients.ts';
import type { ModelApiConfig, ServiceConfigStore } from './service-config-store.ts';
import type { ManagedService, ServiceReport } from './service-manager.ts';

/**
 * 模型接口服务（架构设计 §4.8、§12.8）：给支持 OpenAI 接口的程序用的本机 HTTP 端点，把请求映射为一次没有视频的
 * 能力调用（§7.9），结果直接作为 HTTP 响应返回。
 *
 * - 只监听回环地址，端口可配置（默认 `MODEL_API_DEFAULT_PORT`），被占用时进入 `error`，不换端口；
 * - 认证：每个客户端一枚令牌（`Authorization: Bearer <令牌>`），与 MCP 服务的令牌互不通用；缺失、错误或已吊销时 401；
 *   带 `Origin` 的请求 403（网页不能调用），`Host` 不是回环地址的 403（DNS 重绑定）；
 * - 等级：`read` 只有 `GET /v1/models`（与 `/v1/baocut/info`），生成请求 403；`ask` 每个生成请求一条服务审批；`auto` 直接执行。
 *   视频范围对这个服务没有意义，忽略；
 * - 每个生成请求是一次 Job，`submitter: { kind: 'service', id: 'model-api', clientId }`，记录与产物就是它的生成记录；
 *   调用方断开时取消这个 Job（服务停止时不取消：已经提交的照常跑完，§12.8）；
 * - 每个客户端同时在途的生成请求有上限，超出时 429；上传与 JSON 请求体有大小上限，超出时 413；
 * - 上传边读边写到 `staging/model-api/<请求>/`，请求结束（任务终结）后删除，服务开启时清掉上次留下的；
 * - 不接受任何文件路径参数；令牌与请求正文不进日志与最近请求的记录。
 */

export interface ModelApiServiceDeps {
  store: ServiceConfigStore;
  models: ModelJobs;
  approvals: ServiceApprovals;
  /** `<home>/staging/model-api`：上传的临时目录。 */
  stagingDir: string;
  log: Logger;
  /** 客户端、配置或最近的请求变了：送一条 `service.updated`。 */
  onChange: () => void;
  /** 测试用更小的上限。 */
  limits?: { maxUploadBytes?: number; maxJsonBytes?: number };
}

/** 别名表的默认内容：`whisper-1` → 本机的默认转写模型（`modelId: null` 取本机 Provider 的默认模型包）。 */
export const DEFAULT_MODEL_API_ALIASES: readonly ModelApiAlias[] = [
  { alias: 'whisper-1', capability: 'transcribe', providerId: 'local', modelId: null },
];

export function defaultModelApiConfig(): ModelApiConfig {
  return {
    routing: { online: false, nodes: false, agent: false },
    aliases: DEFAULT_MODEL_API_ALIASES.map((a) => ({ ...a })),
    maxConcurrentPerClient: MODEL_API_DEFAULT_MAX_CONCURRENT,
  };
}

type Route =
  | { kind: 'models' }
  | { kind: 'model'; id: string }
  | { kind: 'info' }
  | { kind: 'transcriptions' }
  | { kind: 'speech' }
  | { kind: 'images' }
  | { kind: 'chat' };

const POST_ROUTES: Record<string, Route['kind']> = {
  '/v1/audio/transcriptions': 'transcriptions',
  '/v1/audio/speech': 'speech',
  '/v1/images/generations': 'images',
  '/v1/chat/completions': 'chat',
};

const ENDPOINTS = [
  'GET /v1/models',
  'GET /v1/models/{model}',
  'GET /v1/baocut/info',
  'POST /v1/audio/transcriptions',
  'POST /v1/audio/speech',
  'POST /v1/images/generations',
  'POST /v1/chat/completions',
];

/** 调用方在拿到结果之前断开了：不再回答。 */
class ClientGone extends Error {}

export class ModelApiService implements ManagedService {
  readonly id = 'model-api' as const;
  get label(): string {
    return RcModelApi.serviceLabel().text;
  }
  readonly available = true;
  readonly #deps: ModelApiServiceDeps;
  readonly #log: Logger;
  readonly #clients: ServiceClients;
  readonly #recent = new RecentRequests();
  /** 每个客户端在途的生成请求数。 */
  readonly #inFlight = new Map<string, number>();
  /** 正在用的上传目录：开启服务时的清理不碰它们（服务停止后，提交的任务可能还在读）。 */
  readonly #uploads = new Set<string>();
  readonly #maxUploadBytes: number;
  readonly #maxJsonBytes: number;
  #server: Server | null = null;
  #port: number | null = null;
  #stopping = false;

  constructor(deps: ModelApiServiceDeps) {
    this.#deps = deps;
    this.#log = deps.log.child('model-api-service');
    this.#clients = new ServiceClients({
      store: deps.store,
      serviceId: 'model-api',
      label: 'model API',
      log: this.#log,
      onChange: deps.onChange,
    });
    this.#maxUploadBytes = deps.limits?.maxUploadBytes ?? MODEL_API_MAX_UPLOAD_BYTES;
    this.#maxJsonBytes = deps.limits?.maxJsonBytes ?? MODEL_API_MAX_JSON_BYTES;
  }

  async start(): Promise<void> {
    if (this.#server) return;
    this.#stopping = false;
    await this.#sweepStaging();
    const port = this.#deps.store.get('model-api').port;
    const server = createServer((request, response) => {
      void this.#handle(request, response).catch((error: unknown) => {
        this.#log.warn('Model API request failed', { error: String(error) });
        if (!response.headersSent) this.#sendError(response, new ApiError(500, 'INTERNAL', RcModelApi.internalError()), true);
        else response.destroy();
      });
    });
    this.#port = await listenLoopback(server, port);
    server.on('error', (error) => this.#log.warn('Model API service error', { error: String(error) }));
    this.#server = server;
    this.#log.info('Model API service listening', { port: this.#port });
  }

  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    this.#port = null;
    // 停止服务断开连接，但不取消已经提交的任务（§12.8）：连接的关闭不当作调用方断开。
    this.#stopping = true;
    if (server) await closeLoopback(server);
    await this.#deps.store.flush('model-api').catch(() => {});
  }

  status(): ServiceReport {
    const config = this.#deps.store.get('model-api');
    const port = this.#port ?? config.port;
    return {
      autostart: config.autostart,
      port,
      endpoint: this.#server ? `http://${HOST}:${port}/v1` : null,
      policy: { videos: 'all', level: config.policy.level },
      clients: this.#clients.list(),
      recentRequests: this.#recent.list(),
      modelApi: this.#status(),
    };
  }

  async applyConfig(params: ServiceConfigureParams): Promise<boolean> {
    const before = this.#deps.store.get('model-api');
    const current = this.#config();
    const routing = { ...current.routing };
    for (const key of ['online', 'nodes', 'agent'] as const) {
      const value = params.routing?.[key];
      if (value !== undefined) routing[key] = value;
    }
    const changesOwn = params.routing !== undefined || params.maxConcurrentPerClient !== undefined;
    // 视频范围对这个服务没有意义：给了也忽略。
    await this.#deps.store.update('model-api', {
      ...(params.autostart !== undefined ? { autostart: params.autostart } : {}),
      ...(params.port !== undefined ? { port: params.port } : {}),
      policy: { videos: before.policy.videos, level: params.level ?? before.policy.level },
      ...(changesOwn
        ? { modelApi: { ...current, routing, maxConcurrentPerClient: params.maxConcurrentPerClient ?? current.maxConcurrentPerClient } }
        : {}),
    });
    return params.port !== undefined && params.port !== before.port;
  }

  // ---- 客户端与别名 ----

  createClient(name: string): Promise<{ client: ServiceClient; token: string }> {
    return this.#clients.create(name);
  }

  listClients(): ServiceClient[] {
    return this.#clients.list();
  }

  revokeClient(clientId: string): Promise<ServiceClient[]> {
    return this.#clients.revoke(clientId);
  }

  /** OpenAI SDK 怎么连：基址与请求头，令牌用占位符（明文只在创建客户端时给出一次）。 */
  connectionInfo(clientId?: string): ModelApiConnectionInfo {
    const client = this.#clients.find(clientId);
    const { port, endpoint } = this.status();
    const baseUrl = endpoint ?? `http://${HOST}:${port}/v1`;
    const placeholder = (client ? RcServices.tokenPlaceholder({ client: client.name }) : RcServices.tokenPlaceholderGeneric()).text;
    return {
      baseUrl,
      headers: { Authorization: `Bearer ${placeholder}` },
      snippet: `OPENAI_BASE_URL=${baseUrl}\nOPENAI_API_KEY=${placeholder}`,
      interfaceVersion: MODEL_API_INTERFACE_VERSION,
      notice: this.#server ? null : RcModelApi.notRunning().text,
    };
  }

  async setAlias(alias: ModelApiAlias): Promise<ModelApiAlias[]> {
    const current = this.#config();
    const aliases = [...current.aliases.filter((a) => a.alias !== alias.alias), alias];
    await this.#deps.store.update('model-api', { modelApi: { ...current, aliases } });
    this.#deps.onChange();
    return aliases;
  }

  async removeAlias(name: string): Promise<ModelApiAlias[]> {
    const current = this.#config();
    if (!current.aliases.some((a) => a.alias === name)) throw new RpcError('not-found', RcModelApi.aliasNotFound({ alias: name }));
    const aliases = current.aliases.filter((a) => a.alias !== name);
    await this.#deps.store.update('model-api', { modelApi: { ...current, aliases } });
    this.#deps.onChange();
    return aliases;
  }

  #config(): ModelApiConfig {
    return this.#deps.store.get('model-api').modelApi ?? defaultModelApiConfig();
  }

  #status(): ModelApiStatus {
    const config = this.#config();
    return {
      routing: config.routing,
      aliases: config.aliases,
      maxConcurrentPerClient: config.maxConcurrentPerClient,
      maxUploadBytes: this.#maxUploadBytes,
      maxJsonBytes: this.#maxJsonBytes,
      interfaceVersion: MODEL_API_INTERFACE_VERSION,
    };
  }

  // ---- 请求 ----

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('X-BaoCut-Interface-Version', MODEL_API_INTERFACE_VERSION);
    if (!loopbackHost(request.headers.host)) {
      return this.#refuse(request, response, new ApiError(403, 'HOST_NOT_ALLOWED', RcModelApi.hostNotAllowed()));
    }
    if (request.headers.origin !== undefined) {
      return this.#refuse(request, response, new ApiError(403, 'ORIGIN_NOT_ALLOWED', RcModelApi.originNotAllowed()));
    }
    const client = this.#clients.authenticate(request);
    if (!client) {
      return this.#refuse(
        request,
        response,
        new ApiError(
          401,
          'AUTHENTICATION_REQUIRED',
          RcModelApi.authRequired(),
          {
            'WWW-Authenticate': 'Bearer',
          },
        ),
      );
    }
    const url = new URL(request.url ?? '/', 'http://localhost');
    const endpoint = `${request.method ?? 'GET'} ${url.pathname}`;
    const controller = new AbortController();
    const principal: ServicePrincipal = {
      connectionId: newId('svc'),
      kind: 'service',
      name: 'model-api',
      serviceId: 'model-api',
      clientId: client.clientId,
      clientName: client.name,
      signal: controller.signal,
      audit: { videoId: null },
    };
    // 调用方在拿到结果之前断开：取消等待中的审批与提交的任务。服务停止造成的断开不算。
    response.once('close', () => {
      if (!response.writableFinished && !this.#stopping) controller.abort();
    });
    const audit: { outcome: string; jobId: Id | null } = { outcome: 'ok', jobId: null };
    try {
      const route = this.#route(request.method ?? 'GET', url.pathname);
      await this.#dispatch(route, request, response, principal, audit);
    } catch (error) {
      if (error instanceof ClientGone) {
        audit.outcome = 'CLIENT_DISCONNECTED';
      } else {
        const apiError = toApiError(error, this.#log);
        audit.outcome = apiError.code;
        if (!response.headersSent && !response.destroyed) this.#sendError(response, apiError, !request.complete);
      }
    } finally {
      this.#audit(principal, endpoint, audit.outcome, audit.jobId, response.statusCode);
    }
  }

  #route(method: string, pathname: string): Route {
    if (pathname === '/v1/models' || pathname === '/v1/baocut/info' || pathname.startsWith('/v1/models/')) {
      if (method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', RcModelApi.methodNotAllowed({ path: pathname, method: 'GET' }), {
          Allow: 'GET',
        });
      if (pathname === '/v1/models') return { kind: 'models' };
      if (pathname === '/v1/baocut/info') return { kind: 'info' };
      return { kind: 'model', id: safeDecode(pathname.slice('/v1/models/'.length)) };
    }
    const kind = Object.hasOwn(POST_ROUTES, pathname) ? POST_ROUTES[pathname] : undefined;
    if (!kind) throw new ApiError(404, 'NOT_FOUND', RcModelApi.endpointNotFound({ path: pathname }));
    if (method !== 'POST') {
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', RcModelApi.methodNotAllowed({ path: pathname, method: 'POST' }), { Allow: 'POST' });
    }
    return { kind } as Route;
  }

  async #dispatch(
    route: Route,
    request: IncomingMessage,
    response: ServerResponse,
    principal: ServicePrincipal,
    audit: { outcome: string; jobId: Id | null },
  ): Promise<void> {
    switch (route.kind) {
      case 'models':
        return this.#sendJson(response, 200, { object: 'list', data: this.#listed() });
      case 'model': {
        const listed = this.#listed();
        const found = listed.find((m) => m.id === route.id) ?? listed.find((m) => !m.baocut.alias && m.baocut.modelId === route.id);
        if (!found) throw new ApiError(404, 'MODEL_NOT_FOUND', RcModelApi.modelNotFound({ model: route.id }));
        return this.#sendJson(response, 200, { ...found, id: route.id });
      }
      case 'info':
        return this.#sendJson(response, 200, {
          object: 'baocut.info',
          service: 'model-api',
          interfaceVersion: MODEL_API_INTERFACE_VERSION,
          runtimeVersion: RUNTIME_VERSION,
          endpoints: ENDPOINTS,
          routing: this.#config().routing,
          level: this.#deps.store.get('model-api').policy.level,
          limits: {
            maxUploadBytes: this.#maxUploadBytes,
            maxJsonBytes: this.#maxJsonBytes,
            maxConcurrentPerClient: this.#config().maxConcurrentPerClient,
          },
          streaming: 'single-chunk',
          imageResponseFormats: ['b64_json'],
        });
      default:
        return this.#generate(route, request, response, principal, audit);
    }
  }

  #listed() {
    const { routing, aliases } = this.#config();
    return listModels(this.#deps.models.services.view(), routing, aliases).map((m) => ({
      id: m.id,
      object: 'model',
      created: 0,
      owned_by: m.providerId,
      baocut: { capability: m.capability, providerId: m.providerId, modelId: m.modelId, alias: m.alias },
    }));
  }

  /** 生成请求：等级 → 并发名额 → 读请求体 → 解析模型 → 审批 → 提交任务、等它终结 → 回答。 */
  async #generate(
    route: Exclude<Route, { kind: 'models' | 'model' | 'info' }>,
    request: IncomingMessage,
    response: ServerResponse,
    principal: ServicePrincipal,
    audit: { outcome: string; jobId: Id | null },
  ): Promise<void> {
    if (this.#level() === 'read') {
      throw new ApiError(403, 'SERVICE_READ_ONLY', RcModelApi.readOnlyHint());
    }
    const { clientId } = principal;
    const limit = this.#config().maxConcurrentPerClient;
    const running = this.#inFlight.get(clientId) ?? 0;
    if (running >= limit) {
      throw new ApiError(429, 'TOO_MANY_REQUESTS', RcModelApi.tooManyRequests({ limit }), { 'Retry-After': '1' });
    }
    this.#inFlight.set(clientId, running + 1);
    try {
      const submitter: JobSubmitter = { kind: 'service', id: 'model-api', clientId };
      switch (route.kind) {
        case 'transcriptions':
          return await this.#transcribe(request, response, principal, submitter, audit);
        case 'speech':
          return await this.#speech(request, response, principal, submitter, audit);
        case 'images':
          return await this.#images(request, response, principal, submitter, audit);
        case 'chat':
          return await this.#chat(request, response, principal, submitter, audit);
      }
    } finally {
      const left = (this.#inFlight.get(clientId) ?? 1) - 1;
      if (left > 0) this.#inFlight.set(clientId, left);
      else this.#inFlight.delete(clientId);
    }
  }

  async #transcribe(
    request: IncomingMessage,
    response: ServerResponse,
    principal: ServicePrincipal,
    submitter: JobSubmitter,
    audit: { outcome: string; jobId: Id | null },
  ): Promise<void> {
    const boundary = multipartBoundary(request.headers['content-type']);
    if (!boundary) throw new ApiError(400, 'INVALID_REQUEST', RcModelApi.multipartRequired());
    const dir = path.join(this.#deps.stagingDir, newId('upl'));
    this.#uploads.add(dir);
    try {
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      let upload;
      try {
        upload = await readMultipart(request, { boundary, filePath: path.join(dir, 'upload'), maxBytes: this.#maxUploadBytes });
      } catch (error) {
        if (error instanceof UploadTooLarge) {
          throw new ApiError(413, 'PAYLOAD_TOO_LARGE', RcModelApi.uploadTooLarge({ limit: this.#maxUploadBytes }));
        }
        if (error instanceof MalformedUpload) {
          if (principal.signal.aborted) throw new ClientGone();
          throw new ApiError(400, 'INVALID_REQUEST', RcModelApi.multipartInvalid({ reason: localizedOf(error) }));
        }
        throw error;
      }
      const { fields, file } = upload;
      if (!file || file.field !== 'file') throw new ApiError(400, 'INVALID_REQUEST', RcModelApi.fileFieldMissing());
      if (file.size === 0) throw new ApiError(400, 'INVALID_REQUEST', RcModelApi.fileEmpty());
      const name = fields.get('model')?.[0]?.trim();
      if (!name) throw new ApiError(400, 'INVALID_REQUEST', RcModelApi.fieldMissing({ key: 'model' }));
      const options = transcriptionOptions(fields);
      const target = this.#resolve(name, 'transcribe');
      const grant = await this.#approve(
        principal,
        'POST /v1/audio/transcriptions',
        RcModelApi.summaryTranscribe({ size: sizeText(file.size), model: describe(name, target) }).text,
        { capability: 'transcribe', target },
      );
      const { jobId } = await this.#submit(grant, () =>
        this.#deps.models.jobs.submitTranscribeWithoutVideo(
          {
            file: file.path,
            mediaType: file.contentType,
            ...providerOf(target),
            ...(options.language ? { language: options.language } : {}),
            ...(options.hint ? { hint: options.hint } : {}),
          },
          submitter,
          grant,
        ),
      );
      audit.jobId = jobId;
      const record = await this.#wait(jobId, principal.signal);
      const bytes = await this.#deps.models.jobs.artifacts.read(record.result!.artifactId);
      if (!bytes) throw new ApiError(500, 'INTERNAL', RcModelApi.transcriptMissing());
      const result = JSON.parse(bytes.toString('utf8')) as AsrResult;
      const { body, contentType } = transcriptionBody(result, options, this.#trace(record));
      this.#send(response, 200, body, contentType, { 'X-BaoCut-Job-Id': jobId });
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      this.#uploads.delete(dir);
    }
  }

  async #speech(
    request: IncomingMessage,
    response: ServerResponse,
    principal: ServicePrincipal,
    submitter: JobSubmitter,
    audit: { outcome: string; jobId: Id | null },
  ): Promise<void> {
    const body = jsonObject(await this.#readJson(request));
    const name = modelName(body);
    const params = speechRequest(body);
    const target = this.#resolve(name, 'synthesizeSpeech');
    const chars = [...params.text].length;
    const grant = await this.#approve(
      principal,
      'POST /v1/audio/speech',
      RcModelApi.summarySpeech({ model: describe(name, target), voice: params.voice ?? null, chars }).text,
      { capability: 'synthesizeSpeech', target, quantity: { chars } },
    );
    const { jobId } = await this.#submit(grant, () =>
      this.#deps.models.jobs.submitSynthesizeSpeech({ ...params, ...providerOf(target) }, submitter, grant),
    );
    audit.jobId = jobId;
    const record = await this.#wait(jobId, principal.signal);
    const output = record.result?.outputs?.[0];
    const bytes = output ? await this.#deps.models.jobs.artifacts.read(output.artifactId) : null;
    if (!output || !bytes) throw new ApiError(500, 'INTERNAL', RcModelApi.speechMissing());
    this.#send(response, 200, bytes, output.mediaType, { 'X-BaoCut-Job-Id': jobId });
  }

  async #images(
    request: IncomingMessage,
    response: ServerResponse,
    principal: ServicePrincipal,
    submitter: JobSubmitter,
    audit: { outcome: string; jobId: Id | null },
  ): Promise<void> {
    const body = jsonObject(await this.#readJson(request));
    const name = modelName(body);
    const params = imageRequest(body);
    const target = this.#resolve(name, 'generateImage');
    const grant = await this.#approve(
      principal,
      'POST /v1/images/generations',
      RcModelApi.summaryImages({ count: params.count ?? 1, model: describe(name, target), promptChars: [...params.prompt].length }).text,
      { capability: 'generateImage', target, quantity: { count: params.count ?? 1 } },
    );
    const { jobId } = await this.#submit(grant, () =>
      this.#deps.models.jobs.submitGenerateImage({ ...params, ...providerOf(target) }, submitter, grant),
    );
    audit.jobId = jobId;
    const record = await this.#wait(jobId, principal.signal);
    const data: { b64_json: string }[] = [];
    for (const output of record.result?.outputs ?? []) {
      const bytes = await this.#deps.models.jobs.artifacts.read(output.artifactId);
      if (!bytes) throw new ApiError(500, 'INTERNAL', RcModelApi.imageMissing());
      data.push({ b64_json: bytes.toString('base64') });
    }
    const first = record.result?.outputs?.[0];
    this.#sendJson(response, 200, {
      created: Math.floor(Date.parse(record.createdAt) / 1000),
      data,
      ...(first ? { output_format: first.mediaType.replace(/^image\//, '') } : {}),
      ...(first?.media.kind === 'image' ? { size: `${first.media.width}x${first.media.height}` } : {}),
      baocut: this.#trace(record),
    });
  }

  async #chat(
    request: IncomingMessage,
    response: ServerResponse,
    principal: ServicePrincipal,
    submitter: JobSubmitter,
    audit: { outcome: string; jobId: Id | null },
  ): Promise<void> {
    const body = jsonObject(await this.#readJson(request));
    const name = modelName(body);
    const chat = chatRequest(body);
    const target = this.#resolve(name, 'generateText');
    const chars = chat.request.messages.reduce((sum, m) => sum + [...m.content].length, 0);
    const grant = await this.#approve(
      principal,
      'POST /v1/chat/completions',
      RcModelApi.summaryChat({
        model: describe(name, target),
        messages: chat.request.messages.length,
        chars,
        structured: chat.request.responseFormat?.type === 'json',
      }).text,
      { capability: 'generateText', target, quantity: { chars } },
    );
    const { jobId } = await this.#submit(grant, () =>
      this.#deps.models.jobs.submitGenerateText({ ...chat.request, ...providerOf(target) }, submitter, grant),
    );
    audit.jobId = jobId;
    const record = await this.#wait(jobId, principal.signal);
    const text = record.result?.text;
    const bytes = record.result ? await this.#deps.models.jobs.artifacts.read(record.result.artifactId) : null;
    if (!text || !bytes) throw new ApiError(500, 'INTERNAL', RcModelApi.textMissing());
    const outcome: ChatOutcome = {
      id: `chatcmpl-${jobId}`,
      model: name,
      created: Math.floor(Date.parse(record.createdAt) / 1000),
      content: bytes.toString('utf8'),
      finishReason: text.finishReason,
      usage: text.usage,
      baocut: { ...this.#trace(record), modelVersion: text.modelVersion, notes: text.notes },
    };
    if (chat.stream) {
      this.#send(response, 200, chatCompletionStream(outcome, chat.includeUsage), 'text/event-stream; charset=utf-8', {
        'Cache-Control': 'no-cache',
        'X-BaoCut-Job-Id': jobId,
      });
    } else {
      this.#sendJson(response, 200, chatCompletion(outcome));
    }
  }

  /** 响应里的追溯信息：任务与实际用的 Provider、模型（生成记录在任务中心里看）。 */
  #trace(record: JobRecord): Record<string, unknown> {
    return { jobId: record.jobId, providerId: record.providerId, modelId: record.modelId };
  }

  #level() {
    return this.#deps.store.get('model-api').policy.level;
  }

  #resolve(name: string, capability: ModelServiceCapability): ModelApiTarget {
    const { routing, aliases } = this.#config();
    return resolveModel(name, capability, this.#deps.models.services.view(), routing, aliases);
  }

  /**
   * 路由之后、提交之前（§4.8、§12.5）：先判断数据外发的授权与预算，再按服务等级确认。
   * - 额度不够：409 `BUDGET_EXCEEDED`，任何等级都不进审批；
   * - `auto` 等级免的是逐次确认，不是外发授权：没有授权覆盖的外发是 403 `GRANT_REQUIRED`；
   * - `ask` 等级：一条服务审批（没有授权覆盖的外发是 `high`，带上要授权的数据），允许后发放授权并点名使用；
   *   拒绝、超时与取消都是 403。
   */
  async #approve(
    principal: ServicePrincipal,
    endpoint: string,
    summary: string,
    call: { capability: ModelServiceCapability; target: ModelApiTarget; quantity?: { count?: number; chars?: number } },
  ): Promise<JobGrantHint | undefined> {
    const level = this.#level();
    if (level === 'read') throw new ApiError(403, 'SERVICE_READ_ONLY', RcModelApi.readOnly());
    let plan: OutboundPlan;
    try {
      plan = this.#deps.models.grants.plan({
        capability: call.capability,
        providerId: call.target.providerId,
        modelId: call.target.modelId,
        videoId: null,
        taskId: null,
        ...(call.quantity ? { quantity: call.quantity } : {}),
        ...outboundPurpose(RcModelApi.grantPurpose({ endpoint })),
      });
    } catch (error) {
      if (error instanceof RpcError) throw fromRpcError(error);
      throw error;
    }
    const item = plan.status === 'approval' ? plan.item : null;
    if (level === 'auto') {
      if (item) {
        throw new ApiError(403, 'GRANT_REQUIRED', RcModelApi.grantRequiredAsk({ reason: grantRequiredDetails([item]).message }));
      }
      return undefined;
    }
    const { outcome, grant } = await this.#deps.approvals.resolve(
      { serviceId: 'model-api', clientId: principal.clientId, clientName: principal.clientName, tool: endpoint, video: null, summary },
      principal.signal,
      item ? { risk: 'high', grants: [item] } : {},
    );
    if (outcome === 'allowed') {
      if (!item) return undefined;
      const issued = this.#deps.models.grants.issueForApproval(item, grant, { approvalId: null, taskId: null });
      return { grantId: issued.grantId };
    }
    if (outcome === 'cancelled' && principal.signal.aborted) throw new ClientGone();
    const message =
      outcome === 'denied'
        ? RcModelApi.approvalDenied()
        : outcome === 'timeout'
          ? RcModelApi.approvalTimeout()
          : RcModelApi.approvalCancelled();
    throw new ApiError(403, 'SERVICE_APPROVAL_DENIED', message);
  }

  /** 提交（错误换成 HTTP 的）；提交被拒时撤销为它发放、没用上的「只这一次」授权。 */
  #submit<T>(grant: JobGrantHint | undefined, run: () => Promise<T>): Promise<T> {
    return submit(() => this.#deps.models.grants.submitWith(grant, run));
  }

  /** 等任务终结；调用方先断开时取消任务。没有完成时按任务的错误回答。 */
  async #wait(jobId: Id, signal: AbortSignal): Promise<JobRecord> {
    const jobs = this.#deps.models.jobs;
    const settled = jobs.settled(jobId);
    const aborted = new Promise<'aborted'>((resolve) => {
      if (signal.aborted) resolve('aborted');
      else signal.addEventListener('abort', () => resolve('aborted'), { once: true });
    });
    if ((await Promise.race([settled, aborted])) === 'aborted') {
      await jobs.cancel(jobId).catch(() => {});
      throw new ClientGone();
    }
    const record = jobs.inspect(jobId);
    if (record.state === 'completed') return record;
    if (record.state === 'cancelled') throw new ApiError(409, 'JOB_CANCELLED', RcModelApi.jobCancelled());
    throw fromJobError(record.error);
  }

  async #readJson(request: IncomingMessage): Promise<unknown> {
    const declared = Number(request.headers['content-length']);
    const tooLarge = () => new ApiError(413, 'PAYLOAD_TOO_LARGE', RcModelApi.bodyTooLarge({ limit: this.#maxJsonBytes }));
    if (Number.isFinite(declared) && declared > this.#maxJsonBytes) throw tooLarge();
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      await consume(request, async (chunk) => {
        total += chunk.length;
        if (total > this.#maxJsonBytes) throw tooLarge();
        chunks.push(chunk);
      });
    } catch (error) {
      if (error instanceof MalformedUpload) throw new ClientGone();
      throw error;
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new ApiError(400, 'INVALID_REQUEST', RcModelApi.invalidJson());
    }
  }

  // ---- 回答与审计 ----

  #refuse(request: IncomingMessage, response: ServerResponse, error: ApiError): void {
    this.#log.info('External request refused', { serviceId: 'model-api', status: error.status, code: error.code });
    this.#sendError(response, error, !request.complete);
  }

  #sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    this.#send(response, status, JSON.stringify(body), 'application/json; charset=utf-8', headers);
  }

  #send(response: ServerResponse, status: number, body: string | Buffer, contentType: string, headers: Record<string, string> = {}): void {
    if (response.destroyed) return;
    response.writeHead(status, {
      ...headers,
      'Content-Type': contentType,
      'Content-Length': String(Buffer.byteLength(body)),
      'Cache-Control': headers['Cache-Control'] ?? 'no-store',
    });
    response.end(body);
  }

  /** 错误体；请求体还没读完时关掉连接（不读剩下的上传）。 */
  #sendError(response: ServerResponse, error: ApiError, close: boolean): void {
    this.#sendJson(response, error.status, error.body(), { ...error.headers, ...(close ? { Connection: 'close' } : {}) });
  }

  #audit(principal: ServicePrincipal, endpoint: string, outcome: string, jobId: Id | null, status: number): void {
    this.#recent.add({
      at: nowIso(),
      clientId: principal.clientId,
      clientName: principal.clientName,
      tool: endpoint,
      videoId: null,
      outcome,
    });
    this.#log.info('External request', { serviceId: 'model-api', clientId: principal.clientId, endpoint, status, outcome, jobId });
    this.#deps.onChange();
  }

  /** 清掉上次留下的上传（还在用的除外）。 */
  async #sweepStaging(): Promise<void> {
    await fs.mkdir(this.#deps.stagingDir, { recursive: true, mode: 0o700 });
    for (const name of await fs.readdir(this.#deps.stagingDir).catch(() => [] as string[])) {
      const dir = path.join(this.#deps.stagingDir, name);
      if (!this.#uploads.has(dir)) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function providerOf(target: ModelApiTarget): { provider: string; model?: string } {
  return { provider: target.providerId, ...(target.modelId !== null ? { model: target.modelId } : {}) };
}

function describe(name: string, target: ModelApiTarget): string | Localized {
  if (target.modelId === null) {
    return RcModelApi.modelWithCanonical({ name, canonical: `${target.providerId}/${RcModelApi.defaultModel().text}` });
  }
  const canonical = `${target.providerId}/${target.modelId}`;
  return name === canonical ? name : RcModelApi.modelWithCanonical({ name, canonical });
}

function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** 提交时的 `RpcError` 换成 HTTP 的错误。 */
async function submit<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof RpcError) throw fromRpcError(error);
    throw error;
  }
}

function toApiError(error: unknown, log: Logger): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof RpcError) return fromRpcError(error);
  log.warn('Model API request failed', { error: String(error) });
  return new ApiError(500, 'INTERNAL', RcModelApi.internalError());
}
