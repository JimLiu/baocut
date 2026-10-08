import type { HomeBriefMessages } from './home-brief.ts';

export const ru: HomeBriefMessages = {
  about: (minutes: number, seconds: number) => `О видео ${[minutes ? `${minutes} мин` : "", seconds ? `${seconds} с` : ""].filter(Boolean).join(" ")}`,
  fromMaterials: "Создайте видео из прикреплённых материалов.",
  materials: (paths: readonly string[]) => `Материалы: ${paths.join(", ")}`,
  connectFirst: "Сначала подключите ИИ",
  sayFirst: "Опишите, что хотите создать, или прикрепите материалы",
  agentOffTitle: "Все установленные агенты для программирования отключены",
  agentOffBody: "На этом компьютере установлен агент для программирования, но он отключён в разделе «Настройки». Включите его, чтобы начать здесь.",
  enableNamed: (name: string) => `Включить ${name}`,
  enableAgent: "Включить агента",
  agentMissingTitle: "Для этого нужен агент для программирования",
  agentMissingBody: "Установите Claude Code или Codex CLI и войдите со своей подпиской, затем вернитесь сюда, чтобы начать.",
  connectAgent: "Подключить агента",
  nameEmpty: "Введите имя проекта",
  nameInvalid: "Имя проекта не может содержать косые черты или управляющие символы",
};
