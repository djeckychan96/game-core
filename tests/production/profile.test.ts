import { describe, expect, test, vi } from 'vitest';
import { validateGameProductionProfile, PROGRESSION_MODES, PRODUCTION_OWNERS } from '../../src/index';
import type { GameProductionProfile } from '../../src/index';
import { GORODKI_PROFILE, MINIMAL_PROFILE, SOLIPIX_PROFILE } from './fixtures';

/** A deep copy with `edit` applied — functions and the frozen ad policies are copied by reference. */
function variant(base: GameProductionProfile, edit: (profile: any) => void): GameProductionProfile {
  const copy = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(copy);
    if (value && typeof value === 'object' && !Object.isFrozen(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v)]));
    return value;
  };
  const profile = copy(base) as any;
  edit(profile);
  return profile as GameProductionProfile;
}
const rejects = (profile: unknown, message: RegExp): void => {
  expect(() => validateGameProductionProfile(profile as GameProductionProfile)).toThrow(RangeError);
  expect(() => validateGameProductionProfile(profile as GameProductionProfile)).toThrow(message);
};

describe('valid profiles', () => {
  test('Gorodki: open progression, core-owned coins, no lives, no music, Core result, shop + no_ads', () => {
    expect(() => validateGameProductionProfile(GORODKI_PROFILE)).not.toThrow();
    const soft = GORODKI_PROFILE.economy.softCurrency;
    expect(soft !== false && soft.owner === 'core' && soft.startBalance).toBe(0);
    expect(GORODKI_PROFILE.ui).toEqual({ result: 'core', lives: false, music: false });
    expect(GORODKI_PROFILE.progression.mode).toBe('open');
  });

  test('SoliPix: linear progression, gameplay-owned coins, its own result screen, the production ads / no_ads / six packs', () => {
    expect(() => validateGameProductionProfile(SOLIPIX_PROFILE)).not.toThrow();
    expect(SOLIPIX_PROFILE.economy.softCurrency).toEqual({ id: 'coins', owner: 'gameplay' });
    expect(SOLIPIX_PROFILE.ui.result).toBe('gameplay');
    expect(SOLIPIX_PROFILE.monetization.coinPacks?.map((p) => p.amount)).toEqual([200, 700, 2700, 6200, 10500, 40000]);
  });

  test('minimal: no currency, no ads, no products', () => {
    expect(() => validateGameProductionProfile(MINIMAL_PROFILE)).not.toThrow();
  });

  test('the validator never calls or inspects levelReward; the policy itself maps a levelEnd result to an integer ≥ 0', () => {
    const levelReward = vi.fn(() => 7);
    validateGameProductionProfile(variant(GORODKI_PROFILE, (p) => { p.economy.softCurrency.levelReward = levelReward; }));
    expect(levelReward).not.toHaveBeenCalled();
    const soft = GORODKI_PROFILE.economy.softCurrency;
    if (soft === false || soft.owner !== 'core' || !soft.levelReward) throw new Error('fixture');
    expect(soft.levelReward({ level: 4, levelId: 'classic-9', win: true, firstCompletion: true, stars: 3, metrics: { throws: 2, par: 3 } })).toBe(30);
    expect(soft.levelReward({ level: 4, win: true, firstCompletion: false, stars: 3, metrics: {} })).toBe(0);
    expect(soft.levelReward({ level: 4, win: false, firstCompletion: false, metrics: { reason: 'settled' } })).toBe(0);
  });

  test('ads off + packs off and a core currency without levelReward are valid', () => {
    expect(() => validateGameProductionProfile(variant(GORODKI_PROFILE, (p) => {
      p.monetization = { ads: false };
      delete p.economy.softCurrency.levelReward;
    }))).not.toThrow();
  });

  test('the enums are exported', () => {
    expect(PROGRESSION_MODES).toEqual(['linear', 'open']);
    expect(PRODUCTION_OWNERS).toEqual(['core', 'gameplay']);
  });
});

