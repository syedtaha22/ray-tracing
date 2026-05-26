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
 * - Procedural sky with day/night cycle and star field
 * - Analytical caustics from surface waves
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
uniform int       u_maxBounces;
uniform int       u_shadowsOn;
uniform float     u_volDensity;
uniform float     u_volHeight;
uniform float     u_volScatter;
uniform vec3      u_moonDir;       // world-space direction to moon
uniform float     u_moonPhase;     // 0=new, 0.5=full, 1=new
uniform float     u_moonBright;    // 0..1 luminance scale
uniform float     u_moonUp;        // smooth horizon fade
uniform float     u_moonSize;      // angular size multiplier
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
// Sky - full day/night cycle
// ----------------------------------------------------------------------------

// Voronoi star field
// Mirrors the Blender approach: high-scale Voronoi + narrow color ramp
// (white at 0, black at ~0.062, linear) projected onto the sky sphere.

// Hash a 3D cell index to a vec3 in [0,1]^3
vec3 voronoiHash3(vec3 c) {
    c = vec3(dot(c, vec3(127.1, 311.7,  74.3)),
             dot(c, vec3(269.5, 183.3, 246.1)),
             dot(c, vec3( 63.5, 427.2, 158.9)));
    return fract(sin(c) * 43758.5453);
}

// Returns distance to nearest Voronoi feature point in a tiled 3D grid.
// scale controls cell density - high scale = many small cells = dense stars.
float voronoiDist(vec3 p, float scale) {
  vec3 sp   = p * scale;
  vec3 base = floor(sp);
  vec3 frac = fract(sp);

  float minDist = 1e9;
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3  neighbor = vec3(float(x), float(y), float(z));
        vec3  cellPos  = voronoiHash3(base + neighbor); // feature point in [0,1]^3
        vec3  diff     = neighbor + cellPos - frac;
        float d        = length(diff);
        minDist = min(minDist, d);
      }
    }
  }

  return minDist;
}

float starField(vec3 d) {
  // Voronoi on the unit sphere direction vector
  // Scale ~200 gives a dense Milky-Way-style field
  float dist = voronoiDist(normalize(d), 200.0);

  // Color ramp: white at 0, black at 0.062, linear - matches Blender setup
  float star = clamp(1.0 - dist / 0.062, 0.0, 1.0);

  // Twinkle: each star gets a unique phase from its cell hash
  vec3  sp      = normalize(d) * 200.0;
  vec3  cell    = floor(sp);
  float phase   = voronoiHash3(cell).x;
  float twinkle = 0.75 + 0.25 * sin(u_time * (1.5 + phase * 6.0) + phase * 6.28318);

  return star * twinkle;
}

