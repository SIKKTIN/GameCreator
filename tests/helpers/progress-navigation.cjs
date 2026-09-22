const assert = require('node:assert/strict');

module.exports = async function verifyProgressNavigation(page, completionButton) {
  const canvas = page.locator('.sp-scroll');
  const state = () => canvas.evaluate(e => {
    const rect = e.getBoundingClientRect();
    let pageY = 0;
    for (let parent = e.parentElement; parent; parent = parent.parentElement) pageY += parent.scrollTop;
    return { left: rect.left + e.clientLeft, top: rect.top + e.clientTop, x: e.scrollLeft, y: e.scrollTop, zoom: Number(getComputedStyle(e.firstElementChild).zoom), pageY };
  });
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 2, `${label}: ${actual} vs ${expected}`);
  await canvas.evaluate(e => { e.scrollIntoView({ block: 'start' }); e.scrollLeft = 250; e.scrollTop = 220; });
  let before = await state();
  await page.mouse.move(before.left + 420, before.top + 240);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(before.left + 300, before.top + 150, { steps: 6 });
  assert.ok((await canvas.getAttribute('class')).includes('is-panning'));
  let after = await state();
  near(after.x, before.x + 120, 'right drag pans horizontally');
  near(after.y, before.y + 90, 'right drag pans vertically');
  near(after.pageY, before.pageY, 'panning does not scroll the page');
  await page.mouse.up({ button: 'right' });
  assert.ok(!(await canvas.getAttribute('class')).includes('is-panning'));
  assert.equal(await canvas.evaluate(e => e.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))), false);

  // Right drag starts over a real completion control without toggling it or selecting a node.
  await completionButton.scrollIntoViewIfNeeded();
  const box = await completionButton.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x - 35, box.y - 20, { steps: 3 });
  await page.mouse.up({ button: 'right' });
  assert.ok(await completionButton.isVisible());
  assert.equal(await page.getByRole('region', { name: '选中任务进度', exact: true }).count(), 0);

  // Pointer capture keeps dragging outside the viewport; release and cancellation never stick.
  await canvas.evaluate(e => { e.scrollIntoView({ block: 'start' }); e.scrollLeft = 250; e.scrollTop = 220; });
  before = await state();
  await page.mouse.move(before.left + 300, before.top + 220);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(before.left - 25, before.top + 180, { steps: 5 });
  after = await state();
  near(after.x, before.x + 325, 'pointer capture pans outside the canvas');
  await page.mouse.up({ button: 'right' });
  assert.ok(!(await canvas.getAttribute('class')).includes('is-panning'));
  await page.mouse.move(before.left + 300, before.top + 220);
  await page.mouse.down({ button: 'right' });
  await page.keyboard.press('Escape');
  before = await state();
  await page.mouse.move(before.left + 240, before.top + 180);
  after = await state();
  near(after.x, before.x, 'Escape ends dragging');
  near(after.y, before.y, 'Escape ends vertical dragging');
  await page.mouse.up({ button: 'right' });
  await page.mouse.down({ button: 'right' });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.ok(!(await canvas.getAttribute('class')).includes('is-panning'));
  await page.mouse.up({ button: 'right' });

  // Keep the content under the cursor stable at non-zero scroll and non-unit zoom.
  await canvas.evaluate(e => { e.scrollLeft = 250; e.scrollTop = 240; });
  const point = { x: 420, y: 260 };
  for (const delta of [-100, 150]) {
    before = await state();
    await page.mouse.move(before.left + point.x, before.top + point.y);
    await page.mouse.wheel(0, delta);
    await page.waitForFunction(old => Number(getComputedStyle(document.querySelector('.sp-canvas')).zoom) !== old, before.zoom);
    after = await state();
    assert.ok(delta < 0 ? after.zoom > before.zoom : after.zoom < before.zoom);
    near((after.x + point.x) / after.zoom, (before.x + point.x) / before.zoom, 'wheel keeps cursor X anchor');
    near((after.y + point.y) / after.zoom, (before.y + point.y) / before.zoom, 'wheel keeps cursor Y anchor');
    near(after.pageY, before.pageY, 'wheel zoom does not scroll the page');
  }
  // Repeated wheel events, including at a limit, remain inside the supported zoom range.
  for (const [delta, target] of [[1000, .4], [-1000, 1.25]]) {
    before = await state();
    for (let i = 0; i < 9; i++) { await page.mouse.wheel(0, delta); await settle(); }
    after = await state();
    assert.equal(after.zoom, target);
    near(after.pageY, before.pageY, 'zoom limit does not leak wheel scrolling to page');
  }
  for (const deltaMode of [1, 2]) {
    before = await state();
    await canvas.evaluate((e, mode) => {
      const rect = e.getBoundingClientRect();
      e.dispatchEvent(new WheelEvent('wheel', { clientX: rect.left + 420, clientY: rect.top + 260, deltaY: 1, deltaMode: mode, cancelable: true, bubbles: true }));
    }, deltaMode);
    await settle();
    assert.ok((await state()).zoom < before.zoom, 'line/page wheel delta is supported');
  }
  await page.getByRole('button', { name: '原始大小', exact: true }).click();
  // The view can disappear under filtering and return with its navigation listeners restored.
  const search = page.getByLabel('搜索制作任务', { exact: true });
  await search.fill('无此任务导航验收'); await canvas.waitFor({ state: 'detached' });
  await search.fill(''); await canvas.waitFor();
  await canvas.evaluate(e => { e.scrollIntoView({ block: 'start' }); e.scrollLeft = 100; e.scrollTop = 100; });
  before = await state();
  await page.mouse.move(before.left + 350, before.top + 200);
  await page.mouse.wheel(0, 100);
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.sp-canvas')).zoom) < 1);
  before = await state();
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(before.left + 300, before.top + 150);
  await page.mouse.up({ button: 'right' });
  after = await state();
  near(after.x, before.x + 50, 'panning remains in screen pixels after zoom and remount');
  near(after.y, before.y + 50, 'vertical panning after zoom and remount');
  await page.getByRole('button', { name: '原始大小', exact: true }).click();
  await canvas.evaluate(e => { e.scrollLeft = 0; e.scrollTop = 0; });
  // Outside the canvas the wheel retains ordinary page scrolling.
  await page.locator('.sp-heading').scrollIntoViewIfNeeded();
  const heading = await page.locator('.sp-heading').boundingBox();
  await page.mouse.move(heading.x + 50, heading.y + 30);
  await page.mouse.wheel(0, 160);
  await page.waitForFunction(y => document.querySelector('.sp-heading').getBoundingClientRect().top < y - 20, heading.y);
  assert.equal((await state()).zoom, 1);
};
