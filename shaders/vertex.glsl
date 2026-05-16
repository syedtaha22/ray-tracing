#version 300 es

/**
 * Vertex Shader - Fullscreen Quad
 * 
 * Renders a fullscreen quad that covers the entire viewport.
 * Used as the base pass for all post-processing operations.
 * 
 * Outputs:
 * - v_uv: Normalized UV coordinates [0, 1]
 */

in vec2 a_pos;
out vec2 v_uv;

void main() {
  // Convert from clip-space [-1, 1] to UV-space [0, 1]
  v_uv = a_pos * 0.5 + 0.5;
  
  // Pass through to rasterizer
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
