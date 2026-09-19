import { StoryDocuments } from './StoryDocuments';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import { TeamProjectWorkspace } from './TeamWorkspace';
import { TeamConnectionDialog, teamProjectKey, useTeamConnection } from './team-connection';
import { canLeaveTeam, leaveTeamEvent } from './team-api';
import { initialStoryDocs, type StoryDoc } from './story-model';
import { ArtAssets, ArtReferences, type ArtSelection } from './ArtAssets';
import { useArtAssets } from './useArtAssets';
import { FunctionalSystems, GameplayFunctions, type FunctionalSelection } from './FunctionalSystems';
import { useFunctionalSystems } from './useFunctionalSystems';
import { GameplayDesigns } from './GameplayDesigns';
import { useGameplayDesigns } from './useGameplayDesigns';
import { ProjectSwitcher, type SwitchableProject } from './ProjectSwitcher';
import { useProjectCatalog } from './useProjectCatalog';
import { PrototypeImportDialog } from './PrototypeImportDialog';
import { loadPrototypeExample, type PrototypeImportInput } from './prototype-examples';
import { preparePrototypeProject, writePrototypeProject } from './prototype-import';
import { addSavedProject, selectSavedProject, updateSavedConfig, type SavedProject } from './project-catalog';
import { TestPanel } from './TestPanel';
import { buildTestWorkspace, testScenarios, type TestSession, type TestScenarioId } from './test-scenarios';
import { workspaceStorage } from './workspace-storage';
import { logDebug } from './debug-log';
import { useStoredState } from './useStoredState';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock3,
  Database,
  FileText,
  Layers,
  Pencil,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Users,
} from 'lucide-react';
import './styles.css';
import './overview.css';
import './story.css';
import './data-config.css';
import './enum-bindings.css';
import type { EngineConfig } from './engine';
import { useEnumRegistry } from './useEnumRegistry';
import { EngineSettings, EnumDefinitions, EnumManager } from './EnginePanels';
import { DataConfiguration } from './DataConfiguration';
import { patchDataViewState, readDataViewState, resolveActiveDataset } from './data-view-state';
import { projectIdentity, type DatasetKey, type DataRecord, type DatasetDef, type ProjectData } from './data-model';
import { AuthGate, beforeLogoutEvent, type UserRole } from './auth';
import { buildAiMarkdown, saveAiMarkdown } from './ai-export';

