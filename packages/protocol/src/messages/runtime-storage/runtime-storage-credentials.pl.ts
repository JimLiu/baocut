import type { RuntimeStorageCredentialsMessages } from './runtime-storage-credentials.ts';

export const pl: RuntimeStorageCredentialsMessages = {
  denied: "Odmowa dostępu",
  unavailable: "Magazyn danych uwierzytelniających jest niedostępny",
  unsupported: "Ta platforma nie obsługuje bezpiecznego magazynu systemowego",
  internal: "Błąd odczytu lub zapisu danych uwierzytelniających",
  problem: (p) => `${p.reason}: ${p.message}`,
  fileWriteFailed: (p) => `Nie udało się zapisać pliku danych uwierzytelniających (${p.code})`,
  helperBadResponse: "Program pomocniczy uwierzytelniania zwrócił nieprawidłową odpowiedź",
  helperNotFound: "Nie znaleziono programu pomocniczego uwierzytelniania",
  helperTimedOut: (p) => `Program pomocniczy uwierzytelniania nie odpowiedział w ciągu ${p.seconds} s`,
  helperMissing: "Brak programu pomocniczego uwierzytelniania",
  helperStartFailed: (p) => `Nie udało się uruchomić programu pomocniczego uwierzytelniania (${p.code})`,
  helperResponseTooLong: "Odpowiedź programu pomocniczego uwierzytelniania jest zbyt długa",
  helperExitedSilently: "Program pomocniczy uwierzytelniania zakończył działanie bez odpowiedzi",
  helperReportedError: "Program pomocniczy uwierzytelniania zgłosił błąd",
  redacted: "[ukryto]",
};
