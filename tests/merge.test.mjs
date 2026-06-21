import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyDoc, normalizeDoc, merge, DOC_VERSION } from '../frost-store.js';

test('emptyDoc has the full shape', () => {
  const d = emptyDoc();
  assert.equal(d.version, DOC_VERSION);
  assert.deepEqual(d.recipes, {});
  assert.deepEqual(d.pantry, { updated: 0, items: {} });
});

test('normalizeDoc fills missing parts and coerces types', () => {
  const d = normalizeDoc({ recipes: { '1': { stars: 3, updated: 5 } } });
  assert.deepEqual(d.pantry, { updated: 0, items: {} });
  assert.equal(d.recipes['1'].stars, 3);
});

test('merge keeps the newer recipe entry per recipe number', () => {
  const local = { updated: 10, recipes: { '1': { made:true, stars:5, note:'a', updated:10 } }, pantry:{updated:0,items:{}} };
  const remote = { updated: 20, recipes: { '1': { made:false, stars:2, note:'b', updated:20 } }, pantry:{updated:0,items:{}} };
  const m = merge(local, remote);
  assert.equal(m.recipes['1'].stars, 2);
  assert.equal(m.recipes['1'].note, 'b');
});

test('merge unions recipes present on only one side', () => {
  const local = { recipes: { '1': { stars:5, updated:10 } } };
  const remote = { recipes: { '2': { stars:3, updated:5 } } };
  const m = merge(local, remote);
  assert.equal(m.recipes['1'].stars, 5);
  assert.equal(m.recipes['2'].stars, 3);
});

test('merge takes the newer pantry as a whole object', () => {
  const local = { pantry: { updated: 30, items: { allulose: 'stock' } } };
  const remote = { pantry: { updated: 20, items: { oatly: 'ordered' } } };
  const m = merge(local, remote);
  assert.deepEqual(m.pantry.items, { allulose: 'stock' });
});

test('merge of two empties is an empty doc', () => {
  const m = merge(null, undefined);
  assert.deepEqual(m.recipes, {});
  assert.deepEqual(m.pantry.items, {});
});
