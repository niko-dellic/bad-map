import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  Map as MapLibreMap,
} from "maplibre-gl";
import {
  framePointToWorld,
  lngLatToWorld,
  reprojectionTransform,
} from "./geometry.js";
import { FillClass, LabelInk, LineClass } from "./style.js";
import type {
  DataRasterFrame,
  LowResFogMode,
  LowResTheme,
  RGB,
  RasterFrame,
} from "./types.js";

interface FogRenderState {
  visible: boolean;
  mode: LowResFogMode;
  start: number;
  end: number;
  opacity: number;
  color: RGB;
}

interface FrameProvider {
  frame(): RasterFrame | undefined;
  detailFrame(): RasterFrame | undefined;
  dataFrame(): DataRasterFrame | undefined;
  viewState(): RasterFrame["state"] | undefined;
  theme(): LowResTheme;
  labelsVisible(): boolean;
  labelsBillboard(): boolean;
  styleRevision(): number;
  hoveredOwner(frame?: RasterFrame): number;
  selectedOwner(frame?: RasterFrame): number;
  projectionMode(): "screen" | "surface";
  scalarPalette(): readonly [RGB, RGB, RGB, RGB];
  fog(): FogRenderState;
}

/** A stable no-op custom layer used as a public insertion boundary. */
export class SlotLayer implements CustomLayerInterface {
  readonly type = "custom" as const;
  readonly renderingMode = "2d" as const;
  constructor(readonly id: string) {}
  render(): void {}
}

const VERTEX = `#version 300 es
precision highp float;
precision highp int;
in vec2 a_position;
out vec2 v_uv;
out vec2 v_surface_pixel;
uniform int u_surface;
uniform mat4 u_map_matrix;
uniform vec4 u_world_bounds;
uniform vec2 u_frame_view_size;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  v_surface_pixel = vec2(v_uv.x * u_frame_view_size.x, (1.0 - v_uv.y) * u_frame_view_size.y);
  if (u_surface == 1) {
    vec2 world = vec2(mix(u_world_bounds.x, u_world_bounds.z, v_uv.x),
                      mix(u_world_bounds.w, u_world_bounds.y, v_uv.y));
    gl_Position = u_map_matrix * vec4(world, 0.0, 1.0);
  } else {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
}`;

const LABEL_VERTEX = `#version 300 es
precision highp float;
in vec2 a_position;
out vec2 v_uv;
out vec2 v_surface_pixel;
uniform int u_surface;
uniform int u_billboard;
uniform mat4 u_map_matrix;
uniform vec4 u_world_bounds;
uniform vec2 u_frame_view_size;
uniform vec2 u_current_view_size;
uniform vec2 u_billboard_anchor;
uniform vec2 u_billboard_center_offset;
uniform vec2 u_billboard_half_size;
uniform vec4 u_billboard_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  v_surface_pixel = vec2(v_uv.x * u_frame_view_size.x, (1.0 - v_uv.y) * u_frame_view_size.y);
  if (u_billboard == 1) {
    vec4 anchor = u_map_matrix * vec4(u_billboard_anchor, 0.0, 1.0);
    vec2 pixel_offset = u_billboard_center_offset +
      vec2(a_position.x * u_billboard_half_size.x,
           -a_position.y * u_billboard_half_size.y);
    anchor.xy += vec2(2.0 * pixel_offset.x / u_current_view_size.x,
                      -2.0 * pixel_offset.y / u_current_view_size.y) * anchor.w;
    gl_Position = anchor;
    vec2 unit = vec2(a_position.x * 0.5 + 0.5,
                     0.5 - a_position.y * 0.5);
    v_uv = mix(u_billboard_uv.xy, u_billboard_uv.zw, unit);
  } else if (u_surface == 1) {
    vec2 world = vec2(mix(u_world_bounds.x, u_world_bounds.z, v_uv.x),
                      mix(u_world_bounds.w, u_world_bounds.y, v_uv.y));
    gl_Position = u_map_matrix * vec4(world, 0.0, 1.0);
  } else {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
}`;

const BASE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_fill;
uniform sampler2D u_mask;
uniform sampler2D u_line_class;
uniform sampler2D u_line_tone;
uniform sampler2D u_ribbon;
uniform highp usampler2D u_owner;
uniform vec2 u_current_view_size;
uniform vec2 u_frame_view_size;
uniform float u_pixel_ratio;
uniform mat2 u_reproject_matrix;
uniform vec2 u_reproject_offset;
uniform vec2 u_cell_size;
uniform float u_dot_size;
uniform ivec2 u_grid_size;
uniform vec3 u_fill_colors[5];
uniform vec3 u_line_colors[18];
uniform vec3 u_hover_color;
uniform vec3 u_selected_color;
uniform uint u_hover_owner;
uniform uint u_selected_owner;
uniform int u_surface;
uniform float u_edge_fade;
in vec2 v_uv;
in vec2 v_surface_pixel;
out vec4 out_color;

int brailleBit(int column, int row) {
  if (column == 0) {
    if (row == 0) return 1;
    if (row == 1) return 2;
    if (row == 2) return 4;
    return 64;
  }
  if (row == 0) return 8;
  if (row == 1) return 16;
  if (row == 2) return 32;
  return 128;
}

