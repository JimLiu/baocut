import type { Id } from './domain.ts';
import type { EditResult } from './methods.ts';
import type { MessageRef } from './message-ref.ts';
import type { EditOperation, Revision } from './video.ts';

/**
 * 随应用分发的贴纸包（仓库根的 `stickers/`）：元素面板里贴纸与动态贴纸两页的目录。贴纸 ID 是 `<包>-<文件>`
 * （`featured-01.svg`、`dyn-emoji-01.json`），也是 `stickers/` 里的文件名（动态的在 `anim/` 下）。包名给人看，在界面的文案里，
 * 不在这里；`tags` 是检索词（中英文都有），不显示。目录由原型 `designs/baocut/app/model-stickers.js` 生成。
 */

export interface StickerPack {
  /** 包的 slug：贴纸 ID 与文件名的前缀，界面按它找包名。 */
  key: string;
  /** 检索词，空格分开。 */
  tags: string;
  /** 包里的文件（不带前缀），按目录次序。 */
  files: readonly string[];
}

const numbered = (count: number, ext: string): string[] =>
  Array.from({ length: count }, (_, index) => `${String(index + 1).padStart(2, '0')}.${ext}`);

// i18n-ignore-start 检索词：中英文都收，只用来匹配，不显示
/** 静态贴纸包（SVG），按目录次序：精选、表情在前，CTA 弹窗在最后。 */
export const STICKER_PACKS: readonly StickerPack[] = [
  { key: 'featured', tags: '精选 featured 推荐', files: numbered(20, 'svg') },
  {
    key: 'emoji',
    tags: '表情 emoji 反应 笑脸',
    files: [
      'blowKiss.svg',
      'burrito.svg',
      'cat.svg',
      'cryLaugh.svg',
      'fire.svg',
      'fist.svg',
      'heart.svg',
      'hundred.svg',
      'leftPoint.svg',
      'loudCry.svg',
      'lovestruck.svg',
      'moneyTongue.svg',
      'okHand.svg',
      'pizza.svg',
      'pointRight.svg',
      'shrugging.svg',
      'singleTear.svg',
      'smiling.svg',
      'starstruck.svg',
      'sunglasses.svg',
      'surprised.svg',
      'thinking.svg',
      'thumbsUp.svg',
      'tongue.svg',
    ],
  },
  { key: 'people', tags: '人物 角色 头像 人像 多样性 person portrait people character open peeps', files: numbered(20, 'svg') },
  {
    key: 'mockup',
    tags: '样机 窗口 设备 电脑 手机 平板 相机 播放器 mockup device window desktop mobile tablet camera',
    files: numbered(13, 'svg'),
  },
  { key: 'podcast', tags: '播客 麦克风 直播 podcast mic live', files: numbered(24, 'svg') },
  { key: 'icon', tags: '图标 icon 符号', files: numbered(24, 'svg') },
  { key: 'summer', tags: '夏日 海滩 太阳 summer beach', files: numbered(13, 'svg') },
  {
    key: 'gesture',
    tags: '手势 手 指 点赞 鼓掌 祈祷 握手 爱心 胜利 gesture hand point thumbs clap pray handshake heart victory',
    files: numbered(13, 'svg'),
  },
  { key: 'arrow', tags: '箭头 指针 光标 arrow pointer', files: numbered(24, 'svg') },
  {
    key: 'hand',
    tags: '手绘 涂鸦 灯泡 相机 爱心 消息 星星 火箭 铃铛 清单 hand drawn doodle bulb camera heart message star rocket bell checklist',
    files: numbered(8, 'svg'),
  },
  { key: 'birthday', tags: '生日 蛋糕 庆祝 birthday cake', files: numbered(4, 'svg') },
  { key: 'finance', tags: '金融 货币 图表 finance money chart', files: numbered(20, 'svg') },
  { key: 'fitness', tags: '健身 运动 fitness gym sport', files: numbered(19, 'svg') },
  { key: 'seasonal', tags: '季节 节日 圣诞 万圣 seasonal holiday', files: numbered(24, 'svg') },
  { key: 'school', tags: '开学 文具 书本 school', files: numbered(19, 'svg') },
  {
    key: 'cta',
    tags: 'CTA 弹窗 按钮 订阅 关注 点赞 评论 分享 收藏 购买 优惠 subscribe follow like comment share buy shop button',
    files: [
      'subscribe.svg',
      'subscribeZh.svg',
      'subscribed.svg',
      'subscribedZh.svg',
      'notify.svg',
      'notifyZh.svg',
      'like.svg',
      'likeZh.svg',
      'comment.svg',
      'commentZh.svg',
      'share.svg',
      'shareZh.svg',
      'save.svg',
      'saveZh.svg',
      'follow.svg',
      'followZh.svg',
      'buyNow.svg',
      'buyNowZh.svg',
      'shopNow.svg',
      'shopNowZh.svg',
      'offer.svg',
      'offerZh.svg',
      'freeGift.svg',
      'freeGiftZh.svg',
      'linkInBio.svg',
      'linkInBioZh.svg',
      'watchNext.svg',
      'watchNextZh.svg',
      'tickets.svg',
      'ticketsZh.svg',
      'learnMore.svg',
      'learnMoreZh.svg',
    ],
  },
];

