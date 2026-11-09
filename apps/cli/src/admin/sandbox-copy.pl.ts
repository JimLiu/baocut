import type { SandboxMessages } from './sandbox-copy.ts';

export const pl: SandboxMessages = {
  help: `Użycie:
  baocut sandbox create <folder> [--link-accounts-from <home>]
                                   Przygotowuje osobny folder Runtime do programowania i testów: folder z folderem projects
                                   w środku, bin/baocut, który uruchamia CLI tej kopii repozytorium na tym folderze, oraz
                                   env.sh / env.ps1, które przełączają na niego powłokę. Ponowne uruchomienie odświeża te pliki.
                                   Tylko z kopii repozytorium; nigdy domyślny ~/.baocut
    --link-accounts-from <home>    Dodatkowo łączy tylko do odczytu konta modeli z tego folderu (zwykle ~/.baocut), tak jak
                                   baocut models accounts link --from. Wywołania używają Twoich prawdziwych kont i są rozliczane`,
  defaultHome: (dir) => `${dir} to domyślny folder Runtime z Twoimi prawdziwymi danymi; wybierz inny folder na piaskownicę`,
  needsSourceCli:
    'baocut sandbox create działa tylko z kopii repozytorium (node apps/cli/src/main.ts sandbox create …). To CLI uruchamia Runtime aplikacji BaoCut, który trzyma klucze w systemowym pęku kluczy, wspólnym dla wszystkich folderów: piaskownica tam mogłaby nadpisać lub usunąć Twoje prawdziwe klucze',
  unknownStore: (entry) => `BAOCUT_RUNTIME_ENTRY wskazuje na ${entry} i nie wiadomo, gdzie ten Runtime trzyma klucze. Usuń tę zmienną przed utworzeniem piaskownicy`,
  notEmpty: (dir) => `${dir} zawiera już pliki i nie jest folderem BaoCut; wybierz nowy lub pusty folder`,
  notFolder: (dir) => `${dir} nie jest folderem`,
  created: (dir) => `Piaskownica gotowa: ${dir}`,
  refreshed: (dir) => `Piaskownica odświeżona: ${dir}`,
  projects: (dir) => `  Projekty  ${dir}`,
  cli: (file) => `  baocut    ${file} (uruchamia CLI tej kopii)`,
  useHeader: 'Aby używać jej w powłoce:',
  useShell: (file) => `  ${file}`,
  usePowerShell: (file) => `  ${file}   (PowerShell)`,
  useNote:
    'Potem baocut w tej powłoce i uruchomione z niej agenty używają piaskownicy; inne powłoki nadal używają ~/.baocut. Jej Runtime trzyma klucze w pliku w piaskownicy',
  linkFailed: (dir) => `Piaskownica w ${dir} jest gotowa; nie udało się połączyć kont:`,
};