void main() {
  vec2 top_pixel = vec2(gl_FragCoord.x / u_pixel_ratio,
                        u_current_view_size.y - gl_FragCoord.y / u_pixel_ratio);
  vec2 source_pixel = u_surface == 1 ? v_surface_pixel : u_reproject_matrix * top_pixel + u_reproject_offset;
  ivec2 source_cell = ivec2(floor(source_pixel / u_cell_size));
  if (source_cell.x < 0 || source_cell.y < 0 || source_cell.x >= u_grid_size.x || source_cell.y >= u_grid_size.y) {
    out_color = vec4(u_fill_colors[0], 1.0);
    return;
  }
  vec2 source_local = source_pixel - vec2(source_cell) * u_cell_size;
  int fill_half = source_local.y >= u_cell_size.y * 0.5 ? 1 : 0;
  int fill_class = int(texelFetch(u_fill, ivec2(source_cell.x, source_cell.y * 2 + fill_half), 0).r * 255.0 + 0.5);
  vec3 color = u_fill_colors[clamp(fill_class, 0, 4)];
  if (texelFetch(u_ribbon, source_cell, 0).r > 0.5) color = mix(color, u_line_colors[16], 0.30);

  vec2 lattice_pixel = u_surface == 1 ? source_pixel : top_pixel;
  vec2 output_local = lattice_pixel - floor(lattice_pixel / u_cell_size) * u_cell_size;
  int dot_column = clamp(int(floor(output_local.x / (u_cell_size.x * 0.5))), 0, 1);
  int dot_row = clamp(int(floor(output_local.y / (u_cell_size.y * 0.25))), 0, 3);
  vec2 center = vec2((float(dot_column) + 0.5) * u_cell_size.x * 0.5,
                     (float(dot_row) + 0.5) * u_cell_size.y * 0.25);
  vec2 distance_to_dot = abs(output_local - center);
  bool in_dot = distance_to_dot.x <= u_dot_size * 0.5 && distance_to_dot.y <= u_dot_size * 0.5;
  int source_dot_column = clamp(int(floor(source_local.x / (u_cell_size.x * 0.5))), 0, 1);
  int source_dot_row = clamp(int(floor(source_local.y / (u_cell_size.y * 0.25))), 0, 3);
  int mask = int(texelFetch(u_mask, source_cell, 0).r * 255.0 + 0.5);
  bool bit_on = (mask & brailleBit(source_dot_column, source_dot_row)) != 0;
  if (in_dot && bit_on) {
    int line_class = int(texelFetch(u_line_class, source_cell, 0).r * 255.0 + 0.5);
    vec3 ink = u_line_colors[clamp(line_class, 0, 17)];
    if (texelFetch(u_line_tone, source_cell, 0).r > 0.5) ink = mix(u_fill_colors[0], ink, 0.45);
    color = ink;
  }
  uint owner = texelFetch(u_owner, source_cell, 0).r;
  if (owner != 0u && owner == u_selected_owner) color = mix(color, u_selected_color, 0.58);
  else if (owner != 0u && owner == u_hover_owner) color = mix(color, u_hover_color, 0.42);
  float edge = min(min(v_uv.x, 1.0 - v_uv.x), min(v_uv.y, 1.0 - v_uv.y));
  float alpha = u_edge_fade > 0.0 ? smoothstep(0.0, u_edge_fade, edge) : 1.0;
  out_color = vec4(color, alpha);
}`;

const DATA_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_scalar;
uniform sampler2D u_overlay;
uniform vec2 u_current_view_size;
uniform vec2 u_frame_view_size;
uniform float u_pixel_ratio;
uniform mat2 u_reproject_matrix;
uniform vec2 u_reproject_offset;
uniform vec2 u_cell_size;
uniform float u_dot_size;
uniform ivec2 u_grid_size;
uniform vec3 u_scalar_colors[4];
uniform int u_surface;
in vec2 v_surface_pixel;
out vec4 out_color;

vec3 paletteColor(float value, vec3 colors[4]) {
  float segment = value * 3.0;
  int left = min(2, int(floor(segment)));
  return mix(colors[left], colors[left + 1], segment - float(left));
}

void main() {
  vec2 top_pixel = vec2(gl_FragCoord.x / u_pixel_ratio,
                        u_current_view_size.y - gl_FragCoord.y / u_pixel_ratio);
  vec2 source_pixel = u_surface == 1 ? v_surface_pixel : u_reproject_matrix * top_pixel + u_reproject_offset;
  ivec2 source_cell = ivec2(floor(source_pixel / u_cell_size));
  if (source_cell.x < 0 || source_cell.y < 0 || source_cell.x >= u_grid_size.x || source_cell.y >= u_grid_size.y) {
    out_color = vec4(0.0);
    return;
  }

  vec3 color = vec3(0.0);
  float alpha = 0.0;
  float scalar = texelFetch(u_scalar, source_cell, 0).r;
  if (scalar > 0.0) {
    float value = clamp((scalar * 255.0 - 1.0) / 254.0, 0.0, 1.0);
    color = paletteColor(value, u_scalar_colors);
    alpha = 0.48;
  }

  vec2 lattice_pixel = u_surface == 1 ? source_pixel : top_pixel;
  vec2 output_local = lattice_pixel - floor(lattice_pixel / u_cell_size) * u_cell_size;
  int dot_column = clamp(int(floor(output_local.x / (u_cell_size.x * 0.5))), 0, 1);
  int dot_row = clamp(int(floor(output_local.y / (u_cell_size.y * 0.25))), 0, 3);
  vec2 center = vec2((float(dot_column) + 0.5) * u_cell_size.x * 0.5,
                     (float(dot_row) + 0.5) * u_cell_size.y * 0.25);
  vec2 distance_to_dot = abs(output_local - center);
  bool in_dot = distance_to_dot.x <= u_dot_size * 0.5 && distance_to_dot.y <= u_dot_size * 0.5;
  vec2 source_local = source_pixel - vec2(source_cell) * u_cell_size;
  int source_dot_column = clamp(int(floor(source_local.x / (u_cell_size.x * 0.5))), 0, 1);
  int source_dot_row = clamp(int(floor(source_local.y / (u_cell_size.y * 0.25))), 0, 3);
  ivec2 source_dot = ivec2(source_cell.x * 2 + source_dot_column,
                            source_cell.y * 4 + source_dot_row);
  vec4 overlay = texelFetch(u_overlay, source_dot, 0);
  if (overlay.a > 0.0 && in_dot) {
    float combined_alpha = overlay.a + alpha * (1.0 - overlay.a);
    color = (overlay.rgb * overlay.a + color * alpha * (1.0 - overlay.a)) /
            max(combined_alpha, 0.0001);
    alpha = combined_alpha;
  }
  out_color = vec4(color, alpha);
}`;

