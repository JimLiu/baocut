import type { DoctorMessages } from './doctor-copy.ts';

export const nl: DoctorMessages = {
  help: [
    'baocut doctor',
    '',
    'Waarom BaoCut niet start of iets niet kan lezen: welke baocut terminals vinden, welke Runtime de CLI',
    'zou starten en met welke map, of de opslag voor inloggegevens antwoordt, en Volledige schijftoegang op',
    'macOS. Elke controle is ok, warn, fail of skip, met een herstelopdracht als die er is; next is de',
    'herstelopdracht voor het eerste probleem. Alleen-lezen: start nooit een Runtime en leest nooit een',
    'sleutel (de sleutelhangercontrole vraagt alleen of een verzonnen sleutel bestaat). Vraag de gebruiker',
    'om toestemming voordat je de herstelopdrachten uitvoert.',
    'Vanuit een kopie van de repository voert het ook de zelftest van de Runtime uit, die elk native programma één keer start en de builds met de broncode vergelijkt.',
    '',
    'Opties: --json',
  ].join('\n'),
  checkName: {
    entry: 'Opdrachtregel',
    runtime: 'Runtime',
    credentials: 'Inloggegevens',
    fullDiskAccess: 'Volledige schijftoegang',
    build: 'Build',
  },
  remedyLabel: 'oplossing',

  entryApp: (found, version) => `Terminals gebruiken ${found}, de opdrachtregel van de BaoCut-app${version ? ` ${version}` : ''}`,
  entryOtherApp: (found, target, app) =>
    `Terminals gebruiken ${found} (${target}), niet de opdrachtregel van de BaoCut-app in ${app}`,
  entryNoApp: (found, target) => `Terminals gebruiken ${found} (${target}); geen BaoCut-app gevonden`,
  entryMissing: 'Terminals vinden baocut niet. Installeer het vanuit de BaoCut-app (geen beheerdersrechten nodig).',
  entryMissingNoApp: 'Terminals vinden baocut niet, en op de gebruikelijke plekken is geen BaoCut-app gevonden',

  runtimeRunning: (version, pid, by) =>
    `Actief: versie ${version}, proces ${pid}, gestart door ${by === 'cli' ? 'de opdrachtregel' : 'de BaoCut-app'}`,
  runtimeStopped: (entry) => `Niet actief. De volgende opdracht start de Runtime op de achtergrond met ${entry}`,
  runtimeUnreachable: (pid, reason) => `Er draait een Runtime (proces ${pid}), maar die antwoordt niet: ${reason}`,
  runtimeNoLaunch:
    'Niet actief, en er is geen Runtime om te starten. Installeer de BaoCut-app, voer uit in de repository of stel BAOCUT_RUNTIME_ENTRY in op het toegangspunt van de Runtime.',

  credentialsFile: (file) => `Deze versie bewaart sleutels in een bestand: ${file}`,
  credentialsKeychain: (platform) =>
    platform === 'win32' ? 'Windows Referentiebeheer antwoordt' : 'De macOS-sleutelhanger antwoordt',
  credentialsDenied:
    'De sleutelhanger weigerde de toegang. Via SSH of zonder aanmelding op het bureaublad kan macOS hem vergrendeld houden: voer baocut uit in een terminal op het bureaublad, of ontgrendel de inlogsleutelhanger.',
  credentialsNoHelper: (file) =>
    `Het hulpprogramma voor inloggegevens ontbreekt${file ? ` (${file})` : ''}, dus sleutels kunnen niet worden gelezen. Installeer de BaoCut-app opnieuw.`,
  credentialsUnavailable: (reason) => `De opslag voor inloggegevens was niet bereikbaar: ${reason}`,
  credentialsUnknown: 'BAOCUT_RUNTIME_ENTRY bepaalt waar sleutels worden bewaard; niet gecontroleerd',
  credentialsTimedOut: (seconds) => `het hulpprogramma antwoordde niet binnen ${seconds} s`,

  fdaGranted: 'Volledige schijftoegang staat aan',
  fdaMissingApp:
    'Volledige schijftoegang staat uit voor BaoCut.app, dus bestanden op beveiligde plekken (Bureaublad, Documenten, Downloads, andere schijven) zijn mogelijk onleesbaar. Zet BaoCut aan bij Systeeminstellingen › Privacy en beveiliging › Volledige schijftoegang en voer daarna baocut doctor opnieuw uit.',
  fdaMissingCli: (app) =>
    `Volledige schijftoegang staat uit voor de Runtime die de opdrachtregel heeft gestart; macOS rekent die toe aan ${app ?? 'de app die de opdracht uitvoerde (je terminal, of de app waarin de agent draait)'}. Zet die app aan bij Systeeminstellingen › Privacy en beveiliging › Volledige schijftoegang en open hem opnieuw, of stop deze Runtime (baocut runtime stop) en open de BaoCut-app; voer daarna baocut doctor opnieuw uit.`,
  fdaNotRunning: 'Wordt alleen gecontroleerd terwijl een Runtime draait',
  buildOk: (count) => `De native programma’s starten en de ${count} builds komen overeen met de broncode`,
  buildNotSource: 'Wordt gecontroleerd als de Runtime vanuit een kopie van de repository draait',
  buildFailed: (reason) => `De zelftest van de Runtime is niet afgerond: ${reason}`,
  buildTimedOut: (seconds) => `geen antwoord binnen ${seconds} s`,
  buildProblems: (count, first) =>
    count === 1 ? `De zelftest van de Runtime vond een probleem: ${first}` : `De zelftest van de Runtime vond ${count} problemen, eerste: ${first}`,
  buildMore: (first, more) => `${first} (en nog ${more})`,
};
