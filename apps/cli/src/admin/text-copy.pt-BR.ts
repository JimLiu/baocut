import { TEXT_EFFORTS } from '@baocut/protocol';
import type { TextMessages } from './text-copy.ts';

export const ptBR: TextMessages = {
  help: `Uso:
  baocut text <prompt> [options]   Chamar um modelo de texto uma vez; prompt - é lido de stdin. O texto completo vai
                                   para stdout (com --out vai para o arquivo, e stdout recebe tarefa e resultado
                                   como JSON); progresso, avisos e versão do modelo vão para stderr
    --system <text>                Mensagem de sistema
    --json-schema <file>           Saída estruturada: retornada e validada com este JSON Schema (a raiz
                                   é um objeto); se não corresponder, a tarefa falha com MODEL_OUTPUT_INVALID
    --provider <id>                Provedor do catálogo, como openai, google ou anthropic, ou custom:<name>;
                                   o padrão se omitido (esta capacidade não tem padrão integrado)
    --model <id>                   Modelo; o modelo padrão do provedor se omitido
    --max-output-tokens <n>        Limite de saída; o limite do modelo se omitido. Texto simples truncado
                                   ainda é exibido, com aviso output-truncated
    --effort <${TEXT_EFFORTS.join('|')}>
                                   Esforço de raciocínio; o nível mais próximo se o modelo não tiver este,
                                   ignorado se o modelo não puder ajustar (explicado em stderr)
    --temperature <0–2>            Somente para modelos que aceitam
    --seed <n>                     Somente para modelos que aceitam
    --out <file>                   Gravar o texto completo neste arquivo`,
  stdinPromptHint: 'Digite o prompt e pressione Ctrl-D para terminar:', missingPrompt: 'Prompt ausente',
  jsonSchemaUnreadable: (file: string, reason: string) => `Não é possível ler o JSON Schema ${file}: ${reason}`,
  jsonSchemaNotObject: 'O arquivo --json-schema deve conter um objeto JSON', singleModel: 'text aceita somente um --model', maxOutputTokensInvalid: '--max-output-tokens deve ser um inteiro positivo',
  effortChoices: (efforts: readonly string[]) => `--effort deve ser um de ${efforts.join(', ')}`, temperatureRange: '--temperature deve estar entre 0 e 2', seedInvalid: '--seed deve ser um inteiro',
  noTextResult: 'A tarefa terminou, mas não retornou texto', fetchOutputFailed: (artifactId: string, status: number) => `Não foi possível obter o resultado ${artifactId}: HTTP ${status}`,
  written: (file: string) => `Gravado: ${file}`,
  modelLine: (provider, model, usage) => `${provider} / ${model}${usage ? `, entrada ${usage.input} / saída ${usage.output} tokens` : ''}`,
};
