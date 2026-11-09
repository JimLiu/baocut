import type { StandaloneMessages } from './standalone-copy.ts';

export const ptBR: StandaloneMessages = {
  cliHelp: `Uso:
  baocut cli install               Instala este pacote de linha de comando para o seu usuário e coloca o baocut no PATH. O
                                   pacote é copiado para ~/.local/share/baocut/versions/<versão> (Windows:
                                   %LOCALAPPDATA%\\BaoCut\\cli\\versions\\<versão>), a menos que já esteja lá. macOS: um link
                                   em ~/.local/bin/baocut. Windows: %LOCALAPPDATA%\\BaoCut\\bin\\baocut.cmd, com essa pasta
                                   adicionada ao PATH do seu usuário. Não precisa de permissão de administrador
  baocut cli status                Onde o baocut está, para qual versão instalada ele aponta e qual baocut o seu terminal
                                   encontra
  baocut cli remove                Remove o que o baocut cli install colocou; as versões instaladas ficam. O que estiver
                                   nesse caminho e não tiver sido colocado pelo BaoCut nunca é substituído nem apagado`,
  help: `baocut update [--check | --rollback]

Atualiza o pacote independente de linha de comando: lê o mesmo feed de atualizações do app BaoCut, baixa o pacote de
linha de comando da versão mais recente, confere o tamanho e o sha256 (e, no macOS, a assinatura e a notarização), instala
ao lado da versão atual e faz o baocut apontar para ele. A versão anterior fica guardada para --rollback; as mais antigas
que nenhum Runtime usa mais são apagadas.
  --check      Só informa se há uma versão mais recente
  --rollback   Volta para a versão anterior
Um Runtime que já está em execução continua na versão antiga até parar (baocut runtime stop).
Só o pacote independente é atualizado assim: o app BaoCut se atualiza sozinho; o que foi instalado pelo Homebrew, com brew upgrade.
Defina BAOCUT_UPDATE_APPCAST para ler outro feed (uma URL ou um arquivo local, para testes).`,
  version: (version, build) => `${version} (build ${build})`,
  state: {
    none: 'Não instalado',
    current: 'Aponta para a versão atual',
    stale: 'Aponta para outro BaoCut',
    broken: 'Aponta para um local que não existe mais',
    foreign: 'Há outra coisa ali (não mexemos)',
  },
  statusPackage: (version, root) => `Pacote    ${version}  ${root}`,
  statusVersions: (versions, root) => `Versões   ${versions.join(', ')}  ${root}`,
  statusNoVersions: (root) => `Ainda não há nada instalado em ${root}: baocut cli install copia este pacote para lá`,
  currentMark: ' (atual)',
  previousMark: ' (anterior)',
  copied: (dest, from) => `Pacote copiado para ${dest}; ${from} não é mais necessário`,
  versionsKept: (dir) => `As versões instaladas ficam em ${dir}: apague essa pasta para removê-las`,
  entryTaken: (path) =>
    `${path} não foi colocado pelo BaoCut, então não mexemos nele. Mova ou apague você mesmo e rode baocut cli install de novo`,
  pathFailed: (dir) =>
    `Não foi possível adicionar ${dir} ao PATH do seu usuário: adicione em Propriedades do Sistema → Variáveis de Ambiente`,
  copyFailed: (from, dest, detail) => `Não foi possível copiar ${from} para ${dest}${detail ? `: ${detail}` : ''}`,
  updateUsage: (token) => `baocut update aceita --check ou --rollback (um dos dois): ${token}`,
  updateUnavailable:
    'baocut update atualiza o pacote independente de linha de comando. Este baocut pertence ao app BaoCut, que se atualiza sozinho (BaoCut → Verificar atualizações), ou ao Homebrew (brew upgrade --cask baocut)',
  upToDate: (current) => `Já atualizado: ${current}`,
  available: (latest, current) => `${latest} está disponível (você tem ${current})`,
  downloading: (version, build, megabytes) => `Baixando ${version} (build ${build}), ${megabytes} MB…`,
  updated: (from, to) => `Atualizado: ${from} → ${to}`,
  rolledBack: (from, to) => `Voltou de ${from} para ${to}`,
  rollbackHint: 'Para voltar: baocut update --rollback',
  entrySwitched: (path) => `${path} agora aponta para essa versão`,
  entryNotInstalled: (path) => `${path} não está instalado: baocut cli install coloca o baocut no PATH`,
  entryLeftAlone: (path) =>
    `${path} aponta para algo que não é este pacote e não foi alterado: baocut cli install faz ele apontar para cá`,
  removedVersions: (versions) => `Versões mais antigas apagadas: ${versions.join(', ')}`,
  runtimeStillRunning: (pid) =>
    `Um Runtime (pid ${pid}) ainda está rodando a versão com que foi iniciado; quando ele parar, o próximo comando inicia a nova (baocut runtime stop o para agora)`,
  systemTooOld: (required, system) => `A nova versão exige macOS ${required}; este Mac tem ${system}`,
  feedFailed: (url, detail) => `Não foi possível ler o feed de atualizações ${url}: ${detail}`,
  feedMissing: (url) =>
    `O feed de atualizações ${url} ainda não tem pacote de linha de comando: tente de novo depois da próxima versão`,
  downloadFailed: (url, detail) => `Não foi possível baixar ${url}: ${detail}`,
  verifyFailed: (detail) => `O pacote baixado não passou nas verificações e não foi instalado: ${detail}`,
  unsignedBuild:
    'Este pacote não é assinado, então não consegue verificar a assinatura de uma atualização. Baixe o pacote independente pela página de versões do BaoCut',
  noPrevious: (dir) => `Não há versão anterior para a qual voltar em ${dir}`,
  inProgress: (pid) => `Outro baocut update (pid ${pid}) está em execução: espere ele terminar`,
};
