import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getFeedback, setFeedback,
  nextPantryState, getPantryState, setPantryState, setPantryMany,
  recipeRequiredKeys, canMake
} from '../frost-store.js';

const BASICS = { water:1, salt:1, lemon:1, lime:1 };
const recipe = { no:1, ing: [['oatly','330 ml'], ['self-choc','60 g'], ['salt','pinch',1], ['water','splash']] };

test('getFeedback returns defaults when absent', () => {
  assert.deepEqual(getFeedback({}, 1), { made:false, stars:0, note:'' });
});

test('setFeedback clamps stars and stamps updated, immutably', () => {
  const d0 = {};
  const d1 = setFeedback(d0, 1, { stars: 9, made: true }, 1000);
  assert.equal(d1.recipes['1'].stars, 5);
  assert.equal(d1.recipes['1'].made, true);
  assert.equal(d1.recipes['1'].updated, 1000);
  assert.equal(d1.updated, 1000);
  assert.deepEqual(d0, {}); // original untouched
});

test('setFeedback merges a partial patch onto existing fields', () => {
  let d = setFeedback({}, 2, { stars: 4, note: 'good' }, 1);
  d = setFeedback(d, 2, { made: true }, 2);
  assert.equal(d.recipes['2'].stars, 4);
  assert.equal(d.recipes['2'].note, 'good');
  assert.equal(d.recipes['2'].made, true);
});

test('nextPantryState cycles none -> ordered -> stock -> none', () => {
  assert.equal(nextPantryState('none'), 'ordered');
  assert.equal(nextPantryState('ordered'), 'stock');
  assert.equal(nextPantryState('stock'), 'none');
});

test('setPantryState stores ordered/stock and deletes on none', () => {
  let d = setPantryState({}, 'oatly', 'ordered', 5);
  assert.equal(getPantryState(d, 'oatly'), 'ordered');
  assert.equal(d.pantry.updated, 5);
  d = setPantryState(d, 'oatly', 'none', 6);
  assert.equal(getPantryState(d, 'oatly'), 'none');
  assert.equal('oatly' in d.pantry.items, false);
});

test('setPantryMany bulk-sets keys', () => {
  const d = setPantryMany({}, ['oatly','self-choc'], 'stock', 7);
  assert.equal(getPantryState(d, 'oatly'), 'stock');
  assert.equal(getPantryState(d, 'self-choc'), 'stock');
});

test('recipeRequiredKeys excludes optional items and basics', () => {
  assert.deepEqual(recipeRequiredKeys(recipe, BASICS), ['oatly','self-choc']);
});

test('canMake requires all required keys in stock; ordered does not count', () => {
  let d = setPantryMany({}, ['oatly','self-choc'], 'stock', 1);
  assert.equal(canMake(recipe, d.pantry.items, BASICS), true);
  d = setPantryState(d, 'self-choc', 'ordered', 2);
  assert.equal(canMake(recipe, d.pantry.items, BASICS), false);
});
