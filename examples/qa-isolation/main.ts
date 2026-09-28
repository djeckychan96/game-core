// A minimal game host built twice by `npm run qa:isolation`: once as a QA build (__QA_BUILD__ = true) and once as
// the production build (false). The QA code is reachable ONLY through this compile-time branch, so the production
// bundle has no QA module, no `GameCoreQA` global and no QA command — nothing to find, nothing to switch on.
declare const __QA_BUILD__: boolean;

let score = 0;
const app = document.getElementById('app')!;
app.textContent = 'game running';

if (__QA_BUILD__) {
  void import('game-core/qa').then(({ installGameCoreQA }) => {
    const qa = installGameCoreQA({ game: { name: 'isolation host' } });
    qa.register({ kind: 'number', id: 'score', label: 'Score', get: () => score, set: (value) => { score = value; } });
    qa.markReady();
  });
}
