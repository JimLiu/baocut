import type { RcAgentToolsMessages } from './rc-agent-tools.ts';

function exportKindLabel(kind: string): string {
  switch (kind) {
    case 'subtitles':
      return '자막';
    case 'transcript':
      return '전사본';
    case 'audio':
      return '오디오';
    case 'video':
      return '영상 파일';
    case 'portable':
      return '휴대용 패키지';
    case 'project':
      return '프로젝트 파일';
    default:
      return kind;
  }
}

function linkImportAfter(p: { target: string; name: string | null; transcribe: boolean; language: string | null; provider: string | null; model: string | null; captions: boolean }): string {
  const recognition = `${p.language ? `, 언어 ${p.language}` : ''}${p.provider ? `(${p.provider}${p.model ? ` ${p.model}` : ''})` : ''}`;
  if (p.target === 'create') {
    return `, 영상${p.name ? ` “${p.name}”` : '(페이지 제목으로 이름 지정)'} 만들기 및 타임라인에 추가${p.transcribe ? `, 이후 전사${recognition}${p.captions ? ' 및 자막 레이어 만들기' : ''}` : ''}`;
  }
  if (p.target === 'video') return `, 영상으로 가져오기${p.transcribe ? ' 및 전사' : ''}`;
  if (p.target === 'project') return `, 프로젝트의 downloads/에 저장${p.transcribe ? ' 및 TXT와 SRT로 전사' : ''}`;
  if (p.target === 'download') return `, 다운로드 폴더에 저장${p.transcribe ? ' 및 TXT와 SRT로 전사' : ''}`;
  return '';
}