/** 动态贴纸包（Lottie，Google Noto Animated Emoji，CC BY 4.0），按分类键的字母序。 */
export const ANIMATED_STICKER_PACKS: readonly StickerPack[] = [
  { key: 'dyn-collage', tags: '拼贴 剪贴 心 星 collage heart star', files: numbered(18, 'json') },
  { key: 'dyn-emoji', tags: '表情 笑脸 emoji face', files: numbered(18, 'json') },
  { key: 'dyn-grow', tags: '生长 增长 图表 火箭 growth chart rocket', files: numbered(14, 'json') },
  { key: 'dyn-holiday', tags: '假日 节日 庆祝 holiday party celebration', files: numbered(14, 'json') },
  { key: 'dyn-work', tags: '工作 办公 work office', files: numbered(17, 'json') },
];
// i18n-ignore-end

/** 动态贴纸的署名（CC BY 4.0 要求随处可见）：专有名词，不翻译。 */
export const ANIMATED_STICKER_CREDIT = 'Google Noto Animated Emoji · CC BY 4.0';

export interface PackSticker {
  /** `<包>-<文件>`。 */
  id: string;
  pack: StickerPack;
  /** 包里的第几张（从 0 起）。 */
  index: number;
  animated: boolean;
  /** 相对 `stickers/` 的路径。 */
  path: string;
  /** 素材的媒体类型。 */
  mediaType: 'image/svg+xml' | 'application/json';
}

function stickerOf(pack: StickerPack, animated: boolean, file: string, index: number): PackSticker {
  const id = `${pack.key}-${file}`;
  return {
    id,
    pack,
    index,
    animated,
    path: animated ? `anim/${id}` : id,
    mediaType: animated ? 'application/json' : 'image/svg+xml',
  };
}

/** 一个包的全部贴纸。 */
export function packStickers(pack: StickerPack): PackSticker[] {
  const animated = ANIMATED_STICKER_PACKS.includes(pack);
  return pack.files.map((file, index) => stickerOf(pack, animated, file, index));
}

const BY_ID = new Map<string, PackSticker>(
  [...STICKER_PACKS, ...ANIMATED_STICKER_PACKS].flatMap((pack) => packStickers(pack).map((sticker) => [sticker.id, sticker] as const)),
);

/** 按 ID 找随包贴纸；目录里没有的是 null。 */
export function packSticker(id: string): PackSticker | null {
  return BY_ID.get(id) ?? null;
}

/** 随包贴纸一共几张。 */
export const PACK_STICKER_COUNT = BY_ID.size;

/** 拷进视频的随包贴纸素材的来源（视频格式规范 §4.1）：`origin` 与 `source.stickerPack`。 */
export const STICKER_PACK_ORIGIN = 'sticker-pack';

export interface StickerApplyParams {
  videoId: Id;
  /** 随包贴纸的 ID（`packSticker`）。 */
  id: string;
  commandId: Id;
  /** 不给时以视频的当前版本提交。 */
  expectedRevision?: Revision;
  /** 素材的名字；不给时用贴纸 ID。 */
  name?: string;
  /**
   * 同一笔事务里接着做的修改（常见是新建一层贴纸画它）：导入的素材在这些操作里是 `assetImportRef: 'asset'`。
   * 给了就一起提交、一步撤销；不给时只导入。
   */
  operations?: EditOperation[];
  /** 这笔事务给人看的修改名与它的消息引用（同 `edits.apply`）；不给时是「添加贴纸」。 */
  label?: string;
  labelRef?: MessageRef;
}

export interface StickerApplyResult extends EditResult {
  /** 导入成的图片（SVG）或 Lottie 素材。 */
  assetId: Id;
}
