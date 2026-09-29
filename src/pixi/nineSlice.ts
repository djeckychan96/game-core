import { NineSliceSprite, type Texture } from 'pixi.js';

export interface NineSliceInsets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * 9-slice metadata of a Ready UI texture, in texture units (= design units: a `@2x` file's resolution is already
 * divided out by Pixi). The caps never stretch; the centre between them stretches in both directions.
 */
export interface NineSliceSpec extends NineSliceInsets {
  /**
   * How far the art (outside stroke, drop shadow) bleeds outside the component's logical box — the Figma node box.
   * The caps include it. Default: no bleed.
   */
  pad?: NineSliceInsets;
}

/**
 * A 9-slice sprite that covers a `width × height` logical box (the Figma node box) centred on its local origin;
 * the texture's bleed (`spec.pad`) is drawn outside that box, exactly where the Figma render puts it.
 */
export function createNineSlice(texture: Texture, spec: NineSliceSpec, width: number, height: number): NineSliceSprite {
  const pad = spec.pad ?? { left: 0, top: 0, right: 0, bottom: 0 };
  const fullWidth = width + pad.left + pad.right;
  const fullHeight = height + pad.top + pad.bottom;
  return new NineSliceSprite({
    texture,
    leftWidth: spec.left,
    topHeight: spec.top,
    rightWidth: spec.right,
    bottomHeight: spec.bottom,
    width: fullWidth,
    height: fullHeight,
    anchor: { x: (pad.left + width / 2) / fullWidth, y: (pad.top + height / 2) / fullHeight }
  });
}
