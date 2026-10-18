import type { ProjectSettingsMessages } from './project-settings-copy.ts';

export const ko: ProjectSettingsMessages = {
  menuItem: '프로젝트 설정…',
  title: '프로젝트 설정',
  close: '프로젝트 설정 닫기',
  done: '완료',
  loading: 'git 확인 중',
  loadFailed: (message: string) => `git을 확인하지 못했습니다: ${message}`,

  gitHeading: 'git',
  gitLead: 'BaoCut은 영상의 작업 공간 스냅숏을 프로젝트가 있는 git 저장소에 커밋할 수 있습니다. 버전 기록은 git이 필요 없으며 저장소 밖에서도 똑같이 동작합니다.',
  branch: (name: string) => `브랜치 ${name}`,
  gitVersion: (version: string) => `git ${version}`,
  checkAgain: '다시 확인',
  sentences: (first: string, second: string | null) => (second ? `${first}. ${second}.` : `${first}.`),

  lightReady: '준비됨',
  lightPaused: (label: string) => `일시 중지됨 · ${label}`,
  lightNotRepo: 'git 저장소에 없음',
  lightUnavailable: 'git을 찾을 수 없음',
  lightError: 'git 실패',
  pauseLocked: '저장소 사용 중',
  pauseMerge: '병합 진행 중',
  pauseRebase: '리베이스 진행 중',
  pauseCherryPick: '체리픽 진행 중',
  pauseRevert: '되돌리기 진행 중',
  pauseBisect: 'bisect 진행 중',
  pauseDetached: 'HEAD 분리됨',
  pauseLocalConfig: '로컬 필터 있음',
  pauseLocalConfigChanged: '로컬 필터 변경됨',

  pausedHeading: (label: string) => `커밋 일시 중지됨: ${label}`,
  pausedNote: '커밋이 일시 중지된 동안 자동 커밋과 “git에 커밋”은 대기합니다. 열기, 편집, 버전 기록에는 영향이 없습니다.',
  errorHeading: 'git 실패',
  unavailableHeading: 'git을 찾을 수 없음',

  lcEntry: '항목',
  lcValue: '명령 또는 포함된 파일',
  lcExplain:
    '허용하면 BaoCut은 git을 실행할 때 이 항목을 따릅니다(예: git-crypt 암호화). 허용 여부는 프로젝트가 아니라 이 컴퓨터에만 저장되며, 항목이나 포함된 파일이 바뀌면 BaoCut이 다시 일시 중지합니다. 폴더를 신뢰하는 것은 아닙니다. 열기, 편집, Agent에는 영향이 없습니다.',
  lcWeb:
    '이 항목은 BaoCut 데스크톱 앱의 프로젝트 설정에서만 표시되고 허용할 수 있습니다(또는 baocut projects git-allow 사용). 커밋이 일시 중지된 동안에도 열기, 편집, 버전 기록에는 영향이 없습니다.',
  allow: '허용',
  allowedTitle: '로컬 필터를 허용했습니다',
  allowedText: '허용 여부는 프로젝트가 아니라 이 컴퓨터에 저장됩니다. 이제 커밋할 수 있습니다.',
  allowFailed: '허용하지 못함',

  commit: 'git에 커밋',
  committing: '커밋 중',
  commitDesc: (maxMiB: number) =>
    `BaoCut의 파일만 커밋합니다: 변경된 영상의 작업 공간 스냅숏과 ${maxMiB} MiB 이하의 소재입니다. 프로젝트의 다른 파일과 이미 스테이징한 변경 사항은 그대로 둡니다. BaoCut은 푸시하지 않습니다.`,
  lastCommit: (commit: string, auto: boolean, ago: string) => `마지막 커밋 ${commit} · ${auto ? '자동' : '수동'} · ${ago}`,
  lastFailed: (message: string) => `마지막 시도 실패: ${message}`,
  committedTitle: 'git에 커밋했습니다',
  committedText: (commit: string, files: number, videos: string[]) =>
    `커밋 ${commit} 완료: 파일 ${files}개${videos.length ? `, ${videos.join(', ')}` : ''}.`,
  committedVideo: (name: string, from: number | null, to: number | null) =>
    from === null || to === null ? `“${name}”` : from === to ? `“${name}” 버전 ${to}` : `“${name}” 버전 ${from}–${to}`,
  unnamedVideo: '이름 없는 영상',
  nothingTitle: '커밋할 변경 사항 없음',
  nothingText: 'BaoCut의 파일이 마지막 커밋 때와 같습니다.',
  commitFailed: '커밋하지 못함',

  autoCommit: '자동 커밋',
  autoCommitDesc:
    '프로젝트에 5분 동안 변경이 없을 때, 프로젝트에서 마지막으로 열려 있던 영상을 닫을 때, BaoCut을 종료할 때 한 번 커밋합니다. 이 컴퓨터의 모든 프로젝트가 이 설정을 공유합니다.',

  initTitle: 'git 초기화',
  initDesc: '프로젝트 폴더에 git 저장소를 만들어 스냅숏을 커밋할 수 있게 합니다.',
  initWebNote: 'Runtime이 실행되는 컴퓨터의 폴더에 저장소를 만드는 것은 BaoCut 데스크톱 앱이나 CLI(baocut projects git-init)에서만 할 수 있습니다.',
  initRefused: (why: string) => `여기서는 사용할 수 없음: ${why}`,
  initRefusedNote: '필요하다면 영상을 별도의 프로젝트 폴더로 옮긴 뒤 그곳에서 git을 초기화하세요.',
  refusalHome: '프로젝트가 홈 폴더입니다. 여기에 저장소를 만들면 다른 도구에서는 홈 폴더 안의 모든 폴더가 이 저장소에 속한 것처럼 보입니다.',
  refusalUserFolder:
    '프로젝트가 표준 사용자 폴더(데스크탑, 문서, 다운로드, 동영상, 음악, 사진 등)입니다. 여기에 저장소를 만들면 다른 도구에서는 그 안의 모든 폴더가 이 저장소에 속한 것처럼 보입니다.',
  refusalVolumeRoot: '프로젝트가 디스크의 루트입니다. 여기에 저장소를 만들면 디스크 전체가 이 저장소에 속한 것처럼 보입니다.',
  refusalInsideRepo: '프로젝트가 이미 git 저장소 안에 있습니다.',
  initConfirmTitle: '프로젝트 폴더에서 git을 초기화할까요?',
  initConfirmBody: (path: string) =>
    `${path}에 git 저장소를 만듭니다. BaoCut의 무시 규칙은 저장소 자체의 .git/info/에 들어가므로 프로젝트의 파일은 바뀌지 않습니다. 커밋이나 푸시는 하지 않습니다.`,
  cancel: '취소',
  initDoneTitle: 'git 초기화됨',
  initDoneText: '아직 커밋한 것이 없습니다. “git에 커밋”으로 첫 커밋을 만드세요.',
  initFailed: '초기화하지 못함',

  recheckSame: '변경된 것이 없습니다',
  recheckReadyTitle: '커밋할 준비가 되었습니다',
  recheckReadyText: '저장소가 더 이상 일시 중지되어 있지 않습니다.',

  outsideHeading: '프로젝트 밖의 소재',
  outsideLead:
    '영상이 프로젝트 폴더 밖의 소재를 사용하면 작업 공간 스냅숏에는 그 소재의 경로가 기록됩니다(홈 폴더 아래는 ~/로 시작하고, 그 외에는 전체 경로). 커밋하거나 푸시한 뒤 다른 사람은 파일이 아닌 경로만 받게 됩니다. 소재도 함께 넘기려면 휴대용 패키지를 사용하세요.',

  stripLabel: '프로젝트 git',
  projectSettings: '프로젝트 설정',
};
