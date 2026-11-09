import type { Id } from './domain.ts';
import type { EditResult } from './methods.ts';
import type { MessageRef } from './message-ref.ts';
import type { EditOperation, Revision } from './video.ts';

/**
 * 随应用分发的贴纸包（仓库根的 `stickers/`）：元素面板里贴纸与动态贴纸两页的目录。贴纸 ID 是 `<包>-<文件>`
 * （`featured-01.svg`、`dyn-emoji-01.json`），也是 `stickers/` 里的文件名（动态的在 `anim/` 下）。包名给人看，在界面的文案里，
 * 不在这里；`tags` 是检索词（中英文都有），不显示。目录由原型 `designs/baocut/app/model-stickers.js` 生成。
 * 内置主播（`BUILTIN_HOSTS`，角色包在 `hosts/` 下）也在这张目录里，`stickers.*` 与智能体的 `hosts_*` 工具按同一个 ID 取。
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

/**
 * 内置的虚拟主播：随应用分发的原创卡通角色。角色包在 `stickers/hosts/host-<id>.bcpuppet`（角色格式规范），旁边是它静止时的
 * 缩略图 `host-<id>.webp`；放进视频是一个角色贴纸，配上动作轨就会说话（内置 skill `virtual-host`）。
 */
export interface BuiltinHost {
  /** slug：贴纸 ID 是 `host-<id>.bcpuppet`。 */
  id: string;
  /** 名字：专有名词，英文与中文各一个，不翻译。 */
  name: string;
  zh: string;
  /** 画风：`anime` 是半身动漫，`chibi` 是 Q 版。 */
  style: 'anime' | 'chibi';
  /** 外貌（英文，给智能体挑角色时读）：发型、眼睛、衣服。 */
  look: string;
  /** 性别与看上去的年龄（配音色、按片子挑角色时用）。`androgynous` 是中性打扮；`child` 是 Q 版的孩子气。 */
  gender: 'female' | 'male' | 'androgynous';
  age: 'child' | 'teen' | 'twenties' | 'thirties';
}

// i18n-ignore-start 名字是专有名词，外貌只给模型读
export const BUILTIN_HOSTS: readonly BuiltinHost[] = [
  {
    id: 'rin',
    name: 'Rin',
    zh: '凛',
    style: 'anime',
    look: 'shoulder-length brown hair, brown eyes; cream cardigan over a light blue blouse',
    gender: 'female',
    age: 'twenties',
  },
  {
    id: 'ren',
    name: 'Ren',
    zh: '莲',
    style: 'anime',
    look: 'messy navy blue hair, amber eyes; grey hoodie over a white T-shirt',
    gender: 'male',
    age: 'twenties',
  },
  {
    id: 'hikari',
    name: 'Hikari',
    zh: '光',
    style: 'anime',
    look: 'very long straight black hair with blunt bangs, red eyes; white blouse with a navy ribbon',
    gender: 'female',
    age: 'teen',
  },
  {
    id: 'sakura',
    name: 'Sakura',
    zh: '小樱',
    style: 'anime',
    look: 'long pink twin tails with white ribbons, green eyes; mint green hoodie',
    gender: 'female',
    age: 'teen',
  },
  {
    id: 'mio',
    name: 'Mio',
    zh: '澪',
    style: 'anime',
    look: 'silver bob, blue eyes; black turtleneck sweater',
    gender: 'female',
    age: 'twenties',
  },
  {
    id: 'natsu',
    name: 'Natsu',
    zh: '小夏',
    style: 'anime',
    look: 'orange high ponytail, brown eyes; denim jacket over a white top',
    gender: 'female',
    age: 'twenties',
  },
  {
    id: 'yuki',
    name: 'Yuki',
    zh: '小雪',
    style: 'anime',
    look: 'very long silver-white hair, violet eyes; cream coat with a fur collar',
    gender: 'female',
    age: 'twenties',
  },
  {
    id: 'haru',
    name: 'Haru',
    zh: '阿春',
    style: 'anime',
    look: 'wavy light brown hair, green eyes; brown vest over a cream shirt',
    gender: 'male',
    age: 'twenties',
  },
  {
    id: 'kaede',
    name: 'Kaede',
    zh: '枫',
    style: 'anime',
    look: 'auburn hair in a side braid, brown eyes; cream cardigan over a light blue shirt',
    gender: 'female',
    age: 'twenties',
  },
  {
    id: 'sumi',
    name: 'Sumi',
    zh: '阿澄',
    style: 'anime',
    look: 'short dark green hair with a star hair clip, amber eyes; navy sailor uniform with a white scarf',
    gender: 'female',
    age: 'teen',
  },
  {
    id: 'tsubasa',
    name: 'Tsubasa',
    zh: '翼',
    style: 'anime',
    look: 'spiky black hair, blue eyes; black track jacket over a red T-shirt',
    gender: 'male',
    age: 'teen',
  },
  {
    id: 'akane',
    name: 'Akane',
    zh: '茜',
    style: 'anime',
    look: 'red hair in a side ponytail, amber eyes; red and white track jacket',
    gender: 'female',
    age: 'teen',
  },
  {
    id: 'rui',
    name: 'Rui',
    zh: '瑞',
    style: 'anime',
    look: 'straight lavender hair with bangs, grey-violet eyes; beige sweater',
    gender: 'androgynous',
    age: 'twenties',
  },
  {
    id: 'kenji',
    name: 'Kenji',
    zh: '健司',
    style: 'anime',
    look: 'short black hair, brown eyes; navy suit jacket over a light blue shirt',
    gender: 'male',
    age: 'thirties',
  },
  {
    id: 'lumi',
    name: 'Lumi',
    zh: '露米',
    style: 'anime',
    look: 'long wavy blonde hair, blue eyes; pink dress with a white collar',
    gender: 'female',
    age: 'twenties',
  },
  {
    id: 'momo',
    name: 'Momo',
    zh: '桃桃',
    style: 'chibi',
    look: 'pink bob with bangs, big teal eyes; cream cable-knit sweater with a white collar',
    gender: 'female',
    age: 'child',
  },
  {
    id: 'pip',
    name: 'Pip',
    zh: '皮皮',
    style: 'chibi',
    look: 'messy brown hair, big brown eyes; orange hoodie',
    gender: 'male',
    age: 'child',
  },
  {
    id: 'nana',
    name: 'Nana',
    zh: '娜娜',
    style: 'chibi',
    look: 'lavender hair in two buns, big purple eyes; white sailor blouse with a red bow',
    gender: 'female',
    age: 'child',
  },
  {
    id: 'kuro',
    name: 'Kuro',
    zh: '小黑',
    style: 'chibi',
    look: 'long dark purple hair with blunt bangs, big amber eyes; navy capelet with a gold brooch',
    gender: 'female',
    age: 'child',
  },
];

