import type { PetMessages } from './pet-copy.ts';

export const ko: PetMessages = {
  title: 'Codex Pets',
  note: '8열 스프라이트 시트 · 대기 반복 · 재생 헤드를 따라감',
  peekNote: (count) => `커뮤니티 ${count}`,
  categoryChips: '펫 카테고리',
  chip: (label, count) => `${label} ${count}`,
  categories: {
    'game-characters': '게임 캐릭터',
    'anime-characters': '애니메이션 캐릭터',
    animals: '동물',
    'original-characters': '오리지널 캐릭터',
    mascots: '마스코트',
    others: '기타',
    memes: '밈',
    'fantasy-creatures': '판타지 생물',
    'human-avatars': '인물 아바타',
    robots: '로봇',
    'objects-props': '사물과 소품',
  },
  noMatch: '일치하는 펫이 없습니다',
  noMatchHint: '다른 단어나 카테고리로 찾아 보세요',
  nonCommercial: '비상업적 용도만 허용',
  communityNote:
    '커뮤니티 펫은 awesome-codex-pet에서 가져오며 각 작성자가 밝힌 라이선스로 사용합니다(대부분 CC BY-NC 4.0, 주황색은 비상업적 용도만 허용). 출처 표기는 소재와 함께 저장됩니다. 썸네일과 스프라이트 시트는 필요할 때 내려받아 이 컴퓨터에 보관합니다.',
  hint: 'Codex Pet은 Codex 데스크톱 앱의 데스크톱 펫 형식입니다. 192×208 칸이 8열로 놓인 WebP 스프라이트 시트(v1은 9행, v2는 11행)이며 한 행이 한 가지 상태입니다. 캔버스에서는 대기 행을 반복 재생하며 재생 헤드를 따라갑니다. 스프라이트 시트는 처음 쓸 때 내려받아 이 컴퓨터에 보관합니다.',
  addFailed: (message) => `펫을 추가하지 못했습니다: ${message}`,
};
