import type { JobsVideoTargetMessages } from './video-target.ts';

export const ko: JobsVideoTargetMessages = {
  stepLabel: '대상 확인',
  notSameVideo: 'videoId와 다른 영상을 가리킵니다',
  targetShapeOneOf: '{ videoId }, { entryId }, { create } 중 하나여야 합니다',
  createUnsupported: '이 파이프라인은 영상을 만들 수 없습니다: 기존 영상(videoId 또는 entryId)을 지정하세요',
  createShape: '{ projectId, name? } 또는 { conversationId, name? } 형식이어야 합니다',
  mediaNotAllowed: '지정할 수 없습니다: 미디어는 이 파이프라인의 결과입니다',
  unknownField: (p: { key: string }) => `알 수 없는 필드가 있습니다: ${p.key}`,
  scopeOnlyOne: 'projectId와 conversationId 중 하나만 받습니다',
  scopeRequired: 'projectId나 conversationId가 필요합니다',
  nameLength: '1~200자여야 합니다',
  mediaPath: '로컬 미디어 파일의 절대 경로여야 합니다',
};
