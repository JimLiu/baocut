import type { NodesMessages } from './nodes-copy.ts';

export const tr: NodesMessages = {
nodesHelp: (port) => `Kullanım:
  baocut nodes                     Eşleştirilmiş LAN düğümlerini listele (her biri canlı denetlenir)
  baocut nodes discover            Yetenek paylaşan LAN düğümlerini bul (macOS)
  baocut nodes pair <address[:port]> <pairing code> [--alias <alias>]
                                   Diğer bilgisayarın Bu bilgisayarı paylaş bölümündeki eşleştirme
                                   koduyla eşleştir; varsayılan port ${port}
  baocut nodes remove <nodeId|alias>
                                   Bu bilgisayarda hatırlanan düğüm ve jetonu sil`,
noPairedNodes: 'Eşleştirilmiş düğüm yok. baocut nodes pair <address[:port]> <pairing code> ile eşleştirin', noNodesDiscovered: 'Yetenek paylaşan düğüm bulunamadı (arama yalnızca macOS üzerinde çalışır; adres girerek de eşleştirebilirsiniz)', pairUsage: 'Kullanım: baocut nodes pair <address[:port]> <pairing code> [--alias <alias>]', removeUsage: 'Kullanım: baocut nodes remove <nodeId|alias>', paired: (description) => `Eşleştirildi: ${description}`, noSuchNode: (ref) => `Eşleştirilmiş düğüm yok: ${ref}`, removed: (alias, nodeId) => `${alias} silindi (${nodeId})`, invalidPort: (port) => `Geçersiz port: ${port}`,
shareHelp: (port, capabilities) => `Kullanım:
  baocut share [status]            Bu bilgisayarı paylaş durumu: adres, port,
                                   yetenek anahtarları, eşleştirme kodu, eşleştirilmiş bilgisayarlar
  baocut share start [options]     Paylaşımı başlat ve eşleştirme kodu oluştur
    --port <port>                  Varsayılan ${port}
    --name <name>                  Diğerlerinin gördüğü ad, varsayılan ana bilgisayar adı
    --allow-any-source             Her kaynak adresini kabul et (varsayılan yalnızca LAN adresleri)
  baocut share stop                Paylaşımı durdur (diğerlerinin gönderdiği görevleri iptal eder)
  baocut share code                Eski eşleştirme kodunu geçersiz kıl ve yenisini oluştur
  baocut share revoke <clientId>   Eşleştirilmiş bilgisayarın yetkisini iptal et
  baocut share capability <capability> <on|off>
                                   Yetenek paylaşımını (${capabilities.join(', ')}) hemen aç veya kapat:
                                   kapandıktan sonra başkalarının yeni görevleri reddedilir;
                                   önceden kabul edilen görevler tamamlanır`,
portRange: '--port 0–65535 arasında tam sayı olmalı', shareRevokeUsage: 'Kullanım: baocut share revoke <clientId>', capabilityLabels: { transcribe: 'Yazıya dökme' }, capabilityUsage: 'Kullanım: baocut share capability <capability> <on|off> (örneğin baocut share capability transcribe off)', shareOff: 'Kapalı', shareOn: 'Açık', shareNotListening: (error) => `Açık ancak dinlemiyor${error ? `: ${error}` : ''}`, shareState: (state) => `Bu bilgisayarı paylaş: ${state}`, name: (name, nodeId) => `Ad: ${name}${nodeId ? ` (${nodeId})` : ''}`, port: (port, anySource) => `Port: ${port}${anySource ? ' (her kaynak adresi)' : ''}`, addresses: (addresses) => `Adresler: ${addresses ?? '(yerel ağ adresi yok)'}`, capabilitiesHead: (empty) => `Yetenekler: ${empty ? 'yok' : ''}`, capabilityLine: (label, capability, enabled) => `  ${label} (${capability}): ${enabled ? 'açık' : `kapalı (baocut share capability ${capability} on ile açın)`}`, pairingCode: (code, until) => `Eşleştirme kodu: ${code} (${until} zamanına kadar geçerli)`, pairingLocked: (until) => `Eşleştirme ${until} zamanına kadar kilitli (baocut share code hemen açar)`, noPairingCode: 'Eşleştirme kodu: yok (baocut share code oluşturur)', clientsHead: (empty) => `Eşleştirilmiş bilgisayarlar: ${empty ? 'yok' : ''}`, clientLine: (name, clientId, pairedAt, lastSeenAt) => `  ${name}  ${clientId}  eşleştirildi ${pairedAt}${lastSeenAt ? `  son görülme ${lastSeenAt}` : ''}`, remoteTasks: (running, queued) => `Uzak görevler: ${running} çalışıyor, ${queued} sırada`, unreachable: 'Bağlanılamıyor', versionMismatch: 'Uyumsuz protokol sürümü', unpaired: 'Eşleştirme artık geçerli değil (yeniden eşleştirin)', available: 'Kullanılabilir', transcribeReady: (bundles, running, queued) => `Kullanılabilir · modeller ${bundles.length > 0 ? bundles.join(', ') : 'yok'} · ${running} çalışıyor, ${queued} sırada`, transcribeOff: 'Kullanılamıyor · düğüm yazıya dökme paylaşımını kapattı (o bilgisayarda açın)',
};
