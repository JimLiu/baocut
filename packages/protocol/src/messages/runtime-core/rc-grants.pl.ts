import type { RcGrantsMessages } from './rc-grants.ts';

const ZH_KINDS: Readonly<Record<string, string>> = {
  transcript: 'transkrypcje i tłumaczenia',
  frames: 'klatki i miniatury',
  audio: 'audio',
  video: 'oryginalne wideo',
  document: 'tekst i prompty',
  context: 'kontekst rozmowy z agentem',
};

function plKinds(codes: string): string {
  return codes
    .split(',')
    .filter(Boolean)
    .map((k) => ZH_KINDS[k] ?? k)
    .join(', ');
}

export const pl: RcGrantsMessages = {
  dataKinds: (p) => plKinds(p.kinds),

  grantLapsed: (p) => `Uprawnienie wysyłania ${plKinds(p.kinds)} do ${p.label} – ${p.expired ? "wygasło" : "cofnięto"}`,
  grantRequired: (p) => `Wysyłanie ${plKinds(p.kinds)} do ${p.label} wymaga uprawnienia użytkownika`,
  grantCallsUsedUp: (p) => `Limit wywołań uprawnienia (${p.used}/${p.max}) wykorzystany, wywołanie przekroczy budżet`,
  grantAmountUsedUp: "Limit wydatków uprawnienia wykorzystany, wywołanie przekroczy budżet",
  budgetUnverifiable: (p) => `Uprawnienie ma limit wydatków, ale model ${p.label} nie ma wiarygodnej ceny, przestrzeganie limitu niegwarantowane`,
  taskCallsUsedUp: (p) => `Budżet wywołań zadania (${p.used}/${p.max}) wykorzystany, wywołanie przekroczy budżet zadania`,
  taskAmountUsedUp: (p) => `Budżet wydatków zadania (${p.amount} ${p.currency}) wykorzystany, wywołanie przekroczy budżet zadania`,
  taskBudgetUnverifiable: (p) => `Budżet zadania ma limit wydatków, ale kosztu wywołania nie można oszacować w ${p.currency}, przestrzeganie limitu niegwarantowane`,
  combined: (p) => `${p.message} (${p.others} więcej ${p.others === 1 ? "przesyłanie także wymaga" : "przesyłania także wymagają"} uprawnienia)`,

  hintRevoked: "Cofnięte lub wygasłe uprawnienia nie wracają automatycznie. Poproś użytkownika o ponowne przyznanie w ustawieniach BaoCut lub jednorazowe zatwierdzenie w sesji.",
  hintRequired: "Wysyłanie danych wymaga uprawnienia użytkownika (typ danych, odbiorca, zakres i cel). Poproś o przyznanie w ustawieniach BaoCut lub jednorazowe zatwierdzenie w sesji.",
  hintExhausted: "Wykorzystany budżet nie rośnie automatycznie. Poproś o podniesienie limitu lub czekaj na ukończenie wywołań (nieudane i anulowane zwalniają rezerwacje).",
  hintUnverifiable: "Bez szacunku kosztu użytkownik może zatwierdzać każde wywołanie (kwota nieznana) lub przyznać uprawnienie na wywołania z nieznaną kwotą.",
  hintTaskExhausted:
    "Wykorzystany budżet zadania nie rośnie automatycznie. Poproś o podniesienie w kontrakcie lub czekaj na ukończenie wywołań (nieudane i anulowane zwalniają rezerwacje).",
  hintTaskUnverifiable:
    "Przy limicie wydatków zadania przyjmowane są tylko wywołania z szacunkiem w tej samej walucie; nieznane kwoty lub inne waluty uniemożliwiają gwarancję. Poproś o usunięcie limitu wydatków (zachowując limit wywołań) lub wybór modelu z ceną.",
  hintServiceAuto:
    "Poziom auto usługi zewnętrznej nie jest uprawnieniem wysyłania danych. Poproś o przyznanie dostawcy w BaoCut (typy danych, zakres i budżet) lub zmień poziom na ask dla zatwierdzania każdego wywołania.",

  placeholderPurpose: "<purpose>",
  placeholderMaxCalls: "<higher call count>",
  placeholderBudget: "<higher amount>",
  placeholderCalls: "<call count>",

  grantLapsedBeforeStart: (p) => `Uprawnienie ${p.state === 'expired' ? "wygasło" : p.state === 'revoked' ? "cofnięto" : "zawężono"} przed rozpoczęciem zadania, dane niewysłane`,
  grantInvalidBeforeStart: "Uprawnienie utraciło ważność przed zadaniem, dane niewysłane",
  retrySkipped: (p) => `Automatycznego ponowienia nie wykonano: ${p.reason}`,
  ledgerUnsaved: "Nie zapisano rejestru uprawnień na dysku, dane niewysłane",
  providerDisabledBeforeStart: "Dostawcę wyłączono przed zadaniem, dane niewysłane",

  noSuchGrant: "Brak takiego uprawnienia",
  toolPurpose: (p) => `Narzędzie „${p.tool}"`,
  pipelinePurpose: (p) => `Potok „${p.label}"`,
};
