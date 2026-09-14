import type { FxSurface } from '../../src/fx/FxSurface';

export interface FakeNode {
  id: number;
  attached: boolean;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  alpha: number;
  visible: boolean;
}

export function createFakeNode(id: number): FakeNode {
  return {
    id,
    attached: false,
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    alpha: 1,
    visible: false
  };
}

export function createFakeSurface(): FxSurface<FakeNode> {
  return {
    attach(node) {
      node.attached = true;
    },
    detach(node) {
      node.attached = false;
    },
    setPosition(node, x, y) {
      node.x = x;
      node.y = y;
    },
    setScale(node, x, y = x) {
      node.scaleX = x;
      node.scaleY = y;
    },
    setRotation(node, rotation) {
      node.rotation = rotation;
    },
    setAlpha(node, alpha) {
      node.alpha = alpha;
    },
    setVisible(node, visible) {
      node.visible = visible;
    }
  };
}
