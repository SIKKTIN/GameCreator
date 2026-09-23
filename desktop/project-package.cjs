let validateProjectStandards, validateMaterialDocumentFields, validateProductionDocs, validateDevelopmentTools;
const productionReady=Promise.all([import('../shared/project-standards.mjs').then(m=>{validateProjectStandards=m.validateProjectStandards;}),import('../shared/material-document.mjs').then(m=>{validateMaterialDocumentFields=m.validateMaterialDocumentFields;}),import('../shared/material-production.mjs').then(m=>{validateProductionDocs=m.validateProductionDocs;}),import('../shared/development-tools.mjs').then(m=>{validateDevelopmentTools=m.validateDevelopmentTools;})]);
const {storyExtras}=require('../shared/story-document.cjs');
// Portable project folders contain JSON archives and original art files, never executable imports.
const path = require('node:path');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const { workspaceHash } = require('./art-files.cjs');

const CATALOG_KEY = 'gamecreator.projects.v1';
const SECTIONS = ['gameplay', 'functional-systems', 'art-assets', 'definitions', 'stories', 'project', 'milestones', 'enum-versions'];
const OPTIONAL_SECTIONS = ['project-standards', 'development-tools', 'program-framework', 'numerical-analysis', 'project-schedule', 'data-view', 'gameplay-core', 'prototype-design', 'task-flows', 'story-orchestration', 'map-design'];
const FILE_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,12}$/;
const NEW_PROJECT = /^project-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_METADATA_BYTES = 20 * 1024 * 1024;
const MAX_ASSET_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const MAX_FILES = 10000;
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;
const unchanged = (a, b) => sameFile(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
const comparable = value => process.platform === 'win32' ? value.toLowerCase() : value;
const digest = value => createHash('sha256').update(value).digest('hex');
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const sectionPath = section => 'data/' + (section === 'project' ? 'project-info' : section) + '.json';
const archiveKey = (projectId, section) => section === 'enum-versions' ? 'gamecreator.enum-versions.v1:' + projectId : 'gamecreator.workspace.v1:' + projectId + ':' + section;

function safeProjectDirectoryName(name) {
  const clean = String(name || '').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').trim().replace(/[. ]+$/, '').slice(0, 100).replace(/[. ]+$/, '');
  return !clean || /^\.{1,2}$/.test(clean) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean) ? '项目-' + (clean || '未命名') : clean;
}

async function secureDirectory(directory, create = false) {
  const absolute = path.resolve(directory), root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat;
    try { stat = await fs.lstat(current); }
    catch (error) {
      if (error.code !== 'ENOENT' || !create) throw error;
      try { await fs.mkdir(current); } catch (mkdirError) { if (mkdirError.code !== 'EEXIST') throw mkdirError; }
      stat = await fs.lstat(current);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('项目文件夹不能包含符号链接或非目录路径');
  }
  if (comparable(await fs.realpath(absolute)) !== comparable(absolute)) throw new Error('项目文件夹路径超出选择范围');
  return {directory: absolute, stat: await fs.lstat(absolute)};
}

async function checkedFile(filename) {
  const parent = await secureDirectory(path.dirname(filename));
  const stat = await fs.lstat(filename);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('项目包只能包含普通文件，不能包含符号链接：' + path.basename(filename));
  if (comparable(await fs.realpath(filename)) !== comparable(path.resolve(filename))) throw new Error('项目包文件路径越界');
  return {stat, parent};
}

// Bound every read and verify both the open descriptor and its current path before accepting bytes.
async function readChecked(filename, limit, consume) {
  const before = await checkedFile(filename);
  if (before.stat.size > limit) throw new Error('文件超过大小限制：' + path.basename(filename));
  const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat();
    if (!unchanged(before.stat, opened) || !opened.isFile()) throw new Error('文件在读取前发生变化');
    const hash = createHash('sha256'), chunk = Buffer.alloc(64 * 1024);
    let total = 0;
    while (true) {
      const {bytesRead} = await handle.read(chunk, 0, chunk.length, total);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > limit) throw new Error('文件在读取时超过大小限制');
      const bytes = chunk.subarray(0, bytesRead);
      hash.update(bytes);
      if (consume) await consume(bytes, total - bytesRead);
    }
    const after = await checkedFile(filename), final = await handle.stat();
    if (total !== opened.size || !unchanged(opened, final) || !unchanged(opened, after.stat) || !sameFile(before.parent.stat, after.parent.stat)) throw new Error('文件在读取时发生变化，请重试');
    return {size: total, sha256: hash.digest('hex')};
  } finally { await handle.close(); }
}

async function readBytes(filename, limit) {
  const chunks = [];
  const info = await readChecked(filename, limit, bytes => chunks.push(Buffer.from(bytes)));
  return {bytes: Buffer.concat(chunks), ...info};
}

async function writeBytes(filename, bytes) {
  await secureDirectory(path.dirname(filename));
  const handle = await fs.open(filename, 'wx');
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  return {size: bytes.length, sha256: digest(bytes)};
}

async function copyChecked(source, destination, expected) {
  await secureDirectory(path.dirname(destination));
  const handle = await fs.open(destination, 'wx');
  try {
    const info = await readChecked(source, MAX_ASSET_BYTES, async (bytes, position) => {
      let offset = 0;
      while (offset < bytes.length) {
        const {bytesWritten} = await handle.write(bytes, offset, bytes.length - offset, position + offset);
        if (!bytesWritten) throw new Error('项目文件写入未完成');
        offset += bytesWritten;
      }
    });
    if (expected && (info.size !== expected.size || expected.sha256 && info.sha256 !== expected.sha256)) throw new Error('素材文件校验失败：' + path.basename(source));
    await handle.sync();
    return info;
  } finally { await handle.close(); }
}

