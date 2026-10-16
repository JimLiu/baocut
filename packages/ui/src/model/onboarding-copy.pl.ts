import { pluralForm } from '@baocut/protocol';
import type { OnboardingMessages } from './onboarding-copy.ts';

const agentsN = (n: number) => `${n} ${pluralForm('pl', n, { one: 'Agenta', few: 'Agentów', many: 'Agentów', other: 'Agenta' })}`;

export const pl: OnboardingMessages = {
  dialogLabel: 'Witamy w BaoCut',
  stepsLabel: 'Kroki konfiguracji',
  step: {
    agent: 'Połącz Agenta',
    asr: 'Rozpoznawanie mowy',
    tts: 'Synteza mowy',
    semantic: 'Wyszukiwanie semantyczne',
    image: 'Generowanie obrazów',
    music: 'Generowanie muzyki',
  },
  title: {
    agent: 'Witamy w BaoCut',
    asr: 'Pobierz modele rozpoznawania mowy',
    tts: 'Pobierz modele syntezy mowy',
    semantic: 'Zainstaluj wyszukiwanie semantyczne',
    image: 'Pobierz modele generowania obrazów',
    music: 'Pobierz modele generowania muzyki',
  },
  lead: {
    agent:
      'Opisz, jakie wideo chcesz, a Agent zrobi za Ciebie transkrypcję, napisy, tłumaczenie, dubbing i montaż. BaoCut korzysta z Agentów na tym komputerze (np. Claude Code lub Codex) przez Twoje własne konto, bez dodatkowych opłat.',
    asr: 'Transkrypcja, napisy i montaż wideo z mówiącą osobą zaczynają się od zamiany mowy na tekst. Modele działają na tym komputerze, także offline.',
    tts: 'Modele syntezy mowy czytają tekst na głos, klonują głos z nagrania i tworzą dubbing do przetłumaczonych filmów. Na początek wybierz jeden lub dwa; pozostałe pobierzesz później w sekcji Ustawienia › Synteza mowy.',
    semantic:
      'Znajduje to, co powiedziano i pokazano, według znaczenia: korzystają z niego wyszukiwanie w Space, wybór materiału według tematu, dopasowanie obrazu i pamięć tłumaczeń. Po instalacji istniejące filmy są indeksowane w tle.',
    image: 'Generuje na tym komputerze obrazy z jednego zdania — na okładki i ilustracje. Modele są duże, a generowanie trwa długo.',
    music:
      'Generuje na tym komputerze muzykę w tle i piosenki na podstawie stylu lub tekstu, gotowe do dodania na ścieżkę muzyczną filmu. Generowanie trwa długo: około kilku minut na 30 sekund.',
  },
  where: {
    tts: {
      title: 'Używaj w sekcji Narzędzia › Generuj mowę',
      body: 'Napisz tekst albo wybierz dokument lub napisy w Space, a potem model i głos. Niepobrane modele możesz tam też pobrać.',
    },
    image: { title: 'Używaj w sekcji Narzędzia › Generuj obraz', body: 'Opisz obraz jednym zdaniem. Agenci też z tego korzystają, tworząc okładki.' },
    music: {
      title: 'Używaj w sekcji Narzędzia › Wygeneruj muzykę',
      body: 'Wybierz styl i napisz tekst. Muzyka zapisuje się w Space i można ją dodać do filmów.',
    },
  },
  diarizes: 'Rozróżnia mówców podczas transkrypcji',
  needsDiarization: (pack) => `Aby rozróżniać mówców, pobierz też „${pack}”`,
  familyNote: {
    'qwen3-tts-1.7b-customvoice': '9 gotowych głosów · styl mówienia opisany jednym zdaniem',
    'qwen3-tts-0.6b-base': 'Klonuje głos z 3-sekundowego nagrania',
    voxcpm2: 'Klonuje głos z nagrania · opis stylu · 30 języków i kantoński',
    'qwen-image-2.1-turbo': 'Destylowany · stałe 8 kroków · ponad dwa razy szybszy od modelu bazowego',
    'qwen-image-2.1': 'Model bazowy · wolniejszy, więcej kroków',
    'yue2-3b': 'Generuje ze stylu lub tekstu · około kilku minut na 30 sekund',
  },
  recommended: 'Zalecany',
  installed: 'Zainstalowany',
  missingParts: 'Brak komponentów',
  planLine: (parts) => `Pobierane razem: ${parts}`,
  downloading: (name) => `Pobieranie ${name}`,
  inBackground: 'Pobieranie w tle',
  bgNote: 'Przed pobraniem zobaczysz, skąd pochodzi i gdzie zostanie zapisane. Zacznie się dopiero po Twoim potwierdzeniu i działa w tle, więc nie musisz czekać.',
  asrAlt: 'Nie chcesz nic pobierać? Rozpoznawanie mowy w chmurze możesz też dodać później w sekcji Ustawienia › Dostawcy API.',
  unsupported: 'Ten komputer nie uruchomi tych modeli. Możesz pominąć ten krok.',
  semanticParts: (text, multimodal) => `${text} + ${multimodal}`,

  agentListLabel: 'Agenci na tym komputerze',
  agentChecking: 'Szukanie Agentów na tym komputerze…',
  agentMissingBody: 'Zaznacz tych, których chcesz używać, a BaoCut zainstaluje ich w tle. Po instalacji zaloguj się raz swoim dotychczasowym kontem.',
  agentNote:
    'Zaznaczeni Agenci pojawią się w menu Agentów nowych sesji. Instalacja działa w tle, więc nie musisz czekać. Domyślnego Agenta wybierzesz, a kolejnych dodasz w sekcji Ustawienia › Dostawcy agentów.',
  agentInstalled: 'Zainstalowany na tym komputerze',
  agentFix: (problem) => `${problem} · Napraw w sekcji Ustawienia › Dostawcy agentów`,
  agentManual: 'Zainstaluj w terminalu zgodnie z oficjalnymi instrukcjami · Zobacz Ustawienia › Dostawcy agentów',
  agentNotInstalled: (plan) => (plan ? `Nie zainstalowano · Logowanie po instalacji: ${plan}` : 'Nie zainstalowano'),
  agentWillInstall: (method, command, login) =>
    `Zostanie zainstalowany w tle przez ${method} (${command}) · Potem uruchom ${login} w terminalu, aby się zalogować`,
  agentInstalling: (method, login) => `Instalowanie w tle przez ${method} · Potem uruchom ${login} w terminalu, aby się zalogować`,
  agentInstallingLabel: (name) => `Instalowanie ${name}`,
  agentInstallFailed: 'Nie udało się zainstalować · Szczegóły w „Zadania w tle”',

  next: 'Dalej',
  finish: 'Gotowe',
  skip: 'Pomiń',
  exit: 'Zakończ konfigurację',
  install: (n) => `Zainstaluj ${agentsN(n)} w tle i kontynuuj`,
  download: (size, last) => `Pobierz${size ? ` ${size}` : ''} w tle i ${last ? 'zakończ' : 'kontynuuj'}`,
  bg: {
    one: (kind, name, pct) => {
      const tail = pct === null ? '' : ` ${pct}%`;
      return kind === 'install' ? `Instalowanie ${name}${tail}` : kind === 'download' ? `Pobieranie ${name}${tail}` : `Przygotowywanie ${name}${tail}`;
    },
    many: (kind, n) =>
      kind === 'install' ? `Instalowanie w tle: ${n}` : kind === 'download' ? `Pobieranie w tle: ${n}` : `Przygotowywanie w tle: ${n}`,
    idle: (kind) => (kind === 'install' ? 'Instalacje w tle' : kind === 'download' ? 'Pobieranie w tle' : 'Pobieranie i instalacje w tle'),
    done: (kind, n) => (kind === 'install' ? `Zainstalowano: ${n}` : kind === 'download' ? `Pobrano: ${n}` : `Gotowe: ${n}`),
    failed: (kind, n) => (kind === 'install' ? `Nie zainstalowano: ${n}` : kind === 'download' ? `Nie pobrano: ${n}` : `Nie ukończono: ${n}`),
  },
  closedToast: (models, agents) => {
    const parts = [
      ...(models
        ? [
            pluralForm('pl', models, {
              one: `${models} model jest pobierany`,
              few: `${models} modele są pobierane`,
              many: `${models} modeli jest pobieranych`,
              other: `${models} modeli jest pobieranych`,
            }),
          ]
        : []),
      ...(agents
        ? [
            pluralForm('pl', agents, {
              one: `${agents} Agent jest instalowany`,
              few: `${agents} Agentów jest instalowanych`,
              many: `${agents} Agentów jest instalowanych`,
              other: `${agents} Agentów jest instalowanych`,
            }),
          ]
        : []),
    ];
    const ready = models + agents === 1 ? 'Po zakończeniu będzie gotowy do użycia.' : `Po zakończeniu będą ${agents ? 'gotowi' : 'gotowe'} do użycia.`;
    return `${parts.join(' i ')} w tle. ${ready}`;
  },
  viewTasks: 'Pokaż zadania w tle',
};
