import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PlatformRuntime } from '../../../src/platform';
import { AD_WATCHDOG_HARD_MS, AD_WATCHDOG_QUIET_MS } from '../../../src/platform/adapters/yandex';
import type { PlatformAdResult } from '../../../src/platform';
import type { YandexRewardedAdCallbacks } from '../../../src/platform/adapters/yandex';
import { makeAds } from '../../ads/fixtures';
import { FakeGlobalEvents, flush, makeYandex } from './fixtures';
import type { YandexHarness } from './fixtures';

beforeEach(() => void vi.useFakeTimers({ now: Date.UTC(2026, 8, 17, 10) }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function ready(h: YandexHarness): Promise<void> {
  await h.platform.identity.ready();
  await flush();
}

/** Starts a show and hands back the pending result plus the SDK callbacks the fake captured. */
async function open(h: YandexHarness, type: 'inter' | 'rewarded', placement: string) {
  let result: PlatformAdResult | undefined;
  const promise = (type === 'inter' ? h.platform.ads.showInterstitial(placement) : h.platform.ads.showRewarded(placement)).then((r) => (result = r));
  await flush();
  return { promise, result: () => result };
}

const gameplayCalls = (h: YandexHarness): string[] => h.fake.calls.filter((call) => call.startsWith('GameplayAPI'));

// ---------------------------------------------------------------- interstitial

test('interstitial: onClose(true) → shown; onClose(false) / onError / onOffline → no_fill; the placement is echoed', async () => {
  const h = makeYandex();
  await ready(h);
  const outcomes: string[] = [];
  for (const end of ['close-shown', 'close-not-shown', 'error', 'offline'] as const) {
    const show = await open(h, 'inter', 'level_win_inter');
    expect(show.result()).toBeUndefined(); // nothing is answered before the SDK speaks
    h.fake.inter!.onOpen?.();
    if (end === 'close-shown') h.fake.inter!.onClose?.(true);
    if (end === 'close-not-shown') h.fake.inter!.onClose?.(false);
    if (end === 'error') h.fake.inter!.onError?.(new Error('adv_error'));
    if (end === 'offline') h.fake.inter!.onOffline?.();
    const result = await show.promise;
    expect(result).toMatchObject({ rewarded: false, placement: 'level_win_inter' });
    outcomes.push(result.status);
  }
  expect(outcomes).toEqual(['shown', 'no_fill', 'no_fill', 'no_fill']);
  expect(vi.getTimerCount()).toBe(0); // every watchdog was disarmed
});

test('interstitial: a synchronous SDK throw → error (resolved, not rejected); an SDK that never calls back → timeout after the hard 120 s', async () => {
  const h = makeYandex();
  await ready(h);
  h.fake.adThrows = true;
  const thrown = await h.platform.ads.showInterstitial('level_fail_inter');
  expect(thrown).toMatchObject({ status: 'error', rewarded: false, placement: 'level_fail_inter' });
  expect(String(thrown.raw)).toBe('Error: adv is busy');
  expect(vi.getTimerCount()).toBe(0);

  h.fake.adThrows = false;
  const silent = await open(h, 'inter', 'level_win_inter');
  await vi.advanceTimersByTimeAsync(AD_WATCHDOG_HARD_MS - 1);
  expect(silent.result()).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expect(silent.result()).toMatchObject({ status: 'timeout', rewarded: false });
  h.fake.inter!.onClose?.(true); // a late SDK answer is a no-op
  expect(silent.result()).toMatchObject({ status: 'timeout' });
});

test('watchdog: the player left through the ad and came back, the SDK stays silent for 2 s → the show is closed by the adapter', async () => {
  const h = makeYandex();
  await ready(h);
  const show = await open(h, 'inter', 'level_win_inter');
  expect(h.visibility.size).toBe(1);
  h.visibility.set(false); // the click took the player out of the tab
  await vi.advanceTimersByTimeAsync(60_000);
  expect(show.result()).toBeUndefined(); // hidden: no countdown
  h.visibility.set(true);
  await vi.advanceTimersByTimeAsync(AD_WATCHDOG_QUIET_MS - 1);
  expect(show.result()).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expect(show.result()).toMatchObject({ status: 'timeout' });
  expect([h.visibility.size, vi.getTimerCount()]).toEqual([0, 0]);

  // an SDK that does answer inside the 2 s wins
  const answered = await open(h, 'inter', 'level_win_inter');
  h.visibility.set(true);
  await vi.advanceTimersByTimeAsync(500);
  h.fake.inter!.onClose?.(true);
  expect(await answered.promise).toMatchObject({ status: 'shown' });
});

// ---------------------------------------------------------------- rewarded

test('rewarded success: onRewarded only RECORDS the reward — the game is answered when the video closes', async () => {
  const h = makeYandex();
  await ready(h);
  const show = await open(h, 'rewarded', 'ad_refill_hearts_rewarded');
  h.fake.rewarded!.onOpen?.();
  h.fake.rewarded!.onRewarded?.();
  await flush();
  expect(show.result()).toBeUndefined(); // the donor: answering here moved the game on UNDER the ad
  h.fake.rewarded!.onClose?.(true);
  expect(await show.promise).toEqual({ status: 'rewarded', rewarded: true, placement: 'ad_refill_hearts_rewarded' });
  expect(h.platform.ads.isRewardedAvailable()).toBe(true);
});

test('rewarded without a reward: a plain close → dismissed, never rewarded; the latch stays', async () => {
  const h = makeYandex();
  await ready(h);
  for (const wasShown of [true, undefined]) {
    const show = await open(h, 'rewarded', 'ad_extra_moves_rewarded');
    h.fake.rewarded!.onClose?.(wasShown);
    expect(await show.promise).toEqual({ status: 'dismissed', rewarded: false, placement: 'ad_extra_moves_rewarded' });
  }
  expect(h.platform.ads.isRewardedAvailable()).toBe(true);
});

test('rewarded SDK error and the availability latch: onError / onClose(false) → no_fill and the button is off until a recovery signal', async () => {
  const errored = makeYandex();
  await ready(errored);
  expect(errored.platform.ads.isRewardedAvailable()).toBe(true); // no isAvailable in the SDK: optimistic start
  const show = await open(errored, 'rewarded', 'ad_level_win_x2_rewarded');
  errored.fake.rewarded!.onRewarded?.();
  errored.fake.rewarded!.onError?.(new Error('no_ads'));
  const result = await show.promise;
  expect(result).toMatchObject({ status: 'no_fill', rewarded: false }); // 1:1 donor: an error answers no reward even after onRewarded
  expect(String(result.raw)).toBe('Error: no_ads');
  expect(errored.platform.ads.isRewardedAvailable()).toBe(false);
  // an interstitial outcome never touches the latch
  const inter = await open(errored, 'inter', 'level_win_inter');
  errored.fake.inter!.onClose?.(true);
  await inter.promise;
  expect(errored.platform.ads.isRewardedAvailable()).toBe(false);
  // ...but it is not off for the session any more (B17): the next reward the SDK confirms re-arms it
  const retried = await open(errored, 'rewarded', 'ad_level_win_x2_rewarded');
  errored.fake.rewarded!.onRewarded?.();
  errored.fake.rewarded!.onClose?.(true);
  expect(await retried.promise).toMatchObject({ status: 'rewarded', rewarded: true });
  expect(errored.platform.ads.isRewardedAvailable()).toBe(true);

  const notShown = makeYandex();
  await ready(notShown);
  const failed = await open(notShown, 'rewarded', 'ad_level_win_x2_rewarded');
  notShown.fake.rewarded!.onClose?.(false);
  expect(await failed.promise).toMatchObject({ status: 'no_fill', rewarded: false });
  expect(notShown.platform.ads.isRewardedAvailable()).toBe(false);

  // the watchdog closes a rewarded show too: with the reward recorded it IS rewarded, without — timeout
  const silent = makeYandex();
  await ready(silent);
  const kept = await open(silent, 'rewarded', 'ad_refill_hearts_rewarded');
  silent.fake.rewarded!.onRewarded?.();
  await vi.advanceTimersByTimeAsync(AD_WATCHDOG_HARD_MS);
  expect(kept.result()).toMatchObject({ status: 'rewarded', rewarded: true });
  const lost = await open(silent, 'rewarded', 'ad_refill_hearts_rewarded');
  await vi.advanceTimersByTimeAsync(AD_WATCHDOG_HARD_MS);
  expect(lost.result()).toMatchObject({ status: 'timeout', rewarded: false });
  expect(silent.platform.ads.isRewardedAvailable()).toBe(true);
});

// ---------------------------------------------------------------- rewarded availability recovery (B17)

/** Installs the fake global event target the adapter's default `online` seam subscribes to — BEFORE `makeYandex`. */
function stubGlobalEvents(): FakeGlobalEvents {
  const events = new FakeGlobalEvents();
  vi.stubGlobal('addEventListener', events.addEventListener);
  vi.stubGlobal('removeEventListener', events.removeEventListener);
  return events;
}

type RewardedEnd = (callbacks: YandexRewardedAdCallbacks) => void;

/** One whole rewarded show that ends the given way. */
async function rewardedShow(h: YandexHarness, end: RewardedEnd): Promise<PlatformAdResult> {
  const show = await open(h, 'rewarded', 'ad_level_win_x2_rewarded');
  end(h.fake.rewarded!);
  return show.promise;
}

const sdkError: RewardedEnd = (callbacks) => callbacks.onError?.(new Error('no_ads'));
const unshownClose: RewardedEnd = (callbacks) => callbacks.onClose?.(false);
const confirmed: RewardedEnd = (callbacks) => (callbacks.onRewarded?.(), callbacks.onClose?.(true));

test('B17 source: the adapter subscribes to `online` ONCE, when it is created — shows never add a listener', async () => {
  const events = stubGlobalEvents();
  const h = makeYandex();
  expect(events.count('online')).toBe(1); // at creation, before the SDK is even up
  await ready(h);
  for (const end of [sdkError, unshownClose, confirmed, sdkError]) await rewardedShow(h, end);
  expect(events.count('online')).toBe(1);
});

test('B17 case A: rewarded error → unavailable; the network comes back (`online`) → available again', async () => {
  const events = stubGlobalEvents();
  const h = makeYandex();
  await ready(h);
  expect(h.platform.ads.isRewardedAvailable()).toBe(true);
  for (const end of [sdkError, unshownClose]) {
    expect(await rewardedShow(h, end)).toMatchObject({ status: 'no_fill', rewarded: false });
    expect(h.platform.ads.isRewardedAvailable()).toBe(false);
    events.emit('online');
    expect(h.platform.ads.isRewardedAvailable()).toBe(true);
  }
});

test('B17 case B: after an error the next reward the SDK confirms (onRewarded) re-arms availability; a plain close does not', async () => {
  const h = makeYandex(); // no `online` source at all (Node): onRewarded alone recovers
  await ready(h);
  await rewardedShow(h, sdkError);
  expect(h.platform.ads.isRewardedAvailable()).toBe(false);
  // closed without the reward: proves nothing about availability (the donor re-arms on onRewarded only)
  expect(await rewardedShow(h, (callbacks) => callbacks.onClose?.(true))).toMatchObject({ status: 'dismissed', rewarded: false });
  expect(h.platform.ads.isRewardedAvailable()).toBe(false);
  // the host showed it anyway (the donor's retry button ignores the latch) and the SDK confirmed the reward
  const show = await open(h, 'rewarded', 'ad_level_win_x2_rewarded');
  h.fake.rewarded!.onRewarded?.();
  expect(h.platform.ads.isRewardedAvailable()).toBe(true); // at onRewarded, like the donor
  expect(show.result()).toBeUndefined(); // the answer still waits for the close
  h.fake.rewarded!.onClose?.(true);
  expect(await show.promise).toEqual({ status: 'rewarded', rewarded: true, placement: 'ad_level_win_x2_rewarded' });
  expect(h.platform.ads.isRewardedAvailable()).toBe(true);
});

test('B17 case C: errors in a row keep it unavailable; ONE recovery event re-arms it — `online` or onRewarded alike', async () => {
  const events = stubGlobalEvents();
  const h = makeYandex();
  await ready(h);
  const burst = async (): Promise<void> => {
    for (const end of [sdkError, unshownClose, sdkError]) {
      await rewardedShow(h, end);
      expect(h.platform.ads.isRewardedAvailable()).toBe(false);
    }
  };
  await burst();
  events.emit('online');
  expect(h.platform.ads.isRewardedAvailable()).toBe(true);
  await burst();
  expect(await rewardedShow(h, confirmed)).toMatchObject({ status: 'rewarded', rewarded: true });
  expect(h.platform.ads.isRewardedAvailable()).toBe(true);
});

test('B17 case D: `online` changes ONLY availability — no show, no reward, no SDK call; a show in flight ends on its own callbacks', async () => {
  const events = stubGlobalEvents();
  const h = makeYandex();
  await ready(h);
  await rewardedShow(h, sdkError);
  const before = { calls: h.fake.calls.length, diagnostics: h.diagnostics.length, hooks: h.hooks.length };
  events.emit('online');
  expect(h.platform.ads.isRewardedAvailable()).toBe(true);
  expect({ calls: h.fake.calls.length, diagnostics: h.diagnostics.length, hooks: h.hooks.length }).toEqual(before);
  expect(vi.getTimerCount()).toBe(0);

  // `online` during a show neither answers it nor turns it into a reward
  const show = await open(h, 'rewarded', 'ad_level_win_x2_rewarded');
  events.emit('online');
  await flush();
  expect(show.result()).toBeUndefined();
  h.fake.rewarded!.onClose?.(true);
  expect(await show.promise).toEqual({ status: 'dismissed', rewarded: false, placement: 'ad_level_win_x2_rewarded' });
  // availability follows the LAST signal: an error after the `online` switches it off again
  const failed = await open(h, 'rewarded', 'ad_level_win_x2_rewarded');
  events.emit('online');
  h.fake.rewarded!.onError?.(new Error('no_ads'));
  expect(await failed.promise).toMatchObject({ status: 'no_fill', rewarded: false });
  expect(h.platform.ads.isRewardedAvailable()).toBe(false);
});

test('B17: repeated `online` is idempotent — still one listener, available stays true, nothing else happens', async () => {
  const events = stubGlobalEvents();
  const h = makeYandex();
  await ready(h);
  events.emit('online'); // already available: nothing to change
  expect(h.platform.ads.isRewardedAvailable()).toBe(true);
  await rewardedShow(h, sdkError);
  const calls = h.fake.calls.length;
  for (let i = 0; i < 3; i++) {
    events.emit('online');
    expect(h.platform.ads.isRewardedAvailable()).toBe(true);
  }
  expect([events.count('online'), h.fake.calls.length, vi.getTimerCount()]).toEqual([1, calls, 0]);
});

test('B17 lifecycle: dispose() removes the listener — a later `online` no longer mutates the adapter; each adapter owns its own', async () => {
  const events = stubGlobalEvents();
  const kept = makeYandex();
  const disposed = makeYandex();
  expect(events.count('online')).toBe(2);
  for (const h of [kept, disposed]) {
    await ready(h);
    await rewardedShow(h, sdkError);
  }
  disposed.platform.dispose();
  expect(events.count('online')).toBe(1);
  disposed.platform.dispose(); // a second dispose is a no-op
  expect(events.count('online')).toBe(1);
  events.emit('online');
  expect([kept.platform.ads.isRewardedAvailable(), disposed.platform.ads.isRewardedAvailable()]).toEqual([true, false]);
  kept.platform.dispose();
  expect(events.count('online')).toBe(0);
});

test('B17 in Node (no global event target): created and disposed without a listener or a throw; an error simply stays until onRewarded', async () => {
  expect((globalThis as { addEventListener?: unknown }).addEventListener).toBeUndefined();
  const h = makeYandex();
  await ready(h);
  await rewardedShow(h, sdkError);
  expect(h.platform.ads.isRewardedAvailable()).toBe(false);
  expect(() => h.platform.dispose()).not.toThrow();
});

test('B17: interstitial outcomes never touch rewarded availability, in either direction', async () => {
  const events = stubGlobalEvents();
  const h = makeYandex();
  await ready(h);
  const inter = async (end: 'shown' | 'not-shown' | 'error' | 'offline'): Promise<void> => {
    const show = await open(h, 'inter', 'level_win_inter');
    if (end === 'shown') h.fake.inter!.onClose?.(true);
    if (end === 'not-shown') h.fake.inter!.onClose?.(false);
    if (end === 'error') h.fake.inter!.onError?.(new Error('adv_error'));
    if (end === 'offline') h.fake.inter!.onOffline?.();
    await show.promise;
  };
  for (const end of ['not-shown', 'error', 'offline'] as const) await inter(end);
  expect(h.platform.ads.isRewardedAvailable()).toBe(true); // an inter failure never disarms rewarded
  await rewardedShow(h, sdkError);
  await inter('shown');
  expect(h.platform.ads.isRewardedAvailable()).toBe(false); // a working inter never re-arms it
  events.emit('online');
  expect(h.platform.ads.isRewardedAvailable()).toBe(true);
});

// ---------------------------------------------------------------- audio / gameplay around the ad

test('around every show: audio is paused BEFORE the SDK call and resumed in finally; gameplay is stopped and restarted ONLY if it ran before', async () => {
  const h = makeYandex();
  await ready(h);
  await h.platform.gameplay.ready(); // production: gameplay is running from here
  h.fake.calls.length = 0;

  const show = await open(h, 'inter', 'level_win_inter');
  expect(h.hooks).toEqual(['adShowing:true', 'pauseAudio']);
  expect(h.fake.calls).toEqual(['GameplayAPI.stop', 'showFullscreenAdv']);
  h.fake.inter!.onOpen?.();
  h.fake.inter!.onClose?.(true);
  await show.promise;
  expect(h.hooks).toEqual(['adShowing:true', 'pauseAudio', 'pauseAudio', 'adShowing:false', 'resumeAudio']);
  expect(gameplayCalls(h)).toEqual(['GameplayAPI.stop', 'GameplayAPI.start']);

  // the donor bug of 08.09: an inter on level exit must NOT switch gameplay back on in the menu
  h.platform.gameplay.stop();
  h.fake.calls.length = 0;
  const inMenu = await open(h, 'rewarded', 'ad_refill_hearts_rewarded');
  h.fake.rewarded!.onClose?.(true);
  await inMenu.promise;
  expect(gameplayCalls(h)).toEqual(['GameplayAPI.stop']);
});

test('finally holds after a synchronous SDK throw and with throwing hooks: audio resumed, the ad flag cleared, gameplay restored', async () => {
  const hooks: string[] = [];
  const h = makeYandex(undefined, {
    hooks: {
      pauseAudio: () => {
        hooks.push('pauseAudio');
        throw new Error('audio context is gone');
      },
      resumeAudio: () => void hooks.push('resumeAudio'),
      setAdShowing: (showing) => void hooks.push(`adShowing:${showing}`)
    }
  });
  await ready(h);
  h.platform.gameplay.start();
  h.fake.adThrows = true;
  h.fake.calls.length = 0;
  for (const result of [await h.platform.ads.showInterstitial('x_inter'), await h.platform.ads.showRewarded('x_rewarded')]) {
    expect(result).toMatchObject({ status: 'error', rewarded: false });
  }
  expect(hooks).toEqual(['adShowing:true', 'pauseAudio', 'adShowing:false', 'resumeAudio', 'adShowing:true', 'pauseAudio', 'adShowing:false', 'resumeAudio']);
  expect(gameplayCalls(h)).toEqual(['GameplayAPI.stop', 'GameplayAPI.start', 'GameplayAPI.stop', 'GameplayAPI.start']);
  expect(h.diagnostics.filter((code) => code === 'hook_threw')).toHaveLength(2);
  expect(h.platform.ads.isRewardedAvailable()).toBe(true); // a throw is not "unavailable"
});

// ---------------------------------------------------------------- AdsRuntime host flow

test('AdsRuntime host flow: AdsRuntime decides, the Yandex platform shows, the HOST registers only a confirmed show — the adapter never does', async () => {
  const events = stubGlobalEvents();
  const h = makeYandex();
  const platform = new PlatformRuntime(h.platform);
  await platform.ready();
  await flush();
  const host = makeAds({ level: 20 });
  let rewards = 0;

  const showInter = async (placement: string, end: (h: YandexHarness) => void): Promise<string> => {
    if (!host.ads.decide(placement, 'inter').allowed) return 'denied';
    const pending = platform.ads!.showInterstitial(placement);
    await flush();
    end(h);
    const result = await pending;
    if (result.status === 'shown') host.ads.registerShown(placement);
    return result.status;
  };
  const showRewarded = async (placement: string, end: (h: YandexHarness) => void): Promise<string> => {
    if (!host.ads.decide(placement, 'rewarded').allowed || !platform.ads!.isRewardedAvailable()) return 'hidden';
    const pending = platform.ads!.showRewarded(placement);
    await flush();
    end(h);
    const result = await pending;
    if (result.rewarded) {
      rewards += 1;
      host.ads.registerShown(placement);
    }
    return result.status;
  };

  expect(await showInter('level_win_inter', (y) => y.fake.inter!.onClose?.(false))).toBe('no_fill');
  expect(host.ads.getStats().shown).toBe(0); // nothing played: no cooldown armed, no limit spent
  expect(await showInter('level_win_inter', (y) => y.fake.inter!.onClose?.(true))).toBe('shown');
  expect(await showInter('level_win_inter', () => {})).toBe('denied');
  expect(host.ads.decide('level_win_inter').reason).toBe('inter_cooldown');

  expect(await showRewarded('ad_refill_hearts_rewarded', (y) => y.fake.rewarded!.onClose?.(true))).toBe('dismissed');
  expect(rewards).toBe(0);
  expect(await showRewarded('ad_refill_hearts_rewarded', (y) => (y.fake.rewarded!.onRewarded?.(), y.fake.rewarded!.onClose?.(true)))).toBe('rewarded');
  expect([rewards, host.ads.getStats().shown]).toEqual([1, 2]);
  expect(await showRewarded('ad_refill_hearts_rewarded', (y) => y.fake.rewarded!.onError?.('no ads'))).toBe('no_fill');
  expect(await showRewarded('ad_refill_hearts_rewarded', () => {})).toBe('hidden'); // the latch hides the button
  expect(h.fake.count('showRewardedVideo')).toBe(3);
  // B17: the network is back — the button is offered again, and that alone grants and registers nothing
  events.emit('online');
  expect(platform.ads!.isRewardedAvailable()).toBe(true);
  expect([rewards, host.ads.getStats().shown, h.fake.count('showRewardedVideo')]).toEqual([1, 2, 3]);
  // the reward still comes only from a show the SDK confirmed
  expect(await showRewarded('ad_refill_hearts_rewarded', (y) => (y.fake.rewarded!.onRewarded?.(), y.fake.rewarded!.onClose?.(true)))).toBe('rewarded');
  expect([rewards, host.ads.getStats().shown]).toEqual([2, 3]);
});
