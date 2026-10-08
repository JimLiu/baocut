import { defineMessages } from '@baocut/protocol';
import { zhHans } from './panel-copy.zh-Hans.ts';
import { zhHant } from './panel-copy.zh-Hant.ts';
import { ja } from './panel-copy.ja.ts';
import { ko } from './panel-copy.ko.ts';
import { es } from './panel-copy.es.ts';
import { fr } from './panel-copy.fr.ts';
import { de } from './panel-copy.de.ts';
import { nl } from './panel-copy.nl.ts';
import { ptBR } from './panel-copy.pt-BR.ts';
import { it } from './panel-copy.it.ts';
import { ru } from './panel-copy.ru.ts';
import { pl } from './panel-copy.pl.ts';
import { tr } from './panel-copy.tr.ts';
import { vi } from './panel-copy.vi.ts';

const en = {
  preview: "Preview",
  source: "Source",
  table: "Table",
  formatted: "Formatted",
  openDefault: "Open in default app",
  previousPage: "Previous page",
  nextPage: "Next page",
  fitWidth: "Fit width",
  zoom: "Zoom",
  csvInvalid: "Unclosed CSV quote. View the source.",
  jsonInvalid: "Invalid JSON. Showing the source.",
  column: (index: number) => `Column ${index}`,
  find: "Find in page",
  previousMatch: "Previous match",
  nextMatch: "Next match",
  closeFind: "Close find",
  device: "Device preview",
  phone: "Phone",
  tablet: "Tablet",
  laptop: "Laptop",
  custom: "Custom",
  width: "Width",
  height: "Height",
  rotate: "Rotate",
  closeDevice: "Close device preview",
  forceReload: "Reload without cache",
  duplicate: "Open in new tab",
  popupBlocked: "Popup blocked.",
  downloadExternal: "Download opened in your browser.",
  permissionBlocked: "Site permission denied.",
  dismiss: "Dismiss",
};
export type PanelMessages = typeof en;
export const PANEL = defineMessages(en, { "zh-Hans": zhHans, "zh-Hant": zhHant, "ja": ja, "ko": ko, "es": es, "fr": fr, "de": de, "nl": nl, "pt-BR": ptBR, "it": it, "ru": ru, "pl": pl, "tr": tr, "vi": vi });
