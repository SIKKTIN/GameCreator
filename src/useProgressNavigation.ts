import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const minimumZoom = .4, maximumZoom = 1.25;
type Point = { x: number; y: number };
type Pan = Point & { pointerId: number };
type Anchor = Point & { worldX: number; worldY: number };

/** Navigation stays local to the viewport, including for read-only projects. */
export function useProgressNavigation(visible: boolean) {
  const scroll = useRef<HTMLDivElement>(null);
  const [zoom, updateZoom] = useState(1), [panning, setPanning] = useState(false);
  const requestedZoom = useRef(1), renderedZoom = useRef(1);
  const anchor = useRef<Anchor | null>(null), pan = useRef<Pan | null>(null);

  const endPan = useCallback(() => {
    const current = pan.current;
    pan.current = null;
    if (current && scroll.current?.hasPointerCapture(current.pointerId)) scroll.current.releasePointerCapture(current.pointerId);
    setPanning(false);
  }, []);

  const setZoom = useCallback((value: number, point?: Point) => {
    const next = Math.max(minimumZoom, Math.min(maximumZoom, value));
    if (!Number.isFinite(next) || next === requestedZoom.current) return;
    endPan();
    const viewport = scroll.current;
    if (viewport) {
      const x = point?.x ?? viewport.clientWidth / 2, y = point?.y ?? viewport.clientHeight / 2;
      // Measure against the rendered view so successive wheel events can be batched safely.
      anchor.current = { x, y, worldX: (viewport.scrollLeft + x) / renderedZoom.current, worldY: (viewport.scrollTop + y) / renderedZoom.current };
    }
    requestedZoom.current = next;
    updateZoom(next);
  }, [endPan]);

  useLayoutEffect(() => {
    renderedZoom.current = zoom;
    const viewport = scroll.current, point = anchor.current;
    if (viewport && point) {
      // Apply after CSS zoom updates the scroll extents; the browser clamps at the edges.
      viewport.scrollLeft = point.worldX * zoom - point.x;
      viewport.scrollTop = point.worldY * zoom - point.y;
    }
    anchor.current = null;
  }, [zoom]);

  useEffect(() => {
    const viewport = scroll.current;
    if (!visible || !viewport) return;
    const localPoint = (event: MouseEvent): Point => {
      const rect = viewport.getBoundingClientRect();
      return { x: event.clientX - rect.left - viewport.clientLeft, y: event.clientY - rect.top - viewport.clientTop };
    };
    const inside = ({ x, y }: Point) => x >= 0 && y >= 0 && x < viewport.clientWidth && y < viewport.clientHeight;
    const down = (event: PointerEvent) => {
      if (event.button !== 2 || !inside(localPoint(event))) return;
      event.preventDefault();
      viewport.focus({ preventScroll: true });
      pan.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      viewport.setPointerCapture(event.pointerId);
      setPanning(true);
    };
    const move = (event: PointerEvent) => {
      const current = pan.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (!(event.buttons & 2)) { endPan(); return; }
      event.preventDefault();
      viewport.scrollLeft -= event.clientX - current.x;
      viewport.scrollTop -= event.clientY - current.y;
      current.x = event.clientX;
      current.y = event.clientY;
    };
    const end = (event: PointerEvent) => { if (event.pointerId === pan.current?.pointerId) endPan(); };
    const contextMenu = (event: MouseEvent) => { event.preventDefault(); };
    const keyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && pan.current) { event.preventDefault(); endPan(); } };
    const wheel = (event: WheelEvent) => {
      const point = localPoint(event);
      if (!inside(point)) return;
      event.preventDefault();
      if (pan.current) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
      const delta = Math.max(-240, Math.min(240, (event.deltaY || event.deltaX) * unit));
      setZoom(requestedZoom.current * Math.exp(-delta * .0015), point);
    };
    viewport.addEventListener('pointerdown', down, true);
    viewport.addEventListener('pointermove', move);
    viewport.addEventListener('pointerup', end);
    viewport.addEventListener('pointercancel', end);
    viewport.addEventListener('lostpointercapture', end);
    viewport.addEventListener('contextmenu', contextMenu);
    // React's delegated wheel listener is passive; this listener must consume scrolling here.
    viewport.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('blur', endPan);
    window.addEventListener('keydown', keyDown);
    return () => {
      viewport.removeEventListener('pointerdown', down, true);
      viewport.removeEventListener('pointermove', move);
      viewport.removeEventListener('pointerup', end);
      viewport.removeEventListener('pointercancel', end);
      viewport.removeEventListener('lostpointercapture', end);
      viewport.removeEventListener('contextmenu', contextMenu);
      viewport.removeEventListener('wheel', wheel);
      window.removeEventListener('blur', endPan);
      window.removeEventListener('keydown', keyDown);
      endPan();
    };
  }, [visible, setZoom, endPan]);

  return { scroll, zoom, setZoom, panning };
}
