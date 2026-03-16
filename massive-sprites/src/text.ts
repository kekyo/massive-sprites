// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import TextGlyphWorker from './text.worker.ts?worker&inline';

import type {
  SpriteTextGlyphDimensions,
  SpriteTextGlyphOptions,
} from './types';
import {
  renderTextGlyphCanvasSource,
  type TextGlyphRenderResult,
  type TextGlyphWorkerRequest,
  type TextGlyphWorkerResponse,
} from './text-renderer';

///////////////////////////////////////////////////////////////////////////////////

interface PendingTextGlyphWorkerRequest {
  readonly resolve: (result: TextGlyphRenderResult<TexImageSource>) => void;
  readonly reject: (reason: unknown) => void;
}

interface TextGlyphWorkerState {
  readonly worker: Worker;
  readonly pendingRequests: Map<number, PendingTextGlyphWorkerRequest>;
  readonly workerIndex: number;
  inFlightCount: number;
  nextRequestId: number;
}

interface TextGlyphWorkerPoolState {
  readonly workers: readonly TextGlyphWorkerState[];
}

const GENERIC_FONT_FAMILY_NAMES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'emoji',
  'math',
  'fangsong',
]);

let textGlyphWorkerPoolState: TextGlyphWorkerPoolState | null | undefined =
  undefined;

///////////////////////////////////////////////////////////////////////////////////

const normalizeFontFamilyName = (fontFamily: string): string => {
  const trimmed = fontFamily.trim();
  if (trimmed.length < 2) {
    return trimmed.toLowerCase();
  }

  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1).trim().toLowerCase();
  }

  return trimmed.toLowerCase();
};

const isWorkerCompatibleFontFamily = (
  fontFamily: string | undefined
): boolean => {
  if (fontFamily === undefined) {
    return true;
  }

  const families = fontFamily
    .split(',')
    .map((family) => normalizeFontFamilyName(family))
    .filter((family) => family.length > 0);
  if (families.length === 0) {
    return true;
  }

  return families.every((family) => GENERIC_FONT_FAMILY_NAMES.has(family));
};

const canUseTextGlyphWorker = (
  options: SpriteTextGlyphOptions | undefined
): boolean =>
  typeof Worker === 'function' &&
  typeof OffscreenCanvas === 'function' &&
  isWorkerCompatibleFontFamily(options?.fontFamily);

const resolveTextGlyphWorkerCount = (): number => {
  const hardwareConcurrency =
    typeof navigator === 'object' &&
    navigator !== null &&
    typeof navigator.hardwareConcurrency === 'number' &&
    Number.isFinite(navigator.hardwareConcurrency) &&
    navigator.hardwareConcurrency > 0
      ? navigator.hardwareConcurrency
      : 1;

  // Keep worker count modest: one worker per 4 logical CPUs, capped to 4.
  return Math.max(1, Math.min(Math.floor(hardwareConcurrency / 4), 4));
};

const toTextGlyphWorkerError = (reason: unknown): Error => {
  if (reason instanceof Error) {
    return reason;
  }
  if (typeof reason === 'string' && reason.length > 0) {
    return new Error(reason);
  }
  return new Error('Text glyph worker failed.');
};

const releaseTextGlyphWorkerPoolState = (
  nextState: TextGlyphWorkerPoolState | null | undefined,
  reason: unknown
) => {
  const state = textGlyphWorkerPoolState;
  if (state !== undefined && state !== null) {
    const error =
      reason === undefined ? undefined : toTextGlyphWorkerError(reason);
    for (const workerState of state.workers) {
      if (error) {
        for (const pendingRequest of workerState.pendingRequests.values()) {
          pendingRequest.reject(error);
        }
        workerState.pendingRequests.clear();
      }
      workerState.worker.terminate();
    }
  }

  textGlyphWorkerPoolState = nextState;
};

const handleTextGlyphWorkerMessage = (
  workerState: TextGlyphWorkerState,
  event: MessageEvent<TextGlyphWorkerResponse>
) => {
  const poolState = textGlyphWorkerPoolState;
  if (poolState === undefined || poolState === null) {
    return;
  }

  const response = event.data;
  const pendingRequest = workerState.pendingRequests.get(response.requestId);
  if (!pendingRequest) {
    return;
  }

  workerState.pendingRequests.delete(response.requestId);
  workerState.inFlightCount = Math.max(0, workerState.inFlightCount - 1);
  if (response.type === 'success') {
    pendingRequest.resolve({
      source: response.bitmap,
      logicalSize: response.logicalSize,
      uploadSize: response.uploadSize,
    });
    return;
  }

  pendingRequest.reject(new Error(response.message));
};

