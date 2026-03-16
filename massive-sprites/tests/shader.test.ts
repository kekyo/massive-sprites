// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { createPolylineProgram, createSpriteProgram } from '../src/shader';

const createFakeGL = (overrides?: Partial<WebGLRenderingContext>) =>
  ({
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    deleteShader: () => {},
    createProgram: () => ({}),
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    deleteProgram: () => {},
    getAttribLocation: (_program: WebGLProgram, _name: string) => 1,
    getUniformLocation: () => ({}),
    ...(overrides ?? {}),
  }) as unknown as WebGLRenderingContext;

describe('createSpriteProgram', () => {
  it('creates shader resources', () => {
    const gl = createFakeGL();

    const resources = createSpriteProgram(gl);

    expect(resources.program).toBeTruthy();
    expect(resources.vertexShader).toBeTruthy();
    expect(resources.fragmentShader).toBeTruthy();
    expect(resources.positionLocation).toBe(1);
    expect(resources.texCoordLocation).toBe(1);
    expect(resources.opacityAttributeLocation).toBe(1);
    expect(resources.textureLocation).toBeTruthy();
    expect(resources.opacityLocation).toBeTruthy();
    expect(resources.viewProjectionLocation).toBeTruthy();
  });

  it('throws when texture uniform is missing', () => {
    const gl = createFakeGL({
      getUniformLocation: () => null,
    });

    expect(() => createSpriteProgram(gl)).toThrow(/texture uniform/i);
  });

  it('throws when view projection uniform is missing', () => {
    const gl = createFakeGL({
      getUniformLocation: (_program, name) =>
        name === 'u_viewProjection' ? null : ({} as WebGLUniformLocation),
    });

    expect(() => createSpriteProgram(gl)).toThrow(/view projection uniform/i);
  });

  it('throws when opacity uniform is missing', () => {
    const gl = createFakeGL({
      getUniformLocation: (_program, name) =>
        name === 'u_opacity' ? null : ({} as WebGLUniformLocation),
    });

    expect(() => createSpriteProgram(gl)).toThrow(/opacity uniform/i);
  });

  it('throws when opacity attribute is missing', () => {
    const gl = createFakeGL({
      getAttribLocation: (_program, name) => (name === 'a_opacity' ? -1 : 1),
    });

    expect(() => createSpriteProgram(gl)).toThrow(/opacity attribute/i);
  });
});

describe('createPolylineProgram', () => {
  it('creates shader resources', () => {
    const gl = createFakeGL();

    const resources = createPolylineProgram(gl);

    expect(resources.program).toBeTruthy();
    expect(resources.vertexShader).toBeTruthy();
    expect(resources.fragmentShader).toBeTruthy();
    expect(resources.positionLocation).toBe(1);
    expect(resources.colorLocation).toBe(1);
    expect(resources.viewProjectionLocation).toBeTruthy();
  });

  it('throws when view projection uniform is missing', () => {
    const gl = createFakeGL({
      getUniformLocation: (_program, name) =>
        name === 'u_viewProjection' ? null : ({} as WebGLUniformLocation),
    });

    expect(() => createPolylineProgram(gl)).toThrow(/view projection uniform/i);
  });

  it('throws when color attribute is missing', () => {
    const gl = createFakeGL({
      getAttribLocation: (_program, name) => (name === 'a_color' ? -1 : 1),
    });

    expect(() => createPolylineProgram(gl)).toThrow(/color attribute/i);
  });
});
