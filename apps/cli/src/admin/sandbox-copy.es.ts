import type { SandboxMessages } from './sandbox-copy.ts';

export const es: SandboxMessages = {
  help: `Uso:
  baocut sandbox create <carpeta> [--link-accounts-from <home>]
                                   Prepara una carpeta de Runtime aparte para desarrollo y pruebas: la carpeta con una
                                   carpeta projects dentro, un bin/baocut que ejecuta la CLI de esta copia del repositorio
                                   con esa carpeta, y env.sh / env.ps1 para cambiar un shell a ella. Ejecútalo otra vez para
                                   renovar esos archivos. Solo desde una copia del repositorio; nunca la ~/.baocut predeterminada
    --link-accounts-from <home>    Vincula además, en solo lectura, las cuentas de modelos de esa carpeta (normalmente
                                   ~/.baocut), como baocut models accounts link --from. Las llamadas usan tus cuentas reales y se cobran`,
  defaultHome: (dir) => `${dir} es la carpeta de Runtime predeterminada, con tus datos reales; elige otra carpeta para el sandbox`,
  needsSourceCli:
    'baocut sandbox create solo se ejecuta desde una copia del repositorio (node apps/cli/src/main.ts sandbox create …). Esta CLI inicia el Runtime de la app BaoCut, que guarda las claves en el llavero del sistema, compartido por todas las carpetas: un sandbox ahí podría sobrescribir o borrar tus claves reales',
  unknownStore: (entry) => `BAOCUT_RUNTIME_ENTRY apunta a ${entry} y no se sabe dónde guarda las claves ese Runtime. Quítala antes de crear un sandbox`,
  notEmpty: (dir) => `${dir} ya tiene archivos y no es una carpeta de BaoCut; elige una carpeta nueva o vacía`,
  notFolder: (dir) => `${dir} no es una carpeta`,
  created: (dir) => `Sandbox listo: ${dir}`,
  refreshed: (dir) => `Sandbox renovado: ${dir}`,
  projects: (dir) => `  Proyectos  ${dir}`,
  cli: (file) => `  baocut     ${file} (ejecuta la CLI de esta copia)`,
  useHeader: 'Para usarlo en un shell:',
  useShell: (file) => `  ${file}`,
  usePowerShell: (file) => `  ${file}   (PowerShell)`,
  useNote:
    'Después, baocut en ese shell y los agentes iniciados desde él usan el sandbox; los demás shells siguen usando ~/.baocut. Su Runtime guarda las claves en un archivo dentro del sandbox',
  linkFailed: (dir) => `El sandbox en ${dir} está listo; no se pudieron vincular las cuentas:`,
};
