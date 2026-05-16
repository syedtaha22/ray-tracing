#version 300 es

/**
 * A-Trous Filter - Edge-Aware Denoising
 * 
 * Applies separable A-Trous (à trous = "with holes") bilateral filter
 * for edge-aware denoising of path-traced images. Uses normal maps to
 * preserve edges and features during smoothing.
 * 
 * Filtering strategy:
 * - Pass 0: stride = 1px, 5×5 kernel
 * - Pass 1: stride = 2px, 5×5 kernel
 * - Pass 2: stride = 4px, 5×5 kernel
 * - Pass 3: stride = 8px, 5×5 kernel
 * 
 * Inputs:
 * - u_color: Color buffer (from trace or previous denoise pass)
 * - u_normal: Normal map (world-space, remapped to [0, 1])
 * - u_step: Current filter pass (0-3)
 * - u_strength: Denoise strength multiplier (0.0 - 1.0)
 * - u_res: Render resolution [width, height]
 * 
 * Outputs:
 * - fragColor: Denoised color
 */

precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_color;
uniform sampler2D u_normal;
uniform int       u_step;
uniform float     u_strength;
uniform vec2      u_res;

void main() {
  vec3 cC = texture(u_color, v_uv).rgb;
  
  // Early exit if denoising is disabled
  if (u_strength < 0.02) {
    fragColor = vec4(cC, 1.0);
    return;
  }
  
  // Sample center normal (remap from [0, 1] to [-1, 1])
  vec3 nC = texture(u_normal, v_uv).rgb * 2.0 - 1.0;
  
  // Compute texel size and stride for this pass
  vec2 texel = 1.0 / u_res;
  float stride = pow(2.0, float(u_step));
  
  // 1D Binomial filter kernel weights [1/16, 4/16, 6/16, 4/16, 1/16]
  const float kern[5] = float[](0.0625, 0.25, 0.375, 0.25, 0.0625);
  
  vec3 sum = vec3(0.0);
  float wSum = 0.0;
  
  // Pre-calculate the normal exponent factor to save ALU cycles in the loop
  float normalExponent = 48.0 * u_strength;
  
  // Apply 5×5 bilateral filter with strided sampling
  for (int y = -2; y <= 2; y++) {
    // Hoist Y-axis weight and offset calculation outside the inner loop for efficiency
    float weightY = kern[y + 2];
    float offsetY = float(y) * stride * texel.y;
    
    for (int x = -2; x <= 2; x++) {
      float weightX = kern[x + 2];
      float offsetX = float(x) * stride * texel.x;
      
      // Sample offset with stride
      vec2 uv2 = clamp(v_uv + vec2(offsetX, offsetY), vec2(0.0), vec2(1.0));
      
      // Sample color and normal at offset
      vec3 c = texture(u_color, uv2).rgb;
      vec3 n = texture(u_normal, uv2).rgb * 2.0 - 1.0;
      
      // Normal similarity weight (high when normals are aligned)
      float wN = pow(max(0.0, dot(nC, n)), normalExponent);
      
      // Color similarity weight (prevents blurring across contrasting color edges)
      float wC = exp(-length(cC - c) * 4.0);
      
      // Combined weight: 2D spatial binomial weight * normal similarity * color similarity
      float w = weightX * weightY * wN * wC;
      
      sum += c * w;
      wSum += w;
    }
  }
  
  // Accumulate weighted average using a safe epsilon threshold to prevent NaN division
  fragColor = vec4(wSum > 0.0001 ? sum / wSum : cC, 1.0);
}