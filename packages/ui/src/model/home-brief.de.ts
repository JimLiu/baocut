import type { HomeBriefMessages } from './home-brief.ts';

export const de: HomeBriefMessages = {
  about: (minutes: number, seconds: number) =>
    `Etwa ${[minutes ? `${minutes} min` : "", seconds ? `${seconds} s` : ""].filter(Boolean).join(" ")}`,
  fromMaterials: "Ein Video aus den angehängten Materialien erstellen.",
  materials: (paths: readonly string[]) => `Materialien: ${paths.join(", ")}`,
  connectFirst: "Zuerst KI verbinden",
  sayFirst: "Wunsch beschreiben oder Materialien anhängen",
  agentOffTitle: "Alle installierten Coding-Agenten sind ausgeschaltet",
  agentOffBody: "Ein Coding-Agent ist installiert, aber in Einstellungen ausgeschaltet. Einen aktivieren, um hier zu starten.",
  enableNamed: (name: string) => `Einschalten: ${name}`,
  enableAgent: "Agenten einschalten",
  agentMissingTitle: "Dies benötigt einen Coding-Agenten",
  agentMissingBody: "Claude Code oder Codex CLI installieren und mit eigenem Abonnement anmelden; dann hier starten.",
  connectAgent: "Agenten verbinden",
  nameEmpty: "Projektnamen eingeben",
  nameInvalid: "Projektname darf keine Schrägstriche oder Steuerzeichen enthalten",
};
