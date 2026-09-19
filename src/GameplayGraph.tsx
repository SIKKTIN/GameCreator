import { useId, useState } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
export type DiagramNode = { id: string; label: string; tag?: string; description?: string; tone?: string };
export type DiagramEdge = { id: string; from: string; to: string; label: string; tone?: string };
export function GameplayGraph({ nodes, edges, rootId, selectedNode, selectedEdge, onNode, onEdge, label }: {
  nodes: DiagramNode[]; edges: DiagramEdge[]; rootId?: string; selectedNode?: string; selectedEdge?: string;
  onNode: (id: string) => void; onEdge?: (id: string) => void; label: string;
}) {
  const [zoom, setZoom] = useState(1); const prefix = useId().replace(/:/g, '');
  const ids = new Set(nodes.map(n => n.id)); const validEdges = edges.filter(e => ids.has(e.from) && ids.has(e.to));
  const ranks = new Map<string, number>(); const starters = rootId && ids.has(rootId) ? [rootId] : nodes.filter(n => !validEdges.some(e => e.to === n.id)).map(n => n.id);
  const queue = starters.length ? [...starters] : nodes.slice(0, 1).map(n => n.id); queue.forEach(id => ranks.set(id, 0));
  for (let i = 0; i < queue.length; i++) for (const edge of validEdges.filter(e => e.from === queue[i])) if (!ranks.has(edge.to)) { ranks.set(edge.to, Math.min(3, (ranks.get(edge.from) ?? 0) + 1)); queue.push(edge.to); }
  const lastRank = Math.max(0, ...ranks.values()); for (const n of nodes) if (!ranks.has(n.id)) ranks.set(n.id, Math.min(3, lastRank + 1));
  const columns = Array.from({ length: Math.max(0, ...ranks.values()) + 1 }, (_, rank) => nodes.filter(n => ranks.get(n.id) === rank));
  const maxRows = Math.max(1, ...columns.map(c => c.length)); const positions = new Map<string, { x: number; y: number }>();
  columns.forEach((column, x) => column.forEach((node, y) => positions.set(node.id, { x: 135 + x * 265, y: 78 + ((maxRows - column.length) / 2 + y) * 114 })));
  const coreHeight = 145 + (maxRows - 1) * 114;
  let backCount = 0, sideCount = 0, rightmost = 0;
  const routes = validEdges.map(edge => {
    const a = positions.get(edge.from)!, b = positions.get(edge.to)!; let path: string, x: number, y: number;
    if (b.x > a.x) { path = `M ${a.x + 94} ${a.y} C ${a.x + 145} ${a.y}, ${b.x - 145} ${b.y}, ${b.x - 94} ${b.y}`; x = (a.x + b.x) / 2; y = (a.y + b.y) / 2 - 10; }
    else if (b.x === a.x) {
      const rail = a.x + 130 + (sideCount++ % 5) * 34;
      if (edge.from === edge.to) { path = `M ${a.x + 50} ${a.y - 34} C ${a.x + 190} ${a.y - 100}, ${a.x + 210} ${a.y + 40}, ${a.x + 94} ${a.y + 8}`; x = a.x + 146; y = a.y - 42; }
      else { path = `M ${a.x + 94} ${a.y} C ${rail} ${a.y}, ${rail} ${b.y}, ${b.x + 94} ${b.y}`; x = (a.x + 94) * .25 + rail * .75; y = (a.y + b.y) / 2; }
    } else { const index = backCount++, rail = coreHeight + 30 + index * 42, outside = a.x + 124 + index * 23, target = b.x - 60 + (index % 5) * 25, start = a.y - 10 + (index % 3) * 10; rightmost = Math.max(rightmost, outside); path = `M ${a.x + 94} ${start} H ${outside - 12} Q ${outside} ${start} ${outside} ${start + 12} V ${rail - 12} Q ${outside} ${rail} ${outside - 12} ${rail} H ${target + 12} Q ${target} ${rail} ${target} ${rail - 12} V ${b.y + 34}`; x = target + (outside - target) * .5; y = rail; }
    return { ...edge, path, x, y };
  });
  const width = Math.max(600, rightmost + 32, 310 + (columns.length - 1) * 265 + (sideCount ? 170 : 0));
  const height = coreHeight + (backCount ? 48 + backCount * 42 : 18);
  const colors: Record<string, string> = { depends: '#aa90ed', contains: '#7ea9db', collaborates: '#63b9a5', flow: '#ac92df', call: '#aa90ed', data: '#7ea9db', event: '#63b9a5' };
  const short = (s: string) => s.length > 13 ? s.slice(0, 12) + '…' : s;
  return <div className="gs-graph-shell">
    <div className="gs-graph-tools"><span>{label} · 点击节点查看{onEdge ? '，点击连线编辑' : ''}</span><div className="gp-actions">
      <button className="gp-icon" aria-label="缩小图形" disabled={zoom <= .75} onClick={() => setZoom(v => Math.max(.75, v - .25))}><Minus size={14} /></button><small>{Math.round(zoom * 100)}%</small>
      <button className="gp-icon" aria-label="放大图形" disabled={zoom >= 2} onClick={() => setZoom(v => Math.min(2, v + .25))}><Plus size={14} /></button><button className="gp-icon" aria-label="重置图形缩放" onClick={() => setZoom(1)}><RotateCcw size={14} /></button></div></div>
    {!nodes.length ? <p className="gp-placeholder">添加节点后，关系图会自动排列。</p> : <div className="gs-graph-scroll"><svg role="group" aria-label={label} viewBox={`0 0 ${width} ${height}`} style={{ width: `${zoom * 100}%`, minWidth: 540 * zoom }}>
      <defs>{Object.entries(colors).map(([key, color]) => <marker key={key} id={prefix + key} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={color} /></marker>)}</defs>
      {routes.map(edge => { const color = colors[edge.tone ?? 'flow'] ?? colors.flow; const active = selectedEdge === edge.id || (!selectedEdge && (selectedNode === edge.from || selectedNode === edge.to));
        return <g key={edge.id} className={'gs-edge' + (active ? ' selected' : '')} role={onEdge ? 'button' : undefined} tabIndex={onEdge ? 0 : undefined}
          aria-label={`${label}连线：${nodes.find(n => n.id === edge.from)?.label} → ${nodes.find(n => n.id === edge.to)?.label} · ${edge.label || '未命名事件'}`}
          onClick={() => onEdge?.(edge.id)} onKeyDown={e => { if (onEdge && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onEdge(edge.id); } }}>
          <title>{edge.label || '未命名事件'}</title><path d={edge.path} fill="none" stroke="transparent" strokeWidth="18" />
          <path d={edge.path} fill="none" stroke={color} strokeWidth={active ? 3 : 1.7} opacity={selectedEdge && !active ? .35 : .85} markerEnd={`url(#${prefix + (edge.tone ?? 'flow')})`} strokeDasharray={['collaborates', 'event'].includes(edge.tone ?? '') ? '5 4' : undefined} />
          <rect x={edge.x - Math.min(91, short(edge.label).length * 6 + 10)} y={edge.y - 14} width={Math.min(182, short(edge.label).length * 12 + 20)} height="26" rx="5" fill="#211c30" stroke={active ? color : '#493954'} />
          <text x={edge.x} y={edge.y + 3} textAnchor="middle" fill={color} fontSize="12">{short(edge.label || '未命名事件')}</text>
        </g>; })}
      {nodes.map(node => { const p = positions.get(node.id)!; return <foreignObject key={node.id} x={p.x - 94} y={p.y - 34} width="188" height="68">
        <button className={'gs-node ' + (node.tone ?? '') + (node.id === selectedNode ? ' selected' : '')} title={node.label + (node.description ? '\n' + node.description : '')} aria-label={'查看节点：' + node.label} onClick={() => onNode(node.id)}>
          <small>{node.tag || '玩法'}</small><strong>{node.label || '未命名'}</strong></button></foreignObject>; })}
    </svg></div>}
  </div>;
}
