export interface FxSurface<TNode extends object = object> {
  attach(node: TNode): void;
  detach(node: TNode): void;
  setPosition(node: TNode, x: number, y: number): void;
  setScale(node: TNode, x: number, y?: number): void;
  setRotation(node: TNode, radians: number): void;
  setAlpha(node: TNode, alpha: number): void;
  setVisible(node: TNode, visible: boolean): void;
}
