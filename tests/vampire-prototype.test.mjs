import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { validatePrototypeExample } from '../src/prototype-import.ts';
const example = validatePrototypeExample(JSON.parse(await fs.readFile(new URL('../examples/prototypes/vampire-survivors.json', import.meta.url), 'utf8')));
const table = name => example.data.datasets['vs_' + name];
const get = (name, id) => { const row = table(name).find(r => r.id === id); assert.ok(row, name + '/' + id); return row; };
const param = id => Number(get('parameters', id).value);
// These checks validate authored configuration contracts, not a playable game runtime.
test('characters, unlocks and level curves form a complete legal progression', () => {
  assert.equal(example.gameplayCore.graphs.length, 8);
  assert.equal(new Set(example.gameplayCore.graphs.map(g => g.title)).size, 8);
  assert.equal(table('characters').length, 3);
  assert.equal(table('weapons').filter(w => w.form === 'base').length, 6);
  assert.equal(table('passives').length, 6);
  for (const row of table('unlocks')) {
    assert.ok(['bestLevel','bestSurvival','totalKills'].includes(row.metric));
    assert.ok(Number(row.threshold) > 0);
    if (row.kind === 'character') assert.equal(get('characters', row.target).initial, '0');
    else if (row.kind === 'weapon') assert.equal(get('weapons', row.target).baseUnlock, '0');
    else assert.equal(row.kind, 'achievement');
  }
  for (const character of table('characters')) {
    const weapon = get('weapons', character.weapon);
    assert.equal(weapon.form, 'base'); assert.equal(weapon.baseUnlock, '1');
    if (character.initial !== '1') assert.ok(table('unlocks').some(r => r.kind === 'character' && r.target === character.id));
  }
  for (const weapon of table('weapons')) {
    const levels = table('weapon_levels').filter(r => r.weapon === weapon.id);
    assert.deepEqual(levels.map(r => Number(r.level)), Array.from({ length: Number(weapon.maxLevel) }, (_, i) => i + 1));
    for (const row of levels) {
      assert.ok(Number(row.damage) > 0 && Number(row.cooldown) > 0);
      assert.ok(Number.isInteger(Number(row.amount)) && Number(row.amount) >= 1);
      if (weapon.id === 'garlic') assert.equal(row.amount, '1');
    }
  }
  for (const passive of table('passives')) {
    const levels = table('passive_levels').filter(r => r.passive === passive.id);
    assert.equal(levels.length, Number(passive.maxLevel));
    for (const row of levels) assert.ok(Math.abs(Number(row.totalBonus) - Number(row.level) * Number(passive.perLevel)) < .00001);
  }
  assert.equal(table('experience').length, param('level_cap'));
  for (let level = 1; level < param('level_cap'); level++) assert.ok(Number(get('experience', String(level)).nextXp) > 0);
  assert.equal(get('experience', String(param('level_cap'))).nextXp, '0');
});
test('wave intervals cover the run exactly and timeline requests match configuration', () => {
  const waves = table('waves'), timeline = example.gameplay.designs.find(d => d.id === 'vs-play-waves').timeline;
  assert.equal(waves[0].start, '0'); assert.equal(Number(waves.at(-1).end), param('run_seconds'));
  let previousEnd = 0;
  for (const wave of waves) {
    assert.equal(Number(wave.start), previousEnd); previousEnd = Number(wave.end);
    assert.ok(previousEnd > Number(wave.start));
    assert.ok(Number(wave.cap) <= param('enemy_cap'));
    const event = timeline.events.find(e => e.id.endsWith('-' + wave.id)); assert.ok(event);
    assert.equal(event.start, Number(wave.start)); assert.equal(event.interval, Number(wave.interval));
    assert.equal(event.quantity, Number(wave.batch));
    assert.equal(event.start + event.repeat * event.interval, Number(wave.end));
  }
  const phaseAt = t => waves.filter(w => t >= Number(w.start) && t < Number(w.end));
  for (const boundary of [0,149.999,150,300,599.999,600,1799.999]) assert.equal(phaseAt(boundary).length, 1);
  assert.equal(phaseAt(1800).length, 0);
  assert.ok(param('spawn_inner') > Math.hypot(param('camera_half_width'), param('camera_half_height')));
  assert.ok(param('spawn_outer') > param('spawn_inner') && param('cull_radius') > param('spawn_outer'));
});
test('XP drops conserve enemy rewards and cumulative growth rounding is merge-invariant', () => {
  for (const enemy of table('enemies')) {
    const drops = table('drops').filter(d => d.enemy === enemy.id && get('pickups', d.pickup).effect === 'xp');
    assert.ok(drops.every(d => d.probability === '1'));
    assert.equal(drops.reduce((sum,d) => sum + Number(d.quantity) * Number(get('pickups',d.pickup).value), 0), Number(enemy.xp));
  }
  for (const drop of table('drops')) assert.ok(Number(drop.probability) >= 0 && Number(drop.probability) <= 1 && Number(drop.quantity) > 0);
  const credited = chunks => { let raw = 0, total = 0; return chunks.reduce((sum,n) => { raw += n; const next = Math.floor(raw * 1.15); const delta = next-total; total=next; return sum+delta; },0); };
  assert.equal(credited(Array(600).fill(1)), credited([600]));
  assert.equal(credited([1,5,25,3]), credited([34]));
  assert.ok(table('pickups').every(p => p.expires === '0'));
});
const eligible = (event, loadout) => event.canEvolve === '1' ? table('evolutions').filter(r => (loadout[r.base] ?? 0) >= Number(r.weaponLevel) && (loadout[r.passive] ?? 0) >= Number(r.passiveLevel)).sort((a,b) => Number(a.priority)-Number(b.priority)) : [];
test('every evolution is obtainable, requires both ingredients and preserves old chest eligibility', () => {
  const early = get('elite_events','elite_300'), later = get('elite_events','elite_600');
  const ready = {};
  for (const recipe of table('evolutions')) {
    assert.equal(get('weapons',recipe.base).form,'base'); assert.equal(get('weapons',recipe.result).form,'evolved');
    assert.equal(Number(recipe.weaponLevel),Number(get('weapons',recipe.base).maxLevel));
    assert.ok(Number(recipe.passiveLevel) <= Number(get('passives',recipe.passive).maxLevel));
    const loadout = {[recipe.base]:Number(recipe.weaponLevel),[recipe.passive]:Number(recipe.passiveLevel)};
    assert.equal(eligible(later,loadout).length,1);
    assert.equal(eligible(later,{...loadout,[recipe.base]:Number(recipe.weaponLevel)-1}).length,0);
    assert.equal(eligible(later,{...loadout,[recipe.passive]:0}).length,0);
    assert.equal(eligible(early,loadout).length,0); Object.assign(ready,loadout);
  }
  for (const event of table('elite_events')) assert.equal(Number(event.canEvolve), Number(Number(event.spawnAt) >= param('evolution_after')));
  assert.equal(eligible(later,ready)[0].id,'whip_heart');
  assert.equal(new Set(table('evolutions').map(r=>r.priority)).size,table('evolutions').length);
  assert.ok(Object.keys(ready).filter(k=>table('weapons').some(w=>w.id===k)).length <= param('weapon_slots'));
});
test('permanent purchases and distinct outcome formulas are unambiguous', () => {
  const groups = new Set(table('meta_upgrades').map(r=>r.group)); assert.equal(groups.size,6);
  for (const group of groups) {
    const rows = table('meta_upgrades').filter(r=>r.group===group);
    assert.deepEqual(rows.map(r=>Number(r.rank)),[1,2,3]);
    assert.ok(rows.every(r=>Number.isInteger(Number(r.cost)) && Number(r.cost)>0 && Number(r.delta)>0));
  }
  assert.equal(get('outcomes','survived').goldRule,'pickedGold + floor(seconds/60)*2 + 100');
  assert.equal(get('outcomes','died').goldRule,'pickedGold + floor(seconds/60)*2');
  assert.equal(get('outcomes','quit').goldRule,'pickedGold');
  assert.equal(get('outcomes','quit').mergeStats,'0');
  assert.equal(20+Math.floor(300/60)*2,30);
  assert.equal(0+Math.floor(param('run_seconds')/60)*2+100,160);
  assert.ok(160 >= Number(get('meta_upgrades','might_1').cost));
});
test('draft assets and implementation owners cover all designs without fabricated deliveries', () => {
  const usages=example.functionalSystems.usages;
  for (const design of example.gameplay.designs) assert.ok(usages.some(u=>u.gameplayId===design.id));
  const links=example.artAssets.links;
  for (const asset of example.artAssets.assets) assert.ok(links.some(l=>l.assetId===asset.id));
  assert.ok(links.filter(l=>l.assetId==='vs-asset-icon-whip').length >= 3, 'one icon shared by weapon, choice and collection UI');
  assert.equal(example.artAssets.assets.filter(a=>a.versions.length).length,0);
  assert.ok(example.gameplay.designs.every(d=>d.checks.every(c=>c.result==='未测试' && c.actual==='')));
});
