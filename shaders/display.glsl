#version 300 es

/**
 * Display Shader - Final Tone Mapping & Gamma Correction
 * 
 * Applies ACES filmic tonemapping and gamma correction (sRGB) to the
 * accumulated path-traced image before display. Handles exposure control.
 * Ref: https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/
 * 
 * Inputs:
 * - u_tex: Accumulated HDR color buffer
 * - u_exposure: Exposure multiplier (0.2 - 4.0)
 * 
 * Outputs:
 * - fragColor: Tone-mapped, gamma-corrected RGB
 */

precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform float u_exposure;

/**
 * ACES Filmic Tone Mapping Curve
 * Maps HDR values to [0, 1] with film-like response curve.
 * Values are taken from provided reference in the link above.
 */
vec3 aces(vec3 x) {
  x *= u_exposure;
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  // Sample HDR accumulation buffer
  vec3 c = aces(texture(u_tex, v_uv).rgb);
  
  // Apply gamma correction for sRGB display
  fragColor = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
}
