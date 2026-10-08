import type { RcGatewayMessages } from './rc-gateway.ts';

export const tr: RcGatewayMessages = {
helloTimeout: 'El sıkışma zaman aşımına uğradı', textFramesOnly: 'Yalnızca metin çerçeveleri kabul edilir', frameNotJson: 'Çerçeve geçerli JSON değil', frameUnrecognized: 'Çerçeve tanınmıyor', unknownMethod: (p) => `Bilinmeyen yöntem: ${p.method}`, invalidParams: 'Geçersiz parametreler', helloRequired: 'İlk çerçeve hello olmalı', invalidToken: 'Geçersiz jeton', protocolMismatch: (p) => `Uyumsuz protokol sürümleri: istemci ${p.client}, Runtime ${p.runtime}`, internalError: 'İç hata', catalogLocalOnly: 'Araç kataloğu yalnızca yerel CLI ve masaüstü uygulamasında kullanılabilir',
};
