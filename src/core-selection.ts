export const CORE_NODE_WIDTH = 218, CORE_NODE_HEIGHT = 116;
export type CorePosition = { id: string; x: number; y: number };
export type CanvasPoint = { x: number; y: number };
export type SelectionRectangle = CanvasPoint & { width: number; height: number };
export function selectionRectangle(start: CanvasPoint, end: CanvasPoint): SelectionRectangle {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
}
export function nodesInRectangle(nodes: readonly CorePosition[], area: SelectionRectangle): string[] {
  if (!area.width || !area.height) return [];
  return nodes.filter(n => n.x < area.x + area.width && n.x + CORE_NODE_WIDTH > area.x && n.y < area.y + area.height && n.y + CORE_NODE_HEIGHT > area.y).map(n => n.id);
}
// Clamp the common displacement, never each node independently: spacing stays fixed
// when any selected node reaches a boundary. Existing out-of-range layouts do not jump.
export function moveCoreGroup(nodes: readonly CorePosition[], dx: number, dy: number): CorePosition[] {
  if (!nodes.length || !Number.isFinite(dx) || !Number.isFinite(dy)) return [];
  const minX = Math.min(...nodes.map(n => n.x)), maxX = Math.max(...nodes.map(n => n.x));
  const minY = Math.min(...nodes.map(n => n.y)), maxY = Math.max(...nodes.map(n => n.y));
  const x = Math.max(Math.min(0, 35 - minX), Math.min(Math.max(0, 15000 - maxX), Math.round(dx)));
  const y = Math.max(Math.min(0, 65 - minY), Math.min(Math.max(0, 15000 - maxY), Math.round(dy)));
  return nodes.map(n => ({ id: n.id, x: n.x + x, y: n.y + y }));
}
