import type { SpaceEntryKind } from '@baocut/protocol';
import type { ToolOutputsMessages } from './tool-outputs.ts';

export const nl: ToolOutputsMessages = {
  actionLabel: { 'open-movie': "Openen in editor", 'new-movie': "Hiervan een nieuwe video maken" },
  blockTextOnly: "Transcripten en ondertitels hebben een video- of audiobestand nodig om een nieuwe video te maken; dat kan hier nog niet",
  blockTrashed: "Herstel dit item eerst uit de prullenmand",
  blockGenerating: "Wordt nog gegenereerd; beschikbaar wanneer het klaar is",
  blockMissing: "Kan het bestand van dit resultaat niet vinden op deze computer",

  handover: {
    subtitle: "Vertaal deze ondertitels naar een andere taal met behoud van de tijdcodes.",
    document: "Schrijf een samenvatting van dit transcript.",
    audio: "Maak een video met deze audio.",
    image: "Maak een video met deze afbeelding als omslag.",
    'video-file': "Voeg ondertitels toe aan deze video.",
    export: "Voeg ondertitels toe aan deze video.",
    video: "Blijf deze video bewerken.",
  } as Partial<Record<SpaceEntryKind, string>>,
  handoverDefault: "Blijf aan dit resultaat werken.",
};
