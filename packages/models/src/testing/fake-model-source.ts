import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import path from 'node:path';
import type { BundleDefinition } from '../bundle-registry.ts';
import { MANIFEST_FILE } from '../model-catalog.ts';
import type { RepoManifestSpec } from '../repo-manifests.ts';

/**
 * 测试用的假模型来源：只监听本机回环地址的临时端口，按下载来源的路径规则
 * （`<基址>/<owner>/<repo>/resolve/<revision>/<文件路径>`）提供内存里的文件，支持 HEAD 与 `Range: bytes=n-`。
 * 可以按文件注入故障：返回某个状态码、发出若干字节后断开、发出若干字节后挂起、内容换成坏字节、不理 Range。
 * 测试永远不连真实的模型仓库，也不下载真实的模型。
 */

export interface FakeFault {
  /** 回复这个状态码（没有内容）。 */
  status?: number;
  /** 从这次回复的起点发出这么多字节后断开连接。 */
  breakAfter?: number;
  /** 发出这么多字节后不再发送，直到客户端断开。 */
  stallAfter?: number;
  /** 内容换成同样长度的坏字节。 */
  corrupt?: boolean;
  /** 不理 Range，总是回 200 与整份内容。 */
  ignoreRange?: boolean;
}

export interface FakeSourceRequest {
  method: string;
  /** 解码后的仓库内文件路径；不匹配路径规则时是请求路径。 */
  file: string;
  repo: string | null;
  revision: string | null;
  range: string | null;
  headers: http.IncomingHttpHeaders;
}

export interface FakeModelSource {
  /** `http://127.0.0.1:<port>`（加上 `prefix`）。 */
  endpoint: string;
  requests: FakeSourceRequest[];
  /** 放一个文件。 */
  put(repo: string, revision: string, file: string, content: Buffer | string): void;
  /** 给一个文件（任意仓库里同名的路径）排一个故障，用 `times` 次。 */
  fault(file: string, fault: FakeFault, times?: number): void;
  /** 每块的大小与块间的间隔（默认 64 KiB、不等）。 */
  throttle(chunkBytes: number, delayMs: number): void;
  /** 某个文件被 GET 的次数。 */
  gets(file: string): number;
  close(): Promise<void>;
}

