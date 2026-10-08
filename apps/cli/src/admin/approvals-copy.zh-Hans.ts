import type { ApprovalsMessages } from './approvals-copy.ts';

export const zhHans: ApprovalsMessages = {
  help: `用法：
  baocut approvals                 列出待处理的审批：会话里的与对外服务的
  baocut approvals allow <id>      允许一条待处理的审批；带数据外发的审批默认只允许这一次（金额未知）
    --persist                      同时发放一条持续授权（之后同样的外发不再询问）
    --scope <video|all>            持续授权的范围：这次调用的视频（默认）或全部视频
    --max-calls <n>                持续授权的调用次数上限
    --budget <金额> --currency <币种>
                                   持续授权的金额上限（只对有价格的模型有效；估不出金额的调用会要求逐次批准）
    --expires <ISO 时间>           持续授权的到期时间
  baocut approvals deny <id>       拒绝一条待处理的审批`,
  persistNeedsAllow: '--persist 只和 allow 一起用',
  alreadyResolved: (id) => `审批 ${id} 已经处理过、超时或取消了（或者不存在）`,
  allowed: (id) => `已允许 ${id}`,
  denied: (id) => `已拒绝 ${id}`,
  unknownMode: (value: string, flags: readonly string[]) => `不认识的访问模式：${value}。--mode 可选 ${flags.join('、')}`,
  mode: (label: string, flag: string) => `${label}（${flag}）`,
  usage: '用法：baocut approvals [list | allow <审批 id> | deny <审批 id>]',
  riskLabels: { read: '查询', edit: '修改', command: '命令', high: '高风险' },
  none: '没有待处理的审批',
  fromSession: (title: string) => `会话「${title}」`,
  fromService: (serviceId: string, clientName: string) => `服务 ${serviceId} · ${clientName}`,
  basisMode: (mode: string) => `模式 ${mode}`,
  basisLevel: (level: string) => `等级 ${level}`,
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
    `${a.id}  ${a.who}  ${a.action}${a.targets.length > 0 ? ` → ${a.targets.join('、')}` : ''}  [${a.risk}] ${a.summary}（${a.basis}${a.secondsLeft === null ? '' : `，${a.secondsLeft} 秒后按拒绝处理`}）`,
  runCommand: (command: string) => `运行命令：${command}`,
  changeFiles: (files: readonly string[]) => `修改文件：${files.join(', ')}`,
  callTool: (tool: string, files: readonly string[]) => `调用 ${tool}${files.length > 0 ? `：${files.join(', ')}` : ''}`,
};
