import type { RcVideoMessages } from './rc-video.ts';

export const nl: RcVideoMessages = {

  engineExited: "De video-engine is afgesloten, dus de wijziging is mogelijk niet vastgelegd. Probeer het opnieuw met dezelfde opdracht",
  engineStartFailed: (p: { reason: string }) => `Kan de video-engine niet starten: ${p.reason}`,
  engineNotRunning: "De video-engine loopt niet",
  engineRequestFailed: (p: { method: string }) => `De engine kan niet verwerken: ${p.method}`,
  engineRestarting: "De video-engine wordt opnieuw gestart. Probeer het zo opnieuw met dezelfde opdracht",
  runtimeStopping: "Runtime wordt gestopt",
  engineNotFound: "De video-engine (engine-host) is niet gevonden. Voer eerst npm run build:engine uit",


  defaultDirName: "Video",
  untitledVideo: "Video zonder titel",
  sourceDirNotFound: "De bronmap bestaat niet",
  reservedDirOutsideSource: "De gereserveerde map staat niet in de bronmap",
  videoInUse: "Deze video is geopend",
  videoNotOpenOpenFirst: "De video is niet geopend. Open die eerst",
  assetVersionNotFound: "De media of deze versie ervan bestaan niet",
  videoNotFound: "De video bestaat niet",
  onlyWorkspaceVideos: "Alleen video’s in de werkmap kunnen worden geopend",
  videoDeletedRestoreFromTrash: "Deze video is verwijderd. Herstel die eerst uit de prullenmand",
  dirNotVideo: "Deze map is geen video",
  linkedPreviewUnsupported: "Alleen gekoppelde afbeeldingen, audio, video, lettertypen en Lottie-animaties kunnen worden weergegeven als voorbeeld",
  packageNotFound: "Het draagbare pakket bestaat niet",
  packageNotFile: "Het draagbare pakket moet een .baocut-bestand zijn",
  videoInTrash: "Deze video staat in de prullenmand. Herstel die eerst",
  videoNotInSourceDir: "De video staat niet in een project- of sessiemap",
  cantCreateInSession: "Deze Runtime kan geen video’s maken in een sessie",
  targetLocationIncomplete: "De locatie van de doelvideo is onvolledig",
  reservedDirOutsideProject: "De gereserveerde map staat niet in deze project- of sessiemap",
  pipelinePrincipalName: "Pipeline",

  openElsewhere: "Deze video is geopend in een ander venster of verbinding. Sluit die daar eerst",
  videoBusy: "Deze video heeft nog lopende taken of exports. Annuleer die eerst",
  crossDevice: "De videomap en bronmap staan niet op dezelfde schijf, dus de video kan niet naar de prullenmand worden verplaatst",
  videoEntryNotFound: "Kan deze video niet vinden (staat niet in Space of Space scant nog)",
  notDeletedVideo: "Dit item is geen verwijderde video",
  restoreRootGone: "Het project of de sessie van deze video is verdwenen, dus die kan niet worden hersteld",
  trashDirGone: "De videomap in de prullenmand is verdwenen",
  sourceRootInTrash:
    "Deze videomap is een projectmap of de werkmap van een sessie (of bevat die), dus die kan niet naar de prullenmand worden verplaatst",
  sourceRootRemedy:
    "Verwijder eerst het project of de sessie die deze map gebruikt in BaoCut en verwijder daarna deze video uit het bovenliggende project",
  compositionImportFailed: (p) => `Kan de bewegende graphic niet importeren (${p.code})`,
  compositionPreviewFailed: (p) => `Kan geen voorbeeld van de bewegende graphic tonen (${p.code})`,
};
