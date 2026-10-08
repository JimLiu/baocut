import type { NodesMessages } from './nodes-copy.ts';

export const zhHans: NodesMessages = {
  nodesHelp: (port) => `用法：
  baocut nodes                     列出已配对的局域网节点（各带一次实时探测）
  baocut nodes discover            浏览局域网里共享了能力的节点（macOS）
  baocut nodes pair <地址[:端口]> <配对码> [--alias <别名>]
                                   用对方「共享这台电脑」给出的配对码配对，端口默认 ${port}
  baocut nodes remove <nodeId|别名>
                                   删除本机记下的节点与令牌`,
  noPairedNodes: '没有已配对的节点。用 baocut nodes pair <地址[:端口]> <配对码> 配对',
  noNodesDiscovered: '没有发现共享了能力的节点（只在 macOS 上浏览；也可以直接输入地址配对）',
  pairUsage: '用法：baocut nodes pair <地址[:端口]> <配对码> [--alias <别名>]',
  removeUsage: '用法：baocut nodes remove <nodeId|别名>',
  paired: (description) => `已配对：${description}`,
  noSuchNode: (ref) => `没有这个已配对的节点：${ref}`,
  removed: (alias, nodeId) => `已删除 ${alias}（${nodeId}）`,
  invalidPort: (port) => `端口不合法：${port}`,
  shareHelp: (port, capabilities) => `用法：
  baocut share [status]            「共享这台电脑」的状态：地址、端口、各能力的开关、配对码、已配对的电脑
  baocut share start [选项]        开启共享并生成配对码
    --port <端口>                  默认 ${port}
    --name <名字>                  别人看到的名字，默认主机名
    --allow-any-source             不限来源地址（默认只接受局域网地址）
  baocut share stop                关闭共享（取消别人提交的任务）
  baocut share code                作废旧配对码并生成新的
  baocut share revoke <clientId>   吊销一台已配对的电脑
  baocut share capability <能力> <on|off>
                                   打开或关闭一种能力（${capabilities.join('、')}）的共享，立即生效：
                                   关闭后别人的新任务被拒绝，已经接受的照常跑完`,
  portRange: '--port 要是 0–65535 的整数',
  shareRevokeUsage: '用法：baocut share revoke <clientId>',
  capabilityLabels: { transcribe: '转写' },
  capabilityUsage: '用法：baocut share capability <能力> <on|off>（例如 baocut share capability transcribe off）',
  shareOff: '已关闭',
  shareOn: '已开启',
  shareNotListening: (error: string | null) => `已开启但没有监听${error ? `：${error}` : ''}`,
  shareState: (state: string) => `共享这台电脑：${state}`,
  name: (name: string, nodeId: string | null) => `名字：${name}${nodeId ? `（${nodeId}）` : ''}`,
  port: (port: number, anySource: boolean) => `端口：${port}${anySource ? '（不限来源地址）' : ''}`,
  addresses: (addresses: string | null) => `地址：${addresses ?? '（没有局域网地址）'}`,
  capabilitiesHead: (empty: boolean) => `能力：${empty ? '无' : ''}`,
  capabilityLine: (label: string, capability: string, enabled: boolean) =>
    `  ${label}（${capability}）：${enabled ? '已打开' : `已关闭（baocut share capability ${capability} on 打开）`}`,
  pairingCode: (code: string, until: string) => `配对码：${code}（${until} 前有效）`,
  pairingLocked: (until: string) => `配对已锁定，${until} 后解除（baocut share code 立即解除）`,
  noPairingCode: '配对码：没有（baocut share code 生成一个）',
  clientsHead: (empty: boolean) => `已配对的电脑：${empty ? '无' : ''}`,
  clientLine: (name: string, clientId: string, pairedAt: string, lastSeenAt: string | null) =>
    `  ${name}  ${clientId}  配对于 ${pairedAt}${lastSeenAt ? `  最近 ${lastSeenAt}` : ''}`,
  remoteTasks: (running: number, queued: number) => `远端任务：运行 ${running} 排队 ${queued}`,
  unreachable: '连不上',
  versionMismatch: '协议版本不兼容',
  unpaired: '配对已失效（需要重新配对）',
  available: '可用',
  transcribeReady: (bundles: readonly string[], running: number, queued: number) =>
    `可用 · 模型 ${bundles.length > 0 ? bundles.join(', ') : '无'} · 运行 ${running} 排队 ${queued}`,
  transcribeOff: '不可用 · 节点关闭了转写的共享（需要那台电脑打开）',
};
