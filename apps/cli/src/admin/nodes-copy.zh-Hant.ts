import type { NodesMessages } from './nodes-copy.ts';

export const zhHant: NodesMessages = {
  nodesHelp: (port) => `用法：
  baocut nodes                     列出已配對的區域網路節點（每個都會即時探測一次）
  baocut nodes discover            瀏覽區域網路中共享能力的節點（macOS）
  baocut nodes pair <address[:port]> <pairing code> [--alias <alias>]
                                   使用對方電腦「共享這台電腦」提供的配對碼配對；
                                   連接埠預設為 ${port}
  baocut nodes remove <nodeId|alias>
                                   刪除這台電腦記住的節點與權杖`,
  noPairedNodes: '沒有已配對的節點。請用 baocut nodes pair <address[:port]> <pairing code> 配對',
  noNodesDiscovered: '找不到共享能力的節點（只有 macOS 支援瀏覽；也可以輸入位址直接配對）',
  pairUsage: '用法：baocut nodes pair <address[:port]> <pairing code> [--alias <alias>]',
  removeUsage: '用法：baocut nodes remove <nodeId|alias>',
  paired: (description) => `已配對：${description}`,
  noSuchNode: (ref) => `沒有這個已配對的節點：${ref}`,
  removed: (alias, nodeId) => `已刪除 ${alias}（${nodeId}）`,
  invalidPort: (port) => `無效的連接埠：${port}`,
  shareHelp: (port, capabilities) => `用法：
  baocut share [status]            「共享這台電腦」的狀態：位址、連接埠、各項能力的開關、
                                   配對碼、已配對的電腦
  baocut share start [options]     開始共享並產生配對碼
    --port <port>                  預設 ${port}
    --name <name>                  其他人看到的名稱，預設為主機名稱
    --allow-any-source             接受任何來源位址（預設只接受區域網路位址）
  baocut share stop                停止共享（取消其他人提交的任務）
  baocut share code                作廢舊的配對碼並產生新的配對碼
  baocut share revoke <clientId>   撤銷一台已配對的電腦
  baocut share capability <capability> <on|off>
                                   開啟或關閉某項能力（${capabilities.join('、')}）的共享，立即生效：
                                   關閉後會拒絕其他人的新任務；已接受的任務會照常執行完畢`,
  portRange: '--port 必須是 0 至 65535 的整數',
  shareRevokeUsage: '用法：baocut share revoke <clientId>',
  capabilityLabels: { transcribe: '轉錄' },
  capabilityUsage: '用法：baocut share capability <capability> <on|off>（例如 baocut share capability transcribe off）',
  shareOff: '已關閉',
  shareOn: '已開啟',
  shareNotListening: (error: string | null) => `已開啟但未在監聽${error ? `：${error}` : ''}`,
  shareState: (state: string) => `共享這台電腦：${state}`,
  name: (name: string, nodeId: string | null) => `名稱：${name}${nodeId ? `（${nodeId}）` : ''}`,
  port: (port: number, anySource: boolean) => `連接埠：${port}${anySource ? '（任何來源位址）' : ''}`,
  addresses: (addresses: string | null) => `位址：${addresses ?? '（沒有區域網路位址）'}`,
  capabilitiesHead: (empty: boolean) => `能力：${empty ? '無' : ''}`,
  capabilityLine: (label: string, capability: string, enabled: boolean) =>
    `  ${label}（${capability}）：${enabled ? '已開啟' : `已關閉（用 baocut share capability ${capability} on 開啟）`}`,
  pairingCode: (code: string, until: string) => `配對碼：${code}（有效期限至 ${until}）`,
  pairingLocked: (until: string) => `配對已鎖定，直到 ${until}（baocut share code 可立即解除鎖定）`,
  noPairingCode: '配對碼：無（baocut share code 可產生一個）',
  clientsHead: (empty: boolean) => `已配對的電腦：${empty ? '無' : ''}`,
  clientLine: (name: string, clientId: string, pairedAt: string, lastSeenAt: string | null) =>
    `  ${name}  ${clientId}  配對於 ${pairedAt}${lastSeenAt ? `  上次連線 ${lastSeenAt}` : ''}`,
  remoteTasks: (running: number, queued: number) => `遠端任務：${running} 個執行中，${queued} 個排隊中`,
  unreachable: '無法連線',
  versionMismatch: '通訊協定版本不相容',
  unpaired: '配對已失效（請重新配對）',
  available: '可用',
  transcribeReady: (bundles: readonly string[], running: number, queued: number) =>
    `可用 · 模型 ${bundles.length > 0 ? bundles.join(', ') : '無'} · ${running} 個執行中，${queued} 個排隊中`,
  transcribeOff: '無法使用 · 節點已關閉轉錄的共享（請在那台電腦上開啟）',
};
