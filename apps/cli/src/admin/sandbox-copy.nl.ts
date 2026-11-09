import type { SandboxMessages } from './sandbox-copy.ts';

export const nl: SandboxMessages = {
  help: `Gebruik:
  baocut sandbox create <map> [--link-accounts-from <home>]
                                   Zet een aparte Runtime-map op voor ontwikkelen en testen: de map met een map projects
                                   erin, een bin/baocut die de CLI van deze checkout op die map draait, en env.sh / env.ps1
                                   die een shell ernaar omzetten. Opnieuw uitvoeren ververst die bestanden. Alleen vanuit een
                                   checkout van de repository; nooit de standaard ~/.baocut
    --link-accounts-from <home>    Koppelt ook de modelaccounts van die map (meestal ~/.baocut) alleen-lezen, zoals baocut
                                   models accounts link --from. Aanroepen gebruiken je echte accounts en worden gefactureerd`,
  defaultHome: (dir) => `${dir} is de standaard Runtime-map, met je echte gegevens; kies een andere map voor de sandbox`,
  needsSourceCli:
    'baocut sandbox create werkt alleen vanuit een checkout van de repository (node apps/cli/src/main.ts sandbox create …). Deze CLI start de Runtime van de BaoCut-app, die sleutels bewaart in de sleutelhanger van het systeem, gedeeld door alle mappen: een sandbox daar kan je echte sleutels overschrijven of verwijderen',
  unknownStore: (entry) => `BAOCUT_RUNTIME_ENTRY wijst naar ${entry}, en het is niet bekend waar die Runtime sleutels bewaart. Haal de variabele weg voordat je een sandbox maakt`,
  notEmpty: (dir) => `${dir} bevat al bestanden en is geen BaoCut-map; kies een nieuwe of lege map`,
  notFolder: (dir) => `${dir} is geen map`,
  created: (dir) => `Sandbox klaar: ${dir}`,
  refreshed: (dir) => `Sandbox ververst: ${dir}`,
  projects: (dir) => `  Projecten  ${dir}`,
  cli: (file) => `  baocut     ${file} (draait de CLI van deze checkout)`,
  useHeader: 'Zo gebruik je hem in een shell:',
  useShell: (file) => `  ${file}`,
  usePowerShell: (file) => `  ${file}   (PowerShell)`,
  useNote:
    'Daarna gebruiken baocut in die shell en agents die je daarvandaan start de sandbox; andere shells blijven ~/.baocut gebruiken. De Runtime bewaart sleutels in een bestand in de sandbox',
  linkFailed: (dir) => `De sandbox in ${dir} is klaar; het koppelen van accounts is mislukt:`,
};
