/*
 * Smoke tests for the DOM-free preflight logic. Run with: node test/preflight.test.js
 * No test framework needed — just assertions and a tiny summary.
 */
var P = require('../upload-tool/js/preflight.js');

var pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗ ' + msg); }
}
function levelOf(art, spec) { return P.evaluate(art, spec).level; }
function check(art, spec, id) {
  return P.evaluate(art, spec).checks.filter(function (c) { return c.id === id; })[0];
}

// 3.5 x 2.0" card, 0.0625" bleed -> bleed box 3.625 x 2.125"
var card = { trimWidthIn: 3.5, trimHeightIn: 2.0, bleedIn: 0.0625, safeIn: 0.125, targetDpi: 300 };

// --- geometry ---
var g = P.geometry(card);
ok(Math.abs(g.bleedW - 3.625) < 1e-9, 'bleedW = 3.625');
ok(Math.abs(g.bleedH - 2.125) < 1e-9, 'bleedH = 2.125');
ok(Math.abs(g.safeW - 3.25) < 1e-9, 'safeW = 3.25');

// --- raster: correct full-bleed file at 300 DPI passes overall ---
var good = { source: 'image', pxWidth: Math.round(3.625 * 300), pxHeight: Math.round(2.125 * 300) };
ok(levelOf(good, card) === 'pass', 'full-bleed 300dpi raster passes overall');
ok(check(good, card, 'resolution').level === 'pass', 'resolution check passes');

// On a card the bleed is tiny vs the trim, so trim≈bleed proportions: a flat
// raster can't prove bleed either way -> honest "info", not a false pass/warn.
ok(check(good, card, 'bleed').level === 'info', 'card raster bleed is info (ambiguous)');

// --- raster bleed warn/pass on a spec where bleed IS distinguishable ---
// 2x1" trim with 0.25" bleed -> trim aspect 2.0, bleed box 2.5x1.5 aspect 1.667.
var bigBleed = { trimWidthIn: 2.0, trimHeightIn: 1.0, bleedIn: 0.25, safeIn: 0.125, targetDpi: 300 };
var bbBleed = { source: 'image', pxWidth: Math.round(2.5 * 300), pxHeight: Math.round(1.5 * 300) };
var bbTrim  = { source: 'image', pxWidth: Math.round(2.0 * 300), pxHeight: Math.round(1.0 * 300) };
ok(check(bbBleed, bigBleed, 'bleed').level === 'pass', 'full-bleed raster passes (distinguishable)');
ok(check(bbTrim, bigBleed, 'bleed').level === 'warn', 'trim-sized raster warns no-bleed (distinguishable)');

// --- raster: low-res fails ---
var lowRes = { source: 'image', pxWidth: Math.round(3.625 * 100), pxHeight: Math.round(2.125 * 100) };
ok(check(lowRes, card, 'resolution').level === 'fail', '100dpi raster fails resolution');

// --- raster: slightly soft (200 dpi) warns ---
var soft = { source: 'image', pxWidth: Math.round(3.625 * 200), pxHeight: Math.round(2.125 * 200) };
ok(check(soft, card, 'resolution').level === 'warn', '200dpi raster warns resolution');

// --- raster: wrong aspect fails ---
var square = { source: 'image', pxWidth: 1000, pxHeight: 1000 };
ok(levelOf(square, card) === 'fail', 'square raster fails on a card spec');

// --- pdf: full-bleed page passes ---
var pdfGood = { source: 'pdf', widthIn: 3.625, heightIn: 2.125, pageCount: 1 };
ok(check(pdfGood, card, 'bleed').level === 'pass', 'full-bleed PDF passes bleed');

// --- pdf: trim-sized page warns ---
var pdfTrim = { source: 'pdf', widthIn: 3.5, heightIn: 2.0, pageCount: 1 };
ok(check(pdfTrim, card, 'bleed').level === 'warn', 'trim-sized PDF warns no-bleed');

// --- pdf: rotated page warns orientation ---
var pdfRot = { source: 'pdf', widthIn: 2.125, heightIn: 3.625, pageCount: 1 };
ok(check(pdfRot, card, 'bleed').level === 'warn', 'rotated PDF warns orientation');

// --- pdf: multi-page emits info ---
var pdfMulti = { source: 'pdf', widthIn: 3.625, heightIn: 2.125, pageCount: 2 };
ok(!!check(pdfMulti, card, 'pages'), 'multi-page PDF emits a pages note');

// --- pdf: unreadable page size must NOT emit a resolution check (early return fix) ---
var pdfNoSize = { source: 'pdf', widthIn: 0, heightIn: 0, pageCount: 1 };
var pdfNoSizeResult = P.evaluate(pdfNoSize, card);
ok(pdfNoSizeResult.level === 'fail', 'zero-dimension PDF is a fail');
ok(!check(pdfNoSize, card, 'resolution'), 'zero-dimension PDF has no spurious resolution check');
ok(check(pdfNoSize, card, 'dimensions').level === 'fail', 'zero-dimension PDF has dimensions fail check');

// --- pdf: missing widthIn/heightIn (undefined) also early-exits cleanly ---
var pdfUndef = { source: 'pdf', pageCount: 1 };
var pdfUndefResult = P.evaluate(pdfUndef, card);
ok(pdfUndefResult.level === 'fail', 'pdf with no size fields is a fail');
ok(!check(pdfUndef, card, 'bleed'), 'pdf with no size fields has no bleed check');

// --- evaluate: zero-pixel raster fails on dimensions, not resolution ---
var zeroRaster = { source: 'image', pxWidth: 0, pxHeight: 0 };
ok(check(zeroRaster, card, 'dimensions').level === 'fail', 'zero-pixel raster fails dimensions');
ok(!check(zeroRaster, card, 'resolution'), 'zero-pixel raster has no resolution check (returned early)');

console.log((fail ? '✗' : '✓') + ' preflight: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
