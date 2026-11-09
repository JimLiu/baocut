import type { SandboxMessages } from './sandbox-copy.ts';

export const it: SandboxMessages = {
  help: `Uso:
  baocut sandbox create <cartella> [--link-accounts-from <home>]
                                   Prepara una cartella Runtime separata per sviluppo e test: la cartella con una cartella
                                   projects dentro, un bin/baocut che esegue la CLI di questa copia del repository su quella
                                   cartella, ed env.sh / env.ps1 che spostano una shell su di essa. Eseguilo di nuovo per
                                   aggiornare quei file. Solo da una copia del repository; mai la ~/.baocut predefinita
    --link-accounts-from <home>    Collega anche, in sola lettura, gli account dei modelli di quella cartella (di solito
                                   ~/.baocut), come baocut models accounts link --from. Le chiamate usano i tuoi account reali e vengono addebitate`,
  defaultHome: (dir) => `${dir} è la cartella Runtime predefinita, con i tuoi dati reali; scegli un'altra cartella per la sandbox`,
  needsSourceCli:
    "baocut sandbox create funziona solo da una copia del repository (node apps/cli/src/main.ts sandbox create …). Questa CLI avvia il Runtime dell'app BaoCut, che conserva le chiavi nel portachiavi di sistema, condiviso da tutte le cartelle: una sandbox lì potrebbe sovrascrivere o eliminare le tue chiavi reali",
  unknownStore: (entry) => `BAOCUT_RUNTIME_ENTRY punta a ${entry} e non si sa dove quel Runtime conservi le chiavi. Rimuovila prima di creare una sandbox`,
  notEmpty: (dir) => `${dir} contiene già dei file e non è una cartella BaoCut; scegli una cartella nuova o vuota`,
  notFolder: (dir) => `${dir} non è una cartella`,
  created: (dir) => `Sandbox pronta: ${dir}`,
  refreshed: (dir) => `Sandbox aggiornata: ${dir}`,
  projects: (dir) => `  Progetti  ${dir}`,
  cli: (file) => `  baocut    ${file} (esegue la CLI di questa copia)`,
  useHeader: 'Per usarla in una shell:',
  useShell: (file) => `  ${file}`,
  usePowerShell: (file) => `  ${file}   (PowerShell)`,
  useNote:
    'Poi baocut in quella shell e gli agenti avviati da lì usano la sandbox; le altre shell continuano a usare ~/.baocut. Il suo Runtime conserva le chiavi in un file dentro la sandbox',
  linkFailed: (dir) => `La sandbox in ${dir} è pronta; il collegamento degli account non è riuscito:`,
};
