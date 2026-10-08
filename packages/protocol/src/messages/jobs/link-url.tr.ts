import type { JobsLinkUrlMessages } from './link-url.ts';

export const tr: JobsLinkUrlMessages = {
startsWithDash: 'Bağlantı - ile başlayamaz', invalidLink: 'Geçerli bağlantı değil', httpOnly: 'Yalnızca http(s):// bağlantıları kabul edilir', credentials: 'Bağlantılar kullanıcı adı veya parola içeremez', noHost: 'Bağlantıda ana bilgisayar adı yok', privateAddress: 'Yerel, bağlantı yerel veya özel ağ adreslerinden içe aktarılamaz', redacted: '[bağlantı]', unresolvable: (p) => `${p.host} ana bilgisayar adı çözümlenemiyor: ağı ve bağlantıyı kontrol edin`, noAddresses: (p) => `${p.host} ana bilgisayar adının adresi yok`, resolvesPrivate: (p) => `${p.host} yerel, bağlantı yerel veya özel ağ adresine çözümleniyor; buradan içe aktarılamaz`,
};
