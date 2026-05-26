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
function b2gl(x, y, z)  { return [x, z, -y]; }

// Just a helper, in case I later realise the blender 
// scaling laws are also different.
function b2dim(x, y, z) { return [x, z,  y]; }

const N_OBJ = 16;

// Each object has:
// - pos: center position (x, y, z)
// - half: half-size (hx, hy, hz) - used for AABB intersection
// - mat: material ID (0=empty, 1=water, 2=solid)
// - on: 1 if the object is active, 0 if it's inactive (used to skip in shader)

/**
 * Scene class encapsulates the scene geometry, including all objects and their properties.
 * It initializes the objects, flattens their properties into typed arrays for shader uniforms,
 * and computes the volume bounds for the scene.
 * 
 * The scene consists of 16 objects (N_OBJ), each defined by its position, half-size, material ID, and active state.
 * The objects are padded to ensure there are exactly 16, as required by the shaders.
 * The volume bounds are computed from the third object and stored as explicit uniforms to avoid driver bugs.
 */
export class Scene {
    constructor() {
        const objects = [
            { pos: b2gl(0, 0, -1.218),         half: b2dim(1, 1, 1),               mat: 2, on: 1 }, // mat 0→2 (matte)
            // Sea plane is now a world property - no bounding cube needed
            // volume bounds cube removed (redundant - volume is now a world property)
            { pos: b2gl(4.207, 6.625, 1.119),   half: [0.0785, 0.0785, 0.0785],    mat: 2, on: 1 },
            { pos: b2gl(4.511, 5.842, 1.141),   half: [0.0785, 0.0785, 0.0785],    mat: 2, on: 1 },
            { pos: b2gl(4.478, 9.127, 1.315),   half: [0.0785, 0.0785, 0.0785],    mat: 2, on: 1 },
            { pos: b2gl(4.992, 6.126, 1.446),   half: [0.0785, 0.0785, 0.0785],    mat: 2, on: 1 },
            { pos: b2gl(4.979, 6.160, 1.093),   half: [0.0785, 0.0785, 0.0785],    mat: 2, on: 1 },
            { pos: b2gl(4.555, 6.659, 0.673),   half: [0.0785, 0.0785, 0.0785],    mat: 2, on: 1 },
            { pos: b2gl(5.086, 6.118, 0.501),   half: [0.0785, 0.0785, 0.0785],    mat: 2, on: 1 },
            { pos: b2gl(4.166, 6.392, 0.786),   half: [0.0785, 0.0785, 0.0785],    mat: 2, on: 1 },
            { pos: b2gl(4.403, 8.056, 1.494),   half: [0.0785, 0.0785, 0.0785],    mat: 2, on: 1 },
            { pos: b2gl(5.440, 6.516, 1.184),   half: [0.0785, 0.0785, 0.0785],    mat: 2, on: 1 },
            { pos: b2gl(5.549, 5.972, 0.823),   half: [0.0785, 0.0785, 0.0785],    mat: 2, on: 1 },
            { pos: b2gl(4.768, 6.104, 0.882),   half: [0.0785, 0.0785, 0.0785],    mat: 2, on: 1 },
        ];

        // Pad to N_OBJ (must match #define N_OBJ 16 in shaders)
        while (objects.length < N_OBJ) {
            objects.push({ pos: [0,0,0], half: [0.001,0.001,0.001], mat: 0, on: 0 });
        }

        // Flattened typed arrays - uploaded once as uniforms
        // posArr: center positions of all objects (x0, y0, z0, x1, y1, z1, ...)
        // halfArr: half-sizes of all objects (hx, hy, hz, hx, hy, hz, ...)
        // matArr: material IDs of all objects (m0, m1, m2, ...)
        // activeArr: on/off flags for all objects (1.0 or 0.0) - used to skip inactive ones in shader
        this.posArr    = new Float32Array(N_OBJ * 3); // * 3 for x,y,z components
        this.halfArr   = new Float32Array(N_OBJ * 3);
        this.matArr    = new Int32Array(N_OBJ);
        this.activeArr = new Float32Array(N_OBJ);

        objects.forEach((o, i) => {
            this.posArr.set(o.pos,   i * 3);
            this.halfArr.set(o.half, i * 3);
            this.matArr[i]    = o.mat;
            this.activeArr[i] = o.on;
        });

        // Volume is a world property - no bounding cube needed
        this.volMin = [-999, -999, -999];
        this.volMax = [ 999,  999,  999];
    }
}