export const ko: RcAgentToolsMessages = {

  instructionsNotSet: '세션 지침이 설정되지 않았습니다: Runtime 조립 순서가 잘못되었습니다',
  listSeparator: ', ',
  clauseSeparator: '; ',

  createVideoSummary: (p) => `영상 “${p.name}” 만들기`,
  editsSummary: (p) => `${p.label}(편집 ${p.count}개: ${p.types})`,
  captionsSummary: (p) => `문서 ${p.documentId}의 ${p.bilingual ? '이중 언어 ' : ''}자막 레이어 추가`,
  captionsLabel: '자막 레이어 추가',
  undoSummary: (p) => `수정 ${p.transactionId} 실행 취소`,
  undoLatestSummary: '최근 수정 실행 취소',
  deleteVideoSummary: (p) =>
    `영상 “${p.name}”(${p.path}) 삭제: 휴지통으로 옮기며 ${p.days}일 동안 Space에서 복원할 수 있습니다. 연결된 소재의 원본 파일은 그대로 둡니다`,
  importPackageSummary: (p) => `휴대용 패키지 ${p.file} 열기`,
  renameVideoLabel: '영상 이름 변경',
  putDocumentSummary: (p) => `문서 ${p.documentId}의 새 버전 쓰기`,
  newDocumentSummary: (p) => `문서 만들기(${p.kind})`,
  updateDocumentLabel: (p) => `문서 “${p.name}” 업데이트`,
  newDocumentLabel: (p) => `문서 “${p.name}” 만들기`,
  translationDocumentName: (p) => `${p.language} 번역`,
  importAssetSummary: (p) => `소재 ${p.name} 가져오기${p.place ? ' 및 타임라인에 추가' : ''}`,
  importAssetLabel: (p) => `${p.name} 가져오기${p.place ? ' 및 타임라인에 추가' : ''}`,
  replaceCompositionSummary: (p) => `${p.name} 가져오기 및 타임라인의 클립 ${p.clip} 교체`,
  replaceCompositionLabel: (p) => `모션 그래픽을 ${p.name}(으)로 교체`,
  pruneAssetsSummary: (p) => `사용하지 않는 소재를 동영상에서 삭제(${p.count}개): ${p.names}`,
  pruneAssetsLabel: (p) => `사용하지 않는 소재 정리(${p.count}개)`,
  adoptChaptersSummary: (p) => `${p.asset}의 원본 챕터 적용(${p.count}개)${p.existing ? `, 기존 챕터 ${p.existing}개 대체` : ''}`,
  adoptChaptersLabel: '원본 챕터 적용',

  transcribePurpose: (p) => `소재 ${p.assetId} 전사`,
  transcribeSummary: (p) => `소재 ${p.assetId} 전사${p.provider ? `(${p.provider}${p.model ? ` ${p.model}` : ''})` : ''}`,
  speechPurpose: (p) => `음성 합성(${p.chars}자)`,
  speechSummary: (p) => `음성 합성(${p.chars}자${p.provider ? `, ${p.provider}` : ''}${p.voice ? `, 목소리 ${p.voice}` : ''})`,
  imagePurpose: (p) => `이미지 생성: ${p.prompt}`,
  imageSummary: (p) => `이미지 생성(${p.count}장${p.size ? `, ${p.size}` : ''}${p.provider ? `, ${p.provider}` : ''}): ${p.prompt}`,
  cancelJobSummary: (p) => `작업 ${p.jobId} 취소`,
  retryPipelineSummary: (p) => `실패한 단계부터 파이프라인 ${p.jobId} 다시 실행(${p.pipeline}, ${p.attempt}번째 시도)`,
  saveArtifactSummary: (p) => `결과물 ${p.artifactId}을(를) ${p.path}에 저장`,
  overwriteArtifactSummary: (p) => `결과물 ${p.artifactId}의 내용으로 기존 파일 ${p.path} 덮어쓰기`,

  exportSummary: (p) => {
    const range = p.rangeStart !== null ? `, ${p.rangeStart}–${p.rangeEnd}초` : p.rangeCount !== null ? `, 구간 ${p.rangeCount}개` : '';
    const size =
      p.width !== null && p.height !== null
        ? `, ${p.width}×${p.height}`
        : p.width !== null
          ? `, 너비 ${p.width}`
          : p.height !== null
            ? `, 높이 ${p.height}`
            : '';
    const source = p.originalOnly ? ', 원본 오디오만' : p.dubGroupId ? `, 더빙 ${p.dubGroupId}만` : '';
    return `${exportKindLabel(p.kind)} 내보내기(${p.format}${range}${size}${source})${p.fileName ? `, 파일 이름 ${p.fileName}` : ''}${p.overwrite ? ', 기존 파일 덮어쓰기' : ''}`;
  },

  installToolSummary: (p) =>
    `${p.url}에서 ${p.tool} ${p.version} 설치(${p.estimated ? `약 ${p.size}` : p.size}, ${p.license}): 링크에서 영상을 다운로드하는 데 쓰며 ${p.host}에서 다운로드하려면 필요합니다`,
  linkImportSummary: (p) => `${p.host}에서 다운로드(${p.tool}${p.version ? ` ${p.version}` : ''} 사용): ${p.url}${linkImportAfter(p)}`,
  linkImportConsentSummary: (p) =>
    `BaoCut이 이 컴퓨터의 ${p.tool}${p.version ? ` ${p.version}` : ''}${p.path ? `(${p.path})` : ''} 도구로 웹사이트에서 영상을 다운로드하도록 허용하고 ${p.host}에서 다운로드: ${p.url}${linkImportAfter(p)}`,

  downloadSaveSummary: (p) =>
    `작업 폴더의 ${p.source}(${p.size}) 파일을 다운로드 폴더에 복사: ${p.target}(이름이 겹치면 번호를 붙이며 덮어쓰지 않음)`,

  grantSummary: (p) => `${p.recipients}에 데이터 공유: ${p.items}`,
  grantSummaryItem: (p) => `${p.purpose}(${p.maxCalls === null ? '호출 횟수 제한 없음' : `최대 ${p.maxCalls}회 호출`})`,

  testModelSummary: (p) => `로컬 모델 패키지 ${p.bundleId} 확인: 고정 샘플로 처음부터 끝까지 실행`,
  installModelSummary: (p) =>
    `로컬 모델 ${p.bundleId} 다운로드: ${p.estimated ? `약 ${p.size}(크기를 알 수 없어 추정)` : p.size}${p.resumed ? `, 이미 받은 ${p.resumed}부터 이어 받기` : ''}, 출처 ${p.source}(${p.parts})`,

  registerProjectSummary: (p) => `기존 폴더를 프로젝트로 등록: ${p.path}${p.name ? `(${p.name})` : ''}`,
  createProjectSummary: (p) => `프로젝트 폴더 ${p.path}${p.name ? `(${p.name})` : ''} 만들기`,
  adoptSessionSummary: (p) => `프로젝트${p.name ? ` '${p.name}'` : '(첫 번째 동영상 이름)'}를 만들고 이 세션의 동영상과 파일을 옮기기`,
};
