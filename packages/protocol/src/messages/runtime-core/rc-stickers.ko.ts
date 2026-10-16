import type { RcStickersMessages } from './rc-stickers.ts';

export const ko: RcStickersMessages = {
  stickerNotFound: (p) => `스티커를 찾을 수 없습니다: ${p.id}`,
  stickersMissing: '이 BaoCut에는 기본 스티커가 포함되어 있지 않습니다',
  addStickerLabel: (p) => `스티커 “${p.name}” 추가`,
};