function validateCoreArchive(value) {
  const invalid = () => { throw new Error('玩法核心存档格式无效'); };
  const strings = (object, keys) => keys.every(key => typeof object[key] === 'string');
  if (!record(value) || value.schema !== 1 || typeof value.rootId !== 'string' || !value.rootId.trim() || !Array.isArray(value.graphs) || !value.graphs.length) invalid();
  const graphs = new Map(), nodeIds = new Set(), edgeIds = new Set(), parents = new Map();
  for (const graph of value.graphs) {
    if (!record(graph) || !strings(graph, ['id', 'title', 'summary']) || !graph.id.trim() || graphs.has(graph.id) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) invalid();
    graphs.set(graph.id, graph);
    const local = new Set();
    for (const node of graph.nodes) {
      if (!record(node) || !strings(node, ['id', 'kind', 'title', 'description', 'childGraphId']) || !node.id.trim() || nodeIds.has(node.id) ||
        !['entry', 'activity', 'module', 'decision', 'exit'].includes(node.kind) || !Number.isFinite(node.x) || !Number.isFinite(node.y) ||
        !Array.isArray(node.gameplayIds) || node.gameplayIds.some(id => typeof id !== 'string' || !id.trim()) || new Set(node.gameplayIds).size !== node.gameplayIds.length ||
        node.kind !== 'module' && node.childGraphId) invalid();
      nodeIds.add(node.id); local.add(node.id);
      if (node.childGraphId) parents.set(node.childGraphId, (parents.get(node.childGraphId) || 0) + 1);
    }
    for (const edge of graph.edges) {
      if (!record(edge) || !strings(edge, ['id', 'fromId', 'toId', 'label', 'condition']) || !edge.id.trim() || edgeIds.has(edge.id) || !local.has(edge.fromId) || !local.has(edge.toId)) invalid();
      edgeIds.add(edge.id);
    }
  }
  if (!graphs.has(value.rootId) || parents.has(value.rootId)) invalid();
  for (const [id, count] of parents) if (!graphs.has(id) || count !== 1) invalid();
  for (const id of graphs.keys()) if (id !== value.rootId && parents.get(id) !== 1) invalid();
  const visited = new Set(), pending = [value.rootId];
  while (pending.length) {
    const id = pending.pop();
    if (visited.has(id)) invalid(); visited.add(id);
    for (const node of graphs.get(id).nodes) if (node.childGraphId) pending.push(node.childGraphId);
  }
  if (visited.size !== graphs.size) invalid();
}

function validatePrototypeArchive(value) {
  const fail = () => { throw new Error('原型设计存档格式无效'); };
  const strings = (v, keys) => keys.every(k => typeof v[k] === 'string');
  const number = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  const color = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  if (!record(value) || value.schema !== 1 || typeof value.entryId !== 'string' || !Array.isArray(value.scenes) || value.scenes.length > 100) fail();
  const ids = new Set(), unique = v => { if (typeof v.id !== 'string' || !v.id.trim() || ids.has(v.id)) fail(); ids.add(v.id); };
  for (const s of value.scenes) {
    if (!record(s) || (s.mapId !== undefined && typeof s.mapId !== 'string') || !strings(s, ['name', 'description', 'sourceDesignId', 'roomId', 'coreNodeId']) || !number(s.width, 320, 3840) || !number(s.height, 240, 2160) || !color(s.background) || !['grid', 'free'].includes(s.view) || !Array.isArray(s.elements) || s.elements.length > 300) fail();
    unique(s);
    for (const e of s.elements) {
      if (!record(e) || !strings(e, ['name', 'text', 'sourceObjectId', 'assetId', 'versionId', 'fileId']) || !['text', 'button', 'shape', 'image', 'hotspot'].includes(e.kind) || !number(e.x, -10000, 10000) || !number(e.y, -10000, 10000) || !number(e.width, 1, 10000) || !number(e.height, 1, 10000) || !number(e.fontSize, 8, 150) || !color(e.color) || typeof e.visible !== 'boolean' || !record(e.action) || !['none', 'scene', 'show', 'hide', 'toggle', 'restart'].includes(e.action.kind) || !strings(e.action, ['targetId', 'condition']) || (e.action.mapConnectionId !== undefined && typeof e.action.mapConnectionId !== 'string') || (e.action.mapReverse !== undefined && typeof e.action.mapReverse !== 'boolean')) fail();
      unique(e);
    }
  }
}

function validateTaskArchive(value) {
    const invalid = () => { throw new Error('任务与流程存档格式异常，已停止写入'); };
    const record = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    const fields = (v, keys) => keys.every(k => typeof v[k] === 'string');
    const ids = new Set();
    const id = (v) => { if (typeof v !== 'string' || !v.trim() || ids.has(v))
        return false; ids.add(v); return true; };
    const mode = (v) => v === 'all' || v === 'any';
    if (!record(value) || value.schema !== 1 || !Array.isArray(value.tasks))
        return invalid();
    for (const task of value.tasks) {
        if (!record(task) || !id(task.id) || !fields(task, ['title', 'summary', 'availability', 'startId']) || typeof task.archived !== 'boolean' ||
            !["主线","支线","委托","探索","关卡","挑战"].includes(task.kind) || !["单次","每局","每日","跨局"].includes(task.scope) || !['草稿', '已确认'].includes(task.status) ||
            !mode(task.prerequisiteMode) || !Array.isArray(task.prerequisiteIds) || !task.prerequisiteIds.every(v => typeof v === 'string' && !!v.trim()) || new Set(task.prerequisiteIds).size !== task.prerequisiteIds.length ||
            !Array.isArray(task.stages) || !Array.isArray(task.transitions) || !Array.isArray(task.references))
            return invalid();
        for (const stage of task.stages) {
            if (!record(stage) || !id(stage.id) || !fields(stage, ['title', 'description', 'result']) || !['objective', 'success', 'failure'].includes(stage.kind) || !mode(stage.mode) || !Array.isArray(stage.objectives))
                return invalid();
            for (const objective of stage.objectives)
                if (!record(objective) || !id(objective.id) || !fields(objective, ['title', 'condition']) || !Number.isSafeInteger(objective.target) || objective.target < 1)
                    return invalid();
        }
        for (const edge of task.transitions)
            if (!record(edge) || !id(edge.id) || !fields(edge, ['fromId', 'toId', 'label', 'condition']))
                return invalid();
        const refs = new Set();
        for (const ref of task.references) {
            if (!record(ref) || !["gameplay","capability","story","asset","table"].includes(ref.kind) || !fields(ref, ['targetId', 'recordId']) || !ref.targetId.trim() || ref.kind !== 'table' && ref.recordId !== '')
                return invalid();
            const key = JSON.stringify([ref.kind, ref.targetId, ref.recordId]);
            if (refs.has(key))
                return invalid();
            refs.add(key);
        }
    }
    return value;
}

