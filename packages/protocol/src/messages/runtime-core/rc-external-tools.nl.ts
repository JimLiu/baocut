import type { RcExternalToolsMessages } from './rc-external-tools.ts';

export const nl: RcExternalToolsMessages = {
  sourceBundled: "de kopie die met BaoCut wordt meegeleverd",
  archiveBroken: (p) => `${p.file} kan niet worden uitgepakt: ${p.reason}`,
  manageOnlyInAppOrCli: "Externe tools kunnen alleen worden beheerd in de desktop-app of CLI",
  videoNotOpen: "De video is niet geopend",

  toolUpdating: (p: { label: string }) => `${p.label} wordt bijgewerkt`,
  waitForUpdate: (p: { jobId: string }) => `Probeer het opnieuw na voltooiing van updatetaak ${p.jobId}`,
  toolNotInstalled: (p: { label: string }) => `${p.label} is niet geïnstalleerd`,
  toolCannotRun: (p: { label: string; reason: string }) => `${p.label} kan niet worden uitgevoerd: ${p.reason}`,
  toolOutdated: (p: { label: string; reason: string }) => `${p.label} is verouderd: ${p.reason}`,
  consentRevoked: (p: { label: string }) => `Toestemming voor gebruik van ${p.label} is ingetrokken`,
  consentRequired: (p: { label: string }) => `Het gebruik van ${p.label} vereist eerst toestemming van de gebruiker`,
  consentRemedy: (p: { name: string }) =>
    `Probeer het opnieuw nadat de gebruiker toestemming geeft: externalTools.consent (baocut external-tools consent ${p.name}) of geef toestemming bij het installeren (externalTools.install met consent: true)`,

  notExecutable: (p: { path: string }) => `${p.path} is geen uitvoerbaar bestand`,
  notWindowsProgram: (p: { path: string }) =>
    `${p.path} is geen Windows-programma (.exe): BaoCut voert externe tools niet uit via een opdrachtinterpreter`,
  cannotRunAs: (p: { path: string; label: string; reason: string }) => `${p.path} kan niet worden uitgevoerd als ${p.label}: ${p.reason}`,
  noVersion: "Kan de versie niet lezen",
  toolInUse: (p: { label: string }) => `${p.label} wordt geïnstalleerd of gebruikt door een taak`,
  notDownloadedByBaocut: (p: { label: string; remedy: string }) => `BaoCut downloadt niet: ${p.label}: ${p.remedy}`,
  downloadNeedsConsent: (p: { label: string }) =>
    `Het downloaden van ${p.label} vereist toestemming van de gebruiker: bevestig eerst de bron, versie, grootte en licentie`,
  offlineStrictNoDownload: "Externe tools worden niet gedownload in de strikte offlinemodus",
  cannotDownload: (p: { label: string; reason: string }) => `Kan niet downloaden: ${p.label}: ${p.reason}`,
  manifestIncompleteRemedy: (p: { label: string }) =>
    `Wacht tot BaoCut het manifest bijwerkt of installeer zelf: ${p.label}; stel het pad in met externalTools.setPath`,
  updateManagedCopy: (p: { label: string }) => `${p.label} is een kopie die BaoCut heeft gedownload en wordt daarom niet bijgewerkt via het installatieprogramma`,
  updateUnknownInstall: (p: { path: string }) => `Kan niet bepalen hoe dit is geïnstalleerd: ${p.path}`,
  updateNoRunnable: (p: { label: string }) => `Geen werkende installatie van ${p.label} gevonden`,
  updateManagedRemedy: "Gebruik externalTools.install om te wisselen naar de versie in het manifest",
  updateManualRemedy: "Werk het in een terminal bij op dezelfde manier als het is geïnstalleerd en detecteer opnieuw (externalTools.detect)",
  cannotUpdateFor: (p: { label: string }) => `BaoCut kan niet bijwerken: ${p.label} voor je`,
  runInTerminalRemedy: (p: { command: string }) => `Voer ${p.command} uit in een terminal en detecteer opnieuw (externalTools.detect)`,
  confirmUpdateCommand: (p: { label: string; command: string }) => `Het bijwerken van ${p.label} vereist eerst dat de gebruiker deze opdracht bevestigt: ${p.command}`,
  updateCommandChanged: (p: { label: string; command: string }) => `De updateopdracht voor ${p.label} is gewijzigd. Bevestig die opnieuw: ${p.command}`,
  offlineStrictNoUpdate: "Externe tools worden niet bijgewerkt in de strikte offlinemodus",
  unknownTool: (p: { name: string }) => `Geen externe tool ‘${p.name}’`,
  notManaged: (p: { label: string; remedy: string }) => `BaoCut beheert niet: ${p.label}: ${p.remedy}`,
  endpointInvalid: "De downloadbron voor externe tools is geen geldig adres",
  endpointBadForm:
    "De downloadbron voor externe tools moet een basisadres zijn dat begint met http(s)://, zonder inloggegevens, queryparameters of fragment",

  sourceEnvVar: (p: { name: string }) => `de omgevingsvariabele ${p.name}`,
  sourceUserPath: "het pad dat je hebt ingesteld",
  sourceManaged: "de kopie die BaoCut heeft gedownload",
  commandNotFound: (p: { command: string }) => `${p.command} niet gevonden`,
  commandNotFoundIn: (p: { where: string; command: string }) => `${p.command} niet gevonden in ${p.where}`,
  sourceNotExecutable: (p: { where: string }) => `${p.where} is geen uitvoerbaar bestand`,
  sourceIsScript: (p: { where: string; batch: boolean }) =>
    `${p.where} verwijst naar ${p.batch ? "batchscript" : "script"}, geen Windows-programma (.exe); BaoCut voert externe tools niet uit via een opdrachtinterpreter`,
  setExePathRemedy: (p: { command: string; canInstall: boolean }) =>
    `Stel het pad in op ${p.command}.exe met externalTools.setPath${p.canInstall ? " of download het met externalTools.install" : ""}`,
  belowMinVersion: (p: { version: string; min: string }) => `${p.version} is ouder dan de minimumversie ${p.min}`,
  installOrUpdateRemedy: (p: { version: string; label: string }) =>
    `Downloaden: ${p.version} met externalTools.install of werk ${p.label} op je systeem bij`,
  updateTool: (p: { label: string }) => `Bijwerken: ${p.label}`,

  diskFull: "De schijf is vol geraakt tijdens het schrijven van het toolbestand",
  downloadedCannotRun: (p: { label: string; reason: string }) => `Het gedownloade bestand ${p.label} kan niet worden uitgevoerd: ${p.reason}`,
  updateStopped: "Bijwerken gestopt",
  updateExited: (p: { code: string }) => `De updateopdracht is afgesloten met ${p.code}`,
  updateTimedOut: (p: { minutes: number }) => `De updateopdracht is niet voltooid binnen ${p.minutes} minuten en is gestopt`,
  updateSignalled: (p: { signal: string }) => `De updateopdracht is beëindigd door signaal ${p.signal}`,
  updateCannotStart: (p: { reason: string }) => `De updateopdracht kan niet starten (${p.reason})`,
  updateFailedRemedy: (p: { command: string }) => `Controleer de uitvoer in de taak of voer ${p.command} uit in een terminal en detecteer opnieuw`,

  remedyNoSpace: "De schijf met Runtime Home is vol. Maak ruimte vrij en installeer opnieuw",
  remedyNetwork:
    "Het netwerk is onbereikbaar of de download is onderbroken. Controleer het netwerk en installeer opnieuw (het gedownloade deel wordt hervat) of kies een andere spiegelserver bij ‘Downloadbron voor tools’ onder Instellingen › Algemeen",
  remedyIntegrity:
    "Het gedownloade bestand komt qua grootte of sha256 niet overeen met het manifest (de bron of spiegelserver heeft onjuiste inhoud). Het onjuiste bestand is verwijderd; kies een andere downloadbron en installeer opnieuw",
  remedySource:
    "De downloadbron heeft dit bestand niet of weigert toegang. Controleer de spiegelserver bij ‘Downloadbron voor tools’ onder Instellingen › Algemeen (of de omgevingsvariabele BAOCUT_TOOLS_ENDPOINT)",
  downloadFailed: (p: { file: string; reason: string }) => `Het downloaden van ${p.file} mislukt: ${p.reason}`,
  integrityMismatch: (p: { file: string }) => `${p.file} komt qua grootte of sha256 niet overeen met het manifest`,
  sourceHttpStatus: (p: { file: string; status: number }) => `De downloadbron heeft HTTP geretourneerd: ${p.status} voor ${p.file}`,
  largerThanManifest: (p: { file: string }) => `${p.file} is groter dan het manifest vermeldt`,

  ytDlpLicense: "Unlicense (broncode); het zelfstandige uitvoerbare bestand bevat GPLv3+-componenten en valt als geheel onder GPLv3+",
  ytDlpPurpose: "Import via link: leest de videopagina en downloadt media en ondertitels",
  ytDlpMissingRemedy:
    "Download het met externalTools.install (baocut external-tools install yt-dlp) of installeer het zelf en stel het pad in met externalTools.setPath",
  ffmpegPurpose: "Media-analyse, bestandstranscodering, exports en audio en video samenvoegen na downloads",
  noReleaseForPlatform: (p: { platform: string }) => `Geen releasebestand voor deze computer (${p.platform})`,
  noTrustedSha: "Het ingebouwde manifest heeft nog geen vertrouwde sha256 voor dit bestand, dus het kan niet worden gedownload",

  probeCannotStart: (p: { error: string }) => `Kan niet starten: ${p.error}`,
  probeTimeout: (p: { command: string; seconds: number }) => `${p.command} is niet voltooid binnen ${p.seconds} seconden`,
  probeCannotStartCode: (p: { code: string }) => `Kan niet starten (${p.code})`,
  probeExited: (p: { code: string; detail: string }) => `Afgesloten met ${p.code}${p.detail ? `: ${p.detail}` : ""}`,

  pipxMissing: (p: { label: string }) => `Deze sessie met ${p.label} is geïnstalleerd met pipx, maar pipx staat niet in PATH.`,
  brewMissing: (p: { label: string; brew: string }) => `Deze sessie met ${p.label} is geïnstalleerd met Homebrew, maar daarvan kan het bestand ${p.brew} niet worden gevonden.`,
  wingetMachineWide: (p: { label: string; dir: string }) =>
    `Deze sessie met ${p.label} is geïnstalleerd met winget voor alle gebruikers (${p.dir}) en vereist beheerdersrechten om bij te werken; BaoCut verhoogt die niet voor je. Open een terminal als beheerder en voer deze opdracht uit.`,
  wingetMissing: (p: { label: string }) => `Deze sessie met ${p.label} is geïnstalleerd met winget, maar winget staat niet in PATH.`,
  scoopGlobal: (p: { label: string; dir: string }) =>
    `Deze sessie met ${p.label} is een globale Scoop-installatie (${p.dir}) en vereist beheerdersrechten om bij te werken; BaoCut verhoogt die niet voor je. Open een terminal als beheerder en voer deze opdracht uit.`,
  scoopMissing: (p: { label: string; script: string }) => `Deze sessie met ${p.label} is geïnstalleerd met Scoop, maar Scoop zelf kan niet worden gevonden (${p.script}).`,
  chocolateyAdmin:
    "Programma’s die met Chocolatey zijn geïnstalleerd vereisen beheerdersrechten om bij te werken; BaoCut verhoogt die niet voor je. Open een terminal als beheerder en voer deze opdracht uit.",
  pythonScriptMissing: "De Python-interpreter waar dit startscript naar verwijst bestaat niet meer.",
  pipAdmin: (p: { label: string; dir: string }) =>
    `Deze sessie met ${p.label} is geïnstalleerd in ${p.dir}; wijzigen vereist beheerdersrechten. BaoCut verhoogt die niet voor je. Werk het bij op dezelfde manier als het is geïnstalleerd.`,
  pythonLauncherMissing: "De Python-interpreter waar dit startprogramma naar verwijst bestaat niet meer.",
  pipAdminWin: (p: { label: string; dir: string }) =>
    `Deze sessie met ${p.label} is geïnstalleerd in ${p.dir}; wijzigen vereist beheerdersrechten. BaoCut verhoogt die niet voor je. Open een terminal als beheerder en voer deze opdracht uit.`,
  standaloneAdmin: (p: { label: string; dir: string }) =>
    `${p.dir}; daar staat ${p.label} en wijzigen vereist beheerdersrechten. BaoCut verhoogt die niet voor je.`,
  standaloneAdminWin: (p: { label: string; dir: string }) =>
    `${p.dir}; daar staat ${p.label} en wijzigen vereist beheerdersrechten. BaoCut verhoogt die niet voor je. Open een terminal als beheerder en voer deze opdracht uit.`,
  realesrganLicense: 'MIT (het ncnn-programma); Real-ESRGAN-modellen BSD-3-Clause; gebouwd met ncnn (BSD-3-Clause)',
  realesrganPurpose: 'Afbeelding opschalen: vergroot afbeeldingen 2–4× met Real-ESRGAN op de GPU van deze computer',
  realesrganMissingRemedy: 'Download het met externalTools.install (baocut external-tools install realesrgan-ncnn-vulkan), of pak de officiële release zelf uit (laat de map models naast het programma staan) en stel het pad in met externalTools.setPath',
  waifu2xLicense: `MIT (waifu2x-ncnn-vulkan en de modellen); gebouwd met ncnn (BSD-3-Clause)`,
  waifu2xPurpose: `Afbeelding opschalen: vergroot anime-achtige illustraties en foto's 2–4× met waifu2x op de GPU van deze computer, met optionele ruisonderdrukking`,
  waifu2xMissingRemedy: `Download het met externalTools.install (baocut external-tools install waifu2x-ncnn-vulkan), of pak de officiële release zelf uit (laat de mappen models-* naast het programma staan) en stel het pad in met externalTools.setPath`,
  upscaylModelsLabel: `Upscayl-modellen`,
  upscaylModelsPurpose: `Afbeelding opschalen: vijf extra opschaalmodellen van Upscayl (Lite, High Fidelity, Remacri, UltraMix Balanced, UltraSharp), uitgevoerd door Real-ESRGAN op deze computer`,
  upscaylModelsLicense: `Gewichten uit de Upscayl-repository (AGPL-3.0). UltraSharp en Remacri zijn CC BY-NC-SA 4.0 (geen commercieel gebruik); High Fidelity is CC BY 4.0; UltraMix Balanced en Upscayl Lite vermelden geen eigen licentie`,
  upscaylModelsMissingRemedy: `Download ze met externalTools.install (baocut external-tools install upscayl-models), of stel met externalTools.setPath de map models van een geïnstalleerde Upscayl in`,
  packDirIncomplete: (p) => `In ${p.path} ontbreekt ${p.files}`,
  packFilesMissing: (p) => `In ${p.where} ontbreekt ${p.files}`,
  packDirNeedsModels: `Real-ESRGAN accepteert alleen een map met gewichten waarvan het pad „models” bevat`,
};
