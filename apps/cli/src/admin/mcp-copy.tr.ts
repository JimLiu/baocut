import type { McpMessages } from './mcp-copy.ts';

export const tr: McpMessages = {
previousClientUnknown: 'Değiştirilen öğenin kullandığı istemci belirlenemedi; istemci iptal edilmedi: baocut mcp status mevcut istemcileri listeler; kullanılmayanları baocut services mcp revoke <clientId> ile iptal edin', defaultProjectRegistered: (name, path) => `BaoCut içinde proje yoktu: dış ajanların video oluşturması için varsayılan “${name}” projesi kaydedildi (${path})`,
help: `Kullanım:
  baocut mcp install --agent <claude-code|codex|cursor|gemini> [--transport stdio|http] [--level ask|auto] [--name <client name>] [--yes]
                                   Dış ajanı BaoCut MCP hizmetine bağla: hizmeti başlat (Runtime ile başlamasını da ayarla),
                                   ajan için yeni istemci ve jeton oluştur, adres ve jetonu ajanın MCP yapılandırmasına yaz
                                   (öğe adı baocut); sonra ajanı yeniden başlat
                                   BaoCut içinde proje yoksa CLI projesini varsayılan projeler klasörüne dış ajanlar için kaydet
    --transport stdio|http         stdio (varsayılan): ajan baocut mcp serve --stdio çalıştırır; bu komut BaoCut Runtime'ını kendisi
                                   bulur veya başlatır. http: hizmetin adresini yazar; yalnızca Runtime çalışırken çalışır
    --level ask|auto               Erişim düzeyi: ask her yazma ve görevde BaoCut içinde onay ister (hizmet varsayılanı);
                                   auto doğrudan çalıştırır. Verilmezse mevcut düzey korunur
    --name <client name>           BaoCut içinde görünen istemci adı (varsayılan ajanın adı); ayrı iptal edilebilir
    --yes                          Ajanın yapılandırmasında baocut öğesi varsa değiştir ve eski öğenin kullandığı istemciyi
                                   iptal et (eski jetondan tanınır; tanınamazsa aynı adlı istemciler iptal kararınız için
                                   listelenir). Verilmezse üzerine yazılmaz ve istemci oluşturulmaz
  Jeton konumu: Claude Code jetonu ~/.claude/settings.json env (BAOCUT_MCP_TOKEN) içinde tutar, yapılandırma yalnızca başvurur.
  Codex (~/.codex/config.toml), Cursor (~/.cursor/mcp.json) ve Gemini CLI (~/.gemini/settings.json) ortam değişkenleri
  için yer sunmaz; jeton yapılandırmaya düz metin yazılır: bu dosyaları commit etmeyin veya paylaşmayın, ask düzeyini
  tercih edin; jeton sızarsa baocut services mcp revoke <clientId> ile iptal edin.
  Hizmet yalnızca BaoCut Runtime çalışırken kullanılabilir (BaoCut açın veya baocut runtime ensure çalıştırın).
  baocut mcp status                MCP hizmetinin durumu, adresi, düzeyi ve istemcileri ile her ajanın yapılandırmasında
                                   baocut öğesi olup olmadığı (jetonlar gösterilmez)
  baocut mcp serve --stdio         stdio girdisinin çalıştırdığı komut: BAOCUT_MCP_TOKEN içindeki jetonla MCP hizmetine ileten stdio MCP
                                   sunucusu; gerekince Runtime'ı bulur veya başlatır. Onu ajan çalıştırır, terminal için değildir`,
entryExists: (file, entry) => `${file} içinde ${entry} öğesi zaten var; değişiklik yapılmadı. Değiştirmek için --yes ekleyin`, serviceNotAvailable: 'Bu BaoCut sürümü MCP hizmeti sunmuyor', serviceStartFailed: (reason) => `MCP hizmeti başlamadı: ${reason ?? 'bilinmeyen neden'}`, connected: (host, url) => `${host} BaoCut MCP hizmetine bağlandı: ${url}`, configEnv: (configFile, envFile, envVar) => `Yapılandırma: ${configFile} (jeton ${envFile} içindeki env.${envVar} alanında; yapılandırma yalnızca başvurur)`, configPlaintext: (configFile, clientId) => `Yapılandırma: ${configFile} (jeton bu dosyaya düz metin yazılır: commit etmeyin veya paylaşmayın; sızarsa baocut services mcp revoke ${clientId} ile iptal edin)`, clientLine: (name, clientId, level) => `İstemci: ${name} (${clientId})  Düzey: ${level ?? '—'}`, restartHint: (host) => `Geçerli olması için ${host} yeniden başlatın. Hizmet BaoCut Runtime ile çalışır: Runtime çalışmıyorsa önce BaoCut açın veya baocut runtime ensure çalıştırın`, replacedRevoked: (name, clientId) => `Eski öğe değiştirildi ve kullandığı istemci iptal edildi: ${name} (${clientId})`, replacedRevokeFailed: (reason) => `Eski öğe değiştirildi, ancak kullandığı istemci iptal edilemedi: ${reason}`, oldClientRemains: (ids) => `Eski istemci hâlâ var: ${ids.join(', ')}. Artık kullanılmıyorsa: baocut services mcp revoke <clientId>`, sameNameClientsRemain: (ids, unrecognized) => `${unrecognized ? 'Eski öğenin kullandığı istemci belirlenemedi; aynı adlı istemciler' : 'Aynı adlı istemciler'} hâlâ var: ${ids.join(', ')}. Artık kullanılmıyorlarsa: baocut services mcp revoke <clientId>`, hostsHeading: (entry) => `Her ajanın yapılandırmasında ${entry} öğesi var mı:`, hostUnreadable: (problem) => `okunamıyor (${problem})`, hostConfigured: 'evet', hostNotConfigured: 'hayır', noServiceStatus: 'Runtime MCP hizmetinin durumunu bildirmedi', levelChoice: (value) => `--level ask veya auto olmalı: ${value}`,
  connectedStdio: (host, command) => `${host}, BaoCut MCP hizmetine stdio ile bağlandı: ${host} ${command} komutunu çalıştırır`,
  configEnvInherited: (configFile, envFile, envVar) => `Yapılandırma: ${configFile} (jeton ${envFile} içindeki env.${envVar} alanında; komut onu oradan devralır)`,
  restartHintStdio: (host) => `Geçerli olması için ${host} yeniden başlatın. ${host} komutu kendisi çalıştırır; Runtime çalışmıyorsa komut onu başlatır`,
  transportChoice: (value) => `--transport stdio veya http olmalı: ${value}`,
  serveTokenMissing: (envVar) => `${envVar} ayarlanmamış, bu yüzden BaoCut MCP hizmeti için jeton yok: ajanın MCP yapılandırmasına yazmak için baocut mcp install --agent <agent> çalıştırın`,
  serveServiceOff: 'BaoCut MCP hizmeti kapalı: BaoCut içinde açın veya baocut services configure mcp --autostart on çalıştırın',
  serveTokenRejected: 'BaoCut MCP hizmeti jetonu reddetti (iptal edilmiş veya başka bir Runtime Home tarafından verilmiş): baocut mcp install --agent <agent> --yes komutunu yeniden çalıştırın',
  serveRuntimeLost: 'BaoCut Runtime bu isteği işlerken durdu; istek yeniden denenmedi',
  serveRuntimeUnavailable: (reason) => `BaoCut Runtime'a ulaşılamıyor: ${reason}`,
  serveHttpStatus: (status) => `BaoCut MCP hizmeti HTTP ${status} yanıtı verdi`,
};
