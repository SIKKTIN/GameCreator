import {useStoryDocuments} from './useStoryDocuments';
import {storyTargets,incomingStories} from './story-targets';
import {makeStory} from './story-library';
import type {StoryReference} from './story-model';
import {GlobalSearchProvider,GlobalSearchInput,GlobalSearchPanel,SearchReturn} from './GlobalSearch';
import type {SearchTarget} from './global-search';
import { NumericalAnalysis } from './NumericalAnalysis';
import { useNumericalAnalysis } from './useNumericalAnalysis';
import { ProjectSchedule } from './ProjectSchedule';
import { useProjectSchedule } from './useProjectSchedule';
import { buildScheduleSources } from './project-schedule';
import { MapDesign, MapModuleSettings } from './MapDesign';
import { useMapDesign } from './useMapDesign';
import { mapObjectReferences, mapSource } from './map-design';
import { StoryOrchestration, StoryModuleSettings } from './StoryOrchestration';
import { useStoryOrchestration } from './useStoryOrchestration';
import { PrototypeDesign } from './PrototypeDesign';
import { usePrototypeDesign } from './usePrototypeDesign';
import { prototypeFromMaps, prototypeSource } from './prototype-design';
import { TaskFlows } from './TaskFlows';
import { useTaskFlows } from './useTaskFlows';
import { StoryDocuments } from './StoryDocuments';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import { UserPermissions } from './UserPermissions';
import { ServerManager, type ServerModuleNavigation } from './ServerManager';
import { TeamProjectWorkspace } from './TeamWorkspace';
import { TeamProjectDialog } from './TeamProjectDialog';
import { PublishProjectDialog } from './PublishProjectDialog';
import { TeamConnectionDialog, teamProjectKey, useTeamConnection } from './team-connection';
import { canLeaveTeam, leaveTeamEvent, type TeamProject } from './team-api';
import { initialStoryDocs, type StoryDoc } from './story-model';
import { datasetDefinitions, emptyDatasetDefinitions, initialData, initialMilestones, initialProject, emptyProjectData, emptyMilestones, emptyStories, type Milestone } from './project-defaults';
import { ArtAssets, ArtReferences, type ArtSelection } from './ArtAssets';
import { useArtAssets } from './useArtAssets';
import { FunctionalSystems, GameplayFunctions, type FunctionalSelection } from './FunctionalSystems';
import { useFunctionalSystems } from './useFunctionalSystems';
import { GameplayDesigns } from './GameplayDesigns';
import { GameplayCore } from './GameplayCore';
import { useGameplayCore } from './useGameplayCore';
import { useGameplayDesigns } from './useGameplayDesigns';
import { ProjectSwitcher, type SwitchableProject } from './ProjectSwitcher';
import { useProjectCatalog } from './useProjectCatalog';
import { ProjectPackageDialog } from './ProjectPackageDialog';
import { useProjectTransfer } from './useProjectTransfer';
import { migrateUnusedDefaultTables } from './default-table-migration';
import { PrototypeImportDialog } from './PrototypeImportDialog';
import { loadPrototypeExample, type PrototypeImportInput } from './prototype-examples';
import { preparePrototypeProject, writePrototypeProject } from './prototype-import';
import { addSavedProject, removeSavedProject, selectSavedProject, updateSavedConfig, type SavedProject } from './project-catalog';
import { TestPanel } from './TestPanel';
import { buildTestWorkspace, testScenarios, type TestSession, type TestScenarioId } from './test-scenarios';
import { workspaceStorage } from './workspace-storage';
import { logDebug } from './debug-log';
import { useStoredState } from './useStoredState';
import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock3,
  Database,
  FileText,
  FolderOpen,
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
import { WorkspaceShell, beforeLogoutEvent } from './auth';
import {WorkspaceEntry,TeamProjectSelection} from './WorkspaceEntry';
import { buildAiMarkdown, saveAiMarkdown } from './ai-export';

