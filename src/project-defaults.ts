import type { DataRecord, DatasetKey, DatasetDef, ProjectData } from './data-model.ts';
import type { StoryDoc } from './story-model.ts';

export type Milestone = {
  title: string;
  owner: string;
  due: string;
  status: 'done' | 'active' | 'planned';
};


const initialRows: DataRecord[] = [
  { id: 'sword_001', name: '铁制长剑', type: 'weapon', value: '120', rarity: '普通' },
  { id: 'potion_hp', name: '生命药水', type: 'consumable', value: '50', rarity: '普通' },
  { id: 'armor_iron', name: '铁甲', type: 'armor', value: '280', rarity: '稀有' },
  { id: 'gold_pack', name: '金币袋', type: 'currency', value: '1000', rarity: '史诗' },
];

export const datasetDefinitions: DatasetDef[] = [
  { key: 'items', label: 'Items', badge: '24', columns: [{ key: 'id', label: 'ID' }, { key: 'name', label: '名称' }, { key: 'type', label: '类型', type: 'enum', enumName: 'EItemType', options: ['weapon', 'armor', 'consumable', 'currency'] }, { key: 'value', label: '价值' }, { key: 'rarity', label: '稀有度', type: 'enum', enumName: 'EItemRarity', options: ['普通', '稀有', '史诗', '传说'] }] },
  { key: 'characters', label: 'Characters', badge: '12', columns: [{ key: 'id', label: 'ID' }, { key: 'name', label: '名称' }, { key: 'class', label: '职业' }, { key: 'level', label: '等级' }, { key: 'faction', label: '阵营' }] },
  { key: 'skills', label: 'Skills', badge: '36', columns: [{ key: 'id', label: 'ID' }, { key: 'name', label: '名称' }, { key: 'cost', label: '消耗' }, { key: 'cooldown', label: '冷却' }, { key: 'category', label: '类型' }] },
  { key: 'economy', label: 'Economy', badge: '8', columns: [{ key: 'id', label: 'ID' }, { key: 'name', label: '名称' }, { key: 'initial', label: '初始值' }, { key: 'output', label: '产出方式' }, { key: 'note', label: '备注' }] },
  { key: 'shop', label: 'Shop', badge: '16', columns: [{ key: 'id', label: 'ID' }, { key: 'itemID', label: '商品 Item ID', type: 'reference', reference: 'items' }, { key: 'price', label: '价格' }, { key: 'limit', label: '限购' }, { key: 'status', label: '状态', type: 'enum', enumName: 'EShopStatus', options: ['上架', '下架'] }] },
];

const initialDatasets: Record<DatasetKey, DataRecord[]> = {
  items: initialRows,
  characters: [{ id: 'char_001', name: '艾拉', class: '游侠', level: '12', faction: '灰炉' }, { id: 'char_002', name: '诺恩', class: '机械师', level: '8', faction: '流亡者' }, { id: 'char_003', name: '伊芙', class: '星术士', level: '15', faction: '议会' }],
  skills: [{ id: 'skill_dash', name: '星闪', cost: '30', cooldown: '8', category: '移动' }, { id: 'skill_burst', name: '裂空斩', cost: '45', cooldown: '12', category: '攻击' }, { id: 'skill_guard', name: '星盾', cost: '25', cooldown: '18', category: '防御' }],
  economy: [{ id: 'currency_gold', name: '金币', initial: '100', output: '任务奖励', note: '基础货币' }, { id: 'currency_star', name: '星砂', initial: '0', output: '采集与副本', note: '强化材料' }, { id: 'shop_discount', name: '商店折扣', initial: '0.9', output: '声望等级', note: '乘数' }],
  shop: [{ id: 'shop_sword_001', itemID: 'sword_001', price: '180', limit: '1', status: '上架' }, { id: 'shop_potion_hp', itemID: 'potion_hp', price: '65', limit: '5', status: '上架' }, { id: 'shop_old_armor', itemID: 'missing_item', price: '420', limit: '1', status: '下架' }],
};

export const initialData: ProjectData = {
  datasets: initialDatasets,
  columns: Object.fromEntries(datasetDefinitions.map((item) => [item.key, item.columns])) as ProjectData['columns'],
};

export const initialMilestones: Milestone[] = [
  { title: '核心玩法验证', owner: '林默', due: '2026/09/18', status: 'done' },
  { title: '战斗数值第一版', owner: '陈溪', due: '2026/09/26', status: 'active' },
  { title: '首个可玩版本', owner: '全体成员', due: '2026/10/12', status: 'planned' },
];


export const initialProject = {
    name: 'Project Aurora',
    genre: '动作 RPG',
    platform: 'PC / Steam',
    version: 'v0.8.0',
    status: '制作中',
    description:
      '一款以极光大陆为舞台的动作角色扮演游戏。玩家将穿越失落城邦，收集星核并决定世界的最终走向。',
  };

export const emptyStories: StoryDoc[] = [];
export const emptyMilestones: Milestone[] = [];
export const emptyProjectData: ProjectData = { columns: initialData.columns, datasets: Object.fromEntries(datasetDefinitions.map(item => [item.key, []])) };