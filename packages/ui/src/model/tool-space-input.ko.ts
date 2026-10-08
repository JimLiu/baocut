import type { ToolSpaceInputMessages } from './tool-space-input.ts';

export const ko: ToolSpaceInputMessages = {
  reasons: {
    trashed: '휴지통에 있음',
    generating: '아직 생성 중입니다. 완료되면 선택할 수 있습니다',
    missing: '파일이 없습니다. 다시 연결한 뒤 선택하세요',
    failed: '마지막 생성에 실패했습니다',
    textOnly: '.txt, .md 문서의 텍스트만 읽을 수 있습니다',
    subtitleOnly: '.srt, .vtt 자막만 사용할 수 있습니다',
    noPath: '이 항목은 이 컴퓨터에 파일이 없습니다. 새 영상은 로컬 파일에서 시작해야 합니다',
  },
  joinKinds: (labels) => labels.join(', '),
};