const MARKER_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_overlay;
uniform vec2 u_current_view_size;
uniform vec2 u_frame_view_size;
uniform float u_pixel_ratio;
uniform mat2 u_reproject_matrix;
uniform vec2 u_reproject_offset;
uniform vec2 u_cell_size;
uniform float u_dot_size;
uniform ivec2 u_grid_size;
uniform int u_surface;
in vec2 v_surface_pixel;
out vec4 out_color;
void main() {
  vec2 top_pixel = vec2(gl_FragCoord.x / u_pixel_ratio,
                        u_current_view_size.y - gl_FragCoord.y / u_pixel_ratio);
  vec2 source_pixel = u_surface == 1 ? v_surface_pixel : u_reproject_matrix * top_pixel + u_reproject_offset;
  ivec2 source_cell = ivec2(floor(source_pixel / u_cell_size));
  if (source_cell.x < 0 || source_cell.y < 0 || source_cell.x >= u_grid_size.x || source_cell.y >= u_grid_size.y) {
    out_color = vec4(0.0);
    return;
  }
  vec2 source_local = source_pixel - vec2(source_cell) * u_cell_size;
  int source_dot_column = clamp(int(floor(source_local.x / (u_cell_size.x * 0.5))), 0, 1);
  int source_dot_row = clamp(int(floor(source_local.y / (u_cell_size.y * 0.25))), 0, 3);
  vec2 lattice_pixel = u_surface == 1 ? source_pixel : top_pixel;
  vec2 output_local = lattice_pixel - floor(lattice_pixel / u_cell_size) * u_cell_size;
  int dot_column = clamp(int(floor(output_local.x / (u_cell_size.x * 0.5))), 0, 1);
  int dot_row = clamp(int(floor(output_local.y / (u_cell_size.y * 0.25))), 0, 3);
  vec2 center = vec2((float(dot_column) + 0.5) * u_cell_size.x * 0.5,
                     (float(dot_row) + 0.5) * u_cell_size.y * 0.25);
  bool in_dot = all(lessThanEqual(abs(output_local - center), vec2(u_dot_size * 0.5)));
  ivec2 source_dot = ivec2(source_cell.x * 2 + source_dot_column,
                            source_cell.y * 4 + source_dot_row);
  vec4 overlay = texelFetch(u_overlay, source_dot, 0);
  out_color = in_dot ? overlay : vec4(0.0);
}`;

const LABEL_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_texture;
uniform vec2 u_current_view_size;
uniform vec2 u_frame_view_size;
uniform float u_pixel_ratio;
uniform mat2 u_reproject_matrix;
uniform vec2 u_reproject_offset;
uniform float u_opacity;
uniform int u_surface;
uniform int u_billboard;
in vec2 v_uv;
in vec2 v_surface_pixel;
out vec4 out_color;
void main() {
  if (u_billboard == 1) {
    out_color = texture(u_texture, v_uv);
    out_color.a *= u_opacity;
    return;
  }
  vec2 top_pixel = vec2(gl_FragCoord.x / u_pixel_ratio,
                        u_current_view_size.y - gl_FragCoord.y / u_pixel_ratio);
  vec2 source_pixel = u_surface == 1 ? v_surface_pixel : u_reproject_matrix * top_pixel + u_reproject_offset;
  if (source_pixel.x < 0.0 || source_pixel.y < 0.0 ||
      source_pixel.x >= u_frame_view_size.x || source_pixel.y >= u_frame_view_size.y) {
    out_color = vec4(0.0);
    return;
  }
  out_color = texture(u_texture, source_pixel / u_frame_view_size);
  out_color.a *= u_opacity;
}`;

export const BAYER_4X4 = [
  0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5,
] as const;

