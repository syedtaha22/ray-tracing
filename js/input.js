/**
 * input.js
 * Mouse orbit/pan, scroll zoom, and window resize.
 * Mutates camera state and calls scheduleReset() on the renderer.
 */

"use strict";

import { cam, buildCamera, add3, scale3 } from './camera.js';
import { scheduleReset, resize } from './renderer.js';

export function initInput(canvas) {
    // resize
    function doResize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2.0);
        const W   = Math.floor(window.innerWidth  * dpr);
        const H   = Math.floor(window.innerHeight * dpr);
        canvas.width  = W;
        canvas.height = H;
        canvas.style.width  = window.innerWidth  + 'px';
        canvas.style.height = window.innerHeight + 'px';
        document.getElementById('reso').textContent = W + 'x' + H;
        resize(W, H);
    }

    doResize();
    window.addEventListener('resize', doResize);

    // mouse
    const mouse = { down: false, btn: -1, lx: 0, ly: 0 };

    canvas.addEventListener('mousedown', e => {
        mouse.down = true;
        mouse.btn  = e.button;
        mouse.lx   = e.clientX;
        mouse.ly   = e.clientY;
        canvas.classList.add('dragging');
        e.preventDefault();
    });

    window.addEventListener('mouseup', () => {
        mouse.down = false;
        canvas.classList.remove('dragging');
    });

    window.addEventListener('mousemove', e => {
        if (!mouse.down) return;
        const dx = e.clientX - mouse.lx;
        const dy = e.clientY - mouse.ly;
        mouse.lx = e.clientX;
        mouse.ly = e.clientY;

        if (mouse.btn === 0) {
            // Orbit
            cam.theta -= dx * 0.005;
            cam.phi   += dy * 0.005;
        } else {
            // Pan
            const c = buildCamera();
            const s = cam.radius * 0.001;
            cam.target = add3(cam.target, scale3(c.right, -dx * s));
            cam.target = add3(cam.target, scale3(c.up,     dy * s));
        }
        scheduleReset();
    });

    // scroll zoom
    canvas.addEventListener('wheel', e => {
        cam.radius *= 1.0 + e.deltaY * 0.001;
        scheduleReset();
        e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('contextmenu', e => e.preventDefault());

    // Return the current dimensions so main.js can pass them to initWebGL
    return {
        getSize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2.0);
            return {
                W: Math.floor(window.innerWidth  * dpr),
                H: Math.floor(window.innerHeight * dpr),
            };
        }
    };
}
