import type { AgentCatalogMessages } from './agent-catalog.ts';

export const zhHant: AgentCatalogMessages = {
  idEmpty: '請輸入 id，例如 my-agent',
  idPattern: 'id 必須以小寫字母開頭，只能使用小寫字母、數字和連字號',
  idTooLong: 'id 最多 63 個字元',
  idBuiltin: (id: string, who: string | null) => `「${id}」是 BaoCut 內建 Agent 的 id${who ? `（${who}）` : ''}，請換一個 id`,
  idTaken: (id: string, who: string | null) => `已有 Agent${who ? `（${who}）` : ''}使用「${id}」，請換一個 id`,
  nameEmpty: '請輸入要顯示在清單中的名稱',
  nameTooLong: (max: number) => `名稱最多 ${max} 字`,
  commandEmpty: '請輸入啟動它的指令，例如 my-agent --acp',
  commandShell: '只能輸入一條指令：BaoCut 會直接啟動它，不經過 shell，所以管線、重新導向和 && 都無效',
  tooManyArgs: (max: number) => `參數太多：最多 ${max} 個`,
  envLine: (line: number) => `第 ${line} 行必須寫成 KEY=VALUE，KEY 以字母或底線開頭`,
};
