import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  AlertTriangle,
  AlignLeft,
  BarChart3,
  Bold,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Database,
  Eye,
  FileText,
  GitBranch,
  Italic,
  Layers,
  Link,
  ListTree,
  Map,
  Pencil,
  Plus,
  Quote,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  Trash2,
  Sparkles,
  Tag,
  Users,
} from 'lucide-react';
import './styles.css';
import './overview.css';
import './story.css';
import './data-config.css';
import './enum-bindings.css';
import { loadEngineConfig, persistEngineConfig, type EngineConfig } from './engine';
import { useEnumRegistry } from './useEnumRegistry';
import { EngineSettings, EnumDefinitions, EnumManager } from './EnginePanels';
import { DataConfiguration } from './DataConfiguration';
import { projectIdentity, type DatasetKey, type DataRecord, type DatasetDef, type ProjectData } from './data-model';
import { AuthGate, type UserRole } from './auth';
import { buildAiMarkdown, saveAiMarkdown } from './ai-export';

type Milestone = {
  title: string;
  owner: string;
  due: string;
  status: 'done' | 'active' | 'planned';
};

type StoryDoc = {
  id: string;
  title: string;
  category: string;
  status: string;
  updated: string;
  summary: string;
  content: string;
  tags: string[];
  outlines: string[];
  relations: {
    characters: string[];
    locations: string[];
    systems: string[];
  };
};

const initialRows: DataRecord[] = [
  { id: 'sword_001', name: '铁制长剑', type: 'weapon', value: '120', rarity: '普通' },
  { id: 'potion_hp', name: '生命药水', type: 'consumable', value: '50', rarity: '普通' },
  { id: 'armor_iron', name: '铁甲', type: 'armor', value: '280', rarity: '稀有' },
  { id: 'gold_pack', name: '金币袋', type: 'currency', value: '1000', rarity: '史诗' },
];

