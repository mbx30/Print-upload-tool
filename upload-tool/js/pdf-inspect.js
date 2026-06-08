/*
 * pdf-inspect.js — thin wrapper over Mozilla's pdf.js (Apache-2.0).
 *
 * Responsibilities:
 *   - lazily load pdf.js from a CDN the first time it's needed,
 *   - open a PDF from an ArrayBuffer,
 *   - report page count and page-box size in inches (for the bleed check),
 *   - render a page onto a <canvas> for the preview.
 *
 * pdf.js exposes the MediaBox via page.view ([x0, y0, x1, y1] in PDF points,
 * where 1 point = 1/72"). For most print-ready PDFs the MediaBox equals the
 * full bleed size, which is exactly what preflight.js wants to compare against.
 */
(function (root) {
  'use strict';

  // Pinned version keeps the worker and main library in lock-step.
  var PDFJS_VERSION = '3.11.174';
  var CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_VERSION;
  var LIB_URL = CDN + '/pdf.min.js';
  var WORKER_URL = CDN + '/pdf.worker.min.js';

  var loading = null;

  // Load pdf.js once; resolve with the global pdfjsLib.
  function ensureLib() {
    if (root.pdfjsLib) return Promise.resolve(root.pdfjsLib);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = LIB_URL;
      s.async = true;
      s.onload = function () {
        if (!root.pdfjsLib) {
          reject(new Error('pdf.js failed to initialise'));
          return;
        }
        root.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
        resolve(root.pdfjsLib);
      };
      s.onerror = function () {
        reject(new Error('Could not load pdf.js from ' + LIB_URL));
      };
      document.head.appendChild(s);
    });
    return loading;
  }

  // Open a PDF document from an ArrayBuffer.
  function open(arrayBuffer) {
    return ensureLib().then(function (pdfjsLib) {
      return pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    });
  }

  // Page-box size of a given page (1-based), returned in inches.
  function pageSizeInches(pdfDoc, pageNum) {
    return pdfDoc.getPage(pageNum || 1).then(function (page) {
      var v = page.view; // [x0, y0, x1, y1] in points
      var rotate = ((page.rotate || 0) % 360 + 360) % 360;
      var wPts = v[2] - v[0];
      var hPts = v[3] - v[1];
      // Honour page rotation so portrait/landscape reads correctly.
      if (rotate === 90 || rotate === 270) {
        var t = wPts; wPts = hPts; hPts = t;
      }
      return { widthIn: wPts / 72, heightIn: hPts / 72 };
    });
  }

  // Render a page onto a canvas, scaled to fit within maxW × maxH (CSS px),
  // accounting for devicePixelRatio so the preview stays crisp.
  function renderToCanvas(pdfDoc, pageNum, canvas, maxW, maxH) {
    return pdfDoc.getPage(pageNum || 1).then(function (page) {
      var base = page.getViewport({ scale: 1 });
      var fit = Math.min(maxW / base.width, maxH / base.height);
      var dpr = root.devicePixelRatio || 1;
      var viewport = page.getViewport({ scale: fit * dpr });

      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      canvas.style.width = Math.round(viewport.width / dpr) + 'px';
      canvas.style.height = Math.round(viewport.height / dpr) + 'px';

      var ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return page.render({ canvasContext: ctx, viewport: viewport }).promise
        .then(function () {
          return { cssWidth: viewport.width / dpr, cssHeight: viewport.height / dpr };
        });
    });
  }

  root.SinPdf = {
    ensureLib: ensureLib,
    open: open,
    pageSizeInches: pageSizeInches,
    renderToCanvas: renderToCanvas,
    version: PDFJS_VERSION
  };
})(window);
