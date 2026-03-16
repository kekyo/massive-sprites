// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import dts from 'vite-plugin-dts';
import screwUp from 'screw-up';
import prettierMax from 'prettier-max';
import emsdkEnv from 'emsdk-env/vite';

const wasmPrecisionSources = [
  'compute.cpp',
  'compute_input_views.cpp',
  'compute_sprite_animation.cpp',
  'compute_element_animation.cpp',
  'compute_pivot.cpp',
  'compute_output.cpp',
];

const wasmExports = [
  '_mem_alloc',
  '_mem_free',
  '_mem_realloc',
  ...[
    '_create_context',
    '_release_context',
    '_set_command_buffer',
    '_set_result_buffer',
    '_set_apply_stats_buffer',
    '_set_compute_stats_buffer',
    '_set_pick_mask_page_table_buffer',
    '_set_pick_mask_word_buffer',
    '_set_scaling_options',
    '_set_camera_tracking',
    '_clear_camera_tracking',
    '_apply_commands',
    '_get_sprite_state',
    '_get_polyline_state',
    '_get_camera_state',
    '_screen_to_world_on_plane',
    '_screen_to_world_on_plane_with_camera',
    '_project_world_to_viewport',
    '_project_world_to_viewport_with_camera',
    '_compute_vertices',
    '_pick_at',
    '_pick_at_cached',
    '_set_entry_debug_enabled',
    '_set_element_anim_detail_enabled',
    '_get_entry_debug',
  ].flatMap((name) => [`${name}_f32`, `${name}_f64`]),
];

const copyWasmArtifactsPlugin = (): Plugin => ({
  name: 'copy-wasm-artifacts',
  apply: 'build',
  writeBundle() {
    const wasmSourceDir = resolve(__dirname, 'src/wasm');
    const wasmDestDir = resolve(__dirname, 'dist/wasm');
    if (!existsSync(wasmSourceDir)) {
      return;
    }
    if (!existsSync(wasmDestDir)) {
      mkdirSync(wasmDestDir, { recursive: true });
    }
    const allowedSuffixes = ['.wasm', '.js', '.worker.js'];
    for (const entry of readdirSync(wasmSourceDir)) {
      if (!allowedSuffixes.some((suffix) => entry.endsWith(suffix))) {
        continue;
      }
      const src = resolve(wasmSourceDir, entry);
      const dest = resolve(wasmDestDir, entry);
      copyFileSync(src, dest);
    }
  },
});

export default defineConfig({
  plugins: [
    screwUp(),
    prettierMax({
      typescript: 'tsconfig.tests.json',
    }),
    emsdkEnv({
      srcDir: 'wasm',
      outDir: 'src/wasm',
      generatedLoader: {
        enable: true,
      },
      common: {
        options: [
          '-O3',
          '-std=c++17',
          '-mbulk-memory',
          '-msimd128',
          '-ffast-math',
        ],
        defines: {
          SIMD_ENABLED: 1,
        },
        linkOptions: ['-O3', '-std=c++17', '-mbulk-memory', '-msimd128'],
        linkDirectives: {
          ENVIRONMENT: 'web,webview,worker,node',
          ERROR_ON_UNDEFINED_SYMBOLS: 0,
          ALLOW_MEMORY_GROWTH: 1,
          EXPORTED_RUNTIME_METHODS: ['wasmMemory'],
        },
        wasmOpt: {
          enable: true,
          options: [
            '-O3',
            '--enable-nontrapping-float-to-int',
            '--enable-bulk-memory',
            '--enable-simd',
          ],
        },
        exports: wasmExports,
      },
      targets: {
        compute: {
          sources: ['common.cpp'],
          sourceGroups: [
            {
              sources: wasmPrecisionSources,
              defines: {
                MSP_INPUT_F64: 0,
              },
            },
            {
              sources: wasmPrecisionSources,
              defines: {
                MSP_INPUT_F64: 1,
              },
            },
          ],
        },
      },
    }),
    dts({
      rollupTypes: true,
    }),
    copyWasmArtifactsPlugin(),
  ],
  build: {
    lib: {
      entry: {
        index: resolve(
          fileURLToPath(new URL('.', import.meta.url)),
          'src/index.ts'
        ),
        'logical-graph': resolve(
          fileURLToPath(new URL('.', import.meta.url)),
          'src/logical-graph/index.ts'
        ),
      },
      name: 'massive-sprites',
      formats: ['es', 'cjs'],
      fileName: (format, entryName) =>
        `${entryName}.${format === 'es' ? 'mjs' : 'cjs'}`,
    },
    rollupOptions: {
      external: ['path'],
    },
    target: 'es2018',
    sourcemap: true,
    minify: false,
  },
});
