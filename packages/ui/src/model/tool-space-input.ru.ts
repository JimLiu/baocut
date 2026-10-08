import type { ToolSpaceInputMessages } from './tool-space-input.ts';

export const ru: ToolSpaceInputMessages = {
  reasons: {
    trashed: "В корзине",
    generating: "Ещё создаётся; можно выбрать после завершения",
    missing: "Файл отсутствует; подключите его заново перед выбором",
    failed: "Последняя генерация завершилась ошибкой",
    textOnly: "Можно читать только текст из документов .txt и .md",
    subtitleOnly: "Поддерживаются только субтитры .srt и .vtt",
    noPath: "У этого элемента нет файла на этом компьютере; новое видео должно начинаться с локального файла",
  },
  joinKinds: (labels) => labels.join(", "),
};
