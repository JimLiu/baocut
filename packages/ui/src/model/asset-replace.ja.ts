import type { AssetReplaceMessages } from './asset-replace.ts';

const KIND_TEXT = { video: '動画', image: '画像', audio: '音声' } as const;

export const ja: AssetReplaceMessages = {
  cantReplaceKind: 'この種類の素材はまだ置き換えられません。',
  sameKind: (kind) => `同じ種類の素材にしか置き換えられません：ここには${KIND_TEXT[kind]}の素材が必要です。`,
  sameAsset: 'これは現在の素材です。別の素材を選んでください。',
  unused: 'この素材はタイムラインで使われていないため、置き換える対象がありません。',
  tooShort: '新しい素材が短すぎて、1 フレームも埋められません。',
  allLocked: 'この素材を使うクリップはすべてロックされています（またはコンポジションの事前レンダリング代替です）。先にロックを解除してください。',
  clipLocked: 'このクリップはロックされています。先にロックを解除してください。',
  durationUnknown: '素材の長さが不明なため、クリップは当面いまの長さのままです。',
  longEnoughMany: '新しい素材は十分な長さです。これらのクリップの長さは変わらず、タイムラインもそのままです。',
  longEnoughOne: '新しい素材は十分な長さです。クリップの長さは変わらず、タイムラインもそのままです。',
  shortenMany: (n: number, seconds: string) => `${n} 個のクリップが短くなります（合計 ${seconds} 秒）`,
  shortenOne: (seconds: string) => `クリップが ${seconds} 秒短くなります`,
  moved: (head: string, n: number) => `${head}。同じトラックで後ろにある ${n} 個のクリップも前に移動します。`,
  trackShorter: (head: string) => `${head}。トラックも短くなります。`,
  transitions: (n: number) => `これらのクリップにある ${n} 個のトランジションは削除されます。`,
  captions: (n: number) => `${n} 件の字幕はこれらのクリップを基準にタイミングが決まっているため、置き換え後に合わせ直す必要があります。`,
  ducking: (n: number) => `${n} 件のダッキングルールがこれらのクリップを参照しているため、置き換え後は合わなくなります。`,
};
