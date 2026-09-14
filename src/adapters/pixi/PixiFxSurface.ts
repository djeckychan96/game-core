import type { FxSurface } from '../../fx/FxSurface';

export interface PixiContainerLike {
  addChild(child: PixiDisplayObjectLike): unknown;
  removeChild?(child: PixiDisplayObjectLike): unknown;
}

export interface PixiDisplayObjectLike {
  parent?: PixiContainerLike | null;
  position?: { set(x: number, y: number): unknown };
  scale?: { set?(x: number, y?: number): unknown; x?: number; y?: number };
  x?: number;
  y?: number;
  rotation?: number;
  alpha?: number;
  visible?: boolean;
  /** Present on every Pixi 7/8 DisplayObject/Container. Called with no arguments by default, so
   * a shared Texture/BaseTexture the node merely references is left untouched (Pixi only tears
   * those down when `{ texture: true }`/`{ baseTexture: true }` is explicitly passed). */
  destroy?(options?: unknown): unknown;
}

export class PixiFxSurface<TNode extends PixiDisplayObjectLike = PixiDisplayObjectLike> implements FxSurface<TNode> {
  private readonly root: PixiContainerLike;

  constructor(root: PixiContainerLike) {
    this.root = root;
  }

  attach(node: TNode): void {
    if (node.parent === this.root) return;
    if (node.parent && typeof node.parent.removeChild === 'function') {
      node.parent.removeChild(node);
    }
    this.root.addChild(node);
  }

  detach(node: TNode): void {
    if (node.parent && typeof node.parent.removeChild === 'function') {
      node.parent.removeChild(node);
    }
  }

  setPosition(node: TNode, x: number, y: number): void {
    if (node.position && typeof node.position.set === 'function') {
      node.position.set(x, y);
      return;
    }
    node.x = x;
    node.y = y;
  }

  setScale(node: TNode, x: number, y = x): void {
    if (!node.scale) return;
    if (typeof node.scale.set === 'function') {
      node.scale.set(x, y);
      return;
    }
    // Same fallback shape as setPosition: prefer the method, fall back to direct properties
    // (Pixi's Point/ObservablePoint always exposes writable x/y even without .set()).
    node.scale.x = x;
    node.scale.y = y;
  }

  setRotation(node: TNode, radians: number): void {
    node.rotation = radians;
  }

  setAlpha(node: TNode, alpha: number): void {
    node.alpha = alpha;
  }

  setVisible(node: TNode, visible: boolean): void {
    node.visible = visible;
  }

  destroyNode(node: TNode): void {
    if (typeof node.destroy === 'function') {
      node.destroy();
    }
  }
}
