import type { ModelsEmbeddingMessages } from './embedding.ts';

export const ko: ModelsEmbeddingMessages = {
  apacheLicense: 'Apache-2.0: 상업적 용도를 포함해 무료로 사용할 수 있습니다. 재배포할 때는 저작권 및 라이선스 고지를 유지하세요',
  runtimeNoBuild: (p: { platform: string }) => `LiteRT-LM에 이 컴퓨터(${p.platform})용 빌드가 없어 여기서는 아직 로컬 의미 검색을 사용할 수 없습니다`,
  runtimeNotInstalled: (p: { version: string }) => `LiteRT-LM ${p.version}이(가) 설치되어 있지 않습니다`,
  countMismatch: (p: { expected: number; actual: number }) => `벡터 ${p.expected}개가 나와야 하는데 ${p.actual}개가 나왔습니다`,
  wrongDims: (p: { expected: number; actual: number }) => `차원이 ${p.expected}이(가) 아니라 ${p.actual}인 벡터가 있습니다`,
  notFinite: '유한하지 않은 값이 들어 있는 벡터가 있습니다',
  notNormalized: (p: { norm: string }) => `길이가 1이 아닌 벡터가 있습니다(노름 ${p.norm})`,
  notRanked: (p: { relevant: string; irrelevant: string }) => `관련 문장의 점수가 무관한 문장보다 높지 않습니다(코사인 ${p.relevant} 대 ${p.irrelevant})`,
  noModel: '로컬 임베딩 모델이 설치되어 있지 않습니다',
  noVisionModel: '설치된 로컬 임베딩 모델은 이미지를 읽을 수 없습니다. 화면 내용으로 검색하려면 EmbeddingGemma 2 740M을 설치하세요',
  inputTooLong: (p: { index: number; max: number }) => `텍스트 ${p.index}이(가) 모델이 받을 수 있는 길이(${p.max}토큰)보다 깁니다`,
  modelUnavailable: (p: { problem: string }) => `로컬 임베딩 모델을 사용할 수 없습니다: ${p.problem}`,
  cannotEmbed: '이 Model Worker는 아직 이 모델로 임베딩을 계산할 수 없습니다',
  embedReturned: (p: { code: string }) => `embed.run이 ${p.code}을(를) 반환했습니다`,
  selfTestPassed: (p: { dims: number; relevant: string; irrelevant: string; device: string }) => `${p.dims}차원 · 코사인 ${p.relevant} 대 ${p.irrelevant} · ${p.device}`,
};
