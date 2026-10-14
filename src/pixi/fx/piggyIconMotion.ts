import type { KeyframeEase, KeyframeMotion } from './KeyframeMotion';

/** Figma's 10 % segment: the squat before the jump (the curve dips below 0, then shoots up). */
const SQUAT: KeyframeEase = [0.3, -0.05, 0.7, -0.5];
/** Figma's 40 % segment of the coin and the spark: the springy rise (the curve overshoots 1). */
const SPRING: KeyframeEase = [0.45, 1.45, 0.8, 1];

/**
 * Figma `pig_anima` 90:27944 (file 5FWFwdO4QGeDfeQtloLNOS, 400 × 400) — the piggy-bank entry's loop: the artist's own
 * layers and keyframes 1:1 (get_design_context + get_motion_context recursive, one timeline cohort of 2000 ms, loop).
 * The pig squats, jumps and lands, stretching up in the air and squashing on the ground (translate + scale y, origin
 * = its centre); the coin flies above it on its own path; the white spark turns half a turn, flies with the coin and
 * grows to 1.5. Segments without a timing function are linear (Figma's `animation: … linear`).
 *
 * Layers bottom to top, named by their skin roles (a style's role textures are the view's `textures`):
 *   iconPiggyBankCoin  — `icon_coin_1` 90:27945: 100 × 100 turned 20°, its 128.171 bounding box at 174.91, 67.91;
 *   iconPiggyBankPig   — `icon_pig_bank_2` 90:27946: the 250 box centred at 190, 191 (the pig without its coin);
 *   iconPiggyBankSpark — `pic_spark_1` 90:27947: 100 × 100 at 225, 40.
 * `iconBox` is the pig's 250 box — the static icon's box (`icon_pig_bank` is 250 too): a host lays the frame over its
 * icon by it (frame units × icon size / 250).
 */
export const PIGGY_ICON_MOTION = {
  durationMs: 2000,
  frame: { width: 400, height: 400 },
  iconBox: { x: 65, y: 66, width: 250, height: 250 },
  layers: [
    {
      name: 'iconPiggyBankCoin',
      box: { x: 188.9955, y: 81.9955, width: 100, height: 100 },
      rotation: (20 * Math.PI) / 180,
      tracks: {
        translate: [
          { at: 0, value: [0, 0], ease: 'ease-in' },
          { at: 0.1, value: [0, 15.086], ease: SQUAT },
          { at: 0.4, value: [-0.342, -22], ease: SPRING },
          { at: 0.65, value: [-2.554, -75.554], ease: 'ease-in' },
          { at: 0.85, value: [0.802, 7.68], ease: 'ease-in' },
          { at: 1, value: [-0.342, 0.06] }
        ]
      }
    },
    {
      name: 'iconPiggyBankPig',
      box: { x: 65, y: 66, width: 250, height: 250 },
      tracks: {
        translate: [
          { at: 0, value: [0, 0], ease: 'ease-in' },
          { at: 0.1, value: [0, 3.75], ease: SQUAT },
          { at: 0.4, value: [0, -25.637], ease: 'ease-out' },
          { at: 0.85, value: [-0.329, 4.942], ease: 'ease-in' },
          { at: 1, value: [0, 0] }
        ],
        scale: [
          { at: 0, value: [1, 1], ease: 'ease-in' },
          { at: 0.1, value: [1, 0.95], ease: SQUAT },
          { at: 0.4, value: [1, 1.05], ease: 'ease-out' },
          { at: 0.85, value: [1, 0.95], ease: 'ease-in' },
          { at: 1, value: [1, 1] }
        ]
      }
    },
    {
      name: 'iconPiggyBankSpark',
      box: { x: 225, y: 40, width: 100, height: 100 },
      tracks: {
        // Figma −3.142 rad (−180°) → 0, linear over the loop
        rotate: [
          { at: 0, value: -Math.PI },
          { at: 1, value: 0 }
        ],
        translate: [
          { at: 0, value: [-2, 2], ease: 'ease-in' },
          { at: 0.1, value: [0, 22], ease: SQUAT },
          { at: 0.4, value: [-1.701, -12.701], ease: SPRING },
          { at: 0.65, value: [-4.934, -67.934], ease: 'ease-in' },
          { at: 0.85, value: [-2.75, 11.25] },
          { at: 1, value: [-2, 2] }
        ],
        scale: [
          { at: 0, value: [1, 1], ease: 'ease-in' },
          { at: 0.1, value: [0.9, 0.9], ease: SQUAT },
          { at: 0.4, value: [1.3, 1.3], ease: SPRING },
          { at: 0.65, value: [1.5, 1.5], ease: [0.5, 0, 0.5, 1] },
          { at: 0.85, value: [1, 1] },
          { at: 1, value: [1, 1] }
        ]
      }
    }
  ]
} as const satisfies KeyframeMotion & { readonly iconBox: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } };
