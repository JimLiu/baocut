import { defineMessages } from '@baocut/protocol';
import { zhHans } from './image-preview-copy.zh-Hans.ts';
import { zhHant } from './image-preview-copy.zh-Hant.ts';
import { ja } from './image-preview-copy.ja.ts';
import { ko } from './image-preview-copy.ko.ts';
import { es } from './image-preview-copy.es.ts';
import { fr } from './image-preview-copy.fr.ts';
import { de } from './image-preview-copy.de.ts';
import { nl } from './image-preview-copy.nl.ts';
import { ptBR } from './image-preview-copy.pt-BR.ts';
import { it } from './image-preview-copy.it.ts';
import { ru } from './image-preview-copy.ru.ts';
import { pl } from './image-preview-copy.pl.ts';
import { tr } from './image-preview-copy.tr.ts';
import { vi } from './image-preview-copy.vi.ts';
const en = {
  retry: "Retry",
  openAttachment: "Open attachment",
  copy: "Copy image",
  image: "Image",
  canvasView: "Canvas",
  markup: "Markup",
  erase: "Erase",
  removeBg: "Remove background",
  select: "Select images",
  all: "Select all",
  clear: "Clear selection",
  undo: "Undo",
  redo: "Redo",
  brush: "Brush",
  rectangle: "Rectangle",
  arrow: "Arrow",
  text: "Text",
  stroke: "Stroke width",
  color: "Color",
  original: "Original",
  frames: "Frames",
  frame: "Frame",
  retime: "Download retimed GIF",
  sheet: "Frame grid",
  panorama: "360° panorama",
  reset: "Reset",
  editPrompt: "Describe how to edit this image…",
  unavailable: "Preview unavailable. You can still download the original.",
  pip: "Picture in picture",
  more: "More options",
  copyPath: "Copy path",
  saveCopy: "Save a copy…",
  fullPreview: "Expand preview",
  queueSelected: "Add selected images to draft",

  "previous": "Previous image",
  "next": "Next image",
  "zoomOut": "Zoom out",
  "zoomIn": "Zoom in",
  "fit": "Fit to window",
  "annotations": "Annotations",
  "ratio": "Change aspect ratio",
  "download": "Download",
  "add": "Add annotation",
  "edit": "Edit annotation",
  "save": "Save annotation",
  "cancel": "Cancel",
  "remove": "Delete",
  "queue": "Add to conversation draft",
  "hint": "Click or drag to mark a region. Annotations stay with each image.",
  "canvas": "Image; drag to pan. In annotation mode, press Enter to mark the center.",
  "gallery": "Images",
  "openTab": "Open in tab",
  "queued": "Image and request added to the draft. Send when ready.",
  "changeRequest": "Edit the image using these annotations. Create a new file and preserve the original.",
  "ratioRequest": "Adjust the image to this aspect ratio, preserving the subject and style. Create a new file and preserve the original."
};
export type ImagePreviewMessages = typeof en;
export const IMAGE = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, 'ja': ja, 'ko': ko, 'es': es, 'fr': fr, 'de': de, 'nl': nl, 'pt-BR': ptBR, 'it': it, 'ru': ru, 'pl': pl, 'tr': tr, 'vi': vi });
