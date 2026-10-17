import type { PetMessages } from './pet-copy.ts';

export const zhHans: PetMessages = {
  title: 'Codex Pets',
  note: '8 列精灵图 · 待机循环 · 跟播放头',
  peekNote: (count) => `社区 ${count}`,
  categoryChips: 'Pet 分类',
  chip: (label, count) => `${label} ${count}`,
  categories: {
    'game-characters': '游戏角色',
    'anime-characters': '动漫角色',
    animals: '动物伙伴',
    'original-characters': '原创角色',
    mascots: '吉祥物',
    others: '其他',
    memes: '网络梗图',
    'fantasy-creatures': '幻想生物',
    'human-avatars': '人物头像',
    robots: '机器人',
    'objects-props': '物件与道具',
  },
  noMatch: '没有匹配的 Pet',
  noMatchHint: '换个词，或者换一个分类',
  nonCommercial: '仅限非商用',
  communityNote:
    '社区 Pet 来自 awesome-codex-pet，各按作者自报的许可使用（多为 CC BY-NC 4.0，标橙的是仅限非商用）；署名跟着素材一起存。缩略图与精灵图用到时才下载，存在这台电脑上。',
  hint: 'Codex Pet 是 Codex 桌面端桌宠的格式：一张 WebP 精灵图，8 列、每格 192×208（v1 九行、v2 十一行），每行一种状态。放到画布上播的是待机那一行，循环，跟着播放头走。精灵图第一次用时下载，之后存在这台电脑上。',
  addFailed: (message) => `Pet 没能加进来：${message}`,
};
