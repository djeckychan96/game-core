// Yandex Games QA bootstrap of the Ready UI gallery — packaging only, copied next to index.html by
// `node scripts/build-ui-gallery-static.mjs --yandex` (which fills in GALLERY). Not Core, not the gallery: the gallery
// bundle is the same file as in the gallery-only zip. Nothing else of the SDK is used — no ads, payments, storage,
// player/authorization or GameplayAPI (the gallery has no gameplay).
//
// Order (requirements 1.19.1, 2.14, 1.19.2):
//   <script src="/sdk.js"> in <head> → YaGames.init() → language from environment.i18n.lang (unless the URL picks one
//   with ?locale=, i.e. the gallery's own EN/RU control) → the gallery module (Pixi up, Ready UI assets loaded, the
//   screen open: its import resolves only once its top-level awaits are done) → LoadingAPI.ready().
// Without the SDK (a local static server has no /sdk.js) the gallery runs as is: local QA mode, no ready() to send.
const GALLERY = '__GALLERY_ENTRY__';

const qa = (window.__yandexQa = { mode: 'starting', lang: null, steps: [] });
let ysdk = null;
if (typeof window.YaGames?.init === 'function') {
  try {
    ysdk = await window.YaGames.init();
    qa.steps.push('init');
    console.info('[YandexQA] SDK initialized');
  } catch (error) {
    console.error('[YandexQA] YaGames.init() failed — local QA mode', error);
  }
} else {
  console.info('[YandexQA] Yandex SDK not available (/sdk.js) — local QA mode');
}
qa.mode = ysdk ? 'yandex' : 'local';

if (ysdk) {
  // the gallery reads its locale from ?locale= (createShowcaseLocalization): the platform's language goes there
  const lang = ysdk.environment?.i18n?.lang;
  qa.lang = lang ?? null;
  qa.steps.push('lang');
  const params = new URLSearchParams(location.search);
  if (!params.has('locale')) {
    params.set('locale', lang === 'ru' ? 'ru' : 'en');
    try {
      history.replaceState(history.state, '', `${location.pathname}?${params}${location.hash}`);
    } catch (error) {
      console.warn('[YandexQA] could not apply the platform language', error);
    }
  }
}

let started = false;
try {
  await import(GALLERY);
  if (window.__gallery?.ready !== true) throw new Error('the gallery module finished without its ready handle');
  started = true;
  qa.steps.push('gallery');
} catch (error) {
  qa.mode = 'failed';
  console.error('[YandexQA] the gallery failed to start — LoadingAPI.ready() not sent', error);
}

if (ysdk && started) {
  ysdk.features?.LoadingAPI?.ready();
  qa.steps.push('ready');
  console.info('[YandexQA] LoadingAPI.ready sent');
}
