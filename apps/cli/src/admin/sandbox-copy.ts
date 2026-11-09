import { defineMessages } from '@baocut/protocol';
import { zhHans } from './sandbox-copy.zh-Hans.ts';
import { zhHant } from './sandbox-copy.zh-Hant.ts';
import { ja } from './sandbox-copy.ja.ts';
import { ko } from './sandbox-copy.ko.ts';
import { es } from './sandbox-copy.es.ts';
import { fr } from './sandbox-copy.fr.ts';
import { de } from './sandbox-copy.de.ts';
import { nl } from './sandbox-copy.nl.ts';
import { ptBR } from './sandbox-copy.pt-BR.ts';
import { it } from './sandbox-copy.it.ts';
import { ru } from './sandbox-copy.ru.ts';
import { pl } from './sandbox-copy.pl.ts';
import { tr } from './sandbox-copy.tr.ts';
import { vi } from './sandbox-copy.vi.ts';

/** `baocut sandbox` 的文案（英文是键与类型的来源，译文在 `sandbox-copy.<语言>.ts`）。 */
const en = {
  help: `Usage:
  baocut sandbox create <folder> [--link-accounts-from <home>]
                                   Set up a separate Runtime home for development and testing: the folder with a
                                   projects folder inside, a bin/baocut that runs this checkout's CLI on that home,
                                   and env.sh / env.ps1 that switch a shell to it. Run it again to refresh those files.
                                   Only from a repository checkout; never the default ~/.baocut
    --link-accounts-from <home>    Also link the model accounts of that home (usually ~/.baocut) read-only, as
                                   baocut models accounts link --from does. Calls use your real accounts and are billed`,
  defaultHome: (dir: string) => `${dir} is the default Runtime home, with your real data; pick another folder for a sandbox`,
  needsSourceCli:
    "baocut sandbox create runs only from a repository checkout (node apps/cli/src/main.ts sandbox create …). This CLI starts the BaoCut app's Runtime, which keeps keys in the system keychain shared by every home: a sandbox there could overwrite or delete your real keys",
  unknownStore: (entry: string) =>
    `BAOCUT_RUNTIME_ENTRY points to ${entry}, and where that Runtime keeps keys isn't known. Unset it before creating a sandbox`,
  notEmpty: (dir: string) => `${dir} already has files and isn't a BaoCut home; pick a new or empty folder`,
  notFolder: (dir: string) => `${dir} isn't a folder`,
  created: (dir: string) => `Sandbox ready: ${dir}`,
  refreshed: (dir: string) => `Sandbox refreshed: ${dir}`,
  projects: (dir: string) => `  Projects  ${dir}`,
  cli: (file: string) => `  baocut    ${file} (runs this checkout's CLI)`,
  useHeader: 'To use it in a shell:',
  useShell: (file: string) => `  ${file}`,
  usePowerShell: (file: string) => `  ${file}   (PowerShell)`,
  useNote:
    'Then baocut in that shell, and agents started from it, use the sandbox; other shells keep using ~/.baocut. Its Runtime keeps keys in a file inside the sandbox',
  linkFailed: (dir: string) => `The sandbox at ${dir} is ready; linking accounts failed:`,
};

export type SandboxMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
