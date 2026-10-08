import { TEXT_EFFORTS } from '@baocut/protocol';
import type { TextMessages } from './text-copy.ts';

export const pl: TextMessages = {
  help: `Użycie:
  baocut text <prompt> [options]   Wywołaj model tekstowy raz; prompt - jest odczytywany ze stdin. Pełny tekst trafia
                                   do stdout (z --out do pliku, a stdout zawiera zadanie i
                                   wynik jako JSON); postęp, ostrzeżenia i wersja modelu trafiają do stderr
    --system <text>                Wiadomość systemowa
    --json-schema <file>           Wynik strukturalny: zwracany i sprawdzany według JSON Schema (korzeń to
                                   obiekt); niezgodność kończy zadanie błędem MODEL_OUTPUT_INVALID
    --provider <id>                Dostawca katalogu, np. openai, google, anthropic lub custom:<name>;
                                   domyślny, jeśli pominięty (ta możliwość nie ma wbudowanego domyślnego)
    --model <id>                   Model; domyślny dostawcy, jeśli pominięty
    --max-output-tokens <n>        Limit wyniku; limit modelu, jeśli pominięty. Ucięty zwykły
                                   tekst jest wyświetlany z ostrzeżeniem output-truncated
    --effort <${TEXT_EFFORTS.join('|')}>
                                   Intensywność rozumowania; najbliższy poziom, jeśli brak wybranego;
                                   pomijana bez regulacji (wyjaśnienie w stderr)
    --temperature <0–2>            Tylko dla przyjmujących modeli
    --seed <n>                     Tylko dla przyjmujących modeli
    --out <file>                   Zapisz pełny tekst do pliku`,
  stdinPromptHint: "Wpisz prompt i naciśnij Ctrl-D, aby zakończyć:",
  missingPrompt: "Brak promptu",
  jsonSchemaUnreadable: (file, reason) => `Nie można odczytać JSON Schema ${file}: ${reason}`,
  jsonSchemaNotObject: "Plik --json-schema musi zawierać obiekt JSON",
  singleModel: "text przyjmuje tylko jeden --model",
  maxOutputTokensInvalid: "--max-output-tokens musi być dodatnią liczbą całkowitą",
  effortChoices: (efforts) => `--effort musi być jedną z wartości ${efforts.join(", ")}`,
  temperatureRange: "--temperature musi być od 0 do 2",
  seedInvalid: "--seed musi być liczbą całkowitą",
  noTextResult: "Zadanie ukończono, ale nie zwrócono tekstu",
  fetchOutputFailed: (artifactId, status) => `Nie udało się pobrać wyniku ${artifactId}: HTTP ${status}`,
  written: (file) => `Zapisano: ${file}`,
  modelLine: (provider, model, usage) => `${provider} / ${model}${usage ? `, wejście ${usage.input} / wyjście ${usage.output} tokenów` : ""}`,
};
