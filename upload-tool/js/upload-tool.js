/*
 * upload-tool.js — self-contained artwork upload + preflight widget.
 *
 * Flow (mirrors the reference print workflow):
 *   1. Initiate   — a trigger button on the product page opens the tool.
 *   2. Upload     — drag-and-drop or browse for a local file; validate it.
 *   3. Preview    — render the file with trim / bleed / safe overlays and run
 *                   the bleed + resolution preflight checks.
 *   4. Acknowledge— the customer must tick the acknowledgement before the
 *                   Submit button unlocks. Hard failures block unless the spec
 *                   allows an override.
 *
 * Depends on: preflight.js (SinPreflight) and, for PDFs, pdf-inspect.js (SinPdf).
 * No framework required. See README.md for embedding + backend wiring.
 */
(function (root) {
  'use strict';

  var DEFAULT_ACCEPT = ['pdf', 'jpg', 'jpeg', 'png', 'svg', 'ai', 'eps', 'tif', 'tiff'];

  var DEFAULT_ACK =
    'I have reviewed the proof above and confirm my artwork matches the order ' +
    'specification (size, bleed, and content). I understand this preview does ' +
    'not show overprint or colour-profile (CMYK) issues, and I accept ' +
    'responsibility for the file as submitted.';

  // Extensions the browser can render directly as an <img>.
  var BROWSER_IMAGE = { jpg: 1, jpeg: 1, png: 1, svg: 1, gif: 1, webp: 1, bmp: 1 };

  function create(options) {
    return new UploadTool(options);
  }

  function UploadTool(options) {
    this.opt = normalizeOptions(options);
    this.state = resetState();
    this._build();
    this._bindTrigger();
  }

  function normalizeOptions(o) {
    o = o || {};
    var spec = o.spec || {};
    return {
      spec: {
        trimWidthIn: spec.trimWidthIn,
        trimHeightIn: spec.trimHeightIn,
        bleedIn: spec.bleedIn,
        safeIn: spec.safeIn,
        targetDpi: spec.targetDpi,
        minDpi: spec.minDpi,
        tolerancePct: spec.tolerancePct,
        productName: spec.productName || ''
      },
      accept: (o.accept || DEFAULT_ACCEPT).map(lower),
      maxSizeMB: o.maxSizeMB || 100,
      uploadEndpoint: o.uploadEndpoint || null,
      method: o.method || 'POST',
      fieldName: o.fieldName || 'artwork',
      fields: o.fields || {},
      headers: o.headers || {},
      withCredentials: !!o.withCredentials,
      allowOverride: o.allowOverride !== false, // print shops usually allow "at your own risk"
      acknowledgementText: o.acknowledgementText || DEFAULT_ACK,
      trigger: o.trigger || null,
      onOpen: o.onOpen || noop,
      onFileSelected: o.onFileSelected || noop,
      onPreflight: o.onPreflight || noop,
      onSubmit: o.onSubmit || null,       // override the built-in upload if provided
      onComplete: o.onComplete || noop,
      onError: o.onError || noop,
      onClose: o.onClose || noop
    };
  }

  function resetState() {
    return {
      file: null,
      ext: null,
      objectUrl: null,
      art: null,        // intrinsic dimensions handed to preflight
      result: null,     // preflight result
      pdfDoc: null,
      acknowledged: false,
      submitting: false
    };
  }

  UploadTool.prototype._bindTrigger = function () {
    if (!this.opt.trigger) return;
    var els = typeof this.opt.trigger === 'string'
      ? root.document.querySelectorAll(this.opt.trigger)
      : [this.opt.trigger];
    var self = this;
    Array.prototype.forEach.call(els, function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        self.open();
      });
    });
  };

  // ---- DOM construction ----------------------------------------------------

  UploadTool.prototype._build = function () {
    var d = root.document;
    var overlay = el('div', 'sl-ut-overlay', { 'aria-hidden': 'true' });
    var modal = el('div', 'sl-ut-modal', { role: 'dialog', 'aria-modal': 'true',
      'aria-label': 'Upload artwork' });

    // Header
    var header = el('div', 'sl-ut-header');
    var title = el('div', 'sl-ut-title');
    title.textContent = this.opt.spec.productName
      ? 'Upload artwork — ' + this.opt.spec.productName
      : 'Upload artwork';
    var close = el('button', 'sl-ut-close', { type: 'button', 'aria-label': 'Close' });
    close.innerHTML = '&times;';
    header.appendChild(title);
    header.appendChild(close);

    var body = el('div', 'sl-ut-body');

    // --- Step 1: upload ---
    var step1 = el('div', 'sl-ut-step sl-ut-step-upload');
    var drop = el('div', 'sl-ut-dropzone', { tabindex: '0' });
    drop.innerHTML =
      '<div class="sl-ut-drop-icon">⬆</div>' +
      '<div class="sl-ut-drop-main">Drag &amp; drop your artwork here</div>' +
      '<div class="sl-ut-drop-sub">or <span class="sl-ut-link">browse files</span></div>' +
      '<div class="sl-ut-drop-hint"></div>';
    var input = el('input', 'sl-ut-input', { type: 'file' });
    input.setAttribute('accept', this.opt.accept.map(function (e) { return '.' + e; }).join(','));
    drop.querySelector('.sl-ut-drop-hint').textContent =
      'Accepted: ' + this.opt.accept.join(', ').toUpperCase() +
      ' · up to ' + this.opt.maxSizeMB + ' MB';
    step1.appendChild(drop);
    step1.appendChild(input);
    var step1Err = el('div', 'sl-ut-error');
    step1.appendChild(step1Err);

    // --- Step 2: preview + preflight + acknowledge ---
    var step2 = el('div', 'sl-ut-step sl-ut-step-preview');
    var preview = el('div', 'sl-ut-preview');
    var stage = el('div', 'sl-ut-stage');
    var canvas = el('canvas', 'sl-ut-canvas');
    var guides = el('div', 'sl-ut-guides');
    guides.innerHTML =
      '<div class="sl-ut-guide sl-ut-guide-bleed"></div>' +
      '<div class="sl-ut-guide sl-ut-guide-trim"></div>' +
      '<div class="sl-ut-guide sl-ut-guide-safe"></div>';
    stage.appendChild(canvas);
    stage.appendChild(guides);
    preview.appendChild(stage);

    var legend = el('div', 'sl-ut-legend');
    legend.innerHTML =
      '<span class="sl-ut-leg sl-ut-leg-bleed">Bleed</span>' +
      '<span class="sl-ut-leg sl-ut-leg-trim">Trim</span>' +
      '<span class="sl-ut-leg sl-ut-leg-safe">Safe zone</span>' +
      '<label class="sl-ut-toggle"><input type="checkbox" class="sl-ut-guide-toggle" checked> Show guides</label>';
    preview.appendChild(legend);

    var side = el('div', 'sl-ut-side');
    var fileInfo = el('div', 'sl-ut-fileinfo');
    var checklist = el('ul', 'sl-ut-checklist');
    var ack = el('label', 'sl-ut-ack');
    ack.innerHTML =
      '<input type="checkbox" class="sl-ut-ack-box"> ' +
      '<span class="sl-ut-ack-text"></span>';
    ack.querySelector('.sl-ut-ack-text').textContent = this.opt.acknowledgementText;
    side.appendChild(fileInfo);
    side.appendChild(checklist);
    side.appendChild(ack);

    step2.appendChild(preview);
    step2.appendChild(side);

    body.appendChild(step1);
    body.appendChild(step2);

    // Footer
    var footer = el('div', 'sl-ut-footer');
    var back = el('button', 'sl-ut-btn sl-ut-btn-ghost sl-ut-back', { type: 'button' });
    back.textContent = 'Choose a different file';
    var submit = el('button', 'sl-ut-btn sl-ut-btn-primary sl-ut-submit', { type: 'button' });
    submit.textContent = 'Submit artwork';
    submit.disabled = true;
    var progress = el('div', 'sl-ut-progress');
    progress.innerHTML = '<div class="sl-ut-progress-bar"></div>';
    footer.appendChild(progress);
    footer.appendChild(back);
    footer.appendChild(submit);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    d.body.appendChild(overlay);

    // Cache refs
    this.dom = {
      overlay: overlay, modal: modal, close: close,
      step1: step1, step2: step2, drop: drop, input: input, step1Err: step1Err,
      canvas: canvas, stage: stage, guides: guides,
      fileInfo: fileInfo, checklist: checklist,
      ackBox: ack.querySelector('.sl-ut-ack-box'),
      guideToggle: legend.querySelector('.sl-ut-guide-toggle'),
      back: back, submit: submit,
      progress: progress, progressBar: progress.querySelector('.sl-ut-progress-bar')
    };

    this._wireEvents();
  };

  UploadTool.prototype._wireEvents = function () {
    var self = this;
    var dom = this.dom;

    dom.close.addEventListener('click', function () { self.close(); });
    dom.overlay.addEventListener('click', function (e) {
      if (e.target === dom.overlay) self.close();
    });
    root.document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && self._isOpen()) self.close();
    });

    // File picker
    dom.drop.addEventListener('click', function () { dom.input.click(); });
    dom.drop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dom.input.click(); }
    });
    dom.input.addEventListener('change', function () {
      if (dom.input.files && dom.input.files[0]) self._handleFile(dom.input.files[0]);
    });

    // Drag & drop
    ['dragenter', 'dragover'].forEach(function (ev) {
      dom.drop.addEventListener(ev, function (e) {
        e.preventDefault(); e.stopPropagation();
        dom.drop.classList.add('sl-ut-dragging');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dom.drop.addEventListener(ev, function (e) {
        e.preventDefault(); e.stopPropagation();
        dom.drop.classList.remove('sl-ut-dragging');
      });
    });
    dom.drop.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) self._handleFile(f);
    });

    dom.back.addEventListener('click', function () { self._goStep(1); });
    dom.ackBox.addEventListener('change', function () {
      self.state.acknowledged = dom.ackBox.checked;
      self._refreshSubmit();
    });
    dom.guideToggle.addEventListener('change', function () {
      dom.guides.style.display = dom.guideToggle.checked ? '' : 'none';
    });
    dom.submit.addEventListener('click', function () { self._submit(); });
    root.addEventListener('resize', function () {
      if (self._isOpen() && self.state.file) self._renderPreview();
    });
  };

  // ---- open / close / steps ------------------------------------------------

  UploadTool.prototype.open = function () {
    this._reset();
    this.dom.overlay.classList.add('sl-ut-open');
    this.dom.overlay.setAttribute('aria-hidden', 'false');
    root.document.body.classList.add('sl-ut-noscroll');
    this._goStep(1);
    this.opt.onOpen();
  };

  UploadTool.prototype.close = function () {
    this.dom.overlay.classList.remove('sl-ut-open');
    this.dom.overlay.setAttribute('aria-hidden', 'true');
    root.document.body.classList.remove('sl-ut-noscroll');
    this._reset();
    this.opt.onClose();
  };

  UploadTool.prototype._isOpen = function () {
    return this.dom.overlay.classList.contains('sl-ut-open');
  };

  UploadTool.prototype._reset = function () {
    if (this.state.objectUrl) URL.revokeObjectURL(this.state.objectUrl);
    this.state = resetState();
    this.dom.input.value = '';
    this.dom.ackBox.checked = false;
    this.dom.step1Err.textContent = '';
    this.dom.checklist.innerHTML = '';
    this.dom.fileInfo.textContent = '';
    this._setProgress(0, false);
  };

  UploadTool.prototype._goStep = function (n) {
    this.dom.step1.style.display = n === 1 ? '' : 'none';
    this.dom.step2.style.display = n === 2 ? '' : 'none';
    this.dom.back.style.display = n === 2 ? '' : 'none';
    this.dom.submit.style.display = n === 2 ? '' : 'none';
  };

  // ---- file handling -------------------------------------------------------

  UploadTool.prototype._handleFile = function (file) {
    var err = this._validate(file);
    if (err) { this.dom.step1Err.textContent = err; return; }
    this.dom.step1Err.textContent = '';

    if (this.state.objectUrl) URL.revokeObjectURL(this.state.objectUrl);
    this.state.file = file;
    this.state.ext = extOf(file.name);
    this.state.objectUrl = URL.createObjectURL(file);
    this.opt.onFileSelected(file);

    this.dom.fileInfo.innerHTML =
      '<strong>' + escapeHtml(file.name) + '</strong>' +
      '<span>' + this.state.ext.toUpperCase() + ' · ' + humanSize(file.size) + '</span>';

    this._goStep(2);
    var self = this;
    this._inspect().then(function () {
      self._runPreflight();
      self._renderPreview();
    }).catch(function (e) {
      self._runPreflight(e);
      self._renderPreview();
    });
  };

  UploadTool.prototype._validate = function (file) {
    var ext = extOf(file.name);
    if (this.opt.accept.indexOf(ext) === -1) {
      return 'Unsupported file type ".' + ext + '". Accepted: ' +
        this.opt.accept.join(', ').toUpperCase() + '.';
    }
    if (file.size > this.opt.maxSizeMB * 1024 * 1024) {
      return 'File is ' + humanSize(file.size) + ' — the limit is ' +
        this.opt.maxSizeMB + ' MB.';
    }
    if (file.size === 0) return 'That file appears to be empty.';
    return null;
  };

  // Read intrinsic dimensions for preflight.
  UploadTool.prototype._inspect = function () {
    var self = this;
    var ext = this.state.ext;

    if (ext === 'pdf') {
      if (!root.SinPdf) return Promise.reject(new Error('pdf-inspect.js not loaded'));
      return this.state.file.arrayBuffer().then(function (buf) {
        return root.SinPdf.open(buf.slice(0)).then(function (doc) {
          self.state.pdfDoc = doc;
          return root.SinPdf.pageSizeInches(doc, 1).then(function (size) {
            self.state.art = {
              source: 'pdf',
              widthIn: size.widthIn,
              heightIn: size.heightIn,
              pageCount: doc.numPages
            };
          });
        });
      });
    }

    if (BROWSER_IMAGE[ext]) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () {
          self.state.art = {
            source: 'image',
            pxWidth: img.naturalWidth,
            pxHeight: img.naturalHeight
          };
          self._imgEl = img;
          resolve();
        };
        img.onerror = function () { reject(new Error('Could not decode image')); };
        img.src = self.state.objectUrl;
      });
    }

    // ai / eps / tiff: the browser can't decode these client-side. We still
    // accept the upload but can't auto-preview or measure them.
    self.state.art = { source: 'image', unpreviewable: true };
    return Promise.resolve();
  };

  // ---- preflight + preview -------------------------------------------------

  UploadTool.prototype._runPreflight = function (inspectError) {
    var art = this.state.art;
    var checks;

    if (inspectError || (art && art.unpreviewable)) {
      checks = [{
        id: 'preview', label: 'Preview', level: 'info',
        message: inspectError
          ? 'Could not preview this file in the browser. Our team will preflight it after upload.'
          : 'Vector source files (' + this.state.ext.toUpperCase() + ') can\'t be ' +
            'previewed in the browser. Confirm the size/bleed before submitting.'
      }];
      this.state.result = { checks: checks, level: 'info', blocking: false };
    } else {
      this.state.result = root.SinPreflight.evaluate(art, this.opt.spec);
    }

    this.opt.onPreflight(this.state.result);
    this._renderChecklist();
    this._refreshSubmit();
  };

  UploadTool.prototype._renderChecklist = function () {
    var ul = this.dom.checklist;
    ul.innerHTML = '';
    var icons = { pass: '✓', warn: '!', fail: '✕', info: 'i' };
    this.state.result.checks.forEach(function (c) {
      var li = el('li', 'sl-ut-check sl-ut-check-' + c.level);
      li.innerHTML =
        '<span class="sl-ut-check-icon">' + icons[c.level] + '</span>' +
        '<span class="sl-ut-check-body"><strong>' + escapeHtml(c.label) + '</strong>' +
        '<span>' + escapeHtml(c.message) + '</span></span>';
      ul.appendChild(li);
    });
  };

  UploadTool.prototype._renderPreview = function () {
    var self = this;
    var stage = this.dom.stage;
    var maxW = stage.clientWidth || 480;
    var maxH = stage.clientHeight || 360;
    var ext = this.state.ext;

    var done = function (cssW, cssH) { self._placeGuides(cssW, cssH); };

    if (ext === 'pdf' && this.state.pdfDoc) {
      root.SinPdf.renderToCanvas(this.state.pdfDoc, 1, this.dom.canvas, maxW, maxH)
        .then(function (r) { done(r.cssWidth, r.cssHeight); });
      return;
    }

    if (this._imgEl && this.state.art && !this.state.art.unpreviewable) {
      var img = this._imgEl;
      var fit = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
      var dpr = root.devicePixelRatio || 1;
      var cssW = img.naturalWidth * fit, cssH = img.naturalHeight * fit;
      var c = this.dom.canvas;
      c.width = Math.round(cssW * dpr);
      c.height = Math.round(cssH * dpr);
      c.style.width = Math.round(cssW) + 'px';
      c.style.height = Math.round(cssH) + 'px';
      var ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.drawImage(img, 0, 0, cssW, cssH);
      done(cssW, cssH);
      return;
    }

    // Unpreviewable: show a placeholder card sized to the canvas.
    var c2 = this.dom.canvas;
    c2.style.width = '240px';
    c2.style.height = '160px';
    c2.width = 240; c2.height = 160;
    var ctx2 = c2.getContext('2d');
    ctx2.fillStyle = '#f1f3f5';
    ctx2.fillRect(0, 0, 240, 160);
    ctx2.fillStyle = '#868e96';
    ctx2.font = '14px sans-serif';
    ctx2.textAlign = 'center';
    ctx2.fillText('.' + this.state.ext.toUpperCase() + ' — no browser preview', 120, 85);
    this.dom.guides.style.display = 'none';
  };

  // Position the trim/safe guide rectangles over the rendered artwork.
  // The canvas is assumed to represent the full bleed area.
  UploadTool.prototype._placeGuides = function (cssW, cssH) {
    var g = (this.state.result && this.state.result.geometry) ||
      root.SinPreflight.geometry(this.opt.spec);
    if (!g.bleedW || !g.bleedH) { this.dom.guides.style.display = 'none'; return; }

    this.dom.guides.style.display = this.dom.guideToggle.checked ? '' : 'none';
    this.dom.guides.style.width = cssW + 'px';
    this.dom.guides.style.height = cssH + 'px';

    var trimInsetX = (g.bleed / g.bleedW) * cssW;
    var trimInsetY = (g.bleed / g.bleedH) * cssH;
    var safeInsetX = ((g.bleed + g.safe) / g.bleedW) * cssW;
    var safeInsetY = ((g.bleed + g.safe) / g.bleedH) * cssH;

    setBox(this.dom.guides.querySelector('.sl-ut-guide-bleed'), 0, 0, cssW, cssH);
    setBox(this.dom.guides.querySelector('.sl-ut-guide-trim'),
      trimInsetX, trimInsetY, cssW - 2 * trimInsetX, cssH - 2 * trimInsetY);
    setBox(this.dom.guides.querySelector('.sl-ut-guide-safe'),
      safeInsetX, safeInsetY, cssW - 2 * safeInsetX, cssH - 2 * safeInsetY);
  };

  // ---- submit gate + upload ------------------------------------------------

  UploadTool.prototype._refreshSubmit = function () {
    var r = this.state.result;
    var hardBlocked = r && r.blocking && !this.opt.allowOverride;
    var ok = this.state.acknowledged && !hardBlocked && !this.state.submitting;
    this.dom.submit.disabled = !ok;
    this.dom.submit.title = hardBlocked
      ? 'Resolve the failed checks before submitting.'
      : (this.state.acknowledged ? '' : 'Tick the acknowledgement to continue.');
  };

  UploadTool.prototype._submit = function () {
    if (this.dom.submit.disabled) return;
    var self = this;
    var file = this.state.file;
    var meta = {
      spec: this.opt.spec,
      preflight: this.state.result,
      fileName: file.name,
      fileSize: file.size,
      ext: this.state.ext
    };

    this.state.submitting = true;
    this._refreshSubmit();

    // Custom handler takes over entirely.
    if (typeof this.opt.onSubmit === 'function') {
      Promise.resolve(this.opt.onSubmit(file, meta)).then(function (res) {
        self._finish(res);
      }).catch(function (e) { self._fail(e); });
      return;
    }

    // No endpoint configured: hand the File back to the caller and finish.
    if (!this.opt.uploadEndpoint) {
      this.opt.onComplete({ file: file, meta: meta, uploaded: false });
      this._finish({ uploaded: false });
      return;
    }

    this._upload(file, meta);
  };

  UploadTool.prototype._upload = function (file, meta) {
    var self = this;
    var fd = new FormData();
    fd.append(this.opt.fieldName, file, file.name);
    Object.keys(this.opt.fields).forEach(function (k) { fd.append(k, self.opt.fields[k]); });
    fd.append('preflight', JSON.stringify(this.state.result));

    var xhr = new XMLHttpRequest();
    xhr.open(this.opt.method, this.opt.uploadEndpoint, true);
    xhr.withCredentials = this.opt.withCredentials;
    Object.keys(this.opt.headers).forEach(function (h) {
      xhr.setRequestHeader(h, self.opt.headers[h]);
    });

    this._setProgress(0, true);
    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable) self._setProgress(e.loaded / e.total, true);
    };
    xhr.onload = function () {
      self._setProgress(1, true);
      if (xhr.status >= 200 && xhr.status < 300) {
        var body = xhr.responseText;
        try { body = JSON.parse(xhr.responseText); } catch (_) {}
        self.opt.onComplete({ response: body, status: xhr.status, meta: meta, uploaded: true });
        self._finish({ uploaded: true, response: body });
      } else {
        self._fail(new Error('Upload failed (HTTP ' + xhr.status + ')'));
      }
    };
    xhr.onerror = function () { self._fail(new Error('Network error during upload')); };
    xhr.send(fd);
  };

  UploadTool.prototype._finish = function (res) {
    this.state.submitting = false;
    this.dom.submit.textContent = 'Submitted ✓';
    var self = this;
    setTimeout(function () {
      self.dom.submit.textContent = 'Submit artwork';
      self.close();
    }, res && res.uploaded === false ? 250 : 900);
  };

  UploadTool.prototype._fail = function (err) {
    this.state.submitting = false;
    this._setProgress(0, false);
    this.dom.step1Err.textContent = '';
    this.dom.fileInfo.insertAdjacentHTML('beforeend',
      '<div class="sl-ut-error">' + escapeHtml(err.message) + '</div>');
    this._refreshSubmit();
    this.opt.onError(err);
  };

  UploadTool.prototype._setProgress = function (frac, visible) {
    this.dom.progress.style.display = visible ? '' : 'none';
    this.dom.progressBar.style.width = Math.round(frac * 100) + '%';
  };

  // ---- tiny DOM / format helpers ------------------------------------------

  function el(tag, cls, attrs) {
    var e = root.document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }
  function setBox(node, x, y, w, h) {
    node.style.left = x + 'px'; node.style.top = y + 'px';
    node.style.width = Math.max(0, w) + 'px'; node.style.height = Math.max(0, h) + 'px';
  }
  function extOf(name) {
    var i = name.lastIndexOf('.');
    return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
  }
  function lower(s) { return String(s).toLowerCase(); }
  function humanSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    var u = ['KB', 'MB', 'GB'], i = -1, n = bytes;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return (Math.round(n * 10) / 10) + ' ' + u[i];
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function noop() {}

  root.SinUploadTool = { create: create };
})(window);
