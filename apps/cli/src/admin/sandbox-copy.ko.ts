import type { SandboxMessages } from './sandbox-copy.ts';

export const ko: SandboxMessages = {
  help: `사용법:
  baocut sandbox create <폴더> [--link-accounts-from <home>]
                                   개발과 테스트용으로 별도의 Runtime 홈을 만듭니다. 그 폴더와 안의 projects 폴더, 이
                                   체크아웃의 CLI를 그 홈에서 실행하는 bin/baocut, shell을 전환하는 env.sh / env.ps1을
                                   만듭니다. 다시 실행하면 이 파일들을 새로 씁니다. 저장소에서 실행할 때만 쓸 수 있고, 기본
                                   ~/.baocut은 쓸 수 없습니다
    --link-accounts-from <home>    그 홈(보통 ~/.baocut)의 모델 계정도 읽기 전용으로 연결합니다(baocut models accounts link
                                   --from과 같음). 호출에는 실제 계정을 쓰며 평소대로 과금됩니다`,
  defaultHome: (dir) => `${dir}은(는) 실제 데이터가 있는 기본 Runtime 홈입니다. 샌드박스에는 다른 폴더를 고르세요`,
  needsSourceCli:
    'baocut sandbox create는 저장소에서만 실행할 수 있습니다(node apps/cli/src/main.ts sandbox create …). 이 CLI는 BaoCut 앱의 Runtime을 시작하며, 그 Runtime은 모든 홈이 함께 쓰는 시스템 키체인에 키를 저장합니다. 거기에 샌드박스를 만들면 실제 키를 덮어쓰거나 지울 수 있습니다',
  unknownStore: (entry) => `BAOCUT_RUNTIME_ENTRY가 ${entry}을(를) 가리키고 있어 그 Runtime이 키를 어디에 저장하는지 알 수 없습니다. 샌드박스를 만들기 전에 이 변수를 해제하세요`,
  notEmpty: (dir) => `${dir}에는 이미 파일이 있고 BaoCut 홈도 아닙니다. 새 폴더나 빈 폴더를 고르세요`,
  notFolder: (dir) => `${dir}은(는) 폴더가 아닙니다`,
  created: (dir) => `샌드박스를 만들었습니다: ${dir}`,
  refreshed: (dir) => `샌드박스를 새로 고쳤습니다: ${dir}`,
  projects: (dir) => `  프로젝트  ${dir}`,
  cli: (file) => `  baocut    ${file}(이 체크아웃의 CLI 실행)`,
  useHeader: 'shell에서 쓰려면:',
  useShell: (file) => `  ${file}`,
  usePowerShell: (file) => `  ${file}   (PowerShell)`,
  useNote:
    '그러면 그 shell의 baocut과 거기서 시작한 Agent가 샌드박스를 씁니다. 다른 shell은 계속 ~/.baocut을 씁니다. 이 Runtime은 키를 샌드박스 안의 파일에 저장합니다',
  linkFailed: (dir) => `${dir}의 샌드박스는 만들었지만 계정 연결에 실패했습니다:`,
};
