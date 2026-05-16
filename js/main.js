/**
 * main.js
 * Entry point — boots the engine in four steps:
 *   1. Grab DOM references and set up error/loading UI
 *   2. Obtain a WebGL2 context
 *   3. Load shaders asynchronously
 *   4. Init subsystems and start the render loop
 */

"use strict";

import { loadShaders }           from './shaders.js';
import { initWebGL, renderFrame, onContextLost, onContextRestored, scheduleReset } from './renderer.js';
import { initInput }             from './input.js';
import { initUI, updateSunUI, updateStats } from './ui.js';

(async function main() {
    // DOM refs
    const canvas   = document.getElementById('c');
    const errDiv   = document.getElementById('err');
    const loading  = document.getElementById('loading');
    const uiPanel  = document.getElementById('ui');
    const hint     = document.getElementById('hint');

    setTimeout(() => { hint.style.opacity = '0'; }, 4000);

    function showErr(msg) {
        loading.style.display = 'none';
        errDiv.style.display  = 'block';
        errDiv.textContent    = msg;
    }

    // WebGL2 context
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
    if (!gl) {
        showErr('WebGL 2 is not available.\nTry Chrome or Firefox on a desktop GPU.');
        return;
    }
    if (!gl.getExtension('EXT_color_buffer_float')) {
        showErr('EXT_color_buffer_float not supported.\nTry Chrome 90+ or Firefox 86+ on desktop.');
        return;
    }

    // Context loss
    canvas.addEventListener('webglcontextlost', e => {
        e.preventDefault();
        onContextLost();
        console.warn('WebGL context lost');
    });

    canvas.addEventListener('webglcontextrestored', () => {
        onContextRestored();
        console.log('WebGL context restored');
        try {
            initWebGL(gl, canvas.width, canvas.height, window.__shaders);
            scheduleReset();
        } catch (e) {
            showErr('Context restore failed:\n\n' + e.message);
        }
    });

    // Input (also sets initial canvas dimensions)
    const input = initInput(canvas);
    const { W, H } = input.getSize();

    // Load shaders
    let shaders;
    try {
        shaders = await loadShaders();
        window.__shaders = shaders; // keep a reference for context-restore
    } catch (e) {
        showErr('Failed to load shaders:\n\n' + e.message);
        return;
    }

    // Init WebGL
    try {
        initWebGL(gl, W, H, shaders);
    } catch (e) {
        showErr('Shader compile error:\n\n' + e.message);
        return;
    }

    // UI controls
    initUI();

    // Start
    loading.style.display = 'none';
    uiPanel.style.display = 'block';

    function loop() {
        renderFrame(
            (fps, samples) => updateStats(fps, samples),
            (az, el)        => updateSunUI(az, el),
        );
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
})();
