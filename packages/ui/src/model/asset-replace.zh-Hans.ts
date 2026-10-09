import type { AssetReplaceMessages } from './asset-replace.ts';

const KIND_TEXT = { video: '视频', image: '图片', audio: '音频' } as const;

export const zhHans: AssetReplaceMessages = {
  cantReplaceKind: '这一类素材还不能替换。',
  sameKind: (kind) => `只能换成同一类的素材：这里要一份${KIND_TEXT[kind]}。`,
  sameAsset: '这就是现在的素材，换一份。',
  unused: '时间线上没有用到这个素材，不用替换。',
  tooShort: '新素材太短，放不下一帧。',
  allLocked: '用到它的片段都锁着（或是合成的预渲染替身），先解锁再换。',
  clipLocked: '这一段锁着，先解锁再换。',
  durationUnknown: '素材时长未知，先保留片段原时长。',
  longEnoughMany: '新素材够长，这几段片段长度都不变，时间线不变。',
  longEnoughOne: '新素材够长，片段长度不变，时间线不变。',
  shortenMany: (n: number, seconds: string) => `${n} 段会变短，一共短 ${seconds} 秒`,
  shortenOne: (seconds: string) => `片段会变短 ${seconds} 秒`,
  moved: (head: string, n: number) => `${head}，同轨后面 ${n} 段往前挪。`,
  trackShorter: (head: string) => `${head}，这条轨道跟着变短。`,
  transitions: (n: number) => `这些片段上的 ${n} 个转场会去掉。`,
  captions: (n: number) => `${n} 段字幕按这些片段投影时间，换完要重新对齐。`,
  ducking: (n: number) => `${n} 条压低原声的规则指着这些片段，换完对不上了。`,
};
