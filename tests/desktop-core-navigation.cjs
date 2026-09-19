// Run after npm run build. Isolated profile and archives; never changes user projects.
const { _electron } = require(process.env.GAMECREATOR_PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { createWorkspaceStorage } = require('../desktop/test-workspaces.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-core-navigation-'));
  const storage = createWorkspaceStorage(path.join(directory, 'data'));
  const projectId = 'project-' + crypto.randomUUID(), coreKey = 'gamecreator.workspace.v1:' + projectId + ':gameplay-core';
  const node = (id, kind, title, x, y, childGraphId = '') => ({ id, kind, title, description: '', x, y, childGraphId, gameplayIds: [] });
  const edge = (id, fromId, toId, label = '') => ({ id, fromId, toId, label, condition: '' });
  const core = { schema: 1, rootId: 'root', graphs: [
    { id: 'root', title: '游戏入口', summary: '导航交互测试', nodes: [node('menu', 'entry', '主界面', 100, 100), node('challenge', 'module', '挑战模式', 430, 100, 'challenge-flow'), node('reward', 'activity', '获得奖励', 760, 100)], edges: [edge('start', 'menu', 'challenge', '开始'), edge('win', 'challenge', 'reward', '获胜'), edge('again', 'reward', 'challenge', '继续')] },
    { id: 'challenge-flow', title: '挑战模式', summary: '子图独立导航', nodes: [node('prepare', 'entry', '选择植物', 120, 130), node('battle', 'activity', '挑战关卡', 450, 130)], edges: [edge('fight', 'prepare', 'battle', '开始关卡'), edge('retry', 'battle', 'battle', '重试')] },
  ] };
  const config = { engine: 'oasis-lua', projectPath: '', enumPath: 'Script/Const', dataPath: 'Script/Config', outputFormat: 'lua', autoSync: false, backupBeforeSync: true };
  storage.setItem(coreKey, JSON.stringify(core));
  storage.setItem('gamecreator.projects.v1', JSON.stringify({ schema: 2, activeId: projectId, mode: 'project', projects: [{ id: projectId, name: '画布导航隔离测试', config, initialContent: 'empty' }] }));
  const env = { ...process.env, GAMECREATOR_DATA_DIR: path.join(directory, 'data'), GAMECREATOR_USER_DATA_DIR: path.join(directory, 'profile'), GAMECREATOR_TEAM_DATA_DIR: path.join(directory, 'team') };
  delete env.ELECTRON_RUN_AS_NODE;
  const qaDirectory = path.join(root, '.gamecreator', 'qa');
  await fs.mkdir(qaDirectory, { recursive: true });
  let app, page;
  const errors = [];
  const button = name => page.getByRole('button', { name, exact: true });
  const click = name => button(name).click();
  const nodeButton = title => button('选择节点：' + title);
  const read = () => JSON.parse(storage.getItem(coreKey));
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const wait = async (check, message) => {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 35)); }
    assert.fail(message);
  };
  const close = (actual, expected, message, tolerance = 2) => assert.ok(Math.abs(actual - expected) <= tolerance, message + ': expected ' + expected + ', got ' + actual);
  async function state(point) {
    return page.locator('.gc-canvas-scroll').evaluate((canvas, point) => {
      const surface = canvas.querySelector('.gc-canvas-surface'), main = document.querySelector('main.core-workspace-page');
      const matrix = new DOMMatrixReadOnly(getComputedStyle(surface).transform), rect = surface.getBoundingClientRect(), box = canvas.getBoundingClientRect();
      // The rectangle includes both CSS translation and native scroll offsets.
      // Recover the untransformed origin before applying the actual matrix inverse.
      const inversePoint = point ? new DOMPoint(point.x - (rect.left - matrix.e), point.y - (rect.top - matrix.f)).matrixTransform(matrix.inverse()) : null;
      return { zoom: matrix.a, translation: { x: matrix.e, y: matrix.f }, origin: { x: rect.left, y: rect.top },
        world: inversePoint ? { x: inversePoint.x, y: inversePoint.y } : null,
        surface: { width: rect.width, height: rect.height }, viewport: { x: box.left + canvas.clientLeft, y: box.top + canvas.clientTop, width: canvas.clientWidth, height: canvas.clientHeight },
        scroll: { x: canvas.scrollLeft, y: canvas.scrollTop }, mainScroll: { x: main.scrollLeft, y: main.scrollTop }, windowScroll: { x: window.scrollX, y: window.scrollY },
        zoomLabel: document.querySelector('.gc-zoom-tools output').textContent };
    }, point || null);
  }
  async function canvasPoint(fx = .66, fy = .72) {
    const s = await state();
    return { x: s.viewport.x + s.viewport.width * fx, y: s.viewport.y + s.viewport.height * fy };
  }
  async function nodePoint(title) {
    const box = await nodeButton(title).boundingBox(); assert.ok(box, title + ' node is absent');
    return { x: box.x + box.width * .5, y: box.y + box.height * .45 };
  }
  async function wheel(point, delta) {
    const before = await state(point);
    await page.mouse.move(point.x, point.y); await page.mouse.wheel(0, delta);
    await wait(async () => Math.abs((await state()).zoom - before.zoom) > .00001, 'wheel did not change canvas zoom');
    await settle();
    const after = await state(point);
    close(after.world.x, before.world.x, 'wheel changed the world X under the mouse');
    close(after.world.y, before.world.y, 'wheel changed the world Y under the mouse');
    assert.deepEqual(after.mainScroll, before.mainScroll, 'canvas wheel scrolled the surrounding main');
    assert.deepEqual(after.windowScroll, before.windowScroll, 'canvas wheel scrolled the window');
    return { before, after };
  }
  async function wheelTo(bound, delta) {
    for (let attempt = 0; attempt < 14 && Math.abs((await state()).zoom - bound) > .00001; attempt++) await wheel(await canvasPoint(.51, .54), delta);
    close((await state()).zoom, bound, 'wheel zoom bound', .00001);
  }
  async function rightDrag(start, dx, dy) {
    const before = await state();
    await page.mouse.move(start.x, start.y); await page.mouse.down({ button: 'right' });
    await page.mouse.move(start.x + dx, start.y + dy, { steps: 6 }); await page.mouse.up({ button: 'right' }); await settle();
    const after = await state();
    close(after.origin.x - before.origin.x, dx, 'right drag did not pan by the screen X delta');
    close(after.origin.y - before.origin.y, dy, 'right drag did not pan by the screen Y delta');
    close(after.zoom, before.zoom, 'right drag unexpectedly changed zoom', .00001);
    return after;
  }
  async function unchangedAfterMove(point, expected, message) {
    await page.mouse.move(point.x, point.y, { steps: 5 }); await settle();
    const current = await state();
    close(current.origin.x, expected.origin.x, message + ' X'); close(current.origin.y, expected.origin.y, message + ' Y');
  }
  async function reset() {
    await click('还原缩放'); await settle();
    const s = await state();
    close(s.zoom, 1, 'reset did not restore 100%', .00001);
    close(s.translation.x, 0, 'reset did not clear horizontal pan'); close(s.translation.y, 0, 'reset did not clear vertical pan');
    assert.deepEqual(s.scroll, { x: 0, y: 0 }, 'reset left stale native scrolling');
  }
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [path.join(root, 'desktop/main.cjs')], env });
    page = await app.firstWindow(); page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
    await button('登录').click(); await page.locator('.ps-trigger').waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1900, 1150));
    await click('玩法核心'); await nodeButton('主界面').waitFor();
    await page.locator('.gc-canvas-scroll').scrollIntoViewIfNeeded(); await settle();
    await page.evaluate(() => {
      window.__coreNavContexts = []; window.__coreNavPointer = null;
      document.addEventListener('contextmenu', event => { const canvas = !!event.target.closest?.('.gc-canvas-scroll'); setTimeout(() => window.__coreNavContexts.push({ canvas, prevented: event.defaultPrevented }), 0); }, true);
      document.addEventListener('pointerdown', event => { window.__coreNavPointer = { id: event.pointerId, type: event.pointerType }; }, true);
    });
    const originalRaw = storage.getItem(coreKey);

    // Actual wheel events zoom both ways around the same mouse world point.
    const anchor = await canvasPoint(.46, .53);
    let result = await wheel(anchor, -170); assert.ok(result.after.zoom > result.before.zoom);
    result = await wheel(anchor, 110); assert.ok(result.after.zoom < result.before.zoom);
    assert.equal(Math.round(result.after.zoom * 100) + '%', result.after.zoomLabel);
    // A scrollbar offset must be folded into the camera, never cause an anchor jump.
    await reset(); await click('放大画布'); await click('放大画布'); await settle();
    await page.locator('.gc-canvas-scroll').evaluate(el => { el.scrollLeft = 95; el.scrollTop = 24; });
    await settle();
    const scrolled = await state(); assert.ok(scrolled.scroll.x > 0, 'fixture needs horizontal overflow after zooming in');
    await wheel(await canvasPoint(.42, .51), -85);
    await wheelTo(1.75, -5000);
    close((await state()).zoom, 1.75, 'zoom upper bound', .00001);
    const maxState = await state(); await page.mouse.wheel(0, -1000); await settle();
    close((await state()).zoom, 1.75, 'wheel escaped the upper zoom bound', .00001);
    assert.deepEqual((await state()).mainScroll, maxState.mainScroll, 'bounded wheel leaked into main scrolling');
    await wheelTo(.35, 5000); close((await state()).zoom, .35, 'zoom lower bound', .00001);
    await page.mouse.wheel(0, 1000); await settle(); close((await state()).zoom, .35, 'wheel escaped the lower zoom bound', .00001);

    // Panning is independent of scrollbar overflow: the entire fitted surface is smaller.
    await click('适配画布'); await settle();
    const fitted = await state();
    assert.ok(fitted.surface.width < fitted.viewport.width && fitted.surface.height < fitted.viewport.height, 'fit must produce a smaller-than-viewport test graph');
    await rightDrag(await canvasPoint(.75, .72), 67, 42);
    assert.equal(storage.getItem(coreKey), originalRaw, 'camera navigation wrote into the project archive');
    await click('适配画布'); await nodeButton('主界面').click();
    assert.equal(await page.getByLabel('节点名称', { exact: true }).inputValue(), '主界面');
    await rightDrag(await nodePoint('挑战模式'), 56, 31);
    assert.equal(await page.getByLabel('节点名称', { exact: true }).inputValue(), '主界面', 'right-button pan changed the selected node');
    assert.equal(storage.getItem(coreKey), originalRaw, 'right drag on a node modified its coordinates');
    // A right click is still handled when it is not followed by movement.
    let contextCount = await page.evaluate(() => window.__coreNavContexts.length);
    const contextPoint = await canvasPoint(.8, .8);
    await page.mouse.click(contextPoint.x, contextPoint.y, { button: 'right' });
    await wait(async () => (await page.evaluate(() => window.__coreNavContexts.length)) > contextCount, 'no contextmenu event observed from a real right click');
    assert.ok((await page.evaluate(() => window.__coreNavContexts.filter(event => event.canvas))).every(event => event.prevented), 'canvas opened its native context menu');

    // Pressing left while a right-button gesture owns the pointer must not move a node.
    await click('适配画布'); await nodeButton('主界面').click(); const chordStart = await nodePoint('挑战模式'), chordBefore = await state();
    await page.mouse.move(chordStart.x, chordStart.y); await page.mouse.down({ button: 'right' }); await page.mouse.down({ button: 'left' });
    await page.mouse.move(chordStart.x + 32, chordStart.y + 18, { steps: 4 }); await page.mouse.up({ button: 'left' });
    await page.mouse.move(chordStart.x + 48, chordStart.y + 27, { steps: 3 }); await page.mouse.up({ button: 'right' }); await settle();
    const chordAfter = await state();
    close(chordAfter.origin.x - chordBefore.origin.x, 48, 'right pan did not continue after releasing the left button on X');
    close(chordAfter.origin.y - chordBefore.origin.y, 27, 'right pan did not continue after releasing the left button on Y');
    assert.equal(storage.getItem(coreKey), originalRaw, 'left/right button chord modified a graph node');
    assert.equal(await page.getByLabel('节点名称', { exact: true }).inputValue(), '主界面', 'left/right pan chord changed node selection');

    // Connection mode must not turn a right-button pan into selecting/connecting a target.
    await click('适配画布'); await button('从此节点连线：主界面').click();
    await rightDrag(await nodePoint('挑战模式'), 34, 23);
    assert.equal(await button('取消连线').isVisible(), true);
    assert.equal(storage.getItem(coreKey), originalRaw, 'right pan created a connection');
    await page.keyboard.press('Escape'); await button('连接节点').waitFor();

    // Pointer capture releases outside the canvas and does not leave the camera attached.
    await click('适配画布'); const outsideStart = await canvasPoint(.1, .75), bounds = (await state()).viewport;
    await page.mouse.move(outsideStart.x, outsideStart.y); await page.mouse.down({ button: 'right' });
    const outside = { x: bounds.x - 25, y: outsideStart.y + 14 };
    await page.mouse.move(outside.x, outside.y, { steps: 5 }); await page.mouse.up({ button: 'right' }); await settle();
    const released = await state();
    assert.ok(Math.abs(released.origin.x - (await state()).viewport.x) > 5, 'outside drag did not move the camera');
    await unchangedAfterMove(await canvasPoint(.5, .7), released, 'pointer continued panning after release outside');

    // Browser cancellation and window blur also end a drag while the physical button is held.
    for (const reason of ['pointercancel', 'blur']) {
      await click('适配画布'); const start = await canvasPoint(.72, .7);
      await page.mouse.move(start.x, start.y); await page.mouse.down({ button: 'right' }); await page.mouse.move(start.x + 24, start.y + 19, { steps: 3 });
      await page.evaluate(reason => {
        if (reason === 'blur') window.dispatchEvent(new Event('blur'));
        else {
          const pointer = window.__coreNavPointer;
          document.querySelector('.gc-canvas-scroll').dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: pointer.id, pointerType: pointer.type, button: 2, buttons: 0 }));
        }
      }, reason);
      await settle(); const stopped = await state();
      await unchangedAfterMove({ x: start.x + 70, y: start.y + 42 }, stopped, reason + ' did not end right-button pan');
      await page.mouse.up({ button: 'right' });
      await rightDrag(await canvasPoint(.75, .7), -21, -15);
    }
    assert.equal(storage.getItem(coreKey), originalRaw, 'canceling navigation altered the saved graph');

    // The directory and inspector retain normal scrolling rather than zooming the canvas.
    await click('适配画布');
    for (const selector of ['.gc-directory', '.gc-inspector']) {
      const before = await state(), box = await page.locator(selector).boundingBox();
      assert.ok(box, selector + ' is missing');
      await page.mouse.move(box.x + Math.min(box.width / 2, 90), box.y + Math.min(box.height / 2, 120));
      await page.mouse.wheel(0, 90); await settle();
      close((await state()).zoom, before.zoom, selector + ' wheel changed canvas scale', .00001);
    }
    await page.locator('.gc-canvas-scroll').scrollIntoViewIfNeeded();
    await reset(); await click('适配画布'); await settle();

    // Left-button node dragging still converts the screen delta using the visible scale.
    const dragBefore = read().graphs[0].nodes.find(n => n.id === 'menu'), scale = (await state()).zoom;
    assert.ok(scale < 1, 'left-drag test needs a non-100% zoom');
    const leftStart = await nodePoint('主界面'), dx = 57, dy = 36;
    await page.mouse.move(leftStart.x, leftStart.y); await page.mouse.down();
    await page.mouse.wheel(0, -150); await settle(); close((await state()).zoom, scale, 'wheel during node drag changed its coordinate scale', .00001);
    await page.mouse.move(leftStart.x + dx, leftStart.y + dy, { steps: 6 }); await page.mouse.up();
    await wait(() => read().graphs[0].nodes.find(n => n.id === 'menu').x !== dragBefore.x, 'left drag was not persisted');
    const moved = read().graphs[0].nodes.find(n => n.id === 'menu');
    close(moved.x, Math.round(dragBefore.x + dx / scale), 'scaled left drag X', 1);
    close(moved.y, Math.round(dragBefore.y + dy / scale), 'scaled left drag Y', 1);
    assert.equal(read().graphs[0].edges.length, 3);

    // Double-clicking enters the child graph; navigation clears pan and drag state.
    await click('适配画布'); await rightDrag(await canvasPoint(.78, .73), 38, 20);
    await nodeButton('挑战模式').dblclick(); await nodeButton('选择植物').waitFor(); await settle();
    const childState = await state();
    close(childState.translation.x, 0, 'changing graph retained old horizontal pan'); close(childState.translation.y, 0, 'changing graph retained old vertical pan');
    await unchangedAfterMove(await canvasPoint(.74, .74), childState, 'changing graph retained stale drag state');
    await click('适配画布'); await click('连接节点'); await nodeButton('挑战关卡').click(); await nodeButton('选择植物').click();
    await page.getByLabel('连线说明', { exact: true }).fill('导航后继续编辑');
    assert.ok(read().graphs.find(g => g.id === 'challenge-flow').edges.some(e => e.fromId === 'battle' && e.toId === 'prepare' && e.label === '导航后继续编辑'));
    await click('返回流程：游戏入口'); await nodeButton('主界面').waitFor();
    await rightDrag(await canvasPoint(.8, .74), -110, -65); await reset(); await click('适配画布');
    const restored = await state();
    assert.ok(restored.surface.width <= restored.viewport.width && restored.surface.height <= restored.viewport.height, 'fit did not recover the visible graph');
    assert.ok(await nodeButton('主界面').isVisible());
    assert.ok(await nodeButton('挑战模式').isVisible());
    await page.screenshot({ path: path.join(qaDirectory, 'core-canvas-navigation.png') });
    // A removed child graph restored from another writer must fall back to a visible root.
    await nodeButton('挑战模式').dblclick(); await nodeButton('选择植物').waitFor(); await click('适配画布');
    await rightDrag(await canvasPoint(.8, .78), -600, -260); await rightDrag(await canvasPoint(.8, .78), -600, -260);
    const farChild = await state(); assert.ok(farChild.translation.x < -1000, 'child camera was not far away before recovery');
    const external = read();
    external.graphs = external.graphs.filter(g => g.id !== 'challenge-flow');
    const externalRoot = external.graphs.find(g => g.id === external.rootId);
    externalRoot.nodes = externalRoot.nodes.filter(n => n.id !== 'challenge');
    externalRoot.edges = externalRoot.edges.filter(e => e.fromId !== 'challenge' && e.toId !== 'challenge');
    const externalRaw = JSON.stringify(external); storage.setItem(coreKey, externalRaw);
    await page.getByLabel('流程图说明', { exact: true }).fill('被删除子图的本地冲突草稿');
    await button('重新读取存档').waitFor(); await click('重新读取存档');
    await nodeButton('主界面').waitFor(); await settle();
    const recovered = await state(), recoveredNode = await nodeButton('主界面').boundingBox();
    close(recovered.translation.x, 0, 'root recovery retained deleted-child horizontal pan');
    close(recovered.translation.y, 0, 'root recovery retained deleted-child vertical pan');
    assert.ok(recoveredNode.x >= recovered.viewport.x - 2 && recoveredNode.y >= recovered.viewport.y - 2 && recoveredNode.x + recoveredNode.width <= recovered.viewport.x + recovered.viewport.width + 2 && recoveredNode.y + recoveredNode.height <= recovered.viewport.y + recovered.viewport.height + 2, 'recovered root entrance is outside the viewport');
    assert.equal(storage.getItem(coreKey), externalRaw, 'fallback navigation rewrote the externally saved archive');
    await unchangedAfterMove(await canvasPoint(.68, .68), recovered, 'root recovery left a stale pointer gesture');
    assert.deepEqual(errors, [], 'renderer errors');
    console.log('PASS core canvas navigation: anchored wheel zoom/bounds, no outer scroll, fitted/node right-pan, native-menu prevention, capture release/cancel/blur, independent panels, scaled node drag, nested navigation and connections.');
  } catch (error) {
    if (page && !page.isClosed()) {
      console.error('Canvas state:', await state().catch(() => null));
      console.error((await page.locator('body').innerText()).slice(-7500));
      await page.screenshot({ path: path.join(qaDirectory, 'core-canvas-navigation-failure.png') }).catch(() => {});
    }
    console.error('Renderer errors:', errors); throw error;
  } finally {
    if (app) await app.close();
    const target = path.resolve(directory);
    assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('gc-core-navigation-'));
    await fs.rm(target, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
