import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { validatePrototypeExample } from '../src/prototype-import.ts';
const example = validatePrototypeExample(JSON.parse(await fs.readFile(new URL('../examples/prototypes/disco-elysium.json', import.meta.url), 'utf8')));
const data = example.data.datasets;
const table = name => data['de_' + name];
const find = (name, id) => { const row = table(name).find(row => row.id === id); assert.ok(row, name + '/' + id); return row; };
const flags = new Set(table('world_state').map(row => row.id));
const skills = new Set(table('skills').map(row => row.id));
const initial = () => Object.fromEntries(table('world_state').map(row => [row.id, Number(row.initial)]));
function allowed(option, state, levels = {}) {
  return JSON.parse(option.condition).every(c => {
    const v = c.state ? state[c.state] : levels[c.skill] ?? Number(find('skills', c.skill).base);
    return { eq: () => v === c.value, neq: () => v !== c.value, gt: () => v > c.value, gte: () => v >= c.value, lt: () => v < c.value, lte: () => v <= c.value }[c.op]();
  });
}
function apply(raw, state) { for (const e of JSON.parse(raw)) state[e.state] = e.op === 'set' ? e.value : state[e.state] + e.value; }
// These are declarative design walkthroughs, not an implementation of the planned game runtime.
function step(id, state, result) {
  const option = find('dialogue_options', id); assert.ok(allowed(option, state), id + ' is unavailable');
  let target = option.target;
  if (option.check) {
    assert.ok(['success', 'failure'].includes(result));
    const check = find('checks', option.check);
    apply(check[result + 'Effects'], state); target = check[result + 'Node'];
  }
  apply(option.effects, state); state.elapsed += Number(option.costSeconds);
  return target;
}
function truthOptions(state) { return table('dialogue_options').filter(o => o.target === 'report_true' && allowed(o, state)); }

test('Disco data has valid conditions, effects, optional IDs, and reachable dialogue nodes', () => {
  assert.equal(example.gameplayCore.graphs.find(g => g.id === example.gameplayCore.rootId).title, '港区疑案：入口到阶段结局');
  assert.equal(new Set(example.gameplayCore.graphs.map(g => g.title)).size, 8, 'Every module needs a distinct descriptive title');
  assert.equal(table('locations').length, 5); assert.equal(table('people').length, 6);
  assert.equal(table('tasks').length, 3); assert.equal(table('outcomes').length, 3);
  for (const row of [...table('dialogue_options'), ...table('dialogue_nodes')]) {
    const conditions = JSON.parse(row.condition); assert.ok(Array.isArray(conditions));
    for (const c of conditions) {
      assert.ok(Boolean(c.state) !== Boolean(c.skill), row.id + ' condition needs one source');
      assert.ok((c.state ? flags : skills).has(c.state || c.skill), row.id + ' condition target');
      assert.ok(['eq','neq','gt','gte','lt','lte'].includes(c.op)); assert.equal(typeof c.value, 'number');
    }
    if (row.voice) assert.ok(skills.has(row.voice));
    if (row.check) find('checks', row.check);
  }
  for (const raw of [...table('dialogue_options').map(o => o.effects), ...table('checks').flatMap(c => [c.successEffects, c.failureEffects])]) {
    for (const e of JSON.parse(raw)) { assert.ok(flags.has(e.state)); assert.ok(['set','add'].includes(e.op)); assert.ok(Number.isFinite(e.value)); }
  }
  const seen = new Set(), pending = table('people').flatMap(p => [p.rootNode, p.entryNode]);
  while (pending.length) {
    const id = pending.pop(); if (seen.has(id)) continue; seen.add(id); find('dialogue_nodes', id);
    for (const option of table('dialogue_options').filter(o => o.source === id)) {
      if (option.check) { const c = find('checks', option.check); pending.push(c.successNode, c.failureNode); }
      else pending.push(option.target);
    }
  }
  assert.deepEqual([...seen].sort(), table('dialogue_nodes').map(n => n.id).sort());
  for (const n of table('dialogue_nodes')) if (!['exit_dialogue','report_true','report_wrong','report_pause'].includes(n.id)) assert.ok(table('dialogue_options').some(o => o.source === n.id), n.id + ' has no explicit continuation');
});

