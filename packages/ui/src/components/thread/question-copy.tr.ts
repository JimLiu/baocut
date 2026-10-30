import type { QuestionMessages } from './question-copy.ts';

export const tr: QuestionMessages = {
  title: 'Agent’ın bir sorusu var',
  titleMany: (n) => `Agent’ın ${n} sorusu var`,
  pickOne: 'Birini seçin',
  pickMany: 'Uygun olanların hepsini seçin',
  other: 'Diğer',
  otherPlaceholder: 'Yanıtınızı yazın',
  submit: 'Yanıtı gönder',
  skip: 'Atla',
  hint: 'Doğrudan mesaj kutusundan da yanıt verebilirsiniz.',
  kind: 'Soru',
  answered: 'Yanıtlandı',
  skipped: 'Atlandı',
  byMessage: 'Mesajla yanıtlandı',
  cancelled: 'Durduruldu',
  noAnswer: 'Yanıt yok',
  failed: (message) => `Gönderilemedi: ${message}`,
};
