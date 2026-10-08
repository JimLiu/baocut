import type { ModelsImageSelfTestMessages } from './image-self-test.ts';

export const zhHant: ModelsImageSelfTestMessages = {
  notPng: '不是 PNG 檔案',
  chunkTruncated: (p: { type: string }) => `${p.type} 區塊被截斷`,
  missingIhdr: '缺少 IHDR 區塊',
  unsupportedPixelFormat: (p: { depth: number; color: number; interlace: number }) => `不支援的像素格式（位元深度 ${p.depth}，色彩類型 ${p.color}，交錯 ${p.interlace}）`,
  zeroSize: '寬度或高度為 0',
  missingIdat: '缺少 IDAT 區塊',
  inflateFailed: '無法解壓縮像素資料',
  pixelDataShort: '像素資料不足',
  unknownFilter: '未知的列篩選類型',
  undecodable: (p: { problem: string }) => `無法解碼輸出：${p.problem}`,
  sizeMismatch: (p: { width: number; height: number; expectedWidth: number; expectedHeight: number }) => `尺寸 ${p.width}×${p.height} 不是要求的 ${p.expectedWidth}×${p.expectedHeight}`,
  nearlySolid: (p: { distinct: number }) => `圖片幾乎是一整片純色（只有 ${p.distinct} 種顏色）`,
};
