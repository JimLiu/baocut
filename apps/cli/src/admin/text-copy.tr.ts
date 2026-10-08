import { TEXT_EFFORTS } from '@baocut/protocol';
import type { TextMessages } from './text-copy.ts';

export const tr: TextMessages = {
help: `Kullanım:
  baocut text <prompt> [options]   Metin modelini bir kez çağır; - istemi stdin üzerinden okunur. Tam metin stdout
                                   üzerine gider (--out ile dosyaya gider; stdout görev ve çıktıyı JSON
                                   olarak alır); görev ilerlemesi, uyarılar ve model sürümü stderr üzerine gider
    --system <text>                Sistem mesajı
    --json-schema <file>           Yapılandırılmış çıktı: bu JSON Schema ile döndürülür ve doğrulanır
                                   (kökü nesnedir); eşleşmezse görev MODEL_OUTPUT_INVALID ile başarısız olur
    --provider <id>                openai, google veya anthropic gibi katalog sağlayıcısı veya custom:<name>;
                                   verilmezse varsayılan (bu yeteneğin yerleşik varsayılanı yok)
    --model <id>                   Model; verilmezse sağlayıcının varsayılan modeli
    --max-output-tokens <n>        Çıktı sınırı; verilmezse model sınırı. Kesilen düz metin yine
                                   yazdırılır ve output-truncated uyarısı verilir
    --effort <${TEXT_EFFORTS.join('|')}>
                                   Akıl yürütme düzeyi; modelde yoksa en yakın düzey,
                                   ayarlanamıyorsa yok sayılır (stderr üzerinde açıklanır)
    --temperature <0–2>            Yalnızca kabul eden modeller için
    --seed <n>                     Yalnızca kabul eden modeller için
    --out <file>                   Tam metni bu dosyaya yaz`,
stdinPromptHint: 'İstemi yazın, bitirmek için Ctrl-D basın:', missingPrompt: 'İstem eksik', jsonSchemaUnreadable: (file, reason) => `JSON Schema ${file} okunamıyor: ${reason}`, jsonSchemaNotObject: '--json-schema dosyası JSON nesnesi içermeli', singleModel: 'text yalnızca bir --model kabul eder', maxOutputTokensInvalid: '--max-output-tokens pozitif tam sayı olmalı', effortChoices: (efforts) => `--effort şunlardan biri olmalı: ${efforts.join(', ')}`, temperatureRange: '--temperature 0–2 arasında olmalı', seedInvalid: '--seed tam sayı olmalı', noTextResult: 'Görev tamamlandı ancak metin döndürmedi', fetchOutputFailed: (artifactId, status) => `${artifactId} çıktısı alınamadı: HTTP ${status}`, written: (file) => `${file} yazıldı`, modelLine: (provider, model, usage) => `${provider} / ${model}${usage ? `, girdi ${usage.input} / çıktı ${usage.output} token` : ''}`,
};
