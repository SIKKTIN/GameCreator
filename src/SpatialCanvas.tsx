import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { Crosshair, Maximize2, Minus, Plus, RotateCcw } from 'lucide-react';
import { stageColors, stageKinds, type StageLayout } from './gameplay-stage';
import { objectGeometry, spatialLayout, type SpatialView } from './spatial-layout';

type Camera = { x: number; y: number; zoom: number };
type Props = { space: StageLayout; view: SpatialView; roomId?: string; selected?: string; selectedRoom?: string; selectedConnection?: string; disabled?: boolean; roomLayoutEditable?: boolean; lockedIds?: string[]; showRanges?: boolean; counts?: Map<string, number>;
  onObject?: (id: string) => void; onMove?: (id: string, x: number, y: number) => void; onPlace?: (x: number, y: number) => void;
  onRoom?: (id: string) => void; onMoveRoom?: (id: string, x: number, y: number) => void; onEnterRoom?: (id: string) => void; onConnection?: (id: string) => void; label?: string; focusToken?: number };
export function SpatialCanvas(p: Props) {
  const { space: s, view, roomId = '', disabled, counts } = p;
  const svg = useRef<SVGSVGElement>(null), shell = useRef<HTMLDivElement>(null), id = useId().replace(/:/g, '');
  const [size, setSize] = useState({ width: 800, height: 560 });
  const [camera, setCamera] = useState<Camera>({ x: 40, y: 40, zoom: 1 });
  const cameraRef = useRef(camera); cameraRef.current = camera;
  const [dragging, setDragging] = useState(false), [preview, setPreview] = useState<{ id: string; x: number; y: number } | null>(null);
  const drag = useRef<{ pointerId: number; type: 'pan' | 'object' | 'room'; id: string; startX: number; startY: number; x: number; y: number; camera: Camera; moved: boolean } | null>(null);
  const lastRoomClick = useRef({ id: '', time: 0 });
  const a = spatialLayout(s), unit = 56 / s.cellSize;
  const objects = s.objects.filter(o => (o.roomId || '') === roomId);
  const boxes = view === 'rooms' ? a.rooms.map(r => ({ id: r.id, x: r.x, y: r.y, width: 220, height: 100 })) : objects.map(o => { const g = objectGeometry(o, s); const angle = (o.geometry ? g.rotation : 0) * Math.PI / 180, w = (Math.abs(Math.cos(angle)) * g.width + Math.abs(Math.sin(angle)) * g.height) * unit, h = (Math.abs(Math.sin(angle)) * g.width + Math.abs(Math.cos(angle)) * g.height) * unit; return { id: o.id, x: (g.x + g.width / 2) * unit - w / 2, y: (g.y + g.height / 2) * unit - h / 2, width: w, height: h }; });
  const fitCamera = (selected = false) => {
    let items = selected ? boxes.filter(b => b.id === (view === 'rooms' ? p.selectedRoom : p.selected)) : boxes;
    if (!selected && view !== 'rooms' && p.showRanges) items = [...items, ...objects.filter(o => o.rangeShape !== 'none').map(o => { const g = objectGeometry(o, s), radius = g.range * unit, cx = (g.x + g.width / 2) * unit, cy = (g.y + g.height / 2) * unit; return { id: o.id, x: cx - radius, y: cy - radius - 24, width: radius * 2, height: radius * 2 + 24 }; })];
    if (!selected && view === 'rooms') items = [...items, ...a.connections.filter(c => c.from === c.to).flatMap(c => { const r = a.rooms.find(r => r.id === c.from); return r ? [{ id: c.id, x: r.x - 100, y: r.y - 150, width: 420, height: 150 }] : []; })];
    if (!selected && view === 'grid') items = [...items, { id: '', x: 0, y: 0, width: s.columns * 56, height: s.rows * 56 }];
    if (!items.length) return { x: 40, y: 40, zoom: 1 };
    const x = Math.min(...items.map(b => b.x)), y = Math.min(...items.map(b => b.y));
    const w = Math.max(...items.map(b => b.x + b.width)) - x, h = Math.max(...items.map(b => b.y + b.height)) - y;
    const zoom = Math.max(.000001, Math.min(selected ? 1.5 : 1, (size.width - 90) / Math.max(w, 1), (size.height - 90) / Math.max(h, 1)));
    return { x: (size.width - w * zoom) / 2 - x * zoom, y: (size.height - h * zoom) / 2 - y * zoom, zoom };
  };
  const fitRef = useRef(fitCamera); fitRef.current = fitCamera;
  useEffect(() => { if (!shell.current) return; const observer = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: 560 })); observer.observe(shell.current); return () => observer.disconnect(); }, []);
  useEffect(() => { setCamera(fitRef.current()); setPreview(null); drag.current = null; setDragging(false); }, [view, roomId]);
  useEffect(() => { if (p.focusToken) setCamera(fitRef.current(true)); }, [p.focusToken]);
  const firstSize = useRef(false);
  useEffect(() => { if (!firstSize.current && size.width !== 800) { firstSize.current = true; setCamera(fitRef.current()); } }, [size.width]);
  const zoomAt = (factor: number, x = size.width / 2, y = size.height / 2) => setCamera(c => { const zoom = Math.max(.000001, Math.min(5, c.zoom * factor)), ratio = zoom / c.zoom; return { x: x - (x - c.x) * ratio, y: y - (y - c.y) * ratio, zoom }; });
  const zoomRef = useRef(zoomAt); zoomRef.current = zoomAt;
  useEffect(() => { const el = svg.current; if (!el) return; const wheel = (e: WheelEvent) => { e.preventDefault(); const b = el.getBoundingClientRect(); zoomRef.current(Math.exp(-Math.max(-200, Math.min(200, e.deltaY)) * .003), e.clientX - b.left, e.clientY - b.top); }; el.addEventListener('wheel', wheel, { passive: false }); return () => el.removeEventListener('wheel', wheel); }, []);
  const begin = (e: PointerEvent, type: 'pan' | 'object' | 'room', itemId = '', x = 0, y = 0) => {
    if (e.button === 2) type = 'pan'; else if (e.button !== 0 || type !== 'pan' && disabled && !(type === 'room' && p.roomLayoutEditable)) return;
    if (type === 'object' && p.lockedIds?.includes(itemId)) return;
    e.preventDefault(); e.stopPropagation();
    drag.current = { pointerId: e.pointerId, type, id: itemId, startX: e.clientX, startY: e.clientY, x, y, camera: cameraRef.current, moved: false };
    svg.current?.setPointerCapture(e.pointerId); setDragging(type === 'pan');
  };
  const move = (e: PointerEvent) => {
    const d = drag.current; if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
    if (Math.hypot(dx, dy) > 3) d.moved = true;
    if (d.type === 'pan') setCamera({ ...d.camera, x: d.camera.x + dx, y: d.camera.y + dy });
    else if (d.moved) setPreview({ id: d.id, x: d.x + dx / d.camera.zoom, y: d.y + dy / d.camera.zoom });
  };
  const finish = (e: PointerEvent, cancel = false) => {
    const d = drag.current; if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null; setDragging(false); setPreview(null);
    if (!cancel && d.moved && d.type !== 'pan') { const x = d.x + (e.clientX - d.startX) / d.camera.zoom, y = d.y + (e.clientY - d.startY) / d.camera.zoom;
      if (d.type === 'room') p.onMoveRoom?.(d.id, x, y); else p.onMove?.(d.id, x / unit, y / unit);
    }
    if (!cancel && !d.moved && d.type === 'room') { const now = performance.now(); if (lastRoomClick.current.id === d.id && now - lastRoomClick.current.time < 450) { lastRoomClick.current = { id: '', time: 0 }; p.onEnterRoom?.(d.id); } else lastRoomClick.current = { id: d.id, time: now }; } else lastRoomClick.current = { id: '', time: 0 };
    if (svg.current?.hasPointerCapture(e.pointerId)) svg.current.releasePointerCapture(e.pointerId);
  };
  const place = (e: React.MouseEvent) => { if (e.button !== 0 || !p.onPlace || disabled || (e.target as Element).getAttribute('data-background') !== 'true') return;
    const b = svg.current!.getBoundingClientRect(), c = cameraRef.current; p.onPlace((e.clientX - b.left - c.x) / c.zoom / unit, (e.clientY - b.top - c.y) / c.zoom / unit);
  };
  const roomBox = (room: typeof a.rooms[number]) => preview?.id === room.id ? { ...room, x: preview.x, y: preview.y } : room;
  return <div className="sp-canvas-shell st-board-shell"><div ref={shell} className={'sp-canvas' + (dragging ? ' panning' : '')}>
    <svg ref={svg} role="group" aria-label={p.label || '空间布局画布'} width="100%" height={size.height} viewBox={`0 0 ${Math.max(1, size.width)} ${size.height}`} onContextMenu={e => e.preventDefault()}
      onPointerDown={e => { if (e.button === 2) begin(e, 'pan'); }} onPointerMove={move} onPointerUp={e => finish(e)} onPointerCancel={e => finish(e, true)} onLostPointerCapture={() => { drag.current = null; setPreview(null); setDragging(false); }} onClick={place}>
      <defs><pattern id={id + 'dots'} width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#79618a" /></pattern><marker id={id + 'arrow'} markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 Z" fill="#b5a0d3" /></marker></defs>
      <rect width={size.width} height={size.height} fill="#14121c" data-background="true" /><rect width={size.width} height={size.height} fill={`url(#${id}dots)`} opacity=".26" pointerEvents="none" />
      <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`} data-camera={`${camera.x},${camera.y},${camera.zoom}`}>
        {view === 'grid' && <g>{Array.from({ length: s.rows }, (_, r) => <g key={r}><text x="-12" y={r * 56 + 33} textAnchor="end" className="st-grid-label">R{r + 1}</text>{Array.from({ length: s.columns }, (_, c) => <g key={c} role={p.onPlace ? 'button' : undefined} tabIndex={p.onPlace ? 0 : undefined} aria-label={`格子 R${r + 1} C${c + 1}`} className="st-cell" onClick={e => { e.stopPropagation(); if (!disabled) p.onPlace?.(c * s.cellSize, r * s.cellSize); }} onKeyDown={e => { if (['Enter', ' '].includes(e.key) && !disabled) { e.preventDefault(); p.onPlace?.(c * s.cellSize, r * s.cellSize); } }}><rect x={c * 56} y={r * 56} width="56" height="56" fill={(r + c) % 2 ? '#202626' : '#1d2323'} stroke="#46514b" strokeWidth=".6" /></g>)}</g>)}{Array.from({ length: s.columns }, (_, c) => <text key={c} x={c * 56 + 28} y="-12" textAnchor="middle" className="st-grid-label">C{c + 1}</text>)}</g>}
        {view !== 'rooms' && objects.map(o => {
          const g = objectGeometry(o, s), b = { x: g.x * unit, y: g.y * unit, width: g.width * unit, height: g.height * unit }, color = stageColors[o.color];
          if (preview?.id === o.id) { b.x = preview.x; b.y = preview.y; }
          const cx = b.x + b.width / 2, cy = b.y + b.height / 2, radius = g.range * unit;
          const angle = g.arc * Math.PI / 360, ex = Math.cos(angle) * radius, ey = Math.sin(angle) * radius;
          return <g key={'range-' + o.id} pointerEvents="none" transform={`translate(${cx} ${cy}) rotate(${g.rotation})`} opacity={p.showRanges || p.selected === o.id ? 1 : 0}>
            {o.rangeShape !== 'none' && radius > 0 && <text x={0} y={-radius - 10 / camera.zoom} textAnchor="middle" fill={color} fontSize={12 / camera.zoom} transform={`rotate(${-g.rotation})`}>{o.name} · {o.rangeShape === 'ring' ? `${g.innerRange}–` : ''}{g.range} {s.unit}</text>}
            {o.rangeShape === 'radius' && <circle r={radius} fill={color + '16'} stroke={color} strokeDasharray="6 5" />}
            {o.rangeShape === 'ring' && <path fillRule="evenodd" d={`M ${radius} 0 A ${radius} ${radius} 0 1 0 ${-radius} 0 A ${radius} ${radius} 0 1 0 ${radius} 0 Z M ${g.innerRange * unit} 0 A ${g.innerRange * unit} ${g.innerRange * unit} 0 1 0 ${-g.innerRange * unit} 0 A ${g.innerRange * unit} ${g.innerRange * unit} 0 1 0 ${g.innerRange * unit} 0 Z`} fill={color + '20'} stroke={color} strokeDasharray="6 5" />}
            {o.rangeShape === 'sector' && (g.arc === 360 ? <circle r={radius} fill={color + '20'} stroke={color} /> : <path d={`M0 0 L${ex} ${-ey} A${radius} ${radius} 0 ${g.arc > 180 ? 1 : 0} 1 ${ex} ${ey} Z`} fill={color + '20'} stroke={color} strokeDasharray="6 5" />)}
            {o.rangeShape === 'line' && <rect x={b.width / 2} y={-b.height / 2} width={radius} height={b.height} fill={color + '20'} stroke={color} strokeDasharray="6 5" />}
          </g>;
        })}
        {view === 'rooms' && a.connections.map(c => { const fr = a.rooms.find(r => r.id === c.from), tr = a.rooms.find(r => r.id === c.to); if (!fr || !tr) return null;
          const f = roomBox(fr), t = roomBox(tr), right = t.x >= f.x, x1 = f.x + (right ? 220 : 0), y1 = f.y + 50, x2 = t.x + (right ? 0 : 220), y2 = t.y + 50;
          const siblings = a.connections.filter(x => x.from === c.from && x.to === c.to || x.from === c.to && x.to === c.from), index = siblings.findIndex(x => x.id === c.id), lane = (index - (siblings.length - 1) / 2) * 65;
          const self = c.from === c.to, bend = Math.max(70, Math.abs(x2 - x1) * .5), sign = right ? 1 : -1;
          const path = self ? `M${f.x + 180} ${f.y} C${f.x + 320} ${f.y - 150} ${f.x - 100} ${f.y - 150} ${f.x + 40} ${f.y}` : `M${x1} ${y1} C${x1 + bend * sign} ${y1 + lane} ${x2 - bend * sign} ${y2 + lane} ${x2} ${y2}`;
          const labelWidth = self ? 144 : Math.max(50, Math.min(144, Math.hypot(x2 - x1, y2 - y1) - 28));
          const lx = self ? f.x + 110 : (x1 + x2) / 2, ly = self ? f.y - 112 : (y1 + y2) / 2 + lane * .75;
          return <g key={c.id} role="button" tabIndex={0} aria-label={'选择房间连接：' + (c.name || '未命名')} className="sp-link" onClick={() => p.onConnection?.(c.id)} onKeyDown={e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); p.onConnection?.(c.id); } }}><path d={path} stroke="transparent" strokeWidth="18" fill="none" /><path d={path} fill="none" stroke={p.selectedConnection === c.id ? '#f0ce91' : '#b5a0d3'} strokeWidth="2" markerEnd={`url(#${id}arrow)`} markerStart={c.direction === 'both' ? `url(#${id}arrow)` : undefined} /><g transform={`translate(${lx} ${ly})`}><rect x={-labelWidth / 2} y="-15" width={labelWidth} height="30" rx="6" fill="#2d253b" stroke="#67527e" /><text textAnchor="middle" y="4" fill="#dfd2f0" fontSize="11">{(c.name || '房间连接').slice(0, Math.max(2, Math.floor(labelWidth / 11) - 2))}{c.condition || c.ruleId ? ' ◇' : ''}</text></g><title>{c.name}；{c.condition || '无附加条件'}</title></g>;
        })}
        {view === 'rooms' ? a.rooms.map(room => { const r = roomBox(room); return <g key={r.id} role="button" tabIndex={0} aria-label={'选择房间：' + r.name} className="sp-room" transform={`translate(${r.x} ${r.y})`} onPointerDown={e => { if (e.button === 0) { p.onRoom?.(r.id); if (p.onMoveRoom) begin(e, 'room', r.id, r.x, r.y); } }} onDoubleClick={() => p.onEnterRoom?.(r.id)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); p.onEnterRoom?.(r.id); } if (e.key === ' ') { e.preventDefault(); p.onRoom?.(r.id); } }}><rect width="220" height="100" rx="12" fill="#292137" stroke={p.selectedRoom === r.id ? '#d8b8ff' : '#78618d'} strokeWidth="2" /><text x="16" y="25" fill="#af97cb" fontSize="10">{r.sourceDesignId ? '关联空间' : '房间'} · {r.view === 'grid' ? '网格' : '二维'}</text><text x="16" y="52" fill="#f2e8ff" fontSize="14">{r.name.length > 15 ? r.name.slice(0, 14) + '…' : r.name}</text><text x="16" y="82" fill="#af97cb" fontSize="11">双击进入布局 ↘</text></g>; }) : objects.map(o => {
          const g = objectGeometry(o, s), x = preview?.id === o.id ? preview.x : g.x * unit, y = preview?.id === o.id ? preview.y : g.y * unit, w = g.width * unit, h = g.height * unit, color = stageColors[o.color], count = counts?.get(o.id) ?? 0;
          return <g key={o.id} role="button" tabIndex={0} aria-label={'选择空间对象：' + (o.name || '未命名')} className={'sp-object st-object' + (p.selected === o.id ? ' selected' : '')} data-object-id={o.id} data-world-x={g.x} data-world-y={g.y} transform={`translate(${x} ${y})`} onPointerDown={e => { if (e.button === 0 && p.onMove) { p.onObject?.(o.id); begin(e, 'object', o.id, x, y); } }} onClick={() => { if (!p.onMove) p.onObject?.(o.id); }} onKeyDown={e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); p.onObject?.(o.id); } }}>
            <g transform={`rotate(${o.geometry ? g.rotation : 0} ${w / 2} ${h / 2})`}>{g.shape === 'circle' ? <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} fill={color + '25'} stroke={color} strokeWidth={p.selected === o.id ? 3 : 1.2} /> : <rect x="3" y="3" width={Math.max(1, w - 6)} height={Math.max(1, h - 6)} rx="6" fill={color + '30'} stroke={color} strokeWidth={p.selected === o.id ? 3 : 1.2} />}</g>
            {!(o.rangeShape === 'ring' && o.kind === 'zone') && <>{camera.zoom >= .7 && o.kind !== 'zone' && <text x={w / 2} y={h / 2 - 5} textAnchor="middle" fill={color} fontSize="9">{stageKinds[o.kind]}</text>}<text x={o.kind === 'zone' ? 8 / camera.zoom : w / 2} y={o.kind === 'zone' ? 17 / camera.zoom : h / 2 + (camera.zoom >= .7 ? 12 : 4 / camera.zoom)} textAnchor={o.kind === 'zone' ? 'start' : 'middle'} fill="#f2ebfb" fontSize={11 / camera.zoom}>{o.name.length > 12 ? o.name.slice(0, 11) + '…' : o.name || '未命名'}</text></>}
            {!!count && <g><circle cx={w - 6} cy="5" r="13" fill="#d7b8fa" /><text x={w - 6} y="9" textAnchor="middle" fontSize="10" fill="#24182f">{count > 999 ? '999+' : count}</text></g>}<title>{o.name} · ({g.x}, {g.y}) {s.unit}；{o.notes}</title>
          </g>;
        })}
      </g>
    </svg>
    {view === 'rooms' && !a.rooms.length && <p className="sp-empty">添加房间，连出区域之间的通路。<br />双击房间进入内部布局。</p>}
    </div><div className="sp-canvas-footer"><span>{view === 'rooms' ? `${a.rooms.length} 个房间 · ${a.connections.length} 条连接` : `${objects.length} 个对象 · 每格 ${s.cellSize} ${s.unit}`}<small>滚轮缩放 · 右键平移 · 左键拖动</small></span><div className="gp-actions"><button className="gp-icon" aria-label="缩小布局" onClick={() => zoomAt(.8)}><Minus size={14} /></button><output aria-label="空间缩放比例">{Math.round(camera.zoom * 100)}%</output><button className="gp-icon" aria-label="放大布局" onClick={() => zoomAt(1.25)}><Plus size={14} /></button><button className="gp-icon" aria-label="定位所选空间对象" onClick={() => setCamera(fitCamera(true))}><Crosshair size={14} /></button><button className="gp-icon" aria-label="适应全部空间" onClick={() => setCamera(fitCamera())}><Maximize2 size={14} /></button><button className="gp-icon" aria-label="重置布局缩放" onClick={() => setCamera({ x: 40, y: 40, zoom: 1 })}><RotateCcw size={14} /></button></div></div>
  </div>;
}
