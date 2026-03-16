// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

import { RUNTIME_SCALING_LIMIT_PRESETS } from './runtime-scaling';

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('demo index html', () => {
  it('contains overlay stage layout with explicit clipping boundary', async () => {
    const htmlPath = resolve(import.meta.dirname, './index.html');
    const html = await readFile(htmlPath, 'utf8');

    expect(html).toContain('id="demo-stage"');
    expect(html).toContain('id="status-panel"');
    expect(html).toContain('id="control-panel"');
    expect(html).toContain('inset: 1rem;');
    expect(html).toContain('overflow: hidden;');
    expect(html).toContain('padding-right: 1.2rem;');
    expect(html).toContain('id="section-runtime"');
    expect(html).toContain('id="section-stats"');
    expect(html).toContain('id="section-sprites"');
    expect(html).toContain('id="section-backdrop"');
    expect(html).toContain('id="sprites-upscaling-to-pot"');
    expect(html).toContain('Upscaling texture to POT (2^n)');
    expect(html).toContain('id="runtime-pick-mask"');
    expect(html).toContain('Pick mask');
    expect(html).toContain('id="atlas-width"');
    expect(html).toContain('id="atlas-height"');
    expect(html).toContain('id="atlas-resolved"');
    expect(html).toContain('id="atlas-max-size"');
    expect(html).toContain('id="section-move"');
    expect(html).toContain('id="section-polyline-outer"');
    expect(html).toContain('id="section-polyline-random"');
    expect(html).toContain('id="section-element-0"');
    expect(html).toContain('id="section-element-1"');
    expect(html).toContain('id="section-element-2"');
    expect(html).toContain(
      '<details class="control-section" id="section-runtime">'
    );
    expect(html).not.toContain(
      '<details class="control-section" id="section-runtime" open>'
    );
    expect(html).toContain(
      '<details class="control-section" id="section-element-0">'
    );
    expect(html).not.toContain(
      '<details class="control-section" id="section-element-0" open>'
    );
    expect(html).toContain(
      '<details class="control-section" id="section-element-1">'
    );
    expect(html).not.toContain(
      '<details class="control-section" id="section-element-1" open>'
    );
    expect(html).toContain(
      '<details class="control-section" id="section-element-2">'
    );
    expect(html).not.toContain(
      '<details class="control-section" id="section-element-2" open>'
    );
    expect(html).toContain('id="section-camera"');
    expect(html).toContain('id="camera-interpolation"');
    expect(html).toContain('id="camera-interaction-interpolation"');
    expect(html).toContain('id="camera-feedforward"');
    expect(html).toContain('id="camera-interaction"');
    expect(html).toContain('id="camera-pan-button"');
    expect(html).toContain('id="camera-pan-alt"');
    expect(html).toContain('id="camera-pan-shift"');
    expect(html).toContain('id="camera-pan-ctrl"');
    expect(html).toContain('id="camera-pan-meta"');
    expect(html).toContain('id="camera-rotate-button"');
    expect(html).toContain('id="camera-rotate-alt"');
    expect(html).toContain('id="camera-rotate-shift"');
    expect(html).toContain('id="camera-rotate-ctrl"');
    expect(html).toContain('id="camera-rotate-meta"');
    expect(html).toContain(
      '<details class="control-section" id="section-stats" open>'
    );
    expect(html.indexOf('id="stats-pick"')).toBeGreaterThan(
      html.indexOf('id="section-control"')
    );
    expect(html.indexOf('id="stats-pick"')).toBeLessThan(
      html.indexOf('id="section-stats"')
    );
    expect(html).toContain('id="stats-fps"');
    expect(html).toContain('id="stats-frame-ms"');
    expect(html).toContain('id="stats-canvas-render-ms"');
    expect(html).toContain('id="stats-sprite-render-ms"');
    expect(html).toContain('id="stats-wasm-ms"');
    expect(html).toContain('id="stats-cpu-ms"');
    expect(html).toContain('id="stats-wasm-ratio"');
    expect(html).toContain('id="stats-pick"');
    expect(html).toContain('id="stats-command-apply-call-ms"');
    expect(html).toContain('id="stats-draw-setup-ms"');
    expect(html).toContain('id="stats-texture-bind-ms"');
    expect(html).toContain('id="stats-opacity-uniform-ms"');
    expect(html).toContain('id="stats-draw-call-ms"');
    expect(html).toContain('id="stats-update-frame-ratio"');
    expect(html).toContain('id="stats-update-queue-delay"');
    expect(html).toContain('id="stats-active-elements"');
    expect(html).toContain('id="stats-draw-calls"');
    expect(html).toContain('id="stats-buffer-resizes"');
    expect(html).toContain('Rolling averages are shown');
    expect(html).toContain('id="move-speed"');
    expect(html).toContain('id="move-speed-value"');
    expect(html).toContain('id="sprite-opacity"');
    expect(html).toContain('id="sprite-opacity-value"');
    expect(html).toContain('id="sprite-opacity-interpolation"');
    expect(html).toContain('id="sprite-opacity-feedforward"');
    expect(html).toContain('id="backdrop-file"');
    expect(html).toContain('id="backdrop-load"');
    expect(html).toContain('id="backdrop-clear"');
    expect(html).toContain('id="backdrop-image-name"');
    expect(html).toContain('id="backdrop-layer-value"');
    expect(html).toContain('<span id="backdrop-layer-value">0</span>');
    expect(html).toContain('id="backdrop-render-mode"');
    expect(html).toContain('id="backdrop-scale"');
    expect(html).toContain('id="backdrop-scale-value"');
    expect(html).toContain('<span id="backdrop-scale-value">1.00x</span>');
    expect(html).toContain('id="backdrop-opacity"');
    expect(html).toContain('id="backdrop-opacity-value"');
    expect(html).toContain('<span id="backdrop-opacity-value">1.00</span>');
    expect(html).toContain('id="backdrop-rotation"');
    expect(html).toContain('id="backdrop-rotation-value"');
    expect(html).toContain('<span id="backdrop-rotation-value">0°</span>');
    expect(html).toContain('id="backdrop-anchor-x"');
    expect(html).toContain('id="backdrop-anchor-x-value"');
    expect(html).toContain('<span id="backdrop-anchor-x-value">0.00</span>');
    expect(html).toContain('id="backdrop-anchor-y"');
    expect(html).toContain('id="backdrop-anchor-y-value"');
    expect(html).toContain('<span id="backdrop-anchor-y-value">0.00</span>');
    expect(html).toContain('id="backdrop-shift-distance"');
    expect(html).toContain('id="backdrop-shift-distance-value"');
    expect(html).toContain('<span id="backdrop-shift-distance-value">0</span>');
    expect(html).toContain('id="backdrop-shift-angle"');
    expect(html).toContain('id="backdrop-shift-angle-value"');
    expect(html).toContain('<span id="backdrop-shift-angle-value">0°</span>');
    expect(html).toContain('id="sprite-visibility-distance"');
    expect(html).toContain('id="sprite-visibility-distance-value"');
    expect(html).toContain(
      '<span id="sprite-visibility-distance-value">Disabled</span>'
    );
    expect(html).toContain('id="polyline-outer-opacity"');
    expect(html).toContain('id="polyline-outer-opacity-value"');
    expect(html).toContain(
      '<span id="polyline-outer-opacity-value">1.00</span>'
    );
    expect(html).toContain('id="polyline-outer-layer"');
    expect(html).toContain('id="polyline-outer-layer-value"');
    expect(html).toContain('<span id="polyline-outer-layer-value">1</span>');
    expect(html).toContain('id="polyline-outer-hue"');
    expect(html).toContain('id="polyline-outer-hue-value"');
    expect(html).toContain('<span id="polyline-outer-hue-value">10°</span>');
    expect(html).toContain('id="polyline-outer-join-correction"');
    expect(html).toContain('<option value="fan5" selected>Fan 5</option>');
    expect(html).toContain('id="polyline-outer-cap-correction"');
    expect(html).toContain('id="polyline-random-join-correction"');
    expect(html).toContain('id="polyline-random-cap-correction"');
    expect(html).toContain('<option value="fan1">Fan 1</option>');
    expect(html).toContain('<option value="fan5" selected>Fan 5</option>');
    expect(html).toContain('id="polyline-random-opacity"');
    expect(html).toContain('id="polyline-random-opacity-value"');
    expect(html).toContain(
      '<span id="polyline-random-opacity-value">1.00</span>'
    );
    expect(html).toContain('id="polyline-random-layer"');
    expect(html).toContain('id="polyline-random-layer-value"');
    expect(html).toContain('<span id="polyline-random-layer-value">2</span>');
    expect(html).toContain('id="polyline-random-hue"');
    expect(html).toContain('id="polyline-random-hue-value"');
    expect(html).toContain('<span id="polyline-random-hue-value">200°</span>');
    expect(html).toContain('<option value="fan5" selected>Fan 5</option>');
    expect(html).toContain('id="interp-move-feedforward"');
    expect(html).toContain('id="interp-move-easing-select"');
    expect(html).toContain('id="element-0-mode"');
    expect(html).toContain('id="element-0-render-mode"');
    expect(html).toContain('id="element-0-shift-interpolation"');
    expect(html).toContain('id="element-0-shift-feedforward"');
    expect(html).toContain('id="element-0-layer"');
    expect(html).toContain('id="element-0-layer-value"');
    expect(html).toContain('<span id="element-0-layer-value">3</span>');
    expect(html).toContain('id="element-0-order"');
    expect(html).toContain('id="element-0-order-value"');
    expect(html).toContain('<span id="element-0-order-value">0</span>');
    expect(html).toContain('id="element-0-scale"');
    expect(html).toContain('id="element-0-scale-value"');
    expect(html).toContain('<span id="element-0-scale-value">1.00x</span>');
    expect(html).toContain('id="element-0-anchor-x"');
    expect(html).toContain('id="element-0-anchor-x-value"');
    expect(html).toContain('<span id="element-0-anchor-x-value">0.00</span>');
    expect(html).toContain('id="element-0-anchor-y"');
    expect(html).toContain('id="element-0-anchor-y-value"');
    expect(html).toContain('<span id="element-0-anchor-y-value">0.00</span>');
    expect(html).toContain('id="element-0-origin-use-resolved-anchor"');
    expect(html).toContain('id="element-0-leaderline-width"');
    expect(html).toContain('id="element-0-leaderline-width-value"');
    expect(html).toContain(
      '<span id="element-0-leaderline-width-value">0.0</span>'
    );
    expect(html).toContain('id="element-0-leaderline-hue"');
    expect(html).toContain('id="element-0-leaderline-hue-value"');
    expect(html).toContain(
      '<span id="element-0-leaderline-hue-value">30°</span>'
    );
    expect(html).toContain('id="element-0-border-width"');
    expect(html).toContain('id="element-0-border-width-value"');
    expect(html).toContain(
      '<span id="element-0-border-width-value">0.00</span>'
    );
    expect(html).toContain('id="element-0-border-hue"');
    expect(html).toContain('id="element-0-border-hue-value"');
    expect(html).toContain('<span id="element-0-border-hue-value">350°</span>');
    expect(html).toContain('id="element-0-scale-interpolation"');
    expect(html).toContain('id="element-0-scale-feedforward"');
    expect(html).toContain('id="element-0-rotation-speed"');
    expect(html).toContain('id="element-0-rotation-speed-value"');
    expect(html).toContain(
      '<span id="element-0-rotation-speed-value">0.0x</span>'
    );
    expect(html).toContain('id="element-0-rotation"');
    expect(html).toContain('id="element-0-opacity"');
    expect(html).toContain('id="element-0-opacity-interpolation"');
    expect(html).toContain('id="element-0-opacity-feedforward"');
    expect(html).toContain('id="element-0-rotation-feedforward"');
    expect(html).toContain('id="element-0-auto-direction-mode"');
    expect(html).toContain('id="element-0-auto-direction-space"');
    expect(html).toContain(
      'id="element-0-auto-direction-shift-angle-rotation"'
    );
    expect(html).toContain('id="element-0-auto-direction-min-distance"');
    expect(html).toContain('id="element-0-auto-direction-min-distance-value"');
    expect(html).toContain('id="element-0-auto-direction-flip-x"');
    expect(html).toContain('id="element-0-auto-direction-flip-y"');
    expect(html).toContain('id="element-0-auto-direction-interpolation"');
    expect(html).toContain('id="element-0-auto-direction-feedforward"');
    expect(html).toMatch(
      /<span id="element-0-auto-direction-min-distance-value"\s*>0\.0<\/span\s*>/
    );
    expect(html).toContain('id="element-1-mode"');
    expect(html).toContain('id="element-1-render-mode"');
    expect(html).toContain('id="element-1-shift-interpolation"');
    expect(html).toContain('id="element-1-shift-feedforward"');
    expect(html).toContain('id="element-1-layer"');
    expect(html).toContain('id="element-1-layer-value"');
    expect(html).toContain('<span id="element-1-layer-value">3</span>');
    expect(html).toContain('id="element-1-order"');
    expect(html).toContain('id="element-1-order-value"');
    expect(html).toContain('<span id="element-1-order-value">0</span>');
    expect(html).toContain('id="element-1-scale"');
    expect(html).toContain('id="element-1-scale-value"');
    expect(html).toContain('<span id="element-1-scale-value">1.00x</span>');
    expect(html).toContain('id="element-1-anchor-x"');
    expect(html).toContain('id="element-1-anchor-x-value"');
    expect(html).toContain('<span id="element-1-anchor-x-value">0.00</span>');
    expect(html).toContain('id="element-1-anchor-y"');
    expect(html).toContain('id="element-1-anchor-y-value"');
    expect(html).toContain('<span id="element-1-anchor-y-value">0.00</span>');
    expect(html).toContain('id="element-1-origin-use-resolved-anchor"');
    expect(html).toContain('id="element-1-leaderline-width"');
    expect(html).toContain('id="element-1-leaderline-width-value"');
    expect(html).toContain(
      '<span id="element-1-leaderline-width-value">0.0</span>'
    );
    expect(html).toContain('id="element-1-leaderline-hue"');
    expect(html).toContain('id="element-1-leaderline-hue-value"');
    expect(html).toContain(
      '<span id="element-1-leaderline-hue-value">140°</span>'
    );
    expect(html).toContain('id="element-1-border-width"');
    expect(html).toContain('id="element-1-border-width-value"');
    expect(html).toContain(
      '<span id="element-1-border-width-value">0.00</span>'
    );
    expect(html).toContain('id="element-1-border-hue"');
    expect(html).toContain('id="element-1-border-hue-value"');
    expect(html).toContain('<span id="element-1-border-hue-value">80°</span>');
    expect(html).toContain('id="element-1-scale-interpolation"');
    expect(html).toContain('id="element-1-scale-feedforward"');
    expect(html).toContain('id="element-1-rotation-speed"');
    expect(html).toContain('id="element-1-rotation-speed-value"');
    expect(html).toContain(
      '<span id="element-1-rotation-speed-value">0.0x</span>'
    );
    expect(html).toContain('id="element-1-rotation"');
    expect(html).toContain('id="element-1-opacity"');
    expect(html).toContain('id="element-1-opacity-interpolation"');
    expect(html).toContain('id="element-1-opacity-feedforward"');
    expect(html).toContain('id="element-1-rotation-feedforward"');
    expect(html).toContain('id="element-1-auto-direction-mode"');
    expect(html).toContain('id="element-1-auto-direction-space"');
    expect(html).toContain(
      'id="element-1-auto-direction-shift-angle-rotation"'
    );
    expect(html).toContain('id="element-1-auto-direction-min-distance"');
    expect(html).toContain('id="element-1-auto-direction-min-distance-value"');
    expect(html).toContain('id="element-1-auto-direction-flip-x"');
    expect(html).toContain('id="element-1-auto-direction-flip-y"');
    expect(html).toContain('id="element-1-auto-direction-interpolation"');
    expect(html).toContain('id="element-1-auto-direction-feedforward"');
    expect(html).toMatch(
      /<span id="element-1-auto-direction-min-distance-value"\s*>0\.0<\/span\s*>/
    );
    expect(html).toContain('id="element-2-mode"');
    expect(html).toContain('id="element-2-render-mode"');
    expect(html).toContain('id="element-2-shift-interpolation"');
    expect(html).toContain('id="element-2-shift-feedforward"');
    expect(html).toContain('id="element-2-layer"');
    expect(html).toContain('id="element-2-layer-value"');
    expect(html).toContain('<span id="element-2-layer-value">3</span>');
    expect(html).toContain('id="element-2-order"');
    expect(html).toContain('id="element-2-order-value"');
    expect(html).toContain('<span id="element-2-order-value">0</span>');
    expect(html).toContain('id="element-2-scale"');
    expect(html).toContain('id="element-2-scale-value"');
    expect(html).toContain('<span id="element-2-scale-value">1.00x</span>');
    expect(html).toContain('id="element-2-anchor-x"');
    expect(html).toContain('id="element-2-anchor-x-value"');
    expect(html).toContain('<span id="element-2-anchor-x-value">0.00</span>');
    expect(html).toContain('id="element-2-anchor-y"');
    expect(html).toContain('id="element-2-anchor-y-value"');
    expect(html).toContain('<span id="element-2-anchor-y-value">0.00</span>');
    expect(html).toContain('id="element-2-origin-use-resolved-anchor"');
    expect(html).toContain('id="element-2-leaderline-width"');
    expect(html).toContain('id="element-2-leaderline-width-value"');
    expect(html).toContain(
      '<span id="element-2-leaderline-width-value">0.0</span>'
    );
    expect(html).toContain('id="element-2-leaderline-hue"');
    expect(html).toContain('id="element-2-leaderline-hue-value"');
    expect(html).toContain(
      '<span id="element-2-leaderline-hue-value">220°</span>'
    );
    expect(html).toContain('id="element-2-border-width"');
    expect(html).toContain('id="element-2-border-width-value"');
    expect(html).toContain(
      '<span id="element-2-border-width-value">0.00</span>'
    );
    expect(html).toContain('id="element-2-border-hue"');
    expect(html).toContain('id="element-2-border-hue-value"');
    expect(html).toContain('<span id="element-2-border-hue-value">200°</span>');
    expect(html).toContain('id="element-2-scale-interpolation"');
    expect(html).toContain('id="element-2-scale-feedforward"');
    expect(html).toContain('id="element-2-rotation-speed"');
    expect(html).toContain('id="element-2-rotation-speed-value"');
    expect(html).toContain(
      '<span id="element-2-rotation-speed-value">0.0x</span>'
    );
    expect(html).toContain('id="element-2-rotation"');
    expect(html).toContain('id="element-2-opacity"');
    expect(html).toContain('id="element-2-opacity-interpolation"');
    expect(html).toContain('id="element-2-opacity-feedforward"');
    expect(html).toContain('id="element-2-rotation-feedforward"');
    expect(html).toContain('id="element-2-auto-direction-mode"');
    expect(html).toContain('id="element-2-auto-direction-space"');
    expect(html).toContain(
      'id="element-2-auto-direction-shift-angle-rotation"'
    );
    expect(html).toContain('id="element-2-auto-direction-min-distance"');
    expect(html).toContain('id="element-2-auto-direction-min-distance-value"');
    expect(html).toContain('id="element-2-auto-direction-flip-x"');
    expect(html).toContain('id="element-2-auto-direction-flip-y"');
    expect(html).toContain('id="element-2-auto-direction-interpolation"');
    expect(html).toContain('id="element-2-auto-direction-feedforward"');
    expect(html).toMatch(
      /<span id="element-2-auto-direction-min-distance-value"\s*>0\.0<\/span\s*>/
    );
    expect(html).toContain('id="element-0-image-mode"');
    expect(html).toContain('id="element-1-image-mode"');
    expect(html).toContain('id="element-2-image-mode"');
    expect(html).toContain('Shift Mode');
    expect(html).toContain('Render Mode');
    expect(html).toContain('Shift Interpolation');
    expect(html).toContain('Shift Feedforward');
    expect(html).toContain('Scale Interpolation');
    expect(html).toContain('Scale Feedforward');
    expect(html).toContain('Anchor X');
    expect(html).toContain('Anchor Y');
    expect(html).toContain('Use Resolved Anchor');
    expect(html).toContain('Rotation Feedforward');
    expect(html).toContain('Opacity Interpolation');
    expect(html).toContain('Opacity Feedforward');
    expect(html).toContain('Rotation');
    expect(html).toContain('Auto Direction Mode');
    expect(html).toContain('Auto Shift Angle Rotation');
    expect(html).toContain('Auto Direction Min Distance');
    expect(html).toContain('Auto Flip X');
    expect(html).toContain('Auto Flip Y');
    expect(html).toContain('Auto Direction Interpolation');
    expect(html).toContain('Opacity');
    expect(html).toContain('<option value="wave">Wave</option>');
    const renderModeSelect0Match = html.match(
      /<select id="element-0-render-mode">([\s\S]*?)<\/select>/
    );
    const billboardPerspectiveOptionPattern =
      /<option value="billboard_perspective">\s*Billboard \(Perspective\)\s*<\/option>/;
    expect(renderModeSelect0Match?.[1]).toMatch(
      billboardPerspectiveOptionPattern
    );
    const renderModeSelect1Match = html.match(
      /<select id="element-1-render-mode">([\s\S]*?)<\/select>/
    );
    expect(renderModeSelect1Match?.[1]).toMatch(
      billboardPerspectiveOptionPattern
    );
    const renderModeSelect2Match = html.match(
      /<select id="element-2-render-mode">([\s\S]*?)<\/select>/
    );
    expect(renderModeSelect2Match?.[1]).toMatch(
      billboardPerspectiveOptionPattern
    );
    const moveSelectMatch = html.match(
      /<select id="interp-move-easing-select">([\s\S]*?)<\/select>/
    );
    expect(moveSelectMatch?.[1]).toContain(
      '<option value="none">None</option>'
    );
    expect(moveSelectMatch?.[1]).toContain(
      '<option value="linear" selected>Linear</option>'
    );
    expect(moveSelectMatch?.[1]).toContain(
      '<option value="sigmoid">Sigmoid (k=14,mid=0.35)</option>'
    );
    expect(moveSelectMatch?.[1]).toContain(
      '<option value="ease">Ease (out, power=9)</option>'
    );
    expect(moveSelectMatch?.[1]).toContain(
      '<option value="exponential">Exponential (in, exp=4)</option>'
    );
    expect(moveSelectMatch?.[1]).toContain(
      '<option value="quadratic">Quadratic (out)</option>'
    );
    expect(moveSelectMatch?.[1]).toContain(
      '<option value="cubic">Cubic (in)</option>'
    );
    expect(moveSelectMatch?.[1]).toContain(
      '<option value="sine">Sine (out, amplitude=1)</option>'
    );
    expect(moveSelectMatch?.[1]).toContain(
      '<option value="bounce">Bounce (bounces=2, decay=0.1)</option>'
    );
    expect(moveSelectMatch?.[1]).toContain(
      '<option value="back">Back (overshoot=2)</option>'
    );
    expect(moveSelectMatch?.[1]).not.toContain(
      '<option value="step">Step</option>'
    );
    const cameraInterpolationSelectMatch = html.match(
      /<select id="camera-interpolation">([\s\S]*?)<\/select>/
    );
    expect(cameraInterpolationSelectMatch?.[1]).toContain(
      '<option value="none">None</option>'
    );
    expect(cameraInterpolationSelectMatch?.[1]).toContain(
      '<option value="linear">Linear</option>'
    );
    expect(cameraInterpolationSelectMatch?.[1]).toMatch(
      /<option value="sigmoid" selected>\s*Sigmoid \(k=14,mid=0.35\)\s*<\/option>/
    );
    expect(cameraInterpolationSelectMatch?.[1]).toContain(
      '<option value="ease">Ease (out, power=9)</option>'
    );
    expect(cameraInterpolationSelectMatch?.[1]).toContain(
      '<option value="exponential">Exponential (in, exp=4)</option>'
    );
    expect(cameraInterpolationSelectMatch?.[1]).toContain(
      '<option value="quadratic">Quadratic (out)</option>'
    );
    expect(cameraInterpolationSelectMatch?.[1]).toContain(
      '<option value="cubic">Cubic (in)</option>'
    );
    expect(cameraInterpolationSelectMatch?.[1]).toContain(
      '<option value="sine">Sine (out, amplitude=1)</option>'
    );
    expect(cameraInterpolationSelectMatch?.[1]).toContain(
      '<option value="bounce">Bounce (bounces=2, decay=0.1)</option>'
    );
    expect(cameraInterpolationSelectMatch?.[1]).toContain(
      '<option value="back">Back (overshoot=2)</option>'
    );
    expect(cameraInterpolationSelectMatch?.[1]).not.toContain(
      '<option value="step">Step</option>'
    );
    const element0RotationSelectMatch = html.match(
      /<select id="element-0-rotation">([\s\S]*?)<\/select>/
    );
    expect(element0RotationSelectMatch?.[1]).toContain(
      '<option value="none" selected>None</option>'
    );
    expect(element0RotationSelectMatch?.[1]).toContain(
      '<option value="linear">Linear</option>'
    );
    expect(element0RotationSelectMatch?.[1]).toContain(
      '<option value="sigmoid">Sigmoid (k=14,mid=0.35)</option>'
    );
    expect(element0RotationSelectMatch?.[1]).toContain(
      '<option value="ease">Ease (out, power=9)</option>'
    );
    expect(element0RotationSelectMatch?.[1]).toContain(
      '<option value="exponential">Exponential (in, exp=4)</option>'
    );
    expect(element0RotationSelectMatch?.[1]).toContain(
      '<option value="quadratic">Quadratic (out)</option>'
    );
    expect(element0RotationSelectMatch?.[1]).toContain(
      '<option value="cubic">Cubic (in)</option>'
    );
    expect(element0RotationSelectMatch?.[1]).toContain(
      '<option value="sine">Sine (out, amplitude=1)</option>'
    );
    expect(element0RotationSelectMatch?.[1]).toContain(
      '<option value="bounce">Bounce (bounces=2, decay=0.1)</option>'
    );
    expect(element0RotationSelectMatch?.[1]).toContain(
      '<option value="back">Back (overshoot=2)</option>'
    );
    expect(element0RotationSelectMatch?.[1]).not.toContain(
      '<option value="step">Step</option>'
    );
    const element1RotationSelectMatch = html.match(
      /<select id="element-1-rotation">([\s\S]*?)<\/select>/
    );
    expect(element1RotationSelectMatch?.[1]).toContain(
      '<option value="none" selected>None</option>'
    );
    expect(element1RotationSelectMatch?.[1]).toContain(
      '<option value="linear">Linear</option>'
    );
    expect(element1RotationSelectMatch?.[1]).toContain(
      '<option value="sigmoid">Sigmoid (k=14,mid=0.35)</option>'
    );
    expect(element1RotationSelectMatch?.[1]).toContain(
      '<option value="ease">Ease (out, power=9)</option>'
    );
    expect(element1RotationSelectMatch?.[1]).toContain(
      '<option value="exponential">Exponential (in, exp=4)</option>'
    );
    expect(element1RotationSelectMatch?.[1]).toContain(
      '<option value="quadratic">Quadratic (out)</option>'
    );
    expect(element1RotationSelectMatch?.[1]).toContain(
      '<option value="cubic">Cubic (in)</option>'
    );
    expect(element1RotationSelectMatch?.[1]).toContain(
      '<option value="sine">Sine (out, amplitude=1)</option>'
    );
    expect(element1RotationSelectMatch?.[1]).toContain(
      '<option value="bounce">Bounce (bounces=2, decay=0.1)</option>'
    );
    expect(element1RotationSelectMatch?.[1]).toContain(
      '<option value="back">Back (overshoot=2)</option>'
    );
    expect(element1RotationSelectMatch?.[1]).not.toContain(
      '<option value="step">Step</option>'
    );
    expect(html).toContain('<input id="element-0-layer" type="range" />');
    expect(html).toContain('<input id="element-1-layer" type="range" />');
    expect(html).toContain('<input id="element-2-layer" type="range" />');
    const element2RotationSelectMatch = html.match(
      /<select id="element-2-rotation">([\s\S]*?)<\/select>/
    );
    expect(element2RotationSelectMatch?.[1]).toContain(
      '<option value="none" selected>None</option>'
    );
    expect(element2RotationSelectMatch?.[1]).toContain(
      '<option value="linear">Linear</option>'
    );
    expect(element2RotationSelectMatch?.[1]).toContain(
      '<option value="sigmoid">Sigmoid (k=14,mid=0.35)</option>'
    );
    expect(element2RotationSelectMatch?.[1]).toContain(
      '<option value="ease">Ease (out, power=9)</option>'
    );
    expect(element2RotationSelectMatch?.[1]).toContain(
      '<option value="exponential">Exponential (in, exp=4)</option>'
    );
    expect(element2RotationSelectMatch?.[1]).toContain(
      '<option value="quadratic">Quadratic (out)</option>'
    );
    expect(element2RotationSelectMatch?.[1]).toContain(
      '<option value="cubic">Cubic (in)</option>'
    );
    expect(element2RotationSelectMatch?.[1]).toContain(
      '<option value="sine">Sine (out, amplitude=1)</option>'
    );
    expect(element2RotationSelectMatch?.[1]).toContain(
      '<option value="bounce">Bounce (bounces=2, decay=0.1)</option>'
    );
    expect(element2RotationSelectMatch?.[1]).toContain(
      '<option value="back">Back (overshoot=2)</option>'
    );
    expect(element2RotationSelectMatch?.[1]).not.toContain(
      '<option value="step">Step</option>'
    );
  });

  it('contains runtime controls', async () => {
    const htmlPath = resolve(import.meta.dirname, './index.html');
    const html = await readFile(htmlPath, 'utf8');

    expect(html).toContain('id="wasm-f64"');
    expect(html).toContain('Use float64 WASM input');
    expect(html).toContain('id="scaling-limit-preset"');
    expect(html).toContain('Distance Scaling Limit');
    RUNTIME_SCALING_LIMIT_PRESETS.forEach((preset) => {
      const selected = preset.id === 'unlimited' ? '\\s+selected' : '';
      const pattern = new RegExp(
        `<option value="${escapeRegExp(preset.id)}"${selected}>\\s*${escapeRegExp(preset.label)}\\s*<\\/option>`
      );
      expect(html).toMatch(pattern);
    });
    expect(html).toMatch(
      /<input id="sprites-upscaling-to-pot" type="checkbox" checked/
    );
    expect(html).toContain('id="texture-min-filter"');
    expect(html).toContain('Texture Min Filter');
    expect(html).toContain('<option value="linearMipmapLinear" selected>');
    expect(html).toContain('id="texture-mag-filter"');
    expect(html).toContain('Texture Mag Filter');
    expect(html).toContain('id="texture-wrap-s"');
    expect(html).toContain('Texture Wrap S');
    expect(html).toContain('id="texture-wrap-t"');
    expect(html).toContain('Texture Wrap T');
    expect(html).toContain('id="texture-npot-policy"');
    expect(html).toContain('NPOT Policy');
    expect(html).toContain(
      '<option value="fallback" selected>Fallback</option>'
    );
  });
});
