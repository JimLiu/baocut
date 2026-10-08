import fs from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CodexInstall } from '../codex/codex-binary.ts';
import type { CodexErrorInfo, CodexModel } from '../codex/codex-protocol.ts';

/**
 * 测试用的假 codex：一个可执行文件，回答 `--version`、`login status` 与 `app-server`（stdio 上的 JSON 行，形状同
 * `codex-protocol.ts`）。它不联网、不读 `~/.codex`（`CODEX_HOME` 指向 `<dir>/codex-home`）、不碰本机真实的 codex；
 * 收到的每条消息记进 `log.jsonl`，测试据此核对会话的参数（工作目录、沙箱、有没有 MCP 服务、输入）与关闭。
 *
 * 探测取模型表也会起 app-server：这种进程（初始化之后第一个请求是 `model/list`）记成 `catalog-start` / `catalog-exit`，
 * 不算会话；会话进程照旧记 `start` / `exit`（`t` 是进程启动的时间）。
 *
 * 用法：`createFakeCodex(dir)` 得到 `locate`，交给 `new CodexDriver(log, { locate })`；`scenario()` 改下一次的行为。
 */

/** 一个回合怎么结束。 */
export interface FakeCodexTurn {
  /** 回合开始后等多久再写文件、结束（毫秒）。 */
  delayMs?: number;
  /** 写进会话工作目录的文件：相对路径 → base64 内容。 */
  files?: Record<string, string>;
  /** 智能体的文字回复。 */
  reply?: string;
  /** `hang`：一直不结束，直到收到 `turn/interrupt`。 */
  status?: 'completed' | 'failed' | 'hang';
  /** `failed` 时的错误说明。 */
  error?: string;
  /** `failed` 时错误里的结构化原因（`codexErrorInfo`）。 */
  errorInfo?: CodexErrorInfo;
  /** 回合里先发一个命令审批请求（越界的网络命令），记下 BaoCut 的答复。 */
  askApproval?: boolean;
  /** 回合里（结束之前）发的 `error` 通知。 */
  errors?: Array<{ message: string; codexErrorInfo?: CodexErrorInfo | null; willRetry: boolean }>;
}

export interface FakeCodexScenario {
  /** false：`locate` 返回 null（没有安装）。 */
  installed: boolean;
  version: string;
  loggedIn: boolean;
  turn: FakeCodexTurn;
  /** `model/list` 的模型表（每页 2 个，带游标分页）；`error`：回 -32603；`hang`：一直不应答。 */
  models: CodexModel[] | 'error' | 'hang';
  /**
   * `turn/steer`：`accept` 有活动回合时接受（没有时回 -32600 `no active turn to steer`，同真实的 codex）；
   * `no-active-turn` 一律那样拒绝；`unsupported` 回 -32601；`error` 回 -32603（说不清送没送到）。
   */
  steer: 'accept' | 'no-active-turn' | 'unsupported' | 'error';
}

export interface FakeCodexLogEntry {
  t: number;
  pid: number;
  kind: 'login-status' | 'start' | 'in' | 'exit' | 'catalog-start' | 'catalog-exit';
  cwd?: string;
  msg?: { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: unknown };
}

export interface FakeCodex {
  dir: string;
  /** 给假 codex 的 `CODEX_HOME`（一开始是空目录）；测试在这里写 `config.toml`。 */
  codexHome: string;
  locate: () => Promise<CodexInstall | null>;
  scenario(patch: Partial<FakeCodexScenario>): void;
  log(): FakeCodexLogEntry[];
  /** 收到的某个方法的请求参数，按到达顺序。 */
  requests(method: string): Array<{ pid: number; t: number; params: Record<string, unknown> }>;
}

const DEFAULT_SCENARIO: FakeCodexScenario = {
  installed: true,
  version: '0.160.0',
  loggedIn: true,
  turn: { status: 'completed', reply: 'done' },
  models: [
    fakeModel('fake-sol', { isDefault: true, description: 'Balanced workhorse.' }),
    fakeModel('fake-luna', { description: 'Fast and light.' }),
    fakeModel('fake-hidden', { hidden: true }),
  ],
  steer: 'accept',
};

/** 一个 `model/list` 里的模型；没给的字段取常见的值。 */
export function fakeModel(id: string, patch: Partial<CodexModel> = {}): CodexModel {
  return {
    id,
    model: id,
    displayName: id.toUpperCase(),
    description: '',
    hidden: false,
    isDefault: false,
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Fast' },
      { reasoningEffort: 'medium', description: 'Balanced' },
      { reasoningEffort: 'high', description: 'Deep' },
    ],
    defaultReasoningEffort: 'medium',
    ...patch,
  };
}

const ENTRY = fileURLToPath(new URL('./fake-codex-app-server.ts', import.meta.url));

export async function createFakeCodex(dir: string, scenario: Partial<FakeCodexScenario> = {}): Promise<FakeCodex> {
  await fs.mkdir(dir, { recursive: true });
  const command = path.join(dir, 'codex');
  // 假 codex 是 .ts：22.18 之前的 Node 要显式打开类型剥离（之后默认打开，这个标志无害）；环境被收窄过，不能靠 NODE_OPTIONS。
  await fs.writeFile(command, `#!/bin/sh\nexec "${process.execPath}" --experimental-strip-types --no-warnings "${ENTRY}" "$@"\n`, { mode: 0o755 });
  const scenarioFile = path.join(dir, 'scenario.json');
  const logFile = path.join(dir, 'log.jsonl');
  let current: FakeCodexScenario = { ...DEFAULT_SCENARIO, ...scenario };
  const write = () => writeFileSync(scenarioFile, JSON.stringify(current));
  write();
  const codexHome = path.join(dir, 'codex-home');
  await fs.mkdir(codexHome, { recursive: true });
  // 只给假 codex 它需要的环境：PATH（找 node 不靠它，但 shell 要）、它自己的目录与 CODEX_HOME（Driver 读 config.toml 用，不碰 ~/.codex）。
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin', FAKE_CODEX_DIR: dir, CODEX_HOME: codexHome };

  const log = (): FakeCodexLogEntry[] => {
    let text = '';
    try {
      text = readFileSync(logFile, 'utf8');
    } catch {
      return [];
    }
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as FakeCodexLogEntry);
  };

  return {
    dir,
    codexHome,
    locate: async () => (current.installed ? { command, version: current.version, env } : null),
    scenario(patch) {
      current = { ...current, ...patch };
      write();
    },
    log,
    requests(method) {
      return log()
        .filter((e) => e.kind === 'in' && e.msg?.method === method && e.msg.id !== undefined)
        .map((e) => ({ pid: e.pid, t: e.t, params: (e.msg!.params ?? {}) as Record<string, unknown> }));
    },
  };
}
