import type { SystemAccessMessages } from './system-access-copy.ts';

export const ptBR: SystemAccessMessages = {
  cardTitle: (names) => `Permitir que o BaoCut leia os cookies de ${names}`,
  cardBody: "O macOS exige que você conceda antes “Acesso Total ao Disco” ao BaoCut. Clique em “Abrir Ajustes do Sistema” e o BaoCut leva você direto a essa página. O BaoCut só lê os navegadores que você marcar, nada mais.",
  openedTitle: "Ative o BaoCut nos Ajustes do Sistema e volte aqui",
  openedBody: "Ative o interruptor ao lado do BaoCut. Quando o macOS perguntar se deseja sair e reabrir o BaoCut, escolha “Sair e Reabrir”. Se o BaoCut não estiver na lista, clique em “+” abaixo da lista para adicioná-lo. Se o macOS não oferecer a reabertura, clique abaixo em “Reiniciar o BaoCut”.",
  open: "Abrir Ajustes do Sistema",
  openAgain: "Abrir Ajustes do Sistema novamente",
  restart: "Reiniciar o BaoCut",
  askTitle: (names) => `Permitir primeiro o acesso aos cookies de ${names}?`,
  askBody: (names) => `Este download usa seu login em ${names}, e o macOS exige que você conceda antes “Acesso Total ao Disco” ao BaoCut. Ative nos Ajustes do Sistema e baixe de novo, ou ignore desta vez e continue com os outros navegadores.`,
  skip: "Ignorar desta vez",
  settingLabel: "Acesso Total ao Disco",
  settingAllowed: "Permitido. O BaoCut pode ler arquivos em unidades externas, Mesa, Documentos e Downloads, e os cookies do Safari, mas apenas as mídias, locais de salvamento e navegadores que você escolher.",
  settingMissing: "Não permitido. O macOS impede que apps leiam unidades externas, Mesa, Documentos, Downloads e os cookies do Safari. Depois de permitir, o BaoCut não falhará nesses locais por falta de permissão. Ele só lê as mídias, locais de salvamento e navegadores que você escolher.",
  openFailed: "Não foi possível abrir os Ajustes do Sistema. Abra você mesmo Ajustes do Sistema › Privacidade e Segurança › Acesso Total ao Disco.",
};
