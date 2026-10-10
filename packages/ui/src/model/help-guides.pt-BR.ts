import type { HelpGuidesMessages } from './help-guides.ts';

export const ptBR: HelpGuidesMessages = {
  guides: {
    import: {
      title: 'Criar um vídeo e importar mídias', short: 'Criar e importar', summary: 'Crie um vídeo no Space e traga mídias para a biblioteca de mídias e para a linha do tempo.', keywords: 'novo criar arquivo mídia biblioteca importar arrastar soltar áudio imagem import video asset',
      steps: [
        ['Criar um vídeo', 'Abra “Space” à esquerda, clique em “Novo” → “Novo vídeo em branco”, escolha em qual projeto criar e selecione uma proporção no Home antes de clicar em “Criar vídeo em branco”. Se já tem um arquivo de vídeo ou áudio, clique em “Novo vídeo de arquivo”; o Home abre com esse arquivo e permite escolher entre adicionar legendas ou transcrever e traduzir. Se ainda não tem projeto, abra uma pasta de projeto no Home primeiro ou peça ao agente em uma sessão para criar um.'],
        ['Importar mídias para a biblioteca de mídias', 'No painel direito do editor, abra “Vídeo”, “Áudio” ou “Imagens”, clique em “Importar” e escolha arquivos, ou arraste arquivos para a caixa tracejada. Importar só copia os arquivos para a pasta do vídeo; os originais não são alterados.'],
        ['Colocar na linha do tempo', 'Clique em “+” à direita de uma mídia para colocá-la no indicador de reprodução. Você também pode arrastar uma mídia para uma linha da linha do tempo ou um arquivo do computador diretamente para a linha do tempo.'],
      ], tip: 'Importar e colocar na linha do tempo são duas etapas: uma mídia recém-importada fica na biblioteca de mídias e ainda não aparece na imagem.', cta: 'Novo vídeo de arquivo',
    },
    subtitle: {
      title: 'Adicionar legendas e revisar linha por linha', short: 'Adicionar legendas', summary: 'Importe um arquivo de legendas ou peça ao agente para transcrever, depois ouça e corrija as legendas.', keywords: 'transcrever transcrição reconhecimento srt vtt webvtt ass erro dividir mesclar localizar substituir texto legenda',
      steps: [
        ['Obter as legendas primeiro', 'Abra “Legendas” à direita. Quando o vídeo tem mídias, clique em “Gerar legendas” para transcrever com um modelo de fala local ou um serviço de nuvem conectado; ao terminar, as legendas vão para a imagem automaticamente. As “Configurações de transcrição” recolhidas abaixo do botão permitem mudar o idioma, modelo de fala e dicas de reconhecimento. Se já tem um arquivo de legendas, clique em “Importar arquivo de legendas”; SRT, WebVTT e ASS são aceitos. Para marcar quem fala, use “Ferramentas › Transcrever”: expanda “Mais opções” abaixo do modelo de fala e ative “Identificar falantes”. MOSS Transcribe distingue os falantes por conta própria, então a opção permanece ativada; outros modelos locais precisam de “Diarização de falantes”, que você deve baixar ao ativar pela primeira vez.'],
        ['Clicar em uma linha e editar', 'Clique no horário de uma linha para mover o indicador de reprodução até ela; clique no texto para editar. Enter divide em duas linhas, Backspace no início une à anterior, Shift+Enter cria uma quebra dentro da linha e Esc descarta a edição.'],
        ['Ouvir de novo e corrigir vários lugares de uma vez', 'Depois de sair da caixa de texto, pressione Space para reproduzir e comparar o texto com a fala. O topo do painel mostra quantas linhas excedem a velocidade de leitura. Quando o mesmo erro aparece em vários lugares, use localizar e substituir (⌘F / Ctrl+F).'],
      ], tip: 'Só transcrições iniciadas por “Gerar legendas” vão para a imagem automaticamente. Quando o agente transcreve em uma sessão, o resultado é salvo primeiro como transcrição; volte a “Legendas” e clique em “Gerar legendas” para usá-lo. Se a linha do tempo tiver várias faixas de legendas, use o menu no cabeçalho “Legendas” para escolher qual editar.', cta: 'Abrir Legendas',
    },
    translate: {
      title: 'Adicionar uma tradução para legendas bilíngues', short: 'Tradução e bilíngue', summary: 'No painel Legendas, escolha um idioma de destino e um modelo de texto; a tradução vai para a imagem em uma nova faixa de legendas.', keywords: 'traduzir tradução inglês chinês bilíngue idioma original lado a lado glossário modelo texto',
      steps: [
        ['Revisar o original primeiro', 'A tradução percorre o texto transcrito frase por frase. Corrija nomes, termos e erros claros de reconhecimento primeiro para evitar edições depois. As legendas a traduzir devem vir de uma transcrição: arquivos de legendas importados não têm horários por palavra e não podem ser traduzidos diretamente.'],
        ['Clicar em “+ Traduzir para…” na barra de faixas', 'Abra “Legendas” à direita, clique em “+ Traduzir para…” na barra de faixas, escolha o idioma de destino e um modelo de texto, adicione uma dica de estilo ou marque um glossário se precisar e clique no botão de início abaixo. Se não houver modelo de texto disponível, conecte primeiro um serviço em “Modelos › Geração de texto”; modelos on-line são cobrados por token.'],
        ['Verificar a tradução e ajustar a disposição bilíngue', 'Ao terminar, a tradução vai para a imagem automaticamente e a ficha de resultado permite desfazer com um clique. Em “Lista”, escolha “Original + tradução” para comparar linha por linha; clique em uma linha traduzida para reescrever. Selecione uma legenda e use “Bilíngue” em “Propriedades da legenda” para escolher qual linha fica acima e a distância entre elas.'],
      ], tip: 'Quer mostrar só a tradução? Desative “Mostrar os dois idiomas” antes de começar ou clique no “×” do original na barra de faixas para tirá-lo da imagem; o original não é excluído. Depois de editar o original, as traduções afetadas são marcadas como “Desatualizada”: reescrever remove a marca. Você também pode clicar em “Atualizar traduções desatualizadas” no aviso do aplicativo de desktop ou digitar /refresh em uma sessão para o agente retraduzir essas linhas.', cta: 'Abrir Legendas',
    },
    export: {
      title: 'Exportar um vídeo, legendas ou transcrição', short: 'Exportar', summary: 'Escolha a entrega de que precisa; para vídeo e áudio, você também pode exportar só alguns capítulos ou trechos.', keywords: 'exportar salvar baixar mp4 wav mp3 m4a srt vtt ass json markdown transcrição capítulo trecho volume arquivo projeto premiere davinci resolve pacote portátil',
      steps: [
        ['Clicar em “Exportar” na barra do vídeo', 'Clique em “Exportar” à direita da barra do vídeo no editor. Cada uma das cinco entregas tem sua própria página: Vídeo (MP4), Áudio (WAV, MP3 ou M4A), Legendas (SRT, VTT, ASS ou JSON), Transcrição (Markdown ou texto simples) e Arquivo de projeto (XML para Premiere Pro e DaVinci Resolve, ou um pacote portátil do BaoCut).'],
        ['Escolher um intervalo e confirmar as configurações', 'Vídeo e áudio podem exportar o vídeo inteiro, por capítulo, por trecho ou um início e fim personalizados; legendas, transcrições e arquivos de projeto exportam a sequência inteira. Na página Vídeo, confira também a resolução, tamanho do arquivo e se as legendas devem ser incorporadas à imagem, e ative a normalização de volume se necessário. Na página Legendas, marque duas faixas para combiná-las em um arquivo bilíngue.'],
        ['Iniciar a exportação e aguardar o término', 'Por padrão, os arquivos são salvos em exports/ no projeto; ou clique primeiro em “Escolher local”. Você pode fechar a janela e continuar trabalhando durante a exportação; a progressão aparece no botão “Exportar” e também pode ser vista em “Tarefas em segundo plano”. Ao terminar, clique em “Mostrar na pasta” para encontrar o arquivo; em caso de falha, a janela informa a causa e como resolver.'],
      ], tip: 'Um arquivo de legendas e um vídeo com legendas são duas entregas diferentes: o primeiro é carregado em outro software; o segundo pode ser reproduzido e compartilhado diretamente.',
    },
    workspace: {
      title: 'Conhecer o editor', short: null, summary: 'Veja o resultado na prévia, encontre momentos na linha do tempo e altere o conteúdo no painel direito.', keywords: 'tela prévia linha tempo painel inspetor propriedades faixa reprodução não encontrar',
      steps: [
        ['Centro: a prévia', 'Mostra a imagem no indicador de reprodução, com o tamanho e taxa de quadros do vídeo acima. Os controles abaixo permitem reproduzir, avançar quadro a quadro, desfazer, refazer e dividir no indicador de reprodução.'],
        ['Embaixo: a linha do tempo', 'Clique na linha do tempo para mover o indicador de reprodução. Arraste um clipe para mudar quando aparece ou movê-lo para outra faixa; arraste as extremidades para aparar. Clique com o botão direito para dividir, copiar, desativar ou excluir.'],
        ['Direita: conteúdo e propriedades', 'De cima para baixo, a barra vertical tem Transcrição, Legendas, Elementos, Texto, Imagens, Vídeo, Áudio, Marca e Inspetor. Ao selecionar um clipe, suas propriedades aparecem; sem seleção, o Inspetor mostra “Propriedades do vídeo” para o vídeo inteiro.'],
      ], tip: 'Errou? Desfaça primeiro (⌘Z / Ctrl+Z). “Versões” na barra do vídeo abre o histórico, onde qualquer edição pode ser desfeita separadamente.',
    },
    style: {
      title: 'Mudar a aparência das legendas', short: null, summary: 'Selecione uma legenda e altere posição, estilo de texto e tempo no Inspetor.', keywords: 'estilo fonte tamanho cor contorno traço fundo sombra brilho posição bilíngue espaçamento pontuação',
      steps: [
        ['Selecionar uma legenda', 'Clique em uma legenda na linha do tempo; o painel direito mostra “Propriedades da legenda”. Você altera o estilo, então todas as legendas que o usam mudam juntas.'],
        ['Ajustar a posição e o estilo de texto', '“Posição” define o posicionamento vertical e horizontal e a largura; “Estilo de texto” define fonte, tamanho, cor e alinhamento e permite ativar fundo, contorno, brilho e sombra. A imagem acompanha o arrasto e a alteração é salva quando você solta.'],
        ['Ajustar o tempo', '“Mais cedo” e “Mais tarde” em “Exibição” definem quanto antes da fala cada linha aparece e quanto depois desaparece; “Pontuação” pode substituir vírgulas e pontos por espaços.'],
      ], tip: 'Quando a linha do tempo tem legendas originais e traduzidas, “Propriedades da legenda” ganha uma seção “Bilíngue” para escolher qual linha fica acima e a distância entre elas. Se algo der errado, desfaça (⌘Z / Ctrl+Z).', cta: 'Abrir propriedades da legenda',
    },
    elements: {
      title: 'Adicionar texto, adesivos e formas', short: null, summary: 'Adicione elementos à imagem pelo painel direito e ajuste posição e estilo no Inspetor.', keywords: 'elementos adesivo forma visualizador barra progresso temporizador cronômetro contagem regressiva onda texto caixa título predefinição',
      steps: [
        ['Escolher um elemento', '“Elementos” à direita é organizado em adesivos, formas e visualizadores, com busca; visualizadores incluem barras de progresso, temporizadores e formas de onda. Clique em um para adicionar à linha do tempo: a maioria começa no indicador de reprodução, enquanto barras de progresso cobrem o vídeo inteiro.'],
        ['Adicionar texto', 'Em “Texto” à direita, clique em “Adicionar caixa de texto” ou escolha uma predefinição como Simples, Título ou Terço inferior.'],
        ['Ajustar o tempo e a posição', 'Cada elemento ocupa um intervalo na linha do tempo; arraste para mudar quando aparece. Ao selecionar, o painel direito mostra suas propriedades; use “Geometria” para definir posição, tamanho, rotação e espelhamento por valores.'],
      ], tip: 'Com um elemento selecionado, o painel direito mostra suas propriedades; pressione Esc para desfazer a seleção e o Inspetor volta a “Propriedades do vídeo”.',
    },
    reframe: {
      title: 'Converter um vídeo horizontal em vertical', short: null, summary: 'Mude a proporção em Propriedades do vídeo; os clipes da imagem acompanham o tamanho da tela.', keywords: 'vertical horizontal retrato paisagem proporção 9:16 1:1 4:3 16:9 tela enquadramento',
      steps: [
        ['Abrir propriedades do vídeo', 'Pressione Esc para desfazer qualquer seleção e abra “Inspetor” à direita; ele mostra “Propriedades do vídeo”.'],
        ['Escolher outra proporção', '“Proporção” oferece 16:9, 9:16, 1:1 e 4:3. O lado curto permanece igual; os clipes se movem e redimensionam proporcionalmente à tela, os que a preenchem continuam preenchendo e os bloqueados não se movem.'],
        ['Ajustar o enquadramento de cada clipe', 'Selecione um clipe que precisa de reenquadramento e ajuste posição e tamanho em “Geometria” nas propriedades.'],
      ], tip: 'Mudar a proporção é uma edição comum; se não gostar, desfaça (⌘Z / Ctrl+Z). Não há corte inteligente que encontre o assunto principal automaticamente: ajuste o enquadramento por conta própria.',
    },
    aitools: {
      title: 'Pedir ao agente para revisar a transcrição', short: null, summary: 'Revisão, capítulos, falantes, identificação de cortes, tradução, dublagem e textos para publicação começam em / na sessão ou num botão do painel correspondente e vão ao agente por padrão.', keywords: 'IA ferramentas barra revisão parágrafo capítulo falante vício linguagem pausa retranscrever tradução desatualizada dublagem resumo blog título descrição capa limpar',
      steps: [
        ['Digitar / em uma sessão', 'Digite / no início da entrada da sessão (ou escolha “Usar uma ferramenta” em “+”) para listar as ferramentas deste vídeo: Revisar transcrição, Gerar capítulos, Identificar falantes, Retranscrever, Identificar cortes, Traduzir legendas, Atualizar traduções desatualizadas, Traduzir dublagem, Escrever um resumo, Escrever um post de blog, Sugerir títulos, Escrever uma descrição, Criar uma capa e Exportar. Escolha uma, acrescente seus requisitos e envie; o agente começa a trabalhar. Em vídeos abertos no Space, a sessão fica no canto inferior direito; estas ferramentas não estão disponíveis na web.'],
        ['Ou abrir a aba Ferramentas de IA', 'A aba “Ferramentas de IA” na lateral direita do editor agrupa as ferramentas: polir a transcrição, gerar capítulos, identificar falantes, transcrever de novo e encontrar cortes, e depois escrever resumo, post de blog, títulos, descrição ou capa; “Encontrar cortes” na barra do modo de corte abre a mesma página. Escolha uma para abrir a página e defina o escopo e as opções. A caixa de texto abaixo monta o pedido com eles e leva o skill da ferramenta; você pode editá-la. Na linha “Sessão”, escolha uma nova sessão ou a atual e clique em “Passar para o agente”. Traduzir legendas fica em “+ Traduzir para…” no painel Legendas, e traduzir a dublagem fica no painel Áudio e no menu da faixa de dublagem; nesses dois você escolhe um modelo na página de configurações e começa direto.'],
        ['Verificar os resultados', 'Sempre que o agente altera o vídeo, aparece uma ficha de alteração na sessão, que pode ser desfeita diretamente. Revise antes de gerar capítulos, para que sejam agrupados por parágrafo. Os resultados de escrita e publicação são lidos, escolhidos e copiados na sessão; não mudam a transcrição. Depois de editar o original, use “Atualizar traduções desatualizadas” para retraduzir só as linhas marcadas como “Desatualizada”.'],
      ], tip: 'Se algo não estiver na lista, diga em uma frase na sessão. Corte inteligente e Dividir em vídeos curtos não estão disponíveis nesta versão.',
    },
    agent: {
      title: 'Pedir ao agente para trabalhar no seu vídeo', short: null, summary: 'Diga o que quer em uma frase, acompanhe cada etapa e verifique o resultado.', keywords: 'IA assistente agente sessão conversa automático aprovação permissão desfazer codex claude',
      steps: [
        ['Conectar um agente primeiro', 'Abra “Configurações › Provedores de agentes”. O BaoCut detecta Claude Code e Codex neste computador; se não estiver instalado, siga as etapas da ficha para instalar e entrar, depois volte para detectar novamente.'],
        ['Dizer o que quer em uma sessão', 'Inicie uma sessão no Home ou abra um vídeo no Space: uma sessão flutuante, expandida por padrão, fica no canto inferior direito; converse ali. Quando minimizada, vira um ícone nesse canto; clique para expandir. Deixe claro o escopo e o que manter, por exemplo: “Verifique erros de escrita nas legendas desta entrevista, mas mantenha a linguagem de conversa.”'],
        ['Acompanhar o processo e verificar o resultado', 'Cada etapa do agente pode ser expandida. Dependendo do modo de acesso escolhido, ele pede permissão antes de executar comandos ou alterações; sempre que altera o vídeo, aparece uma ficha na sessão para desfazer diretamente.'],
      ], tip: 'O agente só pode usar vídeos na pasta da sessão (a pasta do projeto ou sua própria pasta de trabalho). Ao enviar uma mensagem, um vídeo dessa pasta aberto no editor é anexado com a seleção e indicador de reprodução; remova a referência acima da caixa de entrada se não quiser.', cta: 'Abrir configurações do agente',
    },
    missing: {
      title: 'Por que as legendas não aparecem na imagem?', short: null, summary: 'Verifique, nesta ordem, se as legendas estão na linha do tempo, a posição do indicador de reprodução e a ativação das faixas.', keywords: 'não aparece ausente oculto desativado vazio não ver legendas transcrição',
      steps: [
        ['Confirmar que as legendas estão na linha do tempo', 'Transcrições feitas pelo agente ou linha de comando só salvam o resultado como transcrição e não alteram a linha do tempo. Abra “Legendas” à direita: se disser “Nenhuma legenda ainda”, clique em “Gerar legendas”, importe um arquivo ou peça ao agente para colocar a transcrição na linha do tempo.'],
        ['Ir a uma linha com fala', 'Clique no horário de uma linha em “Legendas” e o indicador de reprodução vai até ela. Intervalos sem fala não têm legendas.'],
        ['Verificar a ativação da faixa e do clipe', 'Veja o cabeçalho da faixa de legendas: quando o olho está desativado, a faixa não aparece na prévia. Clipes desativados também não aparecem; clique com o botão direito e escolha “Ativar este clipe”.'],
      ], tip: 'Ainda não vê? Selecione a legenda e verifique posição e cor em “Propriedades da legenda”: o texto pode estar fora da imagem ou muito parecido com o fundo.', cta: 'Verificar Legendas',
    },
    model: {
      title: 'A transcrição ou geração não iniciou. E agora?', short: null, summary: 'Veja a causa em Tarefas em segundo plano e adicione o serviço de modelo que falta.', keywords: 'falhou erro transcrição transcrever síntese fala geração imagens modelo serviço componente rede tarefa',
      steps: [
        ['Abrir Tarefas em segundo plano', '“Tarefas em segundo plano” à esquerda lista toda tarefa em andamento, vinda do editor, de um fluxo do Home, do agente ou da linha de comando. Clique em “Detalhes”: se falhou, o título da caixa vermelha é o motivo.'],
        ['Resolver o que os detalhes apontam', 'Os detalhes dão uma próxima etapa de acordo com o motivo: instalar um componente, configurar um modelo de nuvem, escolher um modelo padrão ou verificar as configurações do agente.'],
        ['Voltar e tentar novamente', 'Depois de corrigir, volte e tente novamente: clique outra vez em “Gerar legendas” no painel Legendas ou peça ao agente para reenviar na sessão. Quando não há serviço disponível, o agente informa qual ativar primeiro.'],
      ], tip: 'Transcrição, síntese de fala e geração de imagens precisam de um serviço de modelo. A Ajuda pode ser lida off-line, mas serviços de nuvem precisam de rede.', cta: 'Ver modelos',
    },
  },
};
