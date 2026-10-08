import type { ModelsDownloadSourceMessages } from './download-source.ts';

export const ptBR: ModelsDownloadSourceMessages = {
  invalidEndpoint: (p: { name: string }) => `${p.name} deve ser uma URL base que comece com http(s)://, sem credenciais, parâmetros de consulta ou fragmento`,
};
