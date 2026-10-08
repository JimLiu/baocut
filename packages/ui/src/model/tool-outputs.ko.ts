import type { ToolOutputsMessages } from './tool-outputs.ts';

export const ko: ToolOutputsMessages = {
  actionLabel: { 'open-movie': '편집기에서 열기', 'new-movie': '이것으로 새 영상 만들기' },
  blockTextOnly: '전사본과 자막으로 새 영상을 만들려면 영상이나 오디오 파일이 필요합니다. 아직 여기서는 할 수 없습니다',
  blockTrashed: '먼저 휴지통에서 이 항목을 복원하세요',
  blockGenerating: '아직 생성 중입니다. 완료되면 사용할 수 있습니다',
  blockMissing: '이 컴퓨터에서 이 결과물의 파일을 찾을 수 없습니다',
  handover: {
    subtitle: '이 자막을 다른 언어로 번역해 주세요. 타임코드는 그대로 유지해 주세요.',
    document: '이 전사본의 요약을 작성해 주세요.',
    audio: '이 오디오로 영상을 만들어 주세요.',
    image: '이 이미지를 커버로 해서 영상을 만들어 주세요.',
    'video-file': '이 영상에 자막을 추가해 주세요.',
    export: '이 영상에 자막을 추가해 주세요.',
    video: '이 영상을 계속 편집해 주세요.',
  },
  handoverDefault: '이 결과물로 계속 작업해 주세요.',
};
