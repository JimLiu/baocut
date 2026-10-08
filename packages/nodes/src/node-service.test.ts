import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { JobVideos } from '@baocut/jobs';
import { RpcError, type EditOperation, type NodeErrorBody, type NodeHealth, type NodeJob, type NodeJobRequest } from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { shareAddresses } from './node-service.ts';
import {
  ManualClock,
  TEST_NODE_MISSING_BUNDLE,
  nodeFetch,
  pairingCodeOf,
  readEvents,
  startTestNode,
  submitTestJob,
  testJobRequest,
  type TestNode,
  type TestNodeOptions,
} from './testing/test-node.ts';

/**
 * 节点服务端到端：真实的 HTTP（只听 127.0.0.1、系统分配端口）→ NodeJobs → JobManager → 假的 Model Worker。
 */

/** 假 Model Worker 的默认转写（按 3 个词一段）：这些文字不能出现在事件、台账与日志里。 */
const TRANSCRIPT_PHRASES = ['testing one two', 'three baocut is'];
const MEDIA = Buffer.from('RIFF fake audio bytes for the node protocol tests');

async function until<T>(read: () => T | undefined | null | false | Promise<T | undefined | null | false>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const exists = (file: string) =>
  fs.stat(file).then(
    () => true,
    () => false,
  );

async function errorOf(response: Response): Promise<NodeErrorBody['error']> {
  return ((await response.json()) as NodeErrorBody).error;
}

/** 不经 fetch 的原始 HTTP 请求：自己控制 Content-Length 与 Transfer-Encoding。 */
function rawRequest(
  baseUrl: string,
  options: { method: string; path: string; headers: Record<string, string>; chunks?: Buffer[] },
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: url.hostname, port: url.port, method: options.method, path: options.path, headers: options.headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString(), headers: response.headers }),
        );
      },
    );
    request.on('error', reject);
    for (const chunk of options.chunks ?? []) request.write(chunk);
    request.end();
  });
}

