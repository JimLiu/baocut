import { pluralForm } from '@baocut/protocol';
import type { ThreadMessages } from './thread-copy.ts';

export const nl: ThreadMessages = {

  videoTools: {
    videos_list: "Video’s tonen",
    videos_create: "Nieuwe video",
    videos_inspect: "Video lezen",
    edits_apply: "Video bewerken",
    edits_undo: "Bewerkingen ongedaan maken",
  } as Record<string, string>,

  toolTitle: (action: string, label: string) => `${action}: ${label}`,
  steps: { command: "Opdracht uitvoeren", read: "Bestand lezen", edit: "Bestand bewerken", search: "Zoeken", other: "Andere tool" },

  phrase: {
    command: "opdrachten uitgevoerd",
    read: (count: number) => `gelezen: ${count} ${pluralForm('nl', count, { one: "bestand", other: "bestanden" })}`,
    edit: (count: number) => `bewerkt: ${count} ${pluralForm('nl', count, { one: "bestand", other: "bestanden" })}`,
    search: "gezocht",
    video: (count: number) => `vastgelegd: ${count} video ${pluralForm('nl', count, { one: "bewerking", other: "bewerkingen" })}`,
    tool: "tools aangeroepen",
  },
  summary: (phrases: readonly string[]) => {
    const text = phrases.join(", ");
    return text.charAt(0).toUpperCase() + text.slice(1);
  },
  thinking: "Aan het nadenken",
  stepsFallback: "Stappen",
};
