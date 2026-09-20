// Authored click-through baselines. Only prototypeDesign is generated; existing designs stay intact.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { validatePrototypeDesign, prototypeIssues, prototypeSource } from '../src/prototype-design.ts';

const palettes = {
  'plants-vs-zombies': ['pvz', '草坪保卫战', '#13271e', '#417c41', '#eac16d'],
  'stardew-valley': ['farm', '七日农场生活', '#1e292c', '#467968', '#e4bd76'],
  'hollow-knight': ['hk', '裂隙回路', '#161b2c', '#586789', '#b9c9e9'],
  'disco-elysium': ['de', '港区疑案', '#262126', '#7d4f45', '#d5bca0'],
  'vampire-survivors': ['vs', '暮色荒原', '#231b28', '#744455', '#dbb071'],
};
export function buildPrototypeScenes(slug, example) {
  const [prefix, game, bg, accent, gold] = palettes[slug];
  const scenes = [], id = key => `${prefix}-proto-${key}`, designs = example.gameplay.designs;
  const nodeIds = new Set(example.gameplayCore.graphs.flatMap(g => g.nodes.map(n => n.id)));
  function scene(key, name, core, description = '') {
    assert.ok(nodeIds.has(core), `Missing core node: ${core}`);
    const s = { id: id(key), name, description: description || `${name}的点击式场景快照，用于验证界面和流转；数值与检定结果不自动计算。`, width: 1280, height: 720, background: bg, view: 'free', sourceDesignId: '', roomId: '', coreNodeId: core, elements: [] };
    scenes.push(s); rect(s, 0, 0, 1280, 78, '#10151c'); text(s, game, 32, 13, 210, 24, 16, gold); text(s, name, 264, 16, 730, 40, 27); text(s, '点击式原型', 1090, 24, 150, 26, 15, '#9ea6ad'); return s;
  }
  function element(s, kind, textValue, x, y, width, height, color, fontSize = 20, extra = {}) {
    const e = { id: `${s.id}-e-${String(s.elements.length + 1).padStart(3, '0')}`, kind, name: textValue || `底板 ${s.elements.length}`, text: textValue, x, y, width, height, color, fontSize, visible: true, sourceObjectId: '', assetId: '', versionId: '', fileId: '', action: { kind: 'none', targetId: '', condition: '' }, ...extra };
    s.elements.push(e); return e;
  }
  const rect = (s, x, y, w, h, color = '#263339') => element(s, 'shape', '', x, y, w, h, color);
  const text = (s, value, x, y, w = 1000, h = 36, size = 22, color = '#f0ede6', extra) => element(s, 'text', value, x, y, w, h, color, size, extra);
  function button(s, label, to, x, y, w = 260, h = 52, condition = '', extra = {}) { return element(s, 'button', label, x, y, w, h, accent, 20, { action: { kind: 'scene', targetId: id(to), condition }, ...extra }); }
  function row(s, actions, y = 636) { const gap = 16, w = (1200 - gap * (actions.length - 1)) / actions.length; actions.forEach(([label, to, condition = ''], i) => button(s, label, to, 40 + (w + gap) * i, y, w, 52, condition)); }
  function card(s, title, lines, x = 100, y = 160, w = 1080, h = 400) { rect(s, x, y, w, h, '#25303a'); rect(s, x, y, 6, h, accent); text(s, title, x + 20, y + 22, w - 40, 48, 30, gold); lines.forEach((line, i) => text(s, line, x + 24, y + 94 + i * 45, w - 48, 34, 21)); }
  function note(s, value) { text(s, value, 40, 54, 1200, 22, 15, gold); }
  function space(s, designIndex, roomId = '') { s.sourceDesignId = designs[designIndex].id; s.roomId = roomId; const room = designs[designIndex].space.spatial?.rooms.find(r => r.id === roomId); s.view = room?.view || (designs[designIndex].space.spatial?.view === 'free' ? 'free' : 'grid'); return s; }
  function port(s, objectName, to, label, condition = '') { const object = prototypeSource(s, designs).objects.find(o => o.name === objectName); assert.ok(object, `Missing ${slug} object: ${objectName}`); return button(s, label, to, 0, 0, 80, 50, condition, { sourceObjectId: object.id }); }
  function menu(core, subtitle, actions) { const s = scene('menu', '主界面', core); rect(s, 70, 143, 690, 402, '#25303a'); rect(s, 70, 143, 10, 402, accent); text(s, game, 110, 215, 600, 80, 56, gold); text(s, subtitle, 110, 315, 600, 50, 25); text(s, '选择一个入口，开始这一段旅程。', 110, 425, 600, 40, 19, '#bbc1c4'); actions.forEach(([label, to], i) => button(s, label, to, 850, 155 + i * 84, 330, 62)); return s; }
  function page(key, title, core, lines, actions, sub = title) { const s = scene(key, title, core); card(s, sub, lines); row(s, actions); return s; }

  if (slug === 'plants-vs-zombies') {
    menu('pvz-core-root-entry', '种下第一株向日葵，守住家门。', [['开始挑战', 'select'], ['无尽守卫', 'endless'], ['花园养成', 'garden']]);
    let s = scene('select', '选择植物', 'pvz-core-challenge-select');
    [['向日葵', ['50 阳光', '每 15 秒产出 25 阳光', '稳住经济，持续补充防线']], ['豌豆射手', ['100 阳光', '同路射击 · 每次伤害 20', '优先覆盖出现僵尸的路线']], ['坚果墙', ['50 阳光', '生命值 1800', '保护后排，争取产出时间']]].forEach(([name, lines], i) => card(s, name, lines, 45 + i * 415, 170, 390, 350));
    note(s, '本关三张卡全部携带 · 5 行 × 9 列 · 初始阳光 150'); row(s, [['返回主界面', 'menu'], ['携带三张卡出发', 'field']]);
    s = space(scene('field', '白天草坪 · 布置防线', 'pvz-core-challenge-stage'), 0);
    note(s, '阳光 150 · 第 1 / 3 波 · 点击植物查看本次布置');
    port(s, '向日葵', 'sunflower', '向日葵'); port(s, '豌豆射手', 'peashooter', '豌豆射手'); port(s, '坚果墙', 'wallnut', '坚果墙');
    row(s, [['种向日葵', 'sunflower'], ['种豌豆射手', 'peashooter'], ['种坚果墙', 'wallnut'], ['进入波次演示', 'waves'], ['暂停', 'pause']]);
    for (const [key, name, remaining, line] of [['sunflower', '向日葵', 100, '先投资生产，等下一份阳光补足火力。'], ['peashooter', '豌豆射手', 50, '射手朝右攻击同路最近的僵尸。'], ['wallnut', '坚果墙', 100, '坚果承受啃咬，为后排保留输出时间。']]) {
      s = space(scene(key, name + ' · 种植结果', 'pvz-core-challenge-stage'), 0); note(s, `本次布置：${name} · 剩余阳光 ${remaining} · ${line}`); row(s, [['重新布置', 'field'], ['推进到后续波次', 'waves'], ['暂停', 'pause']]);
    }
    s = space(scene('waves', '白天草坪 · 三波压力', 'pvz-core-challenge-stage'), 0); note(s, '三波共 16 只僵尸 · 敌人从右侧出现，沿各自路线接近家门。'); row(s, [['演示守关成功', 'reward', '三波事件已结束，所有僵尸均被消灭。'], ['演示家门失守', 'defeat'], ['暂停', 'pause']]);
    page('pause', '暂停菜单', 'pvz-core-root-challenge', ['暂停期间保留当前布置。', '继续挑战，或返回选卡重新安排防线。'], [['继续关卡', 'waves'], ['重新选卡', 'select'], ['返回主界面', 'menu']]);
    page('reward', '领取关卡奖励', 'pvz-core-challenge-reward', ['白天草坪守卫成功。', '奖励卡已解锁：进入下一段挑战。', '最终首领关是模式分支示意，沿用草坪作为占位战场。'], [['下一关挑战', 'field'], ['进入最终首领示意', 'boss'], ['返回主界面', 'menu']], '防线守住了！');
    s = space(scene('boss', '最终首领 · 模式分支示意', 'pvz-core-challenge-boss'), 0); note(s, '保护五条路线，在最后一轮压力中守住家门。'); row(s, [['演示击败首领', 'complete'], ['演示挑战失败', 'defeat'], ['返回选卡', 'select']]);
    page('complete', '挑战通关', 'pvz-core-root-ending', ['所有挑战已完成，草坪重新安静下来。', '回到花园照料植物，或开启没有终点的无尽守卫。'], [['进入无尽', 'endless'], ['去花园', 'garden'], ['返回主界面', 'menu']]);
    page('defeat', '家门失守', 'pvz-core-endless-exit', ['这一次没能守住防线。', '重新选择植物，调整经济与阻挡的分配。'], [['重新挑战', 'select'], ['返回主界面', 'menu']]);
    s = space(scene('endless', '无尽守卫 · 持续循环', 'pvz-core-endless-wave'), 0); note(s, '每轮守卫后重新整备，继续迎接压力。'); row(s, [['本轮守住了，整备', 'endless-rest'], ['演示本轮结束', 'defeat'], ['返回主界面', 'menu']]);
    page('endless-rest', '无尽 · 整备防线', 'pvz-core-endless-prepare', ['修补空缺路线，调整植物配置。', '下一轮会继续加压，直到失败或主动离开。'], [['迎接下一轮', 'endless'], ['结束守卫', 'menu']]);
    s = scene('garden', '花园 · 培育与收获', 'pvz-core-garden-care');
    ['向日葵幼苗', '豌豆苗', '坚果幼苗'].forEach((n, i) => card(s, n, ['状态：等待照料', '浇水后继续生长'], 55 + i * 410, 180, 380, 310));
    row(s, [['浇水照料', 'garden-watered'], ['返回主界面', 'menu']]);
    page('garden-watered', '花园 · 等待成熟', 'pvz-core-garden-ripe', ['植物已经浇过水。', '培育 → 等待 → 成熟 → 收获，再投入下一轮培育。'], [['演示成熟并收获', 'garden-harvest'], ['继续照料', 'garden']]);
    page('garden-harvest', '花园 · 收获反馈', 'pvz-core-garden-harvest', ['收下这轮培育的成果。', '留在花园继续培育，或带着好心情再次守卫草坪。'], [['再次培育', 'garden'], ['开始挑战', 'select'], ['返回主界面', 'menu']]);
  }

  if (slug === 'stardew-valley') {
    menu('farm-core-root-entry', '从第一粒种子，开始自己的每一天。', [['开始农场生活', 'farm'], ['查看七日目标', 'goals']]);
    let s = space(scene('farm', '第 1 日 · 清晨农场', 'farm-core-root-morning'), 0, 'sv-room-farm');
    note(s, '06:00 · 晴 · 金币 60 · 体力 60 / 60 · 萝卜种子 6，豆角种子 2');
    port(s, '16格农田', 'field', '耕作田地'); port(s, '东门·去村庄', 'village', '去村庄'); port(s, '农舍门口·睡觉', 'night', '休息'); port(s, '出货箱', 'shipping', '出货');
    row(s, [['田间劳作', 'field'], ['前往村庄', 'village'], ['自由活动', 'activities'], ['出货与休息', 'shipping'], ['主界面', 'menu']]);
    s = space(scene('field', '田间 · 锄地、播种、浇水', 'farm-core-farm-work'), 1); note(s, '16 个农田格 · 锄地 2 体力 / 格 · 浇水 2 体力 / 格 · 水壶容量 8'); row(s, [['演示种下萝卜并浇水', 'growing'], ['查看成熟收获', 'harvest', '本次展示已完成两次已浇水的日结算。'], ['返回农场', 'farm']]);
    page('growing', '萝卜 · 跨日生长', 'farm-core-farm-ready', ['播种并浇水完成，萝卜还没有成熟。', '萝卜需要 2 次已浇水的日结算；豆角需要 3 次。', '雨天自动浇水，晴天记得再次照料。'], [['去村庄逛逛', 'village'], ['结束当天', 'night'], ['演示成熟后的农田', 'harvest', '已经满足对应作物的浇水与生长夜数。']]);
    page('harvest', '收获 · 第一次经营取舍', 'farm-core-farm-harvest', ['成熟的萝卜可收获，每株消耗 1 体力。', '每颗萝卜出货价 20 金币，也可以为阿禾留下 3 颗。', '本页展示已成熟作物的结果快照。'], [['把收成放入出货箱', 'shipping'], ['留三颗去交委托', 'social', '背包中有至少 3 颗萝卜，尚未超过第 7 日结算。'], ['返回农场', 'farm']]);
    s = space(scene('village', '村庄 · 商店与阿禾', 'farm-core-social-entry'), 0, 'sv-room-village'); note(s, '09:00 · 杂货铺营业至 17:00 · 阿禾当前在柜台附近');
    port(s, '杂货铺柜台', 'shop', '购买种子'); port(s, '阿禾·初始位置', 'social', '与阿禾交谈'); port(s, '西口·回农场', 'farm', '回农场'); row(s, [['杂货铺', 'shop'], ['寻找阿禾', 'social'], ['河边活动', 'fishing'], ['返回农场', 'farm']]);
    s = scene('shop', '杂货铺 · 种子采购', 'farm-core-farm-work'); card(s, '萝卜种子', ['10 金币 / 包', '生长需要 2 个浇水夜', '适合尽快开启第一轮收成'], 90, 170, 525, 340); card(s, '豆角种子', ['20 金币 / 包', '生长需要 3 个浇水夜', '晚一些收获，合理安排跨日'], 665, 170, 525, 340); row(s, [['演示购入萝卜种子', 'purchased', '商店营业且金币不少于 10，背包有可用空间。'], ['返回村庄', 'village']]);
    page('purchased', '采购完成', 'farm-core-farm-work', ['购入萝卜种子 × 1。', '初始金币 60 → 50 的采购快照。', '带种子回田地，把资金投入下一次收成。'], [['回农场播种', 'field'], ['继续逛村庄', 'village']]);
    page('social', '阿禾 · 三颗萝卜', 'farm-core-social-meet', ['阿禾：这几天能帮我留三颗萝卜吗？', '委托：第 7 日结算前交付萝卜 × 3，奖励 40 金币。', '先交谈认识彼此，也可以直接检查交付条件。'], [['记下委托，回农场', 'farm'], ['交付三颗萝卜', 'quest-done', '萝卜不少于 3，委托未完成且未超过期限。'], ['返回村庄', 'village']]);
    page('quest-done', '阿禾 · 委托完成', 'farm-core-social-deliver', ['阿禾收下三颗萝卜，记住了你的帮助。', '本次交付奖励 40 金币；同一委托只结算一次。'], [['继续今天的安排', 'activities'], ['回农场', 'farm']]);
    page('activities', '今天想做什么？', 'farm-core-root-choose', ['照料农田，去村庄拜访，或探索其他活动。', '钓鱼与矿洞展示玩法核心中的开放活动分支。', '七日目标用于阶段回顾，日常生活可以继续。'], [['农场劳作', 'field'], ['河边钓鱼', 'fishing'], ['矿洞探索', 'mine'], ['村庄社交', 'village']]);
    page('fishing', '河边 · 钓鱼循环', 'farm-core-fishing-cast', ['选好水域，抛竿并等待鱼讯。', '观察结果，决定继续尝试还是把收获带回。'], [['演示钓到鱼', 'catch'], ['空手再抛一次', 'fishing'], ['返回当天安排', 'activities']]);
    page('catch', '河边 · 收获一尾鱼', 'farm-core-fishing-catch', ['一尾鱼装进背包。', '今天还有时间：再试一次，或回去照顾农场。'], [['继续钓鱼', 'fishing'], ['回农场', 'farm'], ['休息结算', 'night']]);
    page('mine', '矿洞 · 深入还是返回', 'farm-core-mine-risk', ['探索一层矿洞，发现矿石与更深的入口。', '体力和风险决定是否继续；返回可以保住已有收获。'], [['演示继续深入', 'mine-deep'], ['带回资源', 'farm'], ['查看其他活动', 'activities']]);
    page('mine-deep', '矿洞 · 风险加深', 'farm-core-mine-explore', ['更深处有新的矿脉，也有更高的遭遇风险。', '这次探索的目标已满足，随时可以带资源返回。'], [['再探索一层', 'mine'], ['带回资源', 'farm']]);
    page('shipping', '出货箱 · 安排今天的收成', 'farm-core-farm-harvest', ['把可出售的作物放进出货箱，睡觉后结算。', '出货 3 颗萝卜的演示：3 × 20 = 60 金币。', '给阿禾的委托物品应留在背包。'], [['放入三颗萝卜并休息', 'night', '背包有 3 颗可出售萝卜，已确认不会占用委托预留。'], ['返回农场', 'farm']]);
    page('night', '一天结束 · 日结算', 'farm-core-root-settle', ['出货收入：60 金币（示例结算快照）。', '已浇水的作物增长一天，体力恢复到 60。', '第 2 日是雨天，可以把更多时间留给村庄和自由活动。'], [['迎接新的一天', 'morning'], ['查看七日回顾', 'goals'], ['返回主界面', 'menu']]);
    s = space(scene('morning', '第 2 日 · 雨天的安排', 'farm-core-root-morning'), 0, 'sv-room-farm'); note(s, '06:00 · 雨 · 作物自动浇水 · 体力 60 / 60'); row(s, [['检查农田', 'growing'], ['去村庄', 'village'], ['自由活动', 'activities'], ['再次休息', 'night']]);
    page('goals', '七日回顾 · 生活仍在继续', 'farm-core-root-choose', ['经营目标：累计出货 8 个作物，期末现金达到 100 金币。', '关系目标：完成阿禾的三颗萝卜委托。', '目标完成后仍可继续劳作、钓鱼、探索与社交。'], [['继续生活', 'farm'], ['选择自由活动', 'activities'], ['返回主界面', 'menu']]);
  }

  if (slug === 'hollow-knight') {
    menu('hk-core-root-entry', '寻找能力，让旧路通向新的地方。', [['进入裂隙', 'A'], ['查看区域地图', 'map']]);
    let s = scene('map', '裂隙地图 · 四个房间', 'hk-core-explore-observe');
    rect(s, 310, 282, 630, 4, '#5e7084'); rect(s, 310, 283, 4, 220, '#5e7084'); rect(s, 940, 283, 4, 220, '#5e7084'); rect(s, 310, 500, 630, 4, '#5e7084');
    [['A', 'A 篝台回廊', '长椅 / 岔路', 110, 160], ['B', 'B 静默试炼', '守碑虫 / 冲刺印记', 750, 160], ['C', 'C 裂隙回路', '尖刺沟 / 永久近路', 110, 390], ['D', 'D 遗壳守卫', '双阶段首领 / 出口', 750, 390]].forEach(([key, title, sub, x, y]) => { button(s, title, key, x, y, 410, 95); text(s, sub, x, y + 108, 410, 35, 20, gold); });
    note(s, '地图用于查看房间；通行门槛在房间内确认。'); row(s, [['回到长椅', 'A'], ['返回主界面', 'menu']]);
    const roomIndex = { A: 3, B: 4, C: 5, D: 6 }, coreFor = { A: 'hk-core-explore-entry', B: 'hk-core-growth-trial', C: 'hk-core-routes-check', D: 'hk-core-combat-fight' };
    const roomScenes = {};
    for (const key of ['A', 'B', 'C', 'D']) roomScenes[key] = space(scene(key, designs[roomIndex[key]].title.split('｜')[1], coreFor[key]), 0, 'hk-room-' + key);
    for (const connection of designs[0].space.spatial.connections) { const from = connection.from.slice(-1), to = connection.to.slice(-1), owner = roomScenes[from], object = prototypeSource(owner, designs).objects.find(o => o.id === connection.fromObjectId); port(owner, object.name, to, connection.name, connection.condition === 'shortcutOpen' ? '已经在远岸打开永久近路。' : connection.condition); }
    s = roomScenes.A; port(s, '长椅', 'bench', '坐下休息'); note(s, '先前往静默试炼获得冲刺，或到裂隙近岸观察门槛。'); row(s, [['坐长椅', 'bench'], ['前往静默试炼', 'B'], ['观察裂隙', 'C'], ['查看地图', 'map']]);
    s = roomScenes.B; port(s, '冲刺印记', 'dash', '拾取冲刺', '本次静默试炼已经完成。'); note(s, '完成守碑虫试炼，获得永久能力。'); row(s, [['演示通过试炼', 'dash'], ['演示死亡', 'death'], ['返回回廊', 'A', '试炼门未封闭。'], ['查看地图', 'map']]);
    s = roomScenes.C; port(s, '永久近路拉杆', 'shortcut', '拉下拉杆', '已经使用冲刺抵达远岸。'); note(s, '六格尖刺沟把近岸与远岸分开；能力不足时记下位置。'); row(s, [['冲刺到远岸', 'shortcut', '已经获得永久冲刺，并能完成这次越沟。'], ['前往首领门', 'D', '已经抵达远岸。'], ['回去寻找能力', 'B'], ['查看地图', 'map']]);
    s = roomScenes.D; port(s, '遗壳守卫', 'boss2', '进入二阶段', '首领生命已经降到阶段阈值。'); note(s, '冲刺斩击 → 跃砸 → 恢复窗口；在恢复期攻击或聚焦。'); row(s, [['演示二阶段', 'boss2'], ['演示死亡', 'death'], ['撤回裂隙', 'C', '战斗门未封闭。'], ['查看地图', 'map']]);
    page('bench', '长椅 · 休息与重生点', 'hk-core-combat-recover', ['状态恢复，长椅成为下一次重生位置。', '普通敌人重置，已获得的冲刺与永久近路保留。'], [['离开长椅', 'A'], ['区域地图', 'map'], ['返回主界面', 'menu']]);
    page('dash', '能力获得 · 永久冲刺', 'hk-core-growth-unlock', ['静默试炼完成，获得冲刺能力。', '带着新能力返回裂隙，尝试跨越六格尖刺沟。'], [['前往裂隙门槛', 'C'], ['返回篝台回廊', 'A']]);
    page('shortcut', '远岸 · 打开永久近路', 'hk-core-routes-open', ['拉杆落下，回廊与远岸之间的近路打开。', '这条路径不会因为坐长椅或死亡关闭。'], [['前往遗壳守卫', 'D'], ['沿近路回长椅', 'A'], ['查看地图', 'map']]);
    s = space(scene('boss2', '遗壳守卫 · 第二阶段', 'hk-core-combat-fight'), 0, 'hk-room-D'); note(s, '第二阶段：恢复窗口缩短，继续观察招式并选择输出时机。'); row(s, [['演示击败首领', 'victory'], ['演示死亡', 'death']]);
    page('death', '倒下 · 留下残影', 'hk-core-combat-recover', ['在最近使用的长椅重生。', '能力和永久近路保留，失落资源等待残影回收。', '接下来可以回到失落地点，也可以先重新准备。'], [['从长椅再出发', 'bench'], ['演示抵达残影', 'shade']]);
    s = space(scene('shade', '裂隙远岸 · 残影回收', 'hk-core-combat-recover'), 0, 'hk-room-C'); note(s, 'D 门外回收点 · 找回残影，恢复失落资源。'); port(s, 'D门外回收点', 'recovered', '回收残影'); row(s, [['演示回收成功', 'recovered'], ['退回长椅', 'bench']]);
    page('recovered', '残影已回收', 'hk-core-combat-reward', ['失落资源恢复，可以再次尝试首领。', '每次挑战都从已有能力与已打开的路径继续。'], [['再战遗壳守卫', 'D'], ['回到地图', 'map']]);
    page('victory', '遗壳守卫倒下', 'hk-core-combat-reward', ['领取唯一奖励，出口石碑显露出新的道路。', '已击败首领不会在本原型中重生。'], [['从石碑离开', 'complete'], ['返回区域探索', 'map']]);
    page('complete', '裂隙回路 · 探索完成', 'hk-core-root-explore', ['长椅、试炼、冲刺门槛、近路与首领连成了一次探索。', '可以返回区域检查遗漏，或从主界面再次体验。'], [['返回区域地图', 'map'], ['返回主界面', 'menu']]);
  }

  if (slug === 'disco-elysium') {
    menu('de-core-root-entry', '在盐雾散去之前，让证据自己说话。', [['开始新调查', 'detective'], ['继续调查示例', 'hotel']]);
    page('detective', '建立侦探 · 接下疑案', 'de-core-root-new', ['你在旧灯旅馆醒来。搭档林恩递来一份港区事故报告。', '健康与士气都需要照顾；随身衣物会改变检定准备。', '两天内走访现场和人物，形成有依据的阶段报告。'], [['与林恩接案', 'hotel'], ['返回主界面', 'menu']]);
    let s = space(scene('hotel', '旧灯旅馆 · 调查入口', 'de-core-investigate-hub'), 0, 'de-room-hotel');
    port(s, '搭档林恩', 'report', '案情汇报'); port(s, '店主玛拉', 'host', '与玛拉交谈'); note(s, '第 1 日 08:00 · 从现场、人物和时间记录交叉验证。'); row(s, [['选择调查地点', 'map'], ['与玛拉交谈', 'host'], ['思想柜', 'thought'], ['日程与休息', 'schedule'], ['案情汇报', 'report']]);
    s = scene('map', '港区地图 · 选择调查方向', 'de-core-explore-entry');
    [['hotel', '旧灯旅馆', '林恩 / 玛拉 / 住宿', 85, 130], ['yard', '卸货后院', '断绳 / 家书', 475, 130], ['pier', '盐雾码头', '埃达 / 维克', 865, 130], ['archive', '值班档案室', '诺拉 / 停机账册', 280, 365], ['clinic', '夜班诊所', '赛尔 / 复写旁证', 670, 365]].forEach(([key, title, sub, x, y]) => { button(s, title, key, x, y, 330, 100); text(s, sub, x, y + 110, 330, 36, 20, gold); }); row(s, [['线索记录', 'clues'], ['回旅馆', 'hotel'], ['主界面', 'menu']]);
    s = space(scene('yard', '卸货后院 · 观察现场', 'de-core-explore-observe'), 0, 'de-room-yard'); port(s, '磨损绳端', 'rope-check', '检查绳端'); port(s, '未寄出的家书', 'letter', '查看家书'); note(s, '事实、解释与个人猜测应分别记录。'); row(s, [['耐力检定：检查断绳', 'rope-check'], ['查看未寄出的家书', 'letter'], ['回到地图', 'map']]);
    page('rope-check', '白色检定 · 检查断绳', 'de-core-checks-prepare', ['耐力 · 难度 9 · 两颗骰子与有效技能共同决定结果。', '首次装备旧围巾可改善准备，并解锁一次重试。', '此处选择结果分支，查看不同后果如何继续调查。'], [['演示检定成功', 'rope-success'], ['演示检定失败', 'white-fail'], ['暂时离开', 'yard']]);
    page('rope-success', '现场证据 · 断裂绳端', 'de-core-explore-record', ['观察事实：断口有长期磨损。', '推论限制：这不能单独证明谁操作了设备。', '需要与账册、证词或维修记录进一步核对。'], [['记录并找证人', 'pier'], ['去档案室核对', 'archive'], ['打开线索记录', 'clues']]);
    page('white-fail', '白检定失败 · 换一种准备', 'de-core-checks-retry', ['你被现场气味击退，健康下降。', '这次检定暂时锁定；提升耐力或首次装备围巾后再尝试。', '也可以先去其他地点取得旁证。'], [['整理衣物后再试', 'rope-check', '首次装备围巾，或耐力已提升，满足白检定重试来源。'], ['改走其他线索', 'map'], ['去诊所', 'clinic']]);
    page('letter', '支线 · 未寄出的家书', 'de-core-explore-record', ['信封上保留着收信地址，纸张边角已经磨损。', '这是寻找物主与收信人的线索，不作为事故责任证据。', '帮助送信可以改善住宿问题与搭档关系。'], [['找玛拉核对收信人', 'host'], ['先继续调查', 'map']]);
    s = space(scene('pier', '盐雾码头 · 两种说法', 'de-core-dialogue-entry'), 0, 'de-room-pier'); port(s, '装卸工埃达', 'witness', '询问埃达'); port(s, '工头维克', 'foreman', '对峙维克'); note(s, '埃达担心失去工作；维克回避设备维修记录。'); row(s, [['安抚埃达', 'witness'], ['与维克对峙', 'foreman'], ['查看证据记录', 'clues'], ['回地图', 'map']]);
    page('witness', '埃达 · 技能声音与选择', 'de-core-dialogue-voice', ['埃达：我已经把知道的都说了。别再问那台机器。', '共情：她怕的也许是明天能不能继续上工。', '权威：你可以施压，但证词不应该由恐惧替你决定。'], [['温和追问，演示成功', 'testimony'], ['演示共情失败', 'witness-fail'], ['先拿账册再回来', 'archive']]);
    page('testimony', '证词 · 事故前仍在运转', 'de-core-dialogue-result', ['埃达承认：事故前，设备仍然在运转。', '口供需要与断绳和时间记录交叉验证。', '搭档认可这次询问方式，但不会自动替你完成报告。'], [['整理线索', 'clues'], ['继续询问工头', 'foreman'], ['返回码头', 'pier']]);
    page('witness-fail', '询问受阻 · 白检定待重试', 'de-core-checks-failure', ['埃达不愿继续说话，你的士气受到影响。', '首次获得账册或复写件、提升共情，都可能打开新的尝试。'], [['取得旁证后重试', 'witness', '首次取得账册或复写件，或共情已升级。'], ['去档案室', 'archive'], ['回旅馆整理', 'hotel']]);
    page('foreman', '维克 · 红色检定', 'de-core-checks-roll', ['维克：停机记录都是按规矩写的。你究竟想证明什么？', '权威 · 难度 12 · 本次威压不可重复尝试。', '成功与失败都会继续故事，但信任和旁人的反应不同。'], [['演示威压成功', 'red-success'], ['演示威压失败', 'red-fail'], ['不尝试，离开', 'pier']]);
    page('red-success', '维修便条 · 获得替代线索', 'de-core-dialogue-result', ['维克承认曾安排临时维修，交出被撕下的便条。', '这不是完整供认，更不能直接等同于蓄意谋杀。'], [['记录维修便条', 'clues'], ['返回码头', 'pier']]);
    page('red-fail', '冲突后果 · 失败仍可前进', 'de-core-checks-failure', ['对峙失控。埃达被吓到，搭档对你的方式提出异议。', '你仍从争执中发现维修便条；这是一条替代线索。', '本次红检定不能重试，其他调查路径保持开放。'], [['记录后果与便条', 'clues'], ['改走书面证据', 'archive'], ['返回旅馆', 'hotel']]);
    s = space(scene('archive', '值班档案室 · 书面证据', 'de-core-explore-observe'), 0, 'de-room-archive'); port(s, '停机账册', 'ledger', '核对账册', '档案室开放，已与诺拉取得查阅许可。'); note(s, '先取得查阅许可，再核对时间、签名和停机记录。'); row(s, [['演示账册核对成功', 'ledger'], ['档案室关闭，改去诊所', 'clinic'], ['回到地图', 'map']]);
    page('ledger', '停机账册 · 事实与限制', 'de-core-explore-record', ['停机后仍有作业签字，时间记录与口述存在差异。', '签字可以证明违规运行，需要其他材料解释事故经过。', '同一书面证据只记录一次。'], [['带账册询问埃达', 'witness'], ['整理线索', 'clues'], ['前往案情汇报', 'report']]);
    s = space(scene('clinic', '夜班诊所 · 旁证与恢复', 'de-core-investigate-explore'), 0, 'de-room-clinic'); port(s, '送诊复写件', 'copy', '查看复写件'); note(s, '医师赛尔保存了一份转交的时间记录，恢复物价格为 4。'); row(s, [['查看复写旁证', 'copy'], ['演示恢复健康或士气', 'recovery'], ['回到地图', 'map']]);
    page('copy', '复写件 · 第二条取证路线', 'de-core-explore-record', ['医师保留的时间记录与账册相符。', '材料来自转交件，报告中应写明来源。', '它可以作为账册的替代旁证，继续询问证人。'], [['带复写件询问埃达', 'witness'], ['整理线索', 'clues'], ['返回诊所', 'clinic']]);
    page('recovery', '健康与士气 · 恢复窗口', 'de-core-investigate-hub', ['使用一份恢复物恢复所选资源 2 点，不超过当前上限。', '如果没有可用恢复手段，可以暂缓调查，保留未决问题。'], [['演示恢复后继续', 'hotel'], ['无法恢复，暂缓调查', 'pause-ending']]);
    page('host', '玛拉 · 住宿与时间旁证', 'de-core-dialogue-choice', ['玛拉拿出记账时间，指出它与工头口述存在差异。', '付清欠费，或帮助送回家书后，可以在旅馆休息。', '住宿问题影响过夜，但不是认定案件责任的证据。'], [['记下时间旁证', 'clues'], ['安排休息', 'schedule'], ['继续调查', 'map']]);
    page('thought', '思想柜 · 与疑问相处', 'de-core-thoughts-start', ['已发现思想：手上的盐。', '内化需要伴随调查和生活经过时间，不靠反复开关界面完成。', '完成后可影响能力与对话准备；遗忘需要付出成本。'], [['开始内化并继续调查', 'map'], ['演示内化完成', 'thought-done', '该思想所需的有效内化时间已累计完成。'], ['回旅馆', 'hotel']]);
    page('thought-done', '思想完成 · 新的理解方式', 'de-core-thoughts-done', ['思想内化完成，之后的对话可以采用新的视角。', '你仍需要事实佐证自己的解释。'], [['用新视角询问埃达', 'witness'], ['回到思想柜', 'thought'], ['继续调查', 'map']]);
    page('schedule', '日程 · 等待与过夜', 'de-core-clock-choose', ['人物有各自的出现时段，可以等待，也可以换一条调查路径。', '夜间休息需要先解决住宿问题。', '第二天截止时，已有材料进入阶段汇报。'], [['等待半小时再出发', 'map'], ['演示过夜到第二日', 'day2', '住宿已解决，并已进入可休息的时段。'], ['整理报告', 'report']]);
    page('day2', '第二日 · 继续追问', 'de-core-clock-refresh', ['新的日程开始，人物会在新的时段出现。', '已有线索保留，未解决的问题仍等待补证。'], [['继续走访', 'map'], ['提交阶段报告', 'report']]);
    page('clues', '线索记录 · 证据不能代替判断', 'de-core-report-entry', ['现场：断绳长期磨损。书面：停机后仍有作业签字。', '口述：设备仍在运转。替代材料：维修便条、送诊复写件。', '这些是可查阅的示例材料目录；结案时仍需确认本次已取得的证据。', '未经验证的谋杀猜测应作为假说单列。'], [['继续补证', 'map'], ['向林恩汇报', 'report']]);
    page('report', '案情汇报 · 你依据什么？', 'de-core-report-basis', ['向林恩整理事实、来源和仍不确定的部分。', '查明真相：断绳 + 账册或复写件 + 证词或维修便条。', '坚持未经交叉验证的谋杀假说会进入误判分支。', '证据不足时可以暂缓，保留已有线索和未决问题。'], [['查明事故真相', 'truth', '本次已取得断绳、账册或复写件，以及证词或维修便条。'], ['坚持谋杀假说', 'wrong', '已提出人为谋杀假说，并决定坚持这一判断。'], ['暂缓调查', 'pause-ending'], ['继续补证', 'map']]);
    page('truth', '阶段结果 · 查明真相', 'de-core-report-truth', ['设备违规运行导致事故，之后的记录被掩盖。', '报告列明证据来源与推论范围，林恩确认可以提交。'], [['返回主界面', 'menu'], ['回看证据目录', 'clues']]);
    page('wrong', '阶段结果 · 误判结案', 'de-core-report-wrong', ['未经交叉验证的假说被写成了事实。', '林恩在报告上保留异议，这份判断有尚未承担的后果。'], [['重新调查', 'menu'], ['回看判断依据', 'clues']]);
    page('pause-ending', '阶段结果 · 暂缓调查', 'de-core-report-pause', ['调查在这里暂时停下，现有线索和未决问题被保留。', '停下不等于已经查明真相。'], [['返回主界面', 'menu'], ['回顾已有材料', 'clues']]);
  }

  if (slug === 'vampire-survivors') {
    menu('vs-core-root-menu', '活过这场夜色，把收获带回下一局。', [['开始生存', 'character'], ['永久强化', 'meta'], ['图鉴与解锁', 'collection']]);
    let s = scene('character', '选择角色', 'vs-core-root-select');
    [['流浪猎手', ['初始武器：皮鞭', '生命 100 · 移速 3.6', '伤害加成 10%']], ['烛火学者', ['初始武器：寻踪魔杖', '生命 80 · 冷却加成 -10%', '解锁条件：单局达到 10 级']], ['守夜巡卫', ['初始武器：驱散光环', '生命 120 · 护甲 +1', '解锁条件：单局生存 10 分钟']]].forEach(([name, lines], i) => card(s, name, lines, 45 + 415 * i, 155, 390, 365));
    row(s, [['使用流浪猎手', 'stage'], ['查看学者解锁', 'scholar'], ['查看巡卫解锁', 'warden'], ['返回主界面', 'menu']]);
    page('scholar', '角色图鉴 · 烛火学者', 'vs-core-root-collection', ['单局达到 10 级后解锁。', '初始武器：寻踪魔杖；生命 80；冷却加成 -10%。', '可以返回角色页查看其余角色；本套主线以流浪猎手演示。'], [['返回角色页', 'character'], ['体验猎手主线', 'stage']]);
    page('warden', '角色图鉴 · 守夜巡卫', 'vs-core-root-collection', ['单局生存 10 分钟后解锁。', '初始武器：驱散光环；生命 120；护甲 +1。', '可以返回角色页查看其余角色；本套主线以流浪猎手演示。'], [['返回角色页', 'character'], ['体验猎手主线', 'stage']]);
    page('stage', '暮色荒原 · 出发准备', 'vs-core-survival-start', ['本局目标：生存 30 分钟。', '自由移动躲避敌群，武器按自身规则自动攻击。', '六个武器槽、六个被动槽；经验升级时暂停选择。'], [['进入荒原', 'field'], ['调整角色', 'character'], ['查看进化图鉴', 'collection']]);
    s = space(scene('field', '荒原 · 走位与经验拾取', 'vs-core-field-move'), 1); note(s, '00:30 · 等级 1 · 皮鞭 Lv.1 · 生命 100 · 拾取经验后进入升级选择'); port(s, '经验密集区', 'level', '拾取经验'); port(s, '精英宝箱', 'chest', '打开宝箱'); row(s, [['拾取经验并升级', 'level'], ['演示精英宝箱', 'chest'], ['推进到后期怪潮', 'late'], ['暂停', 'pause']]);
    s = scene('level', '升级 · 三选一', 'vs-core-growth-offer');
    [['皮鞭升级', ['提升已有武器等级', '沿最后水平面向挥击']], ['获得寻踪魔杖', ['占用一个空武器槽', '瞄准最近敌人']], ['获得空心之心', ['占用一个空被动槽', '生命上限 +20']]].forEach(([name, lines], i) => card(s, name, lines, 45 + i * 415, 145, 390, 330));
    row(s, [['选择皮鞭升级', 'build-whip'], ['选择寻踪魔杖', 'build-wand'], ['选择空心之心', 'build-heart']], 510); row(s, [['演示重抽', 'reroll'], ['放逐一个候选', 'banish'], ['跳过这次选择', 'field']], 636);
    for (const [key, title, lines] of [['build-whip', '皮鞭升级', ['皮鞭进入下一等级，继续围绕已有武器构筑。', '不会额外占用一个武器槽。']], ['build-wand', '加入寻踪魔杖', ['第二把武器自动锁定附近敌人。', '皮鞭与魔杖在各自冷却完成时分别攻击。']], ['build-heart', '获得空心之心', ['空心之心提高生命上限，也参与皮鞭的进化配方。', '六个被动槽与六个武器槽独立计算。']]]) page(key, title, 'vs-core-growth-apply', lines, [['带着构筑继续生存', 'field'], ['查看进化配方', 'collection'], ['后期构筑示例', 'late']]);
    page('reroll', '升级 · 重抽候选', 'vs-core-growth-manage', ['重抽消耗本次可用次数，重新显示一组合法候选。', '已满槽位时不会提供无法安装的新装备。'], [['选择重抽后的候选', 'level'], ['跳过返回荒原', 'field']]);
    page('banish', '升级 · 放逐候选', 'vs-core-growth-manage', ['将一项不需要的候选移出本局后续候选池。', '当前选择仍需处理完，才会恢复世界时间。'], [['继续这次选择', 'level'], ['跳过返回荒原', 'field']]);
    s = space(scene('chest', '精英宝箱 · 检查进化资格', 'vs-core-chest-check'), 1); note(s, '5 分钟精英宝箱不能进化；10 分钟及之后的合格宝箱再检查配方。'); row(s, [['普通升级奖励', 'chest-normal'], ['演示合格配方进化', 'evolution', '宝箱具备进化资格，皮鞭达到 8 级，且持有至少 1 级空心之心。'], ['先看配方', 'collection']]);
    page('chest-normal', '宝箱 · 持有升级或金币补偿', 'vs-core-chest-normal', ['本次没有满足进化资格或配方。', '对已有装备执行合法升级；无法升级时改为金币补偿。', '宝箱消费后，继续处理奖励队列或返回生存。'], [['继续生存', 'field'], ['推进后期怪潮', 'late']]);
    page('evolution', '武器进化 · 血色长鞭', 'vs-core-chest-evolve', ['皮鞭 Lv.8 + 空心之心 Lv.1 → 血色长鞭。', '进化在原武器槽替换，不新增槽位，也不消耗被动。', '本次奖励结束后，带着进化武器继续战斗。'], [['带进化武器迎接怪潮', 'late'], ['查看其他配方', 'collection']]);
    s = space(scene('late', '荒原 · 后期怪潮', 'vs-core-waves-phase'), 1); note(s, '29:50 · 多武器构筑快照 · 怪潮持续加压，目标是坚持到 30:00'); row(s, [['演示生存达标', 'survived'], ['演示中途阵亡', 'died'], ['再次升级选择', 'level'], ['暂停', 'pause']]);
    page('pause', '暂停 · 本局取舍', 'vs-core-survival-terminal', ['暂停不会推进怪潮时间或自动完成奖励。', '主动放弃只保留拾取金币，不发放时长奖励，不推进成就。'], [['继续生存', 'field'], ['演示主动放弃', 'quit', '确认主动结束当前对局。'], ['查看构筑配方', 'collection']]);
    page('survived', '生存达标 · 30:00', 'vs-core-survival-end', ['30 分钟目标达成，本局通关结果已经锁定。', '无需击杀终场敌人；演出不会改写通关结果。'], [['查看结算明细', 'settlement-win']]);
    page('settlement-win', '通关结算 · 收益带回', 'vs-core-settlement-calc', ['示例：拾取金币 80 + 时长奖励 60 + 通关奖励 100 = 240。', '记录本局最高等级、生存时间与统计，检查角色解锁。', '等级、武器、被动和地面掉落不会带到下一局。'], [['前往永久强化', 'meta'], ['再来一局', 'character'], ['返回主界面', 'menu']]);
    page('died', '中途阵亡 · 带回本局收益', 'vs-core-settlement-in', ['示例：生存 12 分钟，拾取金币 40，时长奖励 24，共 64。', '本局统计参与成就合并；装备和等级在下一局重新开始。'], [['升级永久能力', 'meta'], ['再来一局', 'character'], ['返回主界面', 'menu']]);
    page('quit', '主动放弃 · 结束本局', 'vs-core-settlement-in', ['只带回本局拾取的金币。', '不发放时长奖励，不推进本次成就。', '同一对局的结算不能重复领取。'], [['返回主界面', 'menu'], ['重新选角', 'character']]);
    s = scene('meta', '永久成长 · 为下一局准备', 'vs-core-meta-choose'); card(s, '力量 · 下一档', ['第 1 档价格：50 金币', '伤害加成 +5%', '按档位顺序购买，下一局采用新的开局快照']); row(s, [['演示购买力量一档', 'meta-done', '金币银行不少于 50，且当前尚未购买力量第一档。'], ['查看角色解锁', 'collection'], ['回主界面', 'menu']]);
    page('meta-done', '永久强化已购买', 'vs-core-meta-save', ['力量第一档已写入永久成长快照。', '进入下一局时应用加成，不改写已经结束的对局。'], [['开始下一局', 'character'], ['回主界面', 'menu']]);
    page('collection', '图鉴 · 进化与解锁', 'vs-core-root-collection', ['皮鞭 Lv.8 + 空心之心 → 血色长鞭。', '寻踪魔杖 Lv.8 + 空白之书 → 圣光魔杖。', '守卫圣书 Lv.8 + 咒缚之符 → 永夜圣书。', '单局 10 级解锁烛火学者；生存 10 分钟解锁守夜巡卫。'], [['选择角色', 'character'], ['前往永久强化', 'meta'], ['回到荒原示例', 'field'], ['返回主界面', 'menu']]);
  }
  const store = { schema: 1, entryId: id('menu'), scenes };
  validatePrototypeDesign(store); assert.deepEqual(prototypeIssues(store, designs, example.gameplayCore, example.artAssets), [], slug + ' references');
  return store;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const slug of Object.keys(palettes)) {
    const file = new URL(`../examples/prototypes/${slug}.json`, import.meta.url), example = JSON.parse(await fs.readFile(file, 'utf8'));
    example.prototypeDesign = buildPrototypeScenes(slug, example);
    await fs.writeFile(file, JSON.stringify(example, null, 2) + '\n');
    console.log(`${slug}: ${example.prototypeDesign.scenes.length} scenes, ${example.prototypeDesign.scenes.reduce((n, s) => n + s.elements.length, 0)} elements`);
  }
}
