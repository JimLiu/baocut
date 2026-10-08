import type { JobsVideoTargetMessages } from './video-target.ts';

export const tr: JobsVideoTargetMessages = {
stepLabel: 'Hedefi çözümle', notSameVideo: 'videoId ile farklı bir videoya işaret eder', targetShapeOneOf: '{ videoId }, { entryId } veya { create } biçiminde olmalı', createUnsupported: 'Bu işlem hattı video oluşturamaz: mevcut video verin (videoId veya entryId)', createShape: '{ projectId, name? } veya { conversationId, name? } biçiminde olmalı', mediaNotAllowed: 'verilemez: medya bu işlem hattının sonucudur', unknownField: (p) => `bilinmeyen ${p.key} alanı içerir`, scopeOnlyOne: 'projectId veya conversationId değerlerinden yalnızca birini kabul eder', scopeRequired: 'projectId veya conversationId gerekir', nameLength: '1 ile 200 karakter arasında olmalı', mediaPath: 'yerel medya dosyasının mutlak yolu olmalı',
};
