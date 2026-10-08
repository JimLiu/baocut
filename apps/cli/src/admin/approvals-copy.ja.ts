import type { ApprovalsMessages } from './approvals-copy.ts';

export const ja: ApprovalsMessages = {
  help: `使い方：
  baocut approvals                 承認待ちの項目を一覧表示（セッションからのものと外部サービスからのもの）
  baocut approvals allow <id>      承認待ちの項目を許可。データを送信する承認は既定で今回だけ許可します
                                   （金額は不明）
    --persist                      継続的な許可もあわせて発行（以後、同じデータ送信は確認しません）
    --scope <video|all>            継続的な許可の範囲：今回の呼び出しの動画（既定）またはすべての動画
    --max-calls <n>                継続的な許可の呼び出し回数の上限
    --budget <amount> --currency <currency>
                                   継続的な許可の金額上限（料金が設定されたモデルでのみ有効。
                                   費用を見積もれない呼び出しは毎回承認が必要です）
    --expires <ISO time>           継続的な許可の有効期限
  baocut approvals deny <id>       承認待ちの項目を拒否`,
  persistNeedsAllow: '--persist は allow と一緒にのみ使えます',
  alreadyResolved: (id) => `承認 ${id} はすでに処理済み、タイムアウト、またはキャンセル済みです（または存在しません）`,
  allowed: (id) => `${id} を許可しました`,
  denied: (id) => `${id} を拒否しました`,
  unknownMode: (value: string, flags: readonly string[]) => `不明なアクセスモード：${value}。--mode に指定できるのは ${flags.join('、')} です`,
  mode: (label: string, flag: string) => `${label}（${flag}）`,
  usage: '使い方：baocut approvals [list | allow <approval id> | deny <approval id>]',
  riskLabels: { read: '読み取り', edit: '編集', command: 'コマンド', high: '高リスク' },
  none: '承認待ちの項目はありません',
  fromSession: (title: string) => `セッション「${title}」`,
  fromService: (serviceId: string, clientName: string) => `サービス ${serviceId} · ${clientName}`,
  basisMode: (mode: string) => `モード ${mode}`,
  basisLevel: (level: string) => `レベル ${level}`,
  approvalLine: (a: {
    id: string;
    who: string;
    action: string;
    targets: readonly string[];
    risk: string;
    summary: string;
    basis: string;
    secondsLeft: number | null;
  }) =>
    `${a.id}  ${a.who}  ${a.action}${a.targets.length > 0 ? ` → ${a.targets.join('、')}` : ''}  [${a.risk}] ${a.summary}（${a.basis}${a.secondsLeft === null ? '' : `、${a.secondsLeft} 秒後に自動で拒否`}）`,
  runCommand: (command: string) => `コマンドを実行：${command}`,
  changeFiles: (files: readonly string[]) => `ファイルを変更：${files.join(', ')}`,
  callTool: (tool: string, files: readonly string[]) => `${tool} を呼び出し${files.length > 0 ? `：${files.join(', ')}` : ''}`,
};
