/*
 * config.example.js — copy this, rename to config.js, and adjust per product.
 *
 * Every field maps 1:1 to the options accepted by SinUploadTool.create().
 * Only `spec.trimWidthIn` / `spec.trimHeightIn` are truly required; everything
 * else has a sensible default.
 */
window.UPLOAD_TOOL_CONFIG = {
  // The element(s) that open the tool. CSS selector or an element reference.
  trigger: '#upload-artwork',

  // Product specification — drives the bleed/safe overlays and preflight maths.
  spec: {
    productName: '14pt Business Cards',
    trimWidthIn: 3.5,     // final cut width  (inches)  — REQUIRED
    trimHeightIn: 2.0,    // final cut height (inches)  — REQUIRED
    bleedIn: 0.0625,      // bleed each side (default 0.0625")
    safeIn: 0.125,        // safe margin each side (default 0.125")
    targetDpi: 300,       // target print resolution (default 300)
    minDpi: 150,          // below this = hard fail (default 150)
    tolerancePct: 3       // size/aspect tolerance before warning (default 3%)
  },

  // Accepted extensions (note: ai/eps/tif can't preview in-browser but upload fine).
  accept: ['pdf', 'jpg', 'jpeg', 'png', 'svg', 'ai', 'eps', 'tif', 'tiff'],
  maxSizeMB: 100,

  // --- Backend wiring -------------------------------------------------------
  // Where to POST the file. Leave null to receive the File in onComplete and
  // handle the upload yourself.
  uploadEndpoint: '/api/artwork/upload',
  method: 'POST',
  fieldName: 'artwork',                 // multipart field name for the file
  fields: { orderId: '', sku: '' },     // extra multipart fields sent alongside
  headers: {},                          // e.g. { 'X-CSRF-Token': '...' }
  withCredentials: false,               // send cookies cross-origin

  // Allow the customer to submit despite a hard FAIL (print "at your own risk").
  // Set false to hard-block until failures are resolved.
  allowOverride: true,

  // --- Callbacks ------------------------------------------------------------
  onFileSelected: function (file) {},
  onPreflight: function (result) {},     // result.level: pass|warn|fail|info
  onComplete: function (res) {},         // { response, uploaded, meta } or { file, uploaded:false }
  onError: function (err) {},
  onClose: function () {}
};
