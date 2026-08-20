import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";

export interface ScreenFisheyeOptions {
  enabled: boolean;
  /** Primary radial distortion coefficient. */
  k1: number;
  /** Higher-order edge roll-off coefficient. */
  k2: number;
  strength: number;
  /** Distortion radius relative to the viewport corner radius. */
  radius: number;
}

export const DEFAULT_SCREEN_FISHEYE: ScreenFisheyeOptions = {
  enabled: true,
  k1: -0.35,
  k2: 0,
  strength: 1.33,
  radius: 1,
};

const VERTEX_SHADER = `#version 300 es
precision highp float;
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

/**
 * Adapted from draaimolen's FisheyeEffect post-process shader. The polynomial
 * is unchanged; the sphere radius is expressed relative to the viewport corner
 * so the whole map receives one continuous screen-space distortion.
 */
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_k1;
uniform float u_k2;
uniform float u_strength;
uniform float u_aspect;
uniform float u_radius;
in vec2 v_uv;
out vec4 out_color;

void main() {
  vec2 centered = v_uv - 0.5;
  centered.x *= u_aspect;
  float viewport_corner_radius = 0.5 * length(vec2(u_aspect, 1.0));
  float normalized_radius = length(centered) /
    max(viewport_corner_radius * u_radius, 0.000001);
  float radius2 = normalized_radius * normalized_radius;
  float scale = 1.0 +
    (u_k1 * radius2 + u_k2 * radius2 * radius2) * u_strength;
  centered.x /= u_aspect;
  vec2 sample_uv = centered * scale + 0.5;
  out_color = texture(u_input, clamp(sample_uv, 0.0, 1.0));
}`;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export function normalizeScreenFisheyeOptions(
  options: Partial<ScreenFisheyeOptions> = {},
): ScreenFisheyeOptions {
  return {
    enabled: options.enabled ?? DEFAULT_SCREEN_FISHEYE.enabled,
    k1: clamp(options.k1 ?? DEFAULT_SCREEN_FISHEYE.k1, -2, 2),
    k2: clamp(options.k2 ?? DEFAULT_SCREEN_FISHEYE.k2, -2, 2),
    strength: clamp(options.strength ?? DEFAULT_SCREEN_FISHEYE.strength, 0, 2),
    radius: clamp(options.radius ?? DEFAULT_SCREEN_FISHEYE.radius, 0.5, 2),
  };
}

/** CPU equivalent of the fragment shader's UV transform for deterministic tests. */
export function screenFisheyeSampleUv(
  uv: readonly [number, number],
  width: number,
  height: number,
  options: Partial<ScreenFisheyeOptions> = {},
): readonly [number, number] {
  const resolved = normalizeScreenFisheyeOptions(options);
  if (!resolved.enabled || width <= 0 || height <= 0) return uv;
  const aspect = width / height;
  const centeredX = (uv[0] - 0.5) * aspect;
  const centeredY = uv[1] - 0.5;
  const cornerRadius = 0.5 * Math.hypot(aspect, 1);
  const normalizedRadius =
    Math.hypot(centeredX, centeredY) / (cornerRadius * resolved.radius);
  const radius2 = normalizedRadius * normalizedRadius;
  const scale =
    1 +
    (resolved.k1 * radius2 + resolved.k2 * radius2 * radius2) *
      resolved.strength;
  return [
    clamp((centeredX / aspect) * scale + 0.5, 0, 1),
    clamp(centeredY * scale + 0.5, 0, 1),
  ];
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to allocate fisheye shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Fisheye shader failed";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error("Unable to allocate fisheye program");
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "Fisheye program failed";
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

/** Demo-only final screen pass that distorts map pixels but not HTML controls. */
export class ScreenFisheyeLayer implements CustomLayerInterface {
  readonly id = "demo-screen-fisheye";
  readonly type = "custom" as const;
  readonly renderingMode = "2d" as const;

  #map: MapLibreMap | undefined;
  #gl: WebGL2RenderingContext | undefined;
  #program: WebGLProgram | undefined;
  #vertexBuffer: WebGLBuffer | undefined;
  #texture: WebGLTexture | undefined;
  #textureWidth = 0;
  #textureHeight = 0;
  #options: ScreenFisheyeOptions;

  constructor(options: Partial<ScreenFisheyeOptions> = {}) {
    this.#options = normalizeScreenFisheyeOptions(options);
  }

  getOptions(): ScreenFisheyeOptions {
    return { ...this.#options };
  }

  setOptions(options: Partial<ScreenFisheyeOptions>): this {
    this.#options = normalizeScreenFisheyeOptions({
      ...this.#options,
      ...options,
    });
    this.#map?.triggerRepaint();
    return this;
  }

  onAdd(
    map: MapLibreMap,
    context: WebGLRenderingContext | WebGL2RenderingContext,
  ): void {
    if (!(context instanceof WebGL2RenderingContext))
      throw new Error("The demo fisheye effect requires WebGL 2");
    this.#map = map;
    this.#gl = context;
    this.#program = createProgram(context);
    this.#vertexBuffer = context.createBuffer() ?? undefined;
    context.bindBuffer(context.ARRAY_BUFFER, this.#vertexBuffer ?? null);
    context.bufferData(
      context.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      context.STATIC_DRAW,
    );
    this.#texture = context.createTexture() ?? undefined;
    context.bindTexture(context.TEXTURE_2D, this.#texture ?? null);
    context.texParameteri(
      context.TEXTURE_2D,
      context.TEXTURE_MIN_FILTER,
      context.LINEAR,
    );
    context.texParameteri(
      context.TEXTURE_2D,
      context.TEXTURE_MAG_FILTER,
      context.LINEAR,
    );
    context.texParameteri(
      context.TEXTURE_2D,
      context.TEXTURE_WRAP_S,
      context.CLAMP_TO_EDGE,
    );
    context.texParameteri(
      context.TEXTURE_2D,
      context.TEXTURE_WRAP_T,
      context.CLAMP_TO_EDGE,
    );
  }

  render(context: WebGLRenderingContext | WebGL2RenderingContext): void {
    if (
      !this.#options.enabled ||
      context !== this.#gl ||
      !this.#program ||
      !this.#vertexBuffer ||
      !this.#texture
    )
      return;
    const gl = this.#gl;
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#texture);
    if (width !== this.#textureWidth || height !== this.#textureHeight) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        width,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
      this.#textureWidth = width;
      this.#textureHeight = height;
    }
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, width, height);

    gl.useProgram(this.#program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#vertexBuffer);
    const position = gl.getAttribLocation(this.#program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(gl.getUniformLocation(this.#program, "u_input"), 0);
    gl.uniform1f(
      gl.getUniformLocation(this.#program, "u_k1"),
      this.#options.k1,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.#program, "u_k2"),
      this.#options.k2,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.#program, "u_strength"),
      this.#options.strength,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.#program, "u_aspect"),
      width / height,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.#program, "u_radius"),
      this.#options.radius,
    );
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.colorMask(true, true, true, true);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  onRemove(): void {
    if (this.#gl) {
      if (this.#vertexBuffer) this.#gl.deleteBuffer(this.#vertexBuffer);
      if (this.#texture) this.#gl.deleteTexture(this.#texture);
      if (this.#program) this.#gl.deleteProgram(this.#program);
    }
    this.#map = undefined;
    this.#gl = undefined;
    this.#program = undefined;
    this.#vertexBuffer = undefined;
    this.#texture = undefined;
    this.#textureWidth = 0;
    this.#textureHeight = 0;
  }
}
