import type { ChatMessages } from './chat-copy.ts';

export const tr: ChatMessages = {
help: `Kullanım:
  baocut chat <message> [options]  Mesaj gönder ve yanıtı yazdır
    --project <dir>                Bu proje klasöründe sohbet et (proje klasördeki .bcut/project.json
                                   ile belirlenir, eksikse dosya yazılır)
    --conversation <id>            Mevcut oturumu sürdür
    --template <id>                Sahne şablonu ekle (baocut templates içindeki sahne): Runtime mesajın sonuna
                                   kısa bilgi kılavuzunu ve şablon gövdesini ekler; örnekler eklenemez;
                                   bunun yerine örneğin istemini (baocut templates show <id>) mesaj olarak gönderin
    --skill <id>                   Skill seç (baocut skills içinden, devre dışı olan da seçilebilir):
                                   Runtime mesajın sonuna SKILL.md gövdesini ekler
    --mode <ask|auto-accept-edits|auto|full-access|plan>
                                   Oturumun erişim modunu değiştir (sonraki işlemler izler); verilmezse oturum mevcut
                                   modunu korur veya hiç değiştirilmediyse agent.defaultAccessMode ayarını kullanır (varsayılan auto)
    --yes                          Onay isteklerini otomatik onayla (yalnızca bu oturum)`,
missingMessage: 'Mesaj metni eksik', templateIsExample: (title, id) => `“${title}” bir örnektir ve eklenemez: istemini baocut templates show ${id} ile alıp mesaj olarak gönderin`, sessionCreated: (id, cwd) => `Oturum ${id}  çalışma klasörü ${cwd}`, disconnected: (reason) => `Runtime bağlantısı kesildi: ${reason}`, sessionDeleted: 'Oturum silindi', stopping: 'Durduruluyor…', chatTemplate: (id) => `Şablon: ${id}`, chatSkill: (id) => `Skill: ${id}`, chatMode: (mode) => `Erişim modu: ${mode}`, taskEnded: (status, error) => `Görev: ${status}${error ? ` — ${error}` : ''}`, taskStatus: { completed: 'Tamamlandı', stopped: 'Durduruldu', failed: 'Başarısız' }, taskFailed: 'Görev başarısız oldu', toolCallFinished: (title, status, exitCode) => `▸ ${title} — ${status}${exitCode !== null ? ` (çıkış kodu ${exitCode})` : ''}`, approvalNeeded: (what) => `Onay gerekli — ${what}`, approvalReason: (isTool, reason) => `${isTool ? 'İçerik' : 'Neden'}: ${reason}`, approvalMode: (mode) => `Mevcut mod: ${mode}`, autoApproved: 'Otomatik onaylandı (--yes)', declinedNotTty: 'Terminalde çalışmıyor: reddedildi (otomatik onay için --yes ekleyin)', approvalQuestion: 'Onayla? [y] evet / [s] oturum / [N] hayır ',
};
