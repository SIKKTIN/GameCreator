export type PrototypeExampleId = 'hollow-knight' | 'stardew-valley' | 'plants-vs-zombies';
export type PrototypeImportInput = { exampleId: PrototypeExampleId; name: string };
export type PrototypeExampleSummary = {
  id: PrototypeExampleId;
  title: string;
  name: string;
  description: string;
  counts: { gameplay: number; systems: number; requirements: number; assets: number; tables: number; records: number; stories: number };
};

// Only the small catalog is loaded at startup. The selected design is bundled
// into a separate local chunk, so desktop and web builds use the same examples.
export const prototypeExamples: readonly PrototypeExampleSummary[] = [
  {
    id: 'hollow-knight', title: '空洞骑士', name: '空洞骑士 · 裂隙回路原型',
    description: '四个房间串联跑跳、冲刺、骨钉战斗、双阶段首领与死亡回收。美术需求共用玩家动作、门组件、资源HUD与命中反馈。',
    counts: { gameplay: 8, systems: 7, requirements: 26, assets: 39, tables: 8, records: 93, stories: 1 },
  },
  {
    id: 'stardew-valley', title: '星露谷物语', name: '星露谷物语 · 七日农场原型',
    description: '七天内在农场与村庄进行工具操作、种植、采购、出货和村民委托。美术需求覆盖场景、作物状态、物品复用及经营界面。',
    counts: { gameplay: 6, systems: 8, requirements: 23, assets: 34, tables: 9, records: 78, stories: 1 },
  },
  {
    id: 'plants-vs-zombies', title: '植物大战僵尸', name: '植物大战僵尸 · 最小原型',
    description: '在五行九列草坪上收集阳光、种植三类植物并抵挡三波僵尸。美术需求覆盖单位、同路战斗、资源与对局状态。',
    counts: { gameplay: 5, systems: 7, requirements: 20, assets: 32, tables: 4, records: 17, stories: 1 },
  },
];

export async function loadPrototypeExample(id: PrototypeExampleId): Promise<unknown> {
  switch (id) {
    case 'hollow-knight': return structuredClone((await import('../examples/prototypes/hollow-knight.json')).default);
    case 'stardew-valley': return structuredClone((await import('../examples/prototypes/stardew-valley.json')).default);
    case 'plants-vs-zombies': return structuredClone((await import('../examples/prototypes/plants-vs-zombies.json')).default);
    default: throw new Error('没有找到所选原型示例，请重新选择。');
  }
}
