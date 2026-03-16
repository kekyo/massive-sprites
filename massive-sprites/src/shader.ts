// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

///////////////////////////////////////////////////////////////////////////////////

/**
 * Compiled shader resources and bindings for sprite rendering.
 */
export interface SpriteShaderProgram {
  /** Linked WebGL program. */
  readonly program: WebGLProgram;
  /** Compiled vertex shader. */
  readonly vertexShader: WebGLShader;
  /** Compiled fragment shader. */
  readonly fragmentShader: WebGLShader;
  /** Vertex position attribute location. */
  readonly positionLocation: number;
  /** Texture coordinate attribute location. */
  readonly texCoordLocation: number;
  /** Per-vertex opacity attribute location. */
  readonly opacityAttributeLocation: number;
  /** Texture sampler uniform location. */
  readonly textureLocation: WebGLUniformLocation;
  /** Global opacity uniform location. */
  readonly opacityLocation: WebGLUniformLocation;
  /** View-projection matrix uniform location. */
  readonly viewProjectionLocation: WebGLUniformLocation;
}

/**
 * Compiled shader resources and bindings for polyline rendering.
 */
export interface PolylineShaderProgram {
  /** Linked WebGL program. */
  readonly program: WebGLProgram;
  /** Compiled vertex shader. */
  readonly vertexShader: WebGLShader;
  /** Compiled fragment shader. */
  readonly fragmentShader: WebGLShader;
  /** Vertex position attribute location. */
  readonly positionLocation: number;
  /** Vertex color attribute location. */
  readonly colorLocation: number;
  /** View-projection matrix uniform location. */
  readonly viewProjectionLocation: WebGLUniformLocation;
}

///////////////////////////////////////////////////////////////////////////////////

const SPRITE_VERTEX_SHADER_SOURCE = `
attribute vec3 a_position;
attribute vec2 a_texCoord;
attribute float a_opacity;
uniform mat4 u_viewProjection;
varying vec2 v_texCoord;
varying float v_opacity;

void main() {
  gl_Position = u_viewProjection * vec4(a_position, 1.0);
  v_texCoord = a_texCoord;
  v_opacity = a_opacity;
}
`;

const SPRITE_FRAGMENT_SHADER_SOURCE = `
precision mediump float;
varying vec2 v_texCoord;
varying float v_opacity;
uniform sampler2D u_texture;
uniform float u_opacity;

void main() {
  vec4 texColor = texture2D(u_texture, v_texCoord);
  gl_FragColor = vec4(texColor.rgb, texColor.a * v_opacity * u_opacity);
}
`;

const POLYLINE_VERTEX_SHADER_SOURCE = `
attribute vec3 a_position;
attribute vec4 a_color;
uniform mat4 u_viewProjection;
varying vec4 v_color;

void main() {
  gl_Position = u_viewProjection * vec4(a_position, 1.0);
  v_color = a_color;
}
`;

const POLYLINE_FRAGMENT_SHADER_SOURCE = `
precision mediump float;
varying vec4 v_color;

void main() {
  gl_FragColor = v_color;
}
`;

///////////////////////////////////////////////////////////////////////////////////

const createShader = (
  gl: WebGLRenderingContext,
  type: number,
  source: string
): WebGLShader => {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('Failed to create WebGL shader.');
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  const compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
  if (!compiled) {
    const info = gl.getShaderInfoLog(shader) ?? 'Unknown shader error.';
    gl.deleteShader(shader);
    throw new Error(`Failed to compile shader: ${info}`);
  }
  return shader;
};

const createProgram = (
  gl: WebGLRenderingContext,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader
): WebGLProgram => {
  const program = gl.createProgram();
  if (!program) {
    throw new Error('Failed to create WebGL program.');
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  const linked = gl.getProgramParameter(program, gl.LINK_STATUS);
  if (!linked) {
    const info = gl.getProgramInfoLog(program) ?? 'Unknown program error.';
    gl.deleteProgram(program);
    throw new Error(`Failed to link program: ${info}`);
  }
  return program;
};

///////////////////////////////////////////////////////////////////////////////////

/**
 * Creates the shader program used for sprite rendering.
 * @param gl - WebGL context.
 * @returns Compiled sprite shader program.
 */
export const createSpriteProgram = (
  gl: WebGLRenderingContext
): SpriteShaderProgram => {
  const vertexShader = createShader(
    gl,
    gl.VERTEX_SHADER,
    SPRITE_VERTEX_SHADER_SOURCE
  );
  const fragmentShader = createShader(
    gl,
    gl.FRAGMENT_SHADER,
    SPRITE_FRAGMENT_SHADER_SOURCE
  );
  const program = createProgram(gl, vertexShader, fragmentShader);
  const positionLocation = gl.getAttribLocation(program, 'a_position');
  const texCoordLocation = gl.getAttribLocation(program, 'a_texCoord');
  const opacityAttributeLocation = gl.getAttribLocation(program, 'a_opacity');
  const textureLocation = gl.getUniformLocation(program, 'u_texture');
  const opacityLocation = gl.getUniformLocation(program, 'u_opacity');
  const viewProjectionLocation = gl.getUniformLocation(
    program,
    'u_viewProjection'
  );
  if (opacityAttributeLocation < 0) {
    throw new Error('Failed to locate opacity attribute.');
  }
  if (textureLocation === null) {
    throw new Error('Failed to locate texture uniform.');
  }
  if (opacityLocation === null) {
    throw new Error('Failed to locate opacity uniform.');
  }
  if (viewProjectionLocation === null) {
    throw new Error('Failed to locate view projection uniform.');
  }
  return {
    program,
    vertexShader,
    fragmentShader,
    positionLocation,
    texCoordLocation,
    opacityAttributeLocation,
    textureLocation,
    opacityLocation,
    viewProjectionLocation,
  };
};

/**
 * Creates the shader program used for polyline rendering.
 * @param gl - WebGL context.
 * @returns Compiled polyline shader program.
 */
export const createPolylineProgram = (
  gl: WebGLRenderingContext
): PolylineShaderProgram => {
  const vertexShader = createShader(
    gl,
    gl.VERTEX_SHADER,
    POLYLINE_VERTEX_SHADER_SOURCE
  );
  const fragmentShader = createShader(
    gl,
    gl.FRAGMENT_SHADER,
    POLYLINE_FRAGMENT_SHADER_SOURCE
  );
  const program = createProgram(gl, vertexShader, fragmentShader);
  const positionLocation = gl.getAttribLocation(program, 'a_position');
  const colorLocation = gl.getAttribLocation(program, 'a_color');
  const viewProjectionLocation = gl.getUniformLocation(
    program,
    'u_viewProjection'
  );
  if (colorLocation < 0) {
    throw new Error('Failed to locate color attribute.');
  }
  if (viewProjectionLocation === null) {
    throw new Error('Failed to locate view projection uniform.');
  }
  return {
    program,
    vertexShader,
    fragmentShader,
    positionLocation,
    colorLocation,
    viewProjectionLocation,
  };
};
