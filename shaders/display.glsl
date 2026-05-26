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
uniform float     u_sunElevation; // degrees -90..+90

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
    vec3 c = texture(u_tex, v_uv).rgb;

    // Night desaturation only - above water, moonlight is nearly greyscale.
    // Underwater appearance is handled physically in trace.glsl (Beer's law,
    // volumetric absorption) so we do NOT apply any tint here.
    float dayAmt = smoothstep(-12.0, 8.0, u_sunElevation);
    float lum    = dot(c, vec3(0.299, 0.587, 0.114));
    // Blend toward cool greyscale at night
    c = mix(vec3(lum) * vec3(0.82, 0.88, 0.98), c, mix(0.2, 1.0, dayAmt));

    c = aces(c);
    fragColor = vec4(pow(max(c, vec3(0.0)), vec3(1.0/2.2)), 1.0);
}