describe('节点服务（HTTP + 假 Model Worker）', () => {
  let node: TestNode;
  let token: string;

  afterEach(async () => {
    await node?.close();
  });

  async function start(options: TestNodeOptions = {}) {
    node = await startTestNode(options);
    token = await node.pair();
  }

  const api = (pathname: string, init?: RequestInit, as: string | null = token) => nodeFetch(node.baseUrl, as, pathname, init);
  const create = (request: NodeJobRequest, as: string | null = token) =>
    api('/v1/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }, as);
  const upload = (jobId: string, body: Buffer, as: string | null = token) =>
    api(
      `/v1/jobs/${jobId}/input`,
      { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(body) },
      as,
    );
  const getJob = async (jobId: string) => (await (await api(`/v1/jobs/${jobId}`)).json()) as NodeJob;
  const jobDir = (jobId: string) => path.join(node.home.nodeJobsDir, jobId);

  it('健康检查：不要令牌与版本头，给出能力与模型包状态', async () => {
    await start();
    const response = await fetch(`${node.baseUrl}/v1/health`);
    expect(response.status).toBe(200);
    const health = await response.json();
    expect(health).toMatchObject({
      schema: 'baocut.node-health/v1',
      nodeId: expect.stringMatching(/^node_/),
      name: 'test-node',
      nodeProtocolVersion: 1,
      minNodeProtocolVersion: 1,
      capabilities: { transcribe: { enabled: true, running: 0, queued: 0 } },
    });
    expect(health.capabilities.transcribe.bundles).toContainEqual({
      bundleId: 'fake@cpu',
      backend: 'candle',
      device: 'cpu',
      state: 'installed',
    });
    expect(health.capabilities.transcribe.bundles).toContainEqual(
      expect.objectContaining({ bundleId: TEST_NODE_MISSING_BUNDLE, state: 'not-installed' }),
    );
    expect(node.advertiser.active).toMatchObject({ name: 'test-node', port: node.service.port, version: 1 });
  });

  it('完整流程：创建 → 上传 → 事件流 → 结果（ETag、Range）→ 删除；不发布产物、不碰视频、不泄露转写', async () => {
    await start();
    const request = testJobRequest(MEDIA, { options: { language: { mode: 'prefer', tag: null }, diarize: true, timescale: 1_000_000 } });
    const created = await create(request);
    expect(created.status).toBe(201);
    const job = (await created.json()) as NodeJob;
    expect(job).toMatchObject({
      clientJobId: request.clientJobId,
      state: 'awaiting-input',
      phase: 'awaiting-input',
      attempt: 1,
      output: null,
    });
    expect(job.jobId).toMatch(/^job_/);

    // 先订阅再上传：流一直开着，直到终态那条之后由节点关闭。
    const stream = api(`/v1/jobs/${job.jobId}/events`);
    const uploaded = await upload(job.jobId, MEDIA);
    expect(uploaded.status).toBe(204);
    const response = await stream;
    expect(response.headers.get('content-type')).toBe('application/x-ndjson');
    const events = await readEvents(response);

    const seqs = events.map((e) => (e as { seq: number }).seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    const jobEvents = events.filter((e) => e.type === 'job');
    const states = jobEvents.map((e) => e.job.state);
    expect(states[0]).toBe('awaiting-input');
    expect(states).toContain('queued');
    expect(states).toContain('running');
    expect(states.at(-1)).toBe('completed');
    expect(states).not.toContain('interrupted');
    expect(events.at(-1)).toMatchObject({ type: 'job', job: { state: 'completed' } });
    expect(events).toContainEqual(expect.objectContaining({ type: 'language', tag: 'en', confidence: 0.87 }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'warning', warning: { code: 'diarization-unavailable' } }));
    // 嵌在 job 事件里的 lastSeq 就是这条事件的 seq。
    for (const e of jobEvents) expect(e.job.lastSeq).toBe(e.seq);
    const serialized = JSON.stringify(events);
    for (const phrase of TRANSCRIPT_PHRASES) expect(serialized).not.toContain(phrase);

    // since：只给之后的事件；任务已终结，写完就关。
    const middle = seqs[Math.floor(seqs.length / 2)]!;
    const resumed = await readEvents(await api(`/v1/jobs/${job.jobId}/events?since=${middle}`));
    expect(resumed.map((e) => (e as { seq: number }).seq)).toEqual(seqs.filter((s) => s > middle));
    expect(await readEvents(await api(`/v1/jobs/${job.jobId}/events?since=${seqs.at(-1)}`))).toEqual([]);

    const done = await getJob(job.jobId);
    expect(done).toMatchObject({ state: 'completed', phase: 'done', error: null, lastSeq: seqs.at(-1) });
    expect(done.output).toEqual({ sha256: expect.stringMatching(/^[0-9a-f]{64}$/), byteLength: expect.any(Number) });

    // 结果：整份。
    const full = await api(`/v1/jobs/${job.jobId}/result`);
    expect(full.status).toBe(200);
    expect(full.headers.get('etag')).toBe(`"sha256:${done.output!.sha256}"`);
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    const bytes = Buffer.from(await full.arrayBuffer());
    expect(bytes.length).toBe(done.output!.byteLength);
    expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(done.output!.sha256);
    const result = JSON.parse(bytes.toString()) as { schema: string; segments: Array<{ text: string }> };
    expect(result.schema).toBe('baocut.asr-result/v1');
    expect(result.segments.map((s) => s.text)).toEqual(expect.arrayContaining(TRANSCRIPT_PHRASES));

    // 结果：续传。
    const partial = await api(`/v1/jobs/${job.jobId}/result`, { headers: { range: 'bytes=10-' } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe(`bytes 10-${bytes.length - 1}/${bytes.length}`);
    expect(Buffer.from(await partial.arrayBuffer())).toEqual(bytes.subarray(10));
    const head = await api(`/v1/jobs/${job.jobId}/result`, { headers: { range: 'bytes=0-9' } });
    expect(head.status).toBe(206);
    expect(Buffer.from(await head.arrayBuffer())).toEqual(bytes.subarray(0, 10));
    const beyond = await api(`/v1/jobs/${job.jobId}/result`, { headers: { range: `bytes=${bytes.length}-` } });
    expect(beyond.status).toBe(416);
    expect(beyond.headers.get('content-range')).toBe(`bytes */${bytes.length}`);
    await beyond.arrayBuffer();

    // 节点上：媒体已删，结果留着；JobManager 的记录是远端提交、没有视频、没有产物。
    expect(await exists(path.join(jobDir(job.jobId), 'input'))).toBe(false);
    expect(await exists(path.join(jobDir(job.jobId), 'result.json'))).toBe(true);
    const record = node.manager.inspect(job.jobId);
    expect(record).toMatchObject({
      jobId: job.jobId,
      state: 'completed',
      submitter: { kind: 'node', id: 'client-a' },
      videoId: null,
      assetId: null,
      assetRevision: null,
      result: null,
      contentHash: request.input.contentHash,
    });
    expect(node.manager.list()).toEqual([
      expect.objectContaining({ jobId: job.jobId, submitter: { kind: 'node', id: 'client-a' }, videoId: null }),
    ]);
    expect(await fs.readdir(node.home.artifactsDir).catch(() => [])).toEqual([]);
    expect(await exists(path.join(node.home.stagingDir, 'jobs', job.jobId))).toBe(false);
    const ledger = await fs.readFile(node.home.jobsFile, 'utf8');
    expect(ledger).toContain(job.jobId);
    for (const phrase of TRANSCRIPT_PHRASES) expect(ledger).not.toContain(phrase);
    const share = await fs.readFile(node.home.nodeShareFile, 'utf8');
    expect(share).not.toContain(token.split('.')[1]);

    // 删除：之后一律 404，任务目录没了。
    const deleted = await api(`/v1/jobs/${job.jobId}`, { method: 'DELETE' });
    expect(deleted.status).toBe(204);
    for (const suffix of ['', '/events', '/result']) {
      const gone = await api(`/v1/jobs/${job.jobId}${suffix}`);
      expect(gone.status).toBe(404);
      expect(await errorOf(gone)).toMatchObject({ code: 'JOB_NOT_FOUND' });
    }
    expect((await api(`/v1/jobs/${job.jobId}`, { method: 'DELETE' })).status).toBe(404);
    expect(await exists(jobDir(job.jobId))).toBe(false);
  });

  it('幂等创建：相同 clientJobId 与内容返回同一个任务，内容不同 409', async () => {
    await start();
    const request = testJobRequest(MEDIA);
    const first = await create(request);
    expect(first.status).toBe(201);
    const job = (await first.json()) as NodeJob;
    // 键的顺序不同也算同一份请求。
    const reordered = {
      options: request.options,
      input: request.input,
      bundleId: request.bundleId,
      kind: request.kind,
      clientJobId: request.clientJobId,
    };
    const again = await api('/v1/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(reordered),
    });
    expect(again.status).toBe(200);
    expect(((await again.json()) as NodeJob).jobId).toBe(job.jobId);

    const conflict = await create({ ...request, options: { ...request.options, diarize: true } });
    expect(conflict.status).toBe(409);
    expect(await errorOf(conflict)).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    // 别的客户端用同一个 clientJobId 是另一个任务。
    const other = await node.pair('client-b', 'B');
    const separate = await create(request, other);
    expect(separate.status).toBe(201);
    expect(((await separate.json()) as NodeJob).jobId).not.toBe(job.jobId);
  });

  it('请求不合规：400，带出问题所在', async () => {
    await start();
    const bad = await create({ ...testJobRequest(MEDIA), input: { ...testJobRequest(MEDIA).input, contentHash: 'md5:abc' } });
    expect(bad.status).toBe(400);
    expect(await errorOf(bad)).toMatchObject({
      code: 'INVALID_REQUEST',
      details: { issues: [expect.objectContaining({ path: 'input.contentHash' })] },
    });
    const notJson = await api('/v1/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
    expect(notJson.status).toBe(400);
    const extra = await create({
      ...testJobRequest(MEDIA),
      options: { ...testJobRequest(MEDIA).options, temperature: 1 },
    } as NodeJobRequest);
    expect(extra.status).toBe(400);
  });

  it('摘要不符：422，任务失败，媒体立即删除', async () => {
    await start();
    const request = testJobRequest(MEDIA);
    const job = (await (await create(request)).json()) as NodeJob;
    const tampered = Buffer.from(MEDIA);
    tampered[0] = tampered[0]! ^ 0xff;
    const response = await upload(job.jobId, tampered);
    expect(response.status).toBe(422);
    expect(await errorOf(response)).toMatchObject({ code: 'INPUT_HASH_MISMATCH' });
    expect(await getJob(job.jobId)).toMatchObject({ state: 'failed', error: { code: 'INPUT_HASH_MISMATCH' } });
    expect(await exists(path.join(jobDir(job.jobId), 'input'))).toBe(false);
    expect(await exists(path.join(jobDir(job.jobId), 'input.part'))).toBe(false);
    // 终结的任务：事件流写完就关。
    const events = await readEvents(await api(`/v1/jobs/${job.jobId}/events`));
    expect(events.at(-1)).toMatchObject({ type: 'job', job: { state: 'failed' } });
    expect(node.manager.list()).toEqual([]);
  });

  it('长度与声明不符：422 且任务失败；没有 Content-Length（分块上传）：400，任务仍等上传', async () => {
    await start();
    const job = (await (await create(testJobRequest(MEDIA))).json()) as NodeJob;
    const chunked = await rawRequest(node.baseUrl, {
      method: 'PUT',
      path: `/v1/jobs/${job.jobId}/input`,
      headers: { 'X-BaoCut-Node-Protocol': '1', authorization: `Bearer ${token}`, 'transfer-encoding': 'chunked' },
      chunks: [MEDIA],
    });
    expect(chunked.status).toBe(400);
    expect(JSON.parse(chunked.body).error.code).toBe('INVALID_REQUEST');
    expect(await getJob(job.jobId)).toMatchObject({ state: 'awaiting-input' });

    const short = await upload(job.jobId, MEDIA.subarray(0, 10));
    expect(short.status).toBe(422);
    expect(await errorOf(short)).toMatchObject({
      code: 'INPUT_HASH_MISMATCH',
      details: { expectedBytes: MEDIA.length, receivedBytes: 10 },
    });
    expect(await getJob(job.jobId)).toMatchObject({ state: 'failed', error: { code: 'INPUT_HASH_MISMATCH' } });
  });

  it('不在等待上传的任务不收媒体：409', async () => {
    await start();
    const { job } = await submitTestJob(node.baseUrl, token, MEDIA);
    const again = await upload(job.jobId, MEDIA);
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toMatchObject({ code: 'INVALID_STATE' });
    await readEvents(await api(`/v1/jobs/${job.jobId}/events`));
    expect(await getJob(job.jobId)).toMatchObject({ state: 'completed' });
  });

  it('创建后没有按时上传：任务以 INPUT_EXPIRED 失败，事件流结束，目录删除', async () => {
    await start({ limits: { inputExpiryMs: 150 } });
    const job = (await (await create(testJobRequest(MEDIA))).json()) as NodeJob;
    const events = await readEvents(await api(`/v1/jobs/${job.jobId}/events`));
    expect(events.at(-1)).toMatchObject({ type: 'job', job: { state: 'failed', error: { code: 'INPUT_EXPIRED' } } });
    await until(async () => !(await exists(jobDir(job.jobId))));
    expect((await upload(job.jobId, MEDIA)).status).toBe(409);
  });

  it('队列满：每个客户端有上限，别的客户端不受影响；终结的不算', async () => {
    await start({ limits: { maxActivePerClient: 2 } });
    const a = (await (await create(testJobRequest(MEDIA))).json()) as NodeJob;
    await create(testJobRequest(MEDIA));
    const full = await create(testJobRequest(MEDIA));
    expect(full.status).toBe(429);
    expect(await errorOf(full)).toMatchObject({ code: 'QUEUE_FULL', details: { limit: 2 } });
    const other = await node.pair('client-b', 'B');
    expect((await create(testJobRequest(MEDIA), other)).status).toBe(201);

    await api(`/v1/jobs/${a.jobId}/cancel`, { method: 'POST' });
    expect((await create(testJobRequest(MEDIA))).status).toBe(201);
  });

  it('媒体太大 413；磁盘不够 507', async () => {
    let free = 10 * 1024 ** 3;
    await start({ limits: { maxInputBytes: MEDIA.length - 1, diskReserveBytes: 1024 }, freeBytes: async () => free });
    const big = await create(testJobRequest(MEDIA));
    expect(big.status).toBe(413);
    expect(await errorOf(big)).toMatchObject({ code: 'INPUT_TOO_LARGE', details: { maxBytes: MEDIA.length - 1 } });

    await node.close();
    await start({ limits: { diskReserveBytes: 1024 }, freeBytes: async () => free });
    free = MEDIA.length + 1023;
    const low = await create(testJobRequest(MEDIA));
    expect(low.status).toBe(507);
    expect(await errorOf(low)).toMatchObject({ code: 'DISK_LOW' });
    free = MEDIA.length + 1024;
    expect((await create(testJobRequest(MEDIA))).status).toBe(201);
  });

  it('能力关闭：403 CAPABILITY_DISABLED；健康检查照实报告', async () => {
    await start({ capabilities: { transcribe: false } });
    const response = await create(testJobRequest(MEDIA));
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toMatchObject({ code: 'CAPABILITY_DISABLED' });
    const health = await (await fetch(`${node.baseUrl}/v1/health`)).json();
    expect(health.capabilities.transcribe.enabled).toBe(false);
  });

  it('模型包不可用：409 MODEL_NOT_READY，带出状态', async () => {
    await start();
    const missing = await create(testJobRequest(MEDIA, { bundleId: TEST_NODE_MISSING_BUNDLE }));
    expect(missing.status).toBe(409);
    expect(await errorOf(missing)).toMatchObject({
      code: 'MODEL_NOT_READY',
      details: { bundleId: TEST_NODE_MISSING_BUNDLE, state: 'not-installed' },
    });
    const unknown = await create(testJobRequest(MEDIA, { bundleId: 'nope@cpu' }));
    expect(unknown.status).toBe(409);
    expect(await errorOf(unknown)).toMatchObject({ code: 'MODEL_NOT_READY', details: { state: 'unknown' } });
  });

  it('别的客户端的任务一律 404', async () => {
    await start();
    const { job } = await submitTestJob(node.baseUrl, token, MEDIA);
    const other = await node.pair('client-b', 'B');
    const requests: Array<[string, RequestInit]> = [
      [`/v1/jobs/${job.jobId}`, {}],
      [`/v1/jobs/${job.jobId}/events`, {}],
      [`/v1/jobs/${job.jobId}/result`, {}],
      [`/v1/jobs/${job.jobId}/cancel`, { method: 'POST' }],
      [`/v1/jobs/${job.jobId}`, { method: 'DELETE' }],
      [`/v1/jobs/${job.jobId}/input`, { method: 'PUT', body: new Uint8Array(MEDIA) }],
    ];
    for (const [pathname, init] of requests) {
      const response = await api(pathname, init, other);
      expect(response.status, `${init.method ?? 'GET'} ${pathname}`).toBe(404);
      expect(await errorOf(response)).toMatchObject({ code: 'JOB_NOT_FOUND' });
    }
    await readEvents(await api(`/v1/jobs/${job.jobId}/events`));
    expect(await getJob(job.jobId)).toMatchObject({ state: 'completed' });
  });

  it('取消运行中的任务：等到终结，重复取消幂等；结果 409，目录删除', async () => {
    await start();
    const { job } = await submitTestJob(node.baseUrl, token, MEDIA, { bundleId: 'fake@cpu#slow' });
    await until(async () => (await getJob(job.jobId)).state === 'running');
    const stream = api(`/v1/jobs/${job.jobId}/events`);
    const cancelled = await api(`/v1/jobs/${job.jobId}/cancel`, { method: 'POST' });
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({ jobId: job.jobId, state: 'cancelled' });
    const events = await readEvents(await stream);
    expect(events.at(-1)).toMatchObject({ type: 'job', job: { state: 'cancelled' } });
    const again = await api(`/v1/jobs/${job.jobId}/cancel`, { method: 'POST' });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ state: 'cancelled' });
    const result = await api(`/v1/jobs/${job.jobId}/result`);
    expect(result.status).toBe(409);
    expect(await errorOf(result)).toMatchObject({ code: 'INVALID_STATE', details: { state: 'cancelled' } });
    expect(node.manager.inspect(job.jobId)).toMatchObject({ state: 'cancelled' });
    expect(await exists(jobDir(job.jobId))).toBe(false);
    expect(node.service.status().jobs).toEqual({ running: 0, queued: 0 });
  });

  it('取消等上传的任务；删除运行中的任务先取消再删', async () => {
    await start();
    const waiting = (await (await create(testJobRequest(MEDIA))).json()) as NodeJob;
    expect(await (await api(`/v1/jobs/${waiting.jobId}/cancel`, { method: 'POST' })).json()).toMatchObject({ state: 'cancelled' });
    expect((await upload(waiting.jobId, MEDIA)).status).toBe(409);

    const { job } = await submitTestJob(node.baseUrl, token, MEDIA, { bundleId: 'fake@cpu#slow' });
    await until(async () => (await getJob(job.jobId)).state === 'running');
    expect((await api(`/v1/jobs/${job.jobId}`, { method: 'DELETE' })).status).toBe(204);
    expect((await api(`/v1/jobs/${job.jobId}`)).status).toBe(404);
    await until(() => node.manager.inspect(job.jobId).state === 'cancelled');
    expect(await exists(jobDir(job.jobId))).toBe(false);
  });

  it('结果保留期满：结果 410，任务本身 404', async () => {
    await start({ limits: { resultRetentionMs: 200 } });
    const { job } = await submitTestJob(node.baseUrl, token, MEDIA);
    await readEvents(await api(`/v1/jobs/${job.jobId}/events`));
    expect((await api(`/v1/jobs/${job.jobId}/result`)).status).toBe(200);
    await until(async () => !(await exists(jobDir(job.jobId))));
    const expired = await api(`/v1/jobs/${job.jobId}/result`);
    expect(expired.status).toBe(410);
    expect(await errorOf(expired)).toMatchObject({ code: 'RESULT_EXPIRED' });
    expect((await api(`/v1/jobs/${job.jobId}`)).status).toBe(404);
  });

  it('Worker 崩溃一次：节点自动重试并完成，事件里看得到第 2 次尝试，不出现 interrupted', async () => {
    await start();
    const { job } = await submitTestJob(node.baseUrl, token, MEDIA, { bundleId: 'fake@cpu#crash-once' });
    const events = await readEvents(await api(`/v1/jobs/${job.jobId}/events`));
    const jobEvents = events.filter((e) => e.type === 'job');
    expect(jobEvents.at(-1)).toMatchObject({ job: { state: 'completed', attempt: 2 } });
    // 第 2 次尝试在终态之前就出现在事件里（发起端能显示「重试中」）。
    expect(jobEvents.slice(0, -1).some((e) => e.job.attempt === 2 && e.job.state === 'running')).toBe(true);
    expect(jobEvents.filter((e) => e.job.attempt === 1).map((e) => e.job.state)).not.toContain('failed');
    expect(jobEvents.map((e) => e.job.state)).not.toContain('interrupted');
    expect(node.manager.inspect(job.jobId)).toMatchObject({ state: 'completed', attempt: 2 });
  });

  it('模型输出不合规：任务失败，诊断里不留结果文件', async () => {
    await start();
    const { job } = await submitTestJob(node.baseUrl, token, MEDIA, { bundleId: 'fake@cpu#invalid-output' });
    const events = await readEvents(await api(`/v1/jobs/${job.jobId}/events`));
    expect(events.at(-1)).toMatchObject({ type: 'job', job: { state: 'failed', error: { code: 'MODEL_OUTPUT_INVALID' } } });
    const error = (events.at(-1) as { job: NodeJob }).job.error as { details?: Record<string, unknown> };
    expect(error.details ?? {}).not.toHaveProperty('stderrTail');
    const diagnostics = path.join(node.home.logsDir, 'diagnostics');
    const files = await fs.readdir(diagnostics, { recursive: true }).catch(() => [] as string[]);
    expect(files.filter((f) => String(f).endsWith('result.json'))).toEqual([]);
  });

  it('没有语音：任务完成，结果照常可取', async () => {
    await start();
    const { job } = await submitTestJob(node.baseUrl, token, MEDIA, { bundleId: 'fake@cpu#no-speech' });
    await readEvents(await api(`/v1/jobs/${job.jobId}/events`));
    const result = await api(`/v1/jobs/${job.jobId}/result`);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ outcome: 'no-speech', segments: [] });
  });

  it('事件流的心跳', async () => {
    await start({ heartbeatMs: 50 });
    const job = (await (await create(testJobRequest(MEDIA))).json()) as NodeJob;
    const response = await api(`/v1/jobs/${job.jobId}/events`);
    const reader = response.body!.getReader();
    let text = '';
    while (!text.includes('"heartbeat"')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += Buffer.from(value).toString();
    }
    expect(text).toContain('{"type":"heartbeat"}');
    await reader.cancel();
  });
});

