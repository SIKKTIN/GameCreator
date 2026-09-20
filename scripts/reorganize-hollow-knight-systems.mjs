import { validateFunctionalSystems } from '../src/functional-systems.ts';

const skillId = 'hk-system-skills', combatId = 'hk-system-combat';
const enemyId = 'hk-system-enemy-skills', aiId = 'hk-system-enemy-ai';
const before = {
  [skillId]: { name: '技能系统', purpose: '定义各动作的释放条件、阶段、结束和打断。', boundary: '每个技能只有一份执行定义；调用移动、角色状态和战斗能力。玩家冲刺与首领冲刺斩击是不同功能。' },
  [combatId]: { name: '战斗系统', purpose: '收集命中意图、结算伤害并驱动敌人决策。', boundary: '负责战斗时序和命中去重；永久击败/掉落归进度事务，基础位移归移动系统。' },
};
const moves = { 'hk-cap-boss-lunge': [skillId, enemyId], 'hk-cap-boss-slam': [skillId, enemyId], 'hk-cap-enemy-decision': [combatId, aiId] };
const originalMembers = {
  [skillId]: ['hk-cap-player-dash', 'hk-cap-nail', 'hk-cap-focus', 'hk-cap-boss-lunge', 'hk-cap-boss-slam'],
  [combatId]: ['hk-cap-damage', 'hk-cap-enemy-decision'],
};

// Explicit template maintenance: never runs when a user simply opens a project.
// Functional IDs, execution details, dependencies and gameplay/art references stay intact.
export function reorganizeHollowKnightSystems(value, timestamp = new Date().toISOString()) {
  const store = validateFunctionalSystems(value), byId = new Map(store.systems.map(s => [s.id, s]));
  if (!byId.has(skillId)) return { changed: false, reason: '不是待整理的空洞骑士模板', store };
  if (byId.get(skillId).name === '玩家能力系统' && byId.has(enemyId) && byId.has(aiId) && Object.entries(moves).every(([id, [, target]]) => store.capabilities.find(c => c.id === id)?.systemId === target)) return { changed: false, reason: '已完成职责整理', store };
  if (byId.has(enemyId) || byId.has(aiId)) return { changed: false, reason: '新系统标识已被使用，保留当前内容', store };
  for (const [id, fields] of Object.entries(before)) {
    const system = byId.get(id), caps = store.capabilities.filter(c => c.systemId === id);
    if (!system || system.archived || Object.entries(fields).some(([k, v]) => system[k] !== v) || caps.length !== originalMembers[id].length || caps.some(c => c.archived || !originalMembers[id].includes(c.id))) return { changed: false, reason: '系统职责、归属或归档状态已自定义，保留当前内容', store };
  }
  const next = structuredClone(store);
  Object.assign(next.systems.find(s => s.id === skillId), {
    name: '玩家能力系统', purpose: '响应玩家操作，管理玩家冲刺、普通攻击和聚焦治疗的释放与执行规则。',
    boundary: '负责玩家能力的解锁检查、冷却、空中次数与资源使用；调用输入、角色状态、移动和战斗能力。敌人技能由敌人技能系统定义，AI 决策由敌人 AI 系统负责。', updatedAt: timestamp,
  });
  Object.assign(next.systems.find(s => s.id === combatId), {
    purpose: '收集玩家、敌人和环境的命中意图，统一结算伤害与受击结果。',
    boundary: '负责命中去重、伤害和同帧结算顺序；不选择敌人技能或管理 AI 阶段。永久击败与掉落交给进度事务，基础位移交给移动系统。', updatedAt: timestamp,
  });
  const system = (id, name, purpose, boundary) => ({ id, name, purpose, boundary, archived: false, createdAt: timestamp, updatedAt: timestamp });
  next.systems.splice(next.systems.findIndex(s => s.id === skillId) + 1, 0,
    system(enemyId, '敌人技能系统', '执行普通敌人与 Boss 的攻击动作，管理预警、锁定目标、有效窗口与恢复阶段。', '接收敌人 AI 指令并使用独立的敌人技能参数；调用共享移动与伤害结算。技能选择和阶段切换归敌人 AI，不使用玩家按键、能力解锁或空中次数规则。'),
    system(aiId, '敌人 AI 系统', '根据战斗状态和永久进度驱动普通敌人、试炼守卫与 Boss 的决策、阶段切换和重置。', '负责何时行动、选择何种攻击以及世界重置时是否生成。具体攻击交给敌人技能，命中交给战斗系统，永久击败与奖励交给进度与存档系统。'),
  );
  for (const capability of next.capabilities) if (moves[capability.id]) Object.assign(capability, { systemId: moves[capability.id][1], updatedAt: timestamp });
  return { changed: true, store: validateFunctionalSystems(next) };
}
