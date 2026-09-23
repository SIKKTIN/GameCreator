import {useEffect,useState} from 'react';
import {reconcileToolAcceptance} from './schedule-acceptance';
import type {useProjectSchedule} from './useProjectSchedule';
import type {DevelopmentToolsController} from './useDevelopmentTools';

export function useScheduleAcceptanceSync(schedule:ReturnType<typeof useProjectSchedule>,tools:DevelopmentToolsController) {
  const [error,setError]=useState('');
  useEffect(()=>{
    if(schedule.blocked||schedule.pending||tools.blocked||tools.pending)return;
    if(reconcileToolAcceptance(tools.store,schedule.store)===tools.store){setError('');return;}
    try {
      if(!schedule.isCurrent())throw new Error('排期已在其他窗口变化，请重新读取后同步工具验收');
      tools.update(current=>{
        if(!schedule.isCurrent())throw new Error('排期已变化，本次工具验收同步停止');
        return reconcileToolAcceptance(current,schedule.store);
      });
      setError('');
    }catch(e){setError(String(e));}
  },[schedule.store,schedule.blocked,schedule.pending,tools.store,tools.blocked,tools.pending]);
  return error;
}
