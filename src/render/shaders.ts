export const VERTEX = `#version 300 es
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

export const LABEL_VERTEX = `#version 300 es
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

export const BASE_FRAGMENT = `#version 300 es
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

export const DATA_FRAGMENT = `#version 300 es
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

export const MARKER_FRAGMENT = `#version 300 es
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

export const LABEL_FRAGMENT = `#version 300 es
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

export const FOG_VERTEX = `#version 300 es
precision highp float;
in vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

export const FOG_FRAGMENT = `#version 300 es
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
