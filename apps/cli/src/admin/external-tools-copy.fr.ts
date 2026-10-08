import {  type ExternalToolStatus, type ExternalToolUpdateMethod } from '@baocut/protocol';
import { pluralForm } from '@baocut/protocol';
import type { ToolsMessages } from './external-tools-copy.ts';

export const fr: ToolsMessages = {

  help: `Utilisation :
  baocut external-tools [list]     Outils externes (yt-dlp, ffmpeg) : état, version, chemin,
                                   source et consentement à leur utilisation
  baocut external-tools detect [name]
                                   Détecter à nouveau
  baocut external-tools install <name> [--yes]
                                   Télécharger une copie gérée dans tools/ du Runtime Home : affiche source, version, taille
                                   et licence, puis télécharge après confirmation et vérifie sha256 (--yes vaut accord).
                                   Source : réglage tools.downloadEndpoint et variable BAOCUT_TOOLS_ENDPOINT
  baocut external-tools update <name> [--yes]
                                   Mettre à jour la copie système selon son installation (Homebrew, pipx, pip ou programme
                                   autonome officiel) : affiche la commande complète, exécutée par le Runtime après
                                   confirmation (--yes confirme), avec sortie ligne par ligne et nouvelle détection à la fin.
                                   Les commandes exigeant des droits administrateur sont seulement affichées ; exécutez-les vous-même
  baocut external-tools path <name> <file>|--clear
                                   Utiliser votre propre installation (vérifiée une fois avec --version) ; --clear retire ce choix
  baocut external-tools remove <name>
                                   Supprimer la copie gérée (copies système et chemins personnalisés inchangés)
  baocut external-tools consent <name> [--revoke]
                                   Accepter l’utilisation d’un outil de téléchargement, ou retirer l’accord (import par lien ensuite refusé)`,
  usage:
    "Utilisation : baocut external-tools [list] | detect [name] | install <name> [--yes] | update <name> [--yes] | path <name> <file>|--clear | remove <name> | consent <name> [--revoke]",
  clearOrFile: "Indiquez soit --clear, soit un fichier, pas les deux",
  stateLabels: {
    installed: "Installé",
    missing: "Non installé",
    outdated: "Mise à jour disponible",
    unavailable: "Indisponible",
  } satisfies Record<ExternalToolStatus['state'], string>,
  sourceLabels: {
    system: "PATH système",
    user: "chemin indiqué",
    managed: "copie téléchargée par BaoCut",
    env: "variable d’environnement",
  } satisfies Record<NonNullable<ExternalToolStatus['source']>, string>,
  updateMethodLabels: {
    homebrew: "Homebrew",
    pipx: "pipx",
    pip: "pip",
    standalone: "version autonome officielle",
    winget: "winget",
    scoop: "Scoop",
    chocolatey: "Chocolatey",
  } satisfies Record<ExternalToolUpdateMethod, string>,
  statusHead: (name: string, state: string, version: string | null, source: string | null, purpose: string) =>
    `${name}  ${state}${version ? ` ${version}` : ""}${source ? ` (${source})` : ""}  ${purpose}`,
  pathLine: (path: string) => `  Chemin : ${path}`,
  userPathLine: (path: string) => `  Chemin indiqué : ${path}`,
  managedLine: (version: string, path: string) => `  Copie gérée : ${version}  ${path}`,
  consentLine: (label: string) => `  Consentement : ${label}`,
  installingLine: (jobId: string) => `  Installation : tâche ${jobId}`,
  updatingLine: (jobId: string) => `  Mise à jour : tâche ${jobId}`,
  updateLine: (command: string, method: string, runnable: boolean) =>
    `  Mise à jour : ${command} (${method}${runnable ? "" : ", à exécuter vous-même dans un terminal"})`,
  reasonLine: (reason: string) => `  Motif : ${reason}`,
  remedyLine: (remedy: string) => `  Correction : ${remedy}`,
  consentMissing: (name: string) => `Pas encore accordé (donnez votre accord avant utilisation : baocut external-tools consent ${name})`,
  consentVia: { agent: "par l’approbation de l’Agent", cli: "dans la CLI", app: "dans l’application" },
  consentGranted: (at: string, via: string) => `Accordé (${at}, ${via})`,
  consentRevoked: (at: string) => `Retiré (${at})`,
  noTools: "Aucun outil externe enregistré",
  cannotUpdate: (label: string, reason: string) => `Impossible de mettre à jour ${label} pour vous : ${reason}`,
  runInTerminal: "Exécutez ceci dans un terminal :",
  redetect: (name: string) => `Puis vérifiez à nouveau : baocut external-tools detect ${name}`,
  updatePlanHead: (method: string, label: string, version: string | null) =>
    `Mettre à jour ${label}${version ? ` ${version}` : ""} selon son mode d’installation (${method})`,
  runLine: (command: string) => `  Exécuter : ${command}`,
  updatePrompt: (label: string) => `Exécuter cette commande sur cet ordinateur pour mettre à jour ${label} ? [y/N] `,
  omittedLines: (n: number) => `…(${n} ${pluralForm('fr', n, { one: "ligne", other: "lignes" })} omises)`,
  updated: (label: string, before: string | null, after: string) => `Mis à jour : ${label} : ${before ?? "version inconnue"} → ${after}`,
  upToDate: (label: string, version: string | null) => `${label} est à jour${version ? ` (${version})` : ""}`,
  sizeEstimated: (size: string) => `environ ${size} (taille inconnue, estimation)`,
  sizeAbout: (size: string) => `environ ${size}`,
  willDownload: (label: string, version: string) => `Télécharger ${label} ${version}`,
  sourceLine: (url: string | null) => `  Source : ${url ?? "(aucun fichier disponible pour cet ordinateur)"}`,
  sizeLine: (size: string) => `  Taille : ${size}`,
  licenseLine: (license: string) => `  Licence : ${license}`,
  homepageLine: (url: string) => `  Site web : ${url}`,
  sha256Line: (hash: string) => `  sha256 : ${hash}`,
  blockedLine: (reason: string) => `  Impossible de télécharger : ${reason}`,
  installPrompt: (label: string, version: string, size: string) => `Télécharger et utiliser ${label} ${version} (${size}) ? [y/N] `,
  noExternalTool: (name: string) => `Aucun outil externe « ${name} »`,
  alreadyInstalling: (jobId: string) => `Installation déjà en cours (tâche ${jobId}) ; affichage de la progression`,
  installDone: "Installation terminée",
  notDownloadedByBaoCut: (label: string, remedy: string | null | undefined) => `BaoCut ne télécharge pas ${label} : ${remedy ?? "installez-le vous-même"}`,
  cannotDownload: (label: string, reason: string | null) => `Impossible de télécharger ${label} : ${reason}`,
  notTtyAgreeDownload: "Hors d’un terminal : ajoutez --yes une fois le téléchargement accepté par l’utilisateur",
  notTtyConfirmRun: "Hors d’un terminal : ajoutez --yes une fois l’exécution confirmée par l’utilisateur",
  notDownloaded: "Non téléchargé",
  notRun: "Non exécuté",

  remedy: (remedy: string) => `Pour corriger : ${remedy}`,
  partialDownloadKept: (name: string) => `La partie téléchargée est conservée : exécutez baocut external-tools install ${name} pour reprendre`,
  alreadyUpdating: (jobId: string) => `Mise à jour déjà en cours (tâche ${jobId}) ; affichage de la sortie`,
  managedCopy: (label: string, name: string) =>
    `La version de ${label} utilisée a été téléchargée par BaoCut : utilisez baocut external-tools install ${name} pour changer de version`,
  unknownInstall: (file: string, name: string) =>
    `Impossible de déterminer comment ${file} a été installé : mettez-le à jour dans un terminal selon son mode d’installation, puis exécutez baocut external-tools detect ${name}`,
  noRunnableTool: (label: string, remedy: string) => `Aucune version exécutable de ${label} trouvée : ${remedy}`,
  updateManual: (label: string, command: string) => `La mise à jour de ${label} doit être effectuée vous-même dans un terminal : ${command}`,
  partialCommand: (name: string) =>
    `La commande a peut-être été partiellement exécutée : utilisez baocut external-tools detect ${name} pour voir la version actuelle`,
};
