import type { CustomAgentProvider } from '@baocut/protocol';
import type { Logger } from '@baocut/harness';
import { AcpDriver, type AcpDriverOptions } from './acp-driver.ts';
import { DriversAcp } from '@baocut/protocol/messages/agent-drivers';
import { ACP_MODES, type AcpPreset } from './acp-presets.ts';

/**
 * 用户添加的 ACP 智能体（`agents.addProvider`，架构设计 §3.11）的预设：`command[0]` 是可执行文件（PATH 上的名字或绝对路径），
 * 其余是参数；`env` 启动时另加。没有最低版本（不跑 `--version`）、安装方式、登录命令与已知安装位置；访问模式的映射与内置预设相同。
 * `verified` 取 ACP 共享实现的（`ACP_SHARED_VERIFIED`），`tested` 为 false。
 */
export function customAcpPreset(provider: Pick<CustomAgentProvider, 'id' | 'name' | 'command' | 'env'>): AcpPreset {
  const [command, ...args] = provider.command;
  if (!command) throw new Error(String(DriversAcp.customNoCommand({ id: provider.id })));
  return {
    id: provider.id,
    name: provider.name,
    command,
    args,
    ...(provider.env && Object.keys(provider.env).length ? { env: { ...provider.env } } : {}),
    minVersion: null,
    loginCommand: null,
    install: [],
    get installHint() {
      return DriversAcp.customInstallHint({ command });
    },
    knownLocations: [],
    models: 'session',
    modes: ACP_MODES,
    tested: false,
  };
}

/** 从用户添加的配置构造一个 ACP Driver。 */
export function createCustomAcpDriver(
  provider: Pick<CustomAgentProvider, 'id' | 'name' | 'command' | 'env'>,
  log: Logger,
  options: AcpDriverOptions = {},
): AcpDriver {
  return new AcpDriver(customAcpPreset(provider), log, options);
}