const selectTextGlyphWorker = (
  poolState: TextGlyphWorkerPoolState
): TextGlyphWorkerState => {
  let selectedWorker = poolState.workers[0];
  if (!selectedWorker) {
    throw new Error('Text glyph worker pool is empty.');
  }

  for (const workerState of poolState.workers) {
    if (workerState.inFlightCount < selectedWorker.inFlightCount) {
      selectedWorker = workerState;
    }
  }

  return selectedWorker;
};

const getTextGlyphWorkerPoolState = (): TextGlyphWorkerPoolState | null => {
  if (textGlyphWorkerPoolState !== undefined) {
    return textGlyphWorkerPoolState;
  }

  try {
    const workerCount = resolveTextGlyphWorkerCount();
    const workers: TextGlyphWorkerState[] = [];

    for (let index = 0; index < workerCount; index += 1) {
      const worker = new TextGlyphWorker({
        name: `massive-sprites-text-glyph-${index}`,
      });
      const workerState: TextGlyphWorkerState = {
        worker,
        pendingRequests: new Map(),
        workerIndex: index,
        inFlightCount: 0,
        nextRequestId: 0,
      };

      worker.addEventListener('message', (event) => {
        handleTextGlyphWorkerMessage(
          workerState,
          event as MessageEvent<TextGlyphWorkerResponse>
        );
      });
      worker.addEventListener('messageerror', () => {
        releaseTextGlyphWorkerPoolState(
          null,
          `Failed to decode a text glyph worker response (worker ${workerState.workerIndex}).`
        );
      });
      worker.addEventListener('error', (event) => {
        const errorEvent = event as ErrorEvent;
        releaseTextGlyphWorkerPoolState(
          null,
          errorEvent.error ??
            errorEvent.message ??
            `Text glyph worker ${workerState.workerIndex} failed.`
        );
      });

      workers.push(workerState);
    }

    const poolState: TextGlyphWorkerPoolState = {
      workers,
    };
    textGlyphWorkerPoolState = poolState;
    return poolState;
  } catch {
    textGlyphWorkerPoolState = null;
    return null;
  }
};

const renderTextGlyphSourceOnCurrentThread = async (
  text: string,
  dimensions: SpriteTextGlyphDimensions,
  options: SpriteTextGlyphOptions | undefined
): Promise<TextGlyphRenderResult<TexImageSource>> =>
  renderTextGlyphCanvasSource(text, dimensions, options, true);

const renderTextGlyphSourceInWorker = async (
  text: string,
  dimensions: SpriteTextGlyphDimensions,
  options: SpriteTextGlyphOptions | undefined
): Promise<TextGlyphRenderResult<TexImageSource>> => {
  const poolState = getTextGlyphWorkerPoolState();
  if (!poolState) {
    throw new Error('Text glyph worker is not available.');
  }

  const workerState = selectTextGlyphWorker(poolState);
  const requestId = workerState.nextRequestId;
  workerState.nextRequestId += 1;

  return new Promise((resolve, reject) => {
    workerState.pendingRequests.set(requestId, { resolve, reject });
    workerState.inFlightCount += 1;

    try {
      const request: TextGlyphWorkerRequest = {
        requestId,
        text,
        dimensions,
        options,
      };
      workerState.worker.postMessage(request);
    } catch (error) {
      workerState.pendingRequests.delete(requestId);
      workerState.inFlightCount = Math.max(0, workerState.inFlightCount - 1);
      reject(error);
    }
  });
};

///////////////////////////////////////////////////////////////////////////////////

/**
 * Render result type returned by text glyph rendering helpers.
 */
export type { TextGlyphRenderResult } from './text-renderer';

/**
 * Renders a text glyph source, using a worker when the environment and options allow it.
 * @param text - Text content to render.
 * @param dimensions - Glyph sizing constraint.
 * @param options - Optional visual styling.
 * @returns Rendered glyph source and size metadata.
 */
export const renderTextGlyphSource = async (
  text: string,
  dimensions: SpriteTextGlyphDimensions,
  options: SpriteTextGlyphOptions | undefined
): Promise<TextGlyphRenderResult<TexImageSource>> => {
  if (canUseTextGlyphWorker(options)) {
    try {
      return await renderTextGlyphSourceInWorker(text, dimensions, options);
    } catch {
      releaseTextGlyphWorkerPoolState(null, undefined);
    }
  }

  return renderTextGlyphSourceOnCurrentThread(text, dimensions, options);
};

/**
 * Resets the shared text glyph worker pool for tests.
 * @remarks Intended for test environments that need to fully reset worker state between cases.
 */
export const __resetTextGlyphWorkerForTests = (): void => {
  releaseTextGlyphWorkerPoolState(undefined, undefined);
};
