import type { ModelsImageSelfTestMessages } from './image-self-test.ts';

export const ja: ModelsImageSelfTestMessages = {
  notPng: 'PNG ファイルではありません',
  chunkTruncated: (p: { type: string }) => `${p.type} チャンクが途中で切れています`,
  missingIhdr: 'IHDR チャンクがありません',
  unsupportedPixelFormat: (p: { depth: number; color: number; interlace: number }) =>
    `対応していないピクセル形式です（ビット深度 ${p.depth}、カラータイプ ${p.color}、インターレース ${p.interlace}）`,
  zeroSize: '幅または高さが 0 です',
  missingIdat: 'IDAT チャンクがありません',
  inflateFailed: 'ピクセルデータを展開できませんでした',
  pixelDataShort: 'ピクセルデータが不足しています',
  unknownFilter: '不明な行フィルタの種類です',
  undecodable: (p: { problem: string }) => `出力をデコードできません：${p.problem}`,
  sizeMismatch: (p: { width: number; height: number; expectedWidth: number; expectedHeight: number }) =>
    `サイズ ${p.width}×${p.height} が要求した ${p.expectedWidth}×${p.expectedHeight} と一致しません`,
  nearlySolid: (p: { distinct: number }) => `画像がほぼ単色です（${p.distinct} 色しかありません）`,
};
