import type { ToolsTranscodeMessages } from './tools-transcode-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const fr: ToolsTranscodeMessages = {
  quality: { smaller: { name: 'Plus petit', sub: 'Suffisant pour la messagerie et le stockage cloud' }, balanced: { name: 'Équilibré', sub: 'Différence difficile à percevoir' }, high: { name: 'Haute qualité', sub: 'À conserver pour un montage ultérieur' } },
  heightOriginal: 'Originale', heightOriginalLong: 'Résolution originale', codecSub: { h264: 'Compatible partout', hevc: '40 % plus petit à qualité égale ; les anciens appareils peuvent ne pas le lire' },
  notVideoFiles: (names) => `${names.join(', ')} ${pluralForm('fr', names.length, { one: 'n’est pas un fichier vidéo', other: 'ne sont pas des fichiers vidéo' })}`,
  notAbsolute: (paths) => `${paths.join(', ')} ${pluralForm('fr', paths.length, { one: 'n’est pas un chemin absolu', other: 'ne sont pas des chemins absolus' })}`,
  alreadyListed: (names) => `${names.join(', ')} ${pluralForm('fr', names.length, { one: 'est déjà dans la liste', other: 'sont déjà dans la liste' })}`,
  overflow: (limit, extra) => `${limit} fichiers maximum à la fois ; ${extra} ${pluralForm('fr', extra, { one: 'autre fichier n’a pas été ajouté', other: 'autres fichiers n’ont pas été ajoutés' })}`,
  joinNotices: (bits) => bits.join(' ; '), needTwoVideos: 'Ajoutez au moins deux vidéos', needMediaFile: 'Choisissez d’abord un fichier vidéo ou audio',
  needVideoFile: 'Choisissez d’abord un fichier vidéo', needOneMore: 'La fusion nécessite au moins deux vidéos ; ajoutez-en une autre', tooManyFiles: (limit) => `${limit} fichiers maximum à la fois`,
  videoKbpsRange: (min, max) => `Le débit vidéo doit être compris entre ${min} et ${max} kbps`, audioKbpsRange: (min, max) => `Le débit audio doit être compris entre ${min} et ${max} kbps`,
  outDirAbsolute: 'Le dossier de sortie doit être un chemin absolu', ffmpegUnusable: (message) => `ffmpeg est indisponible : ${message}`, audioKbps: (kbps) => `Audio ${kbps} kbps`,
  ffmpegNeeded: 'Installez d’abord ffmpeg', ffmpegInstallHint: 'Installez ffmpeg ou définissez son chemin avec BAOCUT_FFMPEG', ffmpegReady: (version) => `ffmpeg${version} est prêt`,
  ffmpegOutdated: (version) => `ffmpeg${version} est trop ancien`, ffmpegCannotRun: 'Impossible d’exécuter ffmpeg',
  filesTitle: (first, count) => `${first} et ${count - 1} ${pluralForm('fr', count - 1, { one: 'autre', other: 'autres' })}`, defaultTitle: 'Conversion de fichiers', mergeTitle: (first, more) => `${first} + ${more} ${pluralForm('fr', more, { one: 'autre', other: 'autres' })}`,
  qualityWithCrf: (name, crf) => `${name} (CRF ${crf})`, mergeStreamCopy: (n) => `Fusionner ${n} ${pluralForm('fr', n, { one: 'clip', other: 'clips' })} · Copie des flux`,
  extractAudioMany: (n) => `Extraire l’audio de ${n} ${pluralForm('fr', n, { one: 'fichier', other: 'fichiers' })}`, extractAudio: 'Extraire l’audio',
  mergeClips: (n) => `Fusionner ${n} ${pluralForm('fr', n, { one: 'clip', other: 'clips' })}`, compressMany: (n) => `Compresser ${n} ${pluralForm('fr', n, { one: 'fichier', other: 'fichiers' })}`, compress: 'Compresser',
  stepQueued: (step, detail) => `${step} · ${detail ?? 'En file d’attente'}`, stepOf: (step, cur, total) => `${step} · Étape ${cur} sur ${total}`, noAudioTrack: 'Sans audio',
  mergedSize: (after, before) => `${after} (total des sources ${before})`, savedSize: (before, after, saved) => `${before} → ${after} (${saved === null ? 'pas plus petit' : saved === 0 ? 'à peu près identique' : `${saved} % plus petit`})`,
  streamCopyLine: 'Tous les clips correspondent : flux copiés sans réencodage, qualité inchangée', reencodeLine: (reason) => reason ? `Réencodé : ${reason}` : 'Réencodé',
  underASecond: 'Moins d’une seconde', took: (duration) => `Durée : ${duration}`, stateQueued: 'En file d’attente', stateProcessing: 'En cours',
  remedyThenRetry: (remedy) => `${remedy}, puis réessayez`,
  inputUnreadable: 'Impossible de lire une image dans ce fichier. Vérifiez qu’il se lit dans un lecteur multimédia ou choisissez un autre fichier',
  transcodeFailed: 'ffmpeg a échoué en cours d’exécution ; sa sortie originale est ci-dessous. Si le disque est plein, libérez de l’espace ; si un fichier source a été déplacé, sélectionnez-le à nouveau',
  validationFailed: 'La sortie n’a pas passé la validation et a été supprimée ; rien n’a donc été écrit dans le dossier de sortie. Réessayez ou modifiez les réglages',
};
