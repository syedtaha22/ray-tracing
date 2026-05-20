/**
 * shaders.js
 * Fetches all GLSL source files and injects the shared scene code
 * into the shaders that need it.
 */

"use strict";

/**
 * Loads all shaders from the shaders/ directory.
 * @returns {Promise<Object>} Resolved shader source map: { VS, FS_TRACE, FS_NORMAL, FS_ATROUS, FS_DISPLAY }
 */
export class ShaderLoader {
    static async load() {
        const [scene, vs, trace, normal, atrous, display] = await Promise.all([
            fetch('shaders/scene.glsl').then(r => r.text()),
            fetch('shaders/vertex.glsl').then(r => r.text()),
            fetch('shaders/trace.glsl').then(r => r.text()),
            fetch('shaders/normal.glsl').then(r => r.text()),
            fetch('shaders/atrous.glsl').then(r => r.text()),
            fetch('shaders/display.glsl').then(r => r.text()),
        ]);

        return {
            VS:         vs,

            // The trace and normal shaders both need the scene data (object arrays,
            // ray-AABB intersection, etc), so we inject the sceneGlsl code into them.
            // prevents the need for duplicating code...
            FS_TRACE:   trace.replace('/* SCENE_GLSL */',  scene),
            FS_NORMAL:  normal.replace('/* SCENE_GLSL */', scene),

            FS_ATROUS:  atrous,
            FS_DISPLAY: display,
        };
    }
}
