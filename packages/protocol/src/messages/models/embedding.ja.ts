import type { ModelsEmbeddingMessages } from './embedding.ts';

export const ja: ModelsEmbeddingMessages = {
  apacheLicense: 'Apache-2.0：商用を含めて無料で利用できます。再配布する場合は著作権表示とライセンス表示を残してください',
  runtimeNoBuild: (p: { platform: string }) => `LiteRT-LM にはこのマシン（${p.platform}）向けのビルドがないため、ここではまだローカルのセマンティック検索を使えません`,
  runtimeNotInstalled: (p: { version: string }) => `LiteRT-LM ${p.version} がインストールされていません`,
  countMismatch: (p: { expected: number; actual: number }) => `ベクトルは ${p.expected} 個のはずが、${p.actual} 個でした`,
  wrongDims: (p: { expected: number; actual: number }) => `次元数が ${p.expected} ではなく ${p.actual} のベクトルがあります`,
  notFinite: '有限でない値を含むベクトルがあります',
  notNormalized: (p: { norm: string }) => `長さが 1 でないベクトルがあります（ノルム ${p.norm}）`,
  notRanked: (p: { relevant: string; irrelevant: string }) => `関連する文のスコアが無関係な文を上回りませんでした（コサイン ${p.relevant} 対 ${p.irrelevant}）`,
  noModel: 'ローカルの埋め込みモデルがインストールされていません',
  noVisionModel: 'インストール済みのローカル埋め込みモデルは画像を読めません。映像の内容で検索するには EmbeddingGemma 2 740M をインストールしてください',
  inputTooLong: (p: { index: number; max: number }) => `テキスト ${p.index} がモデルの受け付ける長さ（${p.max} トークン）を超えています`,
  modelUnavailable: (p: { problem: string }) => `ローカルの埋め込みモデルを使えません：${p.problem}`,
  cannotEmbed: 'この Model Worker はまだこのモデルで埋め込みを計算できません',
  embedReturned: (p: { code: string }) => `embed.run が ${p.code} を返しました`,
  selfTestPassed: (p: { dims: number; relevant: string; irrelevant: string; device: string }) => `${p.dims} 次元 · コサイン ${p.relevant} 対 ${p.irrelevant} · ${p.device}`,
};
