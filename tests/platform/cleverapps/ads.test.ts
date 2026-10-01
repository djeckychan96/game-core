import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { AD_WATCHDOG_HARD_MS } from '../../../src/platform/adapters/cleverapps';
import type { PlatformAdResult } from '../../../src/platform';
import { flush, makeCleverApps } from './fixtures';
import type { CleverAppsHarness } from './fixtures';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function ready(h: CleverAppsHarness): Promise<void> {
  await h.platform.identity.ready();
  await flush();
}

async function open(h: CleverAppsHarness, type: 'rewarded' | 'interstitial', placement = 'placement') {
  let result: PlatformAdResult | undefined;
  const promise = (type === 'rewarded' ? h.platform.ads.showRewarded(placement) : h.platform.ads.showInterstitial(placement)).then(
    (value) => (result = value)
  );
  await flush();
  return { promise, result: () => result };
}

test('event router registers each Connector listener once and never per show', async () => {
  const h = makeCleverApps();
  await ready(h);
  expect(h.fake.calls.filter((call) => call.startsWith('ads.on:'))).toEqual([
    'ads.on:rewarded:reward',
    'ads.on:rewarded:close',
    'ads.on:interstitial:close'
  ]);
  const first = await open(h, 'rewarded');
  h.fake.emit('rewarded:reward');
  h.fake.emit('rewarded:close', true);
  await first.promise;
  const second = await open(h, 'interstitial');
  h.fake.emit('interstitial:close', true);
  await second.promise;
  expect(h.fake.count('ads.on:')).toBe(3);
});

test('rewarded grants exactly once only on rewarded:reward; Promise true and close(true) never grant', async () => {
  const h = makeCleverApps();
  await ready(h);
  const show = await open(h, 'rewarded', 'continue_rewarded');
  expect(show.result()).toBeUndefined();
  h.fake.emit('rewarded:reward');
  h.fake.emit('rewarded:reward');
  h.fake.emit('rewarded:close', true);
  expect(await show.promise).toEqual({ status: 'rewarded', rewarded: true, placement: 'continue_rewarded' });
  expect(vi.getTimerCount()).toBe(0);

  const closed = await open(h, 'rewarded', 'continue_rewarded');
  h.fake.emit('rewarded:close', true);
  await flush();
  expect(await closed.promise).toEqual({ status: 'dismissed', rewarded: false, placement: 'continue_rewarded', raw: true });
});

test('rewarded supports reward→close and close→reward ordering without a double callback', async () => {
  const h = makeCleverApps();
  await ready(h);
  const order: string[] = [];
  const rewardFirst = await open(h, 'rewarded', 'reward_first');
  rewardFirst.promise.then(() => order.push('reward_first'));
  h.fake.emit('rewarded:reward');
  h.fake.emit('rewarded:close', true);
  expect(await rewardFirst.promise).toMatchObject({ status: 'rewarded', rewarded: true });

  const closeFirst = await open(h, 'rewarded', 'close_first');
  closeFirst.promise.then(() => order.push('close_first'));
  h.fake.emit('rewarded:close', true);
  h.fake.emit('rewarded:reward');
  expect(await closeFirst.promise).toMatchObject({ status: 'rewarded', rewarded: true });
  await flush();
  expect(order).toEqual(['reward_first', 'close_first']);
});

test('reward records but keeps the request active until close, so a late close cannot correlate to a second show', async () => {
  const h = makeCleverApps();
  await ready(h);
  const first = await open(h, 'rewarded', 'first');
  h.fake.emit('rewarded:reward');
  await flush();
  expect(first.result()).toBeUndefined();
  const second = await h.platform.ads.showRewarded('second');
  expect(second).toMatchObject({ status: 'error', rewarded: false, placement: 'second' });
  expect(String(second.raw)).toContain('cleverapps_rewarded_busy');
  h.fake.emit('rewarded:close', true);
  expect(await first.promise).toMatchObject({ status: 'rewarded', rewarded: true, placement: 'first' });
});

test('rewarded maps unsupported/unavailable and Connector false to no_fill, reject to error', async () => {
  for (const field of ['rewardedSupported', 'rewardedAvailable'] as const) {
    const h = makeCleverApps((fake) => (fake[field] = false));
    await ready(h);
    expect(await h.platform.ads.showRewarded('rewarded')).toMatchObject({ status: 'no_fill', rewarded: false });
    expect(h.fake.count('ads.showRewardedVideo')).toBe(0);
  }

  const refused = makeCleverApps((fake) => (fake.rewardedShowMode = 'false'));
  await ready(refused);
  expect(await refused.platform.ads.showRewarded('rewarded')).toMatchObject({ status: 'no_fill', rewarded: false });

  const rejected = makeCleverApps((fake) => (fake.rewardedShowMode = 'fail'));
  await ready(rejected);
  const error = await rejected.platform.ads.showRewarded('rewarded');
  expect(error).toMatchObject({ status: 'error', rewarded: false });
  expect(String(error.raw)).toBe('Error: rewarded_down');
});

