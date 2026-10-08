import type { FontsMessages } from './fonts-copy.ts';

export const ko: FontsMessages = {
  help: `사용법:
  baocut fonts [downloaded]        다운로드한 글꼴(Google Fonts, 필요할 때 다운로드):
                                   패밀리, 굵기, 크기, 라이선스와 총 크기
  baocut fonts search [텍스트] [--category <분류>] [--script <문자>] [--limit <n>]
                                   글꼴 선택 목록: 앱에 포함된 패밀리, 이 컴퓨터의 패밀리, 글꼴 카탈로그의 패밀리와
                                   상태(내장, 이 컴퓨터, 다운로드됨, 다운로드 가능, 다운로드 중, 실패).
                                   분류: sans-serif, serif, display, handwriting, monospace.
                                   문자: chinese, japanese, korean, latin…
  baocut fonts download <패밀리> [--weights 400,700] [--italic]
                                   패밀리를 다운로드합니다(기본값은 보통과 굵게). 진행 상황은 stderr에 출력되며
                                   Ctrl-C로 취소합니다. 패밀리 이름과 굵기만 전송합니다. 미러는 설정
                                   fonts.cssEndpoint와 fonts.fileEndpoint를 참고하세요. 엄격한 오프라인 모드에서는 거부됩니다
  baocut fonts remove <패밀리>     이 패밀리의 다운로드한 글꼴을 삭제합니다(끝나지 않은 내보내기가 쓰는 중이면 거부)
  baocut fonts clear               다운로드한 글꼴을 비웁니다(끝나지 않은 내보내기가 쓰는 글꼴은 남김)`,
  alreadyDownloaded: (family) => `“${family}”은(는) 이미 다운로드했습니다`,
  downloadDone: '다운로드를 완료했습니다',
  remedy: (text) => `해결 방법: ${text}`,
  usage:
    '사용법: baocut fonts [downloaded] | search [텍스트] [--category <분류>] [--script <문자>] [--limit <n>] | download <패밀리> [--weights 400,700] [--italic] | remove <패밀리> | clear',
  listSep: ', ',
  categoryChoices: (choices: readonly string[]) => `--category는 ${choices.join(', ')} 중 하나여야 합니다`,
  scriptChoices: (choices: readonly string[]) => `--script는 ${choices.join(', ')} 중 하나여야 합니다`,
  limitRange: '--limit은 1~500 사이의 정수여야 합니다',
  italicNeedsWeights: '--italic은 --weights와 함께 지정하세요',
  weightsFormat: '--weights에는 1~1000 사이의 굵기를 쉼표로 구분해 지정하세요',
  stateLabels: {
    'built-in': '내장',
    installed: '이 컴퓨터',
    downloaded: '다운로드됨',
    downloadable: '다운로드 가능',
    downloading: '다운로드 중',
    failed: '실패',
    unavailable: '사용할 수 없음',
  },
  face: (weight: number, italic: boolean) => `${weight}${italic ? ' 이탤릭' : ''}`,
  noDownloads: '아직 다운로드한 글꼴이 없습니다',
  downloadedTotal: (families: number, faces: number, size: string) => `패밀리 ${families}개, 굵기 ${faces}개, 총 ${size}`,
  noMatches: '조건에 맞는 글꼴이 없습니다',
  failedWithReason: (state: string, message: string) => `${state}(${message})`,
  truncated: (total: number, shown: number) => `(총 ${total}개 중 처음 ${shown}개만 표시)`,
  removed: (count: number, freed: string) => `굵기 ${count}개를 삭제해 ${freed}의 공간을 확보했습니다`,
  nothingToRemove: '삭제할 글꼴이 없습니다',
  kept: (count: number, faces: readonly string[]) => `${count}개를 남겼습니다(끝나지 않은 내보내기에서 사용 중): ${faces.join(', ')}`,
};
