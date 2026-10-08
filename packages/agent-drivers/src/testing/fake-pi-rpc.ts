import fs from 'node:fs';
import path from 'node:path';
import type { FakePiLogEntry, FakePiScenario, FakePiTool } from './fake-pi.ts';

/**
 * 假 `pi --mode rpc` 的进程入口（见 `fake-pi.ts`）。只用 Node 自带的模块；线上的形状照 pi 1.0.4 的真实输出手写，
 * 免得测试与实现共用同一份理解。
 */

const dir = process.env.FAKE_PI_DIR;
if (!dir) {
  process.stderr.write('FAKE_PI_DIR 没有设置\n');
  process.exit(2);
}
const scenario = JSON.parse(fs.readFileSync(path.join(dir, 'scenario.json'), 'utf8')) as FakePiScenario;
const logFile = path.join(dir, 'log.jsonl');

function log(entry: Omit<FakePiLogEntry, 't' | 'pid'>): void {
  fs.appendFileSync(logFile, `${JSON.stringify({ t: Date.now(), pid: process.pid, ...entry })}\n`);
}

const args = process.argv.slice(2);
if (args[0] === '--version' || args[0] === '-v') {
  process.stdout.write(`${scenario.version}\n`);
  process.exit(0);
}
const flag = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? null) : null;
};
const read = (file: string | null) => (file ? fs.readFileSync(file, 'utf8') : undefined);
log({
  kind: 'start',
  cwd: process.cwd(),
  args,
  env: { PI_SKIP_VERSION_CHECK: process.env.PI_SKIP_VERSION_CHECK },
  extension: read(flag('--extension')),
  instructions: read(flag('--append-system-prompt')),
});
process.on('exit', (code) => log({ kind: 'exit', msg: { code } }));

if (scenario.crashOnStart) {
  process.stderr.write('Error: fake pi failed to start\n');
  process.exit(1);
}

type Msg = Record<string, unknown>;
function send(message: Msg): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
function respond(id: unknown, command: string, data?: unknown): void {
  send({ id, type: 'response', command, success: true, ...(data === undefined ? {} : { data }) });
}
function fail(id: unknown, command: string, error: string): void {
  send({ id, type: 'response', command, success: false, error });
}

const resumed = flag('--session');
const sessionId = resumed ? path.basename(resumed, '.jsonl') : `sess-${process.pid}`;
const sessionFile = args.includes('--no-session') ? undefined : (resumed ?? path.join(dir, 'sessions', `${sessionId}.jsonl`));
let model = scenario.current
  ? (scenario.models.find((m) => m.provider === scenario.current!.provider && m.id === scenario.current!.id) ?? { ...scenario.current })
  : { provider: 'unknown', id: 'unknown' };
let thinkingLevel = 'medium';
let streaming = false;
let abort: (() => void) | null = null;
const pendingUi = new Map<string, (answer: Msg) => void>();

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  let nl = buffer.indexOf('\n');
  while (nl !== -1) {
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    if (line.trim()) handle(JSON.parse(line) as Msg);
    nl = buffer.indexOf('\n');
  }
});
process.stdin.on('end', () => process.exit(0));
// 混进一行不是 JSON 的输出：BaoCut 应该忽略它。
process.stdout.write('pi: starting up\n');

