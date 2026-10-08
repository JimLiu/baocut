/*
 * 部分机制移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra），modified：
 * packages/server/src/server/agent/providers/generic-acp-agent.ts、cursor-acp-agent.ts、kimi-acp-agent.ts 的启动命令
 * （`cursor-agent acp`、`kimi acp`）与 provider 目录里的 `grok agent stdio`、探测时的 `NO_BROWSER`；copilot-acp-agent.ts 的
 * `copilot --acp`、URL 形式的模式 id 与经 `allow_all` 配置项实现的「全部放行」。
 * 改成 BaoCut 的预设表：名称、订阅、安装方式照原型 designs/baocut/app/data.js 的 MORE_HARNESSES。
 */
import type { DriverId, DriverInstallOption, Localized } from '@baocut/protocol';
import { DriversAcp } from '@baocut/protocol/messages/agent-drivers';
import { officialScript } from '../driver-text.ts';

/** 内置的 ACP 预设（`BUILTIN_DRIVER_IDS` 里经 ACP 接入的五个）。 */
export type BuiltinAcpDriverId = 'copilot' | 'gemini' | 'cursor' | 'grok' | 'kimi';
/** 经 ACP 接入的 Driver：内置预设，或用户添加的智能体（`agents.addProvider`）。 */
export type AcpDriverId = DriverId;

/**
 * ACP 的共享实现是否已经验证（架构设计 §3.11 的 D08）：同一协议的共享实现在一家真机跑通完整会话即算验证，
 * 没有单独写 `verified` 的预设与用户添加的智能体都取它。已经经 claude-code-acp 适配器（Claude Code 的 ACP 包装）
 * 在真机跑通新建、审批、追问、中断与恢复，所以为 true；为 false 时只显示探测结果，不能开会话。
 */
export const ACP_SHARED_VERIFIED = true;

/**
 * 一个 ACP 智能体的预设：同一份 `AcpDriver` 实现，差别只在怎么找到、怎么启动、怎么登录。
 * 用户添加的智能体也是一个预设（`customAcpPreset`）：没有最低版本、安装方式、登录命令与已知位置。
 */
export interface AcpPreset {
  id: AcpDriverId;
  name: string;
  /** 终端里敲的名字，也是在 PATH 上找的文件名；用户添加的可以是绝对路径。 */
  command: string;
  /** 以 ACP（stdio 上的 JSON 行）启动它的参数。 */
  args: string[];
  /** 启动它时另加的环境变量（用户添加的智能体的 `env`）。可能含密钥，不写日志。 */
  env?: Record<string, string>;
  /**
   * BaoCut 能驱动的最低版本：本机实测过的版本，或移植来源记录的、带 ACP 的版本。null：没有要求，也不运行 `--version`
   * （用户添加的命令可能是 `npx` 这类，`--version` 报的不是智能体的版本）。
   */
  minVersion: string | null;
  /** 需要什么订阅或账号（BaoCut 写的文字，读的时候取当前语言）。 */
  plan?: Localized;
  /**
   * 在终端里登录的命令。几家都没有独立的登录子命令时，填启动交互界面的命令（在里面按提示登录）。
   */
  loginCommand: string | null;
  /**
   * 未登录时给人看的一句「怎么登录」。不给时按 `loginCommand` 说「在终端运行 … 登录」；几种登录方式并存时
   * （Gemini CLI 的 Google 账号与 API 密钥）写在这里。
   */
  loginHint?: Localized;
  install?: DriverInstallOption[];
  /** 没装时给人看的一句：怎么装。 */
  installHint?: Localized;
  /** PATH 之外的已知安装位置（`~` 开头的相对于用户主目录）。 */
  knownLocations?: string[];
  /** 模型表从哪来：`session` 读 `session/new` 应答里的模型（`models` 或分类为 model 的配置项）；`cursor` 另走扩展方法。 */
  models: 'session' | 'cursor';
  /**
   * 访问模式 → ACP 会话模式（`session/set_mode`）的候选，按顺序取智能体有的第一个；都没有就不设并提示一次。
   * 只放不比 BaoCut 的模式更宽的原生模式（架构设计 §3.12：两边取更严的）。
   */
  modes: Record<'plan' | 'ask' | 'fullAccess', string[]>;
  /**
   * 「全部放行」不是会话模式、而是一个配置项的智能体（Copilot 的 `allow_all`）：完全访问时经 `session/set_config_option`
   * 设为 `on`，别的模式设为 `off`（离开完全访问时先关它再换模式）。会话里没有这个配置项时不设，完全访问按 `modes` 运行并提示一次。
   */
  permissionOption?: { configId: string; on: string; off: string };
  /**
   * 能不能开会话（D08，架构设计 §3.11）。不给取 `ACP_SHARED_VERIFIED`：共享实现已经验证，同一协议的预设都算验证过。
   */
  verified?: boolean;
  /**
   * 这一家的智能体本身在 BaoCut 上实测过完整会话。不给为 false：照样能开会话，界面提示「未在 BaoCut 实测」。
   * 共享实现是经 claude-code-acp 适配器验证的，内置预设都还没以自家智能体实测过。
   */
  tested?: boolean;
}