const FOG_VERTEX = `#version 300 es
precision highp float;
in vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FOG_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform mat4 u_inverse_map_matrix;
uniform vec4 u_world_bounds;
uniform vec2 u_view_size;
uniform float u_pixel_ratio;
uniform float u_start;
uniform float u_end;
uniform float u_opacity;
uniform float u_pitch_mix;
uniform vec3 u_color;
uniform int u_dithered;
out vec4 out_color;

bool groundIntersection(vec2 ndc, out vec3 ground) {
  vec4 near_h = u_inverse_map_matrix * vec4(ndc, -1.0, 1.0);
  vec4 far_h = u_inverse_map_matrix * vec4(ndc, 1.0, 1.0);
  if (abs(near_h.w) < 0.000001 || abs(far_h.w) < 0.000001) return false;
  vec3 near_point = near_h.xyz / near_h.w;
  vec3 far_point = far_h.xyz / far_h.w;
  vec3 ray = far_point - near_point;
  if (abs(ray.z) < 0.000001) return false;
  float t = -near_point.z / ray.z;
  if (t < 0.0) return false;
  ground = near_point + ray * t;
  return true;
}

float bayerThreshold(ivec2 pixel) {
  const float values[16] = float[16](${BAYER_4X4.map((value) => `${value}.0`).join(", ")});
  int x = pixel.x - (pixel.x / 4) * 4;
  int y = pixel.y - (pixel.y / 4) * 4;
  return (values[y * 4 + x] + 0.5) / 16.0;
}

void main() {
  vec2 css_pixel = gl_FragCoord.xy / u_pixel_ratio;
  vec2 ndc = css_pixel / u_view_size * 2.0 - 1.0;
  vec3 ground;
  float screen_depth = clamp(css_pixel.y / u_view_size.y, 0.0, 1.0);
  float fog_amount = 1.0;
  if (groundIntersection(ndc, ground)) {
    float distance_fog = smoothstep(u_start, u_end, screen_depth);
    vec2 extent = max(u_world_bounds.zw - u_world_bounds.xy, vec2(0.000001));
    vec2 frame_uv = (ground.xy - u_world_bounds.xy) / extent;
    float edge_distance = min(min(frame_uv.x, 1.0 - frame_uv.x),
                              min(frame_uv.y, 1.0 - frame_uv.y));
    float boundary_fog = 1.0 - smoothstep(0.0, 0.06, edge_distance);
    fog_amount = max(distance_fog, boundary_fog);
  }

  fog_amount = clamp(fog_amount * u_pitch_mix, 0.0, 1.0);
  float alpha = fog_amount * u_opacity;
  if (u_dithered == 1) {
    ivec2 css_integer = ivec2(floor(css_pixel));
    alpha = fog_amount >= bayerThreshold(css_integer) ? u_opacity : 0.0;
  }
  if (alpha <= 0.0) discard;
  out_color = vec4(u_color, alpha);
}`;

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to allocate shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Shader compilation failed";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function program(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragment: string,
): WebGLProgram {
  const output = gl.createProgram();
  if (!output) throw new Error("Unable to allocate WebGL program");
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const pixel = compile(gl, gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(output, vertex);
  gl.attachShader(output, pixel);
  gl.linkProgram(output);
  gl.deleteShader(vertex);
  gl.deleteShader(pixel);
  if (!gl.getProgramParameter(output, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(output) ?? "Program link failed");
  return output;
}

function texture(gl: WebGL2RenderingContext): WebGLTexture {
  const output = gl.createTexture();
  if (!output) throw new Error("Unable to allocate texture");
  gl.bindTexture(gl.TEXTURE_2D, output);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return output;
}

function normalized(colors: readonly RGB[]): Float32Array {
  return new Float32Array(
    colors.flatMap((color) => color.map((channel) => channel / 255)),
  );
}

export function bayer4Threshold(x: number, y: number): number {
  const column = ((Math.floor(x) % 4) + 4) % 4;
  const row = ((Math.floor(y) % 4) + 4) % 4;
  return (BAYER_4X4[row * 4 + column]! + 0.5) / 16;
}

export function fogBoundaryAmount(
  point: readonly [number, number],
  bounds: readonly [number, number, number, number],
  halo = 0.06,
): number {
  const width = Math.max(Number.EPSILON, bounds[2] - bounds[0]);
  const height = Math.max(Number.EPSILON, bounds[3] - bounds[1]);
  const x = (point[0] - bounds[0]) / width;
  const y = (point[1] - bounds[1]) / height;
  const edgeDistance = Math.min(x, 1 - x, y, 1 - y);
  return 1 - smoothstep(0, Math.max(Number.EPSILON, halo), edgeDistance);
}

export function invertMatrix4(
  matrix: ArrayLike<number>,
): Float32Array | undefined {
  if (matrix.length < 16) return undefined;
  const a00 = matrix[0]!,
    a01 = matrix[1]!,
    a02 = matrix[2]!,
    a03 = matrix[3]!;
  const a10 = matrix[4]!,
    a11 = matrix[5]!,
    a12 = matrix[6]!,
    a13 = matrix[7]!;
  const a20 = matrix[8]!,
    a21 = matrix[9]!,
    a22 = matrix[10]!,
    a23 = matrix[11]!;
  const a30 = matrix[12]!,
    a31 = matrix[13]!,
    a32 = matrix[14]!,
    a33 = matrix[15]!;
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  const determinant =
    b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-15)
    return undefined;
  const inverseDeterminant = 1 / determinant;
  return new Float32Array([
    (a11 * b11 - a12 * b10 + a13 * b09) * inverseDeterminant,
    (a02 * b10 - a01 * b11 - a03 * b09) * inverseDeterminant,
    (a31 * b05 - a32 * b04 + a33 * b03) * inverseDeterminant,
    (a22 * b04 - a21 * b05 - a23 * b03) * inverseDeterminant,
    (a12 * b08 - a10 * b11 - a13 * b07) * inverseDeterminant,
    (a00 * b11 - a02 * b08 + a03 * b07) * inverseDeterminant,
    (a32 * b02 - a30 * b05 - a33 * b01) * inverseDeterminant,
    (a20 * b05 - a22 * b02 + a23 * b01) * inverseDeterminant,
    (a10 * b10 - a11 * b08 + a13 * b06) * inverseDeterminant,
    (a01 * b08 - a00 * b10 - a03 * b06) * inverseDeterminant,
    (a30 * b04 - a31 * b02 + a33 * b00) * inverseDeterminant,
    (a21 * b02 - a20 * b04 - a23 * b00) * inverseDeterminant,
    (a11 * b07 - a10 * b09 - a12 * b06) * inverseDeterminant,
    (a00 * b09 - a01 * b07 + a02 * b06) * inverseDeterminant,
    (a31 * b01 - a30 * b03 - a32 * b00) * inverseDeterminant,
    (a20 * b03 - a21 * b01 + a22 * b00) * inverseDeterminant,
  ]);
}

export interface GroundRayIntersection {
  point: readonly [number, number, number];
  distance: number;
}

export function groundRayIntersection(
  inverseMatrix: ArrayLike<number>,
  ndc: readonly [number, number],
): GroundRayIntersection | undefined {
  const unproject = (z: number): [number, number, number] | undefined => {
    const x = ndc[0],
      y = ndc[1];
    const w =
      inverseMatrix[3]! * x +
      inverseMatrix[7]! * y +
      inverseMatrix[11]! * z +
      inverseMatrix[15]!;
    if (!Number.isFinite(w) || Math.abs(w) < 1e-12) return undefined;
    return [
      (inverseMatrix[0]! * x +
        inverseMatrix[4]! * y +
        inverseMatrix[8]! * z +
        inverseMatrix[12]!) /
        w,
      (inverseMatrix[1]! * x +
        inverseMatrix[5]! * y +
        inverseMatrix[9]! * z +
        inverseMatrix[13]!) /
        w,
      (inverseMatrix[2]! * x +
        inverseMatrix[6]! * y +
        inverseMatrix[10]! * z +
        inverseMatrix[14]!) /
        w,
    ];
  };
  const near = unproject(-1);
  const far = unproject(1);
  if (!near || !far) return undefined;
  const ray: [number, number, number] = [
    far[0] - near[0],
    far[1] - near[1],
    far[2] - near[2],
  ];
  if (Math.abs(ray[2]) < 1e-12) return undefined;
  const t = -near[2] / ray[2];
  if (!Number.isFinite(t) || t < 0) return undefined;
  const travel: [number, number, number] = [ray[0] * t, ray[1] * t, ray[2] * t];
  return {
    point: [near[0] + travel[0], near[1] + travel[1], 0],
    distance: Math.hypot(...travel),
  };
}

function fillColors(theme: LowResTheme): RGB[] {
  return [
    theme.fills.ground,
    theme.fills.urban,
    theme.fills.park,
    theme.fills.water,
    theme.fills.building,
  ];
}

function lineColors(theme: LowResTheme): RGB[] {
  const colors: RGB[] = Array.from({ length: 18 }, () => theme.lines.minor);
  colors[LineClass.None] = theme.lines.minor;
  colors[LineClass.Waterway] = theme.lines.waterway;
  colors[LineClass.Ferry] = theme.lines.ferry;
  colors[LineClass.BorderState] = theme.lines.borderState;
  colors[LineClass.BorderCountry] = theme.lines.borderCountry;
  colors[LineClass.Coast] = theme.lines.coast;
  colors[LineClass.Path] = theme.lines.path;
  colors[LineClass.Transit] = theme.lines.transit;
  colors[LineClass.Rail] = theme.lines.rail;
  colors[LineClass.Aeroway] = theme.lines.aeroway;
  colors[LineClass.Service] = theme.lines.service;
  colors[LineClass.Minor] = theme.lines.minor;
  colors[LineClass.Secondary] = theme.lines.secondary;
  colors[LineClass.Ramp] = theme.lines.ramp;
  colors[LineClass.Primary] = theme.lines.primary;
  colors[LineClass.Trunk] = theme.lines.trunk;
  colors[LineClass.Motorway] = theme.lines.motorway;
  colors[LineClass.Route] = theme.lines.route;
  return colors;
}

abstract class ScreenLayer implements CustomLayerInterface {
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;
  protected gl: WebGL2RenderingContext | undefined;
  protected shader: WebGLProgram | undefined;
  protected vertexBuffer: WebGLBuffer | undefined;

  constructor(
    readonly id: string,
    protected provider: FrameProvider,
  ) {}

  onAdd(
    _map: MapLibreMap,
    context: WebGLRenderingContext | WebGL2RenderingContext,
  ): void {
    if (!("texImage3D" in context)) throw new Error("bad-map requires WebGL 2");
    this.gl = context;
    this.shader = program(context, this.vertexSource(), this.fragmentSource());
    this.vertexBuffer = context.createBuffer() ?? undefined;
    context.bindBuffer(context.ARRAY_BUFFER, this.vertexBuffer ?? null);
    context.bufferData(
      context.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      context.STATIC_DRAW,
    );
    this.allocate(context);
  }

  render(
    context: WebGLRenderingContext | WebGL2RenderingContext,
    options: CustomRenderMethodInput,
  ): void {
    if (!this.gl || !this.shader || !this.vertexBuffer || context !== this.gl)
      return;
    const gl = this.gl;
    gl.useProgram(this.shader);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    const position = gl.getAttribLocation(this.shader, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    if (this.draw(gl, this.shader, options) !== false)
      gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  onRemove(): void {
    if (!this.gl) return;
    if (this.vertexBuffer) this.gl.deleteBuffer(this.vertexBuffer);
    if (this.shader) this.gl.deleteProgram(this.shader);
    this.release(this.gl);
    this.gl = undefined;
  }

  protected vertexSource(): string {
    return VERTEX;
  }
  protected abstract fragmentSource(): string;
  protected abstract allocate(gl: WebGL2RenderingContext): void;
  protected abstract draw(
    gl: WebGL2RenderingContext,
    shader: WebGLProgram,
    options: CustomRenderMethodInput,
  ): void | boolean;
  protected abstract release(gl: WebGL2RenderingContext): void;
}

export class BaseLayer extends ScreenLayer {
  #textures: WebGLTexture[] = [];
  #detailTextures: WebGLTexture[] = [];
  #uploadedGeneration = -1;
  #uploadedDetailGeneration = -1;

  protected fragmentSource(): string {
    return BASE_FRAGMENT;
  }
  protected allocate(gl: WebGL2RenderingContext): void {
    this.#textures = Array.from({ length: 6 }, () => texture(gl));
    this.#detailTextures = Array.from({ length: 6 }, () => texture(gl));
  }

  protected draw(
    gl: WebGL2RenderingContext,
    shader: WebGLProgram,
    options: CustomRenderMethodInput,
  ): void | boolean {
    const frame = this.provider.frame();
    if (!frame) return false;
    const current = this.provider.viewState() ?? frame.state;
    const detailFrame = this.provider.detailFrame();
    if (frame.generation !== this.#uploadedGeneration) {
      this.#uploadFrame(gl, this.#textures, frame);
      this.#uploadedGeneration = frame.generation;
    }
    if (
      detailFrame &&
      detailFrame.generation !== this.#uploadedDetailGeneration
    ) {
      this.#uploadFrame(gl, this.#detailTextures, detailFrame);
      this.#uploadedDetailGeneration = detailFrame.generation;
    }
    this.#prepareFrame(gl, shader, options, frame, current, this.#textures, 0);
    gl.disable(gl.BLEND);
    if (!detailFrame) return;
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.#prepareFrame(
      gl,
      shader,
      options,
      detailFrame,
      current,
      this.#detailTextures,
      0.08,
    );
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return false;
  }

  #prepareFrame(
    gl: WebGL2RenderingContext,
    shader: WebGLProgram,
    options: CustomRenderMethodInput,
    frame: RasterFrame,
    current: RasterFrame["state"],
    textures: WebGLTexture[],
    edgeFade: number,
  ): void {
    setProjectionUniforms(gl, shader, frame, this.provider, options);
    const transform = reprojectionTransform(frame.state, current);
    const names = [
      "u_fill",
      "u_mask",
      "u_line_class",
      "u_line_tone",
      "u_ribbon",
      "u_owner",
    ];
    textures.forEach((value, index) => {
      gl.activeTexture(gl.TEXTURE0 + index);
      gl.bindTexture(gl.TEXTURE_2D, value);
      gl.uniform1i(gl.getUniformLocation(shader, names[index]!), index);
    });
    const ratio = current.pixelRatio;
    gl.uniform2f(
      gl.getUniformLocation(shader, "u_current_view_size"),
      current.width,
      current.height,
    );
    gl.uniform2f(
      gl.getUniformLocation(shader, "u_frame_view_size"),
      frame.state.width,
      frame.state.height,
    );
    gl.uniform1f(gl.getUniformLocation(shader, "u_pixel_ratio"), ratio);
    gl.uniformMatrix2fv(
      gl.getUniformLocation(shader, "u_reproject_matrix"),
      false,
      transform.matrix,
    );
    gl.uniform2f(
      gl.getUniformLocation(shader, "u_reproject_offset"),
      transform.offset[0],
      transform.offset[1],
    );
    gl.uniform2f(
      gl.getUniformLocation(shader, "u_cell_size"),
      frame.state.cell.width,
      frame.state.cell.height,
    );
    gl.uniform1f(
      gl.getUniformLocation(shader, "u_dot_size"),
      frame.state.cell.dotSize,
    );
    gl.uniform2i(
      gl.getUniformLocation(shader, "u_grid_size"),
      frame.columns,
      frame.rows,
    );
    gl.uniform3fv(
      gl.getUniformLocation(shader, "u_fill_colors[0]"),
      normalized(fillColors(this.provider.theme())),
    );
    gl.uniform3fv(
      gl.getUniformLocation(shader, "u_line_colors[0]"),
      normalized(lineColors(this.provider.theme())),
    );
    gl.uniform3fv(
      gl.getUniformLocation(shader, "u_hover_color"),
      normalized([this.provider.theme().hover]),
    );
    gl.uniform3fv(
      gl.getUniformLocation(shader, "u_selected_color"),
      normalized([this.provider.theme().marker]),
    );
    gl.uniform1ui(
      gl.getUniformLocation(shader, "u_hover_owner"),
      this.provider.hoveredOwner(frame),
    );
    gl.uniform1ui(
      gl.getUniformLocation(shader, "u_selected_owner"),
      this.provider.selectedOwner(frame),
    );
    gl.uniform1f(gl.getUniformLocation(shader, "u_edge_fade"), edgeFade);
  }

  #uploadFrame(
    gl: WebGL2RenderingContext,
    textures: WebGLTexture[],
    frame: RasterFrame,
  ): void {
    this.#upload(gl, textures, 0, frame.columns, frame.rows * 2, frame.fill);
    this.#upload(gl, textures, 1, frame.columns, frame.rows, frame.lineMask);
    this.#upload(gl, textures, 2, frame.columns, frame.rows, frame.lineClass);
    this.#upload(gl, textures, 3, frame.columns, frame.rows, frame.lineTone);
    this.#upload(gl, textures, 4, frame.columns, frame.rows, frame.ribbon);
    this.#uploadOwner(gl, textures, 5, frame.columns, frame.rows, frame.owner);
  }

  #upload(
    gl: WebGL2RenderingContext,
    textures: WebGLTexture[],
    index: number,
    width: number,
    height: number,
    data: Uint8Array,
  ): void {
    gl.activeTexture(gl.TEXTURE0 + index);
    gl.bindTexture(gl.TEXTURE_2D, textures[index]!);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      width,
      height,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      data,
    );
  }

  #uploadOwner(
    gl: WebGL2RenderingContext,
    textures: WebGLTexture[],
    index: number,
    width: number,
    height: number,
    data: Uint32Array,
  ): void {
    gl.activeTexture(gl.TEXTURE0 + index);
    gl.bindTexture(gl.TEXTURE_2D, textures[index]!);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R32UI,
      width,
      height,
      0,
      gl.RED_INTEGER,
      gl.UNSIGNED_INT,
      data,
    );
  }

  protected release(gl: WebGL2RenderingContext): void {
    this.#textures.forEach((value) => gl.deleteTexture(value));
    this.#detailTextures.forEach((value) => gl.deleteTexture(value));
  }
}

