import type { TranscribeSetupMessages } from './transcribe-setup-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const fr: TranscribeSetupMessages = {
  notConnected: 'Non connecté', unavailable: 'Indisponible', autoDetect: 'Détecter automatiquement',
  hintNoModel: 'Le modèle de reconnaissance vocale utilisé n’est pas encore connu. Choisissez-en un ci-dessus pour savoir s’il accepte les indications de reconnaissance.',
  hintUnsupported: (model, alt) => `${model} n’accepte pas les indications de reconnaissance ; les glossaires et l’invite ne peuvent donc pas être utilisés à cette étape et seront ignorés pendant la transcription.${alt ? ` Pour les utiliser pendant la transcription, choisissez ${alt}.` : ''}`,
  budget: (model, b, max) => {
    const custom = b.custom ? `invite de ${b.custom} caractères` : 'sans invite';
    const dropped = b.dropped ? ` · ${b.dropped} autres termes ne tiennent pas ; les glossaires listés en premier sont ajoutés en priorité` : '';
    return `Envoyé à ${model} : ${custom} + ${b.terms} ${pluralForm('fr', b.terms, { one: 'terme', other: 'termes' })} · environ ${b.chars} / ${max} caractères${dropped}`;
  },
  glossaryGone: 'Absent de la bibliothèque de glossaires · non utilisé cette fois', glossaryTranslation: 'Glossaire de traduction ; non utilisé pour la transcription · non utilisé cette fois',
  anyLanguage: 'Toutes les langues', termCount: (count) => `${count} ${pluralForm('fr', count, { one: 'terme', other: 'termes' })}`,
  noDefaultModel: 'Aucun modèle vocal par défaut', defaultModel: (label) => `${label} (par défaut)`, autoDetectLanguage: 'Détecter la langue automatiquement',
  glossaries: (count) => `${count} ${pluralForm('fr', count, { one: 'glossaire', other: 'glossaires' })}`, hasPrompt: 'Avec invite',
  noDefaultFacts: 'Aucun modèle vocal par défaut. Choisissez-en un ou définissez-en un par défaut dans Modèles. Si vous démarrez sans en choisir, les éléments manquants vous seront indiqués.',
  modelUnusable: 'Ce modèle est indisponible pour le moment', acceptsHint: 'Accepte les indications de reconnaissance', noHint: 'Sans indications de reconnaissance',
  followDefault: (facts) => `Utilise la valeur par défaut · ${facts}`,
};
