import type { FullscreenPlayerMessages } from './fullscreen-player-copy.ts';

export const ko: FullscreenPlayerMessages = {
  region: '전체 화면 플레이어',
  enter: '전체 화면 재생',
  enterTip: '전체 화면 재생 (F)',
  captions: '자막',
  captionsTip: (mode: string) => `자막: ${mode} (C)`,
  captionMode: { off: '자막 끄기', source: '원문', trans: '번역', both: '이중 언어' },
  keysTip: '키보드 단축키 (?)',
  keysTitle: '키보드 단축키',
  keysFooter: 'Esc를 눌러 이 목록을 닫고, 한 번 더 누르면 전체 화면을 종료합니다.',
  keys: {
    play: '재생 / 일시정지 (화면을 한 번 클릭한 것과 같음)',
    exit: '전체 화면 종료 (화면을 두 번 클릭한 것과 같음)',
    back: '5초 뒤로 / 앞으로',
    back10: '10초 뒤로 / 앞으로',
    prevChapter: '이전 / 다음 챕터',
    volUp: '음량 ±10 (음소거 자동 해제)',
    mute: '음소거 / 음소거 해제',
    captions: '자막 모드 전환',
    start: '처음 / 끝으로 이동',
    percent: '동영상의 0% – 90% 지점으로 이동',
    keys: '이 목록',
  },
};
