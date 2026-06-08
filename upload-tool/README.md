# Artwork Upload Tool

A self-contained, framework-free widget for uploading print artwork with
**client-side preflight**: drag-and-drop upload, a live preview with
**bleed / trim / safe-zone** overlays, automatic **bleed and resolution
checks**, and an **acknowledgement gate** before the customer can submit.

It reproduces the *workflow* of a typical print-shop file uploader (initiate →
select file → preview & check → acknowledge → submit) as original code you own,
with a clean hook to POST the file to your own backend. There is **no
dependency on any third-party print service**.

> The bleed/resolution checks here are a client-side approximation for fast
> customer feedback. They are not a substitute for a real server-side PDF
> preflight (overprint, spot colours, true CMYK, embedded-image DPI). Treat the
> acknowledgement as the customer's sign-off and still preflight on the server.

## Files

| File | Purpose |
|------|---------|
| `js/preflight.js` | Pure, DOM-free check logic (bleed, resolution, aspect). Unit-testable in Node. |
| `js/pdf-inspect.js` | Lazy-loads pdf.js to read PDF page size and render the preview. |
| `js/upload-tool.js` | The UI widget (modal, drag/drop, overlays, checklist, submit). |
| `css/upload-tool.css` | Styles, namespaced under `.sl-ut-*`. Brandable via CSS variables. |
| `index.html` | Working demo / reference wiring. |
| `config.example.js` | Annotated configuration template. |

## Quick start

1. Drop the `upload-tool/` folder into your site (or copy the four asset files).
2. Add a trigger button on your product page and the three script tags:

```html
<link rel="stylesheet" href="/upload-tool/css/upload-tool.css">

<button id="upload-artwork">Upload Artwork</button>

<script src="/upload-tool/js/preflight.js"></script>
<script src="/upload-tool/js/pdf-inspect.js"></script>   <!-- needed only for PDFs -->
<script src="/upload-tool/js/upload-tool.js"></script>
<script>
  SinUploadTool.create({
    trigger: '#upload-artwork',
    spec: { trimWidthIn: 3.5, trimHeightIn: 2.0, bleedIn: 0.0625, safeIn: 0.125 },
    uploadEndpoint: '/api/artwork/upload',   // your endpoint
    fields: { orderId: '12345' }
  });
</script>
```

`pdf.js` is fetched from a CDN on first PDF use. To run fully offline, host
`pdf.min.js` / `pdf.worker.min.js` yourself and update the URLs at the top of
`pdf-inspect.js`.

## How the bleed check works

- **Trim** is the final cut size you configure. The **bleed box** the customer
  should supply is `trim + 2 × bleed` on each axis (e.g. a 3.5×2.0" card with
  0.0625" bleed needs a **3.625 × 2.125"** file). The **safe zone** is
  `trim − 2 × safe`.
- **Raster (JPG/PNG/…):** the tool reads the pixel dimensions, assumes the image
  is meant to fill the bleed box, and computes effective DPI = `pixels ÷ bleed
  inches`. It compares the image's aspect ratio against the bleed box (pass),
  the trim box ("no bleed" warning), or neither (size mismatch fail).
- **PDF:** the tool reads the page box via pdf.js and compares it to the bleed
  box (pass), trim box ("no bleed" warning), rotated (orientation warning), or
  neither (fail). Embedded-image DPI is flagged for server-side review.
- The preview canvas represents the **full bleed area**; the trim and safe-zone
  rectangles are drawn as proportional insets over it.

Tune thresholds with `targetDpi`, `minDpi`, and `tolerancePct` in the spec.

## Configuration

See `config.example.js` for every option with inline notes. Highlights:

| Option | Default | Notes |
|--------|---------|-------|
| `spec.trimWidthIn` / `trimHeightIn` | — | **Required.** Final cut size in inches. |
| `spec.bleedIn` | `0.0625` | Bleed per side. |
| `spec.safeIn` | `0.125` | Safe margin per side. |
| `spec.targetDpi` / `minDpi` | `300` / `150` | Resolution pass / hard-fail thresholds. |
| `accept` | pdf, jpg, jpeg, png, svg, ai, eps, tif, tiff | Allowed extensions. |
| `maxSizeMB` | `100` | Client-side size cap. |
| `uploadEndpoint` | `null` | POST target. If null, the `File` is returned via `onComplete`. |
| `allowOverride` | `true` | Allow submit despite a hard fail (set `false` to block). |
| `acknowledgementText` | (sensible default) | The sign-off copy gating Submit. |

### Callbacks / events

`onFileSelected(file)`, `onPreflight(result)`, `onComplete(res)`,
`onError(err)`, `onOpen()`, `onClose()`. `result.level` is
`pass | warn | fail | info`; `result.checks[]` holds each line item.

## Backend contract

With `uploadEndpoint` set, the widget sends a `multipart/form-data` POST:

| Field | Contents |
|-------|----------|
| `artwork` (configurable via `fieldName`) | the uploaded file |
| `preflight` | JSON string of the preflight result |
| …`fields` | any extra key/values you pass |

Respond `2xx` for success (JSON body is forwarded to `onComplete`); any other
status surfaces through `onError`. Prefer providing a CSRF token via `headers`.

To take over the upload entirely (e.g. presigned S3 PUT), pass an `onSubmit(file,
meta)` returning a promise — the built-in XHR upload is then skipped.

## Using inside React/Vue/etc.

The widget is plain DOM. Instantiate it once (e.g. in `useEffect`/`onMounted`)
with a ref to your button, and call `.open()` / `.close()` as needed. It appends
its own modal to `document.body` and cleans up object URLs on close.
