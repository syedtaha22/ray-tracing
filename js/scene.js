/**
 * scene.js
 * Scene geometry: all 16 AABB objects, flattened typed arrays,
 * and the volume-bounds uniforms.
 *
 * N_OBJ is fixed at 16, a compile-time constant in the GLSL shaders.
 * Inactive slots (on: 0) are hit-tested as misses by the shader immediately,
 * which avoids a D3D11/ANGLE recompile bug caused by uniform-bounded loops.
 */

"use strict";

// Blender Z-up -> GL Y-up coordinate conversions
// Blender uses a right-handed coordinate system
// with Z as up, while WebGL typically uses Y as up.
// We need to make this conversion, since my origianal
// scene was designed in Blender. 
export function b2gl(x, y, z) { return [x, z, -y]; }

// Just a helper, in case I later realise the blender 
// scaling laws are also different.
export function b2dim(x, y, z) { return [x, z, y]; }

const N_OBJ = 16;

// Each object has:
// - pos: center position (x, y, z)
// - half: half-size (hx, hy, hz) — used for AABB intersection
// - mat: material ID (0=empty, 1=water, 2=solid)
// - on: 1 if the object is active, 0 if it's inactive (used to skip in shader)

const OBJ = [
    // 0  primary_cube
    { pos: b2gl(0, 0, -1.218),          half: b2dim(1, 1, 1),             mat: 2, on: 1 },
    // 1  sea_plane      water
    { pos: b2gl(0, 0, -1.0),            half: [20.861, 0.02, 20.861],     mat: 1, on: 1 },
    // 2  volume_cube    bounds only — NOT intersected as surface
    { pos: b2gl(0, 0, 1.0),             half: b2dim(18.509, 18.509, 18.509), mat: 2, on: 0 },

    // 3-14  god-ray blocker cubes
    { pos: b2gl(4.207, 6.625, 1.119),   half: [0.0785, 0.0785, 0.0785],  mat: 2, on: 1 },
    { pos: b2gl(4.511, 5.842, 1.141),   half: [0.0785, 0.0785, 0.0785],  mat: 2, on: 1 },
    { pos: b2gl(4.478, 9.127, 1.315),   half: [0.0785, 0.0785, 0.0785],  mat: 2, on: 1 },
    { pos: b2gl(4.992, 6.126, 1.446),   half: [0.0785, 0.0785, 0.0785],  mat: 2, on: 1 },
    { pos: b2gl(4.979, 6.160, 1.093),   half: [0.0785, 0.0785, 0.0785],  mat: 2, on: 1 },
    { pos: b2gl(4.555, 6.659, 0.673),   half: [0.0785, 0.0785, 0.0785],  mat: 2, on: 1 },
    { pos: b2gl(5.086, 6.118, 0.501),   half: [0.0785, 0.0785, 0.0785],  mat: 2, on: 1 },
    { pos: b2gl(4.166, 6.392, 0.786),   half: [0.0785, 0.0785, 0.0785],  mat: 2, on: 1 },
    { pos: b2gl(4.403, 8.056, 1.494),   half: [0.0785, 0.0785, 0.0785],  mat: 2, on: 1 },
    { pos: b2gl(5.440, 6.516, 1.184),   half: [0.0785, 0.0785, 0.0785],  mat: 2, on: 1 },
    { pos: b2gl(5.549, 5.972, 0.823),   half: [0.0785, 0.0785, 0.0785],  mat: 2, on: 1 },
    { pos: b2gl(4.768, 6.104, 0.882),   half: [0.0785, 0.0785, 0.0785],  mat: 2, on: 1 },
];

// Pad to exactly N_OBJ entries
while (OBJ.length < N_OBJ) {
    OBJ.push({ pos: [0, 0, 0], half: [0.001, 0.001, 0.001], mat: 0, on: 0 });
}

// Flattened typed arrays — uploaded once as uniforms
// posArr: center positions of all objects (x0, y0, z0, x1, y1, z1, ...)
// halfArr: half-sizes of all objects (hx, hy, hz, hx, hy, hz, ...)
// matArr: material IDs of all objects (m0, m1, m2, ...)
// activeArr: on/off flags for all objects (1.0 or 0.0) — used to skip inactive ones in shader
export const posArr    = new Float32Array(N_OBJ * 3); // * 3 for x,y,z components
export const halfArr   = new Float32Array(N_OBJ * 3);
export const matArr    = new Int32Array(N_OBJ);
export const activeArr = new Float32Array(N_OBJ);

OBJ.forEach((o, i) => {
    posArr[i * 3]     = o.pos[0];  
    posArr[i * 3 + 1] = o.pos[1];  
    posArr[i * 3 + 2] = o.pos[2];

    halfArr[i * 3]     = o.half[0]; 
    halfArr[i * 3 + 1] = o.half[1];
    halfArr[i * 3 + 2] = o.half[2];

    matArr[i]         = o.mat;
    activeArr[i]      = o.on;
});

// Volume bounds for OBJ[2] — passed as explicit uniforms to avoid dynamic
// indexing in the shader (triggers ANGLE/D3D11 driver bugs).
export const volMin = [
    OBJ[2].pos[0] - OBJ[2].half[0],
    OBJ[2].pos[1] - OBJ[2].half[1],
    OBJ[2].pos[2] - OBJ[2].half[2],
];

export const volMax = [
    OBJ[2].pos[0] + OBJ[2].half[0],
    OBJ[2].pos[1] + OBJ[2].half[1],
    OBJ[2].pos[2] + OBJ[2].half[2],
];
