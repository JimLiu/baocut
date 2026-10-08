import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mp3Fixture, pngFixture, wavFixture } from './media-fixtures.ts';

export * from './media-fixtures.ts';

/**
 * 测试用的假供应商：只监听本机回环地址的临时端口，记下收到的每个请求（含请求头，用来检查密钥只出现在该出现的地方），
 * 按脚本回复（正常结果、401、5xx、挂起、重定向……）。测试永远不连真实的云服务。
 */

export interface RecordedRequest {
  method: string;
  /** 路径（含查询串）。 */
  path: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  /** multipart 请求的文本字段（同名多值）。 */
  fields: Record<string, string[]>;
  /** multipart 请求里的文件。 */
  file: { name: string; type: string; size: number } | null;
  /** JSON 请求体。 */
  json: unknown;
}

export type FakeReply =
  | { status: number; json?: unknown; text?: string; bytes?: Buffer; headers?: Record<string, string> }
  /** 不回复，直到客户端断开。 */
  | 'hang';

export type FakeHandler = (request: RecordedRequest, server: FakeProviderServer) => FakeReply | Promise<FakeReply>;

export interface FakeProviderServer {
  /** `http://127.0.0.1:<port>`。 */
  origin: string;
  requests: RecordedRequest[];
  /** 没有回复完、客户端就断开的请求数（取消时连接应当关闭）。 */
  closedEarly: number;
  handler: FakeHandler;
  /** 等到收到第 n 个请求。 */
  waitForRequests(count: number, timeoutMs?: number): Promise<void>;
  /** 等到有 n 个请求被客户端提前断开。 */
  waitForClosedEarly(count: number, timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

export async function startFakeProviderServer(handler: FakeHandler): Promise<FakeProviderServer> {
  const waiters = new Set<() => void>();
  const notify = () => {
    for (const waiter of waiters) waiter();
  };
  const sockets = new Set<import('node:net').Socket>();
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    let replied = false;
    res.on('close', () => {
      if (!replied || !res.writableFinished) {
        state.closedEarly++;
        notify();
      }
    });
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      void (async () => {
        const recorded = await record(req, Buffer.concat(chunks));
        state.requests.push(recorded);
        notify();
        const reply = await state.handler(recorded, state);
        if (reply === 'hang') return;
        replied = true;
        const body = reply.json !== undefined ? JSON.stringify(reply.json) : (reply.bytes ?? reply.text ?? '');
        res.writeHead(reply.status, {
          ...(reply.json !== undefined ? { 'content-type': 'application/json' } : {}),
          ...reply.headers,
        });
        res.end(body);
      })().catch((error: unknown) => {
        replied = true;
        res.writeHead(500);
        res.end(String(error));
      });
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const until = (check: () => boolean, timeoutMs: number, what: string) =>
    new Promise<void>((resolve, reject) => {
      if (check()) return resolve();
      const timer = setTimeout(() => {
        waiters.delete(waiter);
        reject(new Error(`等待超时：${what}`));
      }, timeoutMs);
      const waiter = () => {
        if (!check()) return;
        clearTimeout(timer);
        waiters.delete(waiter);
        resolve();
      };
      waiters.add(waiter);
    });
  const state: FakeProviderServer = {
    origin: `http://127.0.0.1:${port}`,
    requests: [],
    closedEarly: 0,
    handler,
    waitForRequests: (count, timeoutMs = 10_000) => until(() => state.requests.length >= count, timeoutMs, `${count} 个请求`),
    waitForClosedEarly: (count, timeoutMs = 10_000) => until(() => state.closedEarly >= count, timeoutMs, `${count} 个断开的请求`),
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
  return state;
}

async function record(req: http.IncomingMessage, body: Buffer): Promise<RecordedRequest> {
  const contentType = String(req.headers['content-type'] ?? '');
  const recorded: RecordedRequest = {
    method: req.method ?? 'GET',
    path: req.url ?? '/',
    headers: req.headers,
    body,
    fields: {},
    file: null,
    json: undefined,
  };
  if (contentType.startsWith('multipart/form-data')) {
    const form = await new Response(new Uint8Array(body), { headers: { 'content-type': contentType } }).formData();
    for (const [name, value] of form.entries()) {
      if (typeof value === 'string') (recorded.fields[name] ??= []).push(value);
      else recorded.file = { name: value.name, type: value.type, size: value.size };
    }
  } else if (contentType.startsWith('application/json')) {
    try {
      recorded.json = JSON.parse(body.toString('utf8'));
    } catch {
      recorded.json = undefined;
    }
  }
  return recorded;
}

// ---- 各供应商的默认回复 ----

/** OpenAI `POST /audio/transcriptions` 的回复：`verbose_json` 时带段与词，`json` 时只有文本。 */
export function openAiTranscriptionReply(request: RecordedRequest, text = 'hello world'): FakeReply {
  const words = text.split(' ');
  if (request.fields.response_format?.[0] === 'verbose_json') {
    return {
      status: 200,
      json: {
        task: 'transcribe',
        language: 'english',
        duration: 1,
        text,
        segments: [{ id: 0, start: 0.1, end: 0.9, text: ` ${text}` }],
        words: words.map((word, i) => ({ word, start: 0.1 + i * 0.4, end: 0.1 + i * 0.4 + 0.3 })),
        usage: { type: 'duration', seconds: 1 },
      },
    };
  }
  return { status: 200, json: { text, usage: { type: 'tokens', input_tokens: 10, output_tokens: 3, total_tokens: 13 } } };
}

/** 按格式回一段能解码的音频（flac 没有现成的样本：回 WAV 的字节，只用在不解码的测试里）。 */
export function audioReply(format: string): FakeReply {
  if (format.startsWith('mp3')) return { status: 200, bytes: mp3Fixture(), headers: { 'content-type': 'audio/mpeg' } };
  if (format.startsWith('flac')) return { status: 200, bytes: wavFixture(), headers: { 'content-type': 'audio/flac' } };
  return { status: 200, bytes: wavFixture(), headers: { 'content-type': 'audio/wav' } };
}

/** OpenAI `POST /images/generations` 的回复：`n` 张内容各不相同的 PNG（第 i 张是 `pngFixture(16, 9, i)`）的 `b64_json`。 */
export function openAiImagesReply(request: RecordedRequest): FakeReply {
  const body = (request.json ?? {}) as { n?: number };
  const n = body.n ?? 1;
  return {
    status: 200,
    json: {
      created: 1_700_000_000,
      data: Array.from({ length: n }, (_, i) => ({ b64_json: pngFixture(16, 9, i).toString('base64') })),
      usage: { total_tokens: 100, input_tokens: 10, output_tokens: 90 },
    },
  };
}

export interface TextReplyOptions {
  /** OpenAI 的 `finish_reason`（默认 `stop`）或 Gemini 的 `finishReason`（默认 `STOP`）。 */
  finishReason?: string | null;
  /** 响应里的模型版本（默认 `<请求的模型>-2026-09-01`）。 */
  modelVersion?: string;
  inputTokens?: number;
  outputTokens?: number;
}

/** OpenAI（与兼容端点）`POST /chat/completions` 的回复。 */
export function chatCompletionReply(request: RecordedRequest, content: string, options: TextReplyOptions = {}): FakeReply {
  const model = String((request.json as { model?: unknown } | undefined)?.model ?? 'model');
  return {
    status: 200,
    json: {
      id: 'chatcmpl-1',
      object: 'chat.completion',
      model: options.modelVersion ?? `${model}-2026-09-01`,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content, refusal: null },
          finish_reason: options.finishReason === undefined ? 'stop' : options.finishReason,
        },
      ],
      usage: { prompt_tokens: options.inputTokens ?? 12, completion_tokens: options.outputTokens ?? 5, total_tokens: 17 },
    },
  };
}

