import { pluralForm } from '@baocut/protocol';
import { intlLocale } from '@baocut/protocol';
import type { FontSettingsMessages } from './font-settings-copy.ts';

export const de: FontSettingsMessages = {

  lead: (total: number | null) =>
    `Schriften stammen aus drei Quellen: in der App enthalten, auf diesem Computer installiert und Google-Fonts-Verzeichnis (${total === null ? "etwa zweitausend" : `etwa ${total.toLocaleString(intlLocale())}`} Familien, Open-Source-Lizenzen, bei Bedarf heruntergeladen). Downloads senden nur Familienname und Schriftstärke und benötigen kein Konto. Schriften liegen in App-Daten, nicht im Videoordner.`,
  download: "Herunterladen",
  autoDownload: "Schriften automatisch herunterladen",
  autoDownloadDesc:
    "Lädt von Google Fonts herunter, wenn Vorschau, Videoöffnung oder Export eine fehlende Schrift benötigen. Ausgeschaltet werden zuerst Ersatzschriften für Anzeige und Export verwendet; bei Schriftauswahl ist manuelles Herunterladen möglich. Im strikten Offlinemodus keine Downloads.",
  cssEndpoint: "Stylesheet-URL",
  cssEndpointDesc: "Basis-URL eines Spiegelservers. Leer lassen für https://fonts.googleapis.com.",
  fileEndpoint: "Schriftdatei-URL",
  fileEndpointDesc: "Schriftdateien werden nur unter dieser URL abgerufen. Leer lassen für https://fonts.gstatic.com.",
  downloaded: "Heruntergeladene Schriften",
  summary: (families: number, size: string) => `${families} ${pluralForm('de', families, { one: "Familie", other: "Familien" })} · ${size}`,
  none: "Noch keine",
  clearAll: "Alle entfernen",
  empty: "Hier erscheinen bei Schriftauswahl oder automatisch beim Öffnen eines Videos oder Export heruntergeladene Schriften.",
  clearTitle: "Heruntergeladene Schriften löschen?",
  clear: "Löschen",
  cancel: "Abbrechen",
  removed: (family: string, size: string) => `Gelöscht: „${family}“ · Freigegeben: ${size}`,
  inUseTip: "Ein nicht abgeschlossener Export verwendet sie; nach Abschluss löschen",
  removeTip: "Heruntergeladene Dateien dieser Schrift löschen",

  removeLabel: (tip: string, family: string) => `${tip}: ${family}`,

  facts: (weights: string, size: string, licence: string, ago: string | null) =>
    `Schriftstärken ${weights} · ${size} · ${licence}${ago ? ` · Heruntergeladen ${ago}` : ""}`,
  inUse: "Vom Export verwendet",
};
