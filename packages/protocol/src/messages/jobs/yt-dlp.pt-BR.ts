import type { JobsYtDlpMessages } from './yt-dlp.ts';
import { pluralForm } from '../../i18n.ts';

export const ptBR: JobsYtDlpMessages = {
  toolNotFound: (p) => `Não é possível encontrar um yt-dlp executável (${p.code})`,
  remedyUnsupported: 'A ferramenta de download não oferece suporte a este link: use o link da própria página do vídeo (não uma playlist, transmissão ao vivo ou página de pesquisa)',
  remedyLoginRequired: 'Entre no site pelo navegador, selecione esse navegador em “Login no site” e baixe novamente',
  remedyCookiesUnavailable: 'Não é possível ler cookies do navegador: confirme que você entrou pelo navegador; se o banco estiver em uso, feche completamente o navegador (incluindo processos em segundo plano); se o acesso às Chaves for negado, permita; Safari precisa de Acesso Total ao Disco; no Windows, o yt-dlp não consegue ler cookies protegidos por Chrome, Edge ou Brave com criptografia vinculada ao aplicativo, então use Firefox; ou tente outro navegador',
  remedyToolUpdateRequired: 'O site não pôde ser interpretado ou a ferramenta está desatualizada: atualize o yt-dlp, detecte novamente e tente outra vez',
  remedyUnavailable: 'O vídeo está indisponível (excluído, restrito por região ou sem formato disponível para baixar)',
  remedyNetworkError: 'Não é possível conectar ou o download foi interrompido: verifique a rede e tente novamente (as partes já baixadas são retomadas)',
  remedyDiskFull: 'Espaço em disco insuficiente para a pasta de download ou Runtime Home: libere espaço e tente novamente',
  remedyDownloadFailed: 'A ferramenta de download relatou um erro: veja details.stderr; talvez seja necessário atualizar o yt-dlp (baocut external-tools detect)',
  exited: (p) => `yt-dlp saiu com ${p.code}`,
  cookieLoginRequired: (p) => `${p.browser}: o site ainda exige login`,
  cookieUnreadable: (p) => `${p.browser}: não é possível ler cookies`, reasonSeparator: '; ',
  cookieAttemptsFailed: (p) => `${pluralForm('pt-BR', p.count, { one: `Tentados cookies de ${p.count} navegador`, other: `Tentados cookies de ${p.count} navegadores` })}, nenhum funcionou (${p.reasons})`,
  metadataUnreadable: 'Não é possível ler os metadados da ferramenta de download',
  metadataNotObject: 'Os metadados da ferramenta de download não são um objeto',
  playlist: 'O link é uma playlist; importe um vídeo por vez', live: 'Transmissões ao vivo não podem ser importadas',
};
