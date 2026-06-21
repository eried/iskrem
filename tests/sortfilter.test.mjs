import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortRecipes, feedbackMatch, setFeedback } from '../frost-store.js';

const R = [
  { no:1, protein:54, kcal:420 },
  { no:2, protein:39, kcal:330 },
  { no:3, protein:27, kcal:315 }
];
// doc: recipe 2 = 5 stars + made; recipe 1 = 3 stars
let doc = {};
doc = setFeedback(doc, 2, { stars:5, made:true }, 10);
doc = setFeedback(doc, 1, { stars:3 }, 11);

test('default sort is ascending by recipe number', () => {
  assert.deepEqual(sortRecipes(R, 'default', doc).map(r => r.no), [1,2,3]);
});

test('rating sort is highest stars first, unrated last, ties by no', () => {
  assert.deepEqual(sortRecipes(R, 'rating', doc).map(r => r.no), [2,1,3]);
});

test('made sort puts made-it recipes first', () => {
  assert.equal(sortRecipes(R, 'made', doc)[0].no, 2);
});

test('protein sort is descending', () => {
  assert.deepEqual(sortRecipes(R, 'protein', doc).map(r => r.no), [1,2,3]);
});

test('kcal sort is ascending', () => {
  assert.deepEqual(sortRecipes(R, 'kcal', doc).map(r => r.no), [3,2,1]);
});

test('feedbackMatch with empty set matches all', () => {
  assert.equal(feedbackMatch(R[0], new Set(), doc), true);
});

test('feedbackMatch made / fav / unrated', () => {
  assert.equal(feedbackMatch({no:2}, new Set(['made']), doc), true);
  assert.equal(feedbackMatch({no:1}, new Set(['made']), doc), false);
  assert.equal(feedbackMatch({no:2}, new Set(['fav']), doc), true);   // 5 stars
  assert.equal(feedbackMatch({no:1}, new Set(['fav']), doc), false);  // 3 stars
  assert.equal(feedbackMatch({no:3}, new Set(['unrated']), doc), true);
  assert.equal(feedbackMatch({no:2}, new Set(['unrated']), doc), false);
});

test('sortRecipes does not mutate the input array', () => {
  const copy = R.slice();
  sortRecipes(R, 'rating', doc);
  assert.deepEqual(R, copy);
});
