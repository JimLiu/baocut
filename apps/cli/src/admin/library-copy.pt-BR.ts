import type { LibraryMessages } from './library-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: LibraryMessages = {
  help: `Uso:
  baocut library import <file>     Importar um arquivo de intercâmbio, com o tipo detectado pelo conteúdo (não
                                   pela extensão): glossários Markdown, pacotes de voz .bcvoice, JSON de cores e
                                   estilos de legendas do kit de marca, adesivos Lottie, imagens, vídeos e fontes
  baocut library export <library> <id> <path>
                                   Exportar a versão atual: glossários em Markdown, vozes em .bcvoice,
                                   mídias de marca no arquivo original; um destino existente não é sobrescrito
  baocut library remove <library> <id>
                                   Excluir um item (conteúdo já copiado para vídeos não é afetado)
  baocut library voice-clone <voice id> --provider <id> [--name <name>]
                                   Enviar a gravação de referência da voz ao provedor para criar um clone
                                   (apenas elevenlabs por enquanto): exige declaração de consentimento e autorização
                                   de compartilhamento de dados que cubra "audio" (baocut grants create); executa como trabalho, Ctrl-C cancela
  baocut library voice-clone-remove <voice id> --provider <id> [--local-only]
                                   Excluir um clone: solicita primeiro a exclusão ao provedor e limpa
                                   o registro após o sucesso; --local-only limpa apenas o registro local
  baocut library video-selection <video id> [options]
                                   Itens da biblioteca ativados no vídeo (salvos no vídeo, podem ser desfeitos): exibidos sem
                                   opções; as partes fornecidas são substituídas por inteiro e o restante permanece igual.
                                   Novos vídeos ativam automaticamente os glossários marcados como "ativados por padrão" na biblioteca
    --transcribe-glossaries <id,…> Glossários de transcrição (usados quando a transcrição
                                   não especifica um); uma string vazia os limpa
    --translate-glossaries <id,…>  Glossários de tradução (usados por translate e pela
                                   tradução de dub); uma string vazia os limpa
    --speaker-voice <transcript id>:<speaker>=<voice>[@<Provider>]
                                   Voz de um falante (repetível, substituída por inteiro):
                                   library:<id> ou um ID de voz do provedor (então com @Provider)
    --clear-speaker-voices         Limpar vozes dos falantes`,
  importUsage: 'Uso: baocut library import <file>', exportUsage: 'Uso: baocut library export <glossaries|voices|brand> <id> <path>', removeUsage: 'Uso: baocut library remove <glossaries|voices|brand> <id>', voiceCloneUsage: 'Uso: baocut library voice-clone <voice id> --provider <id> [--name <name>]', voiceCloneRemoveUsage: 'Uso: baocut library voice-clone-remove <voice id> --provider <id> [--local-only]', videoSelectionUsage: 'Uso: baocut library video-selection <video id> [--translate-glossaries <id,…>] [--speaker-voice …]…', imported: (label, id, name) => `Importado para ${label}: ${id}  ${name}`, exported: (id, version, file, bytes) => `${id} versão ${version} exportado para ${file} (${bytes} ${pluralForm('pt-BR', bytes, { one: 'byte', other: 'bytes' })})`, deleted: (id) => `Excluído: ${id}`, remoteCloneOutcome: { deleted: 'excluído remotamente', 'not-found': 'a voz já não existia remotamente', skipped: 'serviço remoto não contatado' }, voiceCloneRemoved: (id, provider, remote) => `Clone de ${id} excluído em ${provider} (${remote})`, libraryLabels: { glossaries: 'Glossário', voices: 'Voz', brand: 'Kit de marca' }, unknownLibrary: (text) => `Biblioteca desconhecida: ${text ?? '(ausente)'}. Disponíveis: glossaries, voices, brand`, speakerVoiceFormat: (text) => `--speaker-voice aceita <transcript id>:<speaker>=<voice>[@<Provider>]; recebido ${text}`, listSep: ', ', none: '(nenhum)', selectionHead: (videoId, documentId, revision) => `Vídeo ${videoId}${documentId ? ` (documento library-selection ${documentId} versão ${revision})` : ' (nada ativado ainda)'}`, transcribeGlossaries: (list) => `Glossários de transcrição: ${list}`, translateGlossaries: (list) => `Glossários de tradução: ${list}`, speakerVoicesNone: 'Vozes dos falantes: (nenhuma)', speakerVoice: (documentId, speakerId, voice, providerId) => `Voz do falante: ${documentId}:${speakerId} = ${voice}${providerId ? ` (apenas em ${providerId})` : ''}`,
};
