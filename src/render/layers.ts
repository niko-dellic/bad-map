import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  Map as MapLibreMap,
} from "maplibre-gl";
import {
  framePointToWorld,
  lngLatToWorld,
  reprojectionTransform,
} from "../core/geometry.js";
import { FillClass, LabelInk, LineClass } from "../semantic/style.js";
import type {
  DataRasterFrame,
  LowResFogMode,
  LowResTheme,
  RGB,
  RasterFrame,
} from "../types.js";
import { invertMatrix4, smoothstep } from "./math.js";
import {
  BASE_FRAGMENT,
  DATA_FRAGMENT,
  FOG_FRAGMENT,
  FOG_VERTEX,
  LABEL_FRAGMENT,
  LABEL_VERTEX,
  MARKER_FRAGMENT,
  VERTEX,
} from "./shaders.js";

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
