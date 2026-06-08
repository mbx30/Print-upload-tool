# Print-upload-tool

A drop-in **artwork upload + preflight** widget for a print-job website:
initiate from a product page, select a local file, preview it with
**bleed / trim / safe-zone** overlays, run automatic **bleed and resolution
checks**, and require an **acknowledgement** before submitting to your backend.

The working code lives in **[`upload-tool/`](./upload-tool/)** — see its
[README](./upload-tool/README.md) for setup, configuration, and the backend
contract. Open `upload-tool/index.html` in a browser for a live demo.

```html
<link rel="stylesheet" href="/upload-tool/css/upload-tool.css">
<button id="upload-artwork">Upload Artwork</button>
<script src="/upload-tool/js/preflight.js"></script>
<script src="/upload-tool/js/pdf-inspect.js"></script>
<script src="/upload-tool/js/upload-tool.js"></script>
<script>
  SinUploadTool.create({
    trigger: '#upload-artwork',
    spec: { trimWidthIn: 3.5, trimHeightIn: 2.0, bleedIn: 0.0625, safeIn: 0.125 },
    uploadEndpoint: '/api/artwork/upload'
  });
</script>
```

## Why this is a fresh build (not the captured archives)

The `*.webarchive` files in this repo are Safari captures of a live print-shop
uploader, kept only as a **UX/spec reference**. That tool is server-driven — the
browser just POSTs files to backend endpoints that render the proof and run the
real preflight — so its captured front-end can't run on another site, and its
code isn't ours to reuse. Instead, `upload-tool/` is an **original, dependency-
light implementation** of the same workflow that runs entirely on your own
stack, with the bleed/resolution checks done client-side (canvas for images,
pdf.js for PDFs) and a clean hook to your upload endpoint.

## Layout

```
upload-tool/
  index.html          demo / reference wiring
  config.example.js   annotated configuration template
  css/upload-tool.css styles (namespaced .sl-ut-*)
  js/preflight.js     pure bleed/resolution/aspect logic (Node-testable)
  js/pdf-inspect.js   pdf.js wrapper (page size + preview render)
  js/upload-tool.js   the UI widget
test/preflight.test.js  Node smoke test for the check logic
```

## Tests

```bash
node test/preflight.test.js
```
