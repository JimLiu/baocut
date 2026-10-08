import { TEXT_EFFORTS } from '@baocut/protocol';
import type { TextMessages } from './text-copy.ts';
export const nl: TextMessages = {
 help: `Gebruik:
  baocut text <prompt> [options]   Een tekstmodel één keer aanroepen; prompt - wordt uit stdin gelezen. De volledige tekst gaat
                                   naar stdout (met --out naar het bestand, en stdout krijgt de verwerking en
                                   uitvoer als JSON); voortgang, waarschuwingen en modelversie gaan naar stderr
    --system <text>                Systeembericht
    --json-schema <file>           Gestructureerde uitvoer: teruggegeven en gecontroleerd aan dit JSON Schema (de
                                   hoofdstructuur is een object); bij afwijkingen mislukt de verwerking met MODEL_OUTPUT_INVALID
    --provider <id>                Catalogusaanbieder zoals openai, google of anthropic, of custom:<name>;
                                   zonder deze optie de standaard (deze functie heeft geen ingebouwde standaard)
    --model <id>                   Model; zonder deze optie het standaardmodel van de aanbieder
    --max-output-tokens <n>        Uitvoerlimiet; zonder deze optie de modellimiet. Afgekorte platte
                                   tekst wordt toch afgedrukt, met een output-truncated-waarschuwing
    --effort <${TEXT_EFFORTS.join('|')}>
                                   Denkintensiteit; het dichtstbijzijnde niveau als dit ontbreekt; genegeerd als het model
                                   niet instelbaar is (uitleg op stderr)
    --temperature <0–2>            Alleen voor modellen die dit accepteren
    --seed <n>                     Alleen voor modellen die dit accepteren
    --out <file>                   De volledige tekst naar dit bestand schrijven`,
 stdinPromptHint: 'Typ de prompt en druk op Ctrl-D om te beëindigen:', missingPrompt: 'Prompt ontbreekt', jsonSchemaUnreadable: (file, reason) => `Kan JSON Schema ${file} niet lezen: ${reason}`, jsonSchemaNotObject: 'Het --json-schema-bestand moet een JSON-object bevatten', singleModel: 'text accepteert maar één --model', maxOutputTokensInvalid: '--max-output-tokens moet een positief geheel getal zijn', effortChoices: (efforts) => `--effort moet een van ${efforts.join(', ')} zijn`, temperatureRange: '--temperature moet tussen 0 en 2 liggen', seedInvalid: '--seed moet een geheel getal zijn', noTextResult: 'De verwerking is klaar maar heeft geen tekst teruggegeven', fetchOutputFailed: (artifactId, status) => `Kan uitvoer ${artifactId} niet ophalen: HTTP ${status}`, written: (file) => `${file} geschreven`, modelLine: (provider, model, usage) => `${provider} / ${model}${usage ? `, invoer ${usage.input} / uitvoer ${usage.output} tokens` : ''}`,
};
