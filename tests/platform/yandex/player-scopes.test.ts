// `getPlayer({ scopes: false })` — SoliPix production (`game.js`: `ysdk.getPlayer({ scopes: false })`): the player
// object and the cloud without the personal-data permission dialog. The boot call and every guest-mode retry
// must ask for the same thing.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PlatformRuntime } from '../../../src/platform';
import { YANDEX_TIMEOUTS } from '../../../src/platform/adapters/yandex';
import { flush, makeYandex } from './fixtures';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('default: the boot getPlayer is called with { scopes: false }', async () => {
  const h = makeYandex();
  await new PlatformRuntime(h.platform).ready();
  await flush();
  expect(h.fake.playerRequests).toEqual([{ scopes: false }]);
  expect(h.platform.identity.playerId()).toBe('ya-player-1');
});

test('guest mode: every background retry uses the same { scopes: false }; the retry schedule is unchanged (5 × 15 s)', async () => {
  const h = makeYandex((fake) => (fake.playerMode = 'fail'));
  await new PlatformRuntime(h.platform).ready();
  await flush();
  await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.playerRetryEvery * 10);
  expect(h.fake.count('getPlayer')).toBe(6); // 1 + 5 attempts, as before
  expect(h.fake.playerRequests).toEqual(Array.from({ length: 6 }, () => ({ scopes: false })));
});

test('playerScopes: true is an explicit opt-in for a game that shows the name / avatar — boot and retries alike', async () => {
  const h = makeYandex((fake) => (fake.playerMode = 'fail'), { playerScopes: true });
  await new PlatformRuntime(h.platform).ready();
  await flush();
  await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.playerRetryEvery);
  expect(h.fake.playerRequests).toEqual([{ scopes: true }, { scopes: true }]);
});