function validateNumericalAnalysisArchive(value) {
    const fail = () => { throw new Error('数值分析存档格式异常，已停止写入'); };
    const rec = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
    const str = (x) => typeof x === 'string' && x.length <= 10000;
    const num = (x) => typeof x === 'number' && Number.isFinite(x);
    const safe = (x) => !['__proto__', 'constructor', 'prototype'].includes(x);
    const numericMap = (x) => rec(x) && Object.keys(x).length <= 300 && Object.entries(x).every(([k, v]) => safe(k) && num(v));
    const list = (x, max) => { if (!Array.isArray(x) || x.length > max)
        return fail(); return x; };
    const ids = (x, max) => { const a = list(x, max); const used = new Set(); for (const v of a) {
        if (!rec(v) || !str(v.id) || !v.id || !safe(v.id) || used.has(v.id))
            fail();
        used.add(v.id);
    } return a; };
    const range = (x) => (x.minimum === null || num(x.minimum)) && (x.maximum === null || num(x.maximum)) && (x.minimum === null || x.maximum === null || x.minimum <= x.maximum);
    const metric = (m) => str(m.name) && str(m.unit) && str(m.formula) && m.formula.length <= 1000 && range(m);
    if (!rec(value) || value.schema !== 1)
        return fail();
    for (const p of ids(value.plans, 100)) {
        if (!str(p.name) || !str(p.notes) || !str(p.gameplayId))
            fail();
        const symbols = new Set();
        for (const item of [...ids(p.parameters, 100), ...ids(p.metrics, 50)]) {
            if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(item.id) || symbols.has(item.id))
                fail();
            symbols.add(item.id);
        }
        for (const param of p.parameters) {
            if (!str(param.name) || !str(param.unit) || !num(param.value) || !['number', 'integer', 'percent'].includes(param.type) || !range(param) || !rec(param.binding))
                fail();
            const b = param.binding;
            if (b.kind === 'cell') {
                if (!str(b.table) || !str(b.rowId) || !str(b.field) || !safe(b.table) || !safe(b.field))
                    fail();
            }
            else if (b.kind === 'variable') {
                if (!str(b.storyId) || !str(b.variableId) || !safe(b.variableId))
                    fail();
            }
            else if (b.kind !== 'constant')
                fail();
        }
        if (!p.metrics.every(metric))
            fail();
        for (const v of ids(p.variants, 20))
            if (!str(v.name) || !numericMap(v.overrides))
                fail();
        if (p.batch !== null && (!rec(p.batch) || !str(p.batch.table) || !safe(p.batch.table) || !list(p.batch.rowIds, 100).every(str) || new Set(p.batch.rowIds).size !== p.batch.rowIds.length))
            fail();
        if (p.sweep !== null && (!rec(p.sweep) || !str(p.sweep.parameterId) || !num(p.sweep.start) || !num(p.sweep.end) || !num(p.sweep.step)))
            fail();
        if (p.check !== null && (!rec(p.check) || !str(p.check.storyId) || !str(p.check.checkId)))
            fail();
        for (const s of ids(p.snapshots, 10)) {
            if (!str(s.name) || !str(s.createdAt) || !Number.isFinite(Date.parse(s.createdAt)) || typeof s.signature !== 'string' || s.signature.length > 2000000 || !str(s.variantId) || !ids(s.metrics, 50).every(metric))
                fail();
            for (const r of list(s.rows, 1000))
                if (!rec(r) || !str(r.key) || !str(r.label) || !num(r.x) || !numericMap(r.inputs) || !numericMap(r.values) || !rec(r.origins) || !Object.entries(r.origins).every(([k, v]) => safe(k) && str(v)) || !list(r.errors, 200).every(str) || !list(r.outside, 50).every(str))
                    fail();
        }
    }
    return value;
}
function validateMapArchive(value) {
    const fail = () => { throw new Error('地图设计存档格式无效'); };
    const record = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    const strings = (v, keys) => keys.every(k => typeof v[k] === 'string' && v[k].length <= 100000);
    const num = (v, min = -1e6, max = 1e6) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
    const ids = new Set();
    const unique = (v) => { if (typeof v.id !== 'string' || !v.id.trim() || ids.has(v.id))
        fail(); ids.add(v.id); };
    if (!record(value) || value.schema !== 1 || typeof value.enabled !== 'boolean' || !Array.isArray(value.maps) || value.maps.length > 100 || !Array.isArray(value.connections) || value.connections.length > 500)
        return fail();
    if (value.world !== undefined && (!record(value.world) || !['top', 'side'].includes(value.world.perspective) || !strings(value.world, ['unit']) || !num(value.world.snap, .001, 10000)))
        return fail();
    if (record(value.world) && value.world.actor !== undefined) {
        const a = value.world.actor;
        if (!record(a) || !num(a.width, .05, 100) || !num(a.height, .05, 100) || !num(a.stepHeight, 0, 100) || !num(a.jumpRise, 0, 1000) || !num(a.jumpGap, 0, 1000) || !num(a.maxDrop, 0, 10000))
            return fail();
    }
    for (const m of value.maps) {
        if (!record(m) || !strings(m, ['name', 'region', 'description', 'unit', 'sourceDesignId', 'roomId']) || !['side', 'top'].includes(m.perspective) || !['grid', 'free'].includes(m.view) || !num(m.x) || !num(m.y) || !num(m.rows, 1, 30) || !Number.isInteger(m.rows) || !num(m.columns, 1, 40) || !Number.isInteger(m.columns) || !num(m.cellSize, .001, 10000) || typeof m.sourceVisible !== 'boolean' || typeof m.sourceLocked !== 'boolean' || !Array.isArray(m.layers) || m.layers.length < 1 || m.layers.length > 30 || !Array.isArray(m.objects) || m.objects.length > 300)
            return fail();
        if (m.placement !== undefined && (!record(m.placement) || !num(m.placement.x) || !num(m.placement.y) || !num(m.placement.scale, .001, 1000)))
            return fail();
        unique(m);
        if (m.openings !== undefined) {
            if (!Array.isArray(m.openings) || m.openings.length > 100)
                return fail();
            for (const o of m.openings) {
                if (!record(o) || !strings(o, ['name']) || !['left', 'right', 'top', 'bottom'].includes(o.side) || !num(o.offset, 0) || !num(o.width, .05))
                    return fail();
                unique(o);
            }
        }
        if (m.surfaces !== undefined) {
            if (!Array.isArray(m.surfaces) || m.surfaces.length > 600)
                return fail();
            const seen = new Set();
            for (const v of m.surfaces) {
                if (!record(v) || !strings(v, ['objectId']) || seen.has(v.objectId) || !['solid', 'one-way', 'ladder', 'decoration'].includes(v.kind))
                    return fail();
                seen.add(v.objectId);
            }
        }
        for (const l of m.layers) {
            if (!record(l) || !strings(l, ['name']) || typeof l.visible !== 'boolean' || typeof l.locked !== 'boolean')
                return fail();
            unique(l);
        }
        for (const o of m.objects) {
            if (!record(o) || !strings(o, ['name', 'layerId', 'notes']) || !['terrain', 'obstacle', 'decoration', 'npc', 'building', 'resource', 'enemy', 'task', 'portal', 'note'].includes(o.kind) || !['green', 'violet', 'blue', 'amber', 'red'].includes(o.color) || !num(o.x) || !num(o.y) || !num(o.width, .001) || !num(o.height, .001) || !Array.isArray(o.references) || o.references.length > 100)
                return fail();
            unique(o);
            for (const r of o.references)
                if (!record(r) || !strings(r, ['targetId']) || !['gameplay', 'task', 'story', 'character', 'asset', 'prototype'].includes(r.kind))
                    return fail();
        }
    }
    for (const c of value.connections) {
        if (!record(c) || !strings(c, ['name', 'from', 'to', 'fromObjectId', 'toObjectId', 'condition']) || !['one', 'both'].includes(c.direction) || !['passage', 'shortcut', 'door', 'transport'].includes(c.kind))
            return fail();
        if (c.fromSide !== undefined && !['auto', 'left', 'right', 'top', 'bottom', 'center'].includes(c.fromSide))
            return fail();
        if (c.toSide !== undefined && !['auto', 'left', 'right', 'top', 'bottom', 'center'].includes(c.toSide))
            return fail();
        if (c.travel !== undefined && (!record(c.travel) || !['auto', 'walk', 'jump', 'climb', 'drop', 'transport'].includes(c.travel.forward) || !['auto', 'walk', 'jump', 'climb', 'drop', 'transport'].includes(c.travel.reverse) || !num(c.travel.maxRise, 0) || !num(c.travel.maxGap, 0) || !num(c.travel.maxDrop, 0)))
            return fail();
        unique(c);
    }
    for (const c of value.connections) {
        for (const k of ['fromOpeningId', 'toOpeningId', 'reverseFromObjectId', 'reverseToObjectId', 'reverseCondition'])
            if (c[k] !== undefined && !strings(c, [k]))
                return fail();
        if (c.structure !== undefined && !['open', 'ladder', 'bridge'].includes(c.structure))
            return fail();
        if (c.reverseLimits !== undefined && (!record(c.reverseLimits) || !num(c.reverseLimits.maxRise, 0) || !num(c.reverseLimits.maxGap, 0) || !num(c.reverseLimits.maxDrop, 0)))
            return fail();
        if (c.aliases !== undefined) {
            if (!Array.isArray(c.aliases) || c.aliases.length > 500)
                return fail();
            for (const a of c.aliases) {
                if (!record(a) || typeof a.reverse !== 'boolean')
                    return fail();
                unique(a);
            }
        }
    }
    return value;
}
function validateStoryArchive(value) {
    const fail = () => { throw new Error('故事编排存档格式异常，已停止写入'); };
    const obj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    const fields = (v, names) => names.every(n => typeof v[n] === 'string');
    const safe = (v) => typeof v === 'string' && !!v.trim() && !['__proto__', 'constructor', 'prototype'].includes(v);
    const finite = (v) => typeof v === 'number' && Number.isFinite(v);
    const list = (v) => Array.isArray(v) && v.every(safe) && new Set(v).size === v.length;
    const predicate = (v) => obj(v) && Array.isArray(v.groups) && v.groups.every(g => Array.isArray(g) && g.every(c => obj(c) && fields(c, ['variableId']) && ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(c.op) && finite(c.value)));
    const effects = (v) => Array.isArray(v) && v.every(e => obj(e) && fields(e, ['variableId']) && ['set', 'add'].includes(e.op) && finite(e.value));
    if (!obj(value) || value.schema !== 1 || typeof value.enabled !== 'boolean' || !Array.isArray(value.stories))
        return fail();
    const entries = (xs, check) => Array.isArray(xs) && xs.every(x => obj(x) && safe(x.id) && check(x)) && new Set(xs.map(x => x.id)).size === xs.length;
    if (value.characters !== undefined && !entries(value.characters, c => fields(c, ['name', 'description', 'role', 'faction', 'background', 'motivation', 'personality', 'speech', 'color']) && /^#[0-9a-f]{6}$/i.test(c.color) && obj(c.position) && finite(c.position.x) && finite(c.position.y) && c.position.x >= 0 && c.position.y >= 0 && (c.portrait === null || obj(c.portrait) && fields(c.portrait, ['assetId', 'versionId', 'fileId']))))
        return fail();
    if (value.relationships !== undefined && !entries(value.relationships, r => fields(r, ['fromId', 'toId', 'label', 'description', 'secret']) && typeof r.directed === 'boolean'))
        return fail();
    const storyIds = new Set();
    for (const s of value.stories) {
        if (!obj(s) || !safe(s.id) || storyIds.has(s.id) || !fields(s, ['title', 'summary', 'entryId', 'source', 'clockId']) || typeof s.archived !== 'boolean' || !list(s.taskIds) || !finite(s.timeLimit) || s.timeLimit < 0 || !['scenes', 'actors', 'variables', 'nodes', 'choices', 'checks', 'interrupts'].every(k => Array.isArray(s[k])))
            return fail();
        storyIds.add(s.id);
        for (const section of ['scenes', 'actors', 'variables', 'nodes', 'choices', 'checks', 'interrupts']) {
            const ids = new Set();
            for (const item of s[section]) {
                if (!obj(item) || !safe(item.id) || ids.has(item.id))
                    return fail();
                ids.add(item.id);
                if (section === 'scenes' && !fields(item, ['title', 'chapter', 'description']))
                    return fail();
                if (section === 'actors' && !fields(item, ['name', 'description']))
                    return fail();
                if (section === 'actors' && (item.kind !== undefined && !['character', 'voice'].includes(item.kind) || ['characterId', 'voiceType'].some(k => item[k] !== undefined && typeof item[k] !== 'string')))
                    return fail();
                if (section === 'variables' && (item.kind !== undefined && !['flag', 'number'].includes(item.kind) || ['trueLabel', 'falseLabel', 'characterId'].some(k => item[k] !== undefined && typeof item[k] !== 'string') || item.kind === 'flag' && (item.minimum !== 0 || item.maximum !== 1 || ![0, 1].includes(item.initial))))
                    return fail();
                if (section === 'variables' && (!fields(item, ['name', 'category']) || !finite(item.initial) || !(item.minimum === null || finite(item.minimum)) || !(item.maximum === null || finite(item.maximum)) || item.minimum !== null && item.initial < item.minimum || item.maximum !== null && item.initial > item.maximum))
                    return fail();
                if (section === 'nodes' && (!fields(item, ['sceneId', 'title', 'speakerId', 'text', 'outcome']) || !['dialogue', 'narration', 'inner', 'hub', 'ending', 'return'].includes(item.kind) || !['unchanged', 'completed', 'suspended', 'failed'].includes(item.taskStatus) || !list(item.taskIds)))
                    return fail();
                if (section === 'choices' && (!fields(item, ['fromId', 'toId', 'label', 'checkId']) || !predicate(item.condition) || !effects(item.effects) || typeof item.once !== 'boolean' || typeof item.passive !== 'boolean' || !finite(item.cost) || item.cost < 0))
                    return fail();
                if (section === 'checks' && (!fields(item, ['name', 'variableId', 'successId', 'failureId', 'notes']) || !finite(item.difficulty) || !['always', 'once', 'on-change'].includes(item.retry) || !list(item.retryVariableIds) || !effects(item.successEffects) || !effects(item.failureEffects) || !Array.isArray(item.modifiers) || !item.modifiers.every(m => obj(m) && predicate(m.condition) && finite(m.value))))
                    return fail();
                if (section === 'checks' && (item.mode !== undefined && !['dice', 'threshold'].includes(item.mode) || item.criticals !== undefined && typeof item.criticals !== 'boolean' || item.diceCount !== undefined && (!Number.isInteger(item.diceCount) || item.diceCount < 1 || item.diceCount > 10) || item.diceSides !== undefined && (!Number.isInteger(item.diceSides) || item.diceSides < 2 || item.diceSides > 100)))
                    return fail();
                if (section === 'interrupts' && (!fields(item, ['name', 'nodeId']) || !predicate(item.condition)))
                    return fail();
            }
        }
    }
    return value;
}

const gameplayCategoryIcons = { folder: '文件夹', character: '角色', map: '地图', combat: '战斗', exploration: '探索', growth: '成长', rules: '规则', book: '文档' };
function validateGameplayLibraryArchive(value) {
    const record = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    const fail = () => { throw new Error('玩法分类存档格式异常，已停止写入'); };
    if (!record(value) || !Array.isArray(value.designs))
        return fail();
    if (value.categories !== undefined) {
        if (!Array.isArray(value.categories))
            return fail();
        const ids = new Set(), names = new Set();
        for (const c of value.categories) {
            if (!record(c) || typeof c.id !== 'string' || !c.id.trim() || ids.has(c.id) || typeof c.name !== 'string' || !c.name.trim() || names.has(c.name.trim().toLocaleLowerCase()) || typeof c.description !== 'string' || typeof c.icon !== 'string' || !Object.prototype.hasOwnProperty.call(gameplayCategoryIcons, c.icon))
                return fail();
            ids.add(c.id);
            names.add(c.name.trim().toLocaleLowerCase());
        }
    }
    for (const d of value.designs)
        if (!record(d) || (d.categoryId !== undefined && typeof d.categoryId !== 'string') || (d.tags !== undefined && (!Array.isArray(d.tags) || d.tags.some(t => typeof t !== 'string' || !t.trim()) || new Set(d.tags).size !== d.tags.length)))
            return fail();
}

function validateProjectScheduleArchive(value) {
    const fail = () => { throw new Error('项目排期存档格式异常，已停止写入'); };
    const record = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    const fields = (v, keys) => keys.every(k => typeof v[k] === 'string');
    const date = (v) => { if (v === '')
        return true; if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v))
        return false; const n = Date.parse(v + 'T00:00:00Z'); return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === v; };
    const bounded = (v, max = 200) => typeof v === 'string' && v.length <= max;
    const ids = (v, max = 2000) => Array.isArray(v) && v.length <= max && v.every(x => bounded(x) && x.trim()) && new Set(v).size === v.length;
    const permissions = (v) => ids(v, 5) && v.every(x => ['progress', 'review', 'propose', 'spec_change', 'project_write'].includes(x));
    const stamp = (v) => bounded(v, 50) && Number.isFinite(Date.parse(v));
    if (record(value) && value.personnel !== undefined) {
        const p = value.personnel;
        if (!record(p) || p.schema !== 1 || !Array.isArray(p.members) || p.members.length > 200 || !Array.isArray(p.credentials) || p.credentials.length > 1000)
            return fail();
        if (p.positions !== undefined) {
            if (!Array.isArray(p.positions) || p.positions.length > 100)
                return fail();
            const positionIds = new Set(), positionNames = new Set();
            for (const r of p.positions) {
                if (!record(r) || !bounded(r.id) || !r.id.trim() || positionIds.has(r.id) || !bounded(r.name, 100) || !r.name.trim() || positionNames.has(r.name.trim().toLowerCase()) || !bounded(r.duties, 10000) || typeof r.active !== 'boolean' || !ids(r.taskKinds, 6) || r.taskKinds.some(k => !['设计', '程序', '美术', '关卡', '测试', '其他'].includes(k)))
                    return fail();
                positionIds.add(r.id);
                positionNames.add(r.name.trim().toLowerCase());
            }
        }
        const seen = new Set(), names = new Set();
        for (const m of p.members) {
            if (!record(m) || !bounded(m.id) || !m.id.trim() || seen.has(m.id) || !bounded(m.name, 100) || !m.name.trim() || names.has(m.name.trim().toLowerCase()) || !ids(m.roles, 100) || !m.roles.length || !bounded(m.duties, 10000) || typeof m.active !== 'boolean' || !['project', 'assigned'].includes(m.scope) || !permissions(m.permissions) || !stamp(m.createdAt))
                return fail();
            if (m.developer !== undefined) {
                const d = m.developer;
                if (!record(d) || !ids(d.positionIds, 100) || !d.positionIds.length || !ids(d.taskIds) || !['assigned', 'positions', 'project'].includes(d.scope) || !(d.expiresAt === '' || stamp(d.expiresAt)))
                    return fail();
            }
            seen.add(m.id);
            names.add(m.name.trim().toLowerCase());
        }
        const keys = new Set();
        for (const c of p.credentials) {
            if (!record(c) || !bounded(c.id) || !c.id.trim() || keys.has(c.id) || !bounded(c.projectId, 1200) || !c.projectId || !bounded(c.memberId) || !seen.has(c.memberId) || !bounded(c.name, 100) || !c.name.trim() || !bounded(c.publicKey, 200) || !c.publicKey.trim() || !permissions(c.permissions) || !ids(c.taskIds) || !stamp(c.createdAt) || !(c.persistent === true ? (c.expiresAt === '' || stamp(c.expiresAt)) : (stamp(c.expiresAt) && Date.parse(c.expiresAt) > Date.parse(c.createdAt))) || !(c.revokedAt === '' || stamp(c.revokedAt)) || Object.prototype.hasOwnProperty.call(c, 'privateKey'))
                return fail();
            if (c.persistent !== undefined && c.persistent !== true)
                return fail();
            if (c.persistent === true && !p.members.some(m => record(m) && m.id === c.memberId && record(m.developer)))
                return fail();
            if (c.positionIds !== undefined && (!ids(c.positionIds, 100) || !c.positionIds.length || c.persistent !== true && !c.taskIds.length || !bounded(c.workDescription, 10000)))
                return fail();
            keys.add(c.id);
        }
    }
    const unique = new Set();
    const id = (v) => { if (typeof v !== 'string' || !v.trim() || unique.has(v))
        return false; unique.add(v); return true; };
    if (!record(value) || value.schema !== 1 || !Array.isArray(value.tasks) || !Array.isArray(value.milestones))
        return fail();
    for (const m of value.milestones)
        if (!record(m) || !id(m.id) || !fields(m, ['title', 'owner', 'due', 'description', 'acceptance', 'review']) || !date(m.due) || !['计划中', '进行中', '已验收'].includes(m.status))
            return fail();
    for (const t of value.tasks) {
        if (!record(t) || !id(t.id) || !fields(t, ['title', 'description', 'owner', 'start', 'end', 'actualStart', 'actualEnd', 'milestoneId', 'acceptance', 'result']) ||
            !['设计', '程序', '美术', '关卡', '测试', '其他'].includes(t.kind) || !['待开始', '进行中', '待验收', '已完成', '受阻'].includes(t.status) || !['低', '普通', '高', '紧急'].includes(t.priority) ||
            !['start', 'end', 'actualStart', 'actualEnd'].every(k => date(t[k])) || (t.start && t.end && t.end < t.start) || (t.actualStart && t.actualEnd && t.actualEnd < t.actualStart) ||
            !Array.isArray(t.dependencyIds) || t.dependencyIds.some(v => typeof v !== 'string' || !v.trim()) || new Set(t.dependencyIds).size !== t.dependencyIds.length || !Array.isArray(t.references))
            return fail();
        if (t.positionIds !== undefined && !ids(t.positionIds, 100))
            return fail();
        if (t.assignment !== undefined) {
            const a = t.assignment;
            if (!record(a) || !bounded(a.primaryId) || !bounded(a.reviewerId) || !ids(a.collaboratorIds, 200) || a.collaboratorIds.includes(a.primaryId))
                return fail();
        }
        if (t.proposals !== undefined && (!Array.isArray(t.proposals) || t.proposals.length > 1000 || t.proposals.some(p => !record(p) || !bounded(p.id) || !bounded(p.memberId) || !bounded(p.text, 30000) || !stamp(p.at)) || new Set(t.proposals.map(p => p.id)).size !== t.proposals.length))
            return fail();
        const refs = new Set();
        for (const r of t.references) {
            if (!record(r) || !['gameplay', 'capability', 'requirement', 'asset', 'map', 'prototype', 'tool'].includes(r.kind) || typeof r.targetId !== 'string' || !r.targetId.trim())
                return fail();
            const key = JSON.stringify([r.kind, r.targetId]);
            if (refs.has(key))
                return fail();
            refs.add(key);
        }
    }
    return value;
}
function validateDocument(value) {
  if (!record(value) || value.schema !== 1 || !record(value.project) || typeof value.project.name !== 'string' || !value.project.name.trim() || value.project.name.length > 100 || !record(value.project.config) || !record(value.archives) || SECTIONS.some(section => !Object.hasOwn(value.archives, section)) || Object.keys(value.archives).some(section => ![...SECTIONS, ...OPTIONAL_SECTIONS].includes(section))) throw new Error('项目文件夹数据格式无效');
  if (value.project.defaultTablesVersion !== undefined && value.project.defaultTablesVersion !== 1) throw new Error('不支持的配置表默认值版本');
  if (Object.hasOwn(value.archives, 'project-standards')) validateProjectStandards(value.archives['project-standards']);
  if (Object.hasOwn(value.archives, 'gameplay-core')) validateCoreArchive(value.archives['gameplay-core']);
  if (Object.hasOwn(value.archives, 'prototype-design')) validatePrototypeArchive(value.archives['prototype-design']);
  if (Object.hasOwn(value.archives, 'development-tools')) validateDevelopmentTools(value.archives['development-tools']);
  if (Object.hasOwn(value.archives, 'project-schedule')) validateProjectScheduleArchive(value.archives['project-schedule']);
  if (Object.hasOwn(value.archives, 'task-flows')) validateTaskArchive(value.archives['task-flows']);
  if (Object.hasOwn(value.archives, 'numerical-analysis')) validateNumericalAnalysisArchive(value.archives['numerical-analysis']);
  if (Object.hasOwn(value.archives, 'map-design')) validateMapArchive(value.archives['map-design']);
  if (Object.hasOwn(value.archives, 'story-orchestration')) validateStoryArchive(value.archives['story-orchestration']);
  if(!Array.isArray(value.archives.stories))throw new Error('故事文档格式无效');
  for(const story of value.archives.stories)storyExtras(story);
  validateGameplayLibraryArchive(value.archives.gameplay);
  const art = value.archives['art-assets'];
  if (!record(art) || !Array.isArray(art.assets)) throw new Error('素材资产存档格式无效');
  if (!Array.isArray(art.requirements) || art.requirements.some(r => !record(r) || Object.hasOwn(r, 'generationPrompt') && (!record(r.generationPrompt) || typeof r.generationPrompt.prompt !== 'string' || typeof r.generationPrompt.negative !== 'string'))) throw new Error('素材生成提示词格式无效');
  // Shared schema validation also protects folder imports.
  validateProductionDocs(art.productionDocs);
  for(const item of [...art.requirements,...art.assets])validateMaterialDocumentFields(item);
  return value;
}

