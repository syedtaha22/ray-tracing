/**
 * input.js
 * Mouse orbit/pan, scroll zoom, and window resize.
 * Mutates camera state and calls scheduleReset() on the renderer.
 */

"use strict";

export class InputHandler {
    constructor(canvas, camera, renderer) {
        this._canvas   = canvas;
        this._camera   = camera;
        this._renderer = renderer;
        this._mouse    = { down: false, btn: -1, lx: 0, ly: 0 };

        this._bindResize();
        this._bindMouse();
        this._bindScroll();

        // Run once to set initial size
        this._onResize();
    }

    _onResize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2.0);
        const W   = Math.floor(window.innerWidth  * dpr);
        const H   = Math.floor(window.innerHeight * dpr);
        this._canvas.width        = W;
        this._canvas.height       = H;
        this._canvas.style.width  = window.innerWidth  + 'px';
        this._canvas.style.height = window.innerHeight + 'px';
        document.getElementById('reso').textContent = `${W}x${H}`;
        this._renderer.resize(W, H);
    }

    _bindResize() {
        window.addEventListener('resize', () => this._onResize());
    }

    _bindMouse() {
        const canvas = this._canvas;

        canvas.addEventListener('mousedown', e => {
            this._mouse = { down: true, btn: e.button, lx: e.clientX, ly: e.clientY };
            canvas.classList.add('dragging');
            e.preventDefault();
        });

        window.addEventListener('mouseup', () => {
            this._mouse.down = false;
            canvas.classList.remove('dragging');
        });

        window.addEventListener('mousemove', e => {
            if (!this._mouse.down) return;
            const dx = e.clientX - this._mouse.lx;
            const dy = e.clientY - this._mouse.ly;
            this._mouse.lx = e.clientX;
            this._mouse.ly = e.clientY;

            if (this._mouse.btn === 0) {
                this._camera.orbit(dx, dy);
            } else {
                this._camera.pan(dx, dy);
            }
            this._renderer.scheduleReset();
        });

        canvas.addEventListener('contextmenu', e => e.preventDefault());
    }

    _bindScroll() {
        this._canvas.addEventListener('wheel', e => {
            this._camera.zoom(e.deltaY);
            this._renderer.scheduleReset();
            e.preventDefault();
        }, { passive: false });
    }
}
