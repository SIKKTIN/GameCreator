import {useState} from 'react';
import {authoringModules,moduleGrants} from '../shared/project-authoring.mjs';
import type {ProjectScheduleStore} from './project-schedule';
import './usage-guide.css';
export function DeveloperPermissions({schedule}:{schedule:ProjectScheduleStore}){
 const [developer,setDeveloper]=useState(''),member=schedule.personnel?.members.find(m=>m.id===developer),grants=moduleGrants(member);
 return <section className="usage-guide" aria-label="开发者权限查询">{<><h3>开发者当前权限</h3><p>制作人默认全部内容模块；其他开发者可明确勾选多个模块。任务分配和人员授权另行管理。</p><select aria-label="查看开发者权限" value={developer} onChange={e=>setDeveloper(e.target.value)}><option value="">选择开发者</option>{schedule.personnel?.members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select>{member&&<><p>{member.active?'已启用':'已停用'} · {member.permissions.join('、')||'无反馈权限'} · {member.developer?.expiresAt?'有效期至 '+member.developer.expiresAt:'长期身份'}</p><p>内容编写仍要求有效、未撤销的本项目长期令牌。过期或停用后不能提交。</p><div className="ug-grants">{Object.entries(authoringModules).map(([id,label])=><span key={id} className={grants.includes(id)?'allowed':''}>{grants.includes(id)?'✓':'—'} {label}</span>)}</div></>}{!schedule.personnel?.members.length&&<p>尚无开发者。请到人员分配创建制作人，可暂不指定任务。</p>}</>}</section>;
}