function WorkspaceController() {
  const username='本地';
  const [mode,setMode]=useState<'start'|'local'|'team'>('start');
  const teamOrigin=useRef<'start'|'local'>('local');
  const projects = useProjectCatalog();
  const team = useTeamConnection();
  const canManageTeam=!!team.session&&!team.session.invalid&&team.session.user.serverRole==='admin';
  const canManageHost=!!window.desktopClient?.collaborationHost;
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [creatingTeam, setCreatingTeam] = useState(false), [createAfterConnection, setCreateAfterConnection] = useState(false);
  const [publishingProject, setPublishingProject] = useState<SavedProject | null>(null), [publishAfterConnection, setPublishAfterConnection] = useState<SavedProject | null>(null);
  const lastTeamProject = useRef<{ key: string; project: TeamProject } | null>(null);
  const [serverOpen, setServerOpen] = useState(false), [returnToConnection, setReturnToConnection] = useState(false);
  const [usersOpen,setUsersOpen] = useState(false),[usersAfterConnection,setUsersAfterConnection] = useState(false);
  const [addressRequest, setAddressRequest] = useState<{ url: string } | null>(null);
  const allowSwitch = () => window.dispatchEvent(new Event(beforeLogoutEvent, { cancelable: true })) && canLeaveTeam();
  const leaveServer = () => { setServerOpen(false); setUsersOpen(false); setReturnToConnection(false); };
  const openServer = (fromConnection = false) => {
    if (!canManageHost || !allowSwitch()) return;
    if (fromConnection) team.close();
    setReturnToConnection(fromConnection); setUsersOpen(false); setServerOpen(true);
  };
  const serverNavigation: ServerModuleNavigation = {
    onManageServer: canManageHost ? () => openServer() : undefined, onLeaveServer: leaveServer,
    onManageUsers:canManageTeam?()=>{if(allowSwitch()){setUsersOpen(true);setServerOpen(false);setReturnToConnection(false);}}:undefined,
    adminPageName:usersOpen?'用户与权限':'服务器管理',
    serverPage: usersOpen?<UserPermissions session={team.session} onBack={leaveServer} onChanged={()=>void team.refreshProjects().catch(()=>{})}
      onConnect={()=>{if(allowSwitch()){setUsersAfterConnection(true);setCreateAfterConnection(false);setPublishAfterConnection(null);team.show(null,true);}}}/>:serverOpen ? <ServerManager returnToConnection={returnToConnection}
      onBack={() => { leaveServer(); if (returnToConnection) team.resume(); }}
      onUseAddress={url => { setAddressRequest({ url }); leaveServer(); if (returnToConnection) team.resume(); else team.show(); }} /> : null,
  };
  const connectTeam = () => { if (allowSwitch()) { setCreateAfterConnection(false); setPublishAfterConnection(null); team.show(); } };
  const createTeam = () => {
    if (!allowSwitch()) return;
    setPublishAfterConnection(null);
    if (team.session?.user.serverRole === 'admin' && !team.session.invalid) setCreatingTeam(true);
    else { setCreateAfterConnection(true); team.show(null, true); }
  };
  const formalProject = projects.catalog.projects.find(item => item.id === projects.catalog.activeId);
  const [storedTest, setStoredTest, sessionError] = useStoredState<TestSession | null>('gamecreator.test-session.v1', null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const transfer = useProjectTransfer({ projects, lock, allowed: true, allowSwitch,
    onImported: () => { teamOrigin.current='local';setMode('local');setActiveTeamId(null); if (storedTest) setStoredTest(null); setError(''); } });
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
    if (!lock.current && !projects.blocked && allowSwitch()) setPrototypeOpen(true);
  };
  const importPrototype = async (input: PrototypeImportInput) => {
    if (lock.current || projects.blocked || !allowSwitch()) return false;
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
      teamOrigin.current='local';setMode('local');setActiveTeamId(null);
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
  const testSession = projects.catalog.mode === 'test' && valid ? storedTest : null;
  const publishProject = () => {
    if (!formalProject || testSession || activeTeamId || lock.current || projects.blocked || !allowSwitch()) return;
    setCreateAfterConnection(false);
    const source = structuredClone(formalProject);
    if (team.session?.user.serverRole === 'admin' && !team.session.invalid) setPublishingProject(source);
    else { setPublishAfterConnection(source); team.show(null, true); }
  };
  const selectProject = (id: string) => {
    if (lock.current || !allowSwitch()) return false;
    const remote = team.saved?.projects.find(item => teamProjectKey(team.saved!.serverId, item.id) === id);
    if (remote) {
      if (team.session && !team.session.invalid) {setMode('team');setActiveTeamId(remote.id);}
      else team.show(id);
      return true;
    }
    if (!projects.commit(catalog => selectSavedProject(catalog, id))) return false;
    teamOrigin.current='local';
    setMode('local');setActiveTeamId(null);
    if (storedTest) setStoredTest(null);
    setError(''); logDebug('切换项目', 'success', projects.catalog.projects.find(item => item.id === id)?.name ?? id);
    return true;
  };
  const addProject = async (input: { name: string }) => {
    if (lock.current || projects.blocked || !allowSwitch()) return false;
    if (!input.name.trim()) throw new Error('请输入项目名称');
    if (!projects.commit(catalog => addSavedProject(catalog, input.name))) return false;
    teamOrigin.current='local';setMode('local');setActiveTeamId(null);
    if (storedTest) setStoredTest(null);
    setError(''); logDebug('新建项目', 'success', input.name);
    return true;
  };
  const deleteProject = async (id: string) => {
    if (lock.current || projects.blocked) return false;
    const target = projects.catalog.projects.find(item => item.id === id);
    if (!target) throw new Error('所选本地项目不存在，可能已被删除。');
    const deletingActive = id === projects.catalog.activeId;
    if (deletingActive && !activeTeamId && !allowSwitch()) throw new Error('当前内容尚未保存或仍有操作进行中，请处理后再删除项目。');
    if (!projects.commit(catalog => removeSavedProject(catalog, id))) throw new Error('项目列表未能保存，项目尚未删除。请检查存储状态后重试。');
    if (deletingActive && storedTest) setStoredTest(null);
    setError(''); logDebug('删除本地项目', 'success', target.name);
    return true;
  };
  const configureProject = async (config: EngineConfig) => {
    if (!formalProject || lock.current || projects.blocked) return false;
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
    if (!formalProject || lock.current || projects.blocked) return;
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
  const options: SwitchableProject[] = (projects.blocked?[]:projects.catalog.projects).map(item => {
    let name = item.name;
    try {
      const raw = workspaceStorage.getItem('gamecreator.workspace.v1:' + item.id + ':project');
      if (raw && typeof JSON.parse(raw)?.name === 'string' && JSON.parse(raw).name.trim()) name = JSON.parse(raw).name;
    } catch { /* The project itself displays its archive error when selected. */ }
    return { id: item.id, name, projectPath: item.config.projectPath, kind: 'local' };
  });
  for (const item of team.saved?.projects ?? []) options.push({ id: teamProjectKey(team.saved!.serverId, item.id), name: item.name,
    projectPath: '', kind: 'team', detail: `${team.saved!.url} · ${team.session ? team.session.user.username : '未连接'}` });
  const selectedTeamKey = team.session ? `${team.session.token}:${activeTeamId}` : '';
  const availableTeam = team.session && team.saved?.projects.find(item => item.id === activeTeamId);
  if (availableTeam) lastTeamProject.current = { key: selectedTeamKey, project: availableTeam };
  // Retain the editor after revocation so its local draft and save guards survive.
  const selectedTeam = availableTeam || (lastTeamProject.current?.key === selectedTeamKey ? lastTeamProject.current.project : null);
  const teamNotice = team.session && !team.saved?.projects.length ? `已连接 ${team.session.user.username}，尚未加入协作项目。请联系项目管理员添加。` : undefined;
  const returnToStart=()=>{if(!allowSwitch())return;team.disconnect();setMode('start');setActiveTeamId(null);leaveServer();setCreatingTeam(false);setPublishingProject(null);setPublishAfterConnection(null);setCreateAfterConnection(false);setUsersAfterConnection(false);};
  const disconnectTeam=()=>{if(!allowSwitch())return;team.disconnect();setActiveTeamId(null);leaveServer();setMode(teamOrigin.current);};
  const enterLocal=()=>{teamOrigin.current='local';setMode('local');};
  const refreshDirectory=()=>void team.refreshProjects().catch(()=>{});
  const openTeamProject=(id:string)=>{if(allowSwitch()){setMode('team');setActiveTeamId(id);leaveServer();}};
  const shellProps={session:team.session,teamWorkspace:mode==='team',onHome:returnToStart,onDisconnect:disconnectTeam,onProjects:()=>{if(allowSwitch()){setMode('team');setActiveTeamId(null);leaveServer();}}};
  if(mode==='start')return <><div hidden={serverOpen}><WorkspaceEntry connection={team} addressRequest={addressRequest} onLocal={enterLocal} onManageServer={canManageHost?()=>openServer():undefined} onConnected={id=>{teamOrigin.current='start';setMode('team');setActiveTeamId(id);}}/></div>{serverOpen&&<ServerManager backLabel="返回启动页" returnToConnection={false} onBack={leaveServer} onUseAddress={url=>{setAddressRequest({url});leaveServer();}}/>}</>;
  if(projects.blocked&&mode==='local'&&!serverOpen&&!usersOpen)return <WorkspaceShell {...shellProps}><main className="enum-catalog-empty" role="alert"><AlertTriangle size={32}/><h1>项目列表读取失败</h1><p>本地项目列表暂时无法读取，现有内容未被覆盖。可以返回启动页连接团队。</p><p>{projects.error}</p><button onClick={returnToStart}>返回启动页连接团队</button></main></WorkspaceShell>;
  return <WorkspaceShell {...shellProps}><TeamConnectionDialog connection={team} onConnected={id => {
    leaveServer(); if(!publishAfterConnection){setMode('team');setActiveTeamId(id);}else{setMode('local');setActiveTeamId(null);}
    if(usersAfterConnection)setUsersOpen(true);
    if (createAfterConnection) setCreatingTeam(true);
    if (publishAfterConnection) setPublishingProject(publishAfterConnection);
    setCreateAfterConnection(false); setPublishAfterConnection(null);setUsersAfterConnection(false);
  }} addressRequest={addressRequest}
    onDismiss={() => { setCreateAfterConnection(false); setPublishAfterConnection(null); setUsersAfterConnection(false); }}
    onManageServer={canManageHost ? () => openServer(true) : undefined} />
    {creatingTeam && canManageTeam && team.session && <TeamProjectDialog session={team.session} onClose={() => setCreatingTeam(false)}
      onCreated={project => { team.addProject(project); setCreatingTeam(false); leaveServer();setMode('team'); setActiveTeamId(project.id); }} />}
    {publishingProject && canManageTeam && team.session && <PublishProjectDialog session={team.session} project={publishingProject} onClose={() => setPublishingProject(null)}
      onPublished={project => { team.addProject(project); setPublishingProject(null); leaveServer();setMode('team'); setActiveTeamId(project.id); }} />}
    <ProjectPackageDialog state={transfer.state} names={options.filter(item => item.kind === 'local').map(item => item.name)}
      onClose={transfer.close} onChoose={transfer.reselect} onImport={transfer.importProject} />
    <PrototypeImportDialog open={prototypeOpen} busy={prototypeBusy} projects={options.filter(item => item.kind === 'local')}
      onClose={() => { if (!importingPrototype.current) setPrototypeOpen(false); }} onImport={importPrototype} />
    {mode==='team'&&!selectedTeam&&team.session?<div className="app team-project"><WorkspaceSidebar team empty picker={<ProjectSwitcher projects={options} currentId={null} currentName="选择协作项目" busy={preparing||prototypeBusy||transfer.busy} canAdd={!projects.blocked} onSelect={selectProject} onAdd={addProject} onDelete={deleteProject} onConnectTeam={connectTeam} onCreateTeam={canManageTeam?createTeam:undefined}/>} active={serverNavigation.serverPage?serverNavigation.adminPageName??'服务器管理':''} onNavigate={()=>{}} onManageServer={serverNavigation.onManageServer} onManageUsers={serverNavigation.onManageUsers} footer={<div className="user"><div className="avatar">{team.session.user.username[0]}</div><span>{team.session.user.username}<small>团队协作</small></span></div>}/>{serverNavigation.serverPage}<div hidden={!!serverNavigation.serverPage} className="team-selection-content"><TeamProjectSelection session={team.session} projects={team.saved?.projects??[]} error={team.error} onSelect={openTeamProject} onRefresh={refreshDirectory} onConnect={connectTeam} onCreate={canManageTeam?createTeam:undefined}/></div></div>
    :selectedTeam && team.session ? <TeamProjectWorkspace key={`${team.session.serverId}:${team.session.user.id}:${selectedTeam.id}:${team.session.token}`} project={selectedTeam} session={team.session}
      {...serverNavigation}
      localProjects={(projects.blocked?[]:projects.catalog.projects).map(item => ({ ...item, name: options.find(option => option.id === item.id)?.name || item.name }))}
      picker={<ProjectSwitcher projects={options} teamNotice={teamNotice} currentId={teamProjectKey(team.session.serverId, selectedTeam.id)} currentName={selectedTeam.name} canAdd={!projects.blocked} busy={preparing || prototypeBusy || transfer.busy || projects.blocked}
        onSelect={selectProject} onAdd={addProject} onDelete={deleteProject} onConnectTeam={connectTeam} onCreateTeam={canManageTeam||!team.session?createTeam:undefined} onImportPrototype={openPrototypeImport} onImportProject={transfer.enabled ? transfer.openImport : undefined} />}
      onConnection={connectTeam} onDisconnect={disconnectTeam} />
    : formalProject ? <ProjectDataUpgrade key={testSession?.id ?? 'project:' + formalProject.id} username={username}
    {...serverNavigation}
    formalProject={formalProject} projectOptions={options} onSelectProject={selectProject} onAddProject={addProject} onDeleteProject={deleteProject}
    onConnectTeam={connectTeam} onCreateTeam={canManageTeam||!team.session?createTeam:undefined} onPublishProject={publishProject} teamNotice={teamNotice} onImportPrototype={openPrototypeImport}
    onImportProject={transfer.enabled ? transfer.openImport : undefined}
    onExportProject={transfer.enabled ? () => transfer.openExport(formalProject) : undefined}
    onConfigChange={configureProject}
    onRenameProject={name => projects.commit(catalog => ({ ...catalog, projects: catalog.projects.map(item => item.id === formalProject.id ? { ...item, name } : item) }))}
    testSession={testSession} onLoadTest={load} onExitTest={exit} preparingTest={preparing || prototypeBusy || transfer.busy || projects.blocked}
    testError={error || projects.error || sessionError || (storedTest && !valid ? '测试会话信息无效，已回到正式工作区。' : '')} />
    : <div className="app local-workspace empty-project-workspace">
      <WorkspaceSidebar active={serverNavigation.serverPage ? serverNavigation.adminPageName??'服务器管理' : ''} onNavigate={() => {if(canLeaveTeam())leaveServer();}} onManageServer={serverNavigation.onManageServer} onManageUsers={serverNavigation.onManageUsers} empty
        picker={<ProjectSwitcher projects={options} teamNotice={teamNotice} currentId={null} currentName="未选择项目" canAdd={!projects.blocked} busy={prototypeBusy || transfer.busy}
          onSelect={selectProject} onAdd={addProject} onDelete={deleteProject} onConnectTeam={connectTeam} onCreateTeam={canManageTeam||!team.session?createTeam:undefined} onImportPrototype={openPrototypeImport} onImportProject={transfer.enabled ? transfer.openImport : undefined} />}
        footer={<div className="user"><div className="avatar">{username.slice(0, 1).toUpperCase()}</div><div><b>{username}</b><small>本地项目</small></div></div>} />
      {serverNavigation.serverPage || <main className="empty-project-main"><FolderOpen size={40} /><h1>暂无本地项目</h1>
        <p>从左上角项目菜单新建项目、导入原型示例或项目文件夹。</p>
        <p>也可以连接团队服务器，选择已有的协作项目。</p>
        <button type="button" className="ps-secondary-button" onClick={connectTeam}>连接团队服务器</button>
        {projects.error && <p role="alert">{projects.error}</p>}
      </main>}
    </div>}</WorkspaceShell>;
}

function ProjectDataUpgrade(props: ComponentProps<typeof WorkspaceApp>) {
  const upgrade = () => {
    try {
      if (!props.testSession) migrateUnusedDefaultTables(workspaceStorage, props.formalProject);
      return '';
    } catch (reason) { return String(reason); }
  };
  const [error, setError] = useState(upgrade);
  if (error) return <main className="enum-catalog-empty" role="alert">
    <AlertTriangle size={32} /><h1>项目数据更新未完成</h1>
    <p>默认空表清理未完成，请重试或切换到其他项目。</p><p>{error}</p>
    <button className="primary" onClick={() => setError(upgrade())}>重试更新</button>
    <ProjectSwitcher projects={props.projectOptions} currentId={props.formalProject.id} currentName={props.formalProject.name}
      canAdd busy={props.preparingTest} onSelect={props.onSelectProject} onAdd={props.onAddProject} onDelete={props.onDeleteProject} />
  </main>;
  return <WorkspaceApp {...props} />;
}

const initialTestProject = { ...initialProject, name: '枚举测试工作区' };
function WorkspaceApp({ username, testSession, onLoadTest, onExitTest, preparingTest, testError, formalProject, projectOptions, onSelectProject, onAddProject, onDeleteProject, onConfigChange, onRenameProject, onConnectTeam, onCreateTeam, onPublishProject, teamNotice, onImportPrototype, onImportProject, onExportProject, serverPage, onManageServer, onLeaveServer, adminPageName, onManageUsers }: {
  onImportProject?: () => void; onExportProject?: () => void;
  teamNotice?: string;
  onPublishProject: () => void;
  formalProject: SavedProject; projectOptions: SwitchableProject[]; onConnectTeam: () => void; onCreateTeam?: () => void; onImportPrototype: () => void;
  onDeleteProject: (id: string) => Promise<boolean>;
  onSelectProject: (id: string) => boolean; onAddProject: (input: { name: string }) => Promise<boolean>;
  onConfigChange: (config: EngineConfig) => Promise<boolean>; onRenameProject: (name: string) => boolean;
  username: string; testSession: TestSession | null; onLoadTest: (scenario: TestScenarioId) => Promise<void>;
  onExitTest: () => void; preparingTest: boolean; testError: string;
} & ServerModuleNavigation) {
  const [active, setActive] = useState(testSession ? '枚举管理' : '项目概览');

  const [activeGameplayId, setActiveGameplayId] = useState('');
  const [gameplaySource, setGameplaySource] = useState<{ kind: string; id: string } | undefined>();
  const [functionalSelection, setFunctionalSelection] = useState<FunctionalSelection>(null);
  const [artSelection, setArtSelection] = useState<ArtSelection>(null);

  const engineConfig = testSession?.config ?? formalProject.config;
  const isNewProject = !testSession && formalProject.initialContent === 'empty';
  const dataKey = testSession ? projectIdentity(engineConfig.projectPath) : formalProject.id;
  const storyState=useStoryDocuments(dataKey,isNewProject?emptyStories:initialStoryDocs);
  const {docs:storyDocs,update:setStoryDocs,error:storyError}=storyState;
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
  const core = useGameplayCore(dataKey);
  const prototype = usePrototypeDesign(dataKey);
  const tasks = useTaskFlows(dataKey);
  const analysis = useNumericalAnalysis(dataKey);
  const schedule = useProjectSchedule(dataKey, isNewProject ? emptyMilestones : initialMilestones);
  const [requestedSchedule, setRequestedSchedule] = useState<{ kind: 'task' | 'milestone'; id: string }>();
  const narrative = useStoryOrchestration(dataKey);
  const maps = useMapDesign(dataKey, gameplay.store.designs);
  const [requestedPrototype,setRequestedPrototype] = useState('');
  const [requestedMap,setRequestedMap] = useState('');
  const [requestedCharacter,setRequestedCharacter] = useState('');
  const [narrativeId,setNarrativeId] = useState('');
  const [requestedTask,setRequestedTask] = useState<{id:string}>();
  const functional = useFunctionalSystems(dataKey);
  const art = useArtAssets(dataKey, testSession ? 'test:' + testSession.id : 'project:' + formalProject.id);
  useEffect(() => {
    const guard = (event: Event) => { if (gameplay.pending || functional.pending || art.pending || core.pending || prototype.pending || tasks.pending || narrative.pending || maps.pending || schedule.pending || analysis.pending || storyState.pending) event.preventDefault(); };
    window.addEventListener(beforeLogoutEvent, guard);
    return () => window.removeEventListener(beforeLogoutEvent, guard);
  }, [gameplay.pending, functional.pending, art.pending, core.pending, prototype.pending, tasks.pending, narrative.pending, maps.pending, schedule.pending, analysis.pending, storyState.pending]);
  const currentData = registry.data;
  const [allDefinitions, setDefinitions, definitionsError] = useStoredState<DatasetDef[]>('gamecreator.workspace.v1:' + dataKey + ':definitions', isNewProject ? emptyDatasetDefinitions : datasetDefinitions);
  const definitions = Object.keys(currentData.datasets).map(key =>
    ({ ...(allDefinitions.find(item => item.key === key) ?? { key, label: key, badge: '' }), columns: currentData.columns[key] }));
  const currentDataset = resolveActiveDataset(definitions, currentData, activeDataset);
  useEffect(() => {
    if (active !== '数据配置' || !currentDataset || currentDataset === activeDataset) return;
    setDatasetSelection({ workspaceKey: dataKey, key: currentDataset });
    patchDataViewState(dataKey, { activeDataset: currentDataset });
  }, [active, activeDataset, currentDataset, dataKey]);
  const milestones: Milestone[] = schedule.store.milestones.map(m => ({ title: m.title, owner: m.owner || '未分配', due: m.due || '日期未定', status: m.status === '已验收' ? 'done' : m.status === '进行中' ? 'active' : 'planned' }));

  const [activeStoryId, setActiveStoryId] = useState(initialStoryDocs[0].id);
  const projectDefaults = useMemo(() => testSession ? initialTestProject : isNewProject
    ? { ...initialProject, name: formalProject.name, version: 'v0.1.0', description: '' } : { ...initialProject, name: formalProject.name }, [testSession?.id, isNewProject, formalProject.id, formalProject.name]);
  const [project, setProject, projectError] = useStoredState('gamecreator.workspace.v1:' + dataKey + ':project', projectDefaults);

  const functionalSources = { designs: gameplay.store.designs, data: currentData, definitions };
  const artSources = { designs: gameplay.store.designs, functional: functional.store };
  const openArtRequirement = (id: string) => { setArtSelection({ kind: 'requirement', id }); setActive('素材资产'); };
  const openCapability = (id: string) => { setFunctionalSelection({ kind: 'capability', id }); setActive('功能系统'); };
  const openGameplay = (id: string, kind = 'design', sourceId = '') => { setActiveGameplayId(id); setGameplaySource({ kind, id: sourceId }); setActive('玩法设计'); };
  const completedMilestones = milestones.filter((milestone) => milestone.status === 'done').length;
  const progress = milestones.length ? Math.round((completedMilestones / milestones.length) * 100) : 0;
  const storageError = [definitionsError, storyError, projectError, registry.error, gameplay.error, functional.error, art.error, core.error, prototype.error, tasks.error, narrative.error, maps.error, schedule.error, analysis.error].filter(Boolean).join('；');

  const exportAiContext = async () => {
    if (testSession || gameplay.blocked || gameplay.pending || functional.blocked || functional.pending || art.blocked || art.pending || core.blocked || prototype.blocked || tasks.blocked || narrative.blocked || maps.blocked || schedule.blocked || analysis.blocked || core.pending || prototype.pending || tasks.pending || narrative.pending || maps.pending || schedule.pending || analysis.pending || storyState.pending) return;
    const markdown = buildAiMarkdown(project, storyDocs, currentData, definitions, engineConfig, registry, gameplay.store.designs, functional.store, art.store, core.store, prototype.store, tasks.store, narrative.store, maps.store, gameplay.store.categories || [], schedule.store, analysis.store);
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
        document.id === id ? { ...document, ...changes, updated: '刚刚',updatedAt:new Date().toISOString() } : document,
      ),
    );
  };

  const addStoryDoc = (draft?:StoryDoc) => {const d=draft||makeStory();setStoryDocs(current=>[...current,d]);setActiveStoryId(d.id);};
  const [requestedStory,setRequestedStory]=useState<{id:string}>();
  const openStory=(id:string)=>{setRequestedStory({id});setActiveStoryId(id);setActive('故事文档');};
  useEffect(()=>{if(active!=='故事文档')setRequestedStory(undefined);},[active]);
  const storySources={stories:storyDocs,gameplay:gameplay.store,functional:functional.store,art:art.store,maps:maps.store,narrative:narrative.store,tasks:tasks.store};
  const onStoryReference=(r:StoryReference)=>{
    if(r.sourceOnly)return;
    if(r.kind==='story')openStory(r.targetId);else if(r.kind==='gameplay')openGameplay(r.targetId);else if(r.kind==='capability')openCapability(r.targetId);else if(r.kind==='requirement')openArtRequirement(r.targetId);
    else if(r.kind==='asset'){setArtSelection({kind:'asset',id:r.targetId});setActive('素材资产');}
    else if(r.kind==='map'){setRequestedMap(r.targetId);setActive('地图设计');}
    else if(r.kind==='task'){setRequestedTask({id:r.targetId});setActive('任务与流程');}
    else{setRequestedCharacter(r.kind==='character'?r.targetId:'');setNarrativeId(r.kind==='narrative'?r.targetId:narrative.store.stories.find(s=>s.actors.some(a=>a.characterId===r.targetId))?.id||narrative.store.stories[0]?.id||'');setActive('故事编排');}
  };

  const toggleMilestone = (index: number) => { setRequestedSchedule({ kind: 'milestone', id: schedule.store.milestones[index]?.id || '' }); setActive('项目排期'); };
  const addMilestone = () => { setRequestedSchedule({ kind: 'milestone', id: '' }); setActive('项目排期'); };

  const openSearchTarget = (t: SearchTarget) => {
    if(!canLeaveTeam())return false;
    onLeaveServer();
    if(t.module==='玩法设计')openGameplay(t.parent||t.id,t.kind||'design',t.parent?t.id:'');
    else if(t.module==='功能系统'){setFunctionalSelection({kind:t.kind==='system'?'system':'capability',id:t.id});setActive(t.module);}
    else if(t.module==='素材资产'){setArtSelection({kind:t.kind==='asset'?'asset':'requirement',id:t.id});setActive(t.module);}
    else if(t.module==='原型设计'){setRequestedPrototype(t.parent||t.id);setActive(t.module);}
    else if(t.module==='地图设计'){setRequestedMap(t.parent||t.id);setActive(t.module);}
    else if(t.module==='故事文档'){openStory(t.id);}
    else if(t.module==='故事编排'){setRequestedCharacter(t.kind==='character'?t.id:'');setNarrativeId(t.kind==='character'?(narrative.store.stories.find(s=>s.actors.some(a=>a.characterId===t.id))?.id||narrative.store.stories[0]?.id||''):t.parent||t.id);setActive(t.module);}
    else if(t.module==='项目排期'){setRequestedSchedule({kind:t.kind==='milestone'?'milestone':'task',id:t.id});setActive(t.module);}
    else if(t.module==='任务与流程'){setRequestedTask({id:t.id});setActive(t.module);}
    else if(t.module==='数据配置'){setActiveDataset(t.parent||t.id);setActive(t.module);}
    else setActive(t.module);
  };
  const searchSources = useMemo(()=>({analysis:analysis.blocked?undefined:analysis.store,project:projectError?undefined:project,gameplay:gameplay.blocked?undefined:gameplay.store,core:core.blocked?undefined:core.store,functional:functional.blocked?undefined:functional.store,art:art.blocked?undefined:art.store,prototype:prototype.blocked?undefined:prototype.store,maps:maps.blocked?undefined:maps.store,narrative:narrative.blocked?undefined:narrative.store,schedule:schedule.blocked?undefined:schedule.store,tasks:tasks.blocked?undefined:tasks.store,stories:storyError?undefined:storyDocs,data:registry.data,definitions,enums:registry.active?.scan}),[analysis.store,analysis.blocked,project,projectError,gameplay.store,gameplay.blocked,core.store,core.blocked,functional.store,functional.blocked,art.store,art.blocked,prototype.store,prototype.blocked,maps.store,maps.blocked,narrative.store,narrative.blocked,schedule.store,schedule.blocked,tasks.store,tasks.blocked,storyDocs,storyError,registry.data,definitions,registry.active]);
  return (
    <GlobalSearchProvider activeModule={active} key={dataKey} sources={searchSources} warning={storageError ? "部分内容读取或保存异常，请检查各模块状态。" : ""} onNavigate={()=>{if(canLeaveTeam()){onLeaveServer();setActive('全局搜索');}}} onOpen={openSearchTarget}><div className="app local-workspace">
      <WorkspaceSidebar picker={<ProjectSwitcher projects={projectOptions} teamNotice={teamNotice} currentId={testSession ? null : formalProject.id} currentName={project.name}
          testName={testSession ? testScenarios.find(item=>item.id===testSession.scenario)?.name : undefined}
          canAdd busy={preparingTest || registry.busy || registry.loading || gameplay.pending || functional.pending || functional.blocked || art.pending || art.blocked || core.pending || prototype.pending || tasks.pending || narrative.pending || maps.pending || schedule.pending || analysis.pending || storyState.pending} onSelect={onSelectProject} onAdd={onAddProject} onDelete={onDeleteProject} onConnectTeam={onConnectTeam} onCreateTeam={onCreateTeam} onPublishProject={!testSession && !storageError ? onPublishProject : undefined} onImportPrototype={onImportPrototype} onImportProject={onImportProject} onExportProject={!testSession && !storageError ? onExportProject : undefined} />} active={serverPage ? adminPageName??'服务器管理' : active}
        mapEnabled={maps.store.enabled} storyEnabled={narrative.store.enabled} onNavigate={name => { if(canLeaveTeam()){onLeaveServer(); setRequestedSchedule(undefined); setActive(name);} }} onManageServer={onManageServer} onManageUsers={onManageUsers} footer={<>
        <button onClick={()=>{if(canLeaveTeam()){onLeaveServer();setActive('工作区设置');}}}><Settings2 size={17} />工作区设置</button><div className="user"><div className="avatar">G</div><span>{username}<small>本地项目</small></span></div>
      </>} />

      {serverPage}
      <main hidden={!!serverPage} className={active === '玩法核心' ? 'core-workspace-page' : active === '项目排期' ? 'schedule-workspace-page' : undefined}>
        <header>
          <div><div className="crumb">{project.name.toUpperCase()} <span>/</span> {active.toUpperCase()}</div><h1>{active}</h1></div>
          <div className="header-actions">
            {<TestPanel page={active} username={username} config={engineConfig} registry={registry} testSession={testSession}
              busy={preparingTest || gameplay.pending || functional.pending || functional.blocked || art.pending || art.blocked || core.pending || prototype.pending || tasks.pending || narrative.pending || maps.pending || schedule.pending || analysis.pending || storyState.pending} error={testError || storageError} onLoad={onLoadTest} onExit={onExitTest} onNavigate={setActive} />}
            <GlobalSearchInput/>
            <button className="save" disabled={!!testSession || gameplay.blocked || gameplay.pending || functional.blocked || functional.pending || art.blocked || art.pending || core.blocked || prototype.blocked || tasks.blocked || narrative.blocked || maps.blocked || schedule.blocked || analysis.blocked || core.pending || prototype.pending || tasks.pending || narrative.pending || maps.pending || schedule.pending || analysis.pending || storyState.pending} title={testSession ? "测试工作区可在面板复制诊断信息" : undefined} onClick={exportAiContext}><FileText size={16} />生成 AI 文档</button>
            <span className="save" role="status">{storageError ? <AlertTriangle size={16} /> : <Check size={16} />}{storageError ? '请检查保存状态' : registry.busy ? '正在保存…' : '已自动保存'}</span>
          </div>
        </header>

        <SearchReturn active={active==='全局搜索'}/><GlobalSearchPanel active={active==='全局搜索'}/>
        {testSession && <div className="test-workspace-banner" role="status"><span><b>测试工作区</b> · {testScenarios.find(item=>item.id===testSession.scenario)?.name} · 数据独立保存</span>
          <button disabled={preparingTest || registry.busy || registry.loading || gameplay.pending || functional.pending || functional.blocked || art.pending || art.blocked || core.pending || prototype.pending || tasks.pending || narrative.pending || maps.pending || schedule.pending || analysis.pending || storyState.pending} onClick={onExitTest}>返回原工作区</button></div>}
        {testError && <p className="field-error" role="alert">{testError}</p>}
        {storageError && !gameplay.error && !functional.error && !art.error && !core.error && !prototype.error && !tasks.error && !narrative.error && !maps.error && !schedule.error && !analysis.error && <p className="field-error" role="alert">{storageError}</p>}
        {gameplay.error && <div className="gp-save-error" role="alert"><span>{gameplay.error}{gameplay.pending && "。草稿保留在当前窗口，请重试保存后再切换项目。"}</span>{gameplay.pending && <button className="gp-secondary" onClick={gameplay.retry}>重试保存玩法</button>}</div>}
        {functional.error && <div className="gp-save-error" role="alert"><span>{functional.error}{functional.pending && '。草稿保留在当前窗口，请重试保存后再切换项目。'}</span>{functional.pending && <button className="gp-secondary" onClick={functional.retry}>重试保存功能系统</button>}</div>}
        {art.error && <div className="gp-save-error" role="alert"><span>{art.error}{art.pending && '。草稿保留在当前窗口，请重试保存后再切换项目。'}</span>{art.pending && <button className="gp-secondary" onClick={art.retry}>重试保存素材资产</button>}</div>}
        {core.error && <div className="gp-save-error" role="alert"><span>{core.error}{core.pending && '。草稿保留在当前窗口，请重试保存后再切换项目。'}</span>{core.pending && <button className="gp-secondary" onClick={core.retry}>重试保存玩法核心</button>}</div>}
        {prototype.error && active !== '原型设计' && <div className="gp-save-error" role="alert"><span>{prototype.error}</span><button onClick={() => setActive('原型设计')}>处理原型存档</button></div>}
        {active === '原型设计' && <PrototypeDesign onOpenMap={id=>{setRequestedMap(id);setActive(maps.store.enabled?'地图设计':'工作区设置');}} requestedId={requestedPrototype} maps={maps.store} controller={prototype} designs={gameplay.store.designs} core={core.store} art={art.store} workspaceId={art.workspaceId} onOpenGameplay={openGameplay} />}
        {narrative.error && active !== '故事编排' && active !== '工作区设置' && <div className="gp-save-error" role="alert"><span>{narrative.error}</span><button onClick={()=>setActive('工作区设置')}>处理故事存档</button></div>}
        {maps.error && active !== '地图设计' && active !== '工作区设置' && <div className="gp-save-error" role="alert"><span>{maps.error}</span><button onClick={()=>setActive('工作区设置')}>处理地图存档</button></div>}
        {schedule.error && active !== '项目排期' && <div className="gp-save-error" role="alert"><span>{schedule.error}</span><button onClick={() => setActive('项目排期')}>处理排期存档</button></div>}
        {active === '项目排期' && <ProjectSchedule controller={schedule} requested={requestedSchedule} sources={buildScheduleSources(gameplay.store.designs, functional.store, art.store, maps.store, prototype.store)} onOpenReference={ref => {
          if (ref.kind === 'gameplay') openGameplay(ref.targetId);
          else if (ref.kind === 'capability') openCapability(ref.targetId);
          else if (ref.kind === 'requirement') openArtRequirement(ref.targetId);
          else if (ref.kind === 'asset') { setArtSelection({ kind: 'asset', id: ref.targetId }); setActive('素材资产'); }
          else if (ref.kind === 'map') { setRequestedMap(ref.targetId); setActive(maps.store.enabled ? '地图设计' : '工作区设置'); }
          else { setRequestedPrototype(ref.targetId); setActive('原型设计'); }
        }}/>}
        {active === '工作区设置' && <><StoryModuleSettings controller={narrative} onOpen={()=>setActive('故事编排')}/><MapModuleSettings controller={maps} onOpen={()=>setActive('地图设计')}/></>}
        {active === '地图设计' && maps.store.enabled && <MapDesign requestedId={requestedMap} controller={maps} gameplay={gameplay} prototype={prototype.store} prototypeBlocked={prototype.blocked||prototype.pending} targets={{gameplay:gameplay.store.designs.map(d=>({id:d.id,name:d.title})),task:tasks.store.tasks.map(t=>({id:t.id,name:t.title})),story:storyDocs.map(s=>({id:s.id,name:s.title})),character:(narrative.store.characters||[]).map(c=>({id:c.id,name:c.name})),asset:art.store.assets.map(a=>({id:a.id,name:a.name})),prototype:prototype.store.scenes}} onOpenReference={ref=>{
          if(ref.kind==='gameplay')openGameplay(ref.targetId,'object');
          else if(ref.kind==='task'){setRequestedTask({id:ref.targetId});setActive('任务与流程');}
          else if(ref.kind==='story'){openStory(ref.targetId);}
          else if(ref.kind==='character'){const story=narrative.store.stories.find(s=>s.actors.some(a=>a.characterId===ref.targetId));setRequestedCharacter(ref.targetId);setNarrativeId(story?.id||narrative.store.stories[0]?.id||'');setActive(narrative.store.enabled?'故事编排':'工作区设置');}
          else if(ref.kind==='asset'){setArtSelection({kind:'asset',id:ref.targetId});setActive('素材资产');}
          else{setRequestedPrototype(ref.targetId);setActive('原型设计');}
        }} onGeneratePrototype={()=>{const scenes=prototypeFromMaps(maps.store,gameplay.store.designs);if(scenes.length&&prototype.update(s=>({...s,entryId:s.entryId||scenes[0].id,scenes:[...s.scenes,...scenes]}))){setRequestedPrototype(scenes[0].id);setActive('原型设计');}}}/>}
        {active === '故事编排' && narrative.store.enabled && <StoryOrchestration requestedCharacterId={requestedCharacter} art={art.store} workspaceId={art.workspaceId} controller={narrative} data={currentData} tasks={tasks.store.tasks} selectedId={narrativeId} onSelect={setNarrativeId} onOpenTask={id=>{setRequestedTask({id});setActive('任务与流程');}}/>}
        {tasks.error && <div className="gp-save-error" role="alert"><span>{tasks.error}</span>{tasks.pending && <button className="gp-secondary" onClick={tasks.retry}>重试保存任务与流程</button>}</div>}
        <div hidden={active !== '任务与流程'}><TaskFlows requestedTask={requestedTask} storyLinks={narrative.store.enabled ? narrative.store.stories.filter(s=>!s.archived).map(s=>({id:s.id,title:s.title,taskIds:[...s.taskIds,...s.nodes.flatMap(n=>n.taskIds)]})) : []} onOpenStory={id=>{setNarrativeId(id);setActive('故事编排');}} controller={tasks} sources={{ designs: gameplay.store.designs, capabilities: functional.store.capabilities.map(c => ({ ...c, archived: c.archived || !!functional.store.systems.find(s => s.id === c.systemId)?.archived })), stories: storyDocs, assets: art.store.assets, definitions, data: currentData }} onOpenReference={ref => {
          if (ref.kind === 'gameplay') openGameplay(ref.targetId);
          else if (ref.kind === 'capability') openCapability(ref.targetId);
          else if (ref.kind === 'story') { openStory(ref.targetId); }
          else if (ref.kind === 'asset') { setArtSelection({ kind: 'asset', id: ref.targetId }); setActive('素材资产'); }
          else { setActiveDataset(ref.targetId); setActive('数据配置'); }
        }} /></div>
        <div hidden={active !== '玩法核心'}><GameplayCore controller={core} designs={gameplay.store.designs} onOpenGameplay={openGameplay} /></div>
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
        {active === '玩法设计' && <GameplayDesigns objectReferences={(designId, objectId) => art.blocked || prototype.blocked || tasks.blocked || maps.blocked ? ["关联存档暂不可读，请恢复后再删除对象"] : [...mapObjectReferences(maps.store, gameplay.store.designs, designId, objectId), ...art.store.requirements.filter(r => r.sources.some(s => s.kind === "gameplay" && s.targetId === designId && s.sourceKind === "object" && s.sourceId === objectId)).map(r => "素材需求 / " + r.name), ...prototype.store.scenes.filter(s => (s.mapId ? maps.store.maps.filter(m=>m.id===s.mapId).map(m=>mapSource(m,gameplay.store.designs).source?.id)[0] : prototypeSource(s, gameplay.store.designs).source?.id) === designId).flatMap(s => s.elements.filter(e => e.sourceObjectId === objectId).map(e => "原型设计 / " + s.name + " / " + e.name))]} selectedId={activeGameplayId} onSelect={id => { setActiveGameplayId(id); setGameplaySource(undefined); }} initialSource={gameplaySource} renderImplementation={d => <><GameplayFunctions controller={functional} sources={functionalSources} gameplayId={d.id} archived={d.archived} onOpenCapability={openCapability} /><ArtReferences controller={art} sources={artSources} kind="gameplay" targetId={d.id} onOpenRequirement={openArtRequirement} /></>} controller={gameplay} sources={{ stories: storyDocs, datasets: definitions }} onOpenLink={link => {
          if (link.kind === 'story') { openStory(link.targetId); }
          else { setActiveDataset(link.targetId); setActive('数据配置'); }
        }} />}
        {active === '素材资产' && <ArtAssets controller={art} sources={artSources} selected={artSelection} onSelect={setArtSelection} onOpenGameplay={openGameplay} onOpenCapability={openCapability} />}
        {active === '功能系统' && <FunctionalSystems workspaceId={dataKey} renderArtReferences={c => <ArtReferences controller={art} sources={artSources} kind="capability" targetId={c.id} onOpenRequirement={openArtRequirement} />} controller={functional} sources={functionalSources} selected={functionalSelection} onSelect={setFunctionalSelection} onOpenGameplay={openGameplay} onOpenDataset={key => { setActiveDataset(key); setActive('数据配置'); }} />}
        {active === '故事文档' && (storyState.pending||storyState.blocked) && <div className="sl-notice" role="alert">{storyError}<button disabled={storyState.blocked} onClick={storyState.retry}>重试保存故事文档</button><button onClick={()=>{if(!storyState.pending||window.confirm('重新读取会放弃未保存的故事草稿。请先导出备份，再确认继续。'))storyState.reload();}}>重新读取故事文档</button><button onClick={()=>{const u=URL.createObjectURL(new Blob([JSON.stringify(storyDocs,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=u;a.download='story-draft.json';a.click();URL.revokeObjectURL(u);}}>导出故事草稿</button></div>}
        {active === '故事文档' && (
          <StoryDocuments workspaceKey={dataKey} requestedId={requestedStory} targets={storyTargets(storySources)} incoming={id=>incomingStories(storySources,id)} onOpenReference={onStoryReference}
            documents={storyDocs}
            activeStoryId={activeStoryId}
            setActiveStoryId={setActiveStoryId}
            updateStory={updateStory}
            addStoryDoc={addStoryDoc}
            readOnly={storyState.blocked}
          />
        )}
        {analysis.error && <div className="gp-save-error" role="alert"><span>{analysis.error}</span>{analysis.pending && <button onClick={analysis.retry}>重试保存数值分析</button>}<button onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(analysis.store,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='numerical-analysis-draft.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>下载数值分析草稿</button><button onClick={()=>{if(window.confirm('重新读取会放弃当前未保存修改。可先下载草稿备份，是否继续？'))analysis.reload();}}>重新读取数值分析存档</button></div>}
        {active === '数值分析' && (registry.loading || registry.busy || registry.error || narrative.blocked || narrative.pending ? <p role="alert">来源数据尚未就绪，请先处理配置或故事存档：{registry.error || narrative.error}</p> : <NumericalAnalysis controller={analysis} sources={{data:currentData,narrative:narrative.store}} definitions={definitions} designs={gameplay.store.designs} onOpenDataset={key=>{setActiveDataset(key);setActive('数据配置');}} onOpenGameplay={id=>openGameplay(id)}/>)}
        {active === '数据配置' && <DataConfiguration key={dataKey} workspaceKey={dataKey} data={currentData}
          onChange={(next) => registry.updateData(next)}
          definitions={definitions} activeDataset={currentDataset} setActiveDataset={setActiveDataset} registry={registry} onCreateTable={createDataset} />}
        {active === '枚举定义' && <EnumDefinitions registry={registry} />}
        {active === '枚举管理' && <EnumManager config={engineConfig} registry={registry} />}
        {active === '引擎设置' && <fieldset disabled={!!testSession} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>{testSession && <p>测试场景使用固定来源，请通过测试面板加载或重置场景。</p>}<EngineSettings config={engineConfig} registry={registry} onPickDirectory={window.desktopClient?.pickProjectDirectory} setConfig={(next) => testSession ? Promise.resolve(false) : onConfigChange(next)} /></fieldset>}
        {active !== '全局搜索' && active !== '数值分析' && active !== '项目排期' && active !== '地图设计' && active !== '工作区设置' && active !== '故事编排' && active !== '原型设计' && active !== '任务与流程' && active !== '项目概览' && active !== '玩法核心' && active !== '玩法设计' && active !== '功能系统' && active !== '素材资产' && active !== '故事文档' && active !== '数据配置' && active !== '枚举定义' && active !== '枚举管理' && active !== '引擎设置' && (
          <section className="empty">
            <div className="empty-icon"><Layers size={34} /></div>
            <h2>{active}</h2>
            <p>这个工作区正在搭建中，你可以先从项目概览、故事文档和数据配置开始。</p>
            <button className="primary"><Plus size={16} />创建第一个内容</button>
          </section>
        )}
      </main>
    </div></GlobalSearchProvider>
  );
}

function App() {
  return <WorkspaceController/>;
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