/** 虚拟主播包：贴纸是 `host-<id>.bcpuppet`，在 `stickers/hosts/` 下。 */
export const HOST_STICKER_PACK: StickerPack = {
  key: 'host',
  tags: '虚拟主播 主播 角色 卡通 动漫 Q版 host presenter avatar character cartoon anime chibi vtuber',
  files: BUILTIN_HOSTS.map((host) => `${host.id}.bcpuppet`),
};
// i18n-ignore-end

/** 角色包的媒体类型（视频格式规范 §4.1）。 */
export const PUPPET_MEDIA_TYPE = 'application/x-baocut-puppet+zip';

/** 内置主播的贴纸 ID。 */
export function hostStickerId(host: Pick<BuiltinHost, 'id'>): string {
  return `${HOST_STICKER_PACK.key}-${host.id}.bcpuppet`;
}

/** 内置主播的缩略图，相对 `stickers/` 的路径：随包分发，不经素材 CDN。 */
export function hostThumbnailPath(host: Pick<BuiltinHost, 'id'>): string {
  return `hosts/${HOST_STICKER_PACK.key}-${host.id}.webp`;
}

/** 按 slug 找内置主播；没有的是 null。 */
export function builtinHost(id: string): BuiltinHost | null {
  return BUILTIN_HOSTS.find((host) => host.id === id) ?? null;
}

type StickerFamily = 'static' | 'animated' | 'host';
const FAMILY_DIR: Record<StickerFamily, string> = { static: '', animated: 'anim/', host: 'hosts/' };
const FAMILY_MEDIA: Record<StickerFamily, PackSticker['mediaType']> = {
  static: 'image/svg+xml',
  animated: 'application/json',
  host: PUPPET_MEDIA_TYPE,
};

export interface PackSticker {
  /** `<包>-<文件>`。 */
  id: string;
  pack: StickerPack;
  /** 包里的第几张（从 0 起）。 */
  index: number;
  animated: boolean;
  /** 内置主播的角色包（`hosts/` 下）。 */
  host: boolean;
  /** 相对 `stickers/` 的路径。 */
  path: string;
  /** 素材的媒体类型。 */
  mediaType: 'image/svg+xml' | 'application/json' | typeof PUPPET_MEDIA_TYPE;
}

function stickerOf(pack: StickerPack, family: StickerFamily, file: string, index: number): PackSticker {
  const id = `${pack.key}-${file}`;
  return {
    id,
    pack,
    index,
    animated: family === 'animated',
    host: family === 'host',
    path: `${FAMILY_DIR[family]}${id}`,
    mediaType: FAMILY_MEDIA[family],
  };
}

/** 一个包的全部贴纸。 */
export function packStickers(pack: StickerPack): PackSticker[] {
  const family: StickerFamily = pack === HOST_STICKER_PACK ? 'host' : ANIMATED_STICKER_PACKS.includes(pack) ? 'animated' : 'static';
  return pack.files.map((file, index) => stickerOf(pack, family, file, index));
}

const BY_ID = new Map<string, PackSticker>(
  [...STICKER_PACKS, ...ANIMATED_STICKER_PACKS, HOST_STICKER_PACK].flatMap((pack) =>
    packStickers(pack).map((sticker) => [sticker.id, sticker] as const),
  ),
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
