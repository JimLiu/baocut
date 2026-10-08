const STEP: Record<UpdateStep, string> = { install: 'Installation starten', check: 'nach Updates suchen', download: 'Download starten', cancel: 'Download abbrechen', retry: 'erneut versuchen', downloadPage: 'Downloadseite öffnen' };
import type { UpdateMessages, UpdateStep } from './update-copy.ts';

export const de: UpdateMessages = {
  failed: (step: UpdateStep, message: string) => `Fehlgeschlagen: ${STEP[step]}: ${message}`,
  progress: "Downloadfortschritt",
  notes: "Neues in dieser Version",
  close: "Schließen",
};
