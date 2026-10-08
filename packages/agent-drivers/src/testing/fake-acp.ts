import fs from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AcpInstall } from '../acp/acp-binary.ts';

/**
 * 测试用的假 ACP 智能体：一个可执行文件，回答 `--version`，带别的参数时在 stdio 上说 ACP（JSON 行上的 JSON-RPC）。
 * 它不联网、不碰本机真实的智能体；收到的每条消息记进 `log.jsonl`，测试据此核对会话参数（工作目录、MCP 服务、模式、模型、
 * 输入）与审批的答复。
 *
 * 用法：`createFakeAcp(dir)` 得到 `locate`，交给 `new AcpDriver('gemini', log, { locate })`；`scenario()` 改下一次的行为
 * （每个进程启动时读一次）。
 */

/** 一个回合里智能体做什么。 */
export interface FakeAcpTurn {
  /** 先发的思考。 */
  thought?: string;
  /** 计划条目。 */
  plan?: string[];
  /** 一次工具调用。 */
  tool?: {
    kind: string;
    title: string;
    rawInput?: unknown;
    locations?: string[];
    output?: string;
    /** `tool_call` 带的 `diff` 内容块（claude-code-acp 这样给：完成的更新里不再带内容）。 */
    diffs?: Array<{ path: string; oldText: string | null; newText: string }>;
  };
  /** 工具执行之前来问几次（同一类工具连续几次，用来测「本会话放行」）；0 不问。 */
  ask?: number;
  /** 文字回复（分两段发）。 */
  reply?: string;
  /** 一直不结束，直到收到 `session/cancel`。 */
  hang?: boolean;
  /** `session/prompt` 回这个错误。 */
  error?: { code: number; message: string };
}

export interface FakeAcpScenario {
  /** false：`locate` 返回 null（没有安装）。 */
  installed: boolean;
  version: string;
  /** false：`session/new` 与 `session/load` 回 -32000（需要登录）。 */
  loggedIn: boolean;
  loadSession: boolean;
  /** `sessionCapabilities.resume`。 */
  resume: boolean;
  /** `session/load` 回错误。 */
  loadFails: boolean;
  mcpHttp: boolean;
  image: boolean;
  /** 会话模式；null 不给 `modes`。`config`：改用分类为 mode 的配置项。 */
  modes: string[] | null;
  modesVia: 'modes' | 'config';
  /** 给一个 Copilot 那样的「全部放行」配置项（`allow_all`，on / off，初始 off）。 */
  allowAll: boolean;
  /** 模型表的来源：旧版 `models`、分类为 model 的配置项，或没有。 */
  models: 'legacy' | 'config' | 'none';
  /** 回答 `cursor/list_available_models`。 */
  cursorModels: boolean;
  turn: FakeAcpTurn;
}

export interface FakeAcpLogEntry {
  t: number;
  pid: number;
  kind: 'start' | 'in' | 'exit';
  cwd?: string;
  args?: string[];
  env?: Record<string, string | undefined>;
  msg?: { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: unknown };
}

export interface FakeAcp {
  dir: string;
  locate: () => Promise<AcpInstall | null>;
  scenario(patch: Partial<FakeAcpScenario>): void;
  log(): FakeAcpLogEntry[];
  /** 收到的某个方法的请求或通知参数，按到达顺序。 */
  requests(method: string): Array<{ pid: number; params: Record<string, unknown> }>;
  /** BaoCut 对审批请求的答复（`outcome`），按到达顺序。 */
  permissionAnswers(): Array<{ outcome: string; optionId?: string }>;
}

const DEFAULT_SCENARIO: FakeAcpScenario = {
  installed: true,
  version: '0.46.0',
  loggedIn: true,
  loadSession: true,
  resume: false,
  loadFails: false,
  mcpHttp: true,
  image: true,
  modes: ['default', 'autoEdit', 'yolo', 'plan'],
  modesVia: 'modes',
  allowAll: false,
  models: 'legacy',
  cursorModels: false,
  turn: { reply: 'done' },
};

const ENTRY = fileURLToPath(new URL('./fake-acp-agent.ts', import.meta.url));

export async function createFakeAcp(dir: string, scenario: Partial<FakeAcpScenario> = {}): Promise<FakeAcp> {
  await fs.mkdir(dir, { recursive: true });
  const command = path.join(dir, 'fake-acp');
  // 假智能体是 .ts：22.18 之前的 Node 要显式打开类型剥离；环境被收窄过，不能靠 NODE_OPTIONS。
  await fs.writeFile(command, `#!/bin/sh\nexec "${process.execPath}" --experimental-strip-types --no-warnings "${ENTRY}" "$@"\n`, {
    mode: 0o755,
  });
  const scenarioFile = path.join(dir, 'scenario.json');
  const logFile = path.join(dir, 'log.jsonl');
  let current: FakeAcpScenario = { ...DEFAULT_SCENARIO, ...scenario };
  const write = () => writeFileSync(scenarioFile, JSON.stringify(current));
  write();
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin', FAKE_ACP_DIR: dir };

  const log = (): FakeAcpLogEntry[] => {
    let text = '';
    try {
      text = readFileSync(logFile, 'utf8');
    } catch {
      return [];
    }
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as FakeAcpLogEntry);
  };

  return {
    dir,
    locate: async () => (current.installed ? { command, version: current.version, env } : null),
    scenario(patch) {
      current = { ...current, ...patch };
      write();
    },
    log,
    requests(method) {
      return log()
        .filter((e) => e.kind === 'in' && e.msg?.method === method)
        .map((e) => ({ pid: e.pid, params: (e.msg!.params ?? {}) as Record<string, unknown> }));
    },
    permissionAnswers() {
      return log()
        .filter((e) => e.kind === 'in' && !e.msg?.method && (e.msg?.result as { outcome?: unknown } | undefined)?.outcome)
        .map((e) => (e.msg!.result as { outcome: { outcome: string; optionId?: string } }).outcome);
    },
  };
}
