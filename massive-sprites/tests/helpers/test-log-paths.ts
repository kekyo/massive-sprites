// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import { appendFileSync, mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';

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

const ensureRunId = () => {
  const current = process.env.LOGICAL_TRACER_TEST_RUN_ID;
  if (current && current.length > 0) {
    return current;
  }
  const runId = formatTimestamp(new Date());
  process.env.LOGICAL_TRACER_TEST_RUN_ID = runId;
  return runId;
};

const sanitizeSegment = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'logs';
  }
  return trimmed.replace(/[\\/]/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_');
};

const rootDir = resolve(import.meta.dirname, '..', '..');
const runId = ensureRunId();
const baseDir = resolve(rootDir, 'test_results', runId);

const ensureDir = (dir: string) => {
  mkdirSync(dir, { recursive: true });
  return dir;
};

export const getTestResultsBaseDir = () => ensureDir(baseDir);

export const getTestResultsDir = (logType: string, caseName?: string) => {
  const typeDir = resolve(baseDir, sanitizeSegment(logType));
  const dir = caseName ? resolve(typeDir, sanitizeSegment(caseName)) : typeDir;
  return ensureDir(dir);
};

export const resolveTestResultsPath = (
  logType: string,
  caseName: string | undefined,
  fileName: string
) => resolve(getTestResultsDir(logType, caseName), fileName);

export const appendTestResultsLine = (
  logType: string,
  caseName: string | undefined,
  fileName: string,
  line: string
) => {
  const filePath = resolveTestResultsPath(logType, caseName, fileName);
  appendFileSync(filePath, `${line}\n`);
  return filePath;
};

export const writeTestResultsText = (
  logType: string,
  caseName: string | undefined,
  fileName: string,
  content: string
) => {
  const filePath = resolveTestResultsPath(logType, caseName, fileName);
  writeFileSync(filePath, content);
  return filePath;
};
