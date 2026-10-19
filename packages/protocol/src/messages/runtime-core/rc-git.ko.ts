import type { RcGitMessages } from './rc-git.ts';

export const ko: RcGitMessages = {
  gitPurpose: '프로젝트의 BaoCut 파일을 git에 커밋합니다(선택 사항)',
  gitMissingRemedyMac: 'git을 설치하세요: 터미널에서 xcode-select --install을 실행해 명령줄 도구를 설치하거나 Homebrew로 설치합니다(brew install git)',
  gitMissingRemedyWin: 'https://git-scm.com/download/win 에서 Git for Windows를 설치하세요',
  gitMissingRemedyLinux: '패키지 관리자로 git을 설치하세요',
  xcodeStub: '명령줄 도구를 설치하기 전까지 /usr/bin/git은 설치 안내만 띄웁니다',

  notRepo: '이 프로젝트는 git 저장소 안에 있지 않습니다',
  initRemedy: 'BaoCut 데스크톱 앱의 프로젝트 설정에서 “git 초기화”를 사용하거나 baocut projects git-init을 실행하거나, 저장소를 둘 위치에서 직접 git init을 실행하세요',
  initHome: 'BaoCut은 홈 폴더에 git 저장소를 만들지 않습니다: 그 안의 모든 폴더가 다른 도구에서 하나의 저장소에 속한 것처럼 보이게 됩니다',
  initUserFolder: (p) => `BaoCut은 표준 사용자 폴더(${p.path})에 git 저장소를 만들지 않습니다: 그 안의 모든 폴더가 다른 도구에서 하나의 저장소에 속한 것처럼 보이게 됩니다`,
  initVolumeRoot: 'BaoCut은 볼륨이나 드라이브의 루트에 git 저장소를 만들지 않습니다',
  initInsideRepo: '이 프로젝트는 이미 git 저장소 안에 있습니다',
  initElsewhere: '먼저 프로젝트를 별도 폴더로 옮기거나, 저장소를 두려는 위치에서 직접 git init을 실행하세요',
  pausedLocked: '다른 git 명령이 저장소를 사용 중입니다(index.lock이 있음)',
  lockedRemedy: '다른 git 명령이 끝날 때까지 기다리세요. BaoCut은 다음 커밋 때 다시 시도하며 잠금 파일을 절대 삭제하지 않습니다. 실행 중인 git 명령이 없다면 잠금 파일을 직접 삭제하세요',
  pausedMerge: '저장소가 병합 중입니다',
  pausedRebase: '저장소가 리베이스 중입니다',
  pausedCherryPick: '저장소가 체리픽 중입니다',
  pausedRevert: '저장소가 되돌리기 중입니다',
  pausedBisect: '저장소가 bisect 중입니다',
  pausedDetached: 'HEAD가 분리되어 있습니다(저장소가 어떤 브랜치에도 있지 않음)',
  repoStateRemedy: 'git에서 완료하거나 중단하세요. 그 후 BaoCut이 다시 커밋합니다',
  detachedRemedy: 'git에서 브랜치로 전환하세요. 그 후 BaoCut이 다시 커밋합니다',
  pausedLocalConfig: '저장소의 로컬 설정이 프로그램을 실행하거나 다른 파일을 포함하므로(필터 또는 include) BaoCut은 파일을 읽는 git 명령을 실행하지 않습니다',
  pausedLocalConfigChanged: '허용한 뒤 저장소의 로컬 필터 또는 include가 바뀌어 BaoCut이 대신 커밋하기를 다시 일시 중지했습니다',
  localConfigRemedy: '항목과 실행되는 명령을 확인한 뒤 BaoCut 데스크톱 앱의 프로젝트 설정에서 또는 baocut projects git-allow로 허용하세요',
  gitFailed: (p) => `이 저장소에서 git이 실패했습니다: ${p.detail}`,

  manageOnlyInAppOrCli: 'git 초기화와 로컬 필터 허용은 데스크톱 앱이나 CLI에서만 할 수 있습니다',
  digestChanged: '확인한 뒤 로컬 설정이 바뀌었습니다. 항목을 다시 확인하세요',
  commitFailed: (p) => `git 커밋에 실패했습니다: ${p.detail}`,
  initFailed: (p) => `git 초기화에 실패했습니다: ${p.detail}`,

  commitSummary: (p) => `프로젝트 "${p.name}"의 BaoCut 파일을 git에 커밋`,
  commitTitle: (p) => `BaoCut: ${p.names} 업데이트`,
};
