import type { RcFontsMessages } from './rc-fonts.ts';

export const nl: RcFontsMessages = {
  manageOnlyInAppOrCli: "Lettertypen kunnen alleen worden gedownload, verwijderd en gecontroleerd in de desktop-app of CLI",
  catalogueInvalid: "Het formaat van de lettertypecatalogus is onjuist",

  remedyNetwork:
    "Het netwerk is onbereikbaar of de download is onderbroken. Controleer het netwerk en download opnieuw of kies een andere spiegelserver bij ‘Stylesheet-URL’ en ‘Lettertypebestand-URL’ onder Instellingen › Lettertypen",
  remedySource: "De lettertypedienst heeft geen bestand voor dit lettertype gegeven. Controleer de familienaam en dikte of de spiegelserveradressen bij Instellingen",
  remedyIntegrity:
    "De download is geen bruikbaar lettertype (onjuiste familienaam, onleesbaar of te groot). Het onjuiste bestand is verwijderd; kies een andere spiegelserver en download opnieuw",
  remedyNoSpace: "De schijf met Runtime Home is vol. Maak ruimte vrij en download opnieuw",

  diskFullWriting: (p: { what: string }) => `De schijf is vol geraakt tijdens het schrijven van ${p.what}`,
  sourceHttpStatus: (p: { what: string; status: number }) => `De lettertypedienst heeft HTTP geretourneerd: ${p.status} voor ${p.what}`,
  downloadFailed: (p: { what: string; reason: string }) => `Het downloaden van ${p.what} mislukt: ${p.reason}`,
  overByteLimit: (p: { what: string; limit: number }) => `${p.what} overschrijdt de limiet van ${p.limit} bytes`,

  downloadCancelled: "Lettertypedownload geannuleerd",
  cancelled: "Download geannuleerd",
  offlineStrict: "Lettertypen worden niet gedownload in de strikte offlinemodus",
  autoDownloadOff: "Automatisch lettertypen downloaden staat uit (‘Lettertypen automatisch downloaden’ onder Instellingen › Lettertypen)",
  downloadFailedOutcome: (p: { reason: string }) => `Download mislukt: ${p.reason}`,
  notInCatalogue: (p: { family: string }) => `‘${p.family}’ staat niet in de lettertypecatalogus`,
  noNeedToDownload: (p: { family: string; bundled: boolean }) =>
    `‘${p.family}’ ${p.bundled ? "hoort bij de app" : "is al geïnstalleerd op deze computer"} en hoeft dus niet te worden gedownload`,
  inUseByExport: (p: { family: string }) => `‘${p.family}’ wordt gebruikt door een onvoltooide export. Verwijder het na afloop van de export`,

  sampleLabel: (p: { family: string }) => `het ${p.family} voorbeeld`,
  sampleCss: (p: { label: string }) => `het stylesheet voor ${p.label}`,
  noSampleBlock: (p: { label: string }) => `Het antwoord van de lettertypedienst bevat niet ${p.label}`,
  sampleNotOnHost: (p: { label: string }) => `${p.label} staat niet op de ingestelde lettertypebestandhost`,
  sampleNotUsable: (p: { label: string }) => `Het gedownloade bestand ${p.label} is geen bruikbaar lettertype`,

  faceLabel: (p: { family: string; weight: number; italic: boolean }) => `${p.family} ${p.weight}${p.italic ? " Cursief" : ""}`,
  faceCss: (p: { label: string }) => `het lettertypestylesheet voor ${p.label}`,
  noFaceBlock: (p: { label: string }) => `Het antwoord van de lettertypedienst bevat niet ${p.label}`,
  faceSplit: (p: { label: string }) => `De lettertypedienst heeft opgesplitst: ${p.label} in subsets per teken, die BaoCut nog niet kan samenvoegen`,
  faceNotOnHost: (p: { label: string }) => `Het bestand voor ${p.label} staat niet op de ingestelde lettertypebestandhost`,
  faceNotUsable: (p: { label: string }) => `Het gedownloade bestand ${p.label} is geen bruikbaar lettertype`,
  familyMismatch: (p: { label: string }) => `De familienaam van het gedownloade lettertype ${p.label} komt niet overeen`,
};
