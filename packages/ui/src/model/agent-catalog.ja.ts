import type { AgentCatalogMessages } from './agent-catalog.ts';

export const ja: AgentCatalogMessages = {
  idEmpty: 'id を入力してください（例：my-agent）',
  idPattern: 'id は英小文字で始め、英小文字、数字、ハイフンだけを使ってください',
  idTooLong: 'id は 63 文字以内にしてください',
  idBuiltin: (id: string, who: string | null) => `「${id}」は BaoCut 内蔵の Agent の id です${who ? `（${who}）` : ''}。別の id を選んでください`,
  idTaken: (id: string, who: string | null) => `「${id}」は別の Agent がすでに使っています${who ? `（${who}）` : ''}。別の id を選んでください`,
  nameEmpty: '一覧に表示する名前を入力してください',
  nameTooLong: (max: number) => `名前は ${max} 文字以内にしてください`,
  commandEmpty: '起動するコマンドを入力してください（例：my-agent --acp）',
  commandShell: 'コマンドは 1 つだけ入力してください。BaoCut はシェルを介さず直接起動するため、パイプ、リダイレクト、&& は使えません',
  tooManyArgs: (max: number) => `引数が多すぎます：${max} 個まで`,
  envLine: (line: number) => `${line} 行目は KEY=VALUE の形式にし、KEY は英字またはアンダースコアで始めてください`,
};