const datasetDefinitions: DatasetDef[] = [
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

const initialData: ProjectData = {
  datasets: initialDatasets,
  columns: Object.fromEntries(datasetDefinitions.map((item) => [item.key, item.columns])) as ProjectData['columns'],
};

const initialMilestones: Milestone[] = [
  { title: '核心玩法验证', owner: '林默', due: '2026/09/18', status: 'done' },
  { title: '战斗数值第一版', owner: '陈溪', due: '2026/09/26', status: 'active' },
  { title: '首个可玩版本', owner: '全体成员', due: '2026/10/12', status: 'planned' },
];

const initialStoryDocs: StoryDoc[] = [
  {
    id: 'world_overview',
    title: '世界背景总览',
    category: '世界观',
    status: '草稿',
    updated: '今天 15:12',
    summary: '极光大陆由七座浮空城邦组成，星核能源维持着秩序，也埋下了战争的引线。',
    content:
      '极光大陆曾经是一整块完整的陆地。星坠事件之后，大地断裂为七座浮空城邦，每座城邦都依靠星核维持重力、气候和能源。\n\n玩家出生在边境矿城“灰炉”，这里负责开采低纯度星砂。随着主角发现一枚没有登记的古代星核，城邦议会、流亡者和失落机械族都会被卷入同一条主线。\n\n第一章目标是建立玩家对世界秩序的理解：星核既是文明基础，也是冲突核心。',
    tags: ['星核', '浮空城邦', '主线'],
    outlines: ['星坠事件', '七座城邦', '灰炉矿城', '主角发现古代星核'],
    relations: {
      characters: ['艾拉', '议会监察官', '灰炉矿长'],
      locations: ['灰炉', '极光议会', '旧时代遗迹'],
      systems: ['阵营声望', '主线章节'],
    },
  },
  {
    id: 'chapter_one',
    title: '第一章剧情梗概',
    category: '主线剧情',
    status: '评审中',
    updated: '昨天 18:40',
    summary: '主角在灰炉矿区遭遇星核暴走，并第一次与流亡者阵营接触。',
    content:
      '第一章开场发生在灰炉地下矿区。一次例行采矿任务中，矿道深处出现异常极光，主角和同伴艾拉被迫进入封锁区。\n\n封锁区内的旧时代设施仍在运作，玩家需要完成探索、轻战斗和一次选择事件。章节结尾处，主角带走古代星核，也因此被议会列入观察名单。',
    tags: ['第一章', '灰炉', '艾拉'],
    outlines: ['矿区事故', '封锁区探索', '古代设施', '议会观察名单'],
    relations: {
      characters: ['主角', '艾拉', '流亡者斥候'],
      locations: ['灰炉矿区', '封锁区'],
      systems: ['教学战斗', '关键选择'],
    },
  },
  {
    id: 'faction_notes',
    title: '阵营设定草案',
    category: '阵营设定',
    status: '待补充',
    updated: '2026/09/12',
    summary: '围绕星核管制形成三类主要势力：议会、流亡者和旧机械族。',
    content:
      '极光议会掌握合法星核分配权，强调秩序和资源配给。\n\n流亡者由被城邦驱逐的人组成，认为星核属于所有幸存者。\n\n旧机械族是星坠前文明的守护系统残留，它们不把人类视为敌人，但会清除任何破坏核心协议的行为。',
    tags: ['议会', '流亡者', '旧机械族'],
    outlines: ['极光议会', '流亡者', '旧机械族', '阵营冲突来源'],
    relations: {
      characters: ['议长诺温', '流亡者首领岚', '旧机械管家'],
      locations: ['极光议会', '荒原营地', '核心塔'],
      systems: ['阵营声望', '对话分支'],
    },
  },
];

const nav = [
  ['项目概览', Layers],
  ['数据配置', Database],
  ['枚举定义', Tag],
  ['枚举管理', Tag],
  ['引擎设置', Settings2],
  ['任务与流程', GitBranch],
  ['数值分析', BarChart3],
] as const;

function WorkspaceApp({ role }: { role: UserRole }) {
  const [active, setActive] = useState('项目概览');
  const [saved, setSaved] = useState(true);
  const [activeDataset, setActiveDataset] = useState<DatasetKey>('items');
  const [engineConfig, setEngineConfig] = useState<EngineConfig>(loadEngineConfig);
  const registry = useEnumRegistry(engineConfig, initialData);
  const dataKey = projectIdentity(engineConfig.projectPath);
  const currentData = registry.data;
  const [milestones, setMilestones] = useState(initialMilestones);
  const [storyDocs, setStoryDocs] = useState(initialStoryDocs);
  const [activeStoryId, setActiveStoryId] = useState(initialStoryDocs[0].id);
  const [project, setProject] = useState({
    name: 'Project Aurora',
    genre: '动作 RPG',
    platform: 'PC / Steam',
    version: 'v0.8.0',
    status: '制作中',
    description:
      '一款以极光大陆为舞台的动作角色扮演游戏。玩家将穿越失落城邦，收集星核并决定世界的最终走向。',
  });

  const completedMilestones = milestones.filter((milestone) => milestone.status === 'done').length;
  const progress = Math.round((completedMilestones / milestones.length) * 100);
  const visibleNav = role === 'admin' ? nav : nav.filter(([name]) => !['枚举管理', '引擎设置'].includes(name));

  const markDirty = () => setSaved(false);
  const exportAiContext = async () => {
    const markdown = buildAiMarkdown(project, storyDocs, currentData, datasetDefinitions, engineConfig, registry);
    const location = await saveAiMarkdown(markdown);
    setSaved(true);
    window.alert(`AI 文档已生成：${location}`);
  };


  const updateProject = (key: keyof typeof project, value: string) => {
    markDirty();
    setProject((current) => ({ ...current, [key]: value }));
  };

  const updateStory = (id: string, changes: Partial<StoryDoc>) => {
    markDirty();
    setStoryDocs((current) =>
      current.map((document) =>
        document.id === id ? { ...document, ...changes, updated: '刚刚' } : document,
      ),
    );
  };

  const addStoryDoc = () => {
    const id = `story_${Date.now()}`;
    markDirty();
    setStoryDocs((current) => [
      ...current,
      {
        id,
        title: '新的故事文档',
        category: '世界观',
        status: '草稿',
        updated: '刚刚',
        summary: '记录这个文档的核心用途，便于后续在项目中快速检索。',
        content: '在这里写下新的故事设定、剧情梗概或角色背景。',
        tags: ['新文档'],
        outlines: ['核心设定', '关键冲突', '待补充问题'],
        relations: { characters: ['待关联角色'], locations: ['待关联地点'], systems: ['待关联系统'] },
      },
    ]);
    setActiveStoryId(id);
  };

  const toggleMilestone = (index: number) => {
    markDirty();
    setMilestones((current) =>
      current.map((milestone, itemIndex) => {
        if (itemIndex !== index) return milestone;
        return { ...milestone, status: milestone.status === 'done' ? 'active' : 'done' };
      }),
    );
  };

  const addMilestone = () => {
    markDirty();
    setMilestones((current) => [
      ...current,
      { title: '新的项目里程碑', owner: '待分配', due: '2026/10/20', status: 'planned' },
    ]);
  };

  return (
    <div className="app">
      <aside>
        <div className="brand">
          <div className="logo">✦</div>
          <div><b>GameCreator</b><small>CONTENT STUDIO</small></div>
        </div>
        <div className="project"><span className="dot" /><span>{project.name}</span><ChevronDown size={14} /></div>
        <nav>
          {visibleNav.map(([name, Icon]) => (
            <button key={name} className={active === name ? 'active' : ''} onClick={() => setActive(name)}>
              <Icon size={17} />{name}
            </button>
          ))}
        </nav>
        <div className="side-bottom">
          <button><Settings2 size={17} />工作区设置</button>
          <div className="user"><div className="avatar">G</div><span>Game Designer<small>本地工作区</small></span></div>
        </div>
      </aside>

      <main>
        <header>
          <div><div className="crumb">{project.name.toUpperCase()} <span>/</span> {active.toUpperCase()}</div><h1>{active}</h1></div>
          <div className="header-actions">
            <div className="search"><Search size={16} /><input placeholder="搜索内容..." /></div>
            <button className="save" onClick={exportAiContext}><FileText size={16} />生成 AI 文档</button>
            <button className="save" onClick={() => setSaved(true)}>{saved ? <Check size={16} /> : <Save size={16} />}{saved ? '已保存' : '保存项目'}</button>
          </div>
        </header>

        {active === '项目概览' && (
          <ProjectOverview
            project={project}
            progress={progress}
            milestones={milestones}
            updateProject={updateProject}
            toggleMilestone={toggleMilestone}
            addMilestone={addMilestone}
          />
        )}
        {active === '故事文档' && (
          <StoryDocuments
            documents={storyDocs}
            activeStoryId={activeStoryId}
            setActiveStoryId={setActiveStoryId}
            updateStory={updateStory}
            addStoryDoc={addStoryDoc}
          />
        )}
        {active === '数据配置' && <DataConfiguration key={dataKey} data={currentData}
          onChange={(next) => { void registry.updateData(next); }}
          definitions={datasetDefinitions} activeDataset={activeDataset} setActiveDataset={setActiveDataset} registry={registry} />}
        {active === '枚举定义' && <EnumDefinitions registry={registry} />}
        {active === '枚举管理' && <EnumManager config={engineConfig} registry={registry} columns={currentData.columns} />}
        {active === '引擎设置' && <EngineSettings config={engineConfig} registry={registry} setConfig={(next) => { markDirty(); setEngineConfig(next); persistEngineConfig(next); }} />}
        {active !== '项目概览' && active !== '故事文档' && active !== '数据配置' && active !== '枚举定义' && active !== '枚举管理' && active !== '引擎设置' && (
          <section className="empty">
            <div className="empty-icon"><Layers size={34} /></div>
            <h2>{active}</h2>
            <p>这个工作区正在搭建中，你可以先从项目概览、故事文档和数据配置开始。</p>
            <button className="primary"><Plus size={16} />创建第一个内容</button>
          </section>
        )}
      </main>
    </div>
  );
}

function App() {
  return <AuthGate>{(session) => <WorkspaceApp role={session.role} />}</AuthGate>;
}

type Project = {
  name: string;
  genre: string;
  platform: string;
  version: string;
  status: string;
  description: string;
};

type ProjectOverviewProps = {
  project: Project;
  progress: number;
  milestones: Milestone[];
  updateProject: (key: keyof Project, value: string) => void;
  toggleMilestone: (index: number) => void;
  addMilestone: () => void;
};

function ProjectOverview({ project, progress, milestones, updateProject, toggleMilestone, addMilestone }: ProjectOverviewProps) {
  const team = [
    { name: '林默', role: '主策划', color: '#8c7bff' },
    { name: '陈溪', role: '数值设计', color: '#4fd19a' },
    { name: '周野', role: '系统策划', color: '#e1b56d' },
    { name: '顾言', role: '文案设计', color: '#e27d9b' },
  ];

  return (
    <section className="overview">
      <div className="overview-intro">
        <div>
          <div className="eyebrow"><Sparkles size={14} />PROJECT SNAPSHOT</div>
          <h2>让每个创意都有清晰的落点。</h2>
          <p>在一个工作区里追踪世界观、玩法、数值和制作进度。</p>
        </div>
        <div className="overview-progress">
          <div className="progress-label"><span>项目完成度</span><strong>{progress}%</strong></div>
          <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
          <small>{milestones.length} 个里程碑 · {milestones.filter((item) => item.status === 'done').length} 个已完成</small>
        </div>
      </div>

      <div className="overview-grid">
        <div className="overview-panel project-info">
          <div className="panel-heading"><div><span className="section-kicker">PROJECT INFO</span><h3>项目基本信息</h3></div><Pencil size={16} /></div>
          <div className="field-grid">
            <label><span>项目名称</span><input value={project.name} onChange={(event) => updateProject('name', event.target.value)} /></label>
            <label><span>项目类型</span><select value={project.genre} onChange={(event) => updateProject('genre', event.target.value)}><option>动作 RPG</option><option>策略模拟</option><option>卡牌构筑</option><option>叙事冒险</option></select></label>
            <label><span>目标平台</span><input value={project.platform} onChange={(event) => updateProject('platform', event.target.value)} /></label>
            <label><span>当前版本</span><input value={project.version} onChange={(event) => updateProject('version', event.target.value)} /></label>
          </div>
          <label className="field-full"><span>项目简介</span><textarea value={project.description} onChange={(event) => updateProject('description', event.target.value)} /></label>
          <div className="info-footer"><span className="status-badge"><span />{project.status}</span><span>最后编辑：今天 14:32</span></div>
        </div>

        <div className="overview-panel activity-panel">
          <div className="panel-heading"><div><span className="section-kicker">RECENT ACTIVITY</span><h3>最近动态</h3></div><Clock3 size={16} /></div>
          <div className="activity-list">
            <Activity icon={<Database size={15} />} title="更新了物品配置" detail="新增 4 条物品记录" time="12 分钟前" />
            <Activity icon={<FileText size={15} />} title="编辑了序章文档" detail="补充角色出场设定" time="昨天 18:40" />
            <Activity icon={<CheckCircle2 size={15} />} title="完成核心玩法验证" detail="林默 · 里程碑" time="2026/09/12" />
          </div>
          <button className="text-button">查看全部动态 <span>→</span></button>
        </div>
      </div>

      <div className="overview-grid lower-grid">
        <div className="overview-panel milestone-panel">
          <div className="panel-heading"><div><span className="section-kicker">MILESTONES</span><h3>关键里程碑</h3></div><button className="icon-button" title="添加里程碑" onClick={addMilestone}><Plus size={16} /></button></div>
          <div className="milestone-list">
            {milestones.map((milestone, index) => (
              <button className="milestone" key={`${milestone.title}-${index}`} onClick={() => toggleMilestone(index)}>
                <span className={`milestone-check ${milestone.status}`}>{milestone.status === 'done' && <Check size={13} />}</span>
                <span className="milestone-copy"><strong>{milestone.title}</strong><small>{milestone.owner}</small></span>
                <span className={`milestone-status ${milestone.status}`}>{milestone.status === 'done' ? '已完成' : milestone.status === 'active' ? '进行中' : '计划中'}</span>
                <time>{milestone.due}</time>
              </button>
            ))}
          </div>
        </div>

        <div className="overview-panel team-panel">
          <div className="panel-heading"><div><span className="section-kicker">TEAM</span><h3>项目成员</h3></div><Users size={16} /></div>
          <div className="team-list">
            {team.map((member) => (
              <div className="team-member" key={member.name}><div className="member-avatar" style={{ background: member.color }}>{member.name.slice(0, 1)}</div><div><strong>{member.name}</strong><small>{member.role}</small></div><span className="online-dot" /></div>
            ))}
          </div>
          <button className="invite-button"><Plus size={15} />邀请成员</button>
        </div>
      </div>
    </section>
  );
}

function StoryDocuments({
  documents,
  activeStoryId,
  setActiveStoryId,
  updateStory,
  addStoryDoc,
}: {
  documents: StoryDoc[];
  activeStoryId: string;
  setActiveStoryId: (id: string) => void;
  updateStory: (id: string, changes: Partial<StoryDoc>) => void;
  addStoryDoc: () => void;
}) {
  const selected = documents.find((document) => document.id === activeStoryId) ?? documents[0];
  const characterCount = selected.content.replace(/\s/g, '').length;
  const paragraphCount = selected.content.split(/\n+/).filter(Boolean).length;

  return (
    <section className="story-workspace">
      <div className="story-list-panel">
        <div className="story-panel-head">
          <div><span className="section-kicker">STORY LIBRARY</span><h3>文档库</h3></div>
          <button className="icon-button" title="新建故事文档" onClick={addStoryDoc}><Plus size={16} /></button>
        </div>
        <div className="story-filter">
          <button className="active">全部</button>
          <button>世界观</button>
          <button>剧情</button>
          <button>角色</button>
        </div>
        <div className="story-doc-list">
          {documents.map((document) => (
            <button
              className={`story-doc-card ${selected.id === document.id ? 'active' : ''}`}
              key={document.id}
              onClick={() => setActiveStoryId(document.id)}
            >
              <span className="doc-category">{document.category}</span>
              <strong>{document.title}</strong>
              <small>{document.summary}</small>
              <span className="doc-meta"><Clock3 size={12} />{document.updated}<em>{document.status}</em></span>
            </button>
          ))}
        </div>
      </div>

      <div className="story-editor-panel">
        <div className="story-editor-top">
          <input
            className="story-title-input"
            value={selected.title}
            onChange={(event) => updateStory(selected.id, { title: event.target.value })}
          />
          <div className="story-editor-actions">
            <button title="预览"><Eye size={16} /></button>
            <button title="引用"><Link size={16} /></button>
          </div>
        </div>
        <div className="story-meta-grid">
          <label><span>分类</span><select value={selected.category} onChange={(event) => updateStory(selected.id, { category: event.target.value })}><option>世界观</option><option>主线剧情</option><option>角色设定</option><option>阵营设定</option><option>地点设定</option></select></label>
          <label><span>状态</span><select value={selected.status} onChange={(event) => updateStory(selected.id, { status: event.target.value })}><option>草稿</option><option>待补充</option><option>评审中</option><option>定稿</option></select></label>
        </div>
        <label className="story-summary"><span>摘要</span><textarea value={selected.summary} onChange={(event) => updateStory(selected.id, { summary: event.target.value })} /></label>
        <div className="editor-toolbar">
          <button title="正文"><AlignLeft size={15} /></button>
          <button title="加粗"><Bold size={15} /></button>
          <button title="斜体"><Italic size={15} /></button>
          <button title="引用"><Quote size={15} /></button>
          <span />
          <button title="添加标签"><Tag size={15} /></button>
        </div>
        <textarea
          className="story-body"
          value={selected.content}
          onChange={(event) => updateStory(selected.id, { content: event.target.value })}
        />
      </div>

      <div className="story-context-panel">
        <div className="context-card">
          <div className="story-panel-head"><div><span className="section-kicker">OUTLINE</span><h3>文档大纲</h3></div><ListTree size={16} /></div>
          <ol className="outline-list">
            {selected.outlines.map((outline) => <li key={outline}>{outline}</li>)}
          </ol>
        </div>
        <div className="context-card">
          <div className="story-panel-head"><div><span className="section-kicker">LINKED CONTENT</span><h3>关联设定</h3></div><Map size={16} /></div>
          <RelationGroup title="角色" items={selected.relations.characters} />
          <RelationGroup title="地点" items={selected.relations.locations} />
          <RelationGroup title="系统" items={selected.relations.systems} />
        </div>
        <div className="context-card compact-card">
          <div><CalendarDays size={16} /><span>最后编辑</span><strong>{selected.updated}</strong></div>
          <div><FileText size={16} /><span>正文长度</span><strong>{characterCount} 字</strong></div>
          <div><BookOpen size={16} /><span>段落数量</span><strong>{paragraphCount} 段</strong></div>
        </div>
      </div>
    </section>
  );
}

function RelationGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="relation-group">
      <span>{title}</span>
      <div>{items.map((item) => <button key={item}>{item}</button>)}</div>
    </div>
  );
}

function Activity({ icon, title, detail, time }: { icon: React.ReactNode; title: string; detail: string; time: string }) {
  return <div className="activity"><div className="activity-icon">{icon}</div><div><strong>{title}</strong><small>{detail}</small></div><time>{time}</time></div>;
}

// Reuse the React root when Vite reloads this entry module during development.
const root: Root = import.meta.hot?.data.reactRoot ?? createRoot(document.getElementById('root')!);
if (import.meta.hot) import.meta.hot.data.reactRoot = root;
root.render(<App />);
