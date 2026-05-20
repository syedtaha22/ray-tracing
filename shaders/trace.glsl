#version 300 es

/**
 * Path Tracer Shader - Core Monte Carlo Ray Tracing
 * 
 * Implements unbiased path tracing with:
 * - 6 bounce recursion per ray
 * - Importance sampling (GGX+cosine hemisphere)
 * - Volumetric lighting (god rays) via marching
 * - 3 material types: metallic (PBR), water (refraction), matte (diffuse)
 * - Frame accumulation for convergence
 * 
 * Features:
 * - Physically-based rendering (metallic Fresnel, roughness)
 * - Refractive water with proper IOR (1.333)
 * - Adaptive ray termination (Russian roulette)
 * - Volumetric scattering with Henyey-Greenstein phase function
 * - Stratified jittered sampling for anti-aliasing
 * 
 * Inputs (Per Frame):
 * - u_frame: Frame index (0+), used for accumulation blend & RNG seeding
 * - u_res: Render resolution [width, height]
 * - u_camPos, u_camFwd, u_camRight, u_camUp: Camera basis
 * - u_fov: Vertical field of view (radians)
 * - u_aspect: Viewport aspect ratio
 * - u_sunDir, u_sunColor: Sun position & color
 * - u_sunSize, u_sunIntensity: Sun disc parameters
 * - u_volMin, u_volMax: Volumetric scattering bounds
 * - u_prev: Previous frame accumulation buffer
 * 
 * Outputs:
 * - fragColor: Accumulated RGB + alpha (always 1.0)
 */

precision highp float;
precision highp int;

in vec2 v_uv;
out vec4 fragColor;

uniform int       u_frame;
uniform vec2      u_res;
uniform vec3      u_camPos, u_camFwd, u_camRight, u_camUp;
uniform float     u_fov, u_aspect;
uniform vec3      u_sunDir, u_sunColor;
uniform float     u_sunSize, u_sunIntensity;
uniform vec3      u_volMin, u_volMax;
uniform sampler2D u_prev;

/* SCENE_GLSL */

// ----------------------------------------------------------------------------
// Random Number Generation - XorShift32
// ----------------------------------------------------------------------------

uint g_seed;

/**
 * Initialize RNG with pixel coordinates and frame number
 */
void initRNG(vec2 uv, int fr) {
  uvec2 p = uvec2(uv * u_res);
  g_seed = (p.x * 1973u + p.y * 9277u + uint(fr) * 26699u) | 1u;
}

/**
 * Pseudo-random float [0, 1) using XorShift
 */
float rand1() {
  g_seed ^= g_seed << 13u;
  g_seed ^= g_seed >> 17u;
  g_seed ^= g_seed << 5u;
  return float(g_seed) / 4294967296.0;
}

/**
 * Two independent random floats
 */
vec2 rand2() {
  return vec2(rand1(), rand1());
}

// ----------------------------------------------------------------------------
// Sampling Functions
// ----------------------------------------------------------------------------

/**
 * Cosine-weighted hemisphere sampling
 * Generates random direction biased by cosine(theta) for importance sampling
 * 
 * @param n Surface normal to orient hemisphere
 * @param xi 2D random sample [0, 1)
 * @return Sampled direction vector
 */
vec3 cosHemi(vec3 n, vec2 xi) {
  // Formula:
  // phi = 2π * xi.x
  // cos(theta) = sqrt(xi.y)
  // sin(theta) = sqrt(1 - cos^2(theta))

  float phi = 6.28318 * xi.x;
  float ct = sqrt(xi.y);
  float st = sqrt(max(0.0, 1.0 - xi.y));
  
  vec3 up = abs(n.x) > 0.9 ? vec3(0, 1, 0) : vec3(1, 0, 0);
  vec3 t = normalize(cross(up, n));
  vec3 b = cross(n, t);
  
  return normalize(st * cos(phi) * t + st * sin(phi) * b + ct * n);
}

/**
 * GGX importance sampling
 * Samples microfacet normal distribution for specular reflections
 */
vec3 ggxSample(vec3 n, float r, vec2 xi) {
  float a = r * r;
  float phi = 6.28318 * xi.x;
  float ct = sqrt((1.0 - xi.y) / max(1e-6, 1.0 + (a * a - 1.0) * xi.y));
  float st = sqrt(max(0.0, 1.0 - ct * ct));
  
  vec3 hv = vec3(st * cos(phi), st * sin(phi), ct);
  
  vec3 up = abs(n.z) < 0.999 ? vec3(0, 0, 1) : vec3(1, 0, 0);
  vec3 tx = normalize(cross(up, n));
  vec3 ty = cross(n, tx);
  
  return normalize(tx * hv.x + ty * hv.y + n * hv.z);
}

// ----------------------------------------------------------------------------
// PBR Distribution & Visibility Functions
// ----------------------------------------------------------------------------

/**
 * GGX Normal Distribution Function
 * D(h) in Cook-Torrance BRDF, determines specular lobe shape
 */
float ggxD(float NdH, float r) {
  float a2 = r * r * r * r;
  float d = NdH * NdH * (a2 - 1.0) + 1.0;
  return a2 / max(3.14159265 * d * d, 1e-6);
}

