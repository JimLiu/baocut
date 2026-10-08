import type { ApprovalsMessages } from './approvals-copy.ts';

export const tr: ApprovalsMessages = {
help: `Kullanım:
  baocut approvals                 Oturumlardan ve dış hizmetlerden bekleyen onayları listele
  baocut approvals allow <id>      Bekleyen onaya izin ver; veri paylaşan onaylar varsayılan
                                   olarak yalnızca bu sefer izinlidir (tutar bilinmiyor)
    --persist                      Sürekli izin de ver (aynı veri paylaşımı tekrar sorulmaz)
    --scope <video|all>            Sürekli izin kapsamı: bu çağrının videosu (varsayılan) veya tüm videolar
    --max-calls <n>                Sürekli izin için çağrı sınırı
    --budget <amount> --currency <currency>
                                   Sürekli izin için harcama sınırı (yalnızca fiyatı olan modeller;
                                   maliyeti tahmin edilemeyen çağrılar her seferinde onay gerektirir)
    --expires <ISO time>           Sürekli iznin sona erme zamanı
  baocut approvals deny <id>       Bekleyen onayı reddet`,
persistNeedsAllow: '--persist yalnızca allow ile kullanılır', alreadyResolved: (id) => `${id} onayı zaten işlendi, zaman aşımına uğradı veya iptal edildi (ya da yok)`, allowed: (id) => `İzin verildi: ${id}`, denied: (id) => `Reddedildi: ${id}`, unknownMode: (value, flags) => `Bilinmeyen erişim modu: ${value}. --mode şunları kabul eder: ${flags.join(', ')}`, mode: (label, flag) => `${label} (${flag})`, usage: 'Kullanım: baocut approvals [list | allow <approval id> | deny <approval id>]', riskLabels: { read: 'Oku', edit: 'Düzenle', command: 'Komut', high: 'Yüksek risk' }, none: 'Bekleyen onay yok', fromSession: (title) => `“${title}” oturumu`, fromService: (serviceId, clientName) => `Hizmet ${serviceId} · ${clientName}`, basisMode: (mode) => `mod ${mode}`, basisLevel: (level) => `düzey ${level}`, approvalLine: (a) => `${a.id}  ${a.who}  ${a.action}${a.targets.length > 0 ? ` → ${a.targets.join(', ')}` : ''}  [${a.risk}] ${a.summary} (${a.basis}${a.secondsLeft === null ? '' : `, ${a.secondsLeft} sn sonra otomatik reddedilir`})`, runCommand: (command) => `Komut çalıştır: ${command}`, changeFiles: (files) => `Dosyaları değiştir: ${files.join(', ')}`, callTool: (tool, files) => `Çağır: ${tool}${files.length > 0 ? `: ${files.join(', ')}` : ''}`,
};
