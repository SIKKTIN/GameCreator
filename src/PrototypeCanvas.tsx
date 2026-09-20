import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { GameplayDesign } from './gameplay';
import type { ArtStore, ArtFile } from './art-assets';
import { stageColors } from './gameplay-stage';
import { prototypeVisible, prototypeGeometry, type PrototypeScene, type PrototypeElement, type PrototypeRuntime } from './prototype-design';

function AssetImage({ file, workspaceId, width, height }: { file?: ArtFile; workspaceId: string; width: number; height: number }) {
  const [data, setData] = useState('');
  useEffect(() => { let alive = true; setData('');
    if (file && /^image\/(png|jpeg|webp|gif|bmp|avif)$/i.test(file.mime)) window.desktopClient?.artFiles?.readPreview(workspaceId, file.storagePath).then(result => { if (alive && /^data:image\/(png|jpeg|webp|gif|bmp|avif);base64,[a-z0-9+/=]+$/i.test(result?.dataUrl || '')) setData(result!.dataUrl); }).catch(() => {});
    return () => { alive = false; };
  }, [workspaceId, file?.id, file?.storagePath]);
  return data ? <image href={data} width={width} height={height} preserveAspectRatio="xMidYMid meet" onError={() => setData('')} /> : <text x={width / 2} y={height / 2} textAnchor="middle" dominantBaseline="middle" fill="#ebe3f4" fontSize="16">{file ? '图片不可预览' : '图片占位'}</text>;
}
export function PrototypeCanvas({ scene, designs, art, workspaceId, selected = '', onSelect, onMove, runtime, onActivate, disabled }: { scene: PrototypeScene; designs: GameplayDesign[]; art: ArtStore; workspaceId: string; selected?: string; onSelect?: (id: string) => void; onMove?: (id: string, x: number, y: number) => void; runtime?: PrototypeRuntime; onActivate?: (id: string) => void; disabled?: boolean }) {
  const svg = useRef<SVGSVGElement>(null), world = useRef<SVGGElement>(null);
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const [draft, setDraft] = useState<{ id: string; x: number; y: number } | null>(null);
  const gesture = useRef<{ pointer: number; kind: 'pan' | 'element'; start: { x: number; y: number }; original: { x: number; y: number }; id: string; moved: boolean } | null>(null);
  const cancel = () => { const g = gesture.current; gesture.current = null; setDraft(null); if (g && svg.current?.hasPointerCapture(g.pointer)) svg.current.releasePointerCapture(g.pointer); };
  useEffect(() => { const blur = () => cancel(), hidden = () => { if (document.hidden) cancel(); }, key = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel(); }; window.addEventListener('blur', blur); document.addEventListener('visibilitychange', hidden); window.addEventListener('keydown', key); return () => { window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('keydown', key); }; }, []);
  const point = (clientX: number, clientY: number, root = false) => { const matrix = (root ? svg.current : world.current)?.getScreenCTM(); return matrix ? new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse()) : { x: 0, y: 0 }; };
  useEffect(() => { const el = svg.current; if (!el || runtime) return; const wheel = (e: WheelEvent) => { e.preventDefault(); if (gesture.current) return; const p = point(e.clientX, e.clientY, true); setCamera(c => { const zoom = Math.max(.25, Math.min(3, c.zoom * Math.exp(-Math.max(-200, Math.min(200, e.deltaY)) * .003))), ratio = zoom / c.zoom; return { x: p.x - (p.x - c.x) * ratio, y: p.y - (p.y - c.y) * ratio, zoom }; }); }; el.addEventListener('wheel', wheel, { passive: false }); return () => el.removeEventListener('wheel', wheel); }, [!!runtime]);
  const begin = (e: PointerEvent, element?: PrototypeElement) => {
    if (runtime || gesture.current || ![0, 2].includes(e.button)) return;
    if (e.button === 0) { onSelect?.(element?.id || ''); if (!element || element.sourceObjectId || disabled || !onMove) return; }
    e.preventDefault(); e.stopPropagation(); const pan = e.button === 2;
    gesture.current = { pointer: e.pointerId, kind: pan ? 'pan' : 'element', start: point(e.clientX, e.clientY, pan), original: pan ? camera : element!, id: element?.id || '', moved: false }; svg.current?.setPointerCapture(e.pointerId);
  };
  const position = (e: PointerEvent) => { const g = gesture.current!; const p = point(e.clientX, e.clientY, g.kind === 'pan'); return { x: g.original.x + p.x - g.start.x, y: g.original.y + p.y - g.start.y }; };
  const finish = (e: PointerEvent) => { const g = gesture.current; if (!g || e.pointerId !== g.pointer) return; const p = position(e); if (g.kind === 'element' && g.moved) onMove?.(g.id, Math.round(p.x), Math.round(p.y)); cancel(); };
  const geometry = prototypeGeometry(scene, designs);
  return <div className="pd-frame-wrap"><svg ref={svg} className="pd-frame" role="group" aria-label={runtime ? '原型运行画面' : '原型编辑画布'} viewBox={`0 0 ${scene.width} ${scene.height}`} style={{ aspectRatio: `${scene.width}/${scene.height}`, background: scene.background }} onContextMenu={e => e.preventDefault()} onPointerDown={e => begin(e)} onPointerMove={e => { const g = gesture.current; if (!g || g.pointer !== e.pointerId) return; const p = position(e); if (Math.abs(p.x - g.original.x) + Math.abs(p.y - g.original.y) > 2) g.moved = true; if (g.kind === 'pan') setCamera(c => ({ ...c, ...p })); else if (g.moved) setDraft({ id: g.id, ...p }); }} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel}>
    <g ref={world} transform={runtime ? undefined : `translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>
      <rect width={scene.width} height={scene.height} fill={scene.background} />
      {geometry.grid && <g pointerEvents="none">{Array.from({ length: geometry.grid.rows }, (_, r) => Array.from({ length: geometry.grid!.columns }, (_, c) => <rect key={`${r}-${c}`} x={geometry.grid!.x + c * geometry.grid!.cell} y={geometry.grid!.y + r * geometry.grid!.cell} width={geometry.grid!.cell} height={geometry.grid!.cell} fill={(r + c) % 2 ? '#273d35' : '#21362f'} stroke="#526651" strokeWidth=".6" />))}</g>}
      {geometry.objects.map(g => <g key={g.object.id} transform={`translate(${g.x} ${g.y}) rotate(${g.rotation} ${g.width / 2} ${g.height / 2})`} pointerEvents="none"><title>{g.object.name}</title>{g.shape === 'circle' ? <ellipse cx={g.width / 2} cy={g.height / 2} rx={g.width / 2} ry={g.height / 2} fill={stageColors[g.object.color] + '50'} stroke={stageColors[g.object.color]} /> : <rect width={g.width} height={g.height} rx="3" fill={stageColors[g.object.color] + '50'} stroke={stageColors[g.object.color]} />}<text x={g.width / 2} y={g.height / 2} textAnchor="middle" dominantBaseline="middle" fill="#f5f3ef" fontSize={Math.max(7, Math.min(15, g.width / Math.max(2, g.object.name.length)))}>{g.object.name}</text></g>)}
      {scene.elements.map(e => { const visible = runtime ? prototypeVisible(runtime, e) : true; if (!visible) return null;
        const bound = e.sourceObjectId ? geometry.objects.find(o => o.object.id === e.sourceObjectId) : undefined;
        if (e.sourceObjectId && !bound) return null;
        const g = bound || (draft?.id === e.id ? { ...e, ...draft } : e), rotation = bound?.rotation || 0;
        const active = !!runtime && e.action.kind !== 'none';
        const file = art.assets.find(a => a.id === e.assetId)?.versions.find(v => v.id === e.versionId)?.files.find(f => f.id === e.fileId);
        return <g key={e.id} data-element={e.id} role="button" tabIndex={runtime && !active ? -1 : 0} aria-label={(runtime ? '交互：' : '选择元素：') + e.name} transform={`translate(${g.x} ${g.y}) rotate(${rotation} ${g.width / 2} ${g.height / 2})`} opacity={!runtime && !e.visible ? .4 : 1} style={{ cursor: active ? 'pointer' : runtime ? 'default' : e.sourceObjectId ? 'pointer' : 'move' }} onPointerDown={ev => { if (!runtime) { ev.stopPropagation(); begin(ev, e); } }} onClick={() => { if (runtime && active) onActivate?.(e.id); }} onKeyDown={ev => { if (['Enter', ' '].includes(ev.key)) { ev.preventDefault(); if (runtime) { if (active) onActivate?.(e.id); } else onSelect?.(e.id); } }}>
          <rect width={g.width} height={g.height} rx={e.kind === 'button' ? 8 : 2} fill={e.kind === 'text' ? 'transparent' : e.kind === 'hotspot' ? (runtime ? 'transparent' : e.color + '22') : e.color} stroke={selected === e.id && !runtime ? '#dcc9ff' : e.kind === 'hotspot' && !runtime ? e.color : 'none'} strokeWidth="2" strokeDasharray={e.kind === 'hotspot' ? '6 4' : undefined} />
          {e.kind === 'image' ? <AssetImage file={file} workspaceId={workspaceId} width={g.width} height={g.height} /> : e.kind !== 'shape' && (e.kind !== 'hotspot' || !runtime) && <text x={g.width / 2} y={g.height / 2} textAnchor="middle" dominantBaseline="middle" fill={e.kind === 'text' ? e.color : '#ffffff'} fontSize={Math.max(8, Math.min(e.fontSize, g.width / Math.max(1, Array.from(e.text).length) * 1.7))} pointerEvents="none">{e.text}</text>}
          {!runtime && selected === e.id && <rect x="-3" y="-3" width={g.width + 6} height={g.height + 6} fill="none" stroke="#dcc9ff" strokeDasharray="5 3" pointerEvents="none" />}
          <title>{e.name}{e.sourceObjectId ? ' · 跟随空间对象' : ''}</title>
        </g>;
      })}
    </g>
  </svg>{!runtime && <div className="pd-canvas-footer"><span>滚轮缩放 · 右键平移 · 左键拖动元素</span><button onClick={() => { cancel(); setCamera({ x: 0, y: 0, zoom: 1 }); }}>适配画面 · {Math.round(camera.zoom * 100)}%</button></div>}</div>;
}
