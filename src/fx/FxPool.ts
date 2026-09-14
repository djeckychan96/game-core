import type { FxSurface } from './FxSurface';

export interface FxPoolOptions<TNode extends object> {
  surface: FxSurface<TNode>;
  createNode: () => TNode;
  maxSize: number;
  prewarm?: number;
}

export interface FxPoolStats {
  createdNodes: number;
  available: number;
  active: number;
  maxSize: number;
  acquires: number;
  releases: number;
  misses: number;
}

export class FxPool<TNode extends object> {
  public readonly surface: FxSurface<TNode>;

  private readonly createNode: () => TNode;
  private readonly maxSize: number;
  private readonly available: TNode[] = [];
  private readonly active = new Set<TNode>();
  private createdNodes = 0;
  private liveNodes = 0;
  private acquires = 0;
  private releases = 0;
  private misses = 0;

  constructor(options: FxPoolOptions<TNode>) {
    this.surface = options.surface;
    this.createNode = options.createNode;
    this.maxSize = Math.max(0, Math.floor(options.maxSize));

    if (Number.isFinite(options.prewarm)) {
      this.prewarm(Number(options.prewarm));
    }
  }

  prewarm(count = this.maxSize): number {
    const target = Math.max(0, Math.min(this.maxSize, Math.floor(count)));
    let created = 0;

    while (this.liveNodes < target) {
      const node = this.createNode();
      this.createdNodes += 1;
      this.liveNodes += 1;
      created += 1;
      this.resetNode(node);
      this.available.push(node);
    }

    return created;
  }

  acquire(): TNode | null {
    let node = this.available.pop() ?? null;
    if (!node) {
      if (this.liveNodes >= this.maxSize) {
        this.misses += 1;
        return null;
      }

      node = this.createNode();
      this.createdNodes += 1;
      this.liveNodes += 1;
    }

    this.active.add(node);
    this.acquires += 1;
    return node;
  }

  release(node: TNode): boolean {
    if (!this.active.delete(node)) {
      return false;
    }

    this.releases += 1;
    this.resetNode(node);
    this.available.push(node);
    return true;
  }

  /**
   * Real teardown: permanently destroys every node this pool owns (active and idle) via
   * `surface.destroyNode`, then resets bookkeeping so the pool can be refilled from scratch.
   * Unlike `release()`, this never returns nodes to `available` for reuse.
   */
  clear(): void {
    for (const node of this.active) {
      this.destroyNode(node);
    }
    for (const node of this.available) {
      this.destroyNode(node);
    }
    this.active.clear();
    this.available.length = 0;
    this.liveNodes = 0;
  }

  stats(): FxPoolStats {
    return {
      createdNodes: this.createdNodes,
      available: this.available.length,
      active: this.active.size,
      maxSize: this.maxSize,
      acquires: this.acquires,
      releases: this.releases,
      misses: this.misses
    };
  }

  resetStats(): void {
    this.acquires = 0;
    this.releases = 0;
    this.misses = 0;
  }

  private resetNode(node: TNode): void {
    this.surface.detach(node);
    this.surface.setVisible(node, false);
    this.surface.setAlpha(node, 1);
    this.surface.setPosition(node, 0, 0);
    this.surface.setScale(node, 1, 1);
    this.surface.setRotation(node, 0);
  }

  private destroyNode(node: TNode): void {
    this.surface.detach(node);
    this.surface.destroyNode(node);
  }
}
