/**
 * Scene Geometry Helpers
 *
 * Contains all geometry-related code for ray-scene intersection and shadow testing.
 * 
 * CRITICAL: N_OBJ must be a compile-time #define (not a uniform) to avoid
 * D3D11 HLSL recompile bug on ANGLE when using uniform-bounded loops.
 * This file is injected into both trace.glsl and normal.glsl at runtime.
 * 
 * Defines:
 * - N_OBJ: Number of scene objects (must be exactly 16)
 * - Uniforms: u_pos[], u_half[], u_mat[], u_active[]
 * - Structs: Hit (raycast result)
 * - Functions: hitBox(), intersect(), inShadow()
 */

#define N_OBJ 16

uniform vec3  u_pos[N_OBJ];
uniform vec3  u_half[N_OBJ];
uniform int   u_mat[N_OBJ];
uniform float u_active[N_OBJ];

/**
 * Raycast result structure
 * t: Distance along ray (negative = miss)
 * n: Surface normal at hit point
 * mat: Material ID (0=metallic, 1=water, 2=matte, -1=miss)
 */
struct Hit {
  float t;
  vec3 n;
  int mat;
};

/**
 * AABB ray intersection (slab method)
 * 
 * Cast ray (ro + rd*t) against axis-aligned box at u_pos[i] with half-extents u_half[i].
 * Returns closest intersection or miss.
 * 
 * Inactive objects (u_active[i] < 0.5) return immediate miss to avoid shader recompilation.
 * 
 * @param ro Ray origin
 * @param rd Ray direction (should be normalized)
 * @param i Object index [0, N_OBJ)
 * @return Hit struct with t, normal, material
 */
Hit hitBox(vec3 ro, vec3 rd, int i) {
  Hit h;
  h.t = -1.0;
  h.mat = -1;
  
  // Skip inactive objects entirely (avoids ANGLE recompile issue)
  if (u_active[i] < 0.5)
    return h;
  
  // Compute intersection along each axis (slab method)
  vec3 inv = vec3(1.0) / rd;
  vec3 t0 = (u_pos[i] - u_half[i] - ro) * inv;
  vec3 t1 = (u_pos[i] + u_half[i] - ro) * inv;
  
  // Sort min/max for each axis
  vec3 mn = min(t0, t1);
  vec3 mx = max(t0, t1);
  
  // Compute intersection interval
  float tN = max(max(mn.x, mn.y), mn.z);  // Enter distance
  float tF = min(min(mx.x, mx.y), mx.z);  // Exit distance
  
  // No intersection
  if (tN > tF || tF < 1e-3)
    return h;
  
  // Use closest valid intersection
  float t = tN > 1e-3 ? tN : tF;
  if (t < 1e-3)
    return h;
  
  h.t = t;
  h.mat = u_mat[i];
  
  // Compute normal from closest face
  vec3 lp = (ro + rd * t - u_pos[i]) / u_half[i];
  vec3 a = abs(lp);
  
  if (a.x > a.y && a.x > a.z)
    h.n = vec3(sign(lp.x), 0.0, 0.0);
  else if (a.y > a.z)
    h.n = vec3(0.0, sign(lp.y), 0.0);
  else
    h.n = vec3(0.0, 0.0, sign(lp.z));
  
  return h;
}

/**
 * Scene intersection
 * 
 * Casts ray through all N_OBJ objects and returns closest hit.
 * Early termination: skips objects once a closer hit is found.
 * 
 * @param ro Ray origin
 * @param rd Ray direction
 * @return Closest hit, or miss (mat < 0)
 */
Hit intersect(vec3 ro, vec3 rd) {
  Hit best;
  best.t = 1e9;
  best.mat = -1;
  
  // Test all objects (loop is probably unrolled at compile time due to N_OBJ being #define)
  for (int i = 0; i < N_OBJ; i++) {
    Hit h = hitBox(ro, rd, i);
    if (h.t > 1e-3 && h.t < best.t)
      best = h;
  }
  
  return best;
}

/**
 * Shadow test
 * 
 * Returns true if ray segment [p, p+d*mx] is occluded by scene.
 * Early termination: returns true on first hit.
 * 
 * @param p Ray origin (slightly offset from surface)
 * @param d Ray direction (typically towards light)
 * @param mx Maximum distance to test
 * @return true if occluded, false if in shadow
 */
bool inShadow(vec3 p, vec3 d, float mx) {
  for (int i = 0; i < N_OBJ; i++) {
    Hit h = hitBox(p, d, i);
    if (h.t > 2e-3 && h.t < mx)
      return true;
  }
  return false;
}
