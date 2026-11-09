import type { StickerPackMessages } from './sticker-pack-copy.ts';

/** 内置主播的中文名在目录里是简体（`BuiltinHost.zh`），这几个换成繁体字形。 */
const HANT_NAMES: Record<string, string> = { 凛: '凜', 莲: '蓮', 小樱: '小櫻', 枫: '楓' };

export const zhHant: StickerPackMessages = {
  packs: {
    featured: '精選',
    emoji: '表情',
    people: '人物',
    mockup: '樣機視窗',
    podcast: '播客',
    icon: '圖示',
    summer: '夏日',
    gesture: '手勢',
    arrow: '箭頭指標',
    hand: '手繪',
    birthday: '生日',
    finance: '金融',
    fitness: '健身',
    seasonal: '季節',
    school: '開學季',
    cta: 'CTA 彈窗',
    'dyn-collage': '拼貼',
    'dyn-emoji': '表情',
    'dyn-grow': '生長',
    'dyn-holiday': '假日',
    'dyn-work': '工作',
  },
  morePacks: '更多包',
  packMenuHead: (count: number) => `共 ${count} 個包`,
  packCount: (count: number) => `${count} 個素材`,
  ctaTitle: 'CTA 彈窗',
  ctaNote: '32 款 · 訂閱 / 按讚 / 分享 / 購買',
  notoHint:
    '五個內建分類是 Google Noto Animated Emoji 的 Lottie（CC BY 4.0）：向量循環、帶透明通道，放到畫布上會跟著播放頭走，也能像靜態貼紙一樣分色修改。',
  addFailed: (message: string) => `無法加入貼紙：${message}`,
  hostTitle: '虛擬主播',
  hostNote: (count) => `${count} 個原創角色 · 眨眼、對口型、換表情`,
  hostCategories: '主播畫風',
  hostStyles: { anime: '動漫', chibi: 'Q 版' },
  hostName: (host) => HANT_NAMES[host.zh] ?? host.zh,
  hostSignpost: '放上去就會眨眼、呼吸、輕輕晃動。',
  hostLipSync: '要跟著旁白說話、換表情，在對話裡讓 BaoCut 幫它配口型。',
  hostLipSyncWeb: '跟著旁白配口型從 Agent 或 BaoCut App 發起，結果會同步到這裡。',
  noHost: '沒有符合的角色',
  noHostHint: '換個詞，或清除搜尋看全部角色。',
  hostAddFailed: (message) => `無法加入主播：${message}`,
};
