import type { AgentCatalogMessages } from './agent-catalog.ts';

export const ko: AgentCatalogMessages = {
  idEmpty: 'id를 입력하세요. 예: my-agent',
  idPattern: 'id는 영문 소문자로 시작해야 하며 영문 소문자, 숫자, 하이픈만 쓸 수 있습니다',
  idTooLong: 'id는 최대 63자입니다',
  idBuiltin: (id: string, who: string | null) => `“${id}”은(는) BaoCut 내장 Agent${who ? `(${who})` : ''}의 id입니다. 다른 id를 입력하세요`,
  idTaken: (id: string, who: string | null) => `다른 Agent${who ? `(${who})` : ''}가 이미 “${id}”을(를) 쓰고 있습니다. 다른 id를 입력하세요`,
  nameEmpty: '목록에 표시할 이름을 입력하세요',
  nameTooLong: (max: number) => `이름은 최대 ${max}자입니다`,
  commandEmpty: '실행할 명령을 입력하세요. 예: my-agent --acp',
  commandShell: '명령은 하나만 입력하세요. BaoCut은 셸을 거치지 않고 직접 실행하므로 파이프, 리디렉션, &&가 동작하지 않습니다',
  tooManyArgs: (max: number) => `인수가 너무 많습니다: 최대 ${max}개`,
  envLine: (line: number) => `${line}번째 줄은 KEY=VALUE 형식이어야 하며, KEY는 영문자나 밑줄로 시작해야 합니다`,
};
