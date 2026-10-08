import { pluralForm } from '@baocut/protocol';
import type { ServicesApiMessages } from './services-api-copy.ts';

export const de: ServicesApiMessages = {
  capabilities: {
    transcribe: "Transkribieren",
    synthesizeSpeech: "Sprache synthetisieren",
    generateImage: "Bilder erzeugen",
    generateText: "Text erzeugen",
  },
  endpoints: {
    models: "Modelle auflisten",
    model: "Modell abrufen",
    info: "Dienstinformationen und Schnittstellenversion",
    transcriptions: "Audio transkribieren",
    speech: "Sprache synthetisieren",
    images: "Bilder erzeugen",
    chat: "Text erzeugen (Chat)",
  },
  routing: {
    online: { label: "Onlinedienste", desc: "An verbundene Cloud-Dienste weiterleiten (mögliche Kosten; Daten verlassen diesen Computer)" },
    nodes: { label: "LAN-Knoten", desc: "An andere gekoppelte Computer weiterleiten" },
    agent: { label: "Agenten", desc: "An auf diesem Computer angemeldete Agenten-Runtimes weiterleiten (etwa Codex)" },
  },
  modelsAvailable: (n: number) => `${n} ${pluralForm('de', n, { one: "Modell", other: "Modelle" })} verfügbar`,
  notRouted: "Modelle verfügbar, aber Routing für ihre Kategorie aus; Anfragen derzeit mit 503",
  noModels: "Noch keine Modelle verfügbar; Anfragen derzeit mit 503",
  defaultModel: "Standardmodell",
  target: (provider: string, model: string) => `${provider} · ${model}`,
  aliasProviderMissing: "Anbieter nicht gefunden; Anfragen mit 404",
  aliasNotRouted: "Routing für diese Kategorie aus; Anfragen mit 404",
  aliasProviderUnavailable: "Dieser Anbieter ist derzeit nicht verfügbar",
  aliasModelUnavailable: "Dieses Modell ist derzeit nicht verfügbar",
  targetNotRouted: "Routing aus",
  targetUnavailable: "Derzeit nicht verfügbar",
  aliasNameEmpty: "Namen eingeben, etwa whisper-1",
  aliasNameSlash: "Namen dürfen kein „/“ enthalten: <provider>/<model> ist die kanonische Form; Aliase dürfen damit nicht kollidieren",
  aliasNameChars: "Nur Buchstaben, Ziffern und . _ : -; Beginn mit Buchstabe oder Ziffer",
  aliasNameTaken: (name: string) => `„${name}“ bereits vorhanden; zum Zielwechsel zuerst diese Zeile löschen`,
};