/**
 * GGX Visibility Function (Smith)
 * G1(v) for single direction, used in G = G1(l) * G1(v)
 */
float ggxG1(float NdV, float r) {
  float k = r * r * 0.5;
  return NdV / max(NdV * (1.0 - k) + k, 1e-6);
}

/**
 * Fresnel-Schlick Approximation
 * Interpolates reflectance vs. viewing angle
 */
float schlick(float ct, float f0) {
  float x = clamp(1.0 - ct, 0.0, 1.0);
  return f0 + (1.0 - f0) * x * x * x * x * x;
}

// ----------------------------------------------------------------------------
// Sky & Lighting
// ----------------------------------------------------------------------------

/**
 * Procedural sky color with Henyey-Greenstein scattering
 * Models atmosphere at various elevations + sun disc
 */
vec3 skyColor(vec3 d) {
  float su = dot(d, u_sunDir);
  
  // Height-based sky gradient
  float hy = clamp(1.0 - d.y * 2.1, 0.0, 1.0);
  vec3 s = mix(vec3(0.03, 0.09, 0.27), vec3(0.50, 0.23, 0.05), pow(hy, 2.0));
  
  // Fog/orange horizon
  vec3 fog = vec3(0.68, 0.33, 0.07) * pow(clamp(1.0 - abs(d.y) * 3.0, 0.0, 1.0), 3.0);
  s = mix(s, fog, 0.45);
  
  // Henyey-Greenstein phase function for scattering
  float g = 0.82;
  float hg = (1.0 - g * g) / (4.0 * 3.14159265 * pow(max(0.0, 1.0 + g * g - 2.0 * g * su), 1.5));
  s += u_sunColor * hg * 0.2 * u_sunIntensity;
  
  // Sun disc with variable angular size
  float sunAngularRadius = 0.00465 * u_sunSize;
  float sunThreshold = cos(sunAngularRadius);
  float disc = smoothstep(sunThreshold - 0.001, sunThreshold + 0.001, su);
  s += u_sunColor * disc * 10.0 * u_sunIntensity;
  
  return max(s, vec3(0.0));
}

// ----------------------------------------------------------------------------
// Volumetric Lighting
// ----------------------------------------------------------------------------

/**
 * Volumetric marching for god rays and atmospheric scattering
 * Fixed 20 steps to avoid uniform-loop compilation issues on ANGLE/D3D11
 */
vec3 marchVol(vec3 ro, vec3 rd, float tMax) {
  float dist = min(tMax, 36.0);
  float stp = dist / 20.0;
  
  vec3 accum = vec3(0.0);
  float trans = 1.0;
  float dens = 0.028;
  
  // Henyey-Greenstein phase function
  float cosT = dot(rd, u_sunDir);
  float g = 0.78;
  float phase = (1.0 - g * g) / (4.0 * 3.14159265 * pow(max(0.0, 1.0 + g * g - 2.0 * g * cosT), 1.5));
  
  // March through volume with fixed steps
  for (int i = 0; i < 20; i++) {
    float t = (float(i) + 0.5) * stp;
    vec3 p = ro + rd * t;
    
    // Skip if outside volume bounds
    if (any(lessThan(p, u_volMin)) || any(greaterThan(p, u_volMax)))
      continue;
    
    // Transmittance through this step
    float od = dens * stp;
    float tr = exp(-od);
    
    // Check shadow from sun
    bool sh = inShadow(p + u_sunDir * 0.02, u_sunDir, 60.0);
    float vis = sh ? 0.03 : 1.0;
    
    // Accumulate scattered light
    accum += trans * u_sunColor * phase * vis * od * 3.0 * u_sunIntensity;
    trans *= tr;
    
    // Early termination
    if (trans < 0.005)
      break;
  }
  
  return accum;
}

// ----------------------------------------------------------------------------
// Path Tracing
// ----------------------------------------------------------------------------

/**
 * Main path tracing loop
 * 6 bounces maximum with Russian roulette termination after bounce 2
 */