describe('rejected profiles', () => {
  test('missing / invalid id', () => {
    rejects(variant(MINIMAL_PROFILE, (p) => { delete p.id; }), /validateGameProductionProfile: id must be a name/);
    rejects(variant(MINIMAL_PROFILE, (p) => { p.id = ''; }), /id must be a name/);
    rejects(variant(MINIMAL_PROFILE, (p) => { p.id = 'has space'; }), /id must be a name/);
    rejects(null, /profile is required/);
  });

  test('secrets, JWTs and project ids — anywhere, by name or by value', () => {
    rejects(variant(MINIMAL_PROFILE, (p) => { p.platform.projectId = 'twinarrow'; }), /platform\.projectId is a secret \/ credential \/ project id field/);
    rejects(variant(MINIMAL_PROFILE, (p) => { p.platform.jwtRef = 'YA'; }), /platform\.jwtRef is a secret/);
    rejects(variant(MINIMAL_PROFILE, (p) => { p.apiKey = 'k'; }), /profile\.apiKey is a secret/);
    rejects(variant(MINIMAL_PROFILE, (p) => { p.platform.appSecret = 's'; }), /platform\.appSecret is a secret/);
    rejects(variant(MINIMAL_PROFILE, (p) => { p.platform.credentials = { user: 'u' }; }), /platform\.credentials is a secret/);
    rejects(variant(SOLIPIX_PROFILE, (p) => { p.monetization.coinPacks[0].accessToken = 'x'; }), /coinPacks\.0\.accessToken is a secret/);
    rejects(variant(MINIMAL_PROFILE, (p) => { p.save.keys = ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2ln']; }), /save\.keys\.0 holds something that looks like a JWT/);
  });

  test('core-owned currency needs an integer startBalance ≥ 0; a gameplay-owned one has none', () => {
    for (const startBalance of [undefined, -1, 1.5, Number.NaN, Infinity, '10', null]) {
      rejects(variant(GORODKI_PROFILE, (p) => { p.economy.softCurrency.startBalance = startBalance; }), /economy\.softCurrency\.startBalance must be an integer ≥ 0 for a core-owned currency/);
    }
    rejects(variant(SOLIPIX_PROFILE, (p) => { p.economy.softCurrency.startBalance = 100; }), /startBalance is for a core-owned currency/);
    rejects(variant(SOLIPIX_PROFILE, (p) => { p.economy.softCurrency.levelReward = () => 5; }), /levelReward is for a core-owned currency/);
    rejects(variant(GORODKI_PROFILE, (p) => { p.economy.softCurrency.levelReward = { first: 10 }; }), /levelReward must be a function/);
    rejects(variant(GORODKI_PROFILE, (p) => { p.economy.softCurrency.id = ''; }), /economy\.softCurrency\.id must be a name/);
    rejects(variant(MINIMAL_PROFILE, (p) => { p.economy.softCurrency = true; }), /economy\.softCurrency must be false or an object/);
  });

  test('coin packs: productId, integer amount > 0, unique ids, a currency to grant', () => {
    rejects(variant(SOLIPIX_PROFILE, (p) => { delete p.monetization.coinPacks[1].productId; }), /coinPacks\[1\]\.productId must be a non-empty product id/);
    rejects(variant(SOLIPIX_PROFILE, (p) => { p.monetization.coinPacks[1].productId = ''; }), /coinPacks\[1\]\.productId must be a non-empty product id/);
    for (const amount of [0, -5, 2.5, '200', undefined]) {
      rejects(variant(SOLIPIX_PROFILE, (p) => { p.monetization.coinPacks[0].amount = amount; }), /coinPacks\[0\]\.amount must be an integer > 0/);
    }
    rejects(variant(SOLIPIX_PROFILE, (p) => { p.monetization.coinPacks[2].productId = 'no_ads'; }), /coinPacks\[2\]\.productId "no_ads" is used by another product/);
    rejects(variant(SOLIPIX_PROFILE, (p) => { p.monetization.coinPacks[0].fallbackPrice = ''; }), /coinPacks\[0\]\.fallbackPrice must be a non-empty string/);
    rejects(variant(SOLIPIX_PROFILE, (p) => { p.monetization.coinPacks[0].coins = 200; }), /coinPacks\[0\]\.coins is not a profile field/);
    rejects(variant(SOLIPIX_PROFILE, (p) => { p.economy.softCurrency = false; }), /coinPacks need economy\.softCurrency/);
    rejects(variant(SOLIPIX_PROFILE, (p) => { p.monetization.coinPacks = { productId: 'x', amount: 1 }; }), /coinPacks must be an array/);
  });

  test('no_ads needs ads and a product id; the ad policy goes through validateAdsPolicy', () => {
    rejects(variant(SOLIPIX_PROFILE, (p) => { p.monetization.ads = false; }), /monetization\.noAds needs monetization\.ads/);
    rejects(variant(SOLIPIX_PROFILE, (p) => { p.monetization.noAds = {}; }), /monetization\.noAds\.productId must be a non-empty product id/);
    rejects(variant(SOLIPIX_PROFILE, (p) => { p.monetization.ads = { policy: { name: 'x', version: -1 } }; }), /monetization\.ads\.policy: validateAdsPolicy: version must be an integer ≥ 0/);
    rejects(variant(SOLIPIX_PROFILE, (p) => { p.monetization.ads = true; }), /monetization\.ads must be an object/);
  });

  test('unknown enum values', () => {
    rejects(variant(MINIMAL_PROFILE, (p) => { p.progression.mode = 'free'; }), /progression\.mode must be one of linear \/ open/);
    rejects(variant(MINIMAL_PROFILE, (p) => { p.ui.result = 'host'; }), /ui\.result must be one of core \/ gameplay/);
    rejects(variant(GORODKI_PROFILE, (p) => { p.economy.softCurrency.owner = 'server'; }), /economy\.softCurrency\.owner must be one of core \/ gameplay/);
    rejects(variant(MINIMAL_PROFILE, (p) => { p.platform.target = 'steam'; }), /platform\.target must be one of yandex \/ cleverapps \/ dev/);
    rejects(variant(MINIMAL_PROFILE, (p) => { p.ui.lives = 'no'; }), /ui\.lives must be a boolean/);
    rejects(variant(MINIMAL_PROFILE, (p) => { p.ui.music = 1; }), /ui\.music must be a boolean/);
  });

  test('unknown fields and missing sections — one-game features have no place in the profile', () => {
    rejects(variant(MINIMAL_PROFILE, (p) => { p.ui.hints = true; }), /ui\.hints is not a profile field \(allowed: result, lives, music\)/);
    rejects(variant(MINIMAL_PROFILE, (p) => { p.boosters = []; }), /profile\.boosters is not a profile field/);
    rejects(variant(MINIMAL_PROFILE, (p) => { delete p.save; }), /save must be an object/);
    rejects(variant(MINIMAL_PROFILE, (p) => { p.save.keys = []; }), /save\.keys must be a non-empty array/);
    rejects(variant(MINIMAL_PROFILE, (p) => { p.save.keys = ['a', 'a']; }), /save\.keys\[1\] "a" is listed twice/);
    rejects(variant(MINIMAL_PROFILE, (p) => { p.save.keys = ['']; }), /save\.keys\[0\] must be a non-empty string/);
  });
});
