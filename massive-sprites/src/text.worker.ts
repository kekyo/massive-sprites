// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import {
  renderTextGlyphCanvasSource,
  type TextGlyphWorkerErrorResponse,
  type TextGlyphWorkerRequest,
  type TextGlyphWorkerSuccessResponse,
} from './text-renderer';

///////////////////////////////////////////////////////////////////////////////////

const getErrorMessage = (reason: unknown): string => {
  if (reason instanceof Error && reason.message.length > 0) {
    return reason.message;
  }
  if (typeof reason === 'string' && reason.length > 0) {
    return reason;
  }
  return 'Text glyph worker failed.';
};

const workerScope = self as typeof globalThis & {
  readonly postMessage: (
    message: unknown,
    transfer?: readonly Transferable[]
  ) => void;
  readonly addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<TextGlyphWorkerRequest>) => void
  ) => void;
};

workerScope.addEventListener(
  'message',
  (event: MessageEvent<TextGlyphWorkerRequest>) => {
    const request = event.data;
    try {
      const result = renderTextGlyphCanvasSource(
        request.text,
        request.dimensions,
        request.options,
        false
      );
      if (!(result.source instanceof OffscreenCanvas)) {
        throw new Error('Text glyph worker requires OffscreenCanvas.');
      }
      if (typeof result.source.transferToImageBitmap !== 'function') {
        throw new Error(
          'Text glyph worker requires OffscreenCanvas.transferToImageBitmap.'
        );
      }

      const bitmap = result.source.transferToImageBitmap();
      const response: TextGlyphWorkerSuccessResponse = {
        type: 'success',
        requestId: request.requestId,
        bitmap,
        logicalSize: result.logicalSize,
        uploadSize: result.uploadSize,
      };
      workerScope.postMessage(response, [bitmap]);
    } catch (error) {
      const response: TextGlyphWorkerErrorResponse = {
        type: 'error',
        requestId: request.requestId,
        message: getErrorMessage(error),
      };
      workerScope.postMessage(response);
    }
  }
);

export {};
