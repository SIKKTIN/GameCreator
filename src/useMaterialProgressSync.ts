import {useEffect,useState} from 'react';
import {reconcileMaterialProgress} from './material-progress';
import type {useProjectSchedule} from './useProjectSchedule';
import type {ArtController} from './useArtAssets';

export function useMaterialProgressSync(schedule:ReturnType<typeof useProjectSchedule>,art:ArtController) {
  const [error,setError]=useState('');
  useEffect(()=>{
    if(schedule.blocked||schedule.pending||art.blocked||art.pending)return;
    if(reconcileMaterialProgress(art.store,schedule.store)===art.store){setError('');return;}
    try {
      if(!schedule.isCurrent())throw new Error('排期在其他窗口发生变化，请重新读取后同步素材进度');
      art.update(current=>{
        if(!schedule.isCurrent())throw new Error('排期已变化，素材进度同步已停止');
        return reconcileMaterialProgress(current,schedule.store);
      });setError('');
    }catch(e){setError(String(e));}
  },[schedule.store,schedule.blocked,schedule.pending,art.store,art.blocked,art.pending]);
  return error;
}
