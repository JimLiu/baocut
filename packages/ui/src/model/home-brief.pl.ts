import type { HomeBriefMessages } from './home-brief.ts';

export const pl: HomeBriefMessages = {
  about: (minutes: number, seconds: number) => `O wideo ${[minutes ? `${minutes} min` : "", seconds ? `${seconds} s` : ""].filter(Boolean).join(" ")}`,
  fromMaterials: "Utwórz wideo z załączonych materiałów.",
  materials: (paths: readonly string[]) => `Materiały: ${paths.join(", ")}`,
  connectFirst: "Najpierw połącz AI",
  sayFirst: "Opisz, co chcesz stworzyć, lub załącz materiały",
  agentOffTitle: "Wszyscy zainstalowani agenci kodujący są wyłączeni",
  agentOffBody: "Na tym komputerze jest agent kodujący, ale jest wyłączony w sekcji „Ustawienia”. Włącz go, aby zacząć tutaj.",
  enableNamed: (name: string) => `Włącz ${name}`,
  enableAgent: "Włącz agenta",
  agentMissingTitle: "To wymaga agenta kodującego",
  agentMissingBody: "Zainstaluj Claude Code lub Codex CLI i zaloguj się z własną subskrypcją, a następnie wróć tutaj, aby zacząć.",
  connectAgent: "Połącz agenta",
  nameEmpty: "Wpisz nazwę projektu",
  nameInvalid: "Nazwa projektu nie może zawierać ukośników ani znaków sterujących",
};