vec3 skyColor(vec3 d) {
  float su = dot(d, u_sunDir);
  float sunElev = u_sunDir.y;              // -1..1, negative = night

  // --- Transition factors ---
  float dayAmt   = smoothstep(-0.12, 0.20, sunElev);   // 0=night, 1=full day
  float duskAmt  = smoothstep(-0.18, 0.0, sunElev)     // dusk/dawn band
                  * smoothstep( 0.35, 0.0, sunElev);
  float nightAmt = 1.0 - smoothstep(-0.18, 0.05, sunElev);

  // --- Daytime sky ---
  // Height-based sky gradient
  float hy = clamp(1.0 - d.y * 2.1, 0.0, 1.0);
  vec3 dayTop = vec3(0.03, 0.09, 0.27);
  vec3 dayHor = vec3(0.50, 0.23, 0.05);
  vec3 daySky = mix(dayTop, dayHor, pow(hy, 2.0));

  // Atmospheric scattering haze
  vec3 haze = vec3(0.68, 0.33, 0.07) * pow(clamp(1.0 - abs(d.y) * 3.0, 0.0, 1.0), 3.0);
  daySky = mix(daySky, haze, 0.45);

  // Sun disc - no HG phase term at all (it always creates a halo ring)
  // Just a single hard step at the solar angular radius
  float sunRad = 0.00465 * u_sunSize;
  
  // Convert dot-product threshold to a window that equals exactly 1 pixel
  // of angular transition: dcos/dtheta = -sin(theta) ≈ sunRad at small angles
  float cosRad  = cos(sunRad);
  float dCos    = sunRad * 0.018; // ~1% of angular radius = sub-pixel smooth
  float disc    = smoothstep(cosRad - dCos, cosRad + dCos, su);
  
  // Very tight oval diffraction glow - stays inside 2x the disc radius
  float glow    = pow(max(0.0, (su - (cosRad - sunRad * 1.8)) / (sunRad * 1.8)), 6.0);
  daySky += u_sunColor * (disc * 24.0 + glow * 0.8) * u_sunIntensity;

  // --- Dusk/dawn gradient ---
  float hor = pow(clamp(1.0 - abs(d.y) * 4.0, 0.0, 1.0), 2.0);
  vec3 duskSky = mix(vec3(0.01,0.01,0.06), vec3(0.85,0.28,0.04), hor * 0.9);
  
  // Thin bright band right at horizon
  duskSky += vec3(1.0, 0.45, 0.08) * pow(clamp(1.0-abs(d.y)*12.0,0.0,1.0),4.0) * 0.7;
  
  // Dusk: just a horizon glow, NO separate sun disc here -
  // the daySky disc already handles the sun at dusk via the blend
  float duskGlow = pow(max(0.0, su), 22.0);
  duskSky += vec3(0.95, 0.35, 0.04) * duskGlow * 0.9;

  // --- Night sky ---
  float nightGrad = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 nightSky   = mix(vec3(0.005, 0.005, 0.015), vec3(0.0, 0.005, 0.02), nightGrad);

  // Procedural: Voronoi stars + moon
  float starVis = clamp(d.y * 3.0, 0.0, 1.0) * nightAmt;
  nightSky += starField(normalize(d)) * starVis * vec3(0.9, 0.92, 1.0) * 1.4;

  // Physically accurate moon
  float mu = dot(d, u_moonDir);

  // Angular radius of moon ≈ 0.0087 rad * size multiplier
  float moonRad = 0.0087 * u_moonSize;
  float cosMR   = cos(moonRad);
  float dCosMR  = moonRad * 0.018;

  // Is this ray within the moon disc?
  float inDisc = smoothstep(cosMR - dCosMR, cosMR + dCosMR, mu);

  if (inDisc > 0.0) {
      // Build a local 2D coordinate system on the moon disc
      // so we can draw the phase terminator
      vec3 moonRight = normalize(cross(u_moonDir, vec3(0.0, 1.0, 0.0)));
      vec3 moonUp2   = cross(moonRight, u_moonDir);

      // Project ray onto disc plane - gives us UV in [-1,1]^2
      vec3 toMoon = d - u_moonDir * mu;
      float discU = dot(toMoon, moonRight) / sin(moonRad);
      float discV = dot(toMoon, moonUp2)   / sin(moonRad);

      // Phase terminator: the boundary between lit and dark
      // elongation 0° = new (fully dark), 180° = full (fully lit)
      // phase 0..1 maps to elongation 0..360°
      float phaseAngle = u_moonPhase * 6.28318; // radians

      // The terminator is a great circle seen as a vertical line on the disc.
      // Its X position: cos(phaseAngle - π) gives -1 at new, 0 at quarter, +1 at full
      // The lit side: for waxing (phase < 0.5) right side is lit; waning left side
      float terminatorX = cos(phaseAngle); // -1=new, +1=full

      // Signed distance from terminator (positive = lit side)
      float litSide = discU - terminatorX * sqrt(max(0.0, 1.0 - discV*discV));

      // For waxing (0..0.5): right side (discU > 0) is lit
      // For waning (0.5..1): left side is lit - flip
      float litFraction = (u_moonPhase < 0.5) ? litSide : -litSide;
      float lit = smoothstep(-0.04, 0.04, litFraction);

      // Moon surface colour - slightly warm maria (dark patches) + bright highlands
      // Simplified: uniform grey with limb darkening
      float limb = 1.0 - 0.35 * (discU*discU + discV*discV);
      vec3  moonSurface = vec3(0.72, 0.74, 0.78) * limb;

      // Brightness: full moon ≈ bright enough to cast shadows (~2.5 cd/m²)
      float moonLum = u_moonBright * 2.8;

      nightSky += moonSurface * lit * moonLum * inDisc * u_moonUp;

      // Subtle glow halo (atmospheric refraction around disc)
      float halo = pow(max(0.0, mu - cosMR + moonRad*4.0) / (moonRad*4.0), 3.0);
      nightSky += vec3(0.75, 0.78, 0.85) * halo * u_moonBright * 0.15 * u_moonUp;
  } else {
      // Moonlight ambient - whole sky gets a faint cool tint when moon is up
      float moonAmbient = pow(max(0.0, mu), 32.0) * u_moonBright * u_moonUp;
      nightSky += vec3(0.72, 0.76, 0.85) * moonAmbient * 0.25;
  }

  // --- Blend all three layers ---
  vec3 sky = nightSky;
  sky = mix(sky, duskSky, duskAmt);
  sky = mix(sky, daySky,  dayAmt);

  return max(sky, vec3(0.0));
}

