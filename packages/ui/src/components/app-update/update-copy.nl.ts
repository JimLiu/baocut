const STEP: Record<UpdateStep, string> = { install: 'beginnen met installeren', check: 'controleren op updates', download: 'beginnen met downloaden', cancel: 'de download annuleren', retry: 'opnieuw proberen', downloadPage: 'de downloadpagina openen' };
import type { UpdateMessages, UpdateStep } from './update-copy.ts';

export const nl: UpdateMessages = {
  failed: (step: UpdateStep, message: string) => `Kan niet ${STEP[step]}: ${message}`,
  progress: "Downloadvoortgang",
  notes: "Nieuw in deze versie",
  close: "Sluiten",
};
