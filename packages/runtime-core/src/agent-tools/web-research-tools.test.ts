import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import { newId, type AgentMode } from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { startRuntime, type RunningRuntime } from '../runtime.ts';
import { PARALLEL_SEARCH_URL, WEB_RESEARCH_USER_AGENT } from '../web-research/parallel-search.ts';
import { ToolDriver, mcp, tool, until, type ToolSession } from './testing/fake-agent.ts';

const SEARCH = { objective: 'Find NASA sources on Artemis', search_queries: ['NASA Artemis mission program'] };
const FETCH = { urls: ['https://www.nasa.gov/humans-in-space/artemis/'], objective: 'Artemis program goals' };
const SOURCE = { title: 'Artemis', url: FETCH.urls[0], excerpts: ['NASA is exploring the Moon with Artemis.'] };
type RequestRecord = { url: string; headers: Headers; method: string; args?: Record<string, unknown>; name?: string };

/** Scripted driver, real Runtime/authentication/registry/approvals and real MCP SDK transport. */
describe('conversation web research', () => {
  let dir: string;
  let runtime: RunningRuntime;
  let client: BaoCutClient;
  let driver: ToolDriver;
  let requests: RequestRecord[];
  let behavior: 'ok' | 'text' | 'quota' | 'http-error' | 'malformed' | 'missing-tool' | 'hang';
  let aborted: boolean;
  let live: boolean;
  let liveResponses: string[];

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-web-research-'));
    requests = [];
    behavior = 'ok';
    aborted = false;
    live = false;
    liveResponses = [];
    // Demonstrate that credentials in the environment never enter the anonymous transport.
    vi.stubEnv('PARALLEL_API_KEY', 'configured-key-must-not-be-sent');
    vi.stubEnv('BAOCUT_WEB_RESEARCH', 'on');
    const fetcher: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      const url = request.url;
      const headers = request.headers;
      const message = JSON.parse((await request.clone().text()) || '{}') as { id?: number; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
      requests.push({ url, headers, method: message.method ?? String(init?.method), name: message.params?.name, args: message.params?.arguments });
      if (live) {
        const response = await fetch(input, init);
        const body = await response.clone().text();
        liveResponses.push(body);
        console.info('Live Parallel response', response.status, message.method, body);
        return response;
      }
      if (behavior === 'hang' && message.method === 'tools/call') {
        return new Promise<Response>((_resolve, reject) => {
          const cancel = () => { aborted = true; reject(request.signal.reason); };
          if (request.signal.aborted) cancel();
          else request.signal.addEventListener('abort', cancel, { once: true });
        });
      }
      if (behavior === 'http-error') return new Response('Unavailable', { status: 503 });
      if (message.id === undefined) return new Response(null, { status: 202 });
      if (behavior === 'malformed') return Response.json({ unexpected: true });
      const result = message.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
        : message.method === 'tools/list'
          ? { tools: behavior === 'missing-tool' ? [] : ['web_search', 'web_fetch'].map((name) => ({ name, inputSchema: { type: 'object' } })) }
          : { content: [{ type: 'text', text: JSON.stringify({ results: [SOURCE] }) }], ...(behavior === 'quota' ? { isError: true } : behavior === 'text' ? {} : { structuredContent: { results: [SOURCE] } }) };
      return Response.json({ jsonrpc: '2.0', id: message.id, result });
    };
    driver = new ToolDriver({ models: ['saved-model', 'override-model'].map((id) => ({ id, label: id, description: null, tier: null, isDefault: false, efforts: [], defaultEffort: null })) });
    runtime = await startRuntime({
      home: resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') }),
      drivers: () => [driver], engineHost: null, modelWorker: null, watchSpace: false,
      initiator: { discoverer: null }, nodes: { host: '127.0.0.1', advertiser: null },
      webResearch: { fetch: fetcher, timeoutMs: process.env.BAOCUT_LIVE_WEB_RESEARCH === '1' ? 60_000 : 1000 },
    });
    client = new BaoCutClient({
      resolve: async () => runtime.discovery,
      client: { kind: 'desktop', name: 'test', version: '0' }, reconnect: false,
    });
    await client.connect();
  });

  afterEach(async () => {
    for (const session of driver?.sessions ?? []) session.finish();
    client?.close();
    await runtime?.close();
    await fs.rm(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  async function conversation(mode: AgentMode = 'fullAccess', model: string | null = null) {
    const { conversation } = await client.request('conversations.create', { projectId: null, driverId: 'codex', model });
    const before = driver.sessions.length;
    const { taskId } = await client.request('conversations.send', { conversationId: conversation.id, text: 'Research public sources', accessMode: mode, commandId: newId('cmd') });
    const session = await until(() => driver.sessions[before]?.turnId ? driver.sessions[before] : undefined);
    return { id: conversation.id, session, taskId };
  }

  const calls = () => requests.filter((r) => r.method === 'tools/call');

  it('discovers and executes keyless search and fetch through the normal agent registry', async () => {
    const { session } = await conversation();
    const listed = await mcp(session, 'tools/list');
    expect(listed.result!.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'web_search' }), expect.objectContaining({ name: 'web_fetch' }), expect.objectContaining({ name: 'assets_search' })]));
    for (const [name, args] of [['web_search', SEARCH], ['web_fetch', FETCH]] as const) {
      const response = await tool(session, name, args);
      expect(response.isError, JSON.stringify(response.body)).toBe(false);
      expect(response.body).toMatchObject({ provider: 'parallel', data: { results: [SOURCE] }, approval: { risk: 'high' } });
    }
    expect(calls().map((r) => r.args)).toEqual([expect.objectContaining(SEARCH), expect.objectContaining(FETCH)]);
    expect(new Set(calls().map((r) => r.args!.session_id)).size).toBe(1);
    expect(requests.some((r) => r.method === 'initialize')).toBe(true);
    expect(requests.some((r) => r.method === 'tools/list')).toBe(true);
    for (const request of requests) {
      expect(request.url).toBe(PARALLEL_SEARCH_URL);
      expect(request.headers.get('User-Agent')).toBe(WEB_RESEARCH_USER_AGENT);
      expect(request.headers.has('Authorization')).toBe(false);
      expect(request.headers.has('Cookie')).toBe(false);
    }
  });

  it('preserves text-only MCP source results for downstream use', async () => {
    const { session } = await conversation();
    behavior = 'text';
    const response = await tool(session, 'web_search', SEARCH);
    expect(response.isError).toBe(false);
    expect(JSON.parse(response.body.content[0].text).results[0]).toEqual(SOURCE);
  });

  it('isolates interleaved conversations while preserving identity on fetch, follow-up and quota retry', async () => {
    const a = await conversation();
    const b = await conversation();
    await Promise.all([tool(a.session, 'web_search', SEARCH), tool(b.session, 'web_search', SEARCH)]);
    const ids = [a.id.slice(5), b.id.slice(5)];
    expect(new Set(calls().map((r) => r.args!.session_id))).toEqual(new Set(ids));
    expect(ids[0]).toMatch(/^[a-f0-9]{32}$/);
    expect(ids[1]).not.toBe(ids[0]);
    await tool(a.session, 'web_fetch', FETCH);
    behavior = 'quota';
    expect((await tool(a.session, 'web_search', SEARCH)).body.error.code).toBe('WEB_RESEARCH_UNAVAILABLE');
    behavior = 'ok';
    a.session.finish();
    await until(() => !runtime.harness.agentRun(a.id).taskId);
    await client.request('conversations.send', { conversationId: a.id, text: 'Follow up', commandId: newId('cmd') });
    await until(() => a.session.turnId);
    await tool(a.session, 'web_search', SEARCH);
    await tool(b.session, 'web_fetch', FETCH);
    expect(calls().slice(2, 5).map((r) => r.args!.session_id)).toEqual([ids[0], ids[0], ids[0]]);
    expect(calls().at(-1)!.args!.session_id).toBe(ids[1]);
    const fresh = await conversation();
    await tool(fresh.session, 'web_search', SEARCH);
    expect(ids).not.toContain(calls().at(-1)!.args!.session_id);
  });

  it('honors offline, explicit disable and invalid URLs without network requests', async () => {
    const { session } = await conversation();
    await client.request('settings.set', { values: { 'offline.strict': true } });
    expect((await tool(session, 'web_search', SEARCH)).body.error.code).toBe('OFFLINE_STRICT');
    await client.request('settings.set', { values: { 'offline.strict': false } });
    vi.stubEnv('BAOCUT_WEB_RESEARCH', 'off');
    expect((await tool(session, 'web_fetch', FETCH)).body.error.code).toBe('WEB_RESEARCH_DISABLED');
    vi.stubEnv('BAOCUT_WEB_RESEARCH', 'on');
    for (const url of ['file:///etc/passwd', 'https://user:password@example.org/']) {
      expect((await tool(session, 'web_fetch', { urls: [url] })).body.error.code).toBe('INVALID_ARGUMENTS');
    }
    expect(requests).toEqual([]);
  });

  it('retains the user-selected engine, model and access mode and asks before external research', async () => {
    const { session, id } = await conversation('ask', 'saved-model');
    await client.request('conversations.update', { conversationId: id, model: 'override-model' });
    const before = runtime.harness.conversationOf(id)!;
    const pendingCall = tool(session, 'web_search', SEARCH);
    const pending = await until(() => runtime.harness.approvals.pending()[0]);
    expect(pending.risk).toBe('high');
    expect(pending.action.targets).toEqual([PARALLEL_SEARCH_URL]);
    expect(requests).toEqual([]);
    await client.request('approvals.respond', { approvalId: pending.approvalId, decision: 'deny' });
    expect((await pendingCall).body.error.code).toBe('APPROVAL_DENIED');
    expect(requests).toEqual([]);
    const allowedCall = tool(session, 'web_search', SEARCH);
    const allowed = await until(() => runtime.harness.approvals.pending()[0]);
    await client.request('approvals.respond', { approvalId: allowed.approvalId, decision: 'allow' });
    expect((await allowedCall).body).toMatchObject({ provider: 'parallel', approval: { decidedBy: 'user' } });
    const after = runtime.harness.conversationOf(id)!;
    expect([after.driverId, after.model, after.accessMode]).toEqual([before.driverId, before.model, before.accessMode]);
  });

  it('rejects plan mode and inactive tasks, including retained session tokens', async () => {
    const plan = await conversation('plan');
    expect((await tool(plan.session, 'web_search', SEARCH)).body.error.code).toBe('PLAN_ONLY');
    const active = await conversation();
    active.session.finish();
    await until(() => !runtime.harness.agentRun(active.id).taskId);
    expect((await tool(active.session, 'web_search', SEARCH)).body.error.code).toBe('NO_ACTIVE_TASK');
    expect(requests).toEqual([]);
  });

  it.each(['quota', 'http-error', 'malformed', 'missing-tool'] as const)('returns actionable errors for %s without fallback', async (failure) => {
    const { session } = await conversation();
    behavior = failure;
    const response = await tool(session, 'web_search', SEARCH);
    expect(response.isError).toBe(true);
    expect(response.body.error.code).toBe(failure === 'missing-tool' ? 'WEB_RESEARCH_PROTOCOL' : 'WEB_RESEARCH_UNAVAILABLE');
    expect(calls().length).toBeLessThanOrEqual(1);
    expect(requests.every((r) => r.url === PARALLEL_SEARCH_URL)).toBe(true);
  });

  it('times out the actual SDK request', async () => {
    const { session } = await conversation();
    behavior = 'hang';
    const response = await tool(session, 'web_search', SEARCH);
    expect(response.body.error.code).toBe('WEB_RESEARCH_TIMEOUT');
    expect(aborted).toBe(true);
  });

  it('cancels the actual SDK request when the task stops', async () => {
    const { session, taskId } = await conversation();
    behavior = 'hang';
    const pending = tool(session, 'web_search', SEARCH);
    await until(() => calls().length > 0);
    await client.request('tasks.stop', { taskId });
    expect((await pending).body.error.code).toBe('WEB_RESEARCH_CANCELLED');
    expect(aborted).toBe(true);
  });

  it('does not expose research tools through the external MCP service or CLI catalog', async () => {
    const result = await client.request('catalog.list', {});
    expect(JSON.stringify(result)).not.toContain('web_search');
    await client.request('services.configure', { serviceId: 'mcp', port: 0, level: 'auto' });
    const { service } = await client.request('services.start', { serviceId: 'mcp' });
    const { token } = await client.request('services.mcp.createClient', { name: 'test' });
    const { rpc } = await import('../services/testing/mcp-client.ts');
    const external = await rpc(service.endpoint!, token, 'tools/list');
    expect(JSON.stringify(external.result)).not.toContain('web_search');
  });

  it.skipIf(process.env.BAOCUT_LIVE_WEB_RESEARCH !== '1')('runs a live anonymous request through the actual caller', async () => {
    live = true;
    const { session } = await conversation();
    const response = await tool(session, 'web_search', SEARCH);
    console.info('Live caller result', JSON.stringify(response));
    if (response.isError) {
      // An explicit anonymous quota is a retained condition, not a successful search.
      expect(liveResponses.join('\n')).toMatch(/quota|rate.limit|free.tier.limit/i);
    } else {
      expect(JSON.stringify(response.body)).toMatch(/Artemis/i);
      const fetched = await tool(session, 'web_fetch', FETCH);
      console.info('Live fetch result', JSON.stringify(fetched));
      if (fetched.isError) expect(liveResponses.join('\n')).toMatch(/quota|rate.limit|free.tier.limit/i);
      else expect(JSON.stringify(fetched.body)).toMatch(/Artemis/i);
    }
    expect(requests.every((r) => r.url === PARALLEL_SEARCH_URL && r.headers.get('User-Agent') === WEB_RESEARCH_USER_AGENT && !r.headers.has('Authorization'))).toBe(true);
    expect(response.isError ? response.body.error.code : response.body.provider).toBe(response.isError ? 'WEB_RESEARCH_UNAVAILABLE' : 'parallel');
  }, 75_000);
});
