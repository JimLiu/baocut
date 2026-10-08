import type { SpaceActionsMessages } from './space-actions-copy.ts';

export const ko: SpaceActionsMessages = {
  edit: {
    video: '영상 열기',
    'source-video': '원본 영상에서 편집',
    'new-video': '이 소재로 새 영상 만들기',
    text: '텍스트 편집',
    version: '사본을 저장하고 편집',
  },
  trashed: '먼저 휴지통에서 이 항목을 복원하세요',
  editGenerating: '아직 생성 중입니다. 완료된 뒤 편집할 수 있습니다',
  editMissing: '파일을 찾을 수 없습니다. 편집하려면 먼저 다시 연결하세요',
  editFailed: '생성에 실패해 편집할 파일이 없습니다',
  editPackage: '영상 패키지(휴대용 패키지)는 편집할 수 없습니다',
  editText: '여기서는 아직 텍스트의 새 버전을 저장할 수 없습니다. 세션에서 이어 가며 Agent에게 수정을 맡기세요',
  editVersion: '이미지, 오디오, 템플릿을 직접 수정하는 기능은 아직 없습니다. 세션에서 이어 가며 Agent에게 수정을 맡기세요',
  newVideoOutside: '이 파일은 프로젝트나 세션 폴더에 없어 아직 새 영상에 쓸 수 없습니다',
  packageGenerating: '아직 내보내는 중입니다. 완료된 뒤 열 수 있습니다',
  packageMissing: '이 파일을 찾을 수 없습니다',
  packageFailed: '내보내기에 실패해 열 수 있는 패키지가 없습니다',
  packageOutside: '이 패키지는 프로젝트나 세션 폴더에 없어 아직 열 수 없습니다',
  continueTrashed: '세션으로 가져오기 전에 휴지통에서 이 항목을 복원하세요',
  purgeGenerating: '작업이 아직 진행 중입니다. 먼저 작업 페이지에서 취소하세요',
  purgeNotTrashed: '먼저 휴지통으로 옮긴 뒤 휴지통에서 삭제하세요',
  referenceKind: {
    'video-asset': '영상 소재',
    job: '진행 중인 작업',
    unverified: '확인할 수 없음',
    'user-file': '영상 폴더의 기타 파일',
  },
  importAllFailed: (count: number, error: string) => `파일 ${count}개를 하나도 가져오지 못했습니다: ${error}`,
  importFailed: (error: string) => `가져오지 못했습니다: ${error}`,
  imported: (count: number) => `소재 ${count}개를 가져왔습니다`,
  copiedAll: '프로젝트의 imports/에 복사됨',
  copiedSome: (count: number) => `${count}개는 프로젝트의 imports/에 복사됨`,
  notImported: (count: number) => `${count}개는 가져오지 못함`,
  references: (names: readonly string[], total: number) => {
    const quoted = names.map((name) => `“${name}”`).join(', ');
    return total > names.length ? `Space 항목 ${quoted} 외 ${total - names.length}개` : `Space 항목 ${quoted}`;
  },
  referenceOutput: '결과물',
};