test('cross-examined success and a costly failed-check alternative both reach a truthful report', () => {
  const direct = initial(); direct.elapsed = 32400;
  assert.equal(step('rope_try', direct, 'success'), 'rope_success');
  assert.equal(step('read_ledger', direct, 'success'), 'ledger_success');
  assert.equal(step('testimony_try', direct, 'success'), 'witness_success');
  assert.ok(truthOptions(direct).length); assert.equal(step(truthOptions(direct)[0].id, direct), 'report_true');
  assert.equal(direct.case_closed, 1); assert.equal(truthOptions(direct).length, 0);
  const alternative = initial(); alternative.elapsed = 32400;
  assert.equal(step('rope_try', alternative, 'failure'), 'rope_failure');
  assert.equal(step('partner_rope', alternative), 'rope_success');
  assert.equal(alternative.health, 2);
  assert.equal(step('pressure_try', alternative, 'failure'), 'foreman_failure');
  assert.equal(alternative.note_found, 1); assert.equal(alternative.witness_scared, 1);
  assert.equal(alternative.partner_trust, -1); assert.equal(alternative.morale, 2);
  alternative.elapsed = 64800; // Explicit waiting until the clinic's first evening window.
  step('doctor_copy', alternative);
  assert.equal(alternative.ledger_found, 0); assert.equal(alternative.testimony_found, 0);
  assert.ok(truthOptions(alternative).length); assert.equal(step(truthOptions(alternative)[0].id, alternative), 'report_true');
  assert.ok(alternative.elapsed < 165600);
});

test('a skill opinion cannot create evidence, and all four alternative evidence combinations are authored', () => {
  const state = initial(); step('believe_voice', state);
  assert.equal(state.hypothesis_sabotage, 1); assert.equal(truthOptions(state).length, 0);
  for (const clue of table('clues')) assert.equal(state[clue.state], 0);
  assert.equal(step('wrong_report', state), 'report_wrong');
  const paused = initial(); assert.equal(step('pause_report', paused), 'report_pause');
  for (const written of ['ledger_found','copy_found']) for (const witness of ['testimony_found','note_found']) {
    const state = { ...initial(), rope_found: 1, [written]: 1, [witness]: 1 };
    assert.equal(truthOptions(state).length, 1);
    for (const required of ['rope_found',written,witness]) assert.equal(truthOptions({ ...state, [required]: 0 }).length, 0);
  }
});

test('white retries are not accidentally consumed as one-shot options and red entrances share one event', () => {
  for (const c of table('checks')) {
    assert.ok(['white','red'].includes(c.kind)); assert.ok(Number(c.difficulty) >= 2);
    const options = table('dialogue_options').filter(o => o.check === c.id); assert.ok(options.length);
    for (const o of options) assert.equal(o.once, '0', c.id + ' repeatability must be governed by check state');
    if (c.kind === 'white') assert.match(c.retrySources, /提升/);
    else assert.match(c.retrySources, /永不重试/);
    find('dialogue_nodes', c.successNode); find('dialogue_nodes', c.failureNode);
  }
  assert.equal(table('dialogue_options').filter(o => o.check === 'pressure').length, 2);
  assert.ok(JSON.parse(find('checks','pressure').failureEffects).some(e => e.state === 'note_found' && e.value === 1));
  const capabilities = example.functionalSystems.capabilities;
  assert.match(capabilities.find(c => c.id === 'de-cap-resolve').process, /不单独落盘/);
  assert.match(capabilities.find(c => c.id === 'de-cap-unlock').process, /令牌/);
});

test('two-day schedules, explicit night rest and thought flags use one documented time basis', () => {
  for (const person of table('people')) {
    const schedule = table('schedules').filter(s => s.person === person.id); assert.equal(schedule.length, 2);
    assert.equal(Number(schedule[1].startSeconds) - Number(schedule[0].startSeconds), 86400);
    for (const s of schedule) assert.ok(Number(s.endSeconds) > Number(s.startSeconds));
  }
  const sleep = find('dialogue_options','sleep'); assert.equal(sleep.source,'host_hub'); assert.equal(sleep.action,'rest');
  assert.equal(allowed(sleep,{...initial(),rent_paid:1,elapsed:75599}),false);
  assert.equal(allowed(sleep,{...initial(),rent_paid:1,elapsed:75600}),true);
  assert.equal(allowed(sleep,{...initial(),rent_paid:1,elapsed:86400}),false);
  for (const t of table('thoughts')) {
    assert.ok(flags.has(t.knownState) && flags.has(t.doneState)); assert.ok(Number(t.durationSeconds)>0);
    assert.equal(initial()[t.knownState],0); assert.equal(initial()[t.doneState],0);
  }
  const thoughtOption=find('dialogue_options','thought_option');
  assert.equal(allowed(thoughtOption,initial()),false); assert.equal(allowed(thoughtOption,{...initial(),thought_doubt_done:1}),true);
  const day2=example.gameplay.designs.find(d=>d.id==='de-play-case').timeline;
  assert.match(day2.clock,/86400/); assert.ok(day2.events.some(e=>e.start===79200 && e.duration===0));
  assert.ok(example.gameplay.designs.every(d=>d.timeline.duration<=86400));
});
