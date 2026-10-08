import type { ToolUpdateMessages } from './tool-update.ts';

export const fr: ToolUpdateMessages = {
  standalone: 'Binaire autonome officiel', updateInTerminal: 'Mettre à jour dans le terminal',
  unknownInstall: 'Impossible de déterminer comment yt-dlp a été installé. Exécutez la commande correspondant à votre installation, puis cliquez sur « Vérifier à nouveau ».',
  cannotRun: 'BaoCut ne peut pas exécuter cette commande pour vous.', thenRecheck: 'Cliquez ensuite sur « Vérifier à nouveau ».',
  runThenRecheck: 'Exécutez cette commande dans le terminal, puis cliquez sur « Vérifier à nouveau ».', updateWith: (method) => `Mettre à jour avec ${method}`,
  stoppedTitle: 'Mise à jour arrêtée', stoppedBody: 'La commande a peut-être été exécutée en partie seulement. Vérifiez la sortie ci-dessous, puis cliquez sur « Vérifier à nouveau » pour confirmer la version actuelle de yt-dlp.',
  failedTitle: (exitCode) => exitCode === null ? 'Mise à jour non terminée' : `Mise à jour non terminée (code de sortie ${exitCode})`,
  failedBody: (error) => `${error ? `${error.replace(/[。.]$/, '')}. ` : ''}Votre yt-dlp existant est inchangé. La sortie est ci-dessous ; vous pouvez aussi copier la commande, l’exécuter dans le terminal, puis cliquer sur « Vérifier à nouveau ».`,
  updatedTo: (version) => `Mis à jour vers ${version}`, upToDate: (version) => version ? `Déjà à jour (${version})` : 'Déjà à jour',
  logTruncated: '… (sortie précédente omise ; la sortie complète se trouve dans le journal de la tâche)\n', logStopped: '(Arrêté)', logExitCode: (exitCode) => `(Code de sortie ${exitCode})`,
};