/** Gemini `POST /models/<model>:generateContent` 的回复：一段思考摘要（应当被跳过）加上正文。 */
export function geminiTextReply(request: RecordedRequest, text: string, options: TextReplyOptions = {}): FakeReply {
  const model = /\/models\/([^/:]+):generateContent/.exec(request.path)?.[1] ?? 'model';
  return {
    status: 200,
    json: {
      candidates: [
        {
          content: { role: 'model', parts: [{ text: 'thinking about it', thought: true }, { text }] },
          finishReason: options.finishReason === undefined ? 'STOP' : options.finishReason,
          index: 0,
        },
      ],
      usageMetadata: {
        promptTokenCount: options.inputTokens ?? 12,
        candidatesTokenCount: options.outputTokens ?? 5,
        thoughtsTokenCount: 3,
      },
      modelVersion: options.modelVersion ?? `${decodeURIComponent(model)}-001`,
    },
  };
}

/** 假 OpenAI：`/models`、`/audio/transcriptions`、`/audio/speech`、`/images/generations` 与 `/chat/completions`。 */
export function fakeOpenAiHandler(text = 'hello world'): FakeHandler {
  return (request) => {
    if (request.method === 'GET' && request.path.endsWith('/models')) return { status: 200, json: { object: 'list', data: [] } };
    if (request.method === 'POST' && request.path.endsWith('/chat/completions')) return chatCompletionReply(request, text);
    if (request.method === 'POST' && request.path.endsWith('/audio/transcriptions')) return openAiTranscriptionReply(request, text);
    if (request.method === 'POST' && request.path.endsWith('/audio/speech')) {
      return audioReply(String((request.json as { response_format?: string } | undefined)?.response_format ?? 'mp3'));
    }
    if (request.method === 'POST' && request.path.endsWith('/images/generations')) return openAiImagesReply(request);
    return { status: 404, json: { error: { message: 'not found' } } };
  };
}

