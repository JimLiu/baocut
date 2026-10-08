import { pluralForm } from '@baocut/protocol';
import type { DubGroupMessages } from './dub-group-copy.ts';

export const nl: DubGroupMessages = {
  track: "Dit spoor op de tijdlijn tonen",
  trackGone: "Deze nasynchronisatiegroep staat niet meer op de tijdlijn",
  regen: (n: number) => `Opnieuw genereren: ${n} ${pluralForm('nl', n, { one: "zin", other: "zinnen" })}…`,
  regenNote: "Zinnen die niet zijn gesynthetiseerd of niet passen · kijk ze na, bewerk de vertaling indien nodig en voer alleen deze opnieuw uit",
  download: "Groep downloaden",
  downloadNote: "Hele groepen kunnen nog niet worden gedownload; kies ‘Alleen deze nasynchronisatiegroep’ bij het exporteren van audio om de mix van deze groep te krijgen",
  redub: "Deze taal opnieuw uitvoeren",
  redubNote: "Opent Vertaalde nasynchronisatie",
  remove: "Deze nasynchronisatiegroep verwijderen",
  removeNote: "Verwijdert de clips van deze groep van de tijdlijn en herstelt de oorspronkelijke audio; je kunt dit ongedaan maken. Het lege nasynchronisatiespoor en plan blijven behouden",
  removeLoading: "Nasynchronisatieplan laden…",
  readOnly: "De video is alleen-lezen",
  removed: (title: string) => `Verwijderd: ‘${title}’`,
  rowOnTimeline: (label: string) => `Rij ‘${label}’ op de tijdlijn`,
  undo: "Ongedaan maken",
  stateOn: "Op tijdlijn",
  stateOff: "Spoor uit",
  stateGone: "Niet op tijdlijn",
  groupMenu: "Deze nasynchronisatiegroep",
  actionsOf: (title: string) => `Acties voor ‘${title}’`,
  clickToSelect: (text: string) => `${text} · klik om die op de tijdlijn te selecteren`,
};