/** 未登录时的说明：`loginHint`，没有时按登录命令。 */
export function loginAdvice(preset: Pick<AcpPreset, 'loginHint' | 'loginCommand' | 'command'>): Localized {
  return preset.loginHint ?? DriversAcp.loginViaTerminal({ command: preset.loginCommand ?? preset.command });
}

/**
 * 访问模式到原生会话模式的映射（两边取更严的）：
 *
 * | BaoCut 模式 | 候选 | 说明 |
 * | --- | --- | --- |
 * | plan | plan → default | 只出方案；没有 plan 模式的退回逐项询问 |
 * | ask / autoAcceptEdits / auto | default | 动手之前来问，由 Harness 按决策表定；原生的自动编辑模式会放过工作目录外的写，不用 |
 * | fullAccess | yolo / bypassPermissions → default | 不再来问 |
 */
export const ACP_MODES: AcpPreset['modes'] = {
  plan: ['plan', 'default'],
  ask: ['default'],
  fullAccess: ['yolo', 'bypassPermissions', 'default'],
};

const LOCAL_BIN = (command: string) => [`~/.local/bin/${command}`, `/opt/homebrew/bin/${command}`, `/usr/local/bin/${command}`];

/** Copilot 的会话模式 id 是 URL 形式（`copilot --acp` 1.0.92 实测）。 */
const COPILOT_MODE = (name: 'agent' | 'plan') => `https://agentclientprotocol.com/protocol/session-modes#${name}`;

