import { useEffect, useRef, useState } from 'react';
import { beforeLogoutEvent } from './auth';
import { leaveTeamEvent, TeamError, teamRequest, type TeamSession } from './team-api';
import { workspaceStorage } from './workspace-storage';
import { sameRecordFields, type TeamRecord } from './overview-model';
type Draft<F> = { base: TeamRecord<F>; fields: F };
export function useTeamRecord<F>({ record, session, route, draftKey, normalize, readOnly, onSaved }: {
  record: TeamRecord<F>; session: TeamSession; route: string; draftKey: string;
  normalize: (value: unknown, draft?: boolean) => F; readOnly: boolean; onSaved: (record: TeamRecord<F>) => void;
}) {
  const [initial] = useState(() => {
    try {
      const raw = workspaceStorage.getItem(draftKey), value: Draft<F> | null = raw ? JSON.parse(raw) : null;
      if (value && (!value.base || value.base.id !== record.id || !Number.isSafeInteger(value.base.revision) || value.base.revision < 0)) throw new Error('草稿所属内容或版本无效');
      const base = value ? { ...value.base,fields:normalize(value.base.fields,true) } : record;
      return { frame:{base,fields:value ? normalize(value.fields,true) : record.fields},error:'' };
    } catch { return { frame:{base:record,fields:record.fields},error:'本机草稿格式异常，已停止编辑。请修复草稿存档后重新进入。' }; }
  });
  const [frame,setFrame] = useState(initial.frame), [diskError,setDiskError] = useState(initial.error), [error,setError] = useState('');
  const [saving,setSaving] = useState(false), [conflict,setConflict] = useState<TeamRecord<F> | null>(null);
  const current = useRef(frame), operating = useRef(false), alive = useRef(true), saved = useRef(onSaved); saved.current = onSaved;
  const dirty = !sameRecordFields(frame.fields,frame.base.fields);
  useEffect(() => { alive.current=true; return () => { alive.current=false; }; },[]);
  const persist = (next: Draft<F>) => {
    try {
      if (initial.error) throw new Error(initial.error);
      workspaceStorage.setItem(draftKey,JSON.stringify(next.base.revision > 0 && sameRecordFields(next.fields,next.base.fields) ? null : next));
      setDiskError(''); return true;
    } catch { setDiskError('草稿尚未保存到本机，请保持窗口打开并重试。'); return false; }
  };
  const change = (next: Draft<F>) => { current.current=next; setFrame(next); persist(next); };
  useEffect(() => {
    if (initial.error || record.revision <= current.current.base.revision) return;
    const pending = !sameRecordFields(current.current.fields,current.current.base.fields);
    if (!pending && !operating.current) {
      const next={base:record,fields:record.fields};current.current=next;setFrame(next);setConflict(null);setError('');
    } else if (sameRecordFields(current.current.fields,record.fields)) {
      change({base:record,fields:record.fields}); setConflict(null); setError('');
      if (pending) saved.current(record);
    } else setConflict(record);
  },[record]);
  useEffect(() => {
    const mustStay = () => operating.current || (!!diskError && !initial.error);
    const guard = (event: Event) => { if (mustStay()) event.preventDefault(); };
    const unload = (event: BeforeUnloadEvent) => { if (mustStay()) { event.preventDefault(); event.returnValue=''; } };
    window.addEventListener(leaveTeamEvent,guard); window.addEventListener(beforeLogoutEvent,guard); window.addEventListener('beforeunload',unload);
    return () => { window.removeEventListener(leaveTeamEvent,guard); window.removeEventListener(beforeLogoutEvent,guard); window.removeEventListener('beforeunload',unload); };
  },[diskError,initial.error]);
  const save = async () => {
    if (operating.current || readOnly || initial.error || conflict) return;
    operating.current=true; setSaving(true); setError('');
    try {
      const fields = normalize(current.current.fields);
      const result = await teamRequest<{record:TeamRecord<F>}>(session.url,route,session.token,'PUT',{fields,revision:current.current.base.revision});
      if (!alive.current) return;
      change({base:result.record,fields:result.record.fields}); setConflict(null); saved.current(result.record);
    } catch (reason) {
      if (!alive.current) return;
      setError((reason as Error).message);
      const latest = reason instanceof TeamError && reason.status === 409 ? reason.currentRecord as TeamRecord<F> | undefined : undefined;
      if (latest?.id === record.id) {
        if (sameRecordFields(current.current.fields,latest.fields)) { change({base:latest,fields:latest.fields}); setError(''); setConflict(null); saved.current(latest); }
        else setConflict(latest);
      }
    } finally { operating.current=false; if (alive.current) setSaving(false); }
  };
  return { fields:frame.fields,base:frame.base,dirty,saving,error,diskError,conflict,blocked:!!initial.error,save,
    update:(fields:F) => { setError(''); change({...current.current,fields}); }, retry:() => persist(current.current),
    resolve:(keep:boolean) => { if (!conflict) return; change({base:conflict,fields:keep ? current.current.fields : conflict.fields}); setConflict(null); setError(''); } };
}
