const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  fmt, mix, stripCommonPrefix, clamp, pixelToTime, longestStemIdx,
} = require('../lib.js');

test('fmt formats seconds as M:SS', () => {
  assert.equal(fmt(0), '0:00');
  assert.equal(fmt(5), '0:05');
  assert.equal(fmt(65), '1:05');
  assert.equal(fmt(3599), '59:59');
});

test('fmt clamps invalid values', () => {
  assert.equal(fmt(NaN), '0:00');
  assert.equal(fmt(-1), '0:00');
  assert.equal(fmt(Infinity), '0:00');
});

test('mix at endpoints returns the input colors', () => {
  assert.equal(mix('#ff0000', '#000000', 0), '#ff0000');
  assert.equal(mix('#ff0000', '#000000', 1), '#000000');
});

test('mix midpoint averages channels', () => {
  assert.equal(mix('#ffffff', '#000000', 0.5), '#808080');
});

test('mix pads short hex output to six digits', () => {
  // Result with leading-zero channels must keep them.
  assert.equal(mix('#000001', '#000003', 0.5), '#000002');
});

test('stripCommonPrefix removes shared prefix and extension', () => {
  const out = stripCommonPrefix(['sas7_Bass.wav', 'sas7_Drums.wav', 'sas7_Vox.wav']);
  assert.deepEqual(out, ['Bass', 'Drums', 'Vox']);
});

test('stripCommonPrefix handles a single name', () => {
  assert.deepEqual(stripCommonPrefix(['only.wav']), ['only']);
});

test('stripCommonPrefix handles an empty list', () => {
  assert.deepEqual(stripCommonPrefix([]), []);
});

test('stripCommonPrefix with no shared prefix keeps full names', () => {
  assert.deepEqual(
    stripCommonPrefix(['alpha.wav', 'beta.wav']),
    ['alpha', 'beta']
  );
});

test('clamp respects bounds', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
});

test('pixelToTime maps pixels to seconds and clamps', () => {
  assert.equal(pixelToTime(0, 100, 60), 0);
  assert.equal(pixelToTime(50, 100, 60), 30);
  assert.equal(pixelToTime(100, 100, 60), 60);
  assert.equal(pixelToTime(150, 100, 60), 60);
  assert.equal(pixelToTime(-10, 100, 60), 0);
});

test('pixelToTime returns 0 for zero width or duration', () => {
  assert.equal(pixelToTime(50, 0, 60), 0);
  assert.equal(pixelToTime(50, 100, 0), 0);
});

test('longestStemIdx picks the longest finite duration', () => {
  assert.equal(longestStemIdx([10, 30, 20]), 1);
  assert.equal(longestStemIdx([5]), 0);
});

test('longestStemIdx ignores non-finite durations', () => {
  assert.equal(longestStemIdx([NaN, 7, Infinity]), 1);
  assert.equal(longestStemIdx([NaN, NaN]), 0);
});
