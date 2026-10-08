const andList = (items: readonly string[]) => new Intl.ListFormat('ru', { style: 'long', type: 'conjunction' }).format(items);
import type { LinkCookiesMessages } from './link-cookies.ts';

export const ru: LinkCookiesMessages = {
  noneChecked: "Оставьте все флажки снятыми для анонимного скачивания. Если сайт требует вход или проверку, сначала войдите в браузере, затем отметьте этот браузер.",
  oneChecked: (name: string) => `Использует ${name} — cookie для доступа к сайту.`,
  manyChecked: (names: readonly string[]) => `Пробует ${names.join(" → ")} в этом порядке: если cookie браузера не читаются или сайт всё ещё требует вход, переходит к следующему и останавливается на первом работающем. В результате указан использованный браузер.`,
  privacy: "Читаются только отмеченные браузеры. yt-dlp читает cookie на этом компьютере и использует только для доступа к сайту; BaoCut запоминает только имена браузеров, но никогда cookie.",
  keychain: (names: readonly string[]) => `macOS один раз запросит доступ к Связке ключей для ${names.length > 1 ? `каждого из ${andList(names)}` : names[0]}. Выберите «Всегда разрешать», чтобы больше не спрашивать.`,
  safariAccess: "Для чтения cookie Safari разрешите BaoCut в Системные настройки › Конфиденциальность и безопасность › Полный доступ к диску.",
  chromiumLocked: (names: readonly string[]) => names.length > 1
      ? `Когда ${andList(names)} открыты, их базы cookie заблокированы и не читаются. Полностью закройте браузеры перед скачиванием, включая работающие в фоне.`
      : `Когда ${names[0]} открыт, база cookie заблокирована и не читается. Полностью закройте браузер перед скачиванием, даже если он работает в фоне.`,
  appBound: (names: readonly string[]) => `В Windows ${andList(names)} обычно ${names.length > 1 ? "защищают" : "защищает"} cookie с помощью App-Bound Encryption, из-за чего yt-dlp может не прочитать их даже после закрытия браузера.`,
  firefoxTip: " Если нужен вход, войдите на сайте через Firefox и отметьте Firefox.",
  noBrowsers: "Cookie браузеров на этом компьютере не найдены, доступно только анонимное скачивание. Войдите на сайте через браузер и нажмите «Определить браузеры снова».",
  used: (name: string) => `Использованы ${name} — cookie`,
};
