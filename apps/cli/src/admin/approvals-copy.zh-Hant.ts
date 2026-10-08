import type { ApprovalsMessages } from './approvals-copy.ts';

export const zhHant: ApprovalsMessages = {
  help: `用法：
  baocut approvals                 列出待核准的請求，包括對話中的與外部服務的
  baocut approvals allow <id>      允許一項待核准的請求；涉及分享資料的請求預設只允許這一次（金額未知）
    --persist                      同時發放一項長期授權（之後同樣的資料分享不再詢問）
    --scope <video|all>            長期授權的範圍：這次呼叫的影片（預設）或所有影片
    --max-calls <n>                長期授權的呼叫次數上限
    --budget <amount> --currency <currency>
                                   長期授權的金額上限（只適用於有定價的模型；無法估算費用的呼叫每次都需要核准）
    --expires <ISO time>           長期授權的到期時間
  baocut approvals deny <id>       拒絕一項待核准的請求`,
  persistNeedsAllow: '--persist 只能與 allow 一起使用',
  alreadyResolved: (id) => `核准請求 ${id} 已處理、逾時或取消（或不存在）`,
  allowed: (id) => `已允許 ${id}`,
  denied: (id) => `已拒絕 ${id}`,
  unknownMode: (value: string, flags: readonly string[]) => `未知的存取模式：${value}。--mode 可用 ${flags.join('、')}`,
  mode: (label: string, flag: string) => `${label}（${flag}）`,
  usage: '用法：baocut approvals [list | allow <approval id> | deny <approval id>]',
  riskLabels: { read: '讀取', edit: '編輯', command: '指令', high: '高風險' },
  none: '沒有待核准的請求',
  fromSession: (title: string) => `對話「${title}」`,
  fromService: (serviceId: string, clientName: string) => `服務 ${serviceId} · ${clientName}`,
  basisMode: (mode: string) => `模式 ${mode}`,
  basisLevel: (level: string) => `等級 ${level}`,
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
    `${a.id}  ${a.who}  ${a.action}${a.targets.length > 0 ? ` → ${a.targets.join('、')}` : ''}  [${a.risk}] ${a.summary}（${a.basis}${a.secondsLeft === null ? '' : `，${a.secondsLeft} 秒後自動拒絕`}）`,
  runCommand: (command: string) => `執行指令：${command}`,
  changeFiles: (files: readonly string[]) => `修改檔案：${files.join(', ')}`,
  callTool: (tool: string, files: readonly string[]) => `呼叫 ${tool}${files.length > 0 ? `：${files.join(', ')}` : ''}`,
};
