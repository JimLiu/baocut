import type { AgentCatalogMessages } from './agent-catalog.ts';

export const tr: AgentCatalogMessages = {
  idEmpty: "Kimlik girin, ör. my-agent",
  idPattern: "Kimlik küçük harfle başlamalı ve yalnızca küçük harf, rakam ve kısa çizgi içermelidir",
  idTooLong: "Kimlik en fazla 63 karakter olabilir",
  idBuiltin: (id,who) => `${id}, yerleşik BaoCut Ajan kimliğidir${who ? ` (${who})` : ''}. Başka kimlik seçin`,
  idTaken: (id,who) => `Bir Ajan${who ? ` (${who})` : ''} zaten ${id} kimliğini kullanıyor. Başka kimlik seçin`,
  nameEmpty: "Listede gösterilecek adı girin",
  nameTooLong: (max) => `Ad en fazla ${max} karakter olabilir`,
  commandEmpty: "Başlatma komutunu girin, ör. my-agent --acp",
  commandShell: "Tek komut girin: BaoCut kabuk üzerinden değil, doğrudan başlatır; bu yüzden borular, yönlendirmeler ve && çalışmaz",
  tooManyArgs: (max) => `Çok fazla argüman: en fazla ${max}`,
  envLine: (line) => `${line}. satır KEY=VALUE olmalı; KEY harf veya alt çizgiyle başlamalıdır`,
};
