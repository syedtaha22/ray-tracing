/**
 * main.js
 * Entry point - boots the engine in four steps:
 *   1. Grab DOM references and set up error/loading UI
 *   2. Obtain a WebGL2 context
 *   3. Load shaders asynchronously
 *   4. Init subsystems and start the render loop
 */

"use strict";

// Tuning constants - edit here to adjust quality vs. performance
// I should consider moving this some place else...
const SUN_RESET_THRESHOLD_DEG = 0.1;  // degrees of sun movement before resetting accumulation (try 0.5)

import { Renderer }      from './renderer.js';
import { ShaderLoader }  from './shaders.js';

import { Scene }         from './scene.js';
import { Camera }        from './camera.js';
import { Sun }           from './sun.js';
import { Moon }          from './moon.js';

import { InputHandler }  from './input.js';
import { UI }            from './ui.js';
import { Gimbal }        from './gimbal.js';

async function main() {
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


    // --- Instantiate --------------------------------------------------------
    let renderer;
    try {
        renderer = new Renderer(canvas);
    } catch (e) {
        showErr(e.message);
        return;
    }

    const scene  = new Scene();
    const camera = new Camera();
    const sun    = new Sun();
    const moon   = new Moon();
    const input  = new InputHandler(canvas, camera, renderer);
    const ui     = new UI(renderer, sun, moon);
    const gimbal  = new Gimbal('gimbal');

    // Context loss
    canvas.addEventListener('webglcontextlost', e => {
        e.preventDefault();
        console.warn('WebGL context lost');
    });

    canvas.addEventListener('webglcontextrestored', async () => {
        console.log('WebGL context restored');
        try {
            const shaders = await ShaderLoader.load();
            renderer.init(shaders);
            renderer.scheduleReset();
        } catch (e) {
            showErr('Context restore failed:\n\n' + e.message);
        }
    });

    // Load shaders
    try {
        const shaders = await ShaderLoader.load();
        renderer.init(shaders);
    } catch (e) {
        showErr('Failed to load shaders:\n\n' + e.message);
        return;
    }

    // Start
    loading.style.display = 'none';
    uiPanel.style.display = 'block';

    // Render loop
    let fpsT = performance.now(), fpsN = 0;

    let lastSunAz = -999, lastSunEl = -999;

    function loop() {
        if (ui.useRealTime) {
            sun.syncToRealTime();
            ui.syncSunDisplay();

            // Reset accumulation when sun moves more than SUN_RESET_THRESHOLD_DEG
            // avoids ghosting as the sun travels across the sky
            const azDiff = Math.abs(sun.azimuth   - lastSunAz);
            const elDiff = Math.abs(sun.elevation - lastSunEl);
            if (azDiff > SUN_RESET_THRESHOLD_DEG || elDiff > SUN_RESET_THRESHOLD_DEG) {
                renderer.scheduleReset();
                lastSunAz = sun.azimuth;
                lastSunEl = sun.elevation;
            }
        }

        moon.update();
        renderer.render(camera, scene, sun, moon);
        ui.updateMoonInfo(moon);
        gimbal.draw(camera);

        fpsN++;
        const now = performance.now();
        if (now - fpsT > 500) {
            ui.updateStats(fpsN / ((now - fpsT) / 1000), renderer.frame);
            fpsN = 0;
            fpsT = now;
        }

        requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);
}

main();