/** Transparent compositor for package-owned visualization data. */
export class DataLayer extends ScreenLayer {
  #textures: WebGLTexture[] = [];
  #uploadedGeneration = -1;
  #uploadedDataGeneration = -1;

  protected fragmentSource(): string {
    return DATA_FRAGMENT;
  }

  protected allocate(gl: WebGL2RenderingContext): void {
    this.#textures = [texture(gl), texture(gl)];
  }

  protected draw(
    gl: WebGL2RenderingContext,
    shader: WebGLProgram,
    options: CustomRenderMethodInput,
  ): void | boolean {
    const frame = this.provider.detailFrame() ?? this.provider.frame();
    if (!frame) return false;
    const dataFrame = this.provider.dataFrame();
    const sourceFrame = dataFrame ?? frame;
    const current = this.provider.viewState() ?? sourceFrame.state;
    setProjectionUniforms(gl, shader, sourceFrame, this.provider, options);
    const transform = reprojectionTransform(sourceFrame.state, current);
    if (frame.generation !== this.#uploadedGeneration) {
      this.#upload(gl, 0, frame.columns, frame.rows, frame.scalar);
      this.#uploadedGeneration = frame.generation;
    }
    if (dataFrame && dataFrame.generation !== this.#uploadedDataGeneration) {
      this.#uploadRgba(
        gl,
        1,
        dataFrame.dotColumns,
        dataFrame.dotRows,
        dataFrame.data,
      );
      this.#uploadedDataGeneration = dataFrame.generation;
    } else if (!dataFrame && this.#uploadedDataGeneration !== 0) {
      this.#uploadRgba(gl, 1, 1, 1, new Uint8Array(4));
      this.#uploadedDataGeneration = 0;
    }
    for (const [index, name] of ["u_scalar", "u_overlay"].entries()) {
      gl.activeTexture(gl.TEXTURE0 + index);
      gl.bindTexture(gl.TEXTURE_2D, this.#textures[index]!);
      gl.uniform1i(gl.getUniformLocation(shader, name), index);
    }
    gl.uniform2f(
      gl.getUniformLocation(shader, "u_current_view_size"),
      current.width,
      current.height,
    );
    gl.uniform2f(
      gl.getUniformLocation(shader, "u_frame_view_size"),
      sourceFrame.state.width,
      sourceFrame.state.height,
    );
    gl.uniform1f(
      gl.getUniformLocation(shader, "u_pixel_ratio"),
      current.pixelRatio,
    );
    gl.uniformMatrix2fv(
      gl.getUniformLocation(shader, "u_reproject_matrix"),
      false,
      transform.matrix,
    );
    gl.uniform2f(
      gl.getUniformLocation(shader, "u_reproject_offset"),
      transform.offset[0],
      transform.offset[1],
    );
    gl.uniform2f(
      gl.getUniformLocation(shader, "u_cell_size"),
      sourceFrame.state.cell.width,
      sourceFrame.state.cell.height,
    );
    gl.uniform1f(
      gl.getUniformLocation(shader, "u_dot_size"),
      sourceFrame.state.cell.dotSize,
    );
    gl.uniform2i(
      gl.getUniformLocation(shader, "u_grid_size"),
      dataFrame ? Math.ceil(dataFrame.dotColumns / 2) : frame.columns,
      dataFrame ? Math.ceil(dataFrame.dotRows / 4) : frame.rows,
    );
    gl.uniform3fv(
      gl.getUniformLocation(shader, "u_scalar_colors[0]"),
      normalized(this.provider.scalarPalette()),
    );
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  #upload(
    gl: WebGL2RenderingContext,
    index: number,
    width: number,
    height: number,
    data: Uint8Array,
  ): void {
    gl.activeTexture(gl.TEXTURE0 + index);
    gl.bindTexture(gl.TEXTURE_2D, this.#textures[index]!);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      width,
      height,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      data,
    );
  }