/** 给人看的字段（`plan`、`loginHint`、`installHint`、官方脚本的 `install`）写成 getter：读的时候取当前语言。 */
export const ACP_PRESETS: Record<BuiltinAcpDriverId, AcpPreset> = {
  copilot: {
    id: 'copilot',
    name: 'GitHub Copilot',
    command: 'copilot',
    args: ['--acp'],
    // 本机实测 initialize / session/new（URL 形式的模式 id 与 allow_all 配置项）的版本。paseo 2026-04-02 起经 `copilot --acp` 接入
    // （当时 npm 上约为 1.0.15），但更早的版本有没有这些模式与配置项没有查到，先按实测的版本要求。
    minVersion: '1.0.92',
    get plan() {
      return DriversAcp.copilotPlan();
    },
    // `initialize` 的 authMethods 写的是「在终端运行 copilot login」；交互界面里的 /login 也行。
    loginCommand: 'copilot login',
    get loginHint() {
      return DriversAcp.copilotLoginHint();
    },
    install: [
      {
        kind: 'npm',
        label: 'npm',
        needs: 'Node.js',
        command: 'npm install -g @github/copilot',
        upgrade: 'npm install -g @github/copilot@latest',
      },
    ],
    get installHint() {
      return DriversAcp.copilotInstallHint();
    },
    knownLocations: LOCAL_BIN('copilot'),
    models: 'session',
    // #autopilot 会自己开 allow-all 并一直跑到完成，比 BaoCut 的任何模式都宽，不用；完全访问是 #agent 加 allow_all。
    modes: {
      plan: [COPILOT_MODE('plan'), 'plan'],
      ask: [COPILOT_MODE('agent'), 'default'],
      fullAccess: [COPILOT_MODE('agent'), 'default'],
    },
    permissionOption: { configId: 'allow_all', on: 'on', off: 'off' },
    tested: false,
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    args: ['--acp'],
    // 本机实测 initialize / session/new 的版本；更早的版本用 `--experimental-acp`。
    minVersion: '0.46.0',
    get plan() {
      return DriversAcp.geminiPlan();
    },
    // Gemini CLI 没有独立的登录子命令：启动后在交互界面里选登录方式。
    loginCommand: 'gemini',
    // 用 API 密钥的话，密钥写在 ~/.gemini/.env 里最稳：Gemini CLI 自己读它，与 BaoCut 怎么启动无关。
    get loginHint() {
      return DriversAcp.geminiLoginHint();
    },
    install: [
      { kind: 'brew', label: 'Homebrew', needs: 'Homebrew', command: 'brew install gemini-cli', upgrade: 'brew upgrade gemini-cli' },
      {
        kind: 'npm',
        label: 'npm',
        needs: 'Node.js',
        command: 'npm install -g @google/gemini-cli',
        upgrade: 'npm install -g @google/gemini-cli@latest',
      },
    ],
    get installHint() {
      return DriversAcp.geminiInstallHint();
    },
    knownLocations: LOCAL_BIN('gemini'),
    models: 'session',
    modes: ACP_MODES,
    tested: false,
  },
  cursor: {
    id: 'cursor',
    name: 'Cursor Agent',
    command: 'cursor-agent',
    args: ['acp'],
    minVersion: '2026.03.30',
    get plan() {
      return DriversAcp.cursorPlan();
    },
    loginCommand: 'cursor-agent login',
    get install() {
      return [officialScript('curl https://cursor.com/install -fsS | bash', 'cursor-agent update')];
    },
    get installHint() {
      return DriversAcp.cursorInstallHint();
    },
    knownLocations: LOCAL_BIN('cursor-agent'),
    models: 'cursor',
    modes: ACP_MODES,
    tested: false,
  },
  grok: {
    id: 'grok',
    name: 'Grok',
    command: 'grok',
    args: ['agent', 'stdio'],
    minVersion: '0.2.11',
    get plan() {
      return DriversAcp.grokPlan();
    },
    // 第一次启动时在浏览器里登录（或设 XAI_API_KEY）。
    loginCommand: 'grok',
    get install() {
      return [officialScript('curl -fsSL https://x.ai/cli/install.sh | bash', 'curl -fsSL https://x.ai/cli/install.sh | bash')];
    },
    get installHint() {
      return DriversAcp.grokInstallHint();
    },
    knownLocations: [...LOCAL_BIN('grok'), '~/.grok/bin/grok'],
    models: 'session',
    modes: ACP_MODES,
    tested: false,
  },
  kimi: {
    id: 'kimi',
    name: 'Kimi Code',
    command: 'kimi',
    args: ['acp'],
    minVersion: '0.11.0',
    get plan() {
      return DriversAcp.kimiPlan();
    },
    // 在交互界面里输入 /login 登录。
    loginCommand: 'kimi',
    // 原型没有给出可以稳妥列出的安装命令：按官方说明安装。
    install: [],
    get installHint() {
      return DriversAcp.kimiInstallHint();
    },
    knownLocations: LOCAL_BIN('kimi'),
    models: 'session',
    modes: ACP_MODES,
    tested: false,
  },
};

/** 探测与会话进程的额外环境：不要自己打开浏览器去登录（后台进程弹出浏览器，用户不知道从哪来的）。 */
export const ACP_ENV: Record<string, string> = { NO_BROWSER: '1', NO_OPEN_BROWSER: '1' };
