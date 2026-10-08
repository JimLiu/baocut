import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient, applyServicesEvent } from '@baocut/client';
import { FAKE_MODEL_WORKER } from '@baocut/jobs';
import { BUNDLES, DEFAULT_TRANSCRIBE_BUNDLE, MANIFEST_FILE } from '@baocut/models';
import { chatCompletionReply, fakeOpenAiHandler, startFakeProviderServer, type FakeProviderServer } from '@baocut/providers/testing';
import { MODEL_API_INTERFACE_VERSION, type ServicesSnapshot } from '@baocut/protocol';
import { resolveRuntimeHome, type RuntimeHome } from '@baocut/runtime-storage';
import { startRuntime, type RunningRuntime } from '../runtime.ts';

/**
 * 模型接口服务（架构设计 §4.8、§12.8）：OpenAI 形状的本机端点。临时的 Runtime Home、系统挑的端口、假的 OpenAI
 * （本机 HTTP）与假的 Model Worker；不需要视频引擎。本机转写要 Apple Silicon（默认模型包是 MLX）与 ffmpeg，缺了就跳过那几条。
 */

const OPENAI_KEY = 'sk-test-ONLY-FOR-TESTS-model-api-0123456789';
const PROMPT_MARK = 'PROMPT-MARK-7f3a9c';
const appleSilicon = process.platform === 'darwin' && process.arch === 'arm64';
const ffmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const localTranscribe = appleSilicon && ffmpeg;
if (!localTranscribe) console.warn('跳过模型接口服务的本机转写测试：要 Apple Silicon 与 ffmpeg');

const MAX_UPLOAD = 256 * 1024;
const MAX_JSON = 16 * 1024;

async function until<T>(read: () => T | undefined | null | false | Promise<T | undefined | null | false>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** 给默认模型包的每个仓库写一份合成的清单与文件。 */
async function installSyntheticModels(modelsDir: string): Promise<void> {
  const bundle = BUNDLES.find((b) => b.bundleId === DEFAULT_TRANSCRIBE_BUNDLE)!;
  for (const source of Object.values(bundle.components)) {
    if (!source) continue;
    const dir = path.join(modelsDir, ...source.repo.split('/'));
    await fs.mkdir(dir, { recursive: true });
    const content = `synthetic ${source.repo}`;
    await fs.writeFile(path.join(dir, 'model.safetensors'), content);
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const manifest = {
      format_version: 1,
      repo: source.repo,
      revision: source.revision,
      files: [{ path: 'model.safetensors', size: content.length, sha256 }],
    };
    await fs.writeFile(path.join(dir, MANIFEST_FILE), JSON.stringify(manifest));
  }
}

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  text: string;
  json: any;
}

interface Send {
  method?: string;
  token?: string | null;
  headers?: Record<string, string>;
  json?: unknown;
  body?: Buffer;
  contentType?: string;
  /** 不带 Content-Length（分块传输）。 */
  chunked?: boolean;
}

/** 原始 HTTP 请求：`Host`、`Origin` 与 `Authorization` 都由测试决定。服务端先回答再关连接（413）时照样拿到回答。 */
function open(base: string, pathname: string, options: Send = {}): { request: http.ClientRequest; reply: Promise<Reply> } {
  const target = new URL(base);
  const payload = options.json !== undefined ? Buffer.from(JSON.stringify(options.json)) : options.body;
  let request!: http.ClientRequest;
  const reply = new Promise<Reply>((resolve, reject) => {
    let answered = false;
    request = http.request(
      {
        host: target.hostname,
        port: target.port,
        path: pathname,
        method: options.method ?? (payload ? 'POST' : 'GET'),
        headers: {
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...(options.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(options.contentType ? { 'Content-Type': options.contentType } : {}),
          ...(payload && !options.chunked ? { 'Content-Length': String(payload.length) } : {}),
          ...options.headers,
        },
      },
      (response) => {
        answered = true;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks);
          const text = body.toString('utf8');
          let json: unknown = null;
          try {
            json = JSON.parse(text);
          } catch {
            // 不是 JSON。
          }
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body, text, json });
        });
        response.on('error', reject);
      },
    );
    request.on('error', (error) => {
      if (!answered) reject(error);
    });
    if (payload) request.write(payload);
    request.end();
  });
  return { request, reply };
}

function send(base: string, pathname: string, options: Send = {}): Promise<Reply> {
  return open(base, pathname, options).reply;
}

