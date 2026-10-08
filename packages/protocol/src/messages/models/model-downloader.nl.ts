import type { ModelsModelDownloaderMessages } from './model-downloader.ts';

export const nl: ModelsModelDownloaderMessages = {
  remedyNoSpace: "De schijf met de modellenmap is vol. Maak voldoende ruimte vrij (of verplaats de modellenmap naar een andere schijf bij Instellingen) en installeer opnieuw",
  remedyNetwork: "Het netwerk is onbereikbaar of de download is onderbroken. Controleer het netwerk en installeer opnieuw; wat al is gedownload wordt hervat. Je kunt ook een andere spiegelserver kiezen bij ‘Downloadbron voor modellen’ in ‘Instellingen › Algemeen’",
  remedyIntegrity: "Een gedownload bestand komt qua grootte of sha256 niet overeen met het manifest (de bron of spiegelserver heeft de verkeerde inhoud). Het onjuiste bestand is verwijderd; kies een andere downloadbron en installeer opnieuw",
  remedySource: "De downloadbron heeft dit bestand niet of weigert toegang. Controleer of de spiegelserver bij ‘Downloadbron voor modellen’ in ‘Instellingen › Algemeen’ (of de omgevingsvariabele BAOCUT_MODELS_ENDPOINT) volledig is",
  remedyManifestIncomplete: "Het ingebouwde manifest voor dit modelpakket mist een vertrouwde sha256, dus het kan niet worden geïnstalleerd. Wacht op een BaoCut-update",
  downloadFailed: (p: { file: string; reason: string }) => `Kan niet downloaden: ${p.file}: ${p.reason}`,
  integrityMismatch: (p: { file: string }) => `De grootte of sha256 van ${p.file} komt niet overeen met het manifest`,
  sourceHttp: (p: { file: string; status: number }) => `De downloadbron heeft HTTP geretourneerd: ${p.status} voor ${p.file}`,
  diskFull: "De schijf is vol geraakt tijdens het schrijven van modelbestanden",
};
