import { predicateMet, type NarrativeCheck } from './story-orchestration.ts';
export function narrativeCheckScore(check: NarrativeCheck, state: Record<string, number>): number {
  const score = state[check.variableId] + check.modifiers.filter(m => predicateMet(m.condition, state)).reduce((n, m) => n + m.value, 0);
  if (!Number.isFinite(score)) throw new Error('检定引用了失效变量'); return score;
}
export function resolveNarrativeCheck(check: NarrativeCheck, state: Record<string, number>, dice: number[]): { score: number; success: boolean } {
  const threshold = check.mode === 'threshold', count = check.diceCount ?? 2, sides = check.diceSides ?? 6;
  if (!threshold && (dice.length !== count || !dice.every(d => Number.isInteger(d) && d >= 1 && d <= sides))) throw new Error(`需要${count}颗骰子，骰点须在1至${sides}之间`);
  const score = narrativeCheckScore(check, state) + (threshold ? 0 : dice.reduce((a, b) => a + b, 0));
  const criticals = !threshold && (check.criticals ?? true);
  return { score, success: criticals && dice.every(d => d === sides) || !(criticals && dice.every(d => d === 1)) && score >= check.difficulty };
}
const distributions = new Map<string, number[]>();
// Dynamic programming over sums, rather than enumerating up to 100^10 outcomes.
export function diceChance(skill: number, difficulty: number, count: number, sides: number, criticals: number): number {
  if (!Number.isFinite(skill) || !Number.isFinite(difficulty) || !Number.isInteger(count) || count < 1 || count > 10 || !Number.isInteger(sides) || sides < 2 || sides > 100 || ![0,1].includes(criticals)) throw new Error('骰子规则无效：1～10 颗、2～100 面，极值规则为 0 或 1');
  const key = count + ':' + sides; let dist = distributions.get(key);
  if (!dist) {
    dist = [1];
    for (let n = 0; n < count; n++) { const next = Array((n + 1) * sides + 1).fill(0); for (let sum = 0; sum < dist.length; sum++) for (let face = 1; face <= sides; face++) next[sum + face] += dist[sum] / sides; dist = next; }
    if (distributions.size >= 64) distributions.delete(distributions.keys().next().value!); distributions.set(key, dist);
  }
  let chance = dist.reduce((p, mass, sum) => p + (skill + sum >= difficulty ? mass : 0), 0);
  if (criticals) { const extreme = sides ** -count; if (skill + count >= difficulty) chance -= extreme; if (skill + count * sides < difficulty) chance += extreme; }
  return Math.max(0, Math.min(1, chance));
}
export function narrativeCheckChance(check: NarrativeCheck, state: Record<string, number>): number {
  const score = narrativeCheckScore(check, state);
  return check.mode === 'threshold' ? +(score >= check.difficulty) : diceChance(score, check.difficulty, check.diceCount ?? 2, check.diceSides ?? 6, +(check.criticals ?? true));
}