export async function startFakeModelSource(options: { prefix?: string } = {}): Promise<FakeModelSource> {
  const prefix = options.prefix ?? '';
  const files = new Map<string, Buffer>();
  const faults = new Map<string, FakeFault[]>();
  let chunkBytes = 64 * 1024;
  let delayMs = 0;
  const sockets = new Set<Socket>();
  const requests: FakeSourceRequest[] = [];

  const server = http.createServer((req, res) => {
    void serve(req, res).catch(() => {
      res.destroy();
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  async function serve(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const parsed = parsePath(url.pathname, prefix);
    const range = typeof req.headers.range === 'string' ? req.headers.range : null;
    requests.push({
      method: req.method ?? 'GET',
      file: parsed?.file ?? url.pathname,
      repo: parsed?.repo ?? null,
      revision: parsed?.revision ?? null,
      range,
      headers: req.headers,
    });
    const content = parsed ? files.get(key(parsed.repo, parsed.revision, parsed.file)) : undefined;
    if (!parsed || !content) {
      res.writeHead(404);
      res.end();
      return;
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'content-length': String(content.length), 'x-linked-size': String(content.length), 'accept-ranges': 'bytes' });
      res.end();
      return;
    }
    const fault = faults.get(parsed.file)?.shift() ?? {};
    if (fault.status) {
      res.writeHead(fault.status);
      res.end();
      return;
    }
    const body = fault.corrupt ? Buffer.from(content.map((b) => b ^ 0xff)) : content;
    const match = range && !fault.ignoreRange ? /^bytes=(\d+)-$/.exec(range) : null;
    let start = 0;
    if (match) {
      start = Number(match[1]);
      if (start >= body.length) {
        res.writeHead(416, { 'content-range': `bytes */${body.length}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        'content-length': String(body.length - start),
        'content-range': `bytes ${start}-${body.length - 1}/${body.length}`,
        'accept-ranges': 'bytes',
      });
    } else {
      res.writeHead(200, { 'content-length': String(body.length), 'accept-ranges': 'bytes' });
    }
    const slice = body.subarray(start);
    let sent = 0;
    while (sent < slice.length) {
      if (fault.breakAfter !== undefined && sent >= fault.breakAfter) {
        // 让已经写出的字节先到达客户端，再断开。
        res.flushHeaders();
        await new Promise((resolve) => setTimeout(resolve, 20));
        req.socket.destroy();
        return;
      }
      if (fault.stallAfter !== undefined && sent >= fault.stallAfter) return;
      let end = Math.min(slice.length, sent + chunkBytes);
      if (fault.breakAfter !== undefined) end = Math.min(end, fault.breakAfter);
      if (fault.stallAfter !== undefined) end = Math.min(end, fault.stallAfter);
      const ok = res.write(slice.subarray(sent, end));
      sent = end;
      if (!ok) await new Promise<void>((resolve) => res.once('drain', resolve));
      if (res.destroyed) return;
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    res.end();
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${port}${prefix}`,
    requests,
    put(repo, revision, file, content) {
      files.set(key(repo, revision, file), Buffer.isBuffer(content) ? content : Buffer.from(content));
    },
    fault(file, fault, times = 1) {
      const queue = faults.get(file) ?? [];
      for (let i = 0; i < times; i++) queue.push({ ...fault });
      faults.set(file, queue);
    },
    throttle(bytes, ms) {
      chunkBytes = bytes;
      delayMs = ms;
    },
    gets(file) {
      return requests.filter((r) => r.method === 'GET' && r.file === file).length;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function key(repo: string, revision: string, file: string): string {
  return `${repo}@${revision}:${file}`;
}

function parsePath(pathname: string, prefix: string): { repo: string; revision: string; file: string } | null {
  if (!pathname.startsWith(`${prefix}/`)) return null;
  const segments = pathname
    .slice(prefix.length + 1)
    .split('/')
    .map((s) => decodeURIComponent(s));
  if (segments.length < 5 || segments[2] !== 'resolve') return null;
  return { repo: `${segments[0]}/${segments[1]}`, revision: segments[3]!, file: segments.slice(4).join('/') };
}

/** 一个合成的仓库：文件内容与据此算出的 sha256（测试内容的真实哈希，不是编造的）。 */
export interface SyntheticRepo {
  repo: string;
  revision: string;
  files: Record<string, Buffer>;
}

export function sha256Of(content: Buffer | string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/** 合成仓库的内置清单。`sizes: false` 时大小为 null（像真实清单那样要靠 HEAD 取）。 */
export function syntheticManifest(repo: SyntheticRepo, options: { sizes?: boolean; estimatedBytes?: number } = {}): RepoManifestSpec {
  const sizes = options.sizes ?? true;
  const files = Object.entries(repo.files).map(([path, content]) => ({
    path,
    size: sizes ? content.length : null,
    sha256: sha256Of(content),
  }));
  return {
    repo: repo.repo,
    revision: repo.revision,
    files,
    estimatedBytes: options.estimatedBytes ?? files.reduce((sum, f) => sum + (f.size ?? 0), 0),
    provenance: '测试合成',
  };
}

/** 把合成仓库放进假来源。 */
export function serveRepo(source: FakeModelSource, repo: SyntheticRepo): void {
  for (const [file, content] of Object.entries(repo.files)) source.put(repo.repo, repo.revision, file, content);
}

/** 确定的伪随机字节（测试用的「权重」）。 */
export function syntheticBytes(length: number, seed: number): Buffer {
  const out = Buffer.alloc(length);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

/** 两个共用 VAD 组件的合成模型包（引用计数测试用）。 */
export function sharedVadBundles(asrA: SyntheticRepo, asrB: SyntheticRepo, vad: SyntheticRepo): BundleDefinition[] {
  const vadSource = { family: 'silero-vad' as const, repo: vad.repo, revision: vad.revision };
  return [
    {
      bundleId: 'test-a@mlx',
      capability: 'transcribe',
      backend: 'mlx',
      device: 'metal',
      label: 'Test A',
      components: { asr: { family: 'qwen3-asr', repo: asrA.repo, revision: asrA.revision }, vad: vadSource },
    },
    {
      bundleId: 'test-b@mlx',
      capability: 'transcribe',
      backend: 'mlx',
      device: 'metal',
      label: 'Test B',
      components: { asr: { family: 'qwen3-asr', repo: asrB.repo, revision: asrB.revision }, vad: vadSource },
    },
  ];
}

/** 直接把合成仓库装进一个模型目录：文件加 `.bcut-manifest.json`（模型目录的移动与识别测试用）。 */
export async function writeSyntheticRepo(root: string, repo: SyntheticRepo): Promise<void> {
  const dir = path.join(root, ...repo.repo.split('/'));
  await fs.mkdir(dir, { recursive: true });
  for (const [file, content] of Object.entries(repo.files)) {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await fs.writeFile(path.join(dir, file), content);
  }
  const files = Object.entries(repo.files).map(([file, content]) => ({ path: file, size: content.length, sha256: sha256Of(content) }));
  await fs.writeFile(path.join(dir, MANIFEST_FILE), JSON.stringify({ format_version: 1, repo: repo.repo, revision: repo.revision, files }));
}
