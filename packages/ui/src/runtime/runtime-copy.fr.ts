import type { RuntimeMessages } from './runtime-copy.ts';

export const fr: RuntimeMessages = {
  missingContext: 'RuntimeContext est manquant', mediaStatus: (status) => `Le service multimédia a renvoyé ${status}`, noRootSequence: 'La nouvelle vidéo n’a pas de séquence principale',
  edit: { importAssets: 'Importer des médias', setBackground: 'Définir l’arrière-plan', addWaveform: 'Ajouter une forme d’onde' },
  waveformName: 'Forme d’onde', noDuration: 'La vidéo n’a pas encore de durée ; la forme d’onde n’a donc pas été ajoutée', noOpenVideo: 'Aucune vidéo ouverte', notCaughtUp: 'La vidéo n’est pas encore à jour et ne peut pas être modifiée pour le moment',
};
