// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import { defineConfig } from 'vitest/config';

const pad2 = (value: number) => String(value).padStart(2, '0');

const formatTimestamp = (date: Date) => {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  const second = pad2(date.getSeconds());
  return `${year}${month}${day}_${hour}${minute}${second}`;
};

const ensureTestRunId = () => {
  if (!process.env.LOGICAL_TRACER_TEST_RUN_ID) {
    process.env.LOGICAL_TRACER_TEST_RUN_ID = formatTimestamp(new Date());
  }
};

ensureTestRunId();

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    testTimeout: 30000,
    setupFiles: ['./tests/setup.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Exclude sibling subprojects because they run their own test suites independently.
      '../demo1/**',
    ],
  },
  esbuild: {
    target: 'node18',
  },
});
