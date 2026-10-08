import type { SpaceMessages } from './space-copy.ts';
import { pluralForm } from '@baocut/protocol';
const count = (n: number, one: string, other: string) => `${n} ${pluralForm('nl', n, { one, other })}`;
export const nl: SpaceMessages = {
 help: `Gebruik:
  baocut space rescan              De bronmappen opnieuw scannen
  baocut space rebuild             De Space-catalogus uit bronmappen en records opnieuw opbouwen;
                                   de inhoudsindex leest alle video’s opnieuw op de achtergrond
  baocut space trash|restore <entry id>
                                   Naar de prullenmand verplaatsen / herstellen (bestanden blijven ongewijzigd;
                                   bij video-items gaat de videomap naar / uit de prullenmand)
  baocut space purge <entry id>    Een item uit de prullenmand definitief verwijderen; niet zolang
                                   een video of taak het gebruikt; verwijzingen worden getoond
  baocut space delete-video <entry id>
                                   Een video verwijderen: de videomap gaat naar de prullenmand en is binnen de
                                   bewaartermijn te herstellen; gekoppelde oorspronkelijke media blijven ongewijzigd
  baocut space continue <entry id> [--conversation <session id>]
                                   Een sessie voortzetten vanuit een item: een verwijzing (alleen identificatie en metadata) gaat mee met
                                   het volgende bericht; zonder sessie wordt er een gekozen op basis van de locatie, of aangemaakt`,
 usage: ['Gebruik: baocut space rescan | rebuild | trash <entry id> | restore <entry id> | purge <entry id> | delete-video <entry id>', '       baocut space continue <entry id> [--conversation <session id>]'].join('\n'), entryUsage: (action) => `Gebruik: baocut space ${action} <entry id>`, continueUsage: 'Gebruik: baocut space continue <entry id> [--conversation <session id>]', flagNotAccepted: (action, key) => `baocut space ${action} accepteert --${key} niet`, rescanStarted: 'Nieuwe scan gestart', rebuilt: (entries, pendingVideos) => `Catalogus opnieuw opgebouwd: ${count(entries, 'item', 'items')}; de inhoudsindex leest ${count(pendingVideos, 'video', 'video’s')} opnieuw op de achtergrond, dus zoekresultaten zijn onvolledig totdat dit klaar is`, purgeBlocked: (id) => `${id} wordt nog door een video of taak gebruikt; niet verwijderd`, movedToTrash: (id, name) => `Naar prullenmand verplaatst: ${id}  ${name}`, restoredFromTrash: (id, name) => `Uit prullenmand hersteld: ${id}  ${name}`, purged: (id) => `${id} definitief verwijderd`, notPurged: (id) => `${id} niet verwijderd: er zijn nog verwijzingen`, videoTrashed: (name, entryId, retentionDays) => `Video ‘${name}’ naar prullenmand verplaatst: ${entryId} (herstellen met baocut space restore ${entryId}${retentionDays === null ? '' : `; definitief verwijderd na ${count(retentionDays, 'dag', 'dagen')}`})`, relatedKept: (n) => `${count(n, 'item', 'items')} die eruit zijn geëxporteerd of gegenereerd blijven staan`, continued: (created, id, cwd) => `${created ? 'Sessie gemaakt' : 'Sessie gebruiken'} ${id}  werkmap ${cwd}`, referenceNext: (name, id) => `Een verwijzing naar item ‘${name}’ gaat mee met het volgende bericht: baocut chat "…" --conversation ${id}`,
};
