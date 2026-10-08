import type { ToolSpaceInputMessages } from './tool-space-input.ts';

export const nl: ToolSpaceInputMessages = {
  reasons: {
    trashed: "In de prullenmand",
    generating: "Wordt nog gegenereerd; je kunt het kiezen wanneer het klaar is",
    missing: "Het bestand ontbreekt; verbind het opnieuw voordat je het kiest",
    failed: "De laatste generatie is mislukt",
    textOnly: "Alleen tekst uit .txt- en .md-documenten kan worden gelezen",
    subtitleOnly: "Alleen .srt- en .vtt-ondertitels worden geaccepteerd",
    noPath: "Dit item heeft geen bestand op deze computer; een nieuwe video moet beginnen met een lokaal bestand",
  },
  joinKinds: (labels: readonly string[]) => labels.join(", "),
};