type Milestone = {
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


const initialProject = {
    name: 'Project Aurora',
    genre: '动作 RPG',
    platform: 'PC / Steam',
    version: 'v0.8.0',
    status: '制作中',
    description:
      '一款以极光大陆为舞台的动作角色扮演游戏。玩家将穿越失落城邦，收集星核并决定世界的最终走向。',
  };

function WorkspaceController({ role, username }: { role: UserRole; username: string }) {
  const projects = useProjectCatalog();
  const team = useTeamConnection();
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const allowSwitch = () => window.dispatchEvent(new Event(beforeLogoutEvent, { cancelable: true })) && canLeaveTeam();
  const connectTeam = () => { if (allowSwitch()) team.show(); };
  const formalProject = projects.catalog.projects.find(item => item.id === projects.catalog.activeId)!;
  const [storedTest, setStoredTest, sessionError] = useStoredState<TestSession | null>('gamecreator.test-session.v1', null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const [prototypeOpen, setPrototypeOpen] = useState(false);
  const [prototypeBusy, setPrototypeBusy] = useState(false);
  const importingPrototype = useRef(false);
  useEffect(() => {
    const guard = (event: Event) => { if (importingPrototype.current) event.preventDefault(); };
    const closing = (event: BeforeUnloadEvent) => {
      if (importingPrototype.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener(beforeLogoutEvent, guard);
    window.addEventListener(leaveTeamEvent, guard);
    window.addEventListener('beforeunload', closing);
    return () => {
      window.removeEventListener(beforeLogoutEvent, guard);
      window.removeEventListener(leaveTeamEvent, guard);
      window.removeEventListener('beforeunload', closing);
    };
  }, []);
  const openPrototypeImport = () => {
    if (role === 'admin' && !lock.current && !projects.blocked && allowSwitch()) setPrototypeOpen(true);
  };
  const importPrototype = async (input: PrototypeImportInput) => {
    if (role !== 'admin' || lock.current || projects.blocked || !allowSwitch()) return false;
    lock.current = true; importingPrototype.current = true; setPrototypeBusy(true);
    let creationError: unknown;
    try {
      const example = await loadPrototypeExample(input.exampleId);
      // The catalog entry is the publication point: every archive must be durable
      // first, so a failed import never exposes a half-populated project.
      const saved = projects.commit(catalog => {
        try {
          const prepared = preparePrototypeProject(catalog, example, input.name);
          writePrototypeProject(workspaceStorage, prepared);
          return prepared.catalog;
        } catch (reason) { creationError = reason; throw reason; }
      });
      if (!saved) {
        // Errors crossing Electron's context bridge need not share Error.prototype.
        const detail = creationError && typeof creationError === 'object' && 'message' in creationError ? String(creationError.message) : creationError ? String(creationError) : '';
        throw new Error(detail || '项目列表未能保存，请检查存储状态后重试。');
      }
      setActiveTeamId(null);
      if (storedTest) setStoredTest(null);
      setPrototypeOpen(false); setError('');
      logDebug('从原型创建项目', 'success', input.name);
      return true;
    } catch (reason) {
      logDebug('从原型创建项目', 'error', String(reason));
      throw reason;
    } finally { lock.current = false; importingPrototype.current = false; setPrototypeBusy(false); }
  };
  const valid = storedTest && typeof storedTest.id === 'string' && /^[0-9a-f-]{36}$/.test(storedTest.id)
    && storedTest.expectedChanges && ['added', 'removed', 'modified'].every(key => Number.isInteger(storedTest.expectedChanges[key as keyof TestSession['expectedChanges']]))
    && testScenarios.some(item => item.id === storedTest.scenario)
    && storedTest.config?.projectPath && storedTest.config.projectPath.replace(/\\/g, '/').toLowerCase().endsWith('/test-workspaces/' + storedTest.id + '/project');
  const testSession = role === 'admin' && projects.catalog.mode === 'test' && valid ? storedTest : null;
  const selectProject = (id: string) => {
    if (lock.current || !allowSwitch()) return false;
    const remote = team.saved?.projects.find(item => teamProjectKey(team.saved!.serverId, item.id) === id);
    if (remote) {
      if (team.session) setActiveTeamId(remote.id);
      else team.show(id);
      return true;
    }
    if (!projects.commit(catalog => selectSavedProject(catalog, id))) return false;
    setActiveTeamId(null);
    if (storedTest) setStoredTest(null);
    setError(''); logDebug('切换项目', 'success', projects.catalog.projects.find(item => item.id === id)?.name ?? id);
    return true;
  };
  const addProject = async (input: { name: string }) => {
    if (role !== 'admin' || lock.current || projects.blocked || !allowSwitch()) return false;
    if (!input.name.trim()) throw new Error('请输入项目名称');
    if (!projects.commit(catalog => addSavedProject(catalog, input.name))) return false;
    setActiveTeamId(null);
    if (storedTest) setStoredTest(null);
    setError(''); logDebug('新建项目', 'success', input.name);
    return true;
  };
  const configureProject = async (config: EngineConfig) => {
    if (role !== 'admin' || lock.current || projects.blocked) return false;
    lock.current = true; setPreparing(true); setError('');
    try {
      let location = { projectPath: config.projectPath.trim(), enumPath: config.enumPath.trim() };
      if (location.projectPath) {
        if (window.desktopClient?.validateProjectLocation) location = await window.desktopClient.validateProjectLocation(location);
        else {
          if (!/^(?:[A-Za-z]:[\\/]|\/)/.test(location.projectPath)) throw new Error('请输入完整的工程目录');
          if (!location.enumPath || /^(?:[A-Za-z]:|[\\/])/.test(location.enumPath) || location.enumPath.split(/[\\/]/).includes('..')) throw new Error('枚举目录必须是工程内的相对路径');
        }
      }
      return projects.commit(catalog => updateSavedConfig(catalog, formalProject.id, { ...config, ...location }));
    } finally { lock.current = false; setPreparing(false); }
  };
  const load = async (scenario: TestScenarioId) => {
    if (role !== 'admin' || lock.current || projects.blocked) return;
    lock.current = true; setPreparing(true); setError('');
    try {
      if (!window.desktopClient?.prepareTestWorkspace) throw new Error('请使用桌面客户端加载测试场景');
      const prepared = await window.desktopClient.prepareTestWorkspace(scenario);
      const built = await buildTestWorkspace(prepared, username);
      workspaceStorage.setItem(built.key, JSON.stringify(built.store));
      if (!setStoredTest(built.session) || !projects.commit(catalog => ({ ...catalog, mode: 'test' }))) throw new Error('测试工作区切换未保存');
      logDebug('加载测试场景', 'success', testScenarios.find(item=>item.id===scenario)!.name, built.key);
    } catch (reason) {
      setError(String(reason)); logDebug('加载测试场景','error',String(reason));
    } finally { lock.current = false; setPreparing(false); }
  };
  const exit = () => { selectProject(projects.catalog.activeId); };
  const options: SwitchableProject[] = projects.catalog.projects.map(item => {
    let name = item.name;
    try {
      const raw = workspaceStorage.getItem('gamecreator.workspace.v1:' + item.id + ':project');
      if (raw && typeof JSON.parse(raw)?.name === 'string' && JSON.parse(raw).name.trim()) name = JSON.parse(raw).name;
    } catch { /* The project itself displays its archive error when selected. */ }
    return { id: item.id, name, projectPath: item.config.projectPath, kind: 'local' };
  });
  for (const item of team.saved?.projects ?? []) options.push({ id: teamProjectKey(team.saved!.serverId, item.id), name: item.name,
    projectPath: '', kind: 'team', detail: `${team.saved!.url} · ${team.session ? team.session.user.username : '未连接'}` });
  const selectedTeam = team.session && team.saved?.projects.find(item => item.id === activeTeamId);
  if (projects.blocked) return <main className="enum-catalog-empty" role="alert">
    <AlertTriangle size={32} /><h1>项目列表读取失败</h1>
    <p>无法确定当前项目，已停止加载和保存工作区。请恢复项目列表存档后重新打开软件。</p>
    <p>{projects.error}</p><button className="primary" onClick={() => window.location.reload()}>重新读取</button>
  </main>;
  return <><TeamConnectionDialog connection={team} onConnected={setActiveTeamId} />
    <PrototypeImportDialog open={prototypeOpen} busy={prototypeBusy} projects={options.filter(item => item.kind === 'local')}
      onClose={() => { if (!importingPrototype.current) setPrototypeOpen(false); }} onImport={importPrototype} />
    {selectedTeam && team.session ? <TeamProjectWorkspace key={`${team.session.serverId}:${team.session.user.id}:${selectedTeam.id}:${team.session.token}`} project={selectedTeam} session={team.session}
      localProjects={projects.catalog.projects.map(item => ({ ...item, name: options.find(option => option.id === item.id)?.name || item.name }))}
      picker={<ProjectSwitcher projects={options} currentId={teamProjectKey(team.session.serverId, selectedTeam.id)} currentName={selectedTeam.name} canAdd={role === 'admin'} busy={preparing || prototypeBusy || projects.blocked}
        onSelect={selectProject} onAdd={addProject} onConnectTeam={connectTeam} onImportPrototype={openPrototypeImport} />}
      onConnection={connectTeam} onDisconnect={() => { if (allowSwitch()) { team.disconnect(); setActiveTeamId(null); } }} />
    : <WorkspaceApp key={testSession?.id ?? 'project:' + formalProject.id} role={role} username={username}
    formalProject={formalProject} projectOptions={options} onSelectProject={selectProject} onAddProject={addProject}
    onConnectTeam={connectTeam} onImportPrototype={openPrototypeImport}
    onConfigChange={configureProject}
    onRenameProject={name => projects.commit(catalog => ({ ...catalog, projects: catalog.projects.map(item => item.id === formalProject.id ? { ...item, name } : item) }))}
    testSession={testSession} onLoadTest={load} onExitTest={exit} preparingTest={preparing || prototypeBusy || projects.blocked}
    testError={error || projects.error || sessionError || (storedTest && !valid ? '测试会话信息无效，已回到正式工作区。' : '')} />}</>;
}

const emptyStories: StoryDoc[] = [];
const emptyMilestones: Milestone[] = [];
const emptyProjectData: ProjectData = { columns: initialData.columns, datasets: Object.fromEntries(datasetDefinitions.map(item => [item.key, []])) };
const initialTestProject = { ...initialProject, name: '枚举测试工作区' };
function WorkspaceApp({ role, username, testSession, onLoadTest, onExitTest, preparingTest, testError, formalProject, projectOptions, onSelectProject, onAddProject, onConfigChange, onRenameProject, onConnectTeam, onImportPrototype }: {
  formalProject: SavedProject; projectOptions: SwitchableProject[]; onConnectTeam: () => void; onImportPrototype: () => void;
  onSelectProject: (id: string) => boolean; onAddProject: (input: { name: string }) => Promise<boolean>;
  onConfigChange: (config: EngineConfig) => Promise<boolean>; onRenameProject: (name: string) => boolean;
  role: UserRole; username: string; testSession: TestSession | null; onLoadTest: (scenario: TestScenarioId) => Promise<void>;
  onExitTest: () => void; preparingTest: boolean; testError: string;
}) {
  const [active, setActive] = useState(testSession ? '枚举管理' : '项目概览');

  const [activeGameplayId, setActiveGameplayId] = useState('');
  const [gameplaySource, setGameplaySource] = useState<{ kind: string; id: string } | undefined>();
  const [functionalSelection, setFunctionalSelection] = useState<FunctionalSelection>(null);
  const [artSelection, setArtSelection] = useState<ArtSelection>(null);

  const engineConfig = testSession?.config ?? formalProject.config;
  const isNewProject = !testSession && formalProject.initialContent === 'empty';
  const dataKey = testSession ? projectIdentity(engineConfig.projectPath) : formalProject.id;
  const savedDataView = useMemo(() => readDataViewState(dataKey), [dataKey]);
  const [datasetSelection, setDatasetSelection] = useState({ workspaceKey: dataKey, key: savedDataView.activeDataset });
  const activeDataset = datasetSelection.workspaceKey === dataKey ? datasetSelection.key : savedDataView.activeDataset;
  const setActiveDataset = (key: DatasetKey) => {
    setDatasetSelection({ workspaceKey: dataKey, key });
    patchDataViewState(dataKey, { activeDataset: key });
  };
  const creatingDataset = useRef(false);
  const registry = useEnumRegistry(engineConfig, isNewProject ? emptyProjectData : initialData, username, dataKey);
  const gameplay = useGameplayDesigns(dataKey);
  const functional = useFunctionalSystems(dataKey);
  const art = useArtAssets(dataKey, testSession ? 'test:' + testSession.id : 'project:' + formalProject.id);
  useEffect(() => {
    const guard = (event: Event) => { if (gameplay.pending || functional.pending || art.pending) event.preventDefault(); };
    window.addEventListener(beforeLogoutEvent, guard);
    return () => window.removeEventListener(beforeLogoutEvent, guard);
  }, [gameplay.pending, functional.pending, art.pending]);
  const currentData = registry.data;
  const [allDefinitions, setDefinitions, definitionsError] = useStoredState<DatasetDef[]>('gamecreator.workspace.v1:' + dataKey + ':definitions', datasetDefinitions);
  const definitions = Object.keys(currentData.datasets).map(key =>
    ({ ...(allDefinitions.find(item => item.key === key) ?? { key, label: key, badge: '' }), columns: currentData.columns[key] }));
  const currentDataset = resolveActiveDataset(definitions, currentData, activeDataset);
  useEffect(() => {
    if (active !== '数据配置' || !currentDataset || currentDataset === activeDataset) return;
    setDatasetSelection({ workspaceKey: dataKey, key: currentDataset });
    patchDataViewState(dataKey, { activeDataset: currentDataset });
  }, [active, activeDataset, currentDataset, dataKey]);
  const [milestones, setMilestones, milestoneError] = useStoredState('gamecreator.workspace.v1:' + dataKey + ':milestones', isNewProject ? emptyMilestones : initialMilestones);
  const [storyDocs, setStoryDocs, storyError] = useStoredState('gamecreator.workspace.v1:' + dataKey + ':stories', isNewProject ? emptyStories : initialStoryDocs);
  const [activeStoryId, setActiveStoryId] = useState(initialStoryDocs[0].id);
  const projectDefaults = useMemo(() => testSession ? initialTestProject : isNewProject
    ? { ...initialProject, name: formalProject.name, version: 'v0.1.0', description: '' } : { ...initialProject, name: formalProject.name }, [testSession?.id, isNewProject, formalProject.id, formalProject.name]);
  const [project, setProject, projectError] = useStoredState('gamecreator.workspace.v1:' + dataKey + ':project', projectDefaults);

  const functionalSources = { designs: gameplay.store.designs, data: currentData, definitions };
  const artSources = { designs: gameplay.store.designs, functional: functional.store };
  const openArtRequirement = (id: string) => { setArtSelection({ kind: 'requirement', id }); setActive('美术资产'); };
  const openCapability = (id: string) => { setFunctionalSelection({ kind: 'capability', id }); setActive('功能系统'); };
  const openGameplay = (id: string, kind = 'design', sourceId = '') => { setActiveGameplayId(id); setGameplaySource({ kind, id: sourceId }); setActive('玩法设计'); };
  const completedMilestones = milestones.filter((milestone) => milestone.status === 'done').length;
  const progress = milestones.length ? Math.round((completedMilestones / milestones.length) * 100) : 0;
  const storageError = [definitionsError, milestoneError, storyError, projectError, registry.error, gameplay.error, functional.error, art.error].filter(Boolean).join('；');

  const exportAiContext = async () => {
    if (testSession || gameplay.blocked || gameplay.pending || functional.blocked || functional.pending || art.blocked || art.pending) return;
    const markdown = buildAiMarkdown(project, storyDocs, currentData, definitions, engineConfig, registry, gameplay.store.designs, functional.store, art.store);
    const location = await saveAiMarkdown(markdown, formalProject.id);

    window.alert(`AI 文档已生成：${location}`);
  };
  const createDataset = async (definition: DatasetDef): Promise<boolean> => {
    if (creatingDataset.current) return false;
    if (Object.prototype.hasOwnProperty.call(currentData.datasets, definition.key)) throw new Error('配置表标识已存在，请换一个标识');
    creatingDataset.current = true;
    try {
      const nextDefinitions = [...allDefinitions.filter(item => item.key !== definition.key), definition];
      if (!setDefinitions(nextDefinitions)) return false;
      if (!await registry.updateData({ ...currentData, datasets: { ...currentData.datasets, [definition.key]: [] }, columns: { ...currentData.columns, [definition.key]: definition.columns } })) {
        setDefinitions(allDefinitions);
        return false;
      }
      setActiveDataset(definition.key);
      return true;
    } finally { creatingDataset.current = false; }
  };

  const updateProject = (key: keyof typeof project, value: string) => {

    if (setProject((current) => ({ ...current, [key]: value })) && key === 'name' && !testSession) onRenameProject(value);
  };

  const updateStory = (id: string, changes: Partial<StoryDoc>) => {

    setStoryDocs((current) =>
      current.map((document) =>
        document.id === id ? { ...document, ...changes, updated: '刚刚' } : document,
      ),
    );
  };

  const addStoryDoc = () => {
    const id = `story_${Date.now()}`;

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

    setMilestones((current) =>
      current.map((milestone, itemIndex) => {
        if (itemIndex !== index) return milestone;
        return { ...milestone, status: milestone.status === 'done' ? 'active' : 'done' };
      }),
    );
  };

  const addMilestone = () => {

    setMilestones((current) => [
      ...current,
      { title: '新的项目里程碑', owner: '待分配', due: '2026/10/20', status: 'planned' },
    ]);
  };

  return (
    <div className="app local-workspace">
      <WorkspaceSidebar picker={<ProjectSwitcher projects={projectOptions} currentId={testSession ? null : formalProject.id} currentName={project.name}
          testName={testSession ? testScenarios.find(item=>item.id===testSession.scenario)?.name : undefined}
          canAdd={role === 'admin'} busy={preparingTest || registry.busy || registry.loading || gameplay.pending || functional.pending || functional.blocked || art.pending || art.blocked} onSelect={onSelectProject} onAdd={onAddProject} onConnectTeam={onConnectTeam} onImportPrototype={onImportPrototype} />} active={active} onNavigate={setActive} admin={role === 'admin'} footer={<>
        <button><Settings2 size={17} />工作区设置</button><div className="user"><div className="avatar">G</div><span>{username}<small>本地项目</small></span></div>
      </>} />

      <main>
        <header>
          <div><div className="crumb">{project.name.toUpperCase()} <span>/</span> {active.toUpperCase()}</div><h1>{active}</h1></div>
          <div className="header-actions">
            {role === 'admin' && <TestPanel page={active} username={username} config={engineConfig} registry={registry} testSession={testSession}
              busy={preparingTest || gameplay.pending || functional.pending || functional.blocked || art.pending || art.blocked} error={testError || storageError} onLoad={onLoadTest} onExit={onExitTest} onNavigate={setActive} />}
            <div className="search"><Search size={16} /><input placeholder="搜索内容..." /></div>
            <button className="save" disabled={!!testSession || gameplay.blocked || gameplay.pending || functional.blocked || functional.pending || art.blocked || art.pending} title={testSession ? "测试工作区可在面板复制诊断信息" : undefined} onClick={exportAiContext}><FileText size={16} />生成 AI 文档</button>
            <span className="save" role="status">{storageError ? <AlertTriangle size={16} /> : <Check size={16} />}{storageError ? '请检查保存状态' : registry.busy ? '正在保存…' : '已自动保存'}</span>
          </div>
        </header>

        {testSession && <div className="test-workspace-banner" role="status"><span><b>测试工作区</b> · {testScenarios.find(item=>item.id===testSession.scenario)?.name} · 数据独立保存</span>
          <button disabled={preparingTest || registry.busy || registry.loading || gameplay.pending || functional.pending || functional.blocked || art.pending || art.blocked} onClick={onExitTest}>返回原工作区</button></div>}
        {testError && <p className="field-error" role="alert">{testError}</p>}
        {storageError && !gameplay.error && !functional.error && !art.error && <p className="field-error" role="alert">{storageError}</p>}
        {gameplay.error && <div className="gp-save-error" role="alert"><span>{gameplay.error}{gameplay.pending && "。草稿保留在当前窗口，请重试保存后再切换项目。"}</span>{gameplay.pending && <button className="gp-secondary" onClick={gameplay.retry}>重试保存玩法</button>}</div>}
        {functional.error && <div className="gp-save-error" role="alert"><span>{functional.error}{functional.pending && '。草稿保留在当前窗口，请重试保存后再切换项目。'}</span>{functional.pending && <button className="gp-secondary" onClick={functional.retry}>重试保存功能系统</button>}</div>}
        {art.error && <div className="gp-save-error" role="alert"><span>{art.error}{art.pending && '。草稿保留在当前窗口，请重试保存后再切换项目。'}</span>{art.pending && <button className="gp-secondary" onClick={art.retry}>重试保存美术资产</button>}</div>}
        {active === '项目概览' && (
          <ProjectOverview
            project={project}
            showExamples={!isNewProject}
            progress={progress}
            milestones={milestones}
            updateProject={updateProject}
            toggleMilestone={toggleMilestone}
            addMilestone={addMilestone}
          />
        )}
        {active === '玩法设计' && <GameplayDesigns selectedId={activeGameplayId} onSelect={id => { setActiveGameplayId(id); setGameplaySource(undefined); }} initialSource={gameplaySource} renderImplementation={d => <><GameplayFunctions controller={functional} sources={functionalSources} gameplayId={d.id} archived={d.archived} onOpenCapability={openCapability} /><ArtReferences controller={art} sources={artSources} kind="gameplay" targetId={d.id} onOpenRequirement={openArtRequirement} /></>} controller={gameplay} sources={{ stories: storyDocs, datasets: definitions }} onOpenLink={link => {
          if (link.kind === 'story') { setActiveStoryId(link.targetId); setActive('故事文档'); }
          else { setActiveDataset(link.targetId); setActive('数据配置'); }
        }} />}
        {active === '美术资产' && <ArtAssets controller={art} sources={artSources} selected={artSelection} onSelect={setArtSelection} onOpenGameplay={openGameplay} onOpenCapability={openCapability} />}
        {active === '功能系统' && <FunctionalSystems renderArtReferences={c => <ArtReferences controller={art} sources={artSources} kind="capability" targetId={c.id} onOpenRequirement={openArtRequirement} />} controller={functional} sources={functionalSources} selected={functionalSelection} onSelect={setFunctionalSelection} onOpenGameplay={openGameplay} onOpenDataset={key => { setActiveDataset(key); setActive('数据配置'); }} />}
        {active === '故事文档' && (
          <StoryDocuments
            documents={storyDocs}
            activeStoryId={activeStoryId}
            setActiveStoryId={setActiveStoryId}
            updateStory={updateStory}
            addStoryDoc={addStoryDoc}
            readOnly={role !== 'admin'}
          />
        )}
        {active === '数据配置' && <DataConfiguration key={dataKey} workspaceKey={dataKey} data={currentData}
          onChange={(next) => registry.updateData(next)}
          definitions={definitions} activeDataset={currentDataset} setActiveDataset={setActiveDataset} registry={registry} onCreateTable={createDataset} />}
        {active === '枚举定义' && <EnumDefinitions registry={registry} />}
        {active === '枚举管理' && <EnumManager config={engineConfig} registry={registry} />}
        {active === '引擎设置' && <fieldset disabled={!!testSession} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>{testSession && <p>测试场景使用固定来源，请通过测试面板加载或重置场景。</p>}<EngineSettings config={engineConfig} registry={registry} onPickDirectory={window.desktopClient?.pickProjectDirectory} setConfig={(next) => testSession ? Promise.resolve(false) : onConfigChange(next)} /></fieldset>}
        {active !== '项目概览' && active !== '玩法设计' && active !== '功能系统' && active !== '美术资产' && active !== '故事文档' && active !== '数据配置' && active !== '枚举定义' && active !== '枚举管理' && active !== '引擎设置' && (
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
  return <AuthGate>{(session) => <WorkspaceController role={session.role} username={session.username} />}</AuthGate>;
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
  showExamples: boolean;
  progress: number;
  milestones: Milestone[];
  updateProject: (key: keyof Project, value: string) => void;
  toggleMilestone: (index: number) => void;
  addMilestone: () => void;
};

function ProjectOverview({ project, showExamples, progress, milestones, updateProject, toggleMilestone, addMilestone }: ProjectOverviewProps) {
  const team = showExamples ? [
    { name: '林默', role: '主策划', color: '#8c7bff' },
    { name: '陈溪', role: '数值设计', color: '#4fd19a' },
    { name: '周野', role: '系统策划', color: '#e1b56d' },
    { name: '顾言', role: '文案设计', color: '#e27d9b' },
  ] : [];

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
            <label><span>项目类型</span><select value={project.genre} onChange={(event) => updateProject('genre', event.target.value)}><option>未指定</option><option>动作 RPG</option><option>策略模拟</option><option>卡牌构筑</option><option>叙事冒险</option></select></label>
            <label><span>目标平台</span><input value={project.platform} onChange={(event) => updateProject('platform', event.target.value)} /></label>
            <label><span>当前版本</span><input value={project.version} onChange={(event) => updateProject('version', event.target.value)} /></label>
          </div>
          <label className="field-full"><span>项目简介</span><textarea value={project.description} onChange={(event) => updateProject('description', event.target.value)} /></label>
          <div className="info-footer"><span className="status-badge"><span />{project.status}</span>{showExamples && <span>最后编辑：今天 14:32</span>}</div>
        </div>

        <div className="overview-panel activity-panel">
          <div className="panel-heading"><div><span className="section-kicker">RECENT ACTIVITY</span><h3>最近动态</h3></div><Clock3 size={16} /></div>
          <div className="activity-list">
            {showExamples ? <><Activity icon={<Database size={15} />} title="更新了物品配置" detail="新增 4 条物品记录" time="12 分钟前" />
            <Activity icon={<FileText size={15} />} title="编辑了序章文档" detail="补充角色出场设定" time="昨天 18:40" />
            <Activity icon={<CheckCircle2 size={15} />} title="完成核心玩法验证" detail="林默 · 里程碑" time="2026/09/12" /></> : <p className="empty-inspector">暂无项目动态</p>}
          </div>
          {showExamples && <button className="text-button">查看全部动态 <span>→</span></button>}
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
            {!team.length && <p className="empty-inspector">暂无项目成员</p>}
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

function Activity({ icon, title, detail, time }: { icon: React.ReactNode; title: string; detail: string; time: string }) {
  return <div className="activity"><div className="activity-icon">{icon}</div><div><strong>{title}</strong><small>{detail}</small></div><time>{time}</time></div>;
}

// Reuse the React root when Vite reloads this entry module during development.
const root: Root = import.meta.hot?.data.reactRoot ?? createRoot(document.getElementById('root')!);
if (import.meta.hot) import.meta.hot.data.reactRoot = root;
root.render(<App />);
