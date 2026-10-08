import type { DriversCommonMessages } from './drivers-common.ts';

export const nl: DriversCommonMessages = {
  executableMissing: (p: { command: string; path: string }) => `De opgegeven opdracht ${p.command} (${p.path}) bestaat niet of kan niet worden uitgevoerd.`,
  commandMissing: (p: { command: string; hint: string }) => `Kan de opdracht niet vinden: ${p.command}. ${p.hint} of stel de locatie in bij Instellingen.`,
  commandNotFound: (p: { command: string }) => `Kan de opdracht niet vinden: ${p.command}-opdracht`,
  installItFirst: "Installeer het eerst",
  versionFailed: (p: { command: string }) => `${p.command} --version is niet normaal afgesloten.`,
  outdated: (p: { name: string; version: string; min: string }) => `${p.name} ${p.version} is te oud. BaoCut vereist ${p.min} of nieuwer.`,
  startFailed: (p: { name: string; error: string }) => `${p.name} kan niet starten: ${p.error}`,
  openSessionFailed: (p: { name: string; error: string }) => `${p.name} kan geen sessie openen: ${p.error}`,
  confinedUnsupported: (p: { name: string }) => `${p.name} ondersteunt geen beperkte eenmalige aanroepen`,

  resumeFailed: (p: { name: string; error: string }) =>
    `Kan de oorspronkelijke sessie niet hervatten van ${p.name}${p.error ? ` (${p.error})` : ""}. Er is een nieuwe sessie gestart; de agent kan het eerdere sessie niet zien.`,
  sessionClosed: (p: { name: string }) => `De sessie van ${p.name} is gesloten`,
  sessionNotReady: (p: { name: string }) => `De sessie van ${p.name} is nog niet gereed`,
  turnInProgress: "De vorige beurt is nog niet voltooid",
  modelSwitchFailed: (p: { name: string; model: string; error: string }) => `${p.name} kan niet wisselen naar het model ${p.model}: ${p.error}`,
  timedOut: (p: { label: string; seconds: number }) => `${p.label} heeft de tijdslimiet overschreden (${p.seconds} s)`,
  unknownError: "Onbekende fout",
  unknownReason: "onbekende reden",

  imagePlaceholder: "[Afbeelding]",

  officialScript: "Officieel script",
};
