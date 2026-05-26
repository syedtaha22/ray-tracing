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
#define WATER_Y -1.0        // world-space Y of the water plane
#define WATER_IOR 1.333

uniform vec3  u_pos[N_OBJ];
uniform vec3  u_half[N_OBJ];
uniform int   u_mat[N_OBJ];
uniform float u_active[N_OBJ];
uniform float u_time;

// Four-octave wave height - calm ocean swell with visible surface movement
// Amplitudes tuned so waves are readable from above but not violent
float waveHeight(vec2 xz) {
  // Primary swell - long wavelength, slow, dominant
  float h  = sin(xz.x * 0.40 + u_time * 0.55) * cos(xz.y * 0.30 + u_time * 0.45) * 0.28;
  
  // Secondary cross-swell at ~60° angle
  h += sin(xz.x * 0.95 - u_time * 0.70) * cos(xz.y * 1.05 + u_time * 0.60) * 0.12;
  
  // Ripple layer - smaller, faster
  h += sin(xz.x * 3.70 + u_time * 1.20) * cos(xz.y * 4.30 - u_time * 1.00) * 0.030;
  
  // Fine detail
  h += sin(xz.x * 8.10 - u_time * 1.80) * cos(xz.y * 7.50 + u_time * 1.60) * 0.008;
  
  return h;
}

// Normal sample epsilon - larger for the bigger waves
vec3 waveNormal(vec2 xz) {
    float eps = 0.08;
    float hL = waveHeight(xz - vec2(eps, 0.0));
    float hR = waveHeight(xz + vec2(eps, 0.0));
    float hD = waveHeight(xz - vec2(0.0, eps));
    float hU = waveHeight(xz + vec2(0.0, eps));
    return normalize(vec3(hL - hR, 2.0 * eps, hD - hU));
}

// True water Y at this XZ position (plane + wave displacement)
float waterSurfaceY(vec2 xz) {
  return WATER_Y + waveHeight(xz);
}

// Is this world-space point underwater?
bool underwater(vec3 p) {
  return p.y < waterSurfaceY(p.xz);
}


// Returns t along ray, or -1.0 on miss.
float hitWaterPlane(vec3 ro, vec3 rd) {
  if (abs(rd.y) < 1e-5)
    return -1.0; // nearly horizontal ray never hits plane

  float tFlat = (WATER_Y - ro.y) / rd.y;
  if (tFlat < 5e-3) 
    return -1.0; // miss or self-hit

  // 5 Newton iterations for grazing angles
  float t = tFlat;
  for (int i = 0; i < 5; i++) {
    vec2  xz  = ro.xz + rd.xz * t;
    float err = waterSurfaceY(xz) - (ro.y + rd.y * t);
    t += err / rd.y;

    if (abs(err) < 5e-5) 
      break;
  }

  if (t < 5e-3) 
    return -1.0;

  return t;
}


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
  bool  isWater;   // true = infinite water plane hit
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
  h.isWater = false;

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
  best.isWater = false;

  // Infinite water plane (mat 1) - replaces the flat AABB sea slab
  float tw = hitWaterPlane(ro, rd);
  if (tw > 1e-3) {
      best.t       = tw;
      best.mat     = 1;
      best.isWater = true;
      vec2 xz      = ro.xz + rd.xz * tw;
      vec3 wn      = waveNormal(xz);
      // Flip normal if ray hits from below
      best.n = dot(rd, wn) < 0.0 ? wn : -wn;
  }

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
  // Water plane shadow
  float tw = hitWaterPlane(p, d);
  if (tw > 8e-3 && tw < mx) 
    return true;

  for (int i = 0; i < N_OBJ; i++) {
    Hit h = hitBox(p, d, i);
    if (h.t > 2e-3 && h.t < mx)
      return true;
  }
  return false;
}