// ----------------------------------------------------------------------------
// Analytical caustics
// Simulates concentrated light ribbons on the seafloor from surface waves.
// Uses the same wave function as the surface normal to stay consistent.
// ----------------------------------------------------------------------------
float causticPattern(vec3 p) {
  vec2 xz = p.xz;
  float depth = waterSurfaceY(xz) - p.y;
  if (depth < 0.0) return 0.0;

  // Spread factor: caustics blur out with depth
  float spread = 0.5 + depth * 0.4;

  // Sample the wave curvature at this point - areas of high convexity
  // focus light, concavities defocus it.
  float eps = 0.15;
  float h0 = waveHeight(xz);
  float hL = waveHeight(xz - vec2(eps,0.0));
  float hR = waveHeight(xz + vec2(eps,0.0));
  float hD = waveHeight(xz - vec2(0.0,eps));
  float hU = waveHeight(xz + vec2(0.0,eps));
  float curv = (hL + hR + hD + hU - 4.0*h0) / (eps*eps); // Laplacian

  // Positive curvature = converging light
  float caustic = smoothstep(0.0, 1.0/spread, curv * 2.5);

  // Attenuate by sun elevation (no caustics at night)
  float sunUp = max(0.0, u_sunDir.y);
  caustic *= sunUp * sunUp;

  // Attenuate with depth
  caustic *= exp(-depth * 0.35);

  return caustic;
}

// ----------------------------------------------------------------------------
// Volumetric Lighting - above water, height-based atmosphere with jittered marching
// ----------------------------------------------------------------------------

/**
 * Volumetric marching for god rays and atmospheric scattering
 * Fixed number of steps to avoid uniform-loop compilation issues on ANGLE/D3D11
 */
vec3 marchVol(vec3 ro, vec3 rd, float tMax) {
  if (underwater(ro) && rd.y < 0.0) return vec3(0.0);

  float dist  = min(tMax, 60.0);
  float stp   = dist / 32.0;
  vec3 accum = vec3(0.0);
  float trans = 1.0;

  float cosT = dot(rd, u_sunDir);
  float g = 0.78;
  float phase = (1.0 - g * g) / (4.0 * 3.14159265 * pow(max(0.0, 1.0 + g * g - 2.0 * g * cosT), 1.5));
  float sunUp = max(0.0, u_sunDir.y);

  // Per-pixel jitter - breaks step-aligned shadow banding into noise
  float jitter = rand1() * stp;

  for (int i = 0; i < 32; i++) {
    float t = jitter + float(i) * stp;
    if (t > dist) break;
    vec3 p = ro + rd * t;

    if (underwater(p)) continue;

    // Transmittance through this step
    float height = max(0.0, p.y - WATER_Y);
    float dens   = u_volDensity * exp(-height * u_volHeight);
    float od = dens * stp;
    // Check shadow from sun
    bool sh  = u_shadowsOn != 0 && inShadow(p + u_sunDir * 0.05, u_sunDir, 80.0);
    float vis = sh ? 0.02 : 1.0;

    // Accumulate scattered light
    accum += trans * u_sunColor * phase * vis * od * u_volScatter * u_sunIntensity * sunUp;
    trans *= exp(-od);

    // Early termination
    if (trans < 0.004)
      break;
  }

  return accum;
}

