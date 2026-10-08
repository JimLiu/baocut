import type { JobsVideoTargetMessages } from './video-target.ts';

export const ru: JobsVideoTargetMessages = {
  stepLabel: "Определение цели",
  notSameVideo: "ссылается на другое видео, чем videoId",
  targetShapeOneOf: "должно быть одним из { videoId }, { entryId } или { create }",
  createUnsupported: "Этот пайплайн не может создать видео: укажите существующее видео (videoId или entryId)",
  createShape: "должно быть { projectId, name? } или { conversationId, name? }",
  mediaNotAllowed: "нельзя указать: медиа — результат этого пайплайна",
  unknownField: (p: { key: string }) => `содержит неизвестное поле ${p.key}`,
  scopeOnlyOne: "принимает только одно из projectId и conversationId",
  scopeRequired: "требует projectId или conversationId",
  nameLength: "должно содержать от 1 до 200 символов",
  mediaPath: "должно быть абсолютным путём к локальному медиафайлу",
};