describe('配对与吊销（HTTP）', () => {
  let node: TestNode;

  afterEach(async () => {
    await node?.close();
  });

  const pairWith = (code: string, clientId = 'client-a') =>
    nodeFetch(node.baseUrl, null, '/v1/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, clientId, clientName: 'Client' }),
    });

  it('配对成功拿到令牌，配对码用掉；错误的码 403', async () => {
    node = await startTestNode();
    const code = pairingCodeOf(node.service.status())!;
    expect(code).toMatch(/^\d{6}$/);
    const wrong = await pairWith(code === '000000' ? '111111' : '000000');
    expect(wrong.status).toBe(403);
    expect(await errorOf(wrong)).toMatchObject({ code: 'PAIRING_CODE_INVALID' });

    const ok = await pairWith(code);
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { nodeId: string; name: string; token: string };
    expect(body).toMatchObject({ nodeId: node.service.status().nodeId, name: 'test-node', token: expect.stringMatching(/^client-a\./) });
    expect(node.service.status().pairing).toBeNull();
    expect(node.service.status().clients).toEqual([expect.objectContaining({ clientId: 'client-a', name: 'Client' })]);
    expect((await pairWith(code, 'client-b')).status).toBe(403);
    expect((await nodeFetch(node.baseUrl, body.token, '/v1/jobs/job_x')).status).toBe(404);
  });

  it('输错 5 次锁定：429 带 Retry-After，正确的码也不行；期满后要新的配对码', async () => {
    const clock = new ManualClock();
    node = await startTestNode({ clock });
    const code = pairingCodeOf(node.service.status())!;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect((await pairWith(wrong)).status).toBe(403);
    const locked = await pairWith(code);
    expect(locked.status).toBe(429);
    expect(locked.headers.get('retry-after')).toBe('600');
    expect(await errorOf(locked)).toMatchObject({ code: 'PAIRING_LOCKED', details: { retryAfterMs: 600_000 } });
    expect(node.service.status().pairing).toEqual({ lockedUntil: new Date(clock.now() + 600_000).toISOString() });

    clock.advance(600_000);
    expect(node.service.status().pairing).toBeNull();
    expect((await pairWith(code)).status).toBe(403);
    const fresh = pairingCodeOf(node.service.pairingCode())!;
    expect((await pairWith(fresh)).status).toBe(200);
  });

  it('配对码 10 分钟过期', async () => {
    const clock = new ManualClock();
    node = await startTestNode({ clock });
    const code = pairingCodeOf(node.service.status())!;
    clock.advance(600_000);
    expect((await pairWith(code)).status).toBe(403);
  });

  it('重新配对换掉旧令牌，之前的任务还在；吊销让令牌失效并删除这个客户端的任务', async () => {
    node = await startTestNode();
    const first = await node.pair('client-a');
    const media = Buffer.from('media for revoke');
    const { job: running } = await submitTestJob(node.baseUrl, first, media, { bundleId: 'fake@cpu#slow' });
    const waiting = (await (
      await nodeFetch(node.baseUrl, first, '/v1/jobs', { method: 'POST', body: JSON.stringify(testJobRequest(media)) })
    ).json()) as NodeJob;
    const other = await node.pair('client-b');
    const { job: kept } = await submitTestJob(node.baseUrl, other, media);

    const second = await node.pair('client-a');
    expect((await nodeFetch(node.baseUrl, first, `/v1/jobs/${running.jobId}`)).status).toBe(401);
    expect((await nodeFetch(node.baseUrl, second, `/v1/jobs/${running.jobId}`)).status).toBe(200);

    await until(async () => node.manager.inspect(running.jobId).state === 'running');
    const status = await node.service.revoke('client-a');
    expect(status.clients.map((c) => c.clientId)).toEqual(['client-b']);
    const denied = await nodeFetch(node.baseUrl, second, `/v1/jobs/${running.jobId}`);
    expect(denied.status).toBe(401);
    expect(await errorOf(denied)).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(node.manager.inspect(running.jobId).state).toBe('cancelled');
    expect(await exists(path.join(node.home.nodeJobsDir, running.jobId))).toBe(false);
    expect(await exists(path.join(node.home.nodeJobsDir, waiting.jobId))).toBe(false);
    // 别的客户端不受影响。
    expect((await nodeFetch(node.baseUrl, other, `/v1/jobs/${kept.jobId}`)).status).toBe(200);
    const persisted = JSON.parse(await fs.readFile(node.home.nodeShareFile, 'utf8')) as { clients: Array<{ clientId: string }> };
    expect(persisted.clients.map((c) => c.clientId)).toEqual(['client-b']);
    await expect(node.service.revoke('client-a')).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('共享开关（NodeService）', () => {
  let node: TestNode;

  afterEach(async () => {
    await node?.close();
  });

  it('开启前不监听；开启后监听、登记并给出配对码；关闭后停止监听、撤下登记、删除远端任务', async () => {
    node = await startTestNode({ share: null });
    expect(node.service.status()).toMatchObject({ enabled: false, listening: false, error: null, pairing: null, nodeId: null });
    expect(node.service.status().addresses).toEqual([]);
    expect(node.service.port).toBeNull();
    expect(() => node.service.pairingCode()).toThrow(RpcError);

    const status = await node.service.start({ port: 0, name: 'Studio' });
    expect(status).toMatchObject({
      enabled: true,
      listening: true,
      error: null,
      nodeId: expect.stringMatching(/^node_/),
      name: 'Studio',
      port: node.service.port,
      addresses: ['127.0.0.1'],
      allowAnySource: false,
      pairing: { code: expect.stringMatching(/^\d{6}$/), expiresAt: expect.any(String) },
      clients: [],
      jobs: { running: 0, queued: 0 },
    });
    expect(node.advertiser.active).toEqual({ name: 'Studio', port: node.service.port, nodeId: status.nodeId, version: 1 });
    const mode = (await fs.stat(node.home.nodeShareFile)).mode & 0o777;
    expect(mode).toBe(0o600);

    // 再次开启：换一个配对码，nodeId 不变。
    const again = await node.service.start({});
    expect(again.nodeId).toBe(status.nodeId);
    expect(pairingCodeOf(again)).not.toBeNull();

    const token = await node.pair();
    const { job } = await submitTestJob(node.baseUrl, token, MEDIA, { bundleId: 'fake@cpu#slow' });
    await until(() => node.manager.inspect(job.jobId).state === 'running');
    const baseUrl = node.baseUrl;
    const stopped = await node.service.stop();
    expect(stopped).toMatchObject({ enabled: false, listening: false, addresses: [], pairing: null, jobs: { running: 0, queued: 0 } });
    expect(stopped.clients).toHaveLength(1);
    expect(node.advertiser.active).toBeNull();
    expect(node.manager.inspect(job.jobId).state).toBe('cancelled');
    expect(await fs.readdir(node.home.nodeJobsDir).catch(() => [])).toEqual([]);
    await expect(fetch(`${baseUrl}/v1/health`)).rejects.toThrow();
  });

  it('端口被占用：不监听，error 说明原因；换个端口再开启就好', async () => {
    const blocker = http.createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const taken = (blocker.address() as { port: number }).port;
    try {
      node = await startTestNode({ share: { port: taken } });
      expect(node.service.status()).toMatchObject({
        enabled: true,
        listening: false,
        port: taken,
        error: expect.stringContaining(String(taken)),
        addresses: [],
      });
      const status = await node.service.start({ port: 0 });
      expect(status).toMatchObject({ listening: true, error: null, addresses: ['127.0.0.1'] });
      expect(status.port).not.toBe(taken);
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  });
});

describe('能力的分项开关', () => {
  let node: TestNode | null = null;

  afterEach(async () => {
    await node?.close();
    node = null;
  });

  const health = async (n: TestNode) => (await (await fetch(`${n.baseUrl}/v1/health`)).json()) as NodeHealth;
  const createJob = (n: TestNode, token: string, request: NodeJobRequest) =>
    nodeFetch(n.baseUrl, token, '/v1/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
  const stored = async (n: TestNode) => JSON.parse(await fs.readFile(n.home.nodeShareFile, 'utf8')) as Record<string, unknown>;

  it('第一次开启共享：支持的能力全部打开，写进 node-share.json', async () => {
    node = await startTestNode({ share: null });
    // 还没开启过：按开启时的默认报告。
    expect(node.service.status().capabilities).toEqual({ transcribe: { enabled: true } });
    const status = await node.service.start({ port: 0 });
    expect(status.capabilities).toEqual({ transcribe: { enabled: true } });
    expect((await stored(node)).capabilities).toEqual({ transcribe: { enabled: true } });
    expect((await health(node)).capabilities.transcribe.enabled).toBe(true);
  });

  it('关闭立即生效：健康照实报告，新任务 403 CAPABILITY_DISABLED；已经接受的任务（运行中、等上传）照常跑完', async () => {
    node = await startTestNode();
    const n = node;
    const token = await n.pair();
    const { job: running, request: runningRequest } = await submitTestJob(n.baseUrl, token, MEDIA, { bundleId: 'fake@cpu#slow' });
    await until(() => n.manager.inspect(running.jobId).state === 'running');
    const waiting = (await (await createJob(n, token, testJobRequest(MEDIA))).json()) as NodeJob;
    expect(waiting.state).toBe('awaiting-input');
    const runningEvents = nodeFetch(n.baseUrl, token, `/v1/jobs/${running.jobId}/events`);

    const off = await n.service.setCapability('transcribe', false);
    expect(off.capabilities).toEqual({ transcribe: { enabled: false } });
    expect((await health(n)).capabilities.transcribe.enabled).toBe(false);

    const rejected = await createJob(n, token, testJobRequest(MEDIA));
    expect(rejected.status).toBe(403);
    expect(await errorOf(rejected)).toMatchObject({ code: 'CAPABILITY_DISABLED', details: { capability: 'transcribe' } });
    // 已经接受的任务重发同一个幂等键不是新任务：照样返回原来的。
    const replay = await createJob(n, token, runningRequest);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ jobId: running.jobId });

    // 等上传的任务照样收媒体、跑完。
    const uploaded = await nodeFetch(n.baseUrl, token, `/v1/jobs/${waiting.jobId}/input`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Uint8Array(MEDIA),
    });
    expect(uploaded.status).toBe(204);
    expect((await readEvents(await runningEvents)).at(-1)).toMatchObject({ type: 'job', job: { state: 'completed' } });
    const waitingEvents = await readEvents(await nodeFetch(n.baseUrl, token, `/v1/jobs/${waiting.jobId}/events`));
    expect(waitingEvents.at(-1)).toMatchObject({ type: 'job', job: { state: 'completed' } });
    expect((await nodeFetch(n.baseUrl, token, `/v1/jobs/${running.jobId}/result`)).status).toBe(200);

    // 再打开：新任务照常创建。
    const on = await n.service.setCapability('transcribe', true);
    expect(on.capabilities).toEqual({ transcribe: { enabled: true } });
    expect((await health(n)).capabilities.transcribe.enabled).toBe(true);
    expect((await createJob(n, token, testJobRequest(MEDIA))).status).toBe(201);
  });

  it('开关持久：重启后照样关着，健康照实报告；共享关着时也能设，开启时沿用', async () => {
    node = await startTestNode();
    const token = await node.pair();
    await node.service.setCapability('transcribe', false);
    expect((await stored(node)).capabilities).toEqual({ transcribe: { enabled: false } });
    const dir = node.dir;
    await node.close({ keepDir: true });

    node = await startTestNode({ dir, share: null });
    expect(node.service.status()).toMatchObject({ enabled: true, listening: true, capabilities: { transcribe: { enabled: false } } });
    expect((await health(node)).capabilities.transcribe.enabled).toBe(false);
    expect((await createJob(node, token, testJobRequest(MEDIA))).status).toBe(403);

    // 关掉共享再设：开启时沿用，不回到默认。
    await node.service.stop();
    await node.service.setCapability('transcribe', true);
    await node.service.setCapability('transcribe', false);
    const restarted = await node.service.start({ port: 0 });
    expect(restarted.capabilities).toEqual({ transcribe: { enabled: false } });
  });

  it('不是节点支持共享的模型能力：invalid-request，状态不变', async () => {
    node = await startTestNode();
    for (const capability of ['synthesizeSpeech', 'download', 'export', '']) {
      await expect(node.service.setCapability(capability, false)).rejects.toMatchObject({
        code: 'invalid-request',
        details: { capability, shareable: ['transcribe'] },
      });
    }
    expect(node.service.status().capabilities).toEqual({ transcribe: { enabled: true } });
    expect((await stored(node)).capabilities).toEqual({ transcribe: { enabled: true } });
  });

  it('分项开关之前写下的 node-share.json：照常读入，开启过共享的转写算打开，已配对的客户端还在', async () => {
    node = await startTestNode();
    const token = await node.pair();
    const dir = node.dir;
    const nodeId = node.service.status().nodeId;
    await node.close({ keepDir: true });
    const file = resolveRuntimeHome({ BAOCUT_HOME: dir }).nodeShareFile;
    const { capabilities: _capabilities, ...legacy } = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
    expect(legacy).toMatchObject({ formatVersion: 1, enabled: true, nodeId });
    await fs.writeFile(file, JSON.stringify(legacy), { mode: 0o600 });

    node = await startTestNode({ dir, share: null });
    expect(node.service.status()).toMatchObject({
      enabled: true,
      listening: true,
      nodeId,
      capabilities: { transcribe: { enabled: true } },
      clients: [expect.objectContaining({ clientId: 'client-a' })],
    });
    expect((await health(node)).capabilities.transcribe.enabled).toBe(true);
    expect((await createJob(node, token, testJobRequest(MEDIA))).status).toBe(201);
    // 下一次写入补上这张表。
    await node.service.setCapability('transcribe', true);
    expect((await stored(node)).capabilities).toEqual({ transcribe: { enabled: true } });
  });

  it('分项开关之前写下、从没开启过共享的文件：第一次开启时全部打开', async () => {
    node = await startTestNode({ share: null });
    const dir = node.dir;
    await node.close({ keepDir: true });
    const file = resolveRuntimeHome({ BAOCUT_HOME: dir }).nodeShareFile;
    await fs.writeFile(
      file,
      JSON.stringify({ formatVersion: 1, enabled: false, nodeId: null, name: null, port: 0, allowAnySource: false, clients: [] }),
    );
    node = await startTestNode({ dir, share: null, shareableCapabilities: ['transcribe', 'align'] });
    const status = await node.service.start({ port: 0 });
    expect(status.capabilities).toEqual({ transcribe: { enabled: true }, align: { enabled: true } });
  });

  it('之后新加入的能力：已经开启过共享的节点默认关闭，由主人打开；新开启共享的节点默认打开', async () => {
    node = await startTestNode();
    const dir = node.dir;
    await node.close({ keepDir: true });

    // 代码里多了一种可共享的能力（align），存下的表里没有它。
    node = await startTestNode({ dir, share: null, shareableCapabilities: ['transcribe', 'align'] });
    expect(node.service.status().capabilities).toEqual({ transcribe: { enabled: true }, align: { enabled: false } });
    const enabled = await node.service.setCapability('align', true);
    expect(enabled.capabilities).toEqual({ transcribe: { enabled: true }, align: { enabled: true } });
    await node.close();

    node = await startTestNode({ shareableCapabilities: ['transcribe', 'align'] });
    expect(node.service.status().capabilities).toEqual({ transcribe: { enabled: true }, align: { enabled: true } });
  });
});

describe('ShareStatus.addresses：只列出此刻连得上的地址', () => {
  const lan = () => ['192.168.1.20', '10.0.0.5'];

  it('没在监听：空', () => {
    expect(shareAddresses(null, lan)).toEqual([]);
  });

  it('监听所有接口：本机的局域网地址', () => {
    expect(shareAddresses('0.0.0.0', lan)).toEqual(['192.168.1.20', '10.0.0.5']);
    expect(shareAddresses('::', lan)).toEqual(['192.168.1.20', '10.0.0.5']);
  });

  it('绑定具体地址：只有这个地址，回环地址也一样', () => {
    expect(shareAddresses('192.168.1.20', lan)).toEqual(['192.168.1.20']);
    expect(shareAddresses('127.0.0.1', lan)).toEqual(['127.0.0.1']);
  });
});

describe('与本地视频任务共用一个队列', () => {
  /** 内存里的视频：一个素材，记下提交的编辑。 */
  class FakeVideos implements JobVideos {
    leases = 0;
    applied: EditOperation[][] = [];
    readonly file: string;
    constructor(file: string) {
      this.file = file;
    }
    retain() {
      this.leases++;
    }
    release() {
      this.leases--;
    }
    async source() {
      return { file: this.file, revision: '1', contentHash: 'sha256:' + 'a'.repeat(64), mediaType: 'audio/wav' };
    }
    current() {
      return { videoRevision: '1', asset: { revision: '1', contentHash: 'sha256:' + 'a'.repeat(64) } };
    }
    videoRevision() {
      return '1';
    }
    async apply(_videoId: string, request: { operations: EditOperation[] }) {
      this.applied.push(request.operations);
      return { refs: { speech: 'doc_speech' } };
    }
  }

  let node: TestNode | undefined;
  afterEach(async () => {
    await node?.close();
  });

  it('同一个模型包上的本地任务与远端任务按到达顺序一次一个', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-node-queue-'));
    const audio = path.join(dir, 'audio.wav');
    await fs.writeFile(audio, 'local audio');
    const videos = new FakeVideos(audio);
    node = await startTestNode({ videos, dir });
    const token = await node.pair();
    const bundleId = 'fake@cpu#slow-load';

    const local1 = await node.manager.submitTranscribe(
      { videoId: 'mov_1', assetId: 'ast_1', bundleId },
      { kind: 'connection', id: 'conn_1' },
    );
    const { job: remote } = await submitTestJob(node.baseUrl, token, MEDIA, { bundleId });
    // 换一个提示，免得与第一个本地任务合并成同一个。
    const local2 = await node.manager.submitTranscribe(
      { videoId: 'mov_1', assetId: 'ast_1', bundleId, hint: 'second' },
      { kind: 'connection', id: 'conn_1' },
    );
    // 第一个本地任务还在加载模型时，远端任务排在它后面。
    expect(node.manager.inspect(remote.jobId).state).toBe('queued');

    for (const jobId of [local1.jobId, remote.jobId, local2.jobId]) await node.manager.settled(jobId);
    const records = [local1.jobId, remote.jobId, local2.jobId].map((id) => node!.manager.inspect(id));
    expect(new Set(records.map((r) => r.jobId)).size).toBe(3);
    expect(records.map((r) => r.state)).toEqual(['completed', 'completed', 'completed']);
    for (let i = 1; i < records.length; i++) {
      expect(Date.parse(records[i]!.startedAt!)).toBeGreaterThanOrEqual(Date.parse(records[i - 1]!.endedAt!));
    }
    expect(records[1]).toMatchObject({ submitter: { kind: 'node', id: 'client-a' }, videoId: null, result: null });
    // 只有两个本地任务写了视频。
    expect(videos.applied).toHaveLength(2);
    expect(videos.leases).toBe(0);
  });
});