// ----------------------------------------------------------------------------
// Volumetric - underwater (blue god rays + depth fog)
// ----------------------------------------------------------------------------
vec3 marchUnderwaterVol(vec3 ro, vec3 rd, float tMax) {
    float dist = min(tMax, 20.0);
    float stp  = dist / 20.0;
    vec3  accum = vec3(0.0);
    float trans = 1.0;

    // Water absorbs red first, then green - Beer's law per channel
    vec3 absorption = vec3(0.45, 0.12, 0.04);  // per-meter

    float cosT  = dot(rd, u_sunDir);
    float g = 0.7;
    float phase = (1.0-g*g)/(4.0*3.14159265*pow(max(0.0,1.0+g*g-2.0*g*cosT),1.5));

    for (int i = 0; i < 20; i++) {
        float t = (float(i)+0.5)*stp;
        vec3  p = ro + rd*t;

        // Stop marching once we exit the water (hit the surface from below)
        if (!underwater(p)) break;

        float depth = waterSurfaceY(p.xz) - p.y;

        // Transmittance through this step (wavelength-dependent)
        vec3 od = absorption * stp;
        vec3 tr = exp(-od);

        // Shadow - only unblocked if sun ray exits water without hitting anything
        bool sh = inShadow(p + u_sunDir*0.05, u_sunDir, 40.0);
        float vis = sh ? 0.0 : 1.0;

        // Sunlight reaches here: tinted blue, dimmed by depth
        vec3 sunUW = u_sunColor * vec3(0.1, 0.5, 1.0) * exp(-depth * 0.3);
        accum += trans * sunUW * phase * vis * stp * 0.8 * u_sunIntensity;
        trans *= tr.g; // single transmittance value for overall transparency
        if (trans < 0.005) break;
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
    if (b >= u_maxBounces) break;
    bool isUnder = underwater(ro);

    // Intersect scene
    Hit h = intersect(ro, rd);
    float volT = h.mat >= 0 ? h.t : 40.0;

    // Volumetric scattering - pick the right medium
    if (isUnder) {
      rad += tp * marchUnderwaterVol(ro, rd, volT);
      // Depth-dependent absorption on the throughput
      float depth = waterSurfaceY(ro.xz) - ro.y;
      vec3 absorb = exp(-vec3(0.45,0.12,0.04) * min(volT, depth));
      tp *= absorb;
    } else {
      rad += tp * marchVol(ro, rd, volT);
    
      // Transmit through volume
      float volTr = exp(-0.028 * min(volT, 36.0));
      tp *= volTr;
    }

    // Miss: sky or deep-water ambient
    if (h.mat < 0) {
      if (isUnder) {
        // Below water looking into the deep - dark blue
        float depth = waterSurfaceY(ro.xz) - ro.y;
        rad += tp * vec3(0.0, 0.02, 0.06) * exp(-depth * 0.1);
      } else {
        rad += tp * skyColor(rd);
      }
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

      // Caustic boost when underwater and sun shines on metallic
      if (isUnder) {
        float caus = causticPattern(p);
        rad += tp * u_sunColor * vec3(0.1,0.5,1.0) * caus * 3.0 * u_sunIntensity;
      }

      bool sh = u_shadowsOn != 0 && inShadow(p + n * 3e-3, u_sunDir, 100.0);
      float NdL = max(0.0, dot(n, u_sunDir));
      vec3 hv = normalize(u_sunDir - rd);
      float NdH = max(0.0, dot(n, hv));
      float NdV = max(0.0, dot(n, -rd));
      float VdH = max(0.0, dot(-rd, hv));

      float F = schlick(VdH, F0.r);
      float D = ggxD(NdH, rough);
      float G = ggxG1(NdL, rough)*ggxG1(NdV, rough);
      
      vec3 spec = vec3(F*D*G/max(4.0*NdV*NdL,1e-6));
      vec3 diff = alb*(1.0-metal)/3.14159265;
      
      if (!sh)
        rad += tp * (diff + spec) * u_sunColor * NdL * u_sunIntensity;

      // Indirect: sample BRDF
      vec3 Hm = ggxSample(n, rough, rand2());
      vec3 nrd = reflect(rd, Hm);
      if (dot(nrd, n) < 0.0)
        nrd = cosHemi(n, rand2());
      
      float Ff = schlick(max(0.0, dot(-rd, Hm)), F0.r);
      tp *= mix(alb, vec3(Ff), metal);
      ro = p + n * 3e-3;
      rd = nrd;

    // ========================================================================
    // Material 1: Water surface (infinite animated plane)
    // ========================================================================
    } else if (h.mat == 1) {
      float rough = 0.04;
      float ior = WATER_IOR;
      vec3 wcol = vec3(0.012, 0.11, 0.21);

      // Fresnel (Schlick Fresnel-Dielectric)
      float ct = max(0.0, dot(-rd, n));
      float f0 = pow((1.0 - ior) / (1.0 + ior), 2.0);
      float Fr = schlick(ct, f0);

      // Direct specular highlight from sun
      vec3 hv = normalize(u_sunDir - rd);
      float NdH = max(0.0, dot(n, hv));
      float D = ggxD(NdH, rough);
      
      bool sh = u_shadowsOn != 0 && inShadow(p + n * 3e-3, u_sunDir, 100.0);
      if (!sh && !isUnder)
        rad += tp * vec3(D * 0.28) * u_sunColor * u_sunIntensity;

      bool goingIn = !isUnder; // ray travels from above into water

      if (goingIn) {
        // --- Hitting surface from above ---
        float eta = 1.0 / ior;
        vec3 refr = refract(rd, n, eta);

        if (rand1() < Fr || dot(refr, refr) < 0.5) {
          // Reflection
          rd   = reflect(rd, n);
          tp  *= 1.0;
          ro   = p + n * 3e-3;
        } else {
          // Refraction into water
          tp  *= wcol;
          ro   = p - n * 3e-3;
          rd   = normalize(refr);
        }
      } else {
        // --- Hitting surface from below (inside water) ---
        float eta = ior;  // water -> air
        vec3 refr = refract(rd, n, eta);

        // Critical angle check - total internal reflection
        float sinT2 = eta * eta *(1.0 - ct * ct);
        if (sinT2 >= 1.0 || rand1() > (1.0 - Fr)) {
          // Total internal reflection
          ro = p - n * 3e-3;
          rd = reflect(rd, n);
        } else {
          // Snell's Window - exits into air
          // The sky is compressed into a ~48.75° cone
          rd  = normalize(refr);
          ro  = p + n * 3e-3;
          tp *= 1.0 - wcol * 0.3;
        }
      }

    // ========================================================================
    // Material 2: Matte / seafloor
    // ========================================================================
    } else {
      vec3 alb = isUnder
          ? vec3(0.08, 0.10, 0.13)   // darker, blue-tinted when submerged
          : vec3(0.17, 0.13, 0.09);

      // Caustics on the seafloor
      if (isUnder) {
        float caus = causticPattern(p);
        rad += tp * u_sunColor * vec3(0.15, 0.6, 1.0) * caus * 4.0 * u_sunIntensity;
      }

      bool  sh  = u_shadowsOn != 0 && inShadow(p + n * 3e-3, u_sunDir, 100.0);
      float NdL = max(0.0, dot(n, u_sunDir));
      if (!sh)
        rad += tp * alb * u_sunColor * NdL * u_sunIntensity;

      // Indirect: cosine-weighted hemisphere
      tp *= alb;
      rd = cosHemi(n, rand2());
      ro = p + n * 3e-3;
    }

    // Russian roulette
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
