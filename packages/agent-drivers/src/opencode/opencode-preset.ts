/*
 * 部分机制移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra），modified：
 * packages/server/src/server/agent/providers/opencode/runtime-client.ts 的版本格式（`opencode v2.0.24` 或 `1.18.34`）
 * 与 v2 的最低版本（2.0.10），v2/runtime.ts 的 `serve` 启动参数与密码环境变量。
 * 改成 BaoCut 的预设常量：名称、订阅说明照原型 designs/baocut/app/data.js 的 MORE_HARNESSES；只认 2.x。
 */
import type { DriverInstallOption } from '@baocut/protocol';
import { DriversOpencode } from '@baocut/protocol/messages/agent-drivers';

/**
 * OpenCode 的预设（写法同 `acp/acp-presets.ts`）。只接 2.x：2.x 的 `opencode serve` 提供 v2 HTTP API（`/api/...`）与
 * 事件流；1.x 是另一套接口，不做兼容，探测时报版本过低。
 */
export const OPENCODE_PRESET = {
  name: 'OpenCode',
  /** 终端里敲的名字。2.x 的 npm 包（`@opencode/cli`）同时装 `opencode` 与 `opencode2` 两个名字，两个都找。 */
  command: 'opencode',
  commandAliases: ['opencode2'],
  /** v2 API 的最低版本：移植来源记录的、session v2 接口齐全的版本。 */
  minVersion: '2.0.10',
  /** 订阅说明（随语言变，读的时候再取）。 */
  get plan() {
    return DriversOpencode.plan();
  },
  /** 登录模型账号：`opencode auth login`（不登录也能用 OpenCode Zen 的免费模型）。 */
  loginCommand: 'opencode auth login',
  /**
   * 安装方式。原型写的是官方脚本与 `npm install -g opencode-ai`，但这两条（2026-10 实测）装的都是 1.x（脚本取 GitHub 最新
   * 发行版 v1.18.34，npm 包 `opencode-ai` 也是 1.18.34）；2.x 只在 npm 包 `@opencode/cli` 里。这里只给能装出 2.x 的一条。
   */
  install: [
    {
      kind: 'npm',
      label: 'npm',
      needs: 'Node.js',
      command: 'npm install -g @opencode/cli',
      upgrade: 'npm install -g @opencode/cli@latest',
    },
  ] satisfies DriverInstallOption[],
  get installHint() {
    return DriversOpencode.installHint();
  },
  /** PATH 之外的已知安装位置（`~` 开头的相对于用户主目录）。 */
  knownLocations: ['~/.opencode/bin/opencode', '~/.local/bin/opencode', '/opt/homebrew/bin/opencode', '/usr/local/bin/opencode'],
} as const;

/** 覆盖可执行文件位置的环境变量。 */
export const OPENCODE_PATH_VARIABLE = 'BAOCUT_OPENCODE_PATH';

/**
 * 给 `opencode serve` 的环境：不自动升级（升级会换掉正在用的可执行文件）。密码另由 `OpenCodeServer` 每次随机生成。
 */
export const OPENCODE_ENV: Record<string, string> = {
  OPENCODE_DISABLE_AUTOUPDATE: '1',
};
