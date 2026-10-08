import fs from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpenCodeInstall } from '../opencode/opencode-binary.ts';
import type { OpenCodeModel, OpenCodeProvider } from '../opencode/opencode-models.ts';

/**
 * 测试用的假 opencode：一个可执行文件，回答 `--version` 与 `serve`（形状同 OpenCode 2.x 的 v2 HTTP API，见
 * fake-opencode-server.ts）。不联网、不碰本机真实的 opencode；收到的每个请求记进 `log.jsonl`。
 *
 * 用法：`createFakeOpenCode(dir)` 得到 `locate`，交给 `new OpenCodeDriver(log, { locate })`；`scenario()` 改之后起的
 * 进程的行为（serve 在启动时读场景）。
 */

export interface FakeOpenCodeTool {
  name: string;
  input: Record<string, unknown>;
  /** 执行前先来要权限（`permission.asked`），等 BaoCut 答复。 */
  permission?: { action: string; resources: string[]; metadata?: Record<string, unknown> };
  output?: string;
  metadata?: Record<string, unknown>;
}

/** 一轮怎么走。 */
export interface FakeOpenCodeTurn {
  delayMs?: number;
  reasoning?: string;
  tool?: FakeOpenCodeTool;
  reply?: string;
  /** `hang`：一直不结束，直到收到中断。 */
  end?: 'succeeded' | 'failed' | 'hang';
  error?: string;
  /** 执行开始后进程直接退出（意外退出）。 */
  crash?: boolean;
}

export interface FakeOpenCodeScenario {
  installed: boolean;
  /** `--version` 的输出：2.x 是 `opencode v2.0.24`，1.x 是 `1.18.34`。 */
  versionOutput: string;
  models: OpenCodeModel[];
  defaultModel: string | null;
  providers: OpenCodeProvider[];
  /** 冷启动：前几次 `/api/plugin` 回空表。 */
  coldPluginCalls: number;
  catalog: 'ok' | 'error';
  /** 登记的 MCP 服务最后的状态。 */
  mcp: 'connected' | 'failed';
  /** 会话的 instructions 条目接口在不在。 */
  instructions: 'ok' | 'missing';
  turn: FakeOpenCodeTurn;
}

export interface FakeOpenCodeLogEntry {
  t: number;
  pid: number;
  kind: 'start' | 'exit' | 'request' | 'crash';
  cwd?: string;
  method?: string;
  path?: string;
  location?: string | null;
  body?: Record<string, unknown>;
}

export interface FakeOpenCode {
  dir: string;
  command: string;
  locate: () => Promise<OpenCodeInstall | null>;
  scenario(patch: Partial<FakeOpenCodeScenario>): void;
  log(): FakeOpenCodeLogEntry[];
  /** 某个方法与路径（路径里的会话 id 写成 `:id`）的请求，按到达顺序。 */
  requests(method: string, route: string): FakeOpenCodeLogEntry[];
}

const DEFAULT_SCENARIO: FakeOpenCodeScenario = {
  installed: true,
  versionOutput: 'opencode v2.0.24',
  models: [
    {
      id: 'big-pickle',
      providerID: 'opencode',
      name: 'Big Pickle',
      enabled: true,
      status: 'active',
      capabilities: { input: ['text'] },
      variants: [],
    },
    {
      id: 'fledge-alpha-free',
      providerID: 'opencode',
      name: 'Fledge Alpha Free',
      enabled: true,
      status: 'active',
      capabilities: { input: ['text', 'image'] },
      variants: [{ id: 'low' }, { id: 'high' }, { id: 'max' }],
    },
    { id: 'off', providerID: 'opencode', name: 'Disabled', enabled: false, status: 'active' },
  ],
  defaultModel: 'opencode/fledge-alpha-free',
  providers: [{ id: 'opencode', name: 'OpenCode Zen', activation: 'enabled' }],
  coldPluginCalls: 1,
  catalog: 'ok',
  mcp: 'connected',
  instructions: 'ok',
  turn: { reply: 'done', end: 'succeeded' },
};

const ENTRY = fileURLToPath(new URL('./fake-opencode-server.ts', import.meta.url));

export async function createFakeOpenCode(dir: string, scenario: Partial<FakeOpenCodeScenario> = {}): Promise<FakeOpenCode> {
  await fs.mkdir(dir, { recursive: true });
  const command = path.join(dir, 'opencode');
  // 假 opencode 是 .ts：22.18 之前的 Node 要显式打开类型剥离（之后默认打开，这个标志无害）。
  await fs.writeFile(command, `#!/bin/sh\nexec "${process.execPath}" --experimental-strip-types --no-warnings "${ENTRY}" "$@"\n`, {
    mode: 0o755,
  });
  const scenarioFile = path.join(dir, 'scenario.json');
  const logFile = path.join(dir, 'log.jsonl');
  let current: FakeOpenCodeScenario = { ...DEFAULT_SCENARIO, ...scenario };
  const write = () => writeFileSync(scenarioFile, JSON.stringify(current));
  write();
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin', FAKE_OPENCODE_DIR: dir };
  const versionOf = (output: string) => /(\d+\.\d+\.\d+)/.exec(output)?.[1] ?? null;

  const log = (): FakeOpenCodeLogEntry[] => {
    let text = '';
    try {
      text = readFileSync(logFile, 'utf8');
    } catch {
      return [];
    }
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as FakeOpenCodeLogEntry);
  };

  return {
    dir,
    command,
    locate: async () => (current.installed ? { command, version: versionOf(current.versionOutput), env } : null),
    scenario(patch) {
      current = { ...current, ...patch };
      write();
    },
    log,
    requests(method, route) {
      return log().filter(
        (e) =>
          e.kind === 'request' &&
          e.method === method &&
          e.path
            ?.split('/')
            .map((p) => (p.startsWith('ses_') ? ':id' : p))
            .join('/') === route,
      );
    },
  };
}
