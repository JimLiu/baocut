import type { LibraryMessages } from './library-copy.ts';

export const tr: LibraryMessages = {
help: `Kullanım:
  baocut library import <file>     Değişim dosyası içe aktar; türü uzantıdan değil içerikten belirlenir:
                                   Markdown sözlükleri, .bcvoice ses paketleri, marka kiti renk ve
                                   altyazı stili JSON, Lottie çıkartmaları, görseller, videolar, yazı tipleri
  baocut library export <library> <id> <path>
                                   Mevcut sürümü dışa aktar: sözlükler Markdown, sesler .bcvoice,
                                   marka medyası özgün dosya olarak; mevcut hedefin üzerine yazılmaz
  baocut library remove <library> <id>
                                   Öğe sil (videolara kopyalanmış içerik etkilenmez)
  baocut library voice-clone <voice id> --provider <id> [--name <name>]
                                   Klon oluşturmak için sesin referans kaydını sağlayıcıya yükle
                                   (şimdilik yalnızca elevenlabs): izin beyanı ve audio kapsamlı veri paylaşım
                                   izni (baocut grants create) gerekir; görev olarak çalışır, Ctrl-C iptal eder
  baocut library voice-clone-remove <voice id> --provider <id> [--local-only]
                                   Klon sil: önce sağlayıcıdan silmesini ister, başarıda yerel kaydı
                                   temizler; --local-only yalnızca yerel kaydı temizler
  baocut library video-selection <video id> [options]
                                   Videoda etkin kitaplık öğeleri (videoda saklanır, geri alınabilir): seçenek yoksa gösterilir;
                                   verilen kısımlar bütün olarak değiştirilir, kalanı korunur.
                                   Yeni videolar kitaplıktaki varsayılan açık sözlükleri otomatik etkinleştirir
    --transcribe-glossaries <id,…> Yazıya dökme sözlükleri (yazıya dökmede sözlük belirtilmezse
                                   kullanılır); boş dize temizler
    --translate-glossaries <id,…>  Çeviri sözlükleri (translate ve dub çevirisinde
                                   kullanılır); boş dize temizler
    --speaker-voice <transcript id>:<speaker>=<voice>[@<Provider>]
                                   Konuşmacı sesi (tekrarlanabilir, tümü değiştirilir):
                                   library:<id> veya sağlayıcının ses ID değeri (ardından @Provider)
    --clear-speaker-voices         Konuşmacı seslerini temizle`,
importUsage: 'Kullanım: baocut library import <file>', exportUsage: 'Kullanım: baocut library export <glossaries|voices|brand> <id> <path>', removeUsage: 'Kullanım: baocut library remove <glossaries|voices|brand> <id>', voiceCloneUsage: 'Kullanım: baocut library voice-clone <voice id> --provider <id> [--name <name>]', voiceCloneRemoveUsage: 'Kullanım: baocut library voice-clone-remove <voice id> --provider <id> [--local-only]', videoSelectionUsage: 'Kullanım: baocut library video-selection <video id> [--translate-glossaries <id,…>] [--speaker-voice …]…', imported: (label, id, name) => `İçe aktarıldı, kitaplık ${label}: ${id}  ${name}`, exported: (id, version, file, bytes) => `${id} sürüm ${version}, ${file} konumuna dışa aktarıldı (${bytes} bayt)`, deleted: (id) => `${id} silindi`, remoteCloneOutcome: { deleted: 'uzaktan silindi', 'not-found': 'uzaktaki ses zaten yoktu', skipped: 'uzak sunucuya başvurulmadı' }, voiceCloneRemoved: (id, provider, remote) => `${id} sesinin ${provider} sağlayıcısındaki klonu silindi (${remote})`, libraryLabels: { glossaries: 'Sözlük', voices: 'Ses', brand: 'Marka kiti' }, unknownLibrary: (text) => `Böyle kitaplık yok: ${text ?? '(eksik)'}. Kullanılabilir: glossaries, voices, brand`, speakerVoiceFormat: (text) => `--speaker-voice <transcript id>:<speaker>=<voice>[@<Provider>] kabul eder; alınan ${text}`, listSep: ', ', none: '(yok)', selectionHead: (videoId, documentId, revision) => `Video ${videoId}${documentId ? ` (library-selection belgesi ${documentId} sürüm ${revision})` : ' (henüz etkin öğe yok)'}`, transcribeGlossaries: (list) => `Yazıya dökme sözlükleri: ${list}`, translateGlossaries: (list) => `Çeviri sözlükleri: ${list}`, speakerVoicesNone: 'Konuşmacı sesleri: (yok)', speakerVoice: (documentId, speakerId, voice, providerId) => `Konuşmacı sesi: ${documentId}:${speakerId} = ${voice}${providerId ? ` (yalnızca ${providerId} sağlayıcısında)` : ''}`,
};
