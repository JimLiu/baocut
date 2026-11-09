import type { SandboxMessages } from './sandbox-copy.ts';

export const de: SandboxMessages = {
  help: `Verwendung:
  baocut sandbox create <Ordner> [--link-accounts-from <home>]
                                   Richtet einen eigenen Runtime-Ordner für Entwicklung und Tests ein: den Ordner mit einem
                                   Ordner projects darin, ein bin/baocut, das die CLI dieser Arbeitskopie mit diesem Ordner
                                   startet, und env.sh / env.ps1, die eine Shell darauf umstellen. Erneut ausführen
                                   aktualisiert diese Dateien. Nur aus einer Arbeitskopie des Repositorys; nie das Standard-~/.baocut
    --link-accounts-from <home>    Verknüpft zusätzlich die Modellkonten dieses Ordners (meist ~/.baocut) schreibgeschützt,
                                   wie baocut models accounts link --from. Aufrufe nutzen Ihre echten Konten und werden abgerechnet`,
  defaultHome: (dir) => `${dir} ist der Standard-Runtime-Ordner mit Ihren echten Daten; wählen Sie für die Sandbox einen anderen Ordner`,
  needsSourceCli:
    'baocut sandbox create läuft nur aus einer Arbeitskopie des Repositorys (node apps/cli/src/main.ts sandbox create …). Diese CLI startet die Runtime der BaoCut-App, die Schlüssel im Schlüsselbund des Systems ablegt, den alle Ordner teilen: Eine Sandbox dort könnte Ihre echten Schlüssel überschreiben oder löschen',
  unknownStore: (entry) => `BAOCUT_RUNTIME_ENTRY zeigt auf ${entry}, und es ist nicht bekannt, wo diese Runtime Schlüssel ablegt. Entfernen Sie die Variable, bevor Sie eine Sandbox anlegen`,
  notEmpty: (dir) => `${dir} enthält bereits Dateien und ist kein BaoCut-Ordner; wählen Sie einen neuen oder leeren Ordner`,
  notFolder: (dir) => `${dir} ist kein Ordner`,
  created: (dir) => `Sandbox bereit: ${dir}`,
  refreshed: (dir) => `Sandbox aktualisiert: ${dir}`,
  projects: (dir) => `  Projekte  ${dir}`,
  cli: (file) => `  baocut    ${file} (startet die CLI dieser Arbeitskopie)`,
  useHeader: 'So nutzen Sie sie in einer Shell:',
  useShell: (file) => `  ${file}`,
  usePowerShell: (file) => `  ${file}   (PowerShell)`,
  useNote:
    'Danach nutzen baocut in dieser Shell und daraus gestartete Agents die Sandbox; andere Shells nutzen weiter ~/.baocut. Ihre Runtime legt Schlüssel in einer Datei in der Sandbox ab',
  linkFailed: (dir) => `Die Sandbox in ${dir} ist bereit; das Verknüpfen der Konten ist fehlgeschlagen:`,
};
