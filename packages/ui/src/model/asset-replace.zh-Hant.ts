import type { AssetReplaceMessages } from './asset-replace.ts';

const KIND_TEXT = { video: '影片', image: '圖片', audio: '音訊' } as const;

export const zhHant: AssetReplaceMessages = {
  cantReplaceKind: '這類素材目前還無法替換。',
  sameKind: (kind) => `只能換成同類型的素材：這裡需要${KIND_TEXT[kind]}素材。`,
  sameAsset: '這就是目前的素材，請選擇其他素材。',
  unused: '時間軸上沒有用到這個素材，不需要替換。',
  tooShort: '新素材太短，填不滿一個影格。',
  allLocked: '用到它的片段都已鎖定（或是合成的預先渲染替身），請先解除鎖定。',
  durationUnknown: '素材長度不明，片段暫時保留目前的長度。',
  longEnoughMany: '新素材夠長。這些片段的長度都不變，時間軸也維持不變。',
  longEnoughOne: '新素材夠長。片段保留原本的長度，時間軸也維持不變。',
  shortenMany: (n: number, seconds: string) => `${n} 段片段會變短，總共縮短 ${seconds} 秒`,
  shortenOne: (seconds: string) => `片段會縮短 ${seconds} 秒`,
  moved: (head: string, n: number) => `${head}，同一軌道上後面的 ${n} 段片段會往前移。`,
  trackShorter: (head: string) => `${head}，軌道也會跟著變短。`,
  transitions: (n: number) => (n === 1 ? '這些片段上的轉場會被移除。' : `這些片段上的 ${n} 個轉場會被移除。`),
  captions: (n: number) => `有 ${n} 句字幕依這些片段計時，替換後需要重新對齊。`,
  ducking: (n: number) => `有 ${n} 條自動壓低音量的規則指向這些片段，替換後會對不上。`,
};
