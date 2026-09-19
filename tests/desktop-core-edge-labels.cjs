// Run after npm run build. SVG measurements are independent of the routing implementation.
// The client uses disposable archives/profile and never edits real user projects.
const { _electron } = require(process.env.GAMECREATOR_PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { createWorkspaceStorage } = require('../desktop/test-workspaces.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-core-edge-labels-'));
  const storage = createWorkspaceStorage(path.join(directory, 'data'));
  const projectId = 'project-' + crypto.randomUUID(), key = 'gamecreator.workspace.v1:' + projectId + ':gameplay-core';
  const compactId = 'project-' + crypto.randomUUID(), compactKey = 'gamecreator.workspace.v1:' + compactId + ':gameplay-core';
  let currentKey = key;
  const node = (id, title, x, y) => ({ id, title, kind: id === 'start' ? 'entry' : 'activity', description: '', x, y, childGraphId: '', gameplayIds: [] });
  const edge = (id, fromId, toId, label, condition = '') => ({ id, fromId, toId, label, condition });
  const core = { schema: 1, rootId: 'root', graphs: [{ id: 'root', title: '连线标签定位', summary: '覆盖每种路由与真实画布变换', nodes: [
    node('start', '前置入口', 100, 150), node('same', '同高状态', 1000, 150), node('near', '近高状态', 470, 225), node('far', '远端状态', 470, 570),
  ], edges: [
    edge('same-height', 'start', 'same', '同高前向', '前置目标已经完成'),
    edge('near-height', 'start', 'near', '继续', '玩家选择继续挑战'),
    edge('diagonal', 'start', 'far', '斜向前进'),
    edge('adjacent-return', 'near', 'start', '相邻返回'),
    edge('same-column', 'far', 'near', '同列返回'),
    edge('self-loop', 'same', 'same', '自身循环'),
    edge('outside-return', 'same', 'start', '外绕返回'),
    edge('parallel', 'start', 'near', '并行支线', '满足备用条件'),
  ] }] };
  const compact = { schema: 1, rootId: 'root', graphs: [{ id: 'root', title: '紧凑日常循环', summary: '', nodes: [
    node('start', '清晨', 40, 150), node('middle', '活动', 280, 150), node('last', '夜晚', 520, 150),
  ], edges: [
    edge('compact-next', 'start', 'middle', '继续', '当天还有时间'),
    edge('compact-night', 'middle', 'last', '结束一天并整理收益', '玩家选择结束当前一天'),
    edge('compact-back', 'middle', 'start', '返回', '继续处理今天的任务'),
    edge('compact-repeat', 'last', 'middle', '重新选择', '还没有结束所有活动'),
  ] }] };
  const config = { engine: 'oasis-lua', projectPath: '', enumPath: 'Script/Const', dataPath: 'Script/Config', outputFormat: 'lua', autoSync: false, backupBeforeSync: true };
  storage.setItem(key, JSON.stringify(core)); storage.setItem(compactKey, JSON.stringify(compact));
  storage.setItem('gamecreator.projects.v1', JSON.stringify({ schema: 2, activeId: projectId, mode: 'project', projects: [{ id: projectId, name: '连线标签隔离回归', config, initialContent: 'empty' }, { id: compactId, name: '紧凑连线测试', config, initialContent: 'empty' }] }));
  const env = { ...process.env, GAMECREATOR_DATA_DIR: path.join(directory, 'data'), GAMECREATOR_USER_DATA_DIR: path.join(directory, 'profile'), GAMECREATOR_TEAM_DATA_DIR: path.join(directory, 'team') };
  delete env.ELECTRON_RUN_AS_NODE;
  const qaDirectory = path.join(root, '.gamecreator', 'qa'); await fs.mkdir(qaDirectory, { recursive: true });
  let app, page; const errors = [];
  const button = name => page.getByRole('button', { name, exact: true });
  const click = name => button(name).click();
  const field = name => page.getByLabel(name, { exact: true });
  const read = () => JSON.parse(storage.getItem(currentKey));
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const wait = async (check, message) => {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 35)); }
    assert.fail(message);
  };
  function edgeGroup(id) {
    const graph = read().graphs[0], item = graph.edges.find(e => e.id === id);
    const from = graph.nodes.find(n => n.id === item.fromId).title, to = graph.nodes.find(n => n.id === item.toId).title;
    return page.getByRole('button', { name: '选择连线：' + from + ' → ' + to + (item.label ? ' · ' + item.label : ''), exact: true });
  }
  async function measurements() {
    return page.locator('.gc-connections').evaluate(svg => {
      const svgInverse = svg.getScreenCTM().inverse();
      return [...svg.querySelectorAll('.gc-edge')].map(group => {
        const path = group.querySelector('.gc-edge-line'), rect = group.querySelector('rect');
        if (!path || !rect) throw new Error('edge is missing its path or label rectangle');
        const center = new DOMPoint(rect.x.baseVal.value + rect.width.baseVal.value / 2, rect.y.baseVal.value + rect.height.baseVal.value / 2)
          .matrixTransform(svgInverse.multiply(rect.getScreenCTM()));
        const pathToGraph = svgInverse.multiply(path.getScreenCTM()), length = path.getTotalLength();
        let distance = Infinity, closest = null;
        // Sample actual browser-rendered geometry every <= 0.6 graph units.
        // This never repeats the application's label-anchor calculation.
        const count = Math.max(200, Math.ceil(length / .6));
        for (let index = 0; index <= count; index++) {
          const p = path.getPointAtLength(length * index / count);
          const point = new DOMPoint(p.x, p.y).matrixTransform(pathToGraph), next = Math.hypot(point.x - center.x, point.y - center.y);
          if (next < distance) { distance = next; closest = { x: point.x, y: point.y }; }
        }
        return { name: group.getAttribute('aria-label'), distance, center: { x: center.x, y: center.y }, closest,
          labelHeight: rect.height.baseVal.value, expanded: !!group.querySelector('.gc-edge-condition'), path: path.getAttribute('d') };
      });
    });
  }
  async function assertAligned(stage, expectedCount = 8) {
    await settle(); const values = await measurements();
    assert.equal(values.length, expectedCount, stage + ': route coverage changed');
    const bad = values.filter(value => !Number.isFinite(value.distance) || value.distance > 2);
    assert.equal(bad.length, 0, stage + ': label centers must lie on their own SVG path within 2 graph units. ' + JSON.stringify(bad));
    return values;
  }
  async function assertClearOfEndpoints(stage) {
    const overlaps = await page.locator('.gc-connections').evaluate((svg, graph) => {
      const groups = [...svg.querySelectorAll('.gc-edge')];
      const nodeBoxes = new Map(graph.nodes.map(node => {
        const button = [...document.querySelectorAll('.gc-node-main')].find(button => button.getAttribute('aria-label') === '选择节点：' + node.title);
        return [node.id, button.closest('.gc-node').getBoundingClientRect()];
      }));
      return graph.edges.flatMap((edge, index) => {
        const label = groups[index].querySelector('rect').getBoundingClientRect();
        return [edge.fromId, edge.toId].flatMap(id => {
          const node = nodeBoxes.get(id), width = Math.min(label.right, node.right) - Math.max(label.left, node.left), height = Math.min(label.bottom, node.bottom) - Math.max(label.top, node.top);
          return width > .5 && height > .5 ? [{ edge: edge.id, node: id, width, height }] : [];
        });
      });
    }, read().graphs[0]);
    assert.deepEqual(overlaps, [], stage + ': a compact-edge caption is obscured by an endpoint node');
  }
  async function viewport() {
    return page.locator('.gc-canvas-scroll').evaluate(canvas => {
      const box = canvas.getBoundingClientRect(), surface = canvas.querySelector('.gc-canvas-surface'), matrix = new DOMMatrixReadOnly(getComputedStyle(surface).transform);
      return { x: box.left, y: box.top, width: canvas.clientWidth, height: canvas.clientHeight, zoom: matrix.a, panX: matrix.e, panY: matrix.f };
    });
  }
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [path.join(root, 'desktop/main.cjs')], env });
    page = await app.firstWindow(); page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
    await click('登录'); await page.locator('.ps-trigger').waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1900, 1150));
    await click('玩法核心'); await page.locator('.gc-edge-line').first().waitFor({ state: 'attached' });
    await click('适配画布'); await page.locator('.gc-canvas-scroll').scrollIntoViewIfNeeded();
    const originalRaw = storage.getItem(key);
    await assertAligned('initial eight routing variants');
    assert.equal(storage.getItem(key), originalRaw, 'opening/fitting the diagram changed its model');

    // Clicking the visible caption must select the intended edge and center its expanded condition.
    const nearGroup = edgeGroup('near-height'), collapsedHeight = await nearGroup.locator('rect').getAttribute('height');
    await nearGroup.locator('rect').click();
    assert.equal(await field('连线说明').inputValue(), '继续');
    assert.equal(await field('流转条件').inputValue(), '玩家选择继续挑战');
    assert.equal(await field('连线起点').inputValue(), 'start'); assert.equal(await field('连线终点').inputValue(), 'near');
    await wait(async () => Number(await edgeGroup('near-height').locator('rect').getAttribute('height')) > Number(collapsedHeight), 'selecting a conditional edge did not expand its caption');
    let values = await assertAligned('selected conditional caption expansion');
    assert.equal(values.filter(value => value.expanded).length, 1);
    assert.equal(storage.getItem(key), originalRaw, 'selecting a caption modified its archive');
    await field('连线说明').fill('继续挑战');
    await wait(() => read().graphs[0].edges.find(e => e.id === 'near-height').label === '继续挑战', 'caption edit did not save to its edge');
    for (const item of core.graphs[0].edges.filter(e => e.id !== 'near-height')) assert.deepEqual(read().graphs[0].edges.find(e => e.id === item.id), item, 'caption editing changed another edge');
    await assertAligned('caption text edit');
    await click('流程属性'); values = await assertAligned('collapsed caption after deselection');
    assert.equal(values.some(value => value.expanded), false);

    // Check live route geometry before dropping a node, including crossing the old near-height threshold.
    const beforeDragRaw = storage.getItem(key), beforeNode = read().graphs[0].nodes.find(n => n.id === 'near');
    const dragButton = button('选择节点：近高状态'), box = await dragButton.boundingBox(), camera = await viewport();
    assert.ok(box); const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(start.x + 12, start.y + 12, { steps: 4 });
    await assertAligned('live node drag with nearby heights'); assert.equal(storage.getItem(key), beforeDragRaw, 'pointer move prematurely saved node coordinates');
    await page.mouse.move(start.x + 38, start.y + 46, { steps: 5 });
    await assertAligned('live node drag across previous 116px routing threshold');
    await page.mouse.up();
    await wait(() => read().graphs[0].nodes.find(n => n.id === 'near').y !== beforeNode.y, 'dropped node position was not saved');
    const moved = read().graphs[0].nodes.find(n => n.id === 'near');
    assert.ok(Math.abs(moved.x - Math.round(beforeNode.x + 38 / camera.zoom)) <= 1);
    assert.ok(Math.abs(moved.y - Math.round(beforeNode.y + 46 / camera.zoom)) <= 1);
    assert.ok(moved.y - beforeNode.y > 41, 'drag did not cross the old near-height branch threshold');
    await assertAligned('persisted node drag');

    // Actual wheel and right-button camera gestures preserve both attachment and project data.
    const beforeNavigation = storage.getItem(key), beforeWheel = await viewport();
    let anchor = { x: beforeWheel.x + beforeWheel.width * .5, y: beforeWheel.y + beforeWheel.height * .72 };
    await page.mouse.move(anchor.x, anchor.y); await page.mouse.wheel(0, -150);
    await wait(async () => (await viewport()).zoom > beforeWheel.zoom, 'wheel did not zoom the canvas'); await assertAligned('wheel zoom in');
    const enlarged = await viewport(); await page.mouse.wheel(0, 95);
    await wait(async () => (await viewport()).zoom < enlarged.zoom, 'wheel did not zoom out'); await assertAligned('wheel zoom out');
    const beforePan = await viewport(); anchor = { x: beforePan.x + beforePan.width * .73, y: beforePan.y + beforePan.height * .75 };
    await page.mouse.move(anchor.x, anchor.y); await page.mouse.down({ button: 'right' }); await page.mouse.move(anchor.x + 52, anchor.y + 28, { steps: 5 }); await page.mouse.up({ button: 'right' });
    await assertAligned('right-button canvas translation');
    assert.equal(storage.getItem(key), beforeNavigation, 'camera gestures changed edge or node data');
    // Sampling in graph coordinates must remain valid at both zoom extremes as well.
    for (const target of [.35, 1.75]) {
      for (let attempt = 0; attempt < 15 && Math.abs((await viewport()).zoom - target) > .00001; attempt++) {
        const view = await viewport(); await page.mouse.move(view.x + view.width * .55, view.y + view.height * .6);
        await page.mouse.wheel(0, target < view.zoom ? 1000 : -1000); await settle();
      }
      assert.ok(Math.abs((await viewport()).zoom - target) < .00001, 'could not reach requested zoom endpoint');
      await assertAligned('zoom endpoint ' + target);
    }
    assert.equal(storage.getItem(key), beforeNavigation, 'zoom endpoints modified project data');
    await click('适配画布'); await edgeGroup('same-height').locator('rect').click(); await assertAligned('selected condition after fit');
    await page.screenshot({ path: path.join(qaDirectory, 'core-edge-labels.png') });
    // Official prototypes use 22px gaps; captions must stay on the actual curve and clear the nodes.
    await page.locator('.ps-trigger').click(); await page.getByRole('menuitemradio').filter({ hasText: '紧凑连线测试' }).click();
    currentKey = compactKey; await click('玩法核心'); await click('适配画布');
    const compactRaw = storage.getItem(compactKey);
    await assertAligned('compact 22px gaps, collapsed', 4); await assertClearOfEndpoints('compact collapsed captions');
    for (const item of compact.graphs[0].edges) {
      await click('流程属性'); await edgeGroup(item.id).locator('rect').click();
      assert.equal(await field('连线说明').inputValue(), item.label, 'clicking the compact label selected the wrong edge');
      assert.equal(await field('流转条件').inputValue(), item.condition);
      assert.equal(await field('连线起点').inputValue(), item.fromId); assert.equal(await field('连线终点').inputValue(), item.toId);
      await assertAligned('compact expanded condition ' + item.id, 4); await assertClearOfEndpoints('compact expanded ' + item.id);
    }
    assert.equal(storage.getItem(compactKey), compactRaw, 'clicking or fitting compact captions changed the model');
    await page.screenshot({ path: path.join(qaDirectory, 'core-edge-labels-compact.png') });
    assert.deepEqual(errors, [], 'renderer errors');
    console.log('PASS edge captions: eight SVG path variants, real center-to-path sampling, selected condition expansion, exact edge editing, live/persisted node dragging and wheel/pan transforms without data changes.');
  } catch (error) {
    if (page && !page.isClosed()) {
      console.error('Edge measurements:', JSON.stringify(await measurements().catch(() => null), null, 2));
      await page.screenshot({ path: path.join(qaDirectory, 'core-edge-labels-failure.png') }).catch(() => {});
    }
    console.error('Renderer errors:', errors); throw error;
  } finally {
    if (app) await app.close();
    const target = path.resolve(directory);
    assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('gc-core-edge-labels-'));
    await fs.rm(target, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
