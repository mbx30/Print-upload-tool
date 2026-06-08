/*
 * preflight.js — DOM-free print-artwork preflight logic.
 *
 * Pure functions only: feed in the artwork's intrinsic dimensions plus the
 * product specification, get back a list of pass/warn/fail checks. No browser
 * APIs are used here, so this file is unit-testable in Node as well.
 *
 * Concepts (all measurements in inches unless noted):
 *   trim   — the final cut size of the product.
 *   bleed  — extra art that extends past the trim on every side, so the cut
 *            never reveals an unprinted edge. Default 0.0625" each side.
 *   safe   — inner margin; keep important content inside this. Default 0.125".
 *   The full artwork a customer should supply is the BLEED size:
 *            bleedW = trimW + 2*bleed,  bleedH = trimH + 2*bleed.
 */
(function (root) {
  'use strict';

  var DEFAULTS = {
    bleedIn: 0.0625,   // matches the spec observed in the reference tool
    safeIn: 0.125,
    targetDpi: 300,    // print resolution we aim for
    minDpi: 150,       // below this is an automatic failure
    tolerancePct: 3    // how far a dimension/aspect may drift before we complain
  };

  // Derive the full geometry (trim / bleed / safe boxes) from a product spec.
  function geometry(spec) {
    var bleed = num(spec.bleedIn, DEFAULTS.bleedIn);
    var safe = num(spec.safeIn, DEFAULTS.safeIn);
    var trimW = num(spec.trimWidthIn, 0);
    var trimH = num(spec.trimHeightIn, 0);
    return {
      trimW: trimW,
      trimH: trimH,
      bleed: bleed,
      safe: safe,
      bleedW: trimW + 2 * bleed,
      bleedH: trimH + 2 * bleed,
      safeW: Math.max(0, trimW - 2 * safe),
      safeH: Math.max(0, trimH - 2 * safe),
      targetDpi: num(spec.targetDpi, DEFAULTS.targetDpi),
      minDpi: num(spec.minDpi, DEFAULTS.minDpi),
      tolerancePct: num(spec.tolerancePct, DEFAULTS.tolerancePct)
    };
  }

  /*
   * Evaluate an artwork against a spec.
   *
   * art:
   *   source     'image' | 'pdf'
   *   pxWidth    intrinsic pixel width  (raster) — optional for pdf
   *   pxHeight   intrinsic pixel height (raster) — optional for pdf
   *   widthIn    physical width  in inches (pdf page box, or known raster size)
   *   heightIn   physical height in inches
   *   pageCount  number of pages (pdf)
   *
   * Returns { checks: [...], level: 'pass'|'warn'|'fail', blocking: bool }.
   */
  function evaluate(art, spec) {
    var g = geometry(spec);
    var checks = [];

    if (art.source === 'pdf') {
      evaluatePdf(art, g, checks);
    } else {
      evaluateRaster(art, g, checks);
    }

    var level = worstLevel(checks);
    return {
      checks: checks,
      level: level,
      // Hard failures block submission unless the caller allows an override.
      blocking: level === 'fail',
      geometry: g
    };
  }

  // ---- raster (jpg / png / etc.) ------------------------------------------

  function evaluateRaster(art, g, checks) {
    var pw = num(art.pxWidth, 0);
    var ph = num(art.pxHeight, 0);

    if (!pw || !ph) {
      checks.push(mk('dimensions', 'Image dimensions', 'fail',
        'Could not read the image dimensions.'));
      return;
    }

    // Effective DPI assumes the supplied raster is meant to fill the bleed box.
    var dpiW = pw / g.bleedW;
    var dpiH = ph / g.bleedH;
    var effDpi = Math.floor(Math.min(dpiW, dpiH));

    if (effDpi >= g.targetDpi) {
      checks.push(mk('resolution', 'Resolution', 'pass',
        'Effective resolution ' + effDpi + ' DPI (target ' + g.targetDpi + ').'));
    } else if (effDpi >= g.minDpi) {
      checks.push(mk('resolution', 'Resolution', 'warn',
        'Effective resolution is ' + effDpi + ' DPI — below the ' + g.targetDpi +
        ' DPI target. Print may look soft.'));
    } else {
      checks.push(mk('resolution', 'Resolution', 'fail',
        'Effective resolution is only ' + effDpi + ' DPI. Minimum is ' + g.minDpi +
        ' DPI.'));
    }

    // Aspect-ratio / bleed comparison.
    //
    // A flat raster carries no physical size, so we can only compare
    // proportions. When the bleed is small the trim and bleed boxes share
    // nearly the same aspect ratio, which makes "no bleed" indistinguishable
    // from "has bleed" — so we say so rather than guessing.
    var aspectArt = pw / ph;
    var aspectBleed = g.bleedW / g.bleedH;
    var aspectTrim = g.trimW / g.trimH;
    var tol = g.tolerancePct / 100;

    var matchesBleed = within(aspectArt, aspectBleed, tol);
    var matchesTrim = within(aspectArt, aspectTrim, tol);
    var ambiguous = within(aspectBleed, aspectTrim, tol); // trim ≈ bleed proportions

    if (matchesBleed || matchesTrim) {
      if (ambiguous) {
        checks.push(mk('bleed', 'Bleed', 'info',
          'Proportions match the order, but bleed can\'t be confirmed from a flat ' +
          'image. Make sure your file includes ' + fmt(g.bleed) + '" of bleed on ' +
          'every side (' + fmt(g.bleedW) + '" × ' + fmt(g.bleedH) + '" total).'));
      } else if (matchesBleed) {
        checks.push(mk('bleed', 'Bleed', 'pass',
          'Artwork proportions match the full bleed size (' +
          fmt(g.bleedW) + '" × ' + fmt(g.bleedH) + '").'));
      } else {
        checks.push(mk('bleed', 'Bleed', 'warn',
          'Artwork appears sized to the trim (' + fmt(g.trimW) + '" × ' + fmt(g.trimH) +
          '") with no bleed. Add ' + fmt(g.bleed) + '" of bleed on every side.'));
      }
    } else if (within(aspectArt, 1 / aspectBleed, tol) ||
               within(aspectArt, 1 / aspectTrim, tol)) {
      checks.push(mk('bleed', 'Orientation', 'warn',
        'Artwork looks rotated relative to the order (portrait vs landscape). ' +
        'Confirm the orientation is intentional.'));
    } else {
      checks.push(mk('bleed', 'Dimensions', 'fail',
        'Artwork proportions (' + ratio(aspectArt) + ') do not match the ordered ' +
        'size (' + ratio(aspectBleed) + '). Re-export at ' + fmt(g.bleedW) + '" × ' +
        fmt(g.bleedH) + '".'));
    }
  }

  // ---- pdf -----------------------------------------------------------------

  function evaluatePdf(art, g, checks) {
    var w = num(art.widthIn, 0);
    var h = num(art.heightIn, 0);

    if (!w || !h) {
      checks.push(mk('dimensions', 'Page size', 'fail',
        'Could not read the PDF page size.'));
    } else {
      var tol = g.tolerancePct / 100;
      // Page box is expected to equal the bleed size.
      if (within(w, g.bleedW, tol) && within(h, g.bleedH, tol)) {
        checks.push(mk('bleed', 'Bleed', 'pass',
          'PDF page is ' + fmt(w) + '" × ' + fmt(h) + '" — includes full bleed.'));
      } else if (within(w, g.trimW, tol) && within(h, g.trimH, tol)) {
        checks.push(mk('bleed', 'Bleed', 'warn',
          'PDF page is the trim size (' + fmt(w) + '" × ' + fmt(h) + '") with no ' +
          'bleed. Re-export at ' + fmt(g.bleedW) + '" × ' + fmt(g.bleedH) + '".'));
      } else if ((within(w, g.bleedH, tol) && within(h, g.bleedW, tol)) ||
                 (within(w, g.trimH, tol) && within(h, g.trimW, tol))) {
        checks.push(mk('bleed', 'Orientation', 'warn',
          'PDF page looks rotated relative to the order. Confirm orientation.'));
      } else {
        checks.push(mk('bleed', 'Page size', 'fail',
          'PDF page is ' + fmt(w) + '" × ' + fmt(h) + '" but the order needs ' +
          fmt(g.bleedW) + '" × ' + fmt(g.bleedH) + '" (with bleed).'));
      }
    }

    // Multi-page heads-up (a single-sided product expects one page).
    if (num(art.pageCount, 1) > 1) {
      checks.push(mk('pages', 'Pages', 'info',
        'PDF has ' + art.pageCount + ' pages. Confirm each maps to the correct side.'));
    }

    // Raster resolution inside a PDF can't be measured without rasterising and
    // sampling, which we don't do here — flag it as a manual review item.
    checks.push(mk('resolution', 'Resolution', 'info',
      'Embedded image resolution is not auto-checked for PDFs. Ensure raster ' +
      'content is at least ' + g.targetDpi + ' DPI at final size.'));
  }

  // ---- helpers -------------------------------------------------------------

  function mk(id, label, level, message) {
    return { id: id, label: label, level: level, message: message };
  }

  function worstLevel(checks) {
    var rank = { pass: 0, info: 0, warn: 1, fail: 2 };
    var worst = 'pass';
    for (var i = 0; i < checks.length; i++) {
      if (rank[checks[i].level] > rank[worst]) worst = checks[i].level;
    }
    return worst;
  }

  function within(a, b, tol) {
    if (!b) return false;
    return Math.abs(a - b) / b <= tol;
  }

  function num(v, dflt) {
    return (typeof v === 'number' && isFinite(v)) ? v : dflt;
  }

  function fmt(n) {
    return Math.round(n * 1000) / 1000;
  }

  function ratio(r) {
    return Math.round(r * 100) / 100 + ':1';
  }

  var api = { geometry: geometry, evaluate: evaluate, DEFAULTS: DEFAULTS };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;        // Node / tests
  }
  root.SinPreflight = api;        // browser global
})(typeof window !== 'undefined' ? window : this);
