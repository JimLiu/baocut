import type { NodesMessages } from './nodes-copy.ts';

export const ja: NodesMessages = {
  nodesHelp: (port) => `使い方：
  baocut nodes                     ペアリング済みの LAN ノードを一覧表示（それぞれ一度ずつ接続を確認）
  baocut nodes discover            機能を共有している LAN ノードを探す（macOS）
  baocut nodes pair <address[:port]> <pairing code> [--alias <alias>]
                                   相手のコンピュータの「このコンピュータを共有」に表示されるペアリング
                                   コードでペアリング。ポートの既定は ${port}
  baocut nodes remove <nodeId|alias>
                                   このコンピュータに記録したノードとトークンを削除`,
  noPairedNodes: 'ペアリング済みのノードはありません。baocut nodes pair <address[:port]> <pairing code> でペアリングしてください',
  noNodesDiscovered:
    '機能を共有しているノードは見つかりませんでした（探索は macOS でのみ動作します。アドレスを入力してペアリングすることもできます）',
  pairUsage: '使い方：baocut nodes pair <address[:port]> <pairing code> [--alias <alias>]',
  removeUsage: '使い方：baocut nodes remove <nodeId|alias>',
  paired: (description) => `ペアリングしました：${description}`,
  noSuchNode: (ref) => `ペアリング済みのノードではありません：${ref}`,
  removed: (alias, nodeId) => `${alias}（${nodeId}）を削除しました`,
  invalidPort: (port) => `無効なポート：${port}`,
  shareHelp: (port, capabilities) => `使い方：
  baocut share [status]            「このコンピュータを共有」の状態：アドレス、ポート、
                                   機能ごとのオン／オフ、ペアリングコード、ペアリング済みのコンピュータ
  baocut share start [options]     共有を開始してペアリングコードを生成
    --port <port>                  既定は ${port}
    --name <name>                  ほかの人に表示される名前。既定はホスト名
    --allow-any-source             すべての送信元アドレスを受け付ける（既定では LAN のアドレスのみ）
  baocut share stop                共有を停止（ほかの人が送信したタスクはキャンセル）
  baocut share code                古いペアリングコードを無効にして新しいコードを生成
  baocut share revoke <clientId>   ペアリング済みのコンピュータを撤回する
  baocut share capability <capability> <on|off>
                                   機能（${capabilities.join('、')}）の共有をオンまたはオフにして、すぐに反映：
                                   オフにするとほかの人からの新しいタスクは拒否し、受け付け済みの
                                   タスクは最後まで実行します`,
  portRange: '--port には 0 から 65535 までの整数を指定してください',
  shareRevokeUsage: '使い方：baocut share revoke <clientId>',
  capabilityLabels: { transcribe: '文字起こし' },
  capabilityUsage: '使い方：baocut share capability <capability> <on|off>（例：baocut share capability transcribe off）',
  shareOff: 'オフ',
  shareOn: 'オン',
  shareNotListening: (error: string | null) => `オンですが待ち受けていません${error ? `：${error}` : ''}`,
  shareState: (state: string) => `このコンピュータを共有：${state}`,
  name: (name: string, nodeId: string | null) => `名前：${name}${nodeId ? `（${nodeId}）` : ''}`,
  port: (port: number, anySource: boolean) => `ポート：${port}${anySource ? '（すべての送信元アドレス）' : ''}`,
  addresses: (addresses: string | null) => `アドレス：${addresses ?? '（ローカルネットワークのアドレスなし）'}`,
  capabilitiesHead: (empty: boolean) => `機能：${empty ? 'なし' : ''}`,
  capabilityLine: (label: string, capability: string, enabled: boolean) =>
    `  ${label}（${capability}）：${enabled ? 'オン' : `オフ（baocut share capability ${capability} on でオン）`}`,
  pairingCode: (code: string, until: string) => `ペアリングコード：${code}（${until} まで有効）`,
  pairingLocked: (until: string) => `ペアリングは ${until} までロックされています（baocut share code ですぐに解除）`,
  noPairingCode: 'ペアリングコード：なし（baocut share code で生成）',
  clientsHead: (empty: boolean) => `ペアリング済みのコンピュータ：${empty ? 'なし' : ''}`,
  clientLine: (name: string, clientId: string, pairedAt: string, lastSeenAt: string | null) =>
    `  ${name}  ${clientId}  ペアリング ${pairedAt}${lastSeenAt ? `  最終接続 ${lastSeenAt}` : ''}`,
  remoteTasks: (running: number, queued: number) => `リモートのタスク：実行中 ${running} 件、待機中 ${queued} 件`,
  unreachable: '接続できません',
  versionMismatch: 'プロトコルのバージョンに互換性がありません',
  unpaired: 'ペアリングが無効になりました（再度ペアリングしてください）',
  available: '利用可能',
  transcribeReady: (bundles: readonly string[], running: number, queued: number) =>
    `利用可能 · モデル ${bundles.length > 0 ? bundles.join(', ') : 'なし'} · 実行中 ${running} 件、待機中 ${queued} 件`,
  transcribeOff: '利用不可 · ノードで文字起こしの共有がオフになっています（そのコンピュータでオンにしてください）',
};