function referencedFiles(document) {
  const files = new Map();
  const art=document.archives['art-assets'];
  for (const asset of [...art.assets,{versions:(art.productionDocs||[]).map(d=>({files:d.images}))}]) {
    if (!record(asset) || !Array.isArray(asset.versions)) throw new Error('素材资产版本格式无效');
    for (const version of asset.versions) {
      if (!record(version) || !Array.isArray(version.files)) throw new Error('素材文件版本格式无效');
      for (const file of version.files) {
        if (!record(file) || typeof file.storagePath !== 'string' || !FILE_TOKEN.test(file.storagePath) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_ASSET_BYTES) throw new Error('素材文件存储标识或大小无效');
        const previous = files.get(file.storagePath);
        if (previous && previous.size !== file.size) throw new Error('同一素材文件存在冲突的大小记录');
        files.set(file.storagePath, file);
      }
    }
  }
  if (files.size > MAX_FILES - 12) throw new Error('项目包包含的文件过多');
  return files;
}

function jsonBytes(value) {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) throw new Error('项目数据无法保存为 JSON');
  const bytes = Buffer.from(serialized + '\n', 'utf8');
  if (bytes.length > MAX_METADATA_BYTES) throw new Error('项目元数据超过 20 MB 限制');
  return bytes;
}

