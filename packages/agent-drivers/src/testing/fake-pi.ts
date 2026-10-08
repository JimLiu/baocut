import fs from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PiInstall } from '../pi/pi-binary.ts';
import type { PiModel } from '../pi/pi-models.ts';

/**
 * 测试用的假 `pi --mode rpc`：一个可执行文件，回答 `--version`，带 `--mode rpc` 时在 stdio 上说 pi 的 JSON 行协议
 * （命令带 `id`，应答 `type: 'response'`，事件没有 `id`）。事件的形状照 pi 1.0.4 的真实输出（一次 prompt 里每次模型调用
 * 各有一对 turn_start / turn_end，agent_end 之后是 agent_settled；edit 的结果带 `details.patch`，bash 的带 `structuredContent`）。
 * 不联网、不碰本机真实的 pi；收到的每条命令记进 `log.jsonl`。
 *
 * 用法：`createFakePi(dir)` 得到 `locate`，交给 `new PiDriver(log, { locate })`；`scenario()` 改下一次的行为（每个进程启动时读一次）。
 */

export interface FakePiTool {
  name: string;
  args: Record<string, unknown>;
  /** tool_execution_end 的 `result`。 */
  result: unknown;
  isError?: boolean;
  /** 先发一次 tool_execution_update，partialResult 是这段文字。 */
  partial?: string;
}

/** 一次 prompt 里 pi 做什么。 */
export interface FakePiTurn {
  thinking?: string;
  /** 每个工具单独一次模型调用（一对 turn_start / turn_end）。 */
  tools?: FakePiTool[];
  /** 最后的文字回复（分两段增量发）。 */
  reply?: string;
  /** 开始一个 bash 之后一直不结束，直到收到 abort。 */
  hang?: boolean;
  /** 最后一条助手消息以 stopReason 'error' 结束，带这个 errorMessage。 */
  error?: string;
  /** prompt 直接回 success: false。 */
  promptError?: string;
  /** 发出 agent_start 与一段文字之后进程以码 3 退出。 */
  exitMidTurn?: boolean;
  /** 先来一次扩展提问（confirm），看 BaoCut 怎么答。 */
  ask?: boolean;
}

export interface FakePiScenario {
  installed: boolean;
  version: string;
  /** get_available_models 的结果；空表示没有可用的凭据。 */
  models: PiModel[];
  /** get_state 里当前的模型；null 时给 pi 没配模型时的 `{ provider: 'unknown', id: 'unknown' }`。 */
  current: { provider: string; id: string } | null;
  /** false：steer 与 clear_queue 回「Unknown command」（旧版）。 */
  steer: boolean;
  /** false：不发 agent_settled（旧版）。 */
  settled: boolean;
  /** get_state 之前就退出（启动失败）。 */
  crashOnStart: boolean;
  turn: FakePiTurn;
}

export interface FakePiLogEntry {
  t: number;
  pid: number;
  kind: 'start' | 'in' | 'exit';
  cwd?: string;
  args?: string[];
  env?: Record<string, string | undefined>;
  /** `--extension` 文件当时的内容（进程结束后 BaoCut 会删掉它）。 */
  extension?: string;
  instructions?: string;
  msg?: Record<string, unknown>;
}

export interface FakePi {
  dir: string;
  locate: () => Promise<PiInstall | null>;
  scenario(patch: Partial<FakePiScenario>): void;
  log(): FakePiLogEntry[];
  /** 收到的某一种命令，按到达顺序。 */
  commands(type: string): Array<Record<string, unknown>>;
  /** 会话文件放在这里（假的 `~/.pi/agent/sessions`）。 */
  sessionsDir: string;
}

export const FAKE_PI_MODELS: PiModel[] = [
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    provider: 'anthropic',
    reasoning: true,
    input: ['text', 'image'],
    thinkingLevelMap: { xhigh: 'xhigh' },
  },
  { id: 'gpt-mini', name: 'GPT Mini', provider: 'openai', reasoning: false, input: ['text'] },
];

const DEFAULT_SCENARIO: FakePiScenario = {
  installed: true,
  version: '1.0.4',
  models: FAKE_PI_MODELS,
  current: { provider: 'anthropic', id: 'claude-sonnet-5' },
  steer: true,
  settled: true,
  crashOnStart: false,
  turn: { reply: 'done' },
};

const ENTRY = fileURLToPath(new URL('./fake-pi-rpc.ts', import.meta.url));

export async function createFakePi(dir: string, scenario: Partial<FakePiScenario> = {}): Promise<FakePi> {
  await fs.mkdir(dir, { recursive: true });
  const sessionsDir = path.join(dir, 'sessions');
  await fs.mkdir(sessionsDir, { recursive: true });
  const command = path.join(dir, 'pi');
  // 假 pi 是 .ts：22.18 之前的 Node 要显式打开类型剥离；环境被收窄过，不能靠 NODE_OPTIONS。
  await fs.writeFile(command, `#!/bin/sh\nexec "${process.execPath}" --experimental-strip-types --no-warnings "${ENTRY}" "$@"\n`, {
    mode: 0o755,
  });
  const scenarioFile = path.join(dir, 'scenario.json');
  const logFile = path.join(dir, 'log.jsonl');
  let current: FakePiScenario = { ...DEFAULT_SCENARIO, ...scenario };
  const write = () => writeFileSync(scenarioFile, JSON.stringify(current));
  write();
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin', FAKE_PI_DIR: dir };

  const log = (): FakePiLogEntry[] => {
    let text = '';
    try {
      text = readFileSync(logFile, 'utf8');
    } catch {
      return [];
    }
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as FakePiLogEntry);
  };

  return {
    dir,
    sessionsDir,
    locate: async () => (current.installed ? { command, version: current.version, env } : null),
    scenario(patch) {
      current = { ...current, ...patch };
      write();
    },
    log,
    commands(type) {
      return log()
        .filter((e) => e.kind === 'in' && e.msg?.type === type)
        .map((e) => e.msg!);
    },
  };
}
