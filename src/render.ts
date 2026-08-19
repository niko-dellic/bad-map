import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  Map as MapLibreMap,
} from "maplibre-gl";
import { reprojectionTransform } from "./geometry";
import { lngLatToWorld } from "./geometry";
import { FillClass, LabelInk, LineClass } from "./style";
import type { LowResTheme, RGB, RasterFrame } from "./types";

interface FrameProvider {
  frame(): RasterFrame | undefined;
  viewState(): RasterFrame["state"] | undefined;
  theme(): LowResTheme;
  labelsVisible(): boolean;
  styleRevision(): number;
  hoveredOwner(): number;
  selectedOwner(): number;
  projectionMode(): "screen" | "surface";
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

const BASE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_fill;
uniform sampler2D u_mask;
uniform sampler2D u_line_class;
uniform sampler2D u_line_tone;
uniform sampler2D u_ribbon;
uniform highp usampler2D u_owner;
uniform sampler2D u_scalar;
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
uniform vec3 u_scalar_colors[4];
uniform int u_surface;
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
  float scalar = texelFetch(u_scalar, source_cell, 0).r;
  if (scalar > 0.0) {
    float value = clamp((scalar * 255.0 - 1.0) / 254.0, 0.0, 1.0);
    float segment = value * 3.0;
    int left = min(2, int(floor(segment)));
    vec3 scalar_color = mix(u_scalar_colors[left], u_scalar_colors[left + 1], fract(segment));
    color = mix(color, scalar_color, 0.48);
  }
  uint owner = texelFetch(u_owner, source_cell, 0).r;
  if (owner != 0u && owner == u_selected_owner) color = mix(color, u_selected_color, 0.58);
  else if (owner != 0u && owner == u_hover_owner) color = mix(color, u_hover_color, 0.42);
  out_color = vec4(color, 1.0);
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
in vec2 v_uv;
in vec2 v_surface_pixel;
out vec4 out_color;
void main() {
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

function program(gl: WebGL2RenderingContext, fragment: string): WebGLProgram {
  const output = gl.createProgram();
  if (!output) throw new Error("Unable to allocate WebGL program");
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
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
    this.shader = program(context, this.fragmentSource());
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
    this.draw(gl, this.shader, options);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  onRemove(): void {
    if (!this.gl) return;
    if (this.vertexBuffer) this.gl.deleteBuffer(this.vertexBuffer);
    if (this.shader) this.gl.deleteProgram(this.shader);
    this.release(this.gl);
    this.gl = undefined;
  }

  protected abstract fragmentSource(): string;
  protected abstract allocate(gl: WebGL2RenderingContext): void;
  protected abstract draw(
    gl: WebGL2RenderingContext,
    shader: WebGLProgram,
    options: CustomRenderMethodInput,
  ): void;
  protected abstract release(gl: WebGL2RenderingContext): void;
}

export class BaseLayer extends ScreenLayer {
  #textures: WebGLTexture[] = [];
  #uploadedGeneration = -1;

  protected fragmentSource(): string {
    return BASE_FRAGMENT;
  }
  protected allocate(gl: WebGL2RenderingContext): void {
    this.#textures = Array.from({ length: 7 }, () => texture(gl));
  }

  protected draw(
    gl: WebGL2RenderingContext,
    shader: WebGLProgram,
    options: CustomRenderMethodInput,
  ): void {
    const frame = this.provider.frame();
    if (!frame) return;
    const current = this.provider.viewState() ?? frame.state;
    setProjectionUniforms(gl, shader, frame, this.provider, options);
    const transform = reprojectionTransform(frame.state, current);
    if (frame.generation !== this.#uploadedGeneration) {
      this.#upload(gl, 0, frame.columns, frame.rows * 2, frame.fill);
      this.#upload(gl, 1, frame.columns, frame.rows, frame.lineMask);
      this.#upload(gl, 2, frame.columns, frame.rows, frame.lineClass);
      this.#upload(gl, 3, frame.columns, frame.rows, frame.lineTone);
      this.#upload(gl, 4, frame.columns, frame.rows, frame.ribbon);
      this.#uploadOwner(gl, 5, frame.columns, frame.rows, frame.owner);
      this.#upload(gl, 6, frame.columns, frame.rows, frame.scalar);
      this.#uploadedGeneration = frame.generation;
    }
    const names = [
      "u_fill",
      "u_mask",
      "u_line_class",
      "u_line_tone",
      "u_ribbon",
      "u_owner",
      "u_scalar",
    ];
    this.#textures.forEach((value, index) => {
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
      this.provider.hoveredOwner(),
    );
    gl.uniform1ui(
      gl.getUniformLocation(shader, "u_selected_owner"),
      this.provider.selectedOwner(),
    );
    const theme = this.provider.theme();
    gl.uniform3fv(
      gl.getUniformLocation(shader, "u_scalar_colors[0]"),
      normalized([
        theme.lines.waterway,
        theme.labels.park,
        theme.lines.motorway,
        theme.labels.medical,
      ]),
    );
    gl.disable(gl.BLEND);
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

  #uploadOwner(
    gl: WebGL2RenderingContext,
    index: number,
    width: number,
    height: number,
    data: Uint32Array,
  ): void {
    gl.activeTexture(gl.TEXTURE0 + index);
    gl.bindTexture(gl.TEXTURE_2D, this.#textures[index]!);
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
  }
}

export class LabelsLayer extends ScreenLayer {
  #texture: WebGLTexture | undefined;
  #canvas: HTMLCanvasElement | undefined;
  #uploadedGeneration = -1;
  #uploadedStyleRevision = -1;

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
  ): void {
    const frame = this.provider.frame();
    if (!frame || !this.#texture || !this.#canvas) return;
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
  }

  protected release(gl: WebGL2RenderingContext): void {
    if (this.#texture) gl.deleteTexture(this.#texture);
  }
}

function setProjectionUniforms(
  gl: WebGL2RenderingContext,
  shader: WebGLProgram,
  frame: RasterFrame,
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
