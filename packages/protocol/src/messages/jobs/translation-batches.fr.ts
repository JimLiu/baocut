import type { JobsTranslationBatchesMessages } from './translation-batches.ts';

export const fr: JobsTranslationBatchesMessages = {
  glossaryItemInvalid: "Chaque élément de glossary doit avoir source et target non vides",
  glossaryNoteInvalid: "La note dans glossary doit être une chaîne",
  glossariesItemInvalid: "Chaque élément de glossaries doit avoir un identifiant de glossaire",
  glossariesUnknownFields: (p: { fields: string }) => `Les éléments de glossaries ont des champs inconnus : ${p.fields}`,
  glossariesVersionInvalid: "La version dans glossaries doit être un entier positif",
  cannotFreezeGlossaries: "Ce Runtime ne peut pas figer le contenu des glossaires",
  artifactGone: (p: { artifactId: string }) => `Le résultat ${p.artifactId} n’existe plus`,
  batchFailedSentences: (p: { first: number; last: number; retries: number }) =>
    `La traduction des phrases ${p.first}–${p.last} ne correspond toujours pas au format attendu après ${p.retries} nouvelles tentatives`,
  batchFailedCues: (p: { first: number; last: number; retries: number }) =>
    `La traduction des sous-titres ${p.first}–${p.last} ne correspond toujours pas au format attendu après ${p.retries} nouvelles tentatives`,
  outputNoTranslations: "La sortie ne contient aucune traduction",
  outputCountMismatch: (p: { output: number; input: number }) => `La sortie contient ${p.output} éléments ; l’entrée contient ${p.input} phrases`,
  outputIncompleteItem: "La sortie contient des éléments sans id ou translation",
  outputDuplicateId: (p: { id: string }) => `${p.id} apparaît deux fois dans la sortie`,
  outputMissingIds: (p: { ids: string }) => `Il manque à la sortie ${p.ids}`,
};
