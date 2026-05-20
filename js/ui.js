/**
 * ui.js
 * Wires all HTML controls (sliders, checkboxes, buttons) to the renderer.
 */

"use strict";

export class UI {
    constructor(renderer, sun) {
        this._renderer   = renderer;
        this._sun        = sun;
        this._useRealTime = false;

        this._bindSliders();
        this._bindButtons();
    }

    // Called each frame when real-time mode is active, to sync slider display
    syncSunDisplay() {
        document.getElementById('sunAz').value        = this._sun.azimuth;
        document.getElementById('sunEl').value        = this._sun.elevation;
        document.getElementById('sunAzV').textContent = this._sun.azimuth.toFixed(0);
        document.getElementById('sunElV').textContent = this._sun.elevation.toFixed(1);
    }

    updateStats(fps, samples) {
        document.getElementById('fps').textContent  = fps.toFixed(1);
        document.getElementById('samp').textContent = samples;
    }

    get useRealTime() { return this._useRealTime; }

    // -------------------------------------------------------------------------
    _bindSliders() {
        this._wire('sunAz', 'sunAzV', 0, v => {
            this._sun.azimuth = v;
            this._disableRealTime();
            this._renderer.scheduleReset();
        });

        this._wire('sunEl', 'sunElV', 1, v => {
            this._sun.elevation = v;
            this._disableRealTime();
            this._renderer.scheduleReset();
        });

        this._wire('sunInt',  'sunIntV',  1, v => { this._sun.intensity = v; this._renderer.scheduleReset(); });
        this._wire('sunSize', 'sunSizeV', 1, v => { this._sun.size      = v; this._renderer.scheduleReset(); });
        this._wire('expo',    'expoV',    2, v => { this._renderer.exposure   = v; });
        this._wire('denoise', 'denoiseV', 2, v => { this._renderer.denoiseStr = v; });

        document.getElementById('useRealTime').addEventListener('change', e => {
            this._useRealTime = e.target.checked;
            document.getElementById('sunAz').disabled = this._useRealTime;
            document.getElementById('sunEl').disabled = this._useRealTime;
            this._renderer.scheduleReset();
        });
    }

    _bindButtons() {
        document.getElementById('reset').addEventListener('click',
            () => this._renderer.scheduleReset()
        );

        document.getElementById('save').addEventListener('click', () => {
            const a      = document.createElement('a');
            a.download   = `pathtrace_${this._renderer.frame}spp.png`;
            a.href       = this._renderer.canvas.toDataURL('image/png');
            a.click();
        });
    }

    _disableRealTime() {
        this._useRealTime = false;
        document.getElementById('useRealTime').checked = false;
    }

    /**
     * Binds a range input to a display span and a setter callback.
     * @param {string}   id     Input element id
     * @param {string}   valId  Span element id showing the value (or null)
     * @param {number}   dec    Decimal places for display
     * @param {Function} cb     Called with the parsed float value
     */
    _wire(id, valId, dec, cb) {
        document.getElementById(id).addEventListener('input', e => {
            const v = parseFloat(e.target.value);
            if (valId) document.getElementById(valId).textContent = v.toFixed(dec);
            cb(v);
        });
    }
}
