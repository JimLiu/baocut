import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { silentLogger, type AgentEvent, type AgentSession } from '@baocut/harness';
import { AcpDriver } from './acp-driver.ts';

/**
 * 真 agy 的 ACP 协议验收（D08）：显式给官方二进制路径（`BAOCUT_ANTIGRAVITY_TEST_BINARY`）才运行；假 API 密钥 + 回环模型服务，
 * 不用用户的账号。HOME、配置、工程与日志全在临时目录，测试结束删除。模型应答按 Gemini 的 functionCall 格式驱动真实工具
 * （1.5.14 的 `run_command` 只收 `CommandLine`、`WaitMsBeforeAsync`、`toolSummary`）。
 */
const binary = process.env.BAOCUT_ANTIGRAVITY_TEST_BINARY;
const waitFor = async <T>(read: () => Promise<T | undefined> | T | undefined, ms = 20_000): Promise<T> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const result = await read();
    if (result !== undefined) return result;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('Antigravity ACP test timed out');
};

it.skipIf(!binary || process.platform === 'win32')('real agy acp: MCP channel, system prompt, approvals, image, interrupt, resume, and legacy handles', async () => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-agy-acp-test-')));
  const home = path.join(dir, 'home');
  const cwd = path.join(dir, 'workspace');
  await fs.mkdir(path.join(home, '.gemini/antigravity-cli'), { recursive: true });
  await fs.mkdir(cwd);
  await fs.writeFile(path.join(home, '.gemini/antigravity-cli/settings.json'), JSON.stringify({ modelProvider: 'gemini' }));
  const image = path.join(cwd, 'image.png');
  await fs.writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYQAAAABJRU5ErkJggg==', 'base64'));
  const pidFile = path.join(cwd, 'child.pid');

  // 回环模型服务：带工具的请求按 plan 依次回 functionCall，其余回文字。
  let plan: Array<{ name: string; args: Record<string, unknown> }> = [];
  const seen: Array<{ system: string; contents: string; body: string; tools: string[] }> = [];
  const model = http.createServer(async (req, res) => {
    if (req.method === 'GET') return void res.end(JSON.stringify({ models: [] }));
    let source = '';
    for await (const chunk of req) source += chunk;
    const body = JSON.parse(source) as { tools?: Array<{ functionDeclarations?: Array<{ name: string }> }>; systemInstruction?: unknown; contents?: unknown };
    const tools = (body.tools ?? []).flatMap((t) => (t.functionDeclarations ?? []).map((d) => d.name));
    seen.push({ system: JSON.stringify(body.systemInstruction ?? ''), contents: JSON.stringify(body.contents ?? []), body: source, tools });
    const call = body.tools ? plan.shift() : undefined;
    const parts = call ? [{ functionCall: call }] : [{ text: 'BAOCUT_ACP_OK' }];
    const data = { candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 } };
    const stream = req.url?.includes('streamGenerateContent');
    res.writeHead(200, { 'Content-Type': stream ? 'text/event-stream' : 'application/json' });
    res.end(stream ? `data: ${JSON.stringify(data)}\n\n` : JSON.stringify(data));
  });
  // 最小的 Streamable HTTP MCP 服务，代表 BaoCut 的工具通道：核对令牌头，记下工具调用。
  const mcpCalls: Array<{ auth: string | undefined; method: string; name?: string }> = [];
  const mcp = http.createServer(async (req, res) => {
    let source = '';
    for await (const chunk of req) source += chunk;
    if (req.method !== 'POST') return void res.writeHead(405).end();
    const msg = JSON.parse(source) as { id?: number; method: string; params?: { name?: string; protocolVersion?: string } };
    mcpCalls.push({ auth: req.headers.authorization, method: msg.method, name: msg.params?.name });
    if (msg.id === undefined) return void res.writeHead(202).end();
    const result =
      msg.method === 'initialize'
        ? { protocolVersion: msg.params?.protocolVersion ?? '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'baocut', version: '1' } }
        : msg.method === 'tools/list'
          ? { tools: [{ name: 'baocut_ping', description: 'Ping BaoCut.', inputSchema: { type: 'object', properties: {} } }] }
          : msg.method === 'tools/call'
            ? { content: [{ type: 'text', text: 'BAOCUT_MCP_PONG' }] }
            : {};
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'baocut-test' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
  });
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => mcp.listen(0, '127.0.0.1', resolve));
  const env = {
    HOME: home,
    PATH: process.env.PATH,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_DATA_HOME: path.join(home, '.local/share'),
    GEMINI_API_KEY: 'baocut-test-dummy',
    GOOGLE_GEMINI_BASE_URL: `http://127.0.0.1:${(model.address() as { port: number }).port}`,
    BROWSER: '/usr/bin/true',
  };
  const mcpServers = { baocut: { url: `http://127.0.0.1:${(mcp.address() as { port: number }).port}/mcp`, headers: { Authorization: 'Bearer baocut-test-token' } } };
  const { stdout: version } = await promisify(execFile)(binary!, ['--version'], { env, timeout: 10_000 });
  const driver = new AcpDriver('antigravity', silentLogger, { locate: async () => ({ command: binary!, version: version.trim(), env }) });
  const sessions: AgentSession[] = [];
  const open = async (resume: Parameters<typeof driver.createSession>[0]['resume'], accessMode: 'ask' | 'fullAccess' = 'ask') => {
    const session = await driver.createSession({ cwd, accessMode, model: null, effort: null, resume, mcpServers, developerInstructions: 'BAOCUT_SYSTEM_MARKER' });
    sessions.push(session);
    const events: AgentEvent[] = [];
    session.subscribe((e) => events.push(e));
    const completed = (turnId: string) => waitFor(() => events.find((e) => e.type === 'turn.completed' && e.turnId === turnId));
    const approved = async (n: number) => {
      const asked = await waitFor(() => events.filter((e): e is Extract<AgentEvent, { type: 'approval.requested' }> => e.type === 'approval.requested')[n - 1]);
      await session.respondToApproval(asked.approvalId, { decision: 'accept' });
      return asked;
    };
    return { session, events, completed, approved };
  };
  const settings = { accessMode: 'ask', model: null, effort: null } as const;
  try {
    const probe = await driver.probe();
    expect(probe.state).toBe('ready');
    expect(probe.models.length).toBeGreaterThan(0);

    // 新会话：BaoCut 的 MCP 服务连上、指令进系统提示一次；审批后执行命令；图片随输入交给模型。
    const a = await open(null);
    expect(a.session.capabilities).toMatchObject({ approvals: true, resume: true, images: true });
    await waitFor(() => mcpCalls.find((c) => c.method === 'tools/list'));
    expect(mcpCalls.every((c) => c.auth === 'Bearer baocut-test-token')).toBe(true);
    plan = [{ name: 'run_command', args: { CommandLine: 'printf BAOCUT_COMMAND > out.txt', WaitMsBeforeAsync: 1000, toolSummary: 'BaoCut protocol test' } }];
    const first = await a.session.startTurn({ text: 'Run the protocol test.', images: [{ path: image, mimeType: 'image/png' }] }, settings);
    const asked = await a.approved(1);
    expect(asked.request).toMatchObject({ kind: 'command' });
    await a.completed(first.turnId);
    expect(await fs.readFile(path.join(cwd, 'out.txt'), 'utf8')).toBe('BAOCUT_COMMAND');
    expect(seen.some((s) => s.body.includes('inlineData'))).toBe(true);
    const system = seen.at(-1)!.system;
    expect(system.split('BAOCUT_SYSTEM_MARKER')).toHaveLength(2);
    expect(seen.every((s) => !s.contents.includes('BAOCUT_SYSTEM_MARKER'))).toBe(true);

    // BaoCut 的工具：名字取模型请求里登记的那个，模型调用后经 MCP 服务回到智能体。
    const mcpTool = seen.at(-1)!.tools.find((name) => name.includes('baocut_ping'));
    expect(mcpTool).toBeTruthy();
    // agy 给每个工具（MCP 的也一样）都加了必填的 `toolSummary`。
    plan = [{ name: mcpTool!, args: { toolSummary: 'BaoCut tool test' } }];
    const tool = await a.session.startTurn({ text: 'Call the BaoCut tool.' }, settings);
    await a.completed(tool.turnId);
    // 原生侧来问时 Driver 认出是 BaoCut 自己的工具，直接放行，不出审批卡（由工具通道按访问模式把关）。
    expect(a.events.filter((e) => e.type === 'approval.requested' && e.turnId === tool.turnId)).toHaveLength(0);
    expect(mcpCalls).toContainEqual(expect.objectContaining({ method: 'tools/call', name: 'baocut_ping' }));
    expect(seen.at(-1)!.contents).toContain('BAOCUT_MCP_PONG');

    // 中断：命令放行后挂住，中断回合并让命令的子进程结束。
    plan = [{ name: 'run_command', args: { CommandLine: `sleep 60 & printf '%s' "$!" > '${pidFile}'; wait`, WaitMsBeforeAsync: 10000, toolSummary: 'BaoCut interrupt test' } }];
    const approvals = a.events.filter((e) => e.type === 'approval.requested').length;
    const hanging = await a.session.startTurn({ text: 'Start the interrupt test.' }, settings);
    await a.approved(approvals + 1);
    const pid = await waitFor(async () => {
      try {
        return Number(await fs.readFile(pidFile, 'utf8')) || undefined;
      } catch {
        return undefined;
      }
    });
    await a.session.interrupt(hanging.turnId);
    expect(await a.completed(hanging.turnId)).toMatchObject({ outcome: 'interrupted' });
    await waitFor(() => {
      try {
        process.kill(pid, 0);
        return undefined;
      } catch {
        return true;
      }
    });
    plan = [];
    const after = await a.session.startTurn({ text: 'Continue after interruption.' }, settings);
    expect(await a.completed(after.turnId)).toMatchObject({ outcome: 'completed' });
    const handle = a.session.describePersistence();
    await a.session.close();

    // 恢复：系统提示随会话保存，不再追加一份。
    const b = await open(handle, 'fullAccess');
    const resumed = await b.session.startTurn({ text: 'Resume after close.' }, { ...settings, accessMode: 'fullAccess' });
    expect(await b.completed(resumed.turnId)).toMatchObject({ outcome: 'completed' });
    expect(seen.at(-1)!.system.split('BAOCUT_SYSTEM_MARKER')).toHaveLength(2);
    await b.session.close();

    // 旧的原生句柄（版本 1 + conversationId）：用 session/load 打开原生 stream-json 留下的会话，模型看得到之前的内容。
    const native = spawn(binary!, ['--input-format', 'stream-json', '--output-format', 'stream-json', '--add-dir', cwd, '--disable-slash-commands', '--dangerously-skip-permissions'], { cwd, env });
    let out = '';
    native.stdout.on('data', (d) => (out += d));
    native.stdin.write(JSON.stringify({ event: 'user', message: { content: 'Remember BAOCUT_NATIVE_WORD.' } }) + '\n');
    const conversationId = await waitFor(() => /"conversation_id":"([^"]+)"/.exec(out)?.[1]);
    await waitFor(() => (seen.some((s) => s.body.includes('BAOCUT_NATIVE_WORD')) && out.includes('BAOCUT_ACP_OK') ? true : undefined));
    native.kill('SIGKILL');
    const c = await open({ driverId: 'antigravity', data: { version: 1, conversationId } }, 'fullAccess');
    const legacy = await c.session.startTurn({ text: 'What word?' }, { ...settings, accessMode: 'fullAccess' });
    expect(await c.completed(legacy.turnId)).toMatchObject({ outcome: 'completed' });
    expect(seen.at(-1)!.contents).toContain('BAOCUT_NATIVE_WORD');
    expect(c.session.describePersistence()).toMatchObject({ driverId: 'antigravity', data: { sessionId: conversationId } });
  } finally {
    await Promise.all(sessions.map((s) => s.close().catch(() => undefined)));
    for (const server of [model, mcp]) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
}, 120_000);