vec3 tracePath(vec3 ro, vec3 rd) {
  vec3 tp = vec3(1.0);  // Throughput (cumulative transmission)
  vec3 rad = vec3(0.0); // Accumulated radiance
  
  for (int b = 0; b < 6; b++) {
    // Intersect scene
    Hit h = intersect(ro, rd);
    float volT = h.mat >= 0 ? h.t : 40.0;
    
    // Accumulate volumetric scattering before surface
    rad += tp * marchVol(ro, rd, volT);
    
    // Transmit through volume
    float volTr = exp(-0.028 * min(volT, 36.0));
    
    // Miss: sky contribution
    if (h.mat < 0) {
      rad += tp * volTr * skyColor(rd);
      break;
    }
    
    vec3 p = ro + rd * h.t;
    vec3 n = h.n;
    
    // ========================================================================
    // Material 0: Metallic (PBR with Fresnel)
    // ========================================================================
    if (h.mat == 0) {
      float rough = 0.28;
      float metal = 0.92;
      vec3 alb = vec3(0.06, 0.07, 0.10);
      vec3 F0 = mix(vec3(0.04), alb, metal);
      
      // Direct lighting from sun
      bool sh = inShadow(p + n * 3e-3, u_sunDir, 100.0);
      float NdL = max(0.0, dot(n, u_sunDir));
      
      vec3 hv = normalize(u_sunDir - rd);
      float NdH = max(0.0, dot(n, hv));
      float NdV = max(0.0, dot(n, -rd));
      float VdH = max(0.0, dot(-rd, hv));
      
      float F = schlick(VdH, F0.r);
      float D = ggxD(NdH, rough);
      float G = ggxG1(NdL, rough) * ggxG1(NdV, rough);
      
      vec3 spec = vec3(F * D * G / max(4.0 * NdV * NdL, 1e-6));
      vec3 diff = alb * (1.0 - metal) / 3.14159265;
      
      if (!sh)
        rad += tp * volTr * (diff + spec) * u_sunColor * NdL * u_sunIntensity;
      
      // Indirect: sample BRDF
      vec3 Hm = ggxSample(n, rough, rand2());
      vec3 nrd = reflect(rd, Hm);
      if (dot(nrd, n) < 0.0)
        nrd = cosHemi(n, rand2());
      
      float Ff = schlick(max(0.0, dot(-rd, Hm)), F0.r);
      tp *= mix(alb, vec3(Ff), metal) * volTr;
      ro = p + n * 3e-3;
      rd = nrd;
      
    // ========================================================================
    // Material 1: Water (Refraction + Reflection)
    // ========================================================================
    } else if (h.mat == 1) {
      float rough = 0.04;
      float ior = 1.333;
      vec3 wcol = vec3(0.012, 0.11, 0.21);
      
      // Fresnel (Schlick Fresnel-Dielectric)
      float ct = max(0.0, dot(-rd, n));
      float f0 = pow((1.0 - ior) / (1.0 + ior), 2.0);
      float Fr = schlick(ct, f0);
      
      // Direct specular highlight from sun
      vec3 hv = normalize(u_sunDir - rd);
      float NdH = max(0.0, dot(n, hv));
      float D = ggxD(NdH, rough);
      
      bool sh = inShadow(p + n * 3e-3, u_sunDir, 100.0);
      if (!sh)
        rad += tp * volTr * vec3(D * 0.28) * u_sunColor * u_sunIntensity;
      
      // Perturbed normal for ripples
      vec3 pert = rough * 1.8 * vec3(rand1() - 0.5, 0.0, rand1() - 0.5);
      vec3 pN = normalize(n + pert);
      
      // Decide reflection vs refraction (biased by Fresnel)
      if (rand1() < Fr) {
        rd = reflect(rd, pN);
        tp *= volTr;
        ro = p + pN * 3e-3;
      } else {
        float eta = dot(rd, n) < 0.0 ? 1.0 / ior : ior;
        vec3 refr = refract(rd, pN, eta);
        if (dot(refr, refr) < 0.5)
          refr = reflect(rd, pN);
        tp *= wcol * volTr;
        ro = p - pN * 3e-3;
        rd = normalize(refr);
      }
      
    // ========================================================================
    // Material 2: Matte (Diffuse)
    // ========================================================================
    } else {
      vec3 alb = vec3(0.17, 0.13, 0.09);
      
      // Direct lighting from sun
      bool sh = inShadow(p + n * 3e-3, u_sunDir, 100.0);
      float NdL = max(0.0, dot(n, u_sunDir));
      if (!sh)
        rad += tp * volTr * alb * u_sunColor * NdL * u_sunIntensity;
      
      // Indirect: cosine-weighted hemisphere
      tp *= alb * volTr;
      rd = cosHemi(n, rand2());
      ro = p + n * 3e-3;
    }
    
    // ========================================================================
    // Russian Roulette (after bounce 2)
    // ========================================================================
    if (b > 1) {
      float rr = max(tp.r, max(tp.g, tp.b));
      if (rand1() > rr)
        break;
      tp /= max(rr, 1e-5);
    }
  }
  
  return max(rad, vec3(0.0));
}

// ----------------------------------------------------------------------------
// Main Fragment Shader
// ----------------------------------------------------------------------------

void main() {
  // Initialize RNG with this pixel
  initRNG(v_uv, u_frame);
  
  // Jittered sampling for anti-aliasing
  vec2 jitter = (rand2() - 0.5) / u_res;
  vec2 ndc = (v_uv + jitter) * 2.0 - 1.0;
  ndc.x *= u_aspect;
  
  // Construct ray direction
  float th = tan(u_fov * 0.5);
  vec3 rd = normalize(u_camFwd + ndc.x * th * u_camRight + ndc.y * th * u_camUp);
  
  // Trace path
  vec3 col = tracePath(u_camPos, rd);
  
  // Load previous frame
  vec3 prev = texture(u_prev, v_uv).rgb;
  
  // Exponential moving average for accumulation
  float blend = u_frame == 0 ? 1.0 : 1.0 / (float(u_frame) + 1.0);
  
  fragColor = vec4(mix(prev, col, blend), 1.0);
}
