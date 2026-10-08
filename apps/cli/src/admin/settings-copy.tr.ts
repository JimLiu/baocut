import type { SettingsMessages } from './settings-copy.ts';

export const tr: SettingsMessages = {
help: `Kullanım:
  baocut settings                  Tüm tercihleri listele: anahtar, mevcut değer, varsayılan olup olmadığı ve bir satırlık açıklama
  baocut settings get <key>        Ayarın mevcut değerini yazdır (JSON)
  baocut settings set <key> <value>
                                   Ayarı değiştir; değer JSON olarak ayrıştırılır (true, 20,
                                   {"cjk":18,"other":40}); ayrıştırılamazsa dize olarak alınır.
                                   Bilinmeyen anahtarlar ve geçersiz değerler reddedilir, hiçbir şey kaydedilmez
  baocut settings reset <key>      Varsayılan değeri geri yükle`,
usage: 'Kullanım: baocut settings [get <key> | set <key> <value> | reset <key>]',
setUsage: 'Kullanım: baocut settings set <key> <value> (değer JSON olarak ayrıştırılır; JSON olmayan dize olarak alınır; boşluk içeren değerleri tırnak içine alın)',
unknownKey: (key, keys) => `Bilinmeyen ayar: ${key}. Kullanılabilir: ${keys.join(', ')}`, isDefault: 'varsayılan', modified: (defaultValue) => `değiştirildi (varsayılan ${defaultValue})`, settingRejected: (key, value, description) => `${key}, ${value} kabul etmez: ${description}`,
};
