/**
 * 假 opencode 的入口（由 fake-opencode.ts 写出的 shell 包装调用）。`--version` 按场景输出版本；`serve` 起一个只监听
 * 127.0.0.1 的 HTTP 服务，形状照 OpenCode 2.x 的 v2 API（2.0.24 实测）：Basic 认证（用户名 opencode、密码取
 * OPENCODE_PASSWORD）、`server listening on http://127.0.0.1:<port>` 一行、冷启动时第一次 `/api/plugin` 回空表、
 * `/api/event` 是带心跳注释的 SSE。回合按场景发事件；拒绝工具后以 `interrupted(shutdown)` 结束执行（同真实行为）。
 * 收到的每个请求记进 `log.jsonl`；会话存进 `sessions.json`，换一个进程也能按 id 恢复。
 */
import http from 'node:http';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FakeOpenCodeScenario, FakeOpenCodeTurn } from './fake-opencode.ts';

const dir = process.env.FAKE_OPENCODE_DIR!;
const scenario = JSON.parse(readFileSync(path.join(dir, 'scenario.json'), 'utf8')) as FakeOpenCodeScenario;
const logFile = path.join(dir, 'log.jsonl');
const sessionsFile = path.join(dir, 'sessions.json');
const t0 = Date.now();

function log(entry: Record<string, unknown>): void {
  appendFileSync(logFile, JSON.stringify({ t: t0, pid: process.pid, ...entry }) + '\n');
}

const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write(`${scenario.versionOutput}\n`);
  process.exit(0);
}
if (args[0] !== 'serve') {
  process.stderr.write(`unknown command ${args.join(' ')}\n`);
  process.exit(2);
}

interface SessionRecord {
  id: string;
  directory: string;
  agent: string;
  model: { providerID: string; id: string; variant?: string } | null;
  permissions: unknown[];
}

function loadSessions(): Record<string, SessionRecord> {
  try {
    return JSON.parse(readFileSync(sessionsFile, 'utf8')) as Record<string, SessionRecord>;
  } catch {
    return {};
  }
}
function saveSession(session: SessionRecord): void {
  const all = loadSessions();
  all[session.id] = session;
  writeFileSync(sessionsFile, JSON.stringify(all));
}

const password = process.env.OPENCODE_PASSWORD ?? '';
const expectedAuth = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
const streams = new Set<http.ServerResponse>();
const active = new Set<string>();
const mcp = new Map<string, string>();
let pluginCalls = 0;
let seq = 0;
let nextId = 1;
const id = (prefix: string) => `${prefix}_fake${process.pid}x${nextId++}`;
/** 等待中的权限请求：requestID → 收到答复时继续。 */
const permissionWaiters = new Map<string, (decision: string) => void>();
const interruptWaiters = new Map<string, () => void>();
/** 收到中断、但执行还没走到等待点的会话：走到时直接结束。 */
const interruptRequested = new Set<string>();

