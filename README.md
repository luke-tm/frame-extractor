# FrameExtract

Client-side video frame extractor PWA. Drop a video file, step through every frame, export as PNG / WebP / JPEG — no uploads, no backend, no accounts.

Works entirely in the browser using WebCodecs (iOS Safari 17.4+, Chrome 94+) with a `<video>` element fallback for older engines.

---

## Local development

```bash
npm install
npm run dev          # Vite dev server at http://localhost:5173
```

To also serve the service worker locally:

```bash
npm run build:sw     # outputs public/sw.js via esbuild
npm run dev
```

---

## Production build

```bash
npm run build        # tsc type-check + Vite bundle → dist/
npm run build:sw     # esbuild SW → public/sw.js (copied by Vite)
npm run preview      # serve dist/ locally on :4173
```

### GitHub Pages deploy

Set the repo name in the environment before building if you want the correct base path locally:

```bash
VITE_REPO_NAME=your-repo-name npm run build
```

In CI (GitHub Actions) `GITHUB_ACTIONS=true` is set automatically, and `VITE_REPO_NAME` is sourced from `github.event.repository.name`. The `.github/workflows/deploy.yml` workflow handles this end-to-end on every push to `main`.

**Required GitHub repo settings:**
- Settings → Pages → Source: **GitHub Actions**
- No extra secrets needed — the workflow uses `GITHUB_TOKEN` automatically.

---

## Browser support matrix

| Feature | iOS Safari 17.4+ | iOS Safari 16–17.3 | Chrome 94+ | Firefox 130+ |
|---|---|---|---|---|
| Decode path | WebCodecs | `<video>` fallback | WebCodecs | WebCodecs |
| MP4 / H.264 alpha | ✗ (H.264 has no alpha) | ✗ | ✗ | ✗ |
| HEVC with alpha | ✓ (hardware) | ✗ (fallback, lost) | ✗ (no HEVC) | ✗ |
| WebM VP9 with alpha | ✓ | ✗ (fallback, lost) | ✓ | ✓ |
| Animated GIF alpha | ✓ (ImageDecoder) | ✓ (gifuct-js) | ✓ (ImageDecoder) | ✓ (gifuct-js) |
| PNG export preserves alpha | ✓ | ✗ (compositor composites to black) | ✓ | ✓ |
| WebP export preserves alpha | ✓ | ✗ | ✓ | ✓ |
| Batch ZIP export | ✓ | ✓ | ✓ | ✓ |
| Web Share to Photos | ✓ | ✓ | ✗ | ✗ |
| Offline (PWA) | ✓ | ✓ | ✓ | ✓ |

When the `<video>` fallback path is active, a persistent yellow banner is shown warning that alpha will not be preserved.

---

## Decoder decision tree

```
file selected
│
├─ image/gif?
│   ├─ ImageDecoder available? → gif-imagedecoder (alpha ✓)
│   └─ fallback → gifuct-js (alpha ✓)
│
└─ video (mp4 / mov / webm)
    ├─ VideoDecoder available? → webcodecs path
    │   └─ mp4box demux → EncodedVideoChunk → VideoDecoder
    │       → VideoFrame → OffscreenCanvas → ImageBitmap (alpha ✓)
    └─ fallback → <video> + requestVideoFrameCallback
        → OffscreenCanvas (alpha LOST — banner shown)
```

---

## Alpha preservation — technical detail

On the WebCodecs path:
1. `mp4box.js` demuxes the container into raw `EncodedVideoChunk` objects
2. `VideoDecoder` decodes to `VideoFrame` — the frame retains whatever alpha the codec carries
3. `drawImage(frame, canvas)` on an `OffscreenCanvas` created with `alpha: true` preserves the channel
4. `canvas.toBlob('image/png')` writes the full RGBA data
5. The checkerboard in the UI is a pure CSS background on the *container*, never drawn into the canvas

For JPEG export, alpha is explicitly flattened: `ctx.fillStyle = bgColor; ctx.fillRect(...)` before `drawImage`.

---

## Known iOS Safari quirks

