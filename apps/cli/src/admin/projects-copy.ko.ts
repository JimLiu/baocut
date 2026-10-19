import type { ProjectsMessages } from './projects-copy.ts';

export const ko: ProjectsMessages = {
  help: `사용법:
  baocut projects git-status [<프로젝트>]
                                   프로젝트의 git 상태: 저장소, 브랜치, BaoCut이 커밋할 수 있는지와
                                   일시 중지된 이유 (커밋은 baocut projects git-commit)
  baocut projects git-init [<프로젝트>]
                                   프로젝트 폴더에서 git 초기화 (홈 폴더, 표준 사용자 폴더, 볼륨의 루트,
                                   다른 저장소 안에서는 하지 않음)
  baocut projects git-allow [<프로젝트>] [--yes]
                                   저장소 로컬 설정의 필터와 include를 보여 준 뒤 허용합니다. 허용하기 전에는
                                   BaoCut이 그것들을 실행하는 git 명령을 실행하지 않습니다
  <프로젝트>는 프로젝트 ID, 이름 또는 폴더이며, 생략하면 현재 폴더를 포함하는 프로젝트`,
  noProject: (cwd) => `${cwd}을(를) 포함하는 프로젝트가 없습니다. 프로젝트 ID, 이름 또는 폴더를 지정하세요 (baocut projects list)`,
  unknownProject: (text) => `프로젝트를 찾을 수 없습니다: ${text} (baocut projects list)`,
  ambiguousProject: (text) => `이름이 ${text}인 프로젝트가 여러 개입니다. ID로 지정하세요`,
  states: {
    ready: '준비됨',
    paused: '일시 중지됨',
    'not-repo': 'git 저장소에 없음',
    unavailable: 'git 사용 불가',
    error: '오류',
  },
  head: (name, id) => `프로젝트 ${name} (${id})`,
  state: (state) => `Git: ${state}`,
  branch: (branch) => `브랜치: ${branch}`,
  detached: '브랜치: (분리된 HEAD)',
  version: (version) => `git 버전: ${version}`,
  repo: (root) => `저장소: ${root}`,
  autoCommit: (on) => `자동 커밋: ${on ? '켬' : '끔'}`,
  lastCommit: (commit, auto, at) => `마지막 커밋: ${commit.slice(0, 12)} (${auto ? '자동' : '수동'}, ${at})`,
  lastError: (message) => `마지막 오류: ${message}`,
  entriesHead: '로컬 필터와 include:',
  entry: (key, value, file) => `  ${key} = ${value}${file ? `  (${file})` : ''}`,
  allowHint: '확인한 뒤 baocut projects git-allow로 허용하세요',
  initDone: (root) => `${root}에서 git을 초기화했습니다`,
  nothingToAllow: '이 저장소에는 허용을 기다리는 로컬 필터나 include가 없습니다',
  allowPrompt: '이 항목들을 허용할까요? BaoCut이 이것들을 실행하는 git 명령을 실행합니다 [y/N] ',
  notTtyAllow: '터미널이 아닙니다: baocut projects git-status로 항목을 확인한 뒤 --yes를 붙여 다시 실행하세요',
  notAllowed: '허용하지 않음: 이 저장소에서 BaoCut의 커밋은 계속 일시 중지됩니다',
  allowed: '허용함: BaoCut이 이 저장소에 다시 커밋합니다',
};
