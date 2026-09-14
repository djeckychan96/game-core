export interface FxSurface<TNode extends object = object> {
  attach(node: TNode): void;
  detach(node: TNode): void;
  setPosition(node: TNode, x: number, y: number): void;
  setScale(node: TNode, x: number, y?: number): void;
  setRotation(node: TNode, radians: number): void;
  setAlpha(node: TNode, alpha: number): void;
  setVisible(node: TNode, visible: boolean): void;
  /**
   * Permanently destroys a node this surface created (called by pool teardown, never by release()).
   * Must not destroy resources the node merely references but doesn't own (e.g. a shared Texture) unless
   * that is that object's own default destroy behavior.
   */
  destroyNode(node: TNode): void;
}
