import type { RcStickersMessages } from './rc-stickers.ts';

export const ko: RcStickersMessages = {
  stickerNotFound: (p) => `스티커를 찾을 수 없습니다: ${p.id}`,
  stickersMissing: '이 BaoCut에는 기본 스티커가 포함되어 있지 않습니다',
  petNotFound: (p) => `Codex Pet을 찾을 수 없습니다: ${p.id}`,
  onlineAssetUnavailable: (p) => `이 스티커를 다운로드하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요(${p.reason})`,
  addStickerLabel: (p) => `스티커 “${p.name}” 추가`,
};
