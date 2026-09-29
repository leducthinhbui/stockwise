// SIT774 Task 10.3HD - tests for the pdf.js TextItem -> worker-input
// conversion step in public/js/holdings-import.js. A review noted the
// worker's own tests never exercise this step, since the worker only ever
// sees the already-converted { str, x, y, w, h, page } points - the
// transform[4]/[5] flip and the whitespace-only filter live here instead.
//
// Run with: node --test test/

const test = require('node:test');
const assert = require('node:assert/strict');
const { pdfTextItemToPoint } = require('../public/js/holdings-import.js');

test('a normal text run converts x/y/width/height and tags the page number', function () {
  var it = { str: 'CBA', transform: [1, 0, 0, 1, 42, 700], width: 18, height: 10 };
  var point = pdfTextItemToPoint(it, 3, 792);
  assert.deepEqual(point, { str: 'CBA', x: 42, y: 92, page: 3, w: 18, h: 10 });
});

test('y is flipped from pdf.js\'s bottom-up coordinate to a top-down one', function () {
  // A run near the top of a normal-sized page has a large transform[5]
  // (pdf.js measures from the bottom); after the flip it should be a
  // small y (near the top when read as page order).
  var point = pdfTextItemToPoint({ str: 'Statement', transform: [1, 0, 0, 1, 10, 780], width: 60, height: 12 }, 1, 792);
  assert.equal(point.y, 12);
});

test('a whitespace-only run is dropped instead of becoming an empty column', function () {
  var point = pdfTextItemToPoint({ str: '   ', transform: [1, 0, 0, 1, 100, 500], width: 5, height: 10 }, 1, 792);
  assert.equal(point, null);
});

test('an empty string run is dropped the same way', function () {
  var point = pdfTextItemToPoint({ str: '', transform: [1, 0, 0, 1, 100, 500], width: 0, height: 10 }, 1, 792);
  assert.equal(point, null);
});
