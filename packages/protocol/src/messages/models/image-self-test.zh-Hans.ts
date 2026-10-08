import type { ModelsImageSelfTestMessages } from './image-self-test.ts';

export const zhHans: ModelsImageSelfTestMessages = {
  notPng: '不是 PNG 文件',
  chunkTruncated: (p: { type: string }) => `${p.type} 块被截断`,
  missingIhdr: '缺少 IHDR 块',
  unsupportedPixelFormat: (p: { depth: number; color: number; interlace: number }) => `不支持的像素格式（位深 ${p.depth}，颜色类型 ${p.color}，隔行 ${p.interlace}）`,
  zeroSize: '宽或高是 0',
  missingIdat: '缺少 IDAT 块',
  inflateFailed: '像素数据解压失败',
  pixelDataShort: '像素数据不够',
  unknownFilter: '未知的行过滤类型',
  undecodable: (p: { problem: string }) => `输出不能解码：${p.problem}`,
  sizeMismatch: (p: { width: number; height: number; expectedWidth: number; expectedHeight: number }) => `尺寸 ${p.width}×${p.height} 不是请求的 ${p.expectedWidth}×${p.expectedHeight}`,
  nearlySolid: (p: { distinct: number }) => `图几乎是一整片纯色（只有 ${p.distinct} 种颜色）`,
};
