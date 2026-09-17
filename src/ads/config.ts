import type { AdPayerClass, AdPlacement, AdPlacementType, AdSegment, AdsConfig } from './types';

/** The segment the donor falls back to when nothing matches. It has no placement rules on purpose: "no ads". */
export const ADS_DEFAULT_SEGMENT_ID = 'default';
/** The placement `canShowBanner()` looks up. */
export const ADS_BANNER_PLACEMENT = 'banner';

function readTsv(raw: string): Array<Record<string, string | undefined>> {
  const [head, ...rows] = raw.trim().split(/\r?\n/);
  const cols = (head ?? '').split('\t');
  return rows.map((row) => {
    const record: Record<string, string | undefined> = {};
    row.split('\t').forEach((value, i) => {
      const col = cols[i];
      if (col !== undefined) record[col] = value;
    });
    return record;
  });
}

const num = (value: string | number | undefined): number => (value === 'Infinity' ? Infinity : Number(value));

/**
 * `segments.tsv` + `placements.tsv` → `AdsConfig`: the logic of the donor's
 * `utils/gen-ads-config.mjs`, 1:1 — TSV row order becomes key order (the first matching segment
 * wins), `Infinity` stays a number, a missing avg/max column reads as 0…Infinity, `disableInter`
 * is the literal `TRUE`, and the placement type comes from its name (`banner` → banner, `*_inter`
 * → inter, anything else → rewarded). It does not validate — `validateAdsConfig` does.
 */
export function parseAdsTsv(segmentsTsv: string, placementsTsv: string): AdsConfig {
  const segments: Record<string, AdSegment> = {};
  for (const r of readTsv(segmentsTsv)) {
    segments[String(r['segment_id'])] = {
      payer: r['payer'] as AdPayerClass,
      levelFrom: num(r['levelFrom']),
      levelTo: num(r['levelTo']),
      avgFrom: num(r['avgFrom'] ?? 0),
      avgTo: num(r['avgTo'] ?? 'Infinity'),
      maxFrom: num(r['maxFrom'] ?? 0),
      maxTo: num(r['maxTo'] ?? 'Infinity'),
      delayAfterReward: num(r['delayAfterReward']),
      delayBetweenInters: num(r['delayBetweenInters']),
      disableInter: r['disableInter'] === 'TRUE'
    };
  }

  const placements: Record<string, AdPlacement> = {};
  for (const r of readTsv(placementsTsv)) {
    const name = String(r['placement_name']);
    const type: AdPlacementType = name === ADS_BANNER_PLACEMENT ? 'banner' : name.endsWith('_inter') ? 'inter' : 'rewarded';
    const placement = (placements[name] ??= { type, bySegment: {} });
    placement.bySegment[String(r['segment_id'])] = {
      startFromLevel: num(r['start_from_level']),
      dayLimit: num(r['day_limit']),
      hourLimit: num(r['hour_limit'])
    };
  }
  return { segments, placements };
}

const PAYER_CLASSES: readonly AdPayerClass[] = ['PAYER', 'NON_PAYER', 'ANY'];
const PLACEMENT_TYPES: readonly AdPlacementType[] = ['inter', 'rewarded', 'banner'];

const isNumber = (value: unknown): value is number => typeof value === 'number' && !Number.isNaN(value);

/**
 * Throws a RangeError on a config the runtime cannot decide with: a broken number (a typo in a TSV
 * cell parses to NaN), an empty or inverted range, a negative delay or limit, an unknown payer
 * class or placement type, a rule for a segment that does not exist. A segment WITHOUT placement
 * rules is valid — the donor's `default` is exactly that ("no ads at all"), and so is a config
 * without a `default` segment (nothing matched → no segment → no ads).
 */
export function validateAdsConfig(config: AdsConfig): void {
  const fail = (message: string): never => {
    throw new RangeError(`validateAdsConfig: ${message}`);
  };
  if (!config || typeof config !== 'object') fail('config is required');
  const { segments, placements } = config;
  if (!segments || typeof segments !== 'object' || Object.keys(segments).length === 0) fail('segments must not be empty');
  if (!placements || typeof placements !== 'object') fail('placements is required');

  for (const [id, seg] of Object.entries(segments)) {
    if (!seg || typeof seg !== 'object') fail(`segment ${id} is not an object`);
    if (!PAYER_CLASSES.includes(seg.payer)) fail(`segment ${id}: unknown payer class ${String(seg.payer)}`);
    const ranges: Array<[string, number, number]> = [
      ['level', seg.levelFrom, seg.levelTo], ['avg', seg.avgFrom, seg.avgTo], ['max', seg.maxFrom, seg.maxTo]
    ];
    for (const [name, from, to] of ranges) {
      if (!isNumber(from) || !isNumber(to)) fail(`segment ${id}: ${name}From / ${name}To must be numbers`);
      if (!(from < to)) fail(`segment ${id}: ${name}From must be below ${name}To`);
    }
    for (const name of ['delayAfterReward', 'delayBetweenInters'] as const) {
      const value = seg[name];
      if (!(Number.isFinite(value) && value >= 0)) fail(`segment ${id}: ${name} must be a finite number ≥ 0`);
    }
    if (typeof seg.disableInter !== 'boolean') fail(`segment ${id}: disableInter must be a boolean`);
  }

  for (const [name, placement] of Object.entries(placements)) {
    if (!placement || typeof placement !== 'object') fail(`placement ${name} is not an object`);
    if (!PLACEMENT_TYPES.includes(placement.type)) fail(`placement ${name}: unknown type ${String(placement.type)}`);
    if (!placement.bySegment || typeof placement.bySegment !== 'object') fail(`placement ${name}: bySegment is required`);
    for (const [segmentId, rule] of Object.entries(placement.bySegment)) {
      if (!Object.prototype.hasOwnProperty.call(segments, segmentId)) fail(`placement ${name}: unknown segment ${segmentId}`);
      if (!rule || typeof rule !== 'object') fail(`placement ${name} / ${segmentId}: the rule is not an object`);
      for (const field of ['startFromLevel', 'dayLimit', 'hourLimit'] as const) {
        const value = rule[field];
        if (!(isNumber(value) && value >= 0)) fail(`placement ${name} / ${segmentId}: ${field} must be a number ≥ 0`);
      }
    }
  }
}