function broadcast(type: string, data: Record<string, unknown>, durable = false): void {
  const event = {
    id: id('evt'),
    created: Date.now(),
    type,
    data,
    ...(durable ? { durable: { aggregateID: data.sessionID, seq: ++seq, version: 1 } } : {}),
  };
  for (const res of streams) res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function send(res: http.ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runTurn(sessionID: string, turn: FakeOpenCodeTurn): Promise<void> {
  active.add(sessionID);
  const messageID = id('msg');
  const base = { sessionID, assistantMessageID: messageID };
  broadcast('session.execution.started', { sessionID }, true);
  await delay(turn.delayMs ?? 5);
  if (turn.crash) {
    log({ kind: 'crash' });
    process.exit(3);
  }
  if (turn.reasoning) {
    broadcast('session.reasoning.started', { ...base, ordinal: 0 }, true);
    broadcast('session.reasoning.delta', { ...base, ordinal: 0, delta: turn.reasoning });
    broadcast('session.reasoning.ended', { ...base, ordinal: 0, text: turn.reasoning }, true);
  }
  if (turn.tool) {
    const toolId = id('call');
    const tool = turn.tool;
    broadcast('session.tool.input.started', { ...base, id: toolId, name: tool.name }, true);
    broadcast('session.tool.called', { ...base, id: toolId, input: tool.input, executed: false }, true);
    if (tool.permission) {
      const requestID = id('per');
      const decision = await new Promise<string>((resolve) => {
        permissionWaiters.set(requestID, resolve);
        broadcast('permission.asked', {
          id: requestID,
          sessionID,
          action: tool.permission!.action,
          resources: tool.permission!.resources,
          save: ['*'],
          ...(tool.permission!.metadata ? { metadata: tool.permission!.metadata } : {}),
          source: { type: 'tool', messageID, id: toolId },
        });
        interruptWaiters.set(sessionID, () => resolve('interrupted'));
      });
      interruptWaiters.delete(sessionID);
      if (decision === 'interrupted') {
        broadcast(
          'session.tool.failed',
          { ...base, id: toolId, error: { type: 'aborted', message: 'Tool execution aborted' }, executed: false },
          true,
        );
        broadcast('session.execution.interrupted', { sessionID, reason: 'user' }, true);
        active.delete(sessionID);
        return;
      }
      broadcast('permission.replied', { sessionID, requestID, reply: decision });
      if (decision === 'reject') {
        broadcast(
          'session.tool.failed',
          { ...base, id: toolId, error: { type: 'aborted', message: 'The user declined this tool call' }, executed: false },
          true,
        );
        broadcast('session.step.failed', { ...base, error: { type: 'aborted', message: 'Step interrupted' } }, true);
        broadcast('session.execution.interrupted', { sessionID, reason: 'shutdown' }, true);
        active.delete(sessionID);
        return;
      }
    }
    broadcast(
      'session.tool.success',
      {
        ...base,
        id: toolId,
        content: [{ type: 'text', text: tool.output ?? 'ok' }],
        ...(tool.metadata ? { metadata: tool.metadata } : {}),
        executed: false,
      },
      true,
    );
  }
  if (turn.reply) {
    broadcast('session.text.started', { ...base, ordinal: 0 }, true);
    for (const part of turn.reply.match(/.{1,4}/gs) ?? []) broadcast('session.text.delta', { ...base, ordinal: 0, delta: part });
    broadcast('session.text.ended', { ...base, ordinal: 0, text: turn.reply }, true);
  }
  if (turn.end === 'hang') {
    if (!interruptRequested.has(sessionID)) await new Promise<void>((resolve) => interruptWaiters.set(sessionID, resolve));
    interruptRequested.delete(sessionID);
    interruptWaiters.delete(sessionID);
    broadcast('session.step.failed', { ...base, error: { type: 'aborted', message: 'Step interrupted' } }, true);
    broadcast('session.execution.interrupted', { sessionID, reason: 'user' }, true);
  } else if (turn.end === 'failed') {
    broadcast('session.execution.failed', { sessionID, error: { type: 'provider', message: turn.error ?? 'boom' } }, true);
  } else {
    broadcast('session.execution.succeeded', { sessionID }, true);
  }
  active.delete(sessionID);
}

async function body(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let text = '';
  for await (const chunk of req) text += chunk;
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const location = url.searchParams.get('location[directory]');
  const payload = req.method === 'GET' ? {} : await body(req);
  log({ kind: 'request', method: req.method, path: url.pathname, location, body: payload });
  if (req.headers.authorization !== expectedAuth) return send(res, 401, { _tag: 'UnauthorizedError', message: 'Authentication required' });
  const parts = url.pathname.split('/').filter(Boolean);
  const route = `${req.method} /${parts.map((p) => (p.startsWith('ses_') ? ':id' : p)).join('/')}`;
  const sessionID = parts.find((p) => p.startsWith('ses_'));
  switch (route) {
    case 'GET /api/info':
      return send(res, 200, { version: scenario.versionOutput.replace(/^opencode v/, ''), pid: process.pid });
    case 'GET /api/event':
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.write(`data: ${JSON.stringify({ id: id('evt'), type: 'server.connected', data: {} })}\n\n`);
      streams.add(res);
      req.on('close', () => streams.delete(res));
      return;
    case 'GET /api/plugin':
      pluginCalls++;
      return send(res, 200, {
        location: { directory: location },
        data: pluginCalls <= scenario.coldPluginCalls ? [] : [{ id: 'opencode.config.mcp', state: { status: 'active' } }],
      });
    case 'GET /api/model':
      if (scenario.catalog === 'error') return send(res, 500, { _tag: 'UnknownError', message: 'catalog exploded' });
      return send(res, 200, { location: { directory: location }, data: scenario.models });
    case 'GET /api/model/default':
      return send(res, 200, {
        location: { directory: location },
        data: scenario.models.find((m) => `${m.providerID}/${m.id}` === scenario.defaultModel) ?? null,
      });
    case 'GET /api/provider':
      return send(res, 200, { location: { directory: location }, data: scenario.providers });
    case 'PUT /api/experimental/mcp/' + parts[3]: {
      mcp.set(decodeURIComponent(parts[3]!), 'pending');
      setTimeout(() => mcp.set(decodeURIComponent(parts[3]!), scenario.mcp), 20);
      return send(res, 204);
    }
    case 'GET /api/mcp':
      return send(res, 200, {
        location: { directory: location },
        data: [...mcp].map(([name, status]) => ({
          name,
          status: status === 'failed' ? { status, error: 'Unable to connect' } : { status },
        })),
      });
    case 'POST /api/session': {
      const session: SessionRecord = {
        id: id('ses'),
        directory: String((payload.location as { directory?: string } | undefined)?.directory ?? ''),
        agent: String(payload.agent ?? 'build'),
        model: (payload.model as SessionRecord['model']) ?? { providerID: 'opencode', id: 'big-pickle', variant: 'default' },
        permissions: (payload.permissions as unknown[]) ?? [],
      };
      saveSession(session);
      broadcast('session.created', { sessionID: session.id });
      return send(res, 200, { data: { id: session.id, agent: session.agent, model: session.model } });
    }
    case 'GET /api/session/:id': {
      const session = loadSessions()[sessionID!];
      if (!session) return send(res, 404, { _tag: 'SessionNotFoundError', sessionID, message: `Session not found: ${sessionID}` });
      return send(res, 200, { data: { id: session.id, agent: session.agent, model: session.model } });
    }
    case 'PATCH /api/session/:id': {
      const session = loadSessions()[sessionID!];
      if (!session) return send(res, 404, { _tag: 'SessionNotFoundError', sessionID, message: 'not found' });
      if (payload.permissions) session.permissions = payload.permissions as unknown[];
      saveSession(session);
      broadcast('session.permissions', { sessionID, permissions: session.permissions }, true);
      return send(res, 204);
    }
    case 'POST /api/session/:id/model': {
      const session = loadSessions()[sessionID!]!;
      session.model = payload.model as SessionRecord['model'];
      saveSession(session);
      return send(res, 204);
    }
    case 'PUT /api/experimental/session/:id/instructions/entries/' + parts[6]:
      if (scenario.instructions === 'missing') return send(res, 404, { _tag: 'NotFound', message: 'no route' });
      return send(res, 204);
    case 'POST /api/session/:id/prompt': {
      const delivery = payload.delivery ?? 'steer';
      send(res, 200, { data: { id: id('msg'), sessionID, type: 'user', payload: { text: payload.text }, delivery } });
      if (active.has(sessionID!)) return; // 插话：并入进行中的执行。
      void runTurn(sessionID!, scenario.turn);
      return;
    }
    case 'POST /api/session/:id/interrupt': {
      if (!active.has(sessionID!)) return send(res, 200, { interrupted: false });
      const waiter = interruptWaiters.get(sessionID!);
      if (waiter) waiter();
      else interruptRequested.add(sessionID!);
      return send(res, 200, { interrupted: true });
    }
    case 'GET /api/session/active':
      return send(res, 200, { data: Object.fromEntries([...active].map((s) => [s, { type: 'running' }])) });
    case `POST /api/session/:id/permission/${parts[4]}/reply`: {
      const waiter = permissionWaiters.get(parts[4]!);
      if (!waiter) return send(res, 404, { _tag: 'PermissionNotFoundError', message: 'no such request' });
      permissionWaiters.delete(parts[4]!);
      waiter(String(payload.decision));
      return send(res, 204);
    }
    default:
      return send(res, 404, { _tag: 'NotFound', message: `no route ${route}` });
  }
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address() as { port: number };
  log({ kind: 'start', cwd: process.cwd() });
  process.stdout.write(`server listening on http://127.0.0.1:${port}\n`);
});
const heartbeat = setInterval(() => {
  for (const res of streams) res.write(': heartbeat\n\n');
}, 200);
heartbeat.unref();
const stop = () => {
  log({ kind: 'exit' });
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
