import type { RcSchedulesMessages } from './rc-schedules.ts';

export const nl: RcSchedulesMessages = {
  notFound: (p) => `Geplande taak niet gevonden: ${p.id}`,
  conversationNotFound: (p) => `Sessie niet gevonden: ${p.id}`,
  conversationArchived: 'Deze sessie is gearchiveerd. Herstel haar via Gearchiveerde sessies voordat je haar plant.',
  noProject: 'Deze sessie hoort niet bij een project en kan dus niet elke keer een nieuwe sessie in een project openen.',
  invalid: 'Controleer de geplande taak: het bericht, de frequentie en het maximum aantal keer moeten geldig zijn.',
  notActive: 'Alleen een actieve geplande taak kan nu worden uitgevoerd.',
  resumeArchived:
    'De doelsessie is gearchiveerd. Herstel haar via Gearchiveerde sessies, of bewerk de geplande taak zodat die elke keer een nieuwe sessie opent.',
  resumeDeleted: 'De doelsessie is verwijderd. Bewerk de geplande taak zodat die elke keer een nieuwe sessie opent.',
  resumeProjectRemoved: 'Het project is uit BaoCut verwijderd, dus er kan geen nieuwe sessie in worden geopend.',
  resumeCompleted: 'Het maximum aantal keer is bereikt. Verhoog eerst het maximum.',
  runStopped: 'Gestopt voordat het klaar was',
};
