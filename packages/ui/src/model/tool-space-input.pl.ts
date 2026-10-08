import type { ToolSpaceInputMessages } from './tool-space-input.ts';

export const pl: ToolSpaceInputMessages = {
  reasons: {
    trashed: "W koszu",
    generating: "Trwa generowanie; możesz wybrać po ukończeniu",
    missing: "Brak pliku; podłącz go ponownie przed wybraniem",
    failed: "Ostatnie generowanie nie powiodło się",
    textOnly: "Można odczytać tylko tekst z dokumentów .txt i .md",
    subtitleOnly: "Akceptowane są tylko napisy .srt i .vtt",
    noPath: "Ten element nie ma pliku na tym komputerze; nowe wideo musi zaczynać się od pliku lokalnego",
  },
  joinKinds: (labels) => labels.join(", "),
};
