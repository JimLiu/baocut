import type { SandboxMessages } from './sandbox-copy.ts';

export const fr: SandboxMessages = {
  help: `Utilisation :
  baocut sandbox create <dossier> [--link-accounts-from <home>]
                                   Prépare un dossier Runtime séparé pour le développement et les tests : le dossier avec
                                   un dossier projects dedans, un bin/baocut qui lance la CLI de cette copie du dépôt sur ce
                                   dossier, et env.sh / env.ps1 pour y basculer un shell. Relancez-la pour rafraîchir ces
                                   fichiers. Uniquement depuis une copie du dépôt ; jamais le ~/.baocut par défaut
    --link-accounts-from <home>    Lie aussi, en lecture seule, les comptes de modèles de ce dossier (en général ~/.baocut),
                                   comme baocut models accounts link --from. Les appels utilisent vos vrais comptes et sont facturés`,
  defaultHome: (dir) => `${dir} est le dossier Runtime par défaut, avec vos vraies données ; choisissez un autre dossier pour le bac à sable`,
  needsSourceCli:
    "baocut sandbox create ne s'exécute que depuis une copie du dépôt (node apps/cli/src/main.ts sandbox create …). Cette CLI lance le Runtime de l'app BaoCut, qui garde les clés dans le trousseau du système, partagé par tous les dossiers : un bac à sable à cet endroit pourrait écraser ou supprimer vos vraies clés",
  unknownStore: (entry) => `BAOCUT_RUNTIME_ENTRY pointe vers ${entry}, et on ne sait pas où ce Runtime garde les clés. Supprimez-la avant de créer un bac à sable`,
  notEmpty: (dir) => `${dir} contient déjà des fichiers et n'est pas un dossier BaoCut ; choisissez un dossier nouveau ou vide`,
  notFolder: (dir) => `${dir} n'est pas un dossier`,
  created: (dir) => `Bac à sable prêt : ${dir}`,
  refreshed: (dir) => `Bac à sable rafraîchi : ${dir}`,
  projects: (dir) => `  Projets   ${dir}`,
  cli: (file) => `  baocut    ${file} (lance la CLI de cette copie)`,
  useHeader: "Pour l'utiliser dans un shell :",
  useShell: (file) => `  ${file}`,
  usePowerShell: (file) => `  ${file}   (PowerShell)`,
  useNote:
    'Ensuite, baocut dans ce shell et les agents lancés depuis lui utilisent le bac à sable ; les autres shells continuent avec ~/.baocut. Son Runtime garde les clés dans un fichier du bac à sable',
  linkFailed: (dir) => `Le bac à sable ${dir} est prêt ; la liaison des comptes a échoué :`,
};
