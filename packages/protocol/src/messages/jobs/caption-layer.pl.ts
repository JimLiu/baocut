import { pluralForm } from '../../i18n.ts';
import type { JobsCaptionLayerMessages } from './caption-layer.ts';

export const pl: JobsCaptionLayerMessages = {
  label: "Dodaj warstwę napisów",
  noSource: "Brak dokumentu, dla którego można dodać warstwę napisów",
  videoClosed: "Wideo zostało zamknięte, więc nie dodano warstwy napisów. Otwórz wideo i spróbuj ponownie.",
  empty: "Dokument nie ma napisów do pokazania, więc nie dodano warstwy napisów",
  notOnTimeline: "Żaden klip na osi czasu nie używa tego materiału, więc napisy nie mogą pojawić się na ekranie. Nie dodano warstwy napisów.",
  noDocumentId: "Dodano warstwę napisów, ale nie zwrócono ID jej dokumentu",
  rejected: "Odrzucono transakcję dodania warstwy napisów",
  documentGone: "Dokument warstwy napisów nie jest już w wideo",
  needsOutputStore: "Odczyt napisów Speech Worker wymaga magazynu wyników",
  notSpeech: "Dokument nie jest transkrypcją",
  speechUnreadable: "Nie udało się odczytać treści transkrypcji",
  translationUnreadable: "Nie udało się odczytać treści tłumaczenia",
  unaligned: (p: { count: number }) => pluralForm('pl', p.count, { one: `${p.count} jednostka tłumaczenia nie jest dopasowana (alignment ma wartość null), więc nie można ustalić jej czasu`, few: `${p.count} jednostki tłumaczenia nie są dopasowane (alignment ma wartość null), więc nie można ustalić ich czasu`, many: `${p.count} jednostek tłumaczenia nie jest dopasowanych (alignment ma wartość null), więc nie można ustalić ich czasu`, other: `${p.count} jednostki tłumaczenia nie jest dopasowane (alignment ma wartość null), więc nie można ustalić czasu` }),
  noSourceSpeech: "Nie udało się znaleźć transkrypcji, na podstawie której powstało tłumaczenie",
  subtitlesName: "Napisy",
  translationName: "Tłumaczenie",
  styleName: "Styl napisów",
};