function handle(message: Msg): void {
  log({ kind: 'in', msg: message });
  const { id, type } = message as { id?: unknown; type: string };
  switch (type) {
    case 'get_state':
      return respond(id, type, { model, thinkingLevel, isStreaming: streaming, sessionFile, sessionId, messageCount: 0 });
    case 'get_available_models':
      return respond(id, type, { models: scenario.models });
    case 'set_model': {
      const found = scenario.models.find((m) => m.provider === message.provider && m.id === message.modelId);
      if (!found) return fail(id, type, `Model not found: ${String(message.provider)}/${String(message.modelId)}`);
      model = found;
      return respond(id, type, found);
    }
    case 'set_thinking_level':
      thinkingLevel = String(message.level);
      return respond(id, type);
    case 'prompt':
      if (streaming) return fail(id, type, 'Agent is already processing.');
      if (scenario.turn.promptError) return fail(id, type, scenario.turn.promptError);
      respond(id, type, { disposition: 'started' });
      void runTurn(String(message.message ?? ''));
      return;
    case 'steer':
    case 'clear_queue':
      if (!scenario.steer) return fail(id, type, `Unknown command: ${type}`);
      return respond(id, type, type === 'steer' ? { disposition: 'queued' } : { steering: [], followUp: [] });
    case 'abort':
      if (abort) {
        const done = abort;
        abort = null;
        // abort 等 pi 空闲下来才应答。
        void Promise.resolve(done()).then(() => respond(id, type));
      } else respond(id, type);
      return;
    case 'extension_ui_response': {
      const answer = pendingUi.get(String(message.id));
      pendingUi.delete(String(message.id));
      answer?.(message);
      return;
    }
    default:
      return fail(id, type, `Unknown command: ${type}`);
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
let seq = 0;

function assistant(content: unknown[], stopReason: string, errorMessage?: string): Msg {
  return { role: 'assistant', content, provider: model.provider, model: model.id, stopReason, ...(errorMessage ? { errorMessage } : {}) };
}

async function streamBlock(index: number, kind: 'text' | 'thinking', text: string): Promise<void> {
  send({ type: 'message_update', assistantMessageEvent: { type: `${kind}_start`, contentIndex: index } });
  const half = Math.ceil(text.length / 2);
  for (const piece of [text.slice(0, half), text.slice(half)].filter(Boolean)) {
    send({ type: 'message_update', assistantMessageEvent: { type: `${kind}_delta`, contentIndex: index, delta: piece } });
    await tick();
  }
  send({ type: 'message_update', assistantMessageEvent: { type: `${kind}_end`, contentIndex: index, content: text } });
}

async function toolStep(tool: FakePiTool): Promise<void> {
  const callId = `call_${seq++}`;
  send({ type: 'turn_start' });
  const call = { type: 'toolCall', id: callId, name: tool.name, arguments: tool.args };
  send({ type: 'message_start', message: assistant([], 'pending') });
  send({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_start', contentIndex: 0, id: callId, toolName: tool.name } });
  send({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_end', contentIndex: 0, toolCall: call } });
  send({ type: 'message_end', message: assistant([call], 'toolUse') });
  send({ type: 'tool_execution_start', toolCallId: callId, toolName: tool.name, args: tool.args });
  if (tool.partial) {
    send({ type: 'tool_execution_update', toolCallId: callId, toolName: tool.name, args: tool.args, partialResult: { content: [] } });
    send({
      type: 'tool_execution_update',
      toolCallId: callId,
      toolName: tool.name,
      args: tool.args,
      partialResult: { content: [{ type: 'text', text: tool.partial }], details: {} },
    });
  }
  await tick();
  send({ type: 'tool_execution_end', toolCallId: callId, toolName: tool.name, result: tool.result, isError: tool.isError === true });
  send({ type: 'message_start', message: { role: 'toolResult', toolCallId: callId, toolName: tool.name, isError: tool.isError === true } });
  send({ type: 'message_end', message: { role: 'toolResult', toolCallId: callId, toolName: tool.name, isError: tool.isError === true } });
  send({ type: 'turn_end', message: assistant([call], 'toolUse') });
}

function ask(): Promise<Msg> {
  const uiId = `ui_${seq++}`;
  return new Promise((resolve) => {
    pendingUi.set(uiId, resolve);
    send({ type: 'extension_ui_request', id: uiId, method: 'confirm', title: 'Allow?', message: 'Run it?' });
  });
}

async function runTurn(text: string): Promise<void> {
  const turn = scenario.turn;
  streaming = true;
  send({ type: 'agent_start' });
  send({ type: 'turn_start' });
  const user = { role: 'user', content: [{ type: 'text', text }] };
  send({ type: 'message_start', message: user });
  send({ type: 'message_end', message: user });
  if (turn.exitMidTurn) {
    send({ type: 'message_start', message: assistant([], 'pending') });
    await streamBlock(0, 'text', 'partial');
    process.stderr.write('fatal: fake pi crashed\n');
    process.exit(3);
  }
  if (turn.ask) await ask();
  let stop = 'stop';
  if (turn.hang) {
    const callId = `call_${seq++}`;
    const args = { command: 'sleep 100' };
    send({ type: 'message_start', message: assistant([], 'pending') });
    await streamBlock(0, 'text', 'working');
    send({ type: 'message_end', message: assistant([{ type: 'text', text: 'working' }], 'toolUse') });
    send({ type: 'tool_execution_start', toolCallId: callId, toolName: 'bash', args });
    await new Promise<void>((resolve) => {
      abort = () => {
        send({
          type: 'tool_execution_end',
          toolCallId: callId,
          toolName: 'bash',
          result: { content: [{ type: 'text', text: 'Command aborted' }] },
          isError: true,
        });
        resolve();
      };
    });
    send({ type: 'turn_end' });
    send({ type: 'turn_start' });
    stop = 'aborted';
    send({ type: 'message_start', message: assistant([], 'pending') });
    send({ type: 'message_end', message: assistant([], 'aborted', 'Request was aborted') });
  } else {
    for (const tool of turn.tools ?? []) await toolStep(tool);
    if (turn.tools?.length) send({ type: 'turn_start' });
    send({ type: 'message_start', message: assistant([], 'pending') });
    const content: unknown[] = [];
    let index = 0;
    if (turn.thinking) {
      await streamBlock(index++, 'thinking', turn.thinking);
      content.push({ type: 'thinking', thinking: turn.thinking });
    }
    if (turn.reply) {
      await streamBlock(index++, 'text', turn.reply);
      content.push({ type: 'text', text: turn.reply });
    }
    if (turn.error) stop = 'error';
    send({ type: 'message_end', message: assistant(content, stop, turn.error) });
  }
  send({ type: 'turn_end' });
  if (sessionFile && !fs.existsSync(sessionFile)) fs.writeFileSync(sessionFile, `${JSON.stringify({ type: 'session', id: sessionId })}\n`);
  streaming = false;
  // 1.0.4 的 agent_end 不带 willRetry。
  send({ type: 'agent_end', messages: [] });
  if (scenario.settled) send({ type: 'agent_settled' });
}
