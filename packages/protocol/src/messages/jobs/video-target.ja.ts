import type { JobsVideoTargetMessages } from './video-target.ts';

export const ja: JobsVideoTargetMessages = {
  stepLabel: '対象の特定',
  notSameVideo: 'が videoId と別の動画を指しています',
  targetShapeOneOf: 'は { videoId }、{ entryId }、{ create } のいずれかである必要があります',
  createUnsupported: 'この固定フローでは動画を作成できません：既存の動画（videoId または entryId）を指定してください',
  createShape: 'は { projectId, name? } または { conversationId, name? } である必要があります',
  mediaNotAllowed: 'は指定できません：メディアはこの固定フローの結果です',
  unknownField: (p: { key: string }) => `に不明なフィールド ${p.key} があります`,
  scopeOnlyOne: 'には projectId と conversationId のどちらか一方しか指定できません',
  scopeRequired: 'には projectId または conversationId が必要です',
  nameLength: 'は 1 から 200 文字である必要があります',
  mediaPath: 'はローカルのメディアファイルの絶対パスである必要があります',
};
