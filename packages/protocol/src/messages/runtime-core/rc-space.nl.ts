import type { RcSpaceMessages } from './rc-space.ts';

export const nl: RcSpaceMessages = {

  dirUnreadable: (p: { code: string }) => `Kan de map niet lezen (${p.code})`,
  tooManyDirEntries: (p: { max: number }) => `Meer dan ${p.max} mapitems; slechts een deel wordt getoond`,
  tooManyFiles: (p: { max: number }) => `Meer dan ${p.max} bestanden; slechts een deel wordt getoond`,

  entryGone: "Dit item staat niet meer in Space",
  trashVideoUseDelete: "Gebruik videos.delete om een video te verwijderen",
  restoreVideoUseRestore: "Gebruik videos.restore om een verwijderde video te herstellen",
  videoDeletedRestoreFirst: "Deze video is verwijderd. Herstel die eerst",
  videoDeleted: "Deze video is verwijderd",
  notInSourceDir: "Dit item staat niet in een project- of sessiemap",
  stillGeneratingNoFile: "Wordt nog gegenereerd; er is nog geen bestand",
  noReadableFile: "Dit item heeft geen leesbaar bestand",
  entryStillGeneratingNoFile: "Dit item wordt nog gegenereerd; er is nog geen bestand",
  entryInTrash: "Dit item staat in de prullenmand. Herstel het eerst",
  entryKindNotAccepted: (p: { kind: string }) => `Een item van het type ${p.kind} kan hier niet worden gebruikt`,
  notVideo: "Dit item is geen video",

  projectNotFound: "Het project bestaat niet",
  needAbsolutePath: "Geef het absolute pad van het bestand op",
  fileNotFound: "Het bestand bestaat niet",
  unrecognizedFileType:
    "Kan het bestandstype niet bepalen. Alleen video-, afbeeldings-, audio-, ondertitel- en documentbestanden kunnen worden toegevoegd",
  projectDirNotFound: "De projectmap bestaat niet",
  hiddenDirFile: "Bestanden in verborgen mappen of afhankelijkheidsmappen kunnen niet worden toegevoegd",
  videoDirFile: "Bestanden in een videomap horen bij de video en kunnen niet afzonderlijk worden toegevoegd",
  tooManySameName: "Te veel bestanden met dezelfde naam in imports/ van het project",

  purgeVideoDeleteFirst:
    "Verwijder de video eerst (videos.delete) om die naar de prullenmand te verplaatsen, en verwijder die daarna definitief uit de prullenmand",
  purgeTaskRunning: "De taak loopt nog. Annuleer die eerst (jobs.cancel)",
  purgeNotTrashed: "Verplaats het eerst naar de prullenmand en verwijder het daaruit",
  videoSourceGone: "De bron van deze video is verdwenen",
  refRunningTaskUsesVideo: (p: { jobId: string }) => `Taak ${p.jobId} loopt en gebruikt deze video`,
  refTaskAwaitsDecision: (p: { jobId: string }) =>
    `Taak ${p.jobId} heeft resultaten waarvoor je moet bepalen of ze aan deze video worden toegevoegd`,

  refStrayFiles: (p: { names: string; total: number }) =>
    `De videomap bevat bestanden die de video niet beheert (${new Intl.ListFormat("nl", { style: "long", type: "conjunction" }).format(p.names.split("/"))}${p.total > 3 ? `, ${p.total} in totaal` : ""}). Herstel de video en verplaats die bestanden naar buiten voordat je verwijdert`,
  refRunningTaskUsesOutput: (p: { jobId: string }) => `Taak ${p.jobId} loopt en gebruikt deze uitvoer`,
  refVideoUnreadable: (p: { dir: string }) =>
    `Video ${p.dir} kan nu niet worden gelezen (of de index wordt nog bijgewerkt), dus er kan niet worden bevestigd dat die dit bestand niet gebruikt`,
  refVideoAssetLinks: (p: { video: string; asset: string }) => `Media ‘${p.asset}’ in video ‘${p.video}’ koppelt naar dit bestand`,

  importedFileGone: "Het toegevoegde bestand staat niet meer in de projectmap",
  resultNotApplied: "Het resultaat is niet toegepast op de video",
  taskNotFinished: "De taak is niet voltooid",
  outputFileGone: "Het uitvoerbestand is verdwenen",
  exportedFileGone: "Het geëxporteerde bestand is verdwenen",
  labelSynthesizeSpeech: "Gesynthetiseerde spraak",
  labelGenerateImage: "Gegenereerde afbeelding",
  labelGenerateMusic: 'Gegenereerde muziek',
  labelGenerateText: "Gegenereerde tekst",
  labelSummary: "Samenvatting",
  labelBlog: "Blogbericht",
  labelTitles: "Titels",
  labelDescription: "Beschrijving",
  labelExport: "Exporteren",

  engineUnavailable: "De video-engine is niet beschikbaar",
  continueFromTrash: "Items in de prullenmand kunnen niet worden voortgezet. Herstel het eerst",
  conversationCantSee:
    "Deze sessie kan dit item niet zien. Items die bij een project horen moeten naar een sessie in hetzelfde project",
  serviceUsesMcp: "Externe diensten benaderen Space via MCP-tools",
  materialTextOnly: (p: { fileName: string }) =>
    `Alleen tekst uit .txt- en .md-documenten en .srt- en .vtt-ondertitels kan worden gelezen: ${p.fileName}`,
  materialTooLarge: (p: { fileName: string; bytes: number; limit: number }) =>
    `${p.fileName} is ${p.bytes} bytes, boven de medialimiet van ${p.limit}`,
  afterMaterial: (p: { reason: string }) => `Na het toevoegen van de media: ${p.reason}`,
  invalidParams: "Ongeldige parameters",
  relatedNotVideo: 'Alleen video’s tonen verwante video’s',
  indexDirNested: 'De nieuwe locatie en de huidige indexmap bevatten elkaar. Kies een map die er niet in ligt en hem ook niet bevat',
  indexDirNoSpace:
    'Op de schijf van de nieuwe locatie is geen ruimte voor de index. Kies een andere map, of bouw de index daar opnieuw op in plaats van hem te verplaatsen',
  indexDirOccupied:
    'Deze map heeft al een semantische index. Kies een lege map, of bouw de index daar opnieuw op om de bestaande te gebruiken',
  indexDirMoving: 'De index wordt verplaatst. Wacht tot het verplaatsen klaar is',
  indexDirMoveFailed: (p: { reason: string }) => `De index kon niet worden verplaatst en blijft waar hij was: ${p.reason}`,
  folderReadOnly: 'Dit staat in een indexmap, die BaoCut alleen leest. Het kan niet naar de prullenbak, verwijderd of bewerkt worden',
  folderNotFound: 'De map bestaat niet',
  folderUnknown: 'Die indexmap staat niet in de lijst',
  folderInside: (p: { name: string }) => `Deze map wordt al geïndexeerd als deel van ‘${p.name}’`,
};
