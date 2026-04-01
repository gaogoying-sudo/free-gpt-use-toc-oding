export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const addPoint = (base: Point, offset: Point): Point => ({
  x: Math.round(base.x + offset.x),
  y: Math.round(base.y + offset.y)
});

export const clampRect = (rect: Rect): Rect => ({
  x: Math.max(0, Math.round(rect.x)),
  y: Math.max(0, Math.round(rect.y)),
  width: Math.max(1, Math.round(rect.width)),
  height: Math.max(1, Math.round(rect.height))
});
