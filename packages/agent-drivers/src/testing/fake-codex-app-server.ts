import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type { FakeCodexLogEntry, FakeCodexScenario } from './fake-codex.ts';

/**
 * 假 codex 的进程入口（见 `fake-codex.ts`）。由 node 直接运行，只用 Node 自带的模块。
 * 行为来自 `$FAKE_CODEX_DIR/scenario.json`，收到的消息记进 `$FAKE_CODEX_DIR/log.jsonl`。
 */

const dir = process.env.FAKE_CODEX_DIR;
if (!dir) {
  process.stderr.write('FAKE_CODEX_DIR 没有设置\n');
  process.exit(2);
}
const scenario = JSON.parse(fs.readFileSync(path.join(dir, 'scenario.json'), 'utf8')) as FakeCodexScenario;
const logFile = path.join(dir, 'log.jsonl');

function log(entry: Omit<FakeCodexLogEntry, 't' | 'pid'> & { t?: number }): void {
  fs.appendFileSync(logFile, `${JSON.stringify({ t: Date.now(), pid: process.pid, ...entry })}\n`);
}

const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write(`codex-cli ${scenario.version}\n`);
  process.exit(0);
}
if (args[0] === 'login' && args[1] === 'status') {
  log({ kind: 'login-status' });
  if (scenario.loggedIn) {
    process.stdout.write('Logged in using ChatGPT\n');
    process.exit(0);
  }
  process.stderr.write('Not logged in\n');
  process.exit(1);
}
if (args[0] !== 'app-server') {
  process.stderr.write(`假 codex 不支持：${args.join(' ')}\n`);
  process.exit(2);
}

type Message = { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown };

// 是会话还是探测取模型表，要等初始化之后的第一个请求才知道（见 `fake-codex.ts`）；启动时间先记下。
const startedAt = Date.now();
let role: 'session' | 'catalog' | null = null;
function classify(method: string | undefined): void {
  if (role || !method || method === 'initialize') return;
  role = method === 'model/list' ? 'catalog' : 'session';
  log({ kind: role === 'catalog' ? 'catalog-start' : 'start', t: startedAt, cwd: process.cwd() });
}

const send = (message: Message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const threadId = 'thr_fake';
let threadCwd = process.cwd();
let nextServerId = 1000;
let turnCount = 0;
const serverRequests = new Map<number | string, (message: Message) => void>();
let turn: { id: string; done: boolean; timer: ReturnType<typeof setTimeout> | null } | null = null;

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line) as Message;
  if (message.id !== undefined) classify(message.method);
  log({ kind: 'in', msg: message });
  if (message.method && message.id !== undefined) handleRequest(message);
  else if (message.id !== undefined) serverRequests.get(message.id)?.(message);
});
// BaoCut 关闭连接时先关 stdin：立即退出（不让它等到 SIGTERM）。
rl.on('close', () => {
  if (!role) classify('(closed)');
  log({ kind: role === 'catalog' ? 'catalog-exit' : 'exit' });
  process.exit(0);
});

function handleRequest(message: Message): void {
  const id = message.id!;
  const params = message.params ?? {};
  switch (message.method) {
    case 'initialize':
      send({ id, result: { userAgent: 'fake-codex' } });
      return;
    case 'thread/start':
      threadCwd = typeof params.cwd === 'string' ? params.cwd : threadCwd;
      send({ id, result: { thread: { id: threadId }, model: 'fake-model' } });
      return;
    case 'model/list': {
      if (scenario.models === 'hang') return;
      if (scenario.models === 'error') {
        send({ id, error: { code: -32603, message: 'failed to load models' } });
        return;
      }
      const all = params.includeHidden === true ? scenario.models : scenario.models.filter((m) => !m.hidden);
      const start = typeof params.cursor === 'string' ? Number(params.cursor) : 0;
      const end = start + 2;
      send({ id, result: { data: all.slice(start, end), nextCursor: end < all.length ? String(end) : null } });
      return;
    }
    case 'turn/steer': {
      const active = turn && !turn.done ? turn.id : null;
      if (scenario.steer === 'unsupported') send({ id, error: { code: -32601, message: 'method not found: turn/steer' } });
      else if (scenario.steer === 'error') send({ id, error: { code: -32603, message: 'internal error' } });
      else if (scenario.steer === 'no-active-turn' || !active) send({ id, error: { code: -32600, message: 'no active turn to steer' } });
      else if (params.expectedTurnId !== active) {
        send({ id, error: { code: -32600, message: `expected active turn id \`${String(params.expectedTurnId)}\` but found \`${active}\`` } });
      } else send({ id, result: { turnId: active } });
      return;
    }
    case 'turn/start': {
      const turnId = `turn_${++turnCount}`;
      turn = { id: turnId, done: false, timer: null };
      send({ id, result: { turn: { id: turnId, status: 'inProgress', error: null } } });
      send({ method: 'turn/started', params: { threadId, turn: { id: turnId, status: 'inProgress', error: null } } });
      void runTurn(turnId);
      return;
    }
    case 'turn/interrupt':
      send({ id, result: {} });
      if (turn && !turn.done) complete('interrupted');
      return;
    default:
      send({ id, error: { code: -32601, message: `假 codex 不支持 ${message.method}` } });
  }
}

async function runTurn(turnId: string): Promise<void> {
  const spec = scenario.turn;
  if (spec.askApproval) {
    const requestId = nextServerId++;
    await new Promise<void>((resolve) => {
      serverRequests.set(requestId, () => resolve());
      send({
        id: requestId,
        method: 'item/commandExecution/requestApproval',
        params: { threadId, turnId, itemId: 'item_cmd', command: 'curl https://example.com', cwd: threadCwd, reason: '需要联网' },
      });
    });
  }
  for (const error of spec.errors ?? []) {
    send({
      method: 'error',
      params: {
        threadId,
        turnId,
        willRetry: error.willRetry,
        error: { message: error.message, codexErrorInfo: error.codexErrorInfo ?? null, additionalDetails: null },
      },
    });
  }
  if (spec.status === 'hang') return;
  await new Promise<void>((resolve) => {
    turn!.timer = setTimeout(resolve, spec.delayMs ?? 0);
  });
  if (!turn || turn.done) return;
  for (const [name, base64] of Object.entries(spec.files ?? {})) {
    const file = path.join(threadCwd, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(base64, 'base64'));
  }
  if (spec.files && Object.keys(spec.files).length > 0) {
    const item = { type: 'imageGeneration', id: 'item_img', status: 'completed', revisedPrompt: 'fake', savedPath: null };
    send({ method: 'item/completed', params: { threadId, turnId, item } });
  }
  if (spec.reply) {
    send({ method: 'item/completed', params: { threadId, turnId, item: { type: 'agentMessage', id: 'item_msg', text: spec.reply } } });
  }
  complete(spec.status === 'failed' ? 'failed' : 'completed', spec.error, spec.errorInfo);
}

function complete(status: 'completed' | 'failed' | 'interrupted', error?: string, errorInfo?: unknown): void {
  if (!turn) return;
  turn.done = true;
  if (turn.timer) clearTimeout(turn.timer);
  const failure = status === 'failed' ? { message: error ?? 'failed', codexErrorInfo: errorInfo ?? null, additionalDetails: null } : null;
  send({ method: 'turn/completed', params: { threadId, turn: { id: turn.id, status, error: failure } } });
}
