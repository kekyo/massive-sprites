// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

export const createFakeGL = () => {
  const TEXTURE_MAX_ANISOTROPY_EXT = 0x84fe;
  const MAX_TEXTURE_MAX_ANISOTROPY_EXT = 0x84ff;
  const calls = {
    bindTexture: 0,
    deleteTexture: 0,
    deleteBuffer: 0,
    deleteProgram: 0,
    deleteShader: 0,
    texImage2D: 0,
    texSubImage2D: 0,
    texImageSizes: [] as Array<{
      readonly width: number;
      readonly height: number;
    }>,
    texSubImageSizes: [] as Array<{
      readonly width: number;
      readonly height: number;
    }>,
    pixelStorei: [] as Array<readonly [number, number]>,
    drawArrays: 0,
    uniform1fValues: [] as number[],
    generateMipmap: 0,
    texParameteri: [] as Array<readonly [number, number, number]>,
    texParameterf: [] as Array<readonly [number, number, number]>,
    getExtension: [] as string[],
    bufferData: [] as Float32Array[],
    drawElements: 0,
    drawSequence: [] as Array<{
      readonly kind: 'sprite' | 'polyline';
      readonly start: number;
      readonly count: number;
    }>,
  };
  let maxTextureMaxAnisotropy: number | null = null;
  let maxTextureSize = 4096;

  const gl = {
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    STATIC_DRAW: 0x88e4,
    DYNAMIC_DRAW: 0x88e8,
    FLOAT: 0x1406,
    UNSIGNED_SHORT: 0x1403,
    TRIANGLES: 0x0004,
    TRIANGLE_STRIP: 0x0005,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    TEXTURE_2D: 0x0de1,
    TEXTURE0: 0x84c0,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    BLEND: 0x0be2,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    COLOR_BUFFER_BIT: 0x4000,
    NEAREST: 0x2600,
    CLAMP_TO_EDGE: 0x812f,
    REPEAT: 0x2901,
    MIRRORED_REPEAT: 0x8370,
    LINEAR: 0x2601,
    NEAREST_MIPMAP_NEAREST: 0x2700,
    LINEAR_MIPMAP_NEAREST: 0x2701,
    NEAREST_MIPMAP_LINEAR: 0x2702,
    LINEAR_MIPMAP_LINEAR: 0x2703,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    MAX_TEXTURE_SIZE: 0x0d33,
    createShader: (type: number) => ({ type }),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: (_shader: unknown, pname: number) => {
      if (pname === 0x8b81) {
        return true;
      }
      return true;
    },
    getShaderInfoLog: () => '',
    deleteShader: () => {
      calls.deleteShader += 1;
    },
    createProgram: () => ({}),
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: (_program: unknown, pname: number) => {
      if (pname === 0x8b82) {
        return true;
      }
      return true;
    },
    getProgramInfoLog: () => '',
    deleteProgram: () => {
      calls.deleteProgram += 1;
    },
    getAttribLocation: (_program: unknown, name: string) => {
      if (name === 'a_position') {
        return 0;
      }
      if (name === 'a_texCoord') {
        return 1;
      }
      if (name === 'a_opacity') {
        return 2;
      }
      return 0;
    },
    getUniformLocation: () => ({}) as WebGLUniformLocation,
    createBuffer: () => ({}),
    createTexture: () => ({}),
    bindTexture: () => {
      calls.bindTexture += 1;
    },
    texParameteri: (target: number, pname: number, param: number): void => {
      calls.texParameteri.push([target, pname, param]);
    },
    texParameterf: (target: number, pname: number, param: number): void => {
      calls.texParameterf.push([target, pname, param]);
    },
    texImage2D: (...args: unknown[]) => {
      calls.texImage2D += 1;
      let width = -1;
      let height = -1;
      if (typeof args[3] === 'number' && typeof args[4] === 'number') {
        width = args[3];
        height = args[4];
      } else {
        const imageSource = args[5] as { width?: number; height?: number };
        width = imageSource.width ?? -1;
        height = imageSource.height ?? -1;
      }
      calls.texImageSizes.push({
        width,
        height,
      });
    },
    texSubImage2D: (...args: unknown[]) => {
      calls.texSubImage2D += 1;
      const imageSource = args[6] as { width?: number; height?: number };
      calls.texSubImageSizes.push({
        width: imageSource.width ?? -1,
        height: imageSource.height ?? -1,
      });
    },
    generateMipmap: () => {
      calls.generateMipmap += 1;
    },
    pixelStorei: (pname: number, param: number): void => {
      calls.pixelStorei.push([pname, param]);
    },
    getParameter: (pname: number) => {
      if (pname === 0x0d33) {
        return maxTextureSize;
      }
      if (
        pname === MAX_TEXTURE_MAX_ANISOTROPY_EXT &&
        maxTextureMaxAnisotropy !== null
      ) {
        return maxTextureMaxAnisotropy;
      }
      return 0;
    },
    getExtension: (name: string) => {
      calls.getExtension.push(name);
      if (
        (name === 'EXT_texture_filter_anisotropic' ||
          name === 'MOZ_EXT_texture_filter_anisotropic' ||
          name === 'WEBKIT_EXT_texture_filter_anisotropic') &&
        maxTextureMaxAnisotropy !== null
      ) {
        return {
          TEXTURE_MAX_ANISOTROPY_EXT,
          MAX_TEXTURE_MAX_ANISOTROPY_EXT,
        };
      }
      return null;
    },
    deleteTexture: () => {
      calls.deleteTexture += 1;
    },
    deleteBuffer: () => {
      calls.deleteBuffer += 1;
    },
    enable: () => {},
    blendFunc: () => {},
    viewport: () => {},
    clear: () => {},
    useProgram: () => {},
    bindBuffer: () => {},
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    activeTexture: () => {},
    uniform1i: () => {},
    uniform1f: (_location: WebGLUniformLocation, value: number) => {
      calls.uniform1fValues.push(value);
    },
    uniformMatrix4fv: () => {},
    bufferData: (target: number, data: BufferSource) => {
      if (target !== gl.ARRAY_BUFFER) {
        return;
      }
      if (ArrayBuffer.isView(data)) {
        const slice = data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength
        );
        calls.bufferData.push(new Float32Array(slice));
      } else if (data instanceof ArrayBuffer) {
        calls.bufferData.push(new Float32Array(data.slice(0)));
      }
    },
    drawArrays: (_mode: number, first: number, count: number) => {
      calls.drawArrays += 1;
      calls.drawSequence.push({
        kind: 'polyline',
        start: first ?? 0,
        count: count ?? 0,
      });
    },
    drawElements: (
      _mode: number,
      count: number,
      _type: number,
      _offset: number
    ) => {
      calls.drawElements += 1;
      calls.drawSequence.push({
        kind: 'sprite',
        start: 0,
        count: count ?? 0,
      });
    },
  } as unknown as WebGLRenderingContext;

  const setAnisotropyExtension = (supportedMaxAnisotropy: number | null) => {
    maxTextureMaxAnisotropy = supportedMaxAnisotropy;
  };

  const setMaxTextureSize = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error('Max texture size must be a positive number.');
    }
    maxTextureSize = Math.floor(value);
  };

  return { gl, calls, setAnisotropyExtension, setMaxTextureSize };
};

export const createPlacement = (
  sx: number,
  sy: number,
  imageId = 'sprite'
) => ({
  sx: { value: sx },
  sy: { value: sy },
  elements: [{ imageId }],
});

export const createFakeBitmap = (width = 100, height = 100) =>
  ({ width, height }) as ImageBitmap;
