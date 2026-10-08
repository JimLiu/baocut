import type { ModelsImageSelfTestMessages } from './image-self-test.ts';

export const ko: ModelsImageSelfTestMessages = {
  notPng: 'PNG 파일이 아닙니다',
  chunkTruncated: (p: { type: string }) => `${p.type} 청크가 잘렸습니다`,
  missingIhdr: 'IHDR 청크가 없습니다',
  unsupportedPixelFormat: (p: { depth: number; color: number; interlace: number }) =>
    `지원하지 않는 픽셀 형식입니다(비트 심도 ${p.depth}, 색상 유형 ${p.color}, 인터레이스 ${p.interlace})`,
  zeroSize: '너비나 높이가 0입니다',
  missingIdat: 'IDAT 청크가 없습니다',
  inflateFailed: '픽셀 데이터의 압축을 풀지 못했습니다',
  pixelDataShort: '픽셀 데이터가 부족합니다',
  unknownFilter: '알 수 없는 행 필터 유형입니다',
  undecodable: (p: { problem: string }) => `결과물을 디코딩할 수 없습니다: ${p.problem}`,
  sizeMismatch: (p: { width: number; height: number; expectedWidth: number; expectedHeight: number }) =>
    `크기(${p.width}×${p.height})가 요청한 크기(${p.expectedWidth}×${p.expectedHeight})와 다릅니다`,
  nearlySolid: (p: { distinct: number }) => `이미지가 거의 단색입니다(색상 ${p.distinct}개뿐)`,
};
