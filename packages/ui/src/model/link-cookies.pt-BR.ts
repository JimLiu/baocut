import type { LinkCookiesMessages } from './link-cookies.ts';

export const ptBR: LinkCookiesMessages = {
  noneChecked: 'Deixe todos desmarcados para baixar anonimamente. Se o site pedir login ou verificação, entre nele em um navegador primeiro e marque esse navegador.',
  oneChecked: (name: string) => `Usa cookies de ${name} para acessar o site.`,
  manyChecked: (names: readonly string[]) => `Tenta ${names.join(' → ')} nesta ordem: se os cookies de um navegador não puderem ser lidos ou o site ainda pedir login, passa ao próximo e para no primeiro que funcionar. O resultado indica qual foi usado.`,
  privacy: 'Só os navegadores que você marcar são lidos. O yt-dlp lê os cookies neste computador e os usa apenas para acessar o site; o BaoCut lembra só os nomes dos navegadores, nunca os cookies.',
  keychain: (names: readonly string[]) => `O macOS pedirá acesso às Chaves uma vez para ${names.length > 1 ? `cada um de ${names.join(', ')}` : names[0]}. Escolha “Permitir sempre” para não perguntar de novo.`,
  safariAccess: 'Para ler cookies do Safari, primeiro permita o BaoCut em Ajustes do Sistema › Privacidade e Segurança › Acesso Total ao Disco.',
  chromiumLocked: (names: readonly string[]) => names.length > 1 ? `Enquanto ${names.join(', ')} estiverem abertos, os bancos de cookies ficam bloqueados e não podem ser lidos. Feche completamente estes navegadores antes de baixar, incluindo os que executam em segundo plano.` : `Enquanto ${names[0]} estiver aberto, o banco de cookies fica bloqueado e não pode ser lido. Feche completamente este navegador antes de baixar, incluindo se executar em segundo plano.`,
  appBound: (names: readonly string[]) => `No Windows, ${names.join(', ')} ${names.length > 1 ? 'costumam proteger' : 'costuma proteger'} os cookies com criptografia vinculada ao aplicativo, que o yt-dlp pode não conseguir ler mesmo após fechar o navegador.`,
  firefoxTip: ' Se precisar entrar, entre no site pelo Firefox e marque Firefox.',
  noBrowsers: 'Nenhum cookie de navegador foi encontrado neste computador, então só é possível baixar anonimamente. Após entrar no site em um navegador, clique em “Detectar navegadores novamente”.',
  used: (name: string) => `Usou cookies de ${name}`,
};
