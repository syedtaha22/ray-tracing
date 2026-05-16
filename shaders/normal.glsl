#version 300 es

/**
 * Normal Shader - Scene Normal Map Rendering
 * 
 * Renders world-space normals for each pixel by ray-casting through
 * the scene. Used as a guide for the A-Trous denoiser (edge preservation).
 * 
 * Inputs:
 * - u_camPos, u_camFwd, u_camRight, u_camUp: Camera basis
 * - u_fov: Vertical field of view (radians)
 * - u_aspect: Viewport aspect ratio (width / height)
 * 
 * Scene geometry:
 * - u_pos[N_OBJ]: Object center positions
 * - u_half[N_OBJ]: Object half-extents (AABB)
 * - u_mat[N_OBJ]: Material IDs
 * - u_active[N_OBJ]: Activation flags
 * 
 * Outputs:
 * - fragColor.xyz: Normal in [0, 1] (remapped from [-1, 1])
 * - fragColor.w: 1.0 (opaque)
 */

precision highp float;
precision highp int;

in vec2 v_uv;
out vec4 fragColor;

uniform vec3  u_camPos, u_camFwd, u_camRight, u_camUp;
uniform float u_fov, u_aspect;

/* SCENE_GLSL */

void main() {
  // Compute ray direction from camera
  vec2 ndc = (v_uv * 2.0 - 1.0);
  ndc.x *= u_aspect;
  
  float th = tan(u_fov * 0.5);
  vec3 rd = normalize(u_camFwd + ndc.x * th * u_camRight + ndc.y * th * u_camUp);
  
  // Cast ray through scene
  Hit h = intersect(u_camPos, rd);
  
  // Output normal: remap from [-1, 1] to [0, 1] for storage
  fragColor = vec4(h.mat >= 0 ? h.n * 0.5 + 0.5 : vec3(0.5), 1.0);
}
