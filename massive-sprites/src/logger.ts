// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import { Logger } from './types';

///////////////////////////////////////////////////////////////////////////////////

const NO_OP_LOGGER_FUNCTION = () => {};
const NO_OP_LOGGER: Logger = {
  debug: NO_OP_LOGGER_FUNCTION,
  info: NO_OP_LOGGER_FUNCTION,
  warn: NO_OP_LOGGER_FUNCTION,
  error: NO_OP_LOGGER_FUNCTION,
} as const;

const CONSOLE_LOGGER: Logger = {
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
} as const;

/**
 * Default no-op logger that doesn't output anything
 * @returns Logger instance that performs no operations
 */
export const getNoOpLogger = () => NO_OP_LOGGER;

/**
 * Console logger that outputs to console
 * @returns Logger instance that outputs to console
 */
export const getConsoleLogger = () => CONSOLE_LOGGER;
