import type { AgentCatalogMessages } from './agent-catalog.ts';

export const zhHans: AgentCatalogMessages = {
  idEmpty: '填一个 id，例如 my-agent',
  idPattern: 'id 要以小写字母开头，只能用小写字母、数字和连字符',
  idTooLong: 'id 最长 63 个字符',
  idBuiltin: (id: string, who: string | null) => `「${id}」是 BaoCut 内置 Agent 的 id${who ? `（${who}）` : ''}，换一个 id`,
  idTaken: (id: string, who: string | null) => `已经有一个 Agent 用了「${id}」${who ? `（${who}）` : ''}，换一个 id`,
  nameEmpty: '填一个显示在列表里的名字',
  nameTooLong: (max: number) => `名字最长 ${max} 个字`,
  commandEmpty: '填启动它的命令，例如 my-agent --acp',
  commandShell: '只填一条命令：BaoCut 直接启动它，不经过终端，管道、重定向和 && 都不生效',
  tooManyArgs: (max: number) => `参数太多：最多 ${max} 个`,
  envLine: (line: number) => `第 ${line} 行要写成 KEY=VALUE，KEY 以字母或下划线开头`,
};
