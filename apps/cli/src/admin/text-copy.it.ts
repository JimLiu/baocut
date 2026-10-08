import { TEXT_EFFORTS } from '@baocut/protocol';
import type { TextMessages } from './text-copy.ts';

export const it: TextMessages = {
  help: `Uso:
  baocut text <prompt> [options]   Chiama un modello di testo una volta; un prompt - viene letto da stdin. Il testo completo
                                   va a stdout (con --out va al file e stdout riceve attività e risultato come JSON);
                                   avanzamento, avvisi e versione del modello vanno a stderr
    --system <text>                Messaggio di sistema
    --json-schema <file>           Output strutturato: restituito e validato con questo JSON Schema (la radice
                                   è un oggetto); se non corrisponde, l’attività fallisce con MODEL_OUTPUT_INVALID
    --provider <id>                Provider del catalogo, come openai, google o anthropic, oppure custom:<name>;
                                   il predefinito se omesso (questa capacità non ha un predefinito integrato)
    --model <id>                   Modello; il modello predefinito del provider se omesso
    --max-output-tokens <n>        Limite di output; quello del modello se omesso. Il testo semplice troncato
                                   viene comunque mostrato, con avviso output-truncated
    --effort <${TEXT_EFFORTS.join('|')}>
                                   Intensità di ragionamento; il livello più vicino se il modello non ha questo,
                                   ignorato se il modello non può regolarlo (spiegato in stderr)
    --temperature <0–2>            Solo per modelli che lo accettano
    --seed <n>                     Solo per modelli che lo accettano
    --out <file>                   Scrive il testo completo in questo file`,
  stdinPromptHint: 'Digita il prompt, poi premi Ctrl-D per terminare:', missingPrompt: 'Prompt mancante',
  jsonSchemaUnreadable: (file: string, reason: string) => `Impossibile leggere JSON Schema ${file}: ${reason}`,
  jsonSchemaNotObject: 'Il file --json-schema deve contenere un oggetto JSON', singleModel: 'text accetta solo un --model', maxOutputTokensInvalid: '--max-output-tokens deve essere un intero positivo',
  effortChoices: (efforts: readonly string[]) => `--effort deve essere uno tra ${efforts.join(', ')}`, temperatureRange: '--temperature deve essere compresa tra 0 e 2', seedInvalid: '--seed deve essere un intero',
  noTextResult: 'L’attività è terminata ma non ha restituito testo', fetchOutputFailed: (artifactId: string, status: number) => `Impossibile recuperare il risultato ${artifactId}: HTTP ${status}`,
  written: (file: string) => `Scritto: ${file}`,
  modelLine: (provider, model, usage) => `${provider} / ${model}${usage ? `, input ${usage.input} / output ${usage.output} token` : ''}`,
};
