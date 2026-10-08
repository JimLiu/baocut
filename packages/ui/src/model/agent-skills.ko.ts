import type { AgentSkillsMessages } from './agent-skills.ts';

export const ko: AgentSkillsMessages = {
  origin: { builtin: '내장', personal: '내 Skill', 'third-party': '서드파티' },
  all: '전체',
  commit: (sha: string) => `(${sha})`,
  bytes: (n: number) => `${n}바이트`,
  action: {
    load: 'Skill 목록 불러오기',
    toggle: '전환',
    add: '추가',
    import: '가져오기',
    remove: '제거',
    read: '파일 열기',
    send: '보내기',
  },
  exists: (id: string | null) =>
    `${id ? `이름이 “${id}”인` : '같은 이름의'} Skill이 이미 있으며 덮어쓰지 않습니다. 먼저 기존 Skill을 제거하거나 폴더 이름을 바꾼 뒤 다시 추가하세요.`,
  invalid: (issue: string) => `사용할 수 있는 Skill이 아닙니다: ${issue}. 루트 폴더에 name과 description으로 시작하는 SKILL.md가 있어야 합니다.`,
  tooLarge: (files: number, total: string, skillFile: string) =>
    `이 Skill이 너무 큽니다. Skill 하나는 최대 파일 ${files}개, 합계 ${total}까지이며 SKILL.md 자체는 최대 ${skillFile}입니다.`,
  githubNotFound: 'GitHub에서 이 저장소, 브랜치 또는 폴더를 찾지 못했습니다(비공개일 수 있습니다). 주소를 확인하세요.',
  folderNotFound: '이 폴더를 찾지 못했습니다. 이동했거나 삭제했을 수 있습니다.',
  urlInvalid: '주소를 인식하지 못했습니다. owner/repo 또는 https://github.com/owner/repo/tree/branch/folder 형식으로 입력하세요.',
  network: 'GitHub에 연결할 수 없습니다. 네트워크를 확인한 뒤 다시 시도하세요.',
  rateLimited: 'GitHub 익명 접근 한도에 도달했습니다. 잠시 후 다시 가져오세요.',
  offline: '엄격한 오프라인 모드가 켜져 있어 GitHub에서 가져올 수 없습니다.',
  builtinNotRemovable: '내장 Skill은 제거할 수 없지만 끌 수는 있습니다.',
  notFound: '이 Skill이 더 이상 없습니다. 방금 제거되었을 수 있습니다.',
  fileNotFound: '이 파일이 더 이상 없습니다.',
  fileTooLarge: '이 파일은 너무 커서 여기에 표시하지 않습니다. 폴더에서 열 수 있습니다.',
  fileNotText: '텍스트 파일이 아니어서 여기에 표시하지 않습니다.',
  webNotAllowed: '브라우저에서는 할 수 없습니다. BaoCut 데스크톱 앱을 사용하세요.',
  webReadOnly: '이 브라우저 세션은 읽기 전용이라 변경할 수 없습니다.',
  failed: (action: string, raw: string) => `${action}에 실패했습니다: ${raw}`,
  sendFailed: (raw: string) => `보내기 못했습니다: ${raw}`,
};
