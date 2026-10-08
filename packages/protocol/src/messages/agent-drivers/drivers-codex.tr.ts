import type { DriversCodexMessages } from './drivers-codex.ts';

export const tr: DriversCodexMessages = {
plan: 'ChatGPT Plus veya Pro aboneliği', installHint: 'Codex CLI yükleyin', signedOut: (p) => `Codex oturum açmamış. Terminalde codex login çalıştırın.${p.detail ? ` (${p.detail})` : ''}`, chatgptAccount: 'ChatGPT hesabı', apiKey: 'OpenAI API anahtarı', accessToken: 'Erişim jetonu', workloadIdentity: 'İş yükü kimliği', codexAccount: 'Codex hesabı', steerMismatch: (p) => `Codex beklenmeyen turn/steer yanıtı verdi: beklenen tur ${p.expected}, alınan ${p.received}`, appServerExited: (p) => `codex app-server çıktı (code ${p.code}, signal ${p.signal})${p.stderr ? `\n${p.stderr}` : ''}`, connectionClosed: "Codex app-server bağlantısı kapalı", requestTimeout: (p) => `codex app-server isteği zaman aşımına uğradı: ${p.method}`, appServerGone: 'codex app-server çıktı',
};
