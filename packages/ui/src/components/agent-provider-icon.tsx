import type { ComponentProps } from 'react';
import type { DriverInfo } from '@baocut/protocol';
import { agentIcon } from '../model/agent-choice.ts';
import { vendorIconFor, type VendorIconComponent } from './vendor-icon.tsx';

/*
 * Agent 图标（产品设计 §3.2.3；原型 vendor-icon.jsx `VendorIcon`）：内置的查 `AGENT_ICON_FILES`，用户添加的画名字首字母；
 * 画法与 API 提供方共用（vendor-icon.tsx）。
 */

/** 某个 Agent 的图标；`slot` 等透传给 S2 的图标（默认进 `icon` 槽）。 */
export function AgentProviderIcon({
  driver,
  ...props
}: { driver: Pick<DriverInfo, 'id' | 'name'> & { source?: DriverInfo['source'] } } & ComponentProps<VendorIconComponent>) {
  const Icon = vendorIconFor(agentIcon(driver));
  return <Icon {...props} />;
}
