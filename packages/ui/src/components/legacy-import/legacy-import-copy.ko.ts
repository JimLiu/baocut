import type { LegacyImportMessages } from './legacy-import-copy.ts';

export const ko: LegacyImportMessages = {
  title: '이전 버전의 프로젝트를 가져올까요?',
  lead: (n) =>
    `이 컴퓨터에 이전 버전 BaoCut의 프로젝트가 ${n}개 있습니다. 가져오면 새 버전에서 계속 편집할 수 있습니다. 원본 파일은 그 자리에 그대로 남고 변경되지 않습니다.`,
  found: '찾은 프로젝트',
  destination: '가져올 위치',
  resetDefault: '기본값으로 되돌리기',
  change: '변경…',
  pickTitle: '가져올 위치 선택',
  destinationNote: '이 폴더는 Home에 하나의 프로젝트로 표시되고, 이전 프로젝트는 각각 그 안의 비디오가 됩니다.',
  hint: '건너뛰면 다음에 시작할 때 다시 묻습니다. ‘다시 알리지 않음’을 선택하면 가져오지 않습니다.',
  never: '다시 알리지 않음',
  skip: '건너뛰기',
  import: '가져오기',
  importing: (n) => `이전 프로젝트 ${n}개를 백그라운드에서 가져오는 중`,
  neverDone: '이전 프로젝트 가져오기를 다시 알리지 않습니다. 원본 파일은 그대로 유지됩니다',
  skipped: '건너뛰었습니다. 다음에 시작할 때 다시 묻습니다',
  failed: (message) => `가져오지 못했습니다: ${message}`,
};
