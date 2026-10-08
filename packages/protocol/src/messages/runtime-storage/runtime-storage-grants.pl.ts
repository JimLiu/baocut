import type { RuntimeStorageGrantsMessages } from './runtime-storage-grants.ts';

export const pl: RuntimeStorageGrantsMessages = {
  localNeedsNoGrant: "Obliczenia lokalne nie wymagają uprawnienia",
  dataKindRequired: "Podaj co najmniej jeden rodzaj danych",
  budgetCapRequired: "Uprawnienie z limitem wydatków wymaga budgetCap",
  unknownCostNoCap: "Uprawnienie z nieznanym kosztem nie może mieć limitu wydatków. Aby go ustawić, użyj estimate-cap",
  expiryPassed: "Czas wygaśnięcia już minął",
  grantNotFound: "Brak takiego uprawnienia",
  grantRevoked: "Uprawnienie zostało cofnięte i nie można go zmienić. Przyznaj nowe",
  cannotRemoveCap: "Uprawnienie z limitem wydatków nie może usunąć limitu. Cofnij je i przyznaj nowe z nieznanym kosztem",
  unknownCostCannotCap: "Uprawnienie z nieznanym kosztem nie może ustawić limitu wydatków. Cofnij je i przyznaj nowe uprawnienie estimate-cap",
  cannotChangeCurrency: "Nie można zmienić waluty",
  expiryPassedRevoke: "Czas wygaśnięcia już minął. Aby je teraz zatrzymać, cofnij uprawnienie",
  revokeNote:
    "Po cofnięciu nowe wywołania nie są wykonywane, a wywołania w kolejce są odrzucane przy rozpoczęciu. Wysłanych dostawcy danych i poniesionych kosztów nie można cofnąć lokalnie; trwające wywołania kończą się normalnie i wliczają się do użycia.",
  taskCallLimit: "Limit wywołań budżetu zadania musi być dodatnią liczbą całkowitą",
  providerGrantPurpose: (p) => `Przyznano domyślnie po włączeniu ${p.label}`,
  invalidCurrency: (p) => `Waluta musi mieć trzy wielkie litery (ISO 4217): ${p.currency}`,
};
