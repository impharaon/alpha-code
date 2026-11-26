# App icons

`source/icon.png` is the only hand-authored brand master. The current master was
supplied by the owner on 2026-11-26: a 1024×1024 dark tile with a white robot puppy
(#1784). Preserve that artwork when regenerating; the same source also produces
the in-app brand mark.

## Regenerating

```sh
python3 packages/ui-mac/icons/source/make-icons.py
```

Requires Pillow and macOS `iconutil`. Pillow composites and resamples with LANCZOS
and writes ICO; `iconutil` writes ICNS. No runtime dependency is added to the app.

The generator flattens transparent pixels onto the source tile's background,
scales the entire tile into Apple's 824px content box on a transparent 1024px
canvas, and applies the existing n=5 superellipse. It does not isolate, redraw or
reposition the puppy. The in-app `src/renderer/brand/brand-mark.png` is the same
tile at 256px without the external canvas margin.

At sizes up to 128px, the existing generator adds a one-device-pixel keyline only
if the tile has less than 3:1 contrast against light chrome. The current dark
background measures 15.7:1, so no keyline is drawn.

## Generated channel assets

Each of `dev/`, `beta/` and `prod/` contains the same eight tracked files:

| File | Size | Consumer |
| --- | --- | --- |
| `icon.icns` | Ten variants, 16–1024px | `electron-builder.config.ts` macOS icon |
| `icon.ico` | 16/32/48/64/128/256px | Windows application and installer icons |
| `icon.png` | 1024px | Non-Windows BrowserWindow icon |
| `dock.png` | 512px | Unpackaged macOS Dock icon |
| `32x32.png`, `64x64.png`, `128x128.png`, `128x128@2x.png` | 32/64/128/256px | Linux packaging |

`scripts/copy-icons.ts` copies the selected channel to the ignored
`resources/icons/` directory during prebuild. Do not track that generated copy;
`src/main/codepuppy-generated-icons-hygiene.test.ts` checks this boundary and the
channel copy behavior. The native platform assets remain tracked as inputs to
packaging. Install/release commands are separate from regeneration.
