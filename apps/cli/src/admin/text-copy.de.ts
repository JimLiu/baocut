import { TEXT_EFFORTS } from '@baocut/protocol';
import type { TextMessages } from './text-copy.ts';
export const de: TextMessages = {
 help: `Verwendung:
  baocut text <prompt> [options]   Textmodell einmal aufrufen; ein Prompt - wird aus stdin gelesen. Der vollständige
                                   Text geht an stdout (mit --out in die Datei, während stdout Auftrag und Ergebnis
                                   als JSON erhält). Fortschritt, Warnungen und Modellversion gehen an stderr.
    --system <text>                Systemnachricht
    --json-schema <file>           Strukturierte Ausgabe anhand dieses JSON Schema (Wurzel: Objekt).
                                   Bei Abweichungen schlägt der Auftrag mit MODEL_OUTPUT_INVALID fehl.
    --provider <id>                Kataloganbieter wie openai, google oder anthropic oder custom:<name>.
                                   Ohne Angabe gilt der Standard; diese Fähigkeit hat keinen integrierten Standard.
    --model <id>                   Modell; ohne Angabe das Standardmodell des Anbieters
    --max-output-tokens <n>        Ausgabelimit; ohne Angabe das Modelllimit. Abgeschnittener Klartext wird
                                   weiterhin ausgegeben, mit der Warnung output-truncated.
    --effort <${TEXT_EFFORTS.join('|')}>
                                   Denkaufwand; bei fehlendem Niveau das nächstgelegene. Ohne einstellbaren
                                   Denkaufwand ignoriert (Erklärung auf stderr).
    --temperature <0–2>            Nur für Modelle, die dies unterstützen
    --seed <n>                     Nur für Modelle, die dies unterstützen
    --out <file>                   Vollständigen Text in diese Datei schreiben`,
 stdinPromptHint: 'Prompt eingeben, dann mit Ctrl-D abschließen:', missingPrompt: 'Prompt fehlt', jsonSchemaUnreadable: (file, reason) => `JSON Schema ${file} kann nicht gelesen werden: ${reason}`, jsonSchemaNotObject: 'Die Datei für --json-schema muss ein JSON-Objekt enthalten', singleModel: 'text akzeptiert nur ein --model', maxOutputTokensInvalid: '--max-output-tokens muss eine positive ganze Zahl sein', effortChoices: (efforts) => `--effort muss einer von ${efforts.join(', ')} sein`, temperatureRange: '--temperature muss zwischen 0 und 2 liegen', seedInvalid: '--seed muss eine ganze Zahl sein', noTextResult: 'Der Auftrag wurde beendet, lieferte aber keinen Text', fetchOutputFailed: (artifactId, status) => `Ergebnis ${artifactId} konnte nicht abgerufen werden: HTTP ${status}`, written: (file) => `${file} geschrieben`, modelLine: (provider, model, usage) => `${provider} / ${model}${usage ? `, Eingabe ${usage.input} / Ausgabe ${usage.output} Tokens` : ''}`,
};