test('rewarded watchdog resolves a silent show as timeout and ignores late events', async () => {
  const h = makeCleverApps((fake) => (fake.rewardedShowMode = 'hang'));
  await ready(h);
  const show = await open(h, 'rewarded', 'silent_rewarded');
  await vi.advanceTimersByTimeAsync(AD_WATCHDOG_HARD_MS - 1);
  expect(show.result()).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expect(await show.promise).toEqual({ status: 'timeout', rewarded: false, placement: 'silent_rewarded' });
  h.fake.emit('rewarded:reward');
  expect(show.result()).toEqual({ status: 'timeout', rewarded: false, placement: 'silent_rewarded' });
  expect(vi.getTimerCount()).toBe(0);
});

test('watchdog preserves a documented reward when close is the only missing event', async () => {
  const h = makeCleverApps();
  await ready(h);
  const show = await open(h, 'rewarded', 'reward_without_close');
  h.fake.emit('rewarded:reward');
  await vi.advanceTimersByTimeAsync(AD_WATCHDOG_HARD_MS);
  expect(await show.promise).toEqual({ status: 'rewarded', rewarded: true, placement: 'reward_without_close' });
});

test('a concurrent second rewarded show is rejected while one active show remains authoritative', async () => {
  const h = makeCleverApps();
  await ready(h);
  const first = await open(h, 'rewarded', 'first');
  const second = await h.platform.ads.showRewarded('second');
  expect(second).toMatchObject({ status: 'error', rewarded: false, placement: 'second' });
  expect(String(second.raw)).toContain('cleverapps_rewarded_busy');
  h.fake.emit('rewarded:reward');
  h.fake.emit('rewarded:close', true);
  expect(await first.promise).toMatchObject({ status: 'rewarded', placement: 'first' });
  expect(h.fake.count('ads.showRewardedVideo')).toBe(1);
});

test('interstitial reports shown only from close(true), and false/reject/unavailable map safely', async () => {
  const shown = makeCleverApps();
  await ready(shown);
  const openShown = await open(shown, 'interstitial', 'level_complete');
  shown.fake.emit('interstitial:close', true);
  expect(await openShown.promise).toEqual({ status: 'shown', rewarded: false, placement: 'level_complete', raw: true });

  const closed = await open(shown, 'interstitial', 'level_complete');
  shown.fake.emit('interstitial:close', false);
  expect(await closed.promise).toEqual({ status: 'no_fill', rewarded: false, placement: 'level_complete', raw: false });

  const refused = makeCleverApps((fake) => (fake.interstitialShowMode = 'false'));
  await ready(refused);
  expect(await refused.platform.ads.showInterstitial('inter')).toMatchObject({ status: 'no_fill' });

  const rejected = makeCleverApps((fake) => (fake.interstitialShowMode = 'fail'));
  await ready(rejected);
  expect(await rejected.platform.ads.showInterstitial('inter')).toMatchObject({ status: 'error' });

  const unsupported = makeCleverApps((fake) => (fake.interstitialSupported = false));
  await ready(unsupported);
  expect(await unsupported.platform.ads.showInterstitial('inter')).toMatchObject({ status: 'no_fill' });
  expect(unsupported.fake.count('ads.showInterstitial')).toBe(0);
});

test('a concurrent second interstitial is rejected until the active close is correlated', async () => {
  const h = makeCleverApps();
  await ready(h);
  const first = await open(h, 'interstitial', 'first_inter');
  const second = await h.platform.ads.showInterstitial('second_inter');
  expect(second).toMatchObject({ status: 'error', rewarded: false, placement: 'second_inter' });
  expect(String(second.raw)).toContain('cleverapps_interstitial_busy');
  h.fake.emit('interstitial:close', true);
  expect(await first.promise).toMatchObject({ status: 'shown', placement: 'first_inter' });
  expect(h.fake.count('ads.showInterstitial')).toBe(1);
});

test('dispose removes the one listener set and settles a pending show without leaving a timer', async () => {
  const h = makeCleverApps();
  await ready(h);
  const show = await open(h, 'rewarded', 'pending');
  h.platform.dispose();
  expect(await show.promise).toMatchObject({ status: 'error', rewarded: false, placement: 'pending' });
  expect(h.fake.count('ads.off:')).toBe(3);
  expect(vi.getTimerCount()).toBe(0);
});