function multipart(fields: Record<string, string | string[]>, file: { name: string; type: string; data: Buffer } | null) {
  const boundary = `----baocut${crypto.randomBytes(8).toString('hex')}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${v}\r\n`));
    }
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
      ),
      file.data,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe('模型接口服务', () => {
  let dir: string;
  let fixtures: string;
  let wav: Buffer;
  let home: RuntimeHome;
  let runtime: RunningRuntime;
  let client: BaoCutClient;
  let openai: FakeProviderServer;
  let control: string;
  let base: string;

  beforeAll(async () => {
    fixtures = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-model-api-fixtures-'));
    if (ffmpeg) {
      const file = path.join(fixtures, 'speech.wav');
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-ac', '1', '-ar', '16000', file]);
      wav = await fs.readFile(file);
    }
  });

  afterAll(async () => {
    await fs.rm(fixtures, { recursive: true, force: true });
  });

  beforeEach(async () => {
    openai = await startFakeProviderServer(fakeOpenAiHandler());
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-model-api-'));
    home = resolveRuntimeHome({ BAOCUT_HOME: dir });
    control = path.join(dir, 'worker-control.json');
    await fs.writeFile(control, '{}');
    if (appleSilicon) await installSyntheticModels(home.modelsDir);
    runtime = await startRuntime({
      home,
      drivers: () => [],
      watchSpace: false,
      engineHost: null,
      modelWorker: { command: process.execPath, args: [FAKE_MODEL_WORKER, '--control', control] },
      jobIdleMs: 60_000,
      initiator: { discoverer: null },
      nodes: { host: '127.0.0.1', advertiser: null },
      online: { baseUrls: { openai: `${openai.origin}/v1` }, http: { backoffMs: () => 10 } },
      services: { approvalTimeoutMs: 400, modelApi: { maxUploadBytes: MAX_UPLOAD, maxJsonBytes: MAX_JSON } },
    });
    const { endpoint, token } = runtime.discovery;
    client = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'desktop', name: 'test', version: '0' },
      reconnect: false,
    });
    await client.connect();
    await client.request('services.configure', { serviceId: 'model-api', port: 0, level: 'auto' });
    const { service } = await client.request('services.start', { serviceId: 'model-api' });
    expect(service.state).toBe('on');
    expect(service.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    base = service.endpoint!.replace(/\/v1$/, '');
  });

  afterEach(async () => {
    client.close();
    await runtime.close();
    await openai.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function issue(name = '应用'): Promise<{ token: string; clientId: string }> {
    const { client: issued, token } = await client.request('services.modelApi.createClient', { name });
    return { token, clientId: issued.clientId };
  }

  async function enableOnline(): Promise<void> {
    await client.request('models.configure', { providerId: 'openai', enabled: true, credential: OPENAI_KEY });
    await client.request('services.configure', { serviceId: 'model-api', routing: { online: true } });
  }

  async function modelIds(token: string): Promise<string[]> {
    const reply = await send(base, '/v1/models', { token });
    expect(reply.status).toBe(200);
    expect(reply.json.object).toBe('list');
    return (reply.json.data as { id: string }[]).map((m) => m.id);
  }

  async function textModel(token: string): Promise<string> {
    const reply = await send(base, '/v1/models', { token });
    return (reply.json.data as { id: string; baocut: { capability: string } }[]).find(
      (m) => m.baocut.capability === 'generateText' && m.id.startsWith('openai/'),
    )!.id;
  }

  it('认证与来源：没有令牌、令牌错误 → 401；带 Origin、Host 不是回环 → 403；吊销后失效；每个回答都带接口版本', async () => {
    const { token, clientId } = await issue();
    const [, secret] = token.split('.');

    const missing = await send(base, '/v1/models');
    expect(missing.status).toBe(401);
    expect(missing.headers['www-authenticate']).toBe('Bearer');
    expect(missing.json).toEqual({
      error: { message: expect.any(String), type: 'authentication_error', code: 'AUTHENTICATION_REQUIRED', param: null },
    });
    expect(missing.headers['x-baocut-interface-version']).toBe(MODEL_API_INTERFACE_VERSION);
    expect((await send(base, '/v1/models', { token: `${token}x` })).status).toBe(401);
    expect((await send(base, '/v1/models', { headers: { Authorization: token } })).status).toBe(401);

    const origin = await send(base, '/v1/models', { token, headers: { Origin: 'https://evil.example' } });
    expect(origin.status).toBe(403);
    expect(origin.json.error).toMatchObject({ code: 'ORIGIN_NOT_ALLOWED', type: 'permission_error' });
    const host = await send(base, '/v1/models', { token, headers: { Host: 'evil.example' } });
    expect(host.status).toBe(403);
    expect(host.json.error.code).toBe('HOST_NOT_ALLOWED');
    // 服务的令牌各管各的：MCP 的令牌不能用在这里。
    const { token: mcpToken } = await client.request('services.mcp.createClient', { name: 'mcp' });
    expect((await send(base, '/v1/models', { token: mcpToken })).status).toBe(401);

    const ok = await send(base, '/v1/models', { token, headers: { Host: `localhost:${new URL(base).port}` } });
    expect(ok.status).toBe(200);
    expect(ok.headers['x-baocut-interface-version']).toBe(MODEL_API_INTERFACE_VERSION);
    const info = await send(base, '/v1/baocut/info', { token });
    expect(info.json).toMatchObject({ service: 'model-api', interfaceVersion: MODEL_API_INTERFACE_VERSION, streaming: 'single-chunk' });
    expect((await send(base, '/v1/nothing', { token })).json.error.code).toBe('NOT_FOUND');
    const wrongMethod = await send(base, '/v1/chat/completions', { token });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.allow).toBe('POST');

    // 连接信息不带令牌明文。
    const connection = await client.request('services.modelApi.connectionInfo', { clientId });
    expect(connection).toMatchObject({ baseUrl: `${base}/v1`, interfaceVersion: MODEL_API_INTERFACE_VERSION, notice: null });
    expect(connection.snippet).toContain(`OPENAI_BASE_URL=${base}/v1`);
    expect(JSON.stringify(connection)).not.toContain(secret);

    const { clients } = await client.request('services.modelApi.revokeClient', { clientId });
    expect(clients).toEqual([]);
    expect((await send(base, '/v1/models', { token })).status).toBe(401);

    const { services } = await client.request('services.list', {});
    const status = services.find((s) => s.serviceId === 'model-api')!;
    expect(status.recentRequests.map((r) => r.outcome)).toContain('ok');
    expect(JSON.stringify(status)).not.toContain(secret);
  });

  it('/v1/models 按路由开关：默认只有本机；开启在线路由后列出在线模型，关掉又看不见，按名请求 404 或 503', async () => {
    const { token } = await issue();
    const local = await modelIds(token);
    expect(local.some((id) => id.startsWith('openai/'))).toBe(false);
    if (appleSilicon) {
      expect(local[0]).toBe('whisper-1');
      expect(local).toContain(`local/${DEFAULT_TRANSCRIBE_BUNDLE}`);
    }

    // 在线服务启用了，但路由没开：仍然看不见。
    await client.request('models.configure', { providerId: 'openai', enabled: true, credential: OPENAI_KEY });
    expect((await modelIds(token)).some((id) => id.startsWith('openai/'))).toBe(false);
    const closed = await send(base, '/v1/audio/speech', { token, json: { model: 'openai/gpt-4o-mini-tts', input: 'hi' } });
    expect(closed.status).toBe(503);
    expect(closed.json.error).toMatchObject({ code: 'CAPABILITY_NOT_CONFIGURED', type: 'service_unavailable_error' });
    expect(closed.json.error.message).toContain('--route-online on');

    const { service } = await client.request('services.configure', { serviceId: 'model-api', routing: { online: true } });
    expect(service.modelApi!.routing).toEqual({ online: true, nodes: false, agent: false });
    const online = await modelIds(token);
    expect(online).toEqual(expect.arrayContaining(['openai/gpt-4o-mini-tts', 'openai/gpt-image-1', 'openai/whisper-1']));
    const single = await send(base, '/v1/models/openai/gpt-image-1', { token });
    expect(single.json).toMatchObject({ id: 'openai/gpt-image-1', object: 'model', owned_by: 'openai' });
    expect(single.json.baocut.capability).toBe('generateImage');

    await client.request('services.configure', { serviceId: 'model-api', routing: { online: false } });
    expect((await modelIds(token)).some((id) => id.startsWith('openai/'))).toBe(false);
    expect((await send(base, '/v1/models/openai/gpt-image-1', { token })).status).toBe(404);
    if (appleSilicon) {
      // 转写本机就有：在线模型按名请求是 404。
      const { body, contentType } = multipart({ model: 'openai/whisper-1' }, { name: 'a.wav', type: 'audio/wav', data: Buffer.alloc(64) });
      const hidden = await send(base, '/v1/audio/transcriptions', { token, body, contentType });
      expect(hidden.status).toBe(404);
      expect(hidden.json.error).toMatchObject({ code: 'MODEL_NOT_FOUND', type: 'not_found_error' });
    }

    // 节点与智能体的开关各自独立、落盘；只适用于模型接口服务。
    await client.request('services.configure', { serviceId: 'model-api', routing: { nodes: true }, maxConcurrentPerClient: 2 });
    const stored = JSON.parse(await fs.readFile(home.servicesFile, 'utf8'));
    expect(JSON.stringify(stored)).toContain('"nodes":true');
    expect(JSON.stringify(stored)).not.toContain(OPENAI_KEY);
    const refused = await client.request('services.configure', { serviceId: 'mcp', routing: { online: true } }).catch((e: unknown) => e);
    expect(refused).toMatchObject({ code: 'invalid-request' });

    // 别名：设、用、删。
    const { aliases } = await client.request('services.modelApi.setAlias', {
      alias: 'my-voice',
      capability: 'synthesizeSpeech',
      providerId: 'openai',
      modelId: 'gpt-4o-mini-tts',
    });
    expect(aliases.map((a) => a.alias)).toEqual(['whisper-1', 'my-voice']);
    await client.request('services.configure', { serviceId: 'model-api', routing: { online: true } });
    expect((await modelIds(token)).slice(0, appleSilicon ? 2 : 1)).toContain('my-voice');
    const viaAlias = await send(base, '/v1/audio/speech', { token, json: { model: 'my-voice', input: 'hi' } });
    expect(viaAlias.status).toBe(200);
    // 别名的能力不对：404。
    const wrongCapability = await send(base, '/v1/chat/completions', {
      token,
      json: { model: 'my-voice', messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(wrongCapability.status).toBe(404);
    expect((await client.request('services.modelApi.removeAlias', { alias: 'my-voice' })).aliases.map((a) => a.alias)).toEqual([
      'whisper-1',
    ]);
    expect((await send(base, '/v1/audio/speech', { token, json: { model: 'my-voice', input: 'hi' } })).status).toBe(404);
  });

  it('语音、图片与文本：形状、Job 的提交者与生成记录；不支持的参数 400；未知模型 404', async () => {
    const { token, clientId } = await issue();
    await enableOnline();

    const speech = await send(base, '/v1/audio/speech', {
      token,
      json: { model: 'openai/gpt-4o-mini-tts', input: 'hello', voice: 'alloy' },
    });
    expect(speech.status).toBe(200);
    expect(speech.headers['content-type']).toBe('audio/mpeg');
    expect(speech.body.length).toBeGreaterThan(0);
    const speechJob = await client.request('jobs.inspect', { jobId: speech.headers['x-baocut-job-id'] as string });
    expect(speechJob).toMatchObject({
      kind: 'synthesizeSpeech',
      state: 'completed',
      videoId: null,
      providerId: 'openai',
      modelId: 'gpt-4o-mini-tts',
      submitter: { kind: 'service', id: 'model-api', clientId },
    });
    const wav = await send(base, '/v1/audio/speech', {
      token,
      json: { model: 'openai/gpt-4o-mini-tts', input: 'hi', response_format: 'wav' },
    });
    expect(wav.headers['content-type']).toBe('audio/wav');
    expect(
      (await send(base, '/v1/audio/speech', { token, json: { model: 'openai/gpt-4o-mini-tts', input: 'hi', stream_format: 'sse' } })).json
        .error.code,
    ).toBe('UNSUPPORTED_PARAMETER');
    // 用户库的音色不对外部程序开放（架构设计 §5.9）：400，不创建任务，请求不到达供应商。
    const speechCalls = openai.requests.filter((r) => r.path.endsWith('/audio/speech')).length;
    const jobsBefore = (await client.request('jobs.list', {})).jobs.length;
    const libraryVoice = await send(base, '/v1/audio/speech', {
      token,
      json: { model: 'openai/gpt-4o-mini-tts', input: 'hi', voice: 'library:voc_mine' },
    });
    expect(libraryVoice.status).toBe(400);
    expect(libraryVoice.json.error).toMatchObject({ code: 'INVALID_REQUEST', message: expect.stringContaining('用户库') });
    expect(openai.requests.filter((r) => r.path.endsWith('/audio/speech'))).toHaveLength(speechCalls);
    expect((await client.request('jobs.list', {})).jobs).toHaveLength(jobsBefore);

    const image = await send(base, '/v1/images/generations', {
      token,
      json: { model: 'openai/gpt-image-1', prompt: 'a cat', size: '1024x1024' },
    });
    expect(image.status).toBe(200);
    expect(image.json).toMatchObject({ created: expect.any(Number), data: [{ b64_json: expect.any(String) }] });
    expect(Buffer.from(image.json.data[0].b64_json, 'base64').subarray(1, 4).toString('latin1')).toBe('PNG');
    expect((await client.request('jobs.inspect', { jobId: image.json.baocut.jobId })).submitter).toEqual({
      kind: 'service',
      id: 'model-api',
      clientId,
    });
    const url = await send(base, '/v1/images/generations', {
      token,
      json: { model: 'openai/gpt-image-1', prompt: 'a cat', response_format: 'url' },
    });
    expect(url.status).toBe(400);
    expect(url.json.error).toMatchObject({ code: 'UNSUPPORTED_PARAMETER', type: 'invalid_request_error' });

    const model = await textModel(token);
    const messages = [
      { role: 'developer', content: 'be brief' },
      { role: 'user', content: [{ type: 'text', text: `say hi ${PROMPT_MARK}` }] },
    ];
    const chat = await send(base, '/v1/chat/completions', { token, json: { model, messages, max_completion_tokens: 50 } });
    expect(chat.status).toBe(200);
    expect(chat.json).toMatchObject({
      object: 'chat.completion',
      model,
      choices: [{ index: 0, message: { role: 'assistant', content: 'hello world' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
      baocut: { providerId: 'openai', modelId: model.slice('openai/'.length) },
    });
    const sent = openai.requests.find((r) => r.path.endsWith('/chat/completions'))!.json as Record<string, any>;
    expect(sent.messages[0]).toMatchObject({ role: 'system' });
    expect(sent.max_completion_tokens).toBe(50);
    const chatJob = await client.request('jobs.inspect', { jobId: chat.json.baocut.jobId });
    expect(chatJob).toMatchObject({ kind: 'generateText', state: 'completed', submitter: { kind: 'service', id: 'model-api', clientId } });

    const stream = await send(base, '/v1/chat/completions', {
      token,
      json: { model, messages: [{ role: 'user', content: 'hi' }], stream: true, stream_options: { include_usage: true } },
    });
    expect(stream.status).toBe(200);
    expect(stream.headers['content-type']).toMatch(/^text\/event-stream/);
    const events = stream.text.split('\n\n').filter(Boolean);
    expect(events.at(-1)).toBe('data: [DONE]');
    const chunks = events.slice(0, -1).map((e) => JSON.parse(e.slice('data: '.length)));
    expect(chunks[0].choices[0].delta).toEqual({ role: 'assistant', content: 'hello world' });
    expect(chunks.at(-1).usage).toMatchObject({ total_tokens: 17 });

    for (const [body, code] of [
      [{ model, messages: [{ role: 'user', content: 'hi' }], tools: [{ type: 'function' }] }, 'UNSUPPORTED_PARAMETER'],
      [{ model, messages: [{ role: 'user', content: 'hi' }], n: 2 }, 'UNSUPPORTED_PARAMETER'],
      [{ model, messages: [] }, 'INVALID_REQUEST'],
      [{ messages: [{ role: 'user', content: 'hi' }] }, 'INVALID_REQUEST'],
    ] as const) {
      const reply = await send(base, '/v1/chat/completions', { token, json: body });
      expect(reply.status).toBe(400);
      expect(reply.json.error.code).toBe(code);
    }
    const unknown = await send(base, '/v1/chat/completions', {
      token,
      json: { model: 'no-such-model', messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(unknown.status).toBe(404);
    expect(unknown.json.error.code).toBe('MODEL_NOT_FOUND');
    const badJson = await send(base, '/v1/chat/completions', { token, body: Buffer.from('{not json'), contentType: 'application/json' });
    expect(badJson.json.error.code).toBe('INVALID_REQUEST');
    const tooLarge = await send(base, '/v1/chat/completions', {
      token,
      json: { model, messages: [{ role: 'user', content: 'x'.repeat(MAX_JSON) }] },
    });
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.json.error.code).toBe('PAYLOAD_TOO_LARGE');
    const chunkedTooLarge = await send(base, '/v1/chat/completions', {
      token,
      chunked: true,
      json: { model, messages: [{ role: 'user', content: 'x'.repeat(MAX_JSON) }] },
    });
    expect(chunkedTooLarge.status).toBe(413);

    // 密钥、令牌与请求正文都不进日志、配置与最近请求。
    const { services } = await client.request('services.list', {});
    const recent = JSON.stringify(services.find((s) => s.serviceId === 'model-api')!.recentRequests);
    expect(recent).toContain('POST /v1/chat/completions');
    for (const text of [
      recent,
      await fs.readFile(path.join(dir, 'logs', 'runtime.log'), 'utf8').catch(() => ''),
      await fs.readFile(home.servicesFile, 'utf8'),
    ]) {
      expect(text).not.toContain(OPENAI_KEY);
      expect(text).not.toContain(token.split('.')[1]!);
      expect(text).not.toContain(PROMPT_MARK);
    }
    for (const reply of [speech, image, chat, stream, unknown]) expect(reply.text).not.toContain(OPENAI_KEY);
  });

  it('结构化输出与供应商的失败：json_schema 通过与不通过；429 原样转出 Retry-After', async () => {
    const { token } = await issue();
    await enableOnline();
    const model = await textModel(token);
    const schema = { type: 'object', properties: { title: { type: 'string' } }, required: ['title'], additionalProperties: false };
    const body = {
      model,
      messages: [{ role: 'user', content: 'title?' }],
      response_format: { type: 'json_schema', json_schema: { name: 'out', schema, strict: true } },
    };

    openai.handler = (request) => chatCompletionReply(request, '{"title":"好"}');
    const ok = await send(base, '/v1/chat/completions', { token, json: body });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.json.choices[0].message.content)).toEqual({ title: '好' });
    const sent = openai.requests.at(-1)!.json as Record<string, any>;
    expect(sent.response_format).toMatchObject({ type: 'json_schema', json_schema: { schema } });

    // json_object：任意 JSON 对象。
    openai.handler = (request) => chatCompletionReply(request, '{"a":1}');
    const object = await send(base, '/v1/chat/completions', {
      token,
      json: { model, messages: [{ role: 'user', content: 'json' }], response_format: { type: 'json_object' } },
    });
    expect(object.status).toBe(200);
    expect(JSON.parse(object.json.choices[0].message.content)).toEqual({ a: 1 });

    openai.handler = (request) => chatCompletionReply(request, '{"other":1}');
    const invalid = await send(base, '/v1/chat/completions', { token, json: body });
    expect(invalid.status).toBe(502);
    expect(invalid.json.error).toMatchObject({ code: 'MODEL_OUTPUT_INVALID', type: 'server_error' });

    openai.handler = () => ({
      status: 429,
      headers: { 'Retry-After': '120' },
      json: { error: { message: 'quota', type: 'insufficient_quota' } },
    });
    const limited = await send(base, '/v1/chat/completions', { token, json: { model, messages: [{ role: 'user', content: 'hi' }] } });
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('120');
    expect(limited.json.error).toMatchObject({ code: 'PROVIDER_QUOTA_EXCEEDED', type: 'rate_limit_error' });
  });

  it('等级：read 只能查模型列表；ask 每个生成请求一条审批，同意、拒绝与超时', async () => {
    const { token } = await issue('审批');
    await enableOnline();
    await client.request('services.configure', { serviceId: 'model-api', level: 'read' });
    expect((await send(base, '/v1/models', { token })).status).toBe(200);
    const readOnly = await send(base, '/v1/audio/speech', { token, json: { model: 'openai/gpt-4o-mini-tts', input: 'hi' } });
    expect(readOnly.status).toBe(403);
    expect(readOnly.json.error).toMatchObject({ code: 'SERVICE_READ_ONLY', type: 'permission_error' });
    expect(openai.requests.filter((r) => r.path.endsWith('/audio/speech'))).toEqual([]);

    await client.request('services.configure', { serviceId: 'model-api', level: 'ask' });
    let mirror: ServicesSnapshot | null = null;
    client.subscribeServices({
      snapshot: (snapshot) => (mirror = snapshot),
      event: (event) => {
        if (mirror) mirror = applyServicesEvent(mirror, event);
      },
    });
    await until(() => mirror);
    const speak = () => send(base, '/v1/audio/speech', { token, json: { model: 'openai/gpt-4o-mini-tts', input: `hi ${PROMPT_MARK}` } });

    const allowed = speak();
    const approval = await until(() => mirror?.approvals[0]);
    expect(approval).toMatchObject({ serviceId: 'model-api', clientName: '审批', tool: 'POST /v1/audio/speech', video: null });
    expect(approval.summary).not.toContain(PROMPT_MARK);
    await client.request('services.respondToApproval', { approvalId: approval.approvalId, decision: 'allow' });
    expect((await allowed).status).toBe(200);
    await until(() => mirror?.approvals.length === 0);

    const denied = speak();
    const second = await until(() => mirror?.approvals[0]);
    await client.request('services.respondToApproval', { approvalId: second.approvalId, decision: 'deny' });
    const deniedReply = await denied;
    expect(deniedReply.status).toBe(403);
    expect(deniedReply.json.error.code).toBe('SERVICE_APPROVAL_DENIED');

    const timedOut = await speak();
    expect(timedOut.status).toBe(403);
    expect(timedOut.json.error.code).toBe('SERVICE_APPROVAL_DENIED');
    expect(timedOut.json.error.message).toContain('时限');
    expect(openai.requests.filter((r) => r.path.endsWith('/audio/speech'))).toHaveLength(1);
  });

  it('数据外发的授权与预算（§12.5、§7.8）：默认授权覆盖；撤销后 auto 是 403 GRANT_REQUIRED；ask 下高风险审批发放持续授权；用完 409', async () => {
    const { token } = await issue('授权');
    await enableOnline();
    const speechCalls = () => openai.requests.filter((r) => r.path.endsWith('/audio/speech')).length;
    const speak = () => send(base, '/v1/audio/speech', { token, json: { model: 'openai/gpt-4o-mini-tts', input: 'hi' } });

    // 启用 openai 时发放的默认授权（迁移规则）：照常 200；任务记录带着授权、预留与结算（金额未知，只计次数）。
    const ok = await speak();
    expect(ok.status).toBe(200);
    const [byDefault] = (await client.request('grants.list', { recipient: 'openai' })).grants;
    expect(byDefault).toMatchObject({ origin: 'provider-enable', budgetMode: 'per-call-unknown-cost', maxCalls: null, budgetCap: null });
    const job = await client.request('jobs.inspect', { jobId: ok.headers['x-baocut-job-id'] as string });
    expect(job.grant).toMatchObject({
      grantId: byDefault!.grantId,
      dataKinds: ['document'],
      reserved: { calls: 1, amount: null },
      settled: { calls: 1, amount: null, basis: 'unknown' },
    });

    // 撤销：如实报告已经交出的；auto 等级不等于外发授权，请求到不了供应商。
    const revoked = await client.request('grants.revoke', { grantId: byDefault!.grantId });
    expect(revoked.alreadySent).toEqual({ calls: 1, amount: null, unknownCostCalls: 1 });
    const before = speechCalls();
    const refused = await speak();
    expect(refused.status).toBe(403);
    expect(refused.json.error).toMatchObject({ code: 'GRANT_REQUIRED', type: 'permission_error' });
    expect(speechCalls()).toBe(before);

    // ask：带外发的高风险审批；允许并发放一条持续授权（次数上限 2）。
    await client.request('services.configure', { serviceId: 'model-api', level: 'ask' });
    const pending = speak();
    const approval = await until(() => runtime.harness.approvals.pending()[0]);
    expect(approval).toMatchObject({
      risk: 'high',
      grants: [{ recipient: 'openai', dataKinds: ['document'], reason: 'revoked', estimate: null }],
    });
    await client.request('approvals.respond', {
      approvalId: approval.approvalId,
      decision: 'allow',
      grant: { persist: true, scope: 'all', maxCalls: 2 },
    });
    expect((await pending).status).toBe(200);
    const persistent = (await client.request('grants.list', { recipient: 'openai' })).grants.find((g) => g.origin === 'approval')!;
    expect(persistent).toMatchObject({ once: false, maxCalls: 2, scope: { videoId: null } });

    // 回到 auto：有授权覆盖就不再问；第二次用完上限，第三次在审批与提交之前就是 409，不到供应商。
    await client.request('services.configure', { serviceId: 'model-api', level: 'auto' });
    expect((await speak()).status).toBe(200);
    const atCap = speechCalls();
    const exceeded = await speak();
    expect(exceeded.status).toBe(409);
    expect(exceeded.json.error.code).toBe('BUDGET_EXCEEDED');
    expect(speechCalls()).toBe(atCap);
    expect((await client.request('grants.usage', { grantId: persistent.grantId })).grant.usage).toMatchObject({
      calls: 2,
      reservedCalls: 0,
    });
  });

  it('调用方断开时取消 Job；每个客户端的在途请求有上限（429），别的客户端不受影响', async () => {
    const first = await issue('甲');
    const second = await issue('乙');
    await enableOnline();
    await client.request('services.configure', { serviceId: 'model-api', maxConcurrentPerClient: 1 });
    const model = await textModel(first.token);
    openai.handler = () => 'hang';

    const body = { model, messages: [{ role: 'user', content: 'wait' }] };
    const pending = open(base, '/v1/chat/completions', { token: first.token, json: body });
    pending.reply.catch(() => {});
    await openai.waitForRequests(1);
    const { jobs } = await client.request('jobs.list', {});
    expect(jobs).toHaveLength(1);
    const jobId = jobs[0]!.jobId;
    expect(jobs[0]!.submitter).toEqual({ kind: 'service', id: 'model-api', clientId: first.clientId });

    const limited = await send(base, '/v1/chat/completions', { token: first.token, json: body });
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('1');
    expect(limited.json.error).toMatchObject({ code: 'TOO_MANY_REQUESTS', type: 'rate_limit_error' });
    // 乙不受甲的上限影响：请求照常进到供应商。
    const other = open(base, '/v1/chat/completions', { token: second.token, json: body });
    other.reply.catch(() => {});
    await openai.waitForRequests(2);

    pending.request.destroy();
    await until(async () => (await client.request('jobs.inspect', { jobId })).state === 'cancelled');
    await openai.waitForClosedEarly(1);
    other.request.destroy();
    await until(async () => (await client.request('jobs.list', {})).jobs.every((j) => j.state === 'cancelled'));

    // 名额随请求结束归还：任务的终态先落盘（fsync）再算结束，列表看到 cancelled 时请求可能还没收尾，所以等名额回来。
    openai.handler = fakeOpenAiHandler();
    await until(async () => (await send(base, '/v1/chat/completions', { token: first.token, json: body })).status === 200);
  });

  it('停止服务不取消已经提交的任务', async () => {
    const { token } = await issue();
    await enableOnline();
    const model = await textModel(token);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    openai.handler = async (request) => {
      await gate;
      return chatCompletionReply(request, 'later');
    };
    const pending = send(base, '/v1/chat/completions', { token, json: { model, messages: [{ role: 'user', content: 'hi' }] } }).catch(
      () => null,
    );
    await openai.waitForRequests(1);
    const jobId = (await client.request('jobs.list', {})).jobs[0]!.jobId;
    await client.request('services.stop', { serviceId: 'model-api' });
    release();
    await pending;
    await until(async () => (await client.request('jobs.inspect', { jobId })).state === 'completed');
  });

  describe.skipIf(!localTranscribe)('本机转写', () => {
    async function transcribe(token: string, fields: Record<string, string | string[]>, data: Buffer = wav) {
      const { body, contentType } = multipart(fields, { name: 'speech.wav', type: 'audio/wav', data });
      return send(base, '/v1/audio/transcriptions', { token, body, contentType });
    }

    async function stagingLeft(): Promise<string[]> {
      return fs.readdir(path.join(home.stagingDir, 'model-api')).catch(() => []);
    }

    it('whisper-1 → 本机默认模型：json、text、srt、vtt 与 verbose_json；提交者与生成记录；staging 清掉', async () => {
      const { token, clientId } = await issue();
      const json = await transcribe(token, { model: 'whisper-1' });
      expect(json.status).toBe(200);
      expect(json.json).toMatchObject({ text: 'testing one two three baocut is ready', baocut: { providerId: 'local' } });
      const job = await client.request('jobs.inspect', { jobId: json.json.baocut.jobId });
      expect(job).toMatchObject({
        kind: 'transcribe',
        state: 'completed',
        videoId: null,
        providerId: 'local',
        bundleId: DEFAULT_TRANSCRIBE_BUNDLE,
        submitter: { kind: 'service', id: 'model-api', clientId },
      });
      expect(job.result).toMatchObject({ artifactId: expect.any(String) });

      const text = await transcribe(token, { model: 'whisper-1', response_format: 'text' });
      expect(text.headers['content-type']).toMatch(/^text\/plain/);
      expect(text.text).toBe('testing one two three baocut is ready\n');

      // 规范写法 `<providerId>/<modelId>`：取 /v1/models 里本机的那一项。
      const localId = (await modelIds(token)).find((id) => id.startsWith('local/'))!;
      const srtReply = await transcribe(token, { model: localId, response_format: 'srt' });
      expect(srtReply.status).toBe(200);
      expect(srtReply.text).toMatch(/^1\n\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}\ntesting one two\n\n2\n/);

      const vtt = await transcribe(token, { model: 'whisper-1', response_format: 'vtt' });
      expect(vtt.headers['content-type']).toMatch(/^text\/vtt/);
      expect(vtt.text).toMatch(/^WEBVTT\n\n\d{2}:\d{2}:\d{2}\.\d{3} --> /);

      const verbose = await transcribe(token, {
        model: 'whisper-1',
        response_format: 'verbose_json',
        'timestamp_granularities[]': ['word', 'segment'],
      });
      expect(verbose.json).toMatchObject({
        task: 'transcribe',
        text: 'testing one two three baocut is ready',
        duration: expect.any(Number),
      });
      expect(verbose.json.segments[0]).toMatchObject({ id: 0, text: 'testing one two', start: expect.any(Number) });
      expect(verbose.json.words[0]).toMatchObject({ word: 'testing' });
      const segmentsOnly = await transcribe(token, { model: 'whisper-1', response_format: 'verbose_json' });
      expect(segmentsOnly.json.words).toBeUndefined();

      expect((await transcribe(token, { model: 'whisper-1', response_format: 'xml' })).json.error.code).toBe('UNSUPPORTED_PARAMETER');
      const noFile = multipart({ model: 'whisper-1' }, null);
      expect((await send(base, '/v1/audio/transcriptions', { token, ...noFile })).json.error.code).toBe('INVALID_REQUEST');
      expect(await stagingLeft()).toEqual([]);
    });

    it('上传超过上限 → 413（声明的长度与分块传输两种）；staging 清掉；名额归还', async () => {
      const { token } = await issue();
      await client.request('services.configure', { serviceId: 'model-api', maxConcurrentPerClient: 1 });
      const big = Buffer.alloc(MAX_UPLOAD + 1024, 1);
      const declared = await transcribe(token, { model: 'whisper-1' }, big);
      expect(declared.status).toBe(413);
      expect(declared.json.error.code).toBe('PAYLOAD_TOO_LARGE');
      const { body, contentType } = multipart({ model: 'whisper-1' }, { name: 'big.wav', type: 'audio/wav', data: big });
      const chunked = await send(base, '/v1/audio/transcriptions', { token, body, contentType, chunked: true });
      expect(chunked.status).toBe(413);
      expect(await stagingLeft()).toEqual([]);
      expect((await transcribe(token, { model: 'whisper-1' })).status).toBe(200);
    });

    it('转写中调用方断开：Job 取消，上传删掉', async () => {
      const { token } = await issue();
      await fs.writeFile(control, JSON.stringify({ faults: ['slow'] }));
      const { body, contentType } = multipart({ model: 'whisper-1' }, { name: 'speech.wav', type: 'audio/wav', data: wav });
      const pending = open(base, '/v1/audio/transcriptions', { token, body, contentType });
      pending.reply.catch(() => {});
      const job = await until(async () => (await client.request('jobs.list', {})).jobs.find((j) => j.state === 'running'));
      expect(await stagingLeft()).toHaveLength(1);
      pending.request.destroy();
      await until(async () => (await client.request('jobs.inspect', { jobId: job.jobId })).state === 'cancelled');
      await until(async () => (await stagingLeft()).length === 0);
    });
  });
});
