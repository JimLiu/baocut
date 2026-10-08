import type { RcFlowToolsMessages } from './rc-flow-tools.ts';

function providerNote(p: { provider: string | null; model: string | null }): string {
  return p.provider ? `(${p.provider}${p.model ? ` ${p.model}` : ''})` : '';
}

function originalLabel(original: string): string {
  switch (original) {
    case 'mute':
      return '음소거';
    case 'keep':
      return '유지';
    default:
      return '낮추기';
  }
}

function transcodeAction(action: string): string {
  switch (action) {
    case 'merge':
      return '순서대로 병합';
    case 'extract-audio':
      return '오디오 추출';
    default:
      return '압축';
  }
}

export const ko: RcFlowToolsMessages = {
  listSeparator: ', ',

  transcribeVideoSummary: (p) =>
    `${p.asset ? `소재 ${p.asset}` : '메인 트랙의 소재'} 전사${providerNote(p)}${p.captions ? ' 및 자막 레이어 추가' : ''}`,
  transcribeFileSummary: (p) => `${p.file} 전사${providerNote(p)}, TXT와 SRT 전사본을 ${p.outDir ?? '다운로드 폴더'}에 저장`,
  transcribeCreateSummary: (p) =>
    `영상${p.name ? ` “${p.name}”` : ''} 만들기, ${p.file} 가져와 타임라인에 추가한 뒤 전사${providerNote(p)}${p.captions ? ' 및 자막 레이어 추가' : ''}`,

  translateVideoSummary: (p) =>
    `텍스트 모델로 전사본을 ${p.to}(으)로 번역${providerNote(p)}${p.captions ? ` 및 ${p.bilingual ? '이중 언어 ' : ''}자막 레이어 추가` : ''}`,
  translateFileSummary: (p) =>
    `텍스트 모델로 자막 파일 ${p.input}을(를) ${p.to}(으)로 번역${providerNote(p)}, 새 파일을 ${p.outDir ?? '다운로드 폴더'}에 저장`,

  dubSummary: (p) =>
    `번역 더빙${p.to ? `(${p.to})` : ''}: ${p.translation ? `번역 ${p.translation} 사용` : '먼저 텍스트 모델로 번역'}, 문장별 합성${providerNote(p)}${p.voice ? `, 목소리 ${p.voice}` : ''}, 새 더빙 트랙 추가, 원본 오디오 ${originalLabel(p.original)}`,

  transcodeSummary: (p) =>
    `파일 ${p.count}개 ${transcodeAction(p.action)}(${p.files}${p.truncated ? '…' : ''}), ${p.outDir ?? '다운로드 폴더'}에 저장`,
  transcribeReplaceSummary: (p) =>
    `${p.asset ? `소재 ${p.asset}` : '메인 트랙의 소재'} 다시 전사${providerNote(p)}, 동영상의 현재 전사본을 대체하고 번역, 자막, 더빙 이어 받기(실행 취소할 수 있는 한 번의 작업)`,
};