### WebCodecs availability
- Available from **iOS 17.4** (March 2024). Safari 17.0–17.3 have no `VideoDecoder`.
- The app detects this at runtime and falls back silently with a warning banner.

### Memory pressure on 4K / long videos
- iOS limits the total size of decoded frames in GPU memory. On 4K60 clips, you may hit a hard wall around 500–800MB.
- The sliding window decoder (±30 frames) mitigates this, but very long 4K clips may still trigger system-level memory warnings.
- `VideoFrame.close()` is called immediately after `drawImage` to release GPU memory.
- If the decoder crashes mid-stream, the app shows the last successfully decoded frame rather than crashing.

### Variable frame rate (VFR)
- iOS screen recordings and some slo-mo clips are VFR. `mp4box.js` provides per-sample timestamps, so the frame index handles this correctly — but the estimated FPS displayed in the UI will be the average, not per-frame.

### HEVC with alpha
- Only supported on devices with an Apple Silicon or A12+ chip running iOS 17+.
- `VideoDecoder.isConfigSupported()` is checked before attempting to decode; on unsupported devices the app shows an error banner and refuses to decode rather than producing corrupt frames.

### `<input type="file">` and camera roll
- On iOS Safari, `accept="video/*"` triggers the system picker which includes camera roll videos.
- Files selected from iCloud Drive may arrive as unresolved `File` objects until iOS finishes downloading them. The app reads the file as an `ArrayBuffer` stream, which forces the download to complete.

### Service worker scope
- GitHub Pages serves from `/{repo-name}/`. The SW `scope` must match. The `manifest.webmanifest` uses relative paths (`./`) to handle this automatically.

---

## Step-2 alpha verification procedure

To verify alpha is preserved end-to-end before full UI development:

1. Generate a test WebM VP9+alpha clip:
   ```bash
   ffmpeg -f lavfi -i "color=c=0x00000000:size=320x240:rate=10" \
     -vf "geq=r=0:g=128:b=255:a='if(lt(hypot(X-160,Y-120),80),255,0)'" \
     -c:v libvpx -auto-alt-ref 0 -t 1 test-alpha.webm
   ```
   This produces a 10-frame clip: a teal circle on a fully transparent background.

2. Open the app, load `test-alpha.webm`.

3. The checkerboard should be visible outside the circle on the canvas preview.

4. Export frame 0 as PNG. Open the PNG in any image viewer.
   - Pixels outside the circle: `alpha = 0`
   - Pixels inside the circle: `alpha = 255`

5. If transparency is lost (all pixels opaque black outside circle), stop — do not proceed to step 3 of the build order.

---

## File structure

```
src/
  codec/
    detect.ts          Feature detection, decode path selection
    mp4Demuxer.ts      mp4box.js wrapper → EncodedVideoChunk stream
    webCodecsDecoder.ts VideoDecoder with sliding-window cache
    videoElDecoder.ts   <video> + requestVideoFrameCallback fallback
    gifDecoder.ts       ImageDecoder + gifuct-js fallback
    frameIndex.ts       Frame→timestamp table, seek helpers
  export/
    singleFrame.ts      toBlob + download + Web Share API
    batchExport.ts      jszip range export
  ui/
    App.ts              Orchestrator
    Preview.ts          Canvas + checkerboard + touch/keyboard
    Scrubber.ts         Timeline range + frame counter + jump input
    Controls.ts         Step buttons, batch range selector
    ExportPanel.ts      Format/quality/bg picker + export buttons
    WarningBanner.ts    Persistent alpha-lost / HDR / error banners
  sw/
    sw.ts               App-shell service worker (built separately)
  styles/
    main.css            Full design system
  main.ts               Entry point + SW registration
  types.ts              Shared TypeScript types
```

## Stack

| | |
|---|---|
| Build | Vite 8 + TypeScript 6 |
| Demux | mp4box.js |
| GIF fallback | gifuct-js |
| Batch export | jszip |
| SW | Vanilla Cache API (esbuild) |
| Deploy | GitHub Actions → GitHub Pages |
| Target browsers | iOS Safari 17+, Chrome 94+, Firefox 130+ |
