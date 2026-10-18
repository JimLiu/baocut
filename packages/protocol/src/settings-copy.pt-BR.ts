import { LOCALES } from './i18n.ts';
import type { SettingDescriptionMessages } from './settings-copy.ts';

export const ptBR: SettingDescriptionMessages = {
  'agent.defaultDriver': "Agente para novas sessões; null prioriza um agente detectado disponível (Codex primeiro). Fixado ao criar a sessão",
  'agent.defaultModel': 'Modelo para novas sessões; null usa o modelo recomendado (Sonnet no Claude Code, um modelo -sol no Codex) e __agent-default__ não passa modelo e segue a configuração da CLI do próprio agente',
  'agent.defaultEffort': 'Esforço de raciocínio para novas sessões; null usa o padrão do próprio agente',
  'agent.defaultAccessMode': 'Usado por sessões que nunca alteraram o modo de acesso: ask, autoAcceptEdits, auto, fullAccess ou plan (os valores antigos controlled e authorized são tratados como ask e fullAccess)',
  'ui.language': `Idioma da interface: system segue o idioma do sistema (inglês quando não há idioma correspondente) ou um código de idioma (${LOCALES.join(', ')}). O texto do Runtime para pessoas também usa este idioma`,
  'captions.maxLineLength': 'Comprimento desejado para quebras automáticas de linha (caracteres): cjk para texto chinês, japonês e coreano; other para todos os demais',
  'transcribe.afterComplete': 'Após transcrever: open-video abre o vídeo, notify somente notifica, nothing não faz nada',
  'downloads.directory': 'Local padrão de salvamento para resultados de ferramentas sem vídeo, mídias baixadas de links e arquivos entregues por downloads_save (caminho absoluto); null usa ~/Downloads neste host, independentemente do projeto',
  'downloads.cookieBrowsers': 'Login no site para downloads a partir de links (Baixar vídeo, transcrever a partir de um link, e download e transcribe do agente): all usa todos os navegadores com armazenamento de cookies neste host, os usados mais recentemente primeiro; uma lista de ids de navegador (chrome, edge, firefox, safari, brave, chromium, opera, vivaldi, whale) os tenta nessa ordem; uma lista vazia baixa anonimamente. Expandido com os navegadores detectados no início de cada download',
  'models.downloadEndpoint': 'Fonte de download de modelos locais (URL base de espelho, http(s)://); null usa o hub público de modelos; https://www.modelscope.cn baixa do ModelScope. A variável de ambiente BAOCUT_MODELS_ENDPOINT tem prioridade',
  'models.dir': 'Pasta dos modelos locais (caminho absoluto); null usa models na pasta de dados. A variável de ambiente BAOCUT_MODELS_DIR tem prioridade. Altere com models.setDir, não com settings set',
  'tools.downloadEndpoint': 'Fonte de download de ferramentas externas gerenciadas (yt-dlp) (URL base de espelho, http(s)://, arquivos em <base>/<tool>/<version>/<file>); null usa a URL do lançamento oficial. A variável de ambiente BAOCUT_TOOLS_ENDPOINT tem prioridade',
  'models.downloadMirrors':
    "Espelhos do repositório de modelos que você adicionou (lista de { name, base }; base é uma URL http(s):// sem duplicatas). Só uma lista para escolher: os downloads usam models.downloadEndpoint",
  'tools.downloadMirrors':
    "Espelhos de páginas de lançamento que você adicionou (lista de { name, base }; base é uma URL http(s):// sem duplicatas). Só uma lista para escolher: os downloads usam tools.downloadEndpoint",
  'fonts.autoDownload': 'Baixar automaticamente fontes exigidas pelo layout, ausentes neste computador e presentes no catálogo de fontes (prévia e exportação); quando desativado, usa uma fonte alternativa e mostra um aviso',
  'fonts.cssEndpoint': 'URL base da API CSS de fontes (espelho, https://); null usa https://fonts.googleapis.com',
  'fonts.fileEndpoint': 'URL base dos arquivos de fonte (espelho, https://; arquivos só são obtidos sob esta URL); null usa https://fonts.gstatic.com',
  'space.trashRetentionDays': 'Dias para manter itens na Lixeira do Space (1–3650): itens sem referências e vídeos excluídos mais antigos são excluídos permanentemente de forma periódica',
  'versions.keep': "Versões sem nome mantidas no histórico de versões de cada vídeo (1–100); versões salvas são sempre mantidas. Os arquivos de versões de um vídeo também têm limite de 64 MiB: acima dele, as versões sem nome mais antigas são removidas",
  'versions.cadence': "Quando o histórico de versões de um vídeo começa uma nova versão: segment após 5 minutos sem alterações, a cada 30 minutos de edição contínua e em torno de salvar e restaurar; turn também no início de cada turno do Agent",
  'cache.maxSizeMiB': 'Limite de tamanho do cache da pasta de dados, em MiB (256–1048576): acima dele, os arquivos de cache mais antigos (análise de mídia, cópias de reprodução) são excluídos até chegar a 90%. O índice de busca entre vídeos nunca é excluído',
  'resources.capacity': 'Avançado: capacidade da máquina para agendamento de recursos { memoryMiB, gpuMemoryMiB, cpuThreads }; um item definido como null é detectado automaticamente; null detecta tudo (memória e CPU vêm do sistema, a memória da GPU em Apple silicon é estimada pela memória unificada)',
  'runtime.idleExitMinutes': 'Minutos que um Runtime iniciado pela CLI permanece ocioso antes de sair sozinho (1–1440): sem conexões, tarefas ou serviços externos abertos. Um Runtime mantido em segundo plano ao sair do aplicativo de desktop também sai esse tempo depois de concluir as tarefas. Outros Runtimes não são afetados',
  'updates.autoCheck': 'Verificar atualizações do aplicativo automaticamente', 'updates.autoDownload': 'Baixar novas versões em segundo plano (sem instalar automaticamente)',
  'diagnostics.enabled': 'Enviar estatísticas anônimas de uso e resumos de desempenho (sem mídia, texto ou caminhos)', 'offline.strict': 'Estritamente off-line: não enviar nada a nenhum serviço online',
  'semantic.channels': 'Canais do índice semântico a criar: text (fala: transcrições, legendas, traduções, capítulos); visual (um quadro-chave a cada 8 segundos; requer um pacote de modelo multimodal e leva mais tempo); audio ainda não está disponível',
  'semantic.excludedProjects': 'Projetos fora do índice semântico (lista de ids de projeto): todos os projetos do BaoCut e os vídeos fora de projetos são indexados, exceto estes; os vídeos deles ainda podem ser encontrados pelas palavras exatas',
  'semantic.folders': 'Pastas de índice fora dos projetos (lista de {id, path}): os vídeos e imagens nelas aparecem no Space e são indexados por significado, somente leitura. Altere com space.folderAdd e space.folderRemove',
  'semantic.excludedVideos': 'Vídeos avulsos fora do índice semântico (lista de ids de vídeo), além dos projetos excluídos; o índice que já tinham é removido',
  'semantic.indexDir':
    'Pasta do índice semântico (caminho absoluto); null o mantém no cache do app. Altere com space.indexSetDir, que move ou recria o índice',
  'semantic.pauseOnBattery': 'Pausar a criação do índice semântico na bateria e continuar ao ligar na tomada (sempre pausa quando o sistema reduz o desempenho por calor)',
  'semantic.translationMemory': 'Sugerir traduções anteriores de frases quase idênticas ao traduzir (requer o modelo de busca de texto)',
  'semantic.glossaryCandidates': 'Sugerir termos de glossário a partir de grafias quase idênticas entre transcrições (requer o modelo de busca de texto)',
};
