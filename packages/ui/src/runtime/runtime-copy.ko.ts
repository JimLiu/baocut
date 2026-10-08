import type { RuntimeMessages } from './runtime-copy.ts';

export const ko: RuntimeMessages = {
  missingContext: 'RuntimeContext가 없습니다',
  mediaStatus: (status) => `미디어 서비스가 ${status} 상태를 반환했습니다`,
  noRootSequence: '새 영상에 메인 시퀀스가 없습니다',
  edit: {
    importAssets: '소재 가져오기',
    setBackground: '배경 설정',
    addWaveform: '파형 추가',
  },
  waveformName: '파형',
  noDuration: '영상에 아직 길이가 없어 파형을 추가하지 않았습니다',
  noOpenVideo: '열린 영상이 없습니다',
  notCaughtUp: '영상이 아직 최신 상태로 맞춰지지 않아 지금은 변경할 수 없습니다',
};
