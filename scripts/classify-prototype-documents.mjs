import { validateGameplay } from '../src/gameplay.ts';

// Explicit maintenance only: importing/opening an existing project never calls this.
// Match stable document IDs, preserve user categories and leave unrelated documents alone.
export function classifyPrototypeDocuments(value, templates) {
  validateGameplay(value);
  const next = structuredClone(value), categories = next.categories || [];
  const normalize = name => name.trim().toLocaleLowerCase();
  const assignments = new Map();
  for (const template of templates) {
    validateGameplay(template);
    for (const design of template.designs) {
      const category = template.categories?.find(c => c.id === design.categoryId);
      if (category) assignments.set(design.id, category);
    }
  }
  let count = 0;
  for (const design of next.designs) {
    const expected = assignments.get(design.id);
    if (!expected || categories.some(c => c.id === design.categoryId)) continue;
    let target = categories.find(c => c.id === expected.id) || categories.find(c => normalize(c.name) === normalize(expected.name));
    if (!target) { target = structuredClone(expected); categories.push(target); }
    design.categoryId = target.id;
    count++;
  }
  if (count) next.categories = categories;
  validateGameplay(next);
  return { changed: count > 0, count, store: next };
}
