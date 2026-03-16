# massive-sprites

A WebGL / WASM library for rendering, moving, and updating large numbers of sprites, text labels, and polylines at high frequency

![massive-sprites](images/massive-sprites-120.png)

[![Project Status: WIP – Initial development is in progress, but there has not yet been a stable, usable release suitable for the public.](https://www.repostatus.org/badges/latest/wip.svg)](https://www.repostatus.org/#wip)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

[(Japanese language is here/日本語はこちら)](./README_ja.md)

## What is this?

(Documents under constructing!)

You may want to place large numbers of images and labels on top of a logical coordinate system.
You may want to move them smoothly, swap them, fade them, and combine them with polylines.
And you may want a rendering foundation that does not fall apart even when `add / update / remove` is repeated at high frequency.

That is what massive-sprites is built for.

`massive-sprites` can handle the following on an arbitrary 2.5D logical coordinate system:

- Sprite images
- Text labels
- Polylines
- Layered draw ordering
- Cameras and camera auto-tracking
- Picking objects from coordinates
- Easing-based interpolation for almost all parameters
- Distance-based pseudo LOD and scaling
- High-level route modeling through the logical-graph API

Internally, the library uses WebGL and WASM, with a strong focus on cases where a large number of objects must be updated continuously.

Rendering, animation, and interaction logic are separated from the drawing target implementation, so it can also be integrated into other systems that manage WebGL objects directly.
The standard package also includes a wrapper that renders into an HTML Canvas and supports mouse interaction, so it can be integrated into ordinary web pages as well.

The logical-graph API is a high-level computation layer that manages route graphs with explicit topology and lets you place moving entities on top of them.
You define a physical topology in world coordinates, then describe positions as ratios between route endpoints and place or move sprites accordingly.

It can be used for route maps, facility diagrams, topology views, transport systems, traffic flow visualizations, logical graphs, and game-like UI layouts in arbitrary coordinate spaces.
The following is the smallest example that places one sprite on an HTML Canvas:

```typescript
import {
  createObjectCanvasRenderer,
  loadWasmModule,
} from 'massive-sprites';

// Get the existing HTML Canvas element
const canvas = document.getElementById('main-canvas')!;

// Load the WASM module and create the renderer
const wasmModule = await loadWasmModule('/assets/massive-sprites/compute.wasm');
const renderer = createObjectCanvasRenderer(canvas, wasmModule);

// Start the renderer
renderer.start();

// Helper for loading image files by URL
const loadBitmap = async (url: string) =>
  createImageBitmap(await (await fetch(url)).blob());

// Initialize the renderer
await renderer.initializeScope(async () => {
  // Create a texture atlas
  const atlasId = renderer.allocateAtlas();
  // Register an image to render
  const carBitmap = await loadBitmap('/assets/car.png');
  await renderer.registerImage(atlasId, 'car', carBitmap);

  // Wait until the sprite has been added
  await renderer.addSprite(
    {
      sx: { value: 0 },  // World-space position
      sy: { value: 0 },
      elements: [        // Image elements inside the sprite
        {
          imageId: 'car',          // Registered image ID
          scale: { value: 0.25 },  // Image scale
        },
      ],
    },
    true  // Awaitable
  );

  // Automatically move the camera so the sprite fits in view
  renderer.adjustCameraPosition({ interpolation: null });
});
```

The demos show combinations of sprites, text, polylines, tracking, and logical-graph:

![Playground demo](images/demo1.png)

![logical-graph demo](images/demo2.png)

### Key Features

- Can place, update, and remove large numbers of sprites (>10000).
- Can combine multiple images, text labels, borders, and leader lines in a single sprite.
- Supports `surface`, `billboard`, and `billboard_perspective` render modes per element.
- Supports interpolation for movement, rotation, offset, opacity, and scale.
- Can add polylines as independent objects.
- Supports picking, camera events, and HTML Canvas coordinate helpers.
- Supports automatic camera tracking for sprite swarms and distance-based scaling control.
- The logical-graph API enables high-level route search, route rendering, and movement on routes.
- Uses WebGL and WASM to keep rendering fast.

### Requirements

- A modern browser with WebGL support
- A runtime environment with WASM (WebAssembly) support

---

## Installation

The library is available as an npm package:

```bash
npm install massive-sprites
```

---

## Documentation

For detailed documentation and advanced features, please visit our [GitHub repository](https://github.com/kekyo/massive-sprites).

## License

MIT License.