/** 假 ElevenLabs：`GET /models`、`GET /voices` 与 `POST /text-to-speech/<voice_id>?output_format=…`。 */
export function fakeElevenLabsHandler(): FakeHandler {
  return (request) => {
    const url = new URL(request.path, 'http://fake');
    if (request.method === 'GET' && url.pathname.endsWith('/models')) return { status: 200, json: [] };
    if (request.method === 'GET' && url.pathname.endsWith('/voices')) return { status: 200, json: { voices: [] } };
    if (request.method === 'POST' && /\/text-to-speech\/[^/]+$/.test(url.pathname)) {
      return audioReply(url.searchParams.get('output_format') ?? 'mp3_44100_128');
    }
    return { status: 404, json: { detail: { status: 'not_found', message: 'not found' } } };
  };
}

/** Gemini 生图的回复：一个带中间图的 `thought` step，加上带最终图片的 `model_output` step。 */
export function googleImageReply(request: RecordedRequest, image: Buffer = pngFixture()): FakeReply {
  const format = (request.json as { response_format?: { mime_type?: string } } | undefined)?.response_format;
  const mimeType = format?.mime_type ?? 'image/png';
  return {
    status: 200,
    json: {
      id: 'interaction-image',
      status: 'completed',
      steps: [
        { type: 'thought', content: [{ type: 'image', data: Buffer.from('draft').toString('base64'), mime_type: mimeType }] },
        {
          type: 'model_output',
          content: [
            { type: 'text', text: 'Here is your image.' },
            { type: 'image', data: image.toString('base64'), mime_type: mimeType },
          ],
        },
      ],
      usage: { total_input_tokens: 12, total_output_tokens: 1120 },
    },
  };
}

/** 假 Gemini：Interactions（转写模型回词级标注，通用模型回结构化的段；生图），与文本的 `generateContent`。 */
export function fakeGoogleHandler(text = 'hello world'): FakeHandler {
  return (request) => {
    if (request.method === 'GET' && new URL(request.path, 'http://fake').pathname.endsWith('/models')) {
      return { status: 200, json: { models: [] } };
    }
    if (request.method === 'POST' && request.path.endsWith(':generateContent')) return geminiTextReply(request, text);
    if (request.method !== 'POST' || !request.path.endsWith('/interactions'))
      return { status: 404, json: { error: { message: 'not found' } } };
    const body = request.json as { model?: string; response_format?: { type?: string } } | undefined;
    if (body?.response_format?.type === 'image') return googleImageReply(request);
    const words = text.split(' ');
    if (body?.model === 'gemini-3.5-transcribe') {
      return {
        status: 200,
        json: {
          id: 'interaction-1',
          status: 'completed',
          output_text: text,
          steps: [
            {
              type: 'model_output',
              content: [
                {
                  type: 'text',
                  text,
                  annotations: words.map((word, i) => ({
                    type: 'word_info',
                    text: word,
                    start_offset: `${(0.1 + i * 0.4).toFixed(3)}s`,
                    end_offset: `${(0.4 + i * 0.4).toFixed(3)}s`,
                  })),
                },
              ],
            },
          ],
          usage: { total_input_tokens: 32, total_output_tokens: 4 },
        },
      };
    }
    return {
      status: 200,
      json: {
        id: 'interaction-2',
        status: 'completed',
        output_text: JSON.stringify({ language: 'en', segments: [{ start: 0.1, end: 0.9, text }] }),
        usage: { total_input_tokens: 40, total_output_tokens: 20 },
      },
    };
  };
}