async function absent(filename) {
  try { await fs.lstat(filename); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error('目标文件夹已存在，未覆盖任何内容：' + path.basename(filename));
}

// Cleanup never follows links and only removes the unique directory created by this operation.
async function cleanupOwned(directory, identity) {
  try {
    const own = await secureDirectory(directory);
    if (!sameFile(own.stat, identity)) return;
    async function remove(current) {
      const original = await secureDirectory(current);
      for (const entry of await fs.readdir(current, {withFileTypes: true})) {
        if (!sameFile(original.stat, (await secureDirectory(current)).stat)) throw new Error('临时目录发生变化，已保留以便检查');
        const filename = path.join(current, entry.name), stat = await fs.lstat(filename);
        if (stat.isSymbolicLink()) throw new Error('临时目录发生变化，已保留以便检查');
        if (stat.isDirectory()) { await secureDirectory(filename); await remove(filename); }
        else if (stat.isFile()) { const checked = await checkedFile(filename); if (!sameFile(stat, checked.stat)) throw new Error('临时文件发生变化'); await fs.unlink(filename); }
        else throw new Error('临时目录包含未知文件类型');
      }
      if (!sameFile(original.stat, (await secureDirectory(current)).stat)) throw new Error('临时目录发生变化');
      await fs.rmdir(current);
    }
    await remove(directory);
  } catch (error) { if (error.code !== 'ENOENT') return; }
}

function createProjectPackages({dataDirectory, storage, resolveAssetDirectory}) {
  if (typeof dataDirectory !== 'string' || !storage || typeof storage.getItem !== 'function') throw new Error('项目文件夹服务配置无效');
  const base = path.resolve(dataDirectory), imports = new Map(), activeExports = new Set();
  const sourceProject = projectId => {
    const raw = storage.getItem(CATALOG_KEY);
    const catalog = raw === null ? null : JSON.parse(raw);
    if (!record(catalog) || !Array.isArray(catalog.projects) || !catalog.projects.some(project => project.id === projectId)) throw new Error('项目不存在或已被移除');
    return catalog;
  };
  function checkSnapshot(projectId, document, expectedEntries) {
    sourceProject(projectId);
    const required = new Set([CATALOG_KEY, ...SECTIONS.map(section => archiveKey(projectId, section)), ...OPTIONAL_SECTIONS.filter(section => section !== 'prototype-design' || Object.hasOwn(document.archives, section)).map(section => archiveKey(projectId, section))]);
    if (document.project.defaultTablesVersion === 1) required.add(archiveKey(projectId, 'default-table-migration'));
    if (!Array.isArray(expectedEntries) || expectedEntries.length !== required.size) throw new Error('项目导出快照不完整');
    for (const entry of expectedEntries) {
      if (!record(entry) || !required.delete(entry.key) || entry.value !== null && typeof entry.value !== 'string') throw new Error('项目导出快照包含未知或重复存档');
      if (storage.getItem(entry.key) !== entry.value) throw new Error('项目在导出期间发生变化，请等待保存完成后重试');
    }
  }
  async function exportFolder({directory, projectId, document: input, expectedEntries}) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('请选择绝对路径项目文件夹');
    // Detach caller data before the first asynchronous operation.
    await productionReady;
    const document = validateDocument(JSON.parse(JSON.stringify(input))), snapshot = JSON.parse(JSON.stringify(expectedEntries));
    if(Object.hasOwn(document.archives,'program-framework'))(await import('../shared/program-framework.mjs')).validateProgramFramework(document.archives['program-framework']);
    const engineValidation=await import('../shared/engine-config.mjs');engineValidation.validateEngineConfig(document.project.config);
    for(const snapshot of document.archives['enum-versions']?.snapshots||[])engineValidation.validateEngineScanMetadata(snapshot.scan);
    (await import('../shared/data-sync.mjs')).validateDataSync(document.archives['enum-versions']);
    checkSnapshot(projectId, document, snapshot);
    const assets = referencedFiles(document), destination = path.resolve(directory), parent = path.dirname(destination);
    if (destination === path.parse(destination).root || activeExports.has(comparable(destination))) throw new Error('目标文件夹已存在或正在导出');
    activeExports.add(comparable(destination));
    let temporary, identity;
    try {
      await secureDirectory(parent);
      await absent(destination);
      temporary = path.join(parent, '.gamecreator-export-' + randomUUID());
      await fs.mkdir(temporary); identity = (await secureDirectory(temporary)).stat;
      await fs.mkdir(path.join(temporary, 'data')); await fs.mkdir(path.join(temporary, 'assets'));
      const files = []; let total = 0;
      const add = (relative, info) => { total += info.size; if (total > MAX_TOTAL_BYTES) throw new Error('项目文件夹超过 1 GB 限制'); files.push({path: relative, ...info}); };
      add('data/project.json', await writeBytes(path.join(temporary, 'data', 'project.json'), jsonBytes(document.project)));
      for (const [section, content] of Object.entries(document.archives)) {
        const relative = sectionPath(section); add(relative, await writeBytes(path.join(temporary, ...relative.split('/')), jsonBytes(content)));
      }
      for (const [token, file] of assets) {
        const relative = 'assets/' + token;
        const source = path.join(resolveAssetDirectory?.('project:' + projectId) || path.join(base, 'art-files', workspaceHash('project:' + projectId)), token);
        try { add(relative, await copyChecked(source, path.join(temporary, 'assets', token), file)); }
        catch (error) { if (error.code === 'ENOENT') throw new Error('项目素材文件已丢失，导出已停止：' + (file.name || token)); throw error; }
      }
      const readme = Buffer.from('# ' + document.project.name.replace(/[\r\n]/g, ' ') + '\n\n这是 GameCreator 便携项目文件夹。复制整个文件夹后，在客户端选择“从文件夹导入”。\n\n- manifest.json：格式版本与文件校验清单。\n- data/：项目完整数据与历史。\n- assets/：全部素材版本的原始文件。\n\n引擎工程目录需要在目标设备重新配置；导入会创建独立项目，不覆盖原项目。\n请保持目录结构和文件完整，不要单独移动其中的文件。\n', 'utf8');
      add('README.md', await writeBytes(path.join(temporary, 'README.md'), readme));
      const manifest = {format: 'gamecreator-project', schema: 1, projectName: document.project.name, createdAt: new Date().toISOString(), files: files.sort((a, b) => a.path.localeCompare(b.path))};
      await writeBytes(path.join(temporary, 'manifest.json'), jsonBytes(manifest));
      // Recheck source files as well as archive revisions immediately before publishing.
      for (const [token, file] of assets) {
        const current = await readChecked(path.join(resolveAssetDirectory?.('project:' + projectId) || path.join(base, 'art-files', workspaceHash('project:' + projectId)), token), MAX_ASSET_BYTES);
        const saved = files.find(entry => entry.path === 'assets/' + token);
        if (current.size !== file.size || current.sha256 !== saved.sha256) throw new Error('素材文件在导出期间发生变化，请重试');
      }
      checkSnapshot(projectId, document, snapshot);
      await secureDirectory(parent); await secureDirectory(temporary); await absent(destination);
      await fs.rename(temporary, destination); temporary = destination;
      checkSnapshot(projectId, document, snapshot); temporary = undefined;
      return {directory: destination, fileCount: assets.size, totalFileCount: files.length + 1};
    } finally {
      if (temporary && identity) await cleanupOwned(temporary, identity);
      activeExports.delete(comparable(destination));
    }
  }

  async function readFolder(directory) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('请选择有效的项目文件夹');
    const initial = await secureDirectory(directory), root = initial.directory;
    const manifestRead = await readBytes(path.join(root, 'manifest.json'), 2 * 1024 * 1024);
    let manifest;
    try { manifest = JSON.parse(manifestRead.bytes.toString('utf8')); } catch { throw new Error('manifest.json 不是有效 JSON'); }
    if (!record(manifest) || manifest.format !== 'gamecreator-project' || manifest.schema !== 1 || typeof manifest.projectName !== 'string' || !Array.isArray(manifest.files) || manifest.files.length > MAX_FILES) throw new Error('不支持的项目文件夹格式或版本');
    const dataPaths = new Set(['data/project.json', ...SECTIONS.map(sectionPath), ...OPTIONAL_SECTIONS.map(sectionPath)]), entries = new Map();
    let total = 0;
    for (const entry of manifest.files) {
      if (!record(entry) || typeof entry.path !== 'string' || !(dataPaths.has(entry.path) || entry.path === 'README.md' || entry.path.startsWith('assets/') && FILE_TOKEN.test(entry.path.slice(7))) || entries.has(entry.path) || !Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('项目文件清单包含无效、重复或越界路径');
      const limit = entry.path.startsWith('assets/') ? MAX_ASSET_BYTES : MAX_METADATA_BYTES;
      if (entry.size > limit || (total += entry.size) > MAX_TOTAL_BYTES) throw new Error('项目文件夹超过大小限制');
      entries.set(entry.path, entry);
    }
    for (const required of ['data/project.json', ...SECTIONS.map(sectionPath), 'README.md']) if (!entries.has(required)) throw new Error('项目文件清单缺少：' + required);
    // Unknown files are rejected so copied folders cannot accidentally carry unrelated local files.
    const allowed = new Set(['manifest.json', ...entries.keys()]);
    async function inspect(current, prefix = '') {
      for (const name of await fs.readdir(current)) {
        const relative = prefix + name, filename = path.join(current, name), stat = await fs.lstat(filename);
        if (stat.isSymbolicLink()) throw new Error('项目文件夹不能包含符号链接');
        if (stat.isDirectory() && (relative === 'data' || relative === 'assets')) { await secureDirectory(filename); await inspect(filename, relative + '/'); }
        else if (!stat.isFile() || !allowed.has(relative)) throw new Error('项目文件夹包含未列入清单的内容：' + relative);
      }
    }
    await inspect(root);
    const data = new Map();
    for (const [relative, expected] of entries) {
      const filename = path.join(root, ...relative.split('/'));
      const actual = relative.startsWith('data/') ? await readBytes(filename, MAX_METADATA_BYTES) : await readChecked(filename, relative.startsWith('assets/') ? MAX_ASSET_BYTES : MAX_METADATA_BYTES);
      if (actual.size !== expected.size || actual.sha256 !== expected.sha256) throw new Error('项目文件校验失败，文件可能已损坏或被修改：' + relative);
      if (actual.bytes) {
        try { data.set(relative, JSON.parse(actual.bytes.toString('utf8'))); } catch { throw new Error('项目数据不是有效 JSON：' + relative); }
      }
    }
    const archives = {};
    for (const section of [...SECTIONS, ...OPTIONAL_SECTIONS]) if (data.has(sectionPath(section))) archives[section] = data.get(sectionPath(section));
    await productionReady;
    const document = validateDocument({schema: 1, project: data.get('data/project.json'), archives});
    if(Object.hasOwn(document.archives,'program-framework'))(await import('../shared/program-framework.mjs')).validateProgramFramework(document.archives['program-framework']);
    const engineValidation=await import('../shared/engine-config.mjs');engineValidation.validateEngineConfig(document.project.config);
    for(const snapshot of document.archives['enum-versions']?.snapshots||[])engineValidation.validateEngineScanMetadata(snapshot.scan);
    (await import('../shared/data-sync.mjs')).validateDataSync(document.archives['enum-versions']);
    if (document.project.name !== manifest.projectName) throw new Error('项目名称与清单不一致');
    const assets = referencedFiles(document);
    for (const [token, file] of assets) if (entries.get('assets/' + token)?.size !== file.size) throw new Error('素材资产引用文件缺失或大小不一致：' + (file.name || token));
    for (const relative of entries.keys()) if (relative.startsWith('assets/') && !assets.has(relative.slice(7))) throw new Error('项目包包含未被项目引用的素材文件');
    const final = await secureDirectory(root), manifestFinal = await readChecked(path.join(root, 'manifest.json'), 2 * 1024 * 1024);
    if (!sameFile(initial.stat, final.stat) || manifestRead.sha256 !== manifestFinal.sha256) throw new Error('项目文件夹在读取时发生变化');
    return {document, fingerprint: manifestRead.sha256, files: manifest.files};
  }

  async function prepareImport(directory) {
    const result = await readFolder(directory), token = randomUUID();
    // Only native-selected paths are retained. The renderer receives an opaque, expiring handle.
    for (const [key, value] of imports) if (Date.now() - value.createdAt > 30 * 60 * 1000) imports.delete(key);
    if (imports.size >= 10) throw new Error('待导入项目过多，请关闭之前的导入窗口');
    imports.set(token, {directory: path.resolve(directory), fingerprint: result.fingerprint, createdAt: Date.now(), restoring: false});
    return {token, document: result.document};
  }
  function assertFreshProject(projectId) {
    if (!NEW_PROJECT.test(projectId)) throw new Error('导入目标必须是新项目标识');
    const raw = storage.getItem(CATALOG_KEY), catalog = raw === null ? null : JSON.parse(raw);
    if (catalog && (!Array.isArray(catalog.projects) || catalog.projects.some(project => project.id === projectId))) throw new Error('导入目标项目已存在');
    for (const section of [...SECTIONS, ...OPTIONAL_SECTIONS, 'default-table-migration']) if (storage.getItem(archiveKey(projectId, section)) !== null) throw new Error('导入目标已有项目数据，未覆盖');
  }
  async function restoreAssets({token, projectId}) {
    const entry = imports.get(token);
    if (!entry || Date.now() - entry.createdAt > 30 * 60 * 1000 || entry.restoring) throw new Error('导入凭证已失效，请重新选择项目文件夹');
    assertFreshProject(projectId); entry.restoring = true;
    let temporary, identity;
    try {
      const current = await readFolder(entry.directory);
      if (current.fingerprint !== entry.fingerprint) throw new Error('项目文件夹在预览后发生变化，请重新选择');
      const artRoot = path.join(base, 'art-files'), destination = path.join(artRoot, workspaceHash('project:' + projectId));
      await secureDirectory(artRoot, true); await absent(destination);
      temporary = path.join(artRoot, '.gamecreator-import-' + randomUUID());
      await fs.mkdir(temporary); identity = (await secureDirectory(temporary)).stat;
      for (const file of current.files.filter(file => file.path.startsWith('assets/'))) await copyChecked(path.join(entry.directory, ...file.path.split('/')), path.join(temporary, file.path.slice(7)), file);
      const final = await readFolder(entry.directory);
      if (final.fingerprint !== entry.fingerprint) throw new Error('项目文件夹在导入期间发生变化');
      assertFreshProject(projectId);
      await secureDirectory(artRoot); await absent(destination);
      await fs.rename(temporary, destination); temporary = destination;
      assertFreshProject(projectId); temporary = undefined;
    } finally { entry.restoring = false; if (temporary && identity) await cleanupOwned(temporary, identity); }
  }
  function release(token) { const entry = imports.get(token); if (entry?.restoring) throw new Error('项目正在导入，请稍后关闭'); imports.delete(token); }
  return {exportFolder, readFolder, prepareImport, restoreAssets, release};
}

module.exports = {createProjectPackages, safeProjectDirectoryName, archiveKey, SECTIONS, MAX_ASSET_BYTES, MAX_METADATA_BYTES, MAX_TOTAL_BYTES, validateProjectScheduleArchive};
