import type { SpaceMessages } from './space-copy.ts';
import { pluralForm } from '@baocut/protocol';

const entriesLabel = (n: number) => pluralForm('it', n, { one: `${n} voce`, other: `${n} voci` });
const videosLabel = (n: number) => pluralForm('it', n, { one: `${n} video`, other: `${n} video` });
const daysLabel = (n: number) => pluralForm('it', n, { one: `${n} giorno`, other: `${n} giorni` });

export const it: SpaceMessages = {
  help: `Uso:
  baocut space rescan              Esegue di nuovo la scansione delle cartelle di origine
  baocut space rebuild             Ricostruisce il catalogo dello Space dalle cartelle e dai registri di origine;
                                   l’indice dei contenuti rilegge tutti i video in background
  baocut space trash|restore <entry id>
                                   Sposta nel Cestino / ripristina dal Cestino (i file non vengono modificati;
                                   per le voci video, la cartella del video entra / esce dal Cestino)
  baocut space purge <entry id>    Elimina definitivamente una voce del Cestino; non viene eliminata mentre
                                   un video o un’attività la usa ancora, e le relative referenze vengono elencate
  baocut space delete-video <entry id>
                                   Elimina un video: sposta la cartella del video nel Cestino, ripristinabile durante
                                   il periodo di conservazione; i file originali dei materiali collegati non cambiano
  baocut space continue <entry id> [--conversation <session id>]
                                   Continua una sessione da una voce: un riferimento (solo identificatori e metadati) accompagna
                                   il prossimo messaggio; senza sessione, ne viene scelta una dalla posizione della voce o creata`,
  usage: ['Uso: baocut space rescan | rebuild | trash <entry id> | restore <entry id> | purge <entry id> | delete-video <entry id>', '       baocut space continue <entry id> [--conversation <session id>]'].join('\n'),
  entryUsage: (action: string) => `Uso: baocut space ${action} <entry id>`, continueUsage: 'Uso: baocut space continue <entry id> [--conversation <session id>]', flagNotAccepted: (action: string, key: string) => `baocut space ${action} non accetta --${key}`,
  rescanStarted: 'Nuova scansione avviata',
  rebuilt: (entries: number, pendingVideos: number) => `Catalogo ricostruito: ${entriesLabel(entries)}; l’indice dei contenuti sta rileggendo ${videosLabel(pendingVideos)} in background, quindi i risultati di ricerca sono incompleti fino al termine`,
  purgeBlocked: (id: string) => `${id} è ancora usato da un video o un’attività; non eliminato`, movedToTrash: (id: string, name: string) => `Spostato nel Cestino: ${id}  ${name}`, restoredFromTrash: (id: string, name: string) => `Ripristinato dal Cestino: ${id}  ${name}`, purged: (id: string) => `Eliminato definitivamente: ${id}`, notPurged: (id: string) => `Non eliminato ${id}: ha ancora riferimenti`,
  videoTrashed: (name: string, entryId: string, retentionDays: number | null) => `Video «${name}» spostato nel Cestino: ${entryId} (ripristina con baocut space restore ${entryId}${retentionDays === null ? '' : `; eliminato definitivamente dopo ${daysLabel(retentionDays)}`})`,
  relatedKept: (n: number) => pluralForm('it', n, { one: `${n} voce esportata o generata da esso rimane dov’è`, other: `${n} voci esportate o generate da esso rimangono dove sono` }),
  continued: (created: boolean, id: string, cwd: string) => `${created ? 'Sessione creata' : 'Sessione in uso'} ${id}  cartella di lavoro ${cwd}`,
  referenceNext: (name: string, id: string) => `Un riferimento alla voce «${name}» accompagnerà il prossimo messaggio: baocut chat "…" --conversation ${id}`,
};