  #uploadRgba(
    gl: WebGL2RenderingContext,
    index: number,
    width: number,
    height: number,
    data: Uint8Array,
  ): void {
    gl.activeTexture(gl.TEXTURE0 + index);
    gl.bindTexture(gl.TEXTURE_2D, this.#textures[index]!);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data,
    );
  }

  protected release(gl: WebGL2RenderingContext): void {
    this.#textures.forEach((value) => gl.deleteTexture(value));
  }
}

export class MarkerLayer extends ScreenLayer {
  #texture: WebGLTexture | undefined;
  #uploadedGeneration = -1;

  protected fragmentSource(): string {
    return MARKER_FRAGMENT;
  }
  protected allocate(gl: WebGL2RenderingContext): void {
    this.#texture = texture(gl);
  }
  protected draw(
    gl: WebGL2RenderingContext,
    shader: WebGLProgram,
    options: CustomRenderMethodInput,
  ): void | boolean {
    const frame = this.provider.frame();
    const dataFrame = this.provider.dataFrame();
    if (!frame || !dataFrame || !this.#texture) return false;
    const current = this.provider.viewState() ?? dataFrame.state;
    setProjectionUniforms(gl, shader, dataFrame, this.provider, options);
    const transform = reprojectionTransform(dataFrame.state, current);
    if (dataFrame.generation !== this.#uploadedGeneration) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.#texture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        dataFrame.dotColumns,
        dataFrame.dotRows,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        dataFrame.markers,
      );
      this.#uploadedGeneration = dataFrame.generation;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#texture);
    gl.uniform1i(gl.getUniformLocation(shader, "u_overlay"), 0);
    gl.uniform2f(
      gl.getUniformLocation(shader, "u_current_view_size"),
      current.width,
      current.height,
    );
    gl.uniform2f(
      gl.getUniformLocation(shader, "u_frame_view_size"),
      dataFrame.state.width,
      dataFrame.state.height,
    );
    gl.uniform1f(
      gl.getUniformLocation(shader, "u_pixel_ratio"),
      current.pixelRatio,
    );
    gl.uniformMatrix2fv(
      gl.getUniformLocation(shader, "u_reproject_matrix"),
      false,
      transform.matrix,
    );
    gl.uniform2f(
      gl.getUniformLocation(shader, "u_reproject_offset"),
      transform.offset[0],
      transform.offset[1],
    );
    gl.uniform2f(
      gl.getUniformLocation(shader, "u_cell_size"),
      dataFrame.state.cell.width,
      dataFrame.state.cell.height,
    );
    gl.uniform1f(
      gl.getUniformLocation(shader, "u_dot_size"),
      dataFrame.state.cell.dotSize,
    );
    gl.uniform2i(
      gl.getUniformLocation(shader, "u_grid_size"),
      Math.ceil(dataFrame.dotColumns / 2),
      Math.ceil(dataFrame.dotRows / 4),
    );
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }
  protected release(gl: WebGL2RenderingContext): void {
    if (this.#texture) gl.deleteTexture(this.#texture);
  }
}

export class LabelsLayer extends ScreenLayer {
  #texture: WebGLTexture | undefined;
  #canvas: HTMLCanvasElement | undefined;
  #uploadedGeneration = -1;
  #uploadedStyleRevision = -1;

  protected vertexSource(): string {
    return LABEL_VERTEX;
  }

  protected fragmentSource(): string {
    return LABEL_FRAGMENT;
  }
  protected allocate(gl: WebGL2RenderingContext): void {
    this.#texture = texture(gl);
    this.#canvas = document.createElement("canvas");
  }

  protected draw(
    gl: WebGL2RenderingContext,
    shader: WebGLProgram,
    options: CustomRenderMethodInput,
  ): void | boolean {
    const frame = this.provider.detailFrame() ?? this.provider.frame();
    if (!frame || !this.#texture || !this.#canvas) return false;
    const current = this.provider.viewState() ?? frame.state;
    setProjectionUniforms(gl, shader, frame, this.provider, options);
    const transform = reprojectionTransform(frame.state, current);
    const revision = this.provider.styleRevision();
    if (
      frame.generation !== this.#uploadedGeneration ||
      revision !== this.#uploadedStyleRevision
    ) {
      renderLabels(
        this.#canvas,
        frame,
        this.provider.theme(),
        this.provider.labelsVisible(),
      );
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.#texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.#canvas,
      );
      this.#uploadedGeneration = frame.generation;
      this.#uploadedStyleRevision = revision;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#texture);
    gl.uniform1i(gl.getUniformLocation(shader, "u_texture"), 0);
    gl.uniform2f(
      gl.getUniformLocation(shader, "u_current_view_size"),
      current.width,
      current.height,
    );
    gl.uniform2f(
      gl.getUniformLocation(shader, "u_frame_view_size"),
      frame.state.width,
      frame.state.height,
    );
    gl.uniform1f(
      gl.getUniformLocation(shader, "u_pixel_ratio"),
      current.pixelRatio,
    );
    gl.uniformMatrix2fv(
      gl.getUniformLocation(shader, "u_reproject_matrix"),
      false,
      transform.matrix,
    );
    gl.uniform2f(
      gl.getUniformLocation(shader, "u_reproject_offset"),
      transform.offset[0],
      transform.offset[1],
    );
    const opacity =
      this.provider.projectionMode() === "surface"
        ? 1
        : 1 - smoothstep(0.08, 0.45, Math.abs(transform.zoomDelta));
    gl.uniform1f(gl.getUniformLocation(shader, "u_opacity"), opacity);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const billboard =
      this.provider.projectionMode() === "surface" &&
      this.provider.labelsBillboard();
    gl.uniform1i(
      gl.getUniformLocation(shader, "u_billboard"),
      billboard ? 1 : 0,
    );
    if (!billboard) return;

    const width = frame.state.cell.width;
    const height = frame.state.cell.height;
    gl.uniform2f(
      gl.getUniformLocation(shader, "u_billboard_half_size"),
      width / 2,
      height / 2,
    );
    for (const glyph of billboardGlyphs(frame)) {
      gl.uniform2f(
        gl.getUniformLocation(shader, "u_billboard_anchor"),
        glyph.anchor[0],
        glyph.anchor[1],
      );
      gl.uniform2f(
        gl.getUniformLocation(shader, "u_billboard_center_offset"),
        glyph.offset[0],
        glyph.offset[1],
      );
      gl.uniform4f(
        gl.getUniformLocation(shader, "u_billboard_uv"),
        glyph.uv[0],
        glyph.uv[1],
        glyph.uv[2],
        glyph.uv[3],
      );
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    return false;
  }

  protected release(gl: WebGL2RenderingContext): void {
    if (this.#texture) gl.deleteTexture(this.#texture);
  }
}

export class FogLayer extends ScreenLayer {
  protected vertexSource(): string {
    return FOG_VERTEX;
  }

  protected fragmentSource(): string {
    return FOG_FRAGMENT;
  }

  protected allocate(_gl: WebGL2RenderingContext): void {}

  protected draw(
    gl: WebGL2RenderingContext,
    shader: WebGLProgram,
    options: CustomRenderMethodInput,
  ): void | boolean {
    const fog = this.provider.fog();
    const frame = this.provider.frame();
    const current = this.provider.viewState();
    if (
      !fog.visible ||
      !frame ||
      !current ||
      current.pitch <= 0 ||
      this.provider.projectionMode() !== "surface"
    )
      return false;

    const inverse = invertMatrix4(options.defaultProjectionData.mainMatrix);
    if (!inverse) return false;

    const [centerX, centerY] = lngLatToWorld(
      frame.state.center.lng,
      frame.state.center.lat,
    );
    const worldSize = 512 * 2 ** frame.state.zoom;
    const halfX = frame.state.width / (2 * worldSize);
    const halfY = frame.state.height / (2 * worldSize);
    gl.uniformMatrix4fv(
      gl.getUniformLocation(shader, "u_inverse_map_matrix"),
      false,
      inverse,
    );
    gl.uniform4f(
      gl.getUniformLocation(shader, "u_world_bounds"),
      centerX - halfX,
      centerY - halfY,
      centerX + halfX,
      centerY + halfY,
    );
    gl.uniform2f(
      gl.getUniformLocation(shader, "u_view_size"),
      current.width,
      current.height,
    );
    gl.uniform1f(
      gl.getUniformLocation(shader, "u_pixel_ratio"),
      current.pixelRatio,
    );
    gl.uniform1f(gl.getUniformLocation(shader, "u_start"), fog.start);
    gl.uniform1f(gl.getUniformLocation(shader, "u_end"), fog.end);
    gl.uniform1f(gl.getUniformLocation(shader, "u_opacity"), fog.opacity);
    gl.uniform1f(
      gl.getUniformLocation(shader, "u_pitch_mix"),
      smoothstep(0, 20, current.pitch),
    );
    gl.uniform3fv(
      gl.getUniformLocation(shader, "u_color"),
      normalized([fog.color]),
    );
    gl.uniform1i(
      gl.getUniformLocation(shader, "u_dithered"),
      fog.mode === "dithered" ? 1 : 0,
    );
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  protected release(_gl: WebGL2RenderingContext): void {}
}

export interface BillboardGlyph {
  anchor: readonly [number, number];
  offset: readonly [number, number];
  uv: readonly [number, number, number, number];
}

export function billboardGlyphs(frame: RasterFrame): BillboardGlyph[] {
  const glyphs: BillboardGlyph[] = [];
  const { width, height } = frame.state.cell;
  for (const label of frame.labels) {
    const characters = Array.from(label.text);
    const anchor = framePointToWorld(frame.state, [
      (label.column + characters.length / 2) * width,
      (label.row + 0.5) * height,
    ]);
    characters.forEach((_character, index) => {
      const column = label.column + index;
      if (
        column < 0 ||
        column >= frame.columns ||
        label.row < 0 ||
        label.row >= frame.rows
      )
        return;
      glyphs.push({
        anchor,
        offset: [(index + 0.5 - characters.length / 2) * width, 0],
        uv: [
          (column * width) / frame.state.width,
          (label.row * height) / frame.state.height,
          ((column + 1) * width) / frame.state.width,
          ((label.row + 1) * height) / frame.state.height,
        ],
      });
    });
  }
  return glyphs;
}

function setProjectionUniforms(
  gl: WebGL2RenderingContext,
  shader: WebGLProgram,
  frame: Pick<RasterFrame, "state">,
  provider: FrameProvider,
  options: CustomRenderMethodInput,
): void {
  const surface = provider.projectionMode() === "surface";
  gl.uniform1i(gl.getUniformLocation(shader, "u_surface"), surface ? 1 : 0);
  gl.uniform2f(
    gl.getUniformLocation(shader, "u_frame_view_size"),
    frame.state.width,
    frame.state.height,
  );
  if (!surface) return;
  gl.uniformMatrix4fv(
    gl.getUniformLocation(shader, "u_map_matrix"),
    false,
    options.defaultProjectionData.mainMatrix,
  );
  const [centerX, centerY] = lngLatToWorld(
    frame.state.center.lng,
    frame.state.center.lat,
  );
  const worldSize = 512 * 2 ** frame.state.zoom;
  const halfX = frame.state.width / (2 * worldSize);
  const halfY = frame.state.height / (2 * worldSize);
  gl.uniform4f(
    gl.getUniformLocation(shader, "u_world_bounds"),
    centerX - halfX,
    centerY - halfY,
    centerX + halfX,
    centerY + halfY,
  );
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function labelColors(theme: LowResTheme): RGB[] {
  const output: RGB[] = [];
  output[LabelInk.City] = theme.labels.city;
  output[LabelInk.Town] = theme.labels.town;
  output[LabelInk.Village] = theme.labels.village;
  output[LabelInk.Area] = theme.labels.area;
  output[LabelInk.Road] = theme.labels.road;
  output[LabelInk.RoadMinor] = theme.labels.roadMinor;
  output[LabelInk.Shield] = theme.labels.shield;
  output[LabelInk.Water] = theme.labels.water;
  output[LabelInk.Park] = theme.labels.park;
  output[LabelInk.Poi] = theme.labels.poi;
  output[LabelInk.Medical] = theme.labels.medical;
  return output;
}

function css(color: RGB): string {
  return `rgb(${color[0]} ${color[1]} ${color[2]})`;
}

function renderLabels(
  canvas: HTMLCanvasElement,
  frame: RasterFrame,
  theme: LowResTheme,
  visible: boolean,
): void {
  const ratio = frame.state.pixelRatio;
  canvas.width = Math.max(1, Math.round(frame.state.width * ratio));
  canvas.height = Math.max(1, Math.round(frame.state.height * ratio));
  const context = canvas.getContext("2d");
  if (!context || !visible) return;
  context.scale(ratio, ratio);
  context.textAlign = "center";
  context.textBaseline = "middle";
  const inks = labelColors(theme);
  const fills = fillColors(theme);
  const { width, height } = frame.state.cell;

  for (const label of frame.labels) {
    Array.from(label.text).forEach((character, offset) => {
      const column = label.column + offset;
      if (
        column < 0 ||
        column >= frame.columns ||
        label.row < 0 ||
        label.row >= frame.rows
      )
        return;
      const topClass =
        frame.fill[label.row * 2 * frame.columns + column] ?? FillClass.Ground;
      const bottomClass =
        frame.fill[(label.row * 2 + 1) * frame.columns + column] ??
        FillClass.Ground;
      context.fillStyle = css(fills[topClass]!);
      context.fillRect(column * width, label.row * height, width, height / 2);
      context.fillStyle = css(fills[bottomClass]!);
      context.fillRect(
        column * width,
        label.row * height + height / 2,
        width,
        height / 2,
      );
      context.font = `${label.bold ? 700 : 400} ${Math.floor(height * 0.72)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      context.fillStyle = css(inks[label.ink] ?? theme.labels.poi);
      context.fillText(
        character,
        column * width + width / 2,
        label.row * height + height / 2 + height * 0.03,
      );
    });
  }
}
