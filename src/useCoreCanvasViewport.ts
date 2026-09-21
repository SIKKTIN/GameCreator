import { useCallback, useEffect, useRef, useState, type RefObject, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react';

type View = { zoom: number; x: number; y: number };
type Pan = { pointerId: number; clientX: number; clientY: number; x: number; y: number };
const boundedZoom = (value: number) => Math.max(.35, Math.min(1.75, value));

// Camera movement is view state only: it never changes graph coordinates or archives.
export function useCoreCanvasViewport(containerRef: RefObject<HTMLDivElement | null>, nodeDrag: RefObject<unknown>) {
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const latest = useRef(view), pan = useRef<Pan | null>(null), suppressPanClick = useRef(false);
  const applyView = useCallback((next: View) => {
    latest.current = next;
    // Absorb native scrollbar movement into the transform before camera changes.
    // This also prevents a smaller scroll range from moving the zoom anchor.
    if (containerRef.current) { containerRef.current.scrollLeft = 0; containerRef.current.scrollTop = 0; }
    setView(next);
  }, [containerRef]);
  const endPan = useCallback(() => {
    const gesture = pan.current; pan.current = null; setPanning(false);
    const element = containerRef.current;
    if (gesture && element?.hasPointerCapture(gesture.pointerId)) element.releasePointerCapture(gesture.pointerId);
  }, [containerRef]);
  const resetView = useCallback((zoom = 1) => {
    endPan(); applyView({ zoom: boundedZoom(zoom), x: 0, y: 0 });
  }, [applyView, endPan]);
  const zoomAt = useCallback((target: number, clientX?: number, clientY?: number) => {
    const element = containerRef.current;
    if (!element || !element.clientWidth || !element.clientHeight) return;
    const before = latest.current, zoom = boundedZoom(target);
    if (zoom === before.zoom) return;
    const bounds = element.getBoundingClientRect();
    const x = clientX === undefined ? element.clientWidth / 2 : clientX - bounds.left - element.clientLeft;
    const y = clientY === undefined ? element.clientHeight / 2 : clientY - bounds.top - element.clientTop;
    const worldX = (x + element.scrollLeft - before.x) / before.zoom;
    const worldY = (y + element.scrollTop - before.y) / before.zoom;
    applyView({ zoom, x: x - worldX * zoom, y: y - worldY * zoom });
  }, [applyView, containerRef]);
  const setZoom = useCallback((next: number | ((value: number) => number)) => {
    zoomAt(typeof next === 'function' ? next(latest.current.zoom) : next);
  }, [zoomAt]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      // React's delegated wheel listener is passive in Chromium. Attach here so
      // scrolling over the diagram zooms it without scrolling the outer page.
      event.preventDefault();
      if (pan.current || nodeDrag.current) return;
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      const pixels = Math.max(-240, Math.min(240, (event.deltaY || event.deltaX) * units));
      zoomAt(latest.current.zoom * Math.exp(-pixels * .0015), event.clientX, event.clientY);
    };
    const onVisibility = () => { if (document.hidden) endPan(); };
    const observer = new ResizeObserver(() => { if (!element.clientWidth || !element.clientHeight) endPan(); });
    element.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('blur', endPan);
    document.addEventListener('visibilitychange', onVisibility);
    observer.observe(element);
    return () => {
      element.removeEventListener('wheel', wheel); window.removeEventListener('blur', endPan);
      document.removeEventListener('visibilitychange', onVisibility); observer.disconnect();
      const gesture = pan.current; pan.current = null;
      if (gesture && element.hasPointerCapture(gesture.pointerId)) element.releasePointerCapture(gesture.pointerId);
    };
  }, [containerRef, nodeDrag, zoomAt, endPan]);

  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button === 0 && !pan.current) suppressPanClick.current = false;
    if (event.button !== 2) return;
    event.preventDefault(); event.stopPropagation();
    if (nodeDrag.current) return;
    const element = event.currentTarget, current = latest.current;
    const position = { x: current.x - element.scrollLeft, y: current.y - element.scrollTop };
    pan.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, ...position };
    suppressPanClick.current = true;
    element.setPointerCapture(event.pointerId);
    applyView({ zoom: current.zoom, ...position }); setPanning(true);
  };
  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = pan.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    if (!(event.buttons & 2)) { endPan(); return; }
    applyView({ zoom: latest.current.zoom, x: gesture.x + event.clientX - gesture.clientX, y: gesture.y + event.clientY - gesture.clientY });
  };
  const finishPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pan.current?.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    if (event.type !== 'pointercancel' && (event.buttons & 2)) return;
    endPan();
  };
  const suppressCameraClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // A left-button release during a right-button pan can synthesize a click.
    // Keep keyboard activation working after the gesture; a new left press clears the token.
    if (pan.current || (suppressPanClick.current && event.detail > 0)) { event.preventDefault(); event.stopPropagation(); }
  };
  const focusPoint = useCallback((x:number,y:number) => {
    const el=containerRef.current;if(!el||!el.clientWidth)return;
    endPan();const zoom=Math.max(.7,latest.current.zoom);
    applyView({zoom,x:el.clientWidth/2-x*zoom,y:el.clientHeight/2-y*zoom});
  },[containerRef,endPan,applyView]);
  return { ...view, panning, setZoom, resetView, endPan, focusPoint,
    handlers: {
      onPointerDownCapture: beginPan, onPointerMoveCapture: movePan, onPointerUpCapture: finishPan,
      onPointerCancelCapture: finishPan, onClickCapture: suppressCameraClick, onDoubleClickCapture: suppressCameraClick,
      onLostPointerCapture: (event: ReactPointerEvent<HTMLDivElement>) => {
        if (pan.current?.pointerId !== event.pointerId) return;
        // Chromium releases capture after a left click even if the right button
        // is still down. Resume capture so the same pan continues outside nodes.
        if (event.buttons & 2) event.currentTarget.setPointerCapture(event.pointerId);
        else endPan();
      },
      onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => { event.preventDefault(); event.stopPropagation(); },
      onAuxClickCapture: (event: ReactMouseEvent<HTMLDivElement>) => { if (event.button === 2) { event.preventDefault(); event.stopPropagation(); } },
    },
  };
}
