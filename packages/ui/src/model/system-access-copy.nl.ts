import type { SystemAccessMessages } from './system-access-copy.ts';

export const nl: SystemAccessMessages = {
  cardTitle: (names) => `BaoCut toestaan de cookies van ${names} te lezen`,
  cardBody: "macOS vereist dat je BaoCut eerst “Volledige schijftoegang” geeft. Klik op “Systeeminstellingen openen” en BaoCut brengt je direct naar die pagina. BaoCut leest alleen de browsers die je aanvinkt, verder niets.",
  openedTitle: "Zet BaoCut aan in Systeeminstellingen en kom dan terug",
  openedBody: "Zet de schakelaar naast BaoCut aan. Als macOS vraagt of BaoCut moet stoppen en opnieuw opent, kies dan “Stop en heropen”. Staat BaoCut niet in de lijst, klik dan onder de lijst op “+” om het toe te voegen. Biedt macOS geen heropenen aan, klik dan hieronder op “BaoCut opnieuw starten”.",
  open: "Systeeminstellingen openen",
  openAgain: "Systeeminstellingen opnieuw openen",
  restart: "BaoCut opnieuw starten",
  askTitle: (names) => `Eerst toegang tot de cookies van ${names} toestaan?`,
  askBody: (names) => `Deze download gebruikt je inlog bij ${names}, en macOS vereist dat je BaoCut eerst “Volledige schijftoegang” geeft. Zet het aan in Systeeminstellingen en download opnieuw, of sla het nu over en ga door met de andere browsers.`,
  skip: "Nu overslaan",
  settingLabel: "Volledige schijftoegang",
  settingAllowed: "Toegestaan. BaoCut kan bestanden op externe schijven, Bureaublad, Documenten en Downloads en de cookies van Safari lezen, maar alleen de media, bewaarlocaties en browsers die je kiest.",
  settingMissing: "Niet toegestaan. macOS belet apps externe schijven, Bureaublad, Documenten, Downloads en de cookies van Safari te lezen. Na toestemming faalt BaoCut op deze locaties niet meer door rechten. Het leest alleen de media, bewaarlocaties en browsers die je kiest.",
  openFailed: "Systeeminstellingen kon niet worden geopend. Open zelf Systeeminstellingen › Privacy en beveiliging › Volledige schijftoegang.",
};
