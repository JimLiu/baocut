import type { ModelsDownloadSourceMessages } from './download-source.ts';

export const ko: ModelsDownloadSourceMessages = {
  invalidEndpoint: (p: { name: string }) =>
    `${p.name} 값은 http(s)://로 시작하는 기본 URL이어야 하며, 자격 증명, 쿼리 매개변수, 프래그먼트를 포함할 수 없습니다`,
};
