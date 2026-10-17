import type { PetMessages } from './pet-copy.ts';

export const zhHant: PetMessages = {
  title: 'Codex Pets',
  note: '8 欄精靈圖 · 待機循環 · 跟隨播放頭',
  peekNote: (count) => `社群 ${count}`,
  categoryChips: 'Pet 分類',
  chip: (label, count) => `${label} ${count}`,
  categories: {
    'game-characters': '遊戲角色',
    'anime-characters': '動漫角色',
    animals: '動物夥伴',
    'original-characters': '原創角色',
    mascots: '吉祥物',
    others: '其他',
    memes: '網路迷因',
    'fantasy-creatures': '奇幻生物',
    'human-avatars': '人物頭像',
    robots: '機器人',
    'objects-props': '物件與道具',
  },
  noMatch: '沒有符合的 Pet',
  noMatchHint: '換個詞，或換一個分類',
  nonCommercial: '僅限非商業使用',
  communityNote:
    '社群 Pet 來自 awesome-codex-pet，各依作者自訂的授權使用（多為 CC BY-NC 4.0，標橘色的是僅限非商業使用）；署名會跟著素材一起儲存。縮圖與精靈圖用到時才下載，存在這台電腦上。',
  hint: 'Codex Pet 是 Codex 桌面版桌寵的格式：一張 WebP 精靈圖，8 欄、每格 192×208（v1 九列、v2 十一列），每列一種狀態。放到畫布上播放的是待機那一列，循環播放並跟隨播放頭。精靈圖第一次使用時下載，之後存在這台電腦上。',
  addFailed: (message) => `無法加入 Pet：${message}`,
};
