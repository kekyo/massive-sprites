#!/usr/bin/env node
// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// This script executes a function script that generates
// command buffer layout symbols and WASM layout symbols for TS and WASM.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const spawnAndCapture = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let stdout = '';
    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
    }
    child.once('error', (error) => {
      reject(error);
    });
    child.once('close', (status, signal) => {
      resolve({ status, signal, stdout });
    });
  });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');
const templateRoot = resolve(__dirname, 'layout');

const outputs = [
  {
    templatePath: resolve(templateRoot, 'command-layout.generated.ts.fc'),
    outputPath: resolve(
      projectRoot,
      'src/generated/command-layout.generated.ts'
    ),
  },
  {
    templatePath: resolve(templateRoot, 'command-layout.generated.hpp.fc'),
    outputPath: resolve(
      projectRoot,
      'wasm/generated/command-layout.generated.hpp'
    ),
  },
  {
    templatePath: resolve(templateRoot, 'wasm-layout.generated.ts.fc'),
    outputPath: resolve(projectRoot, 'src/generated/wasm-layout.generated.ts'),
  },
  {
    templatePath: resolve(templateRoot, 'wasm-layout.generated.hpp.fc'),
    outputPath: resolve(
      projectRoot,
      'wasm/generated/wasm-layout.generated.hpp'
    ),
  },
];

const renderTemplate = async (templatePath, defines = {}) => {
  const args = ['funcity', '--no-rc'];
  for (const [name, value] of Object.entries(defines)) {
    args.push('-D', `${name}=${value}`);
  }
  args.push('-i', templatePath);
  const result = await spawnAndCapture('npx', args, {
    cwd: projectRoot,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  return result.stdout.replace(/\r\n/g, '\n');
};

await Promise.all(
  outputs.map(async ({ templatePath, outputPath, defines }) => {
    const rendered = await renderTemplate(templatePath, defines);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, rendered, 'utf8');
    console.log(`Generated: ${outputPath}`);
  })
);
