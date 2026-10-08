import type { JobsSpeechWorkerMessages } from './speech-worker.ts';

export const ko: JobsSpeechWorkerMessages = {
  incompatible: (p: { protocol: string }) => `Speech Worker의 프로토콜이 ${p.protocol} 형식이 아닙니다`,
  exited: 'Speech Worker가 예기치 않게 종료되었습니다',
  translationLanguage: '번역본의 언어가 대상 언어와 일치하지 않습니다',
  outputInvalid: 'Speech Worker의 출력이 계약과 맞지 않습니다',
  outputTruncated: '모델 출력이 한도에 도달해 잘렸습니다',
  resultMissing: (p: { field: string }) => `Speech Worker 결과에 ${p.field} 항목이 없습니다`,
  unreadableFile: (p: { name: string }) => `Speech Worker가 쓴 ${p.name} 파일을 읽을 수 없습니다`,
  cuesNotObject: '자막 목록이 객체가 아닙니다',
  cuesSchema: (p: { schema: string }) => `자막 목록의 스키마는 ${p.schema} 형식이어야 합니다`,
  cuesLanguage: '자막 목록의 언어가 대상 언어와 일치하지 않습니다',
  cuesTimescale: '자막 목록의 timescale은 원본 전사본과 같아야 합니다',
  cuesMissing: 'cues 항목이 없습니다',
  cueNotObject: (p: { n: number }) => `${p.n}번째 자막이 객체가 아닙니다`,
  cueNoText: (p: { n: number }) => `${p.n}번째 자막에 텍스트가 없습니다`,
  cueNoSentence: (p: { n: number }) => `${p.n}번째 자막에 문장이나 단위가 없습니다`,
  cueFallback: (p: { n: number }) => `${p.n}번째 자막의 fallback이 불리언이 아닙니다`,
  cueTicks: (p: { n: number }) => `${p.n}번째 자막의 시간이 정수 틱이 아닙니다`,
  cueRange: (p: { n: number }) => `${p.n}번째 자막의 시간 범위가 올바르지 않습니다`,
  cueOverlap: (p: { n: number }) => `${p.n}번째 자막이 이전 자막과 겹치거나 순서가 맞지 않습니다`,
  cueBeyond: (p: { n: number }) => `${p.n}번째 자막이 미디어 길이를 넘습니다`,
};
