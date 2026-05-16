/**
 * ui.js
 * Wires all HTML controls (sliders, checkboxes, buttons) to the renderer.
 */

"use strict";

import {
    setSunAz, setSunEl, setExposure, setDenoiseStr,
    setSunSize, setSunIntensity, setUseRealTime,
    scheduleReset, getFrame, getCanvas,
} from './renderer.js';

/**
 * Binds a range input to a display span and a setter callback.
 * @param {string}   id     Input element id
 * @param {string}   valId  Span element id showing the value (or null)
 * @param {number}   dec    Decimal places for display
 * @param {Function} cb     Called with the parsed float value
 */
function wire(id, valId, dec, cb) {
    document.getElementById(id).addEventListener('input', e => {
        const v = parseFloat(e.target.value);
        if (valId) document.getElementById(valId).textContent = v.toFixed(dec);
        cb(v);
    });
}

export function initUI() {
    wire('sunAz', 'sunAzV', 0, v => {
        setSunAz(v);
        setUseRealTime(false);
        document.getElementById('useRealTime').checked = false;
        scheduleReset();
    });

    wire('sunEl', 'sunElV', 1, v => {
        setSunEl(v);
        setUseRealTime(false);
        document.getElementById('useRealTime').checked = false;
        scheduleReset();
    });

    wire('sunInt',  'sunIntV',  1, v => { setSunIntensity(v); scheduleReset(); });
    wire('sunSize', 'sunSizeV', 1, v => { setSunSize(v);      scheduleReset(); });
    wire('expo',    'expoV',    2, v => { setExposure(v); });
    wire('denoise', 'denoiseV', 2, v => { setDenoiseStr(v); });

    document.getElementById('useRealTime').addEventListener('change', e => {
        const on = e.target.checked;
        setUseRealTime(on);
        document.getElementById('sunAz').disabled = on;
        document.getElementById('sunEl').disabled = on;
        scheduleReset();
    });

    document.getElementById('reset').addEventListener('click', scheduleReset);

    document.getElementById('save').addEventListener('click', () => {
        const a = document.createElement('a');
        a.download = `pathtrace_${getFrame()}spp.png`;
        a.href     = getCanvas().toDataURL('image/png');
        a.click();
    });
}

/**
 * Updates the sun slider UI from renderer state (used by real-time mode).
 * @param {number} az
 * @param {number} el
 */
export function updateSunUI(az, el) {
    document.getElementById('sunAz').value        = az;
    document.getElementById('sunEl').value        = el;
    document.getElementById('sunAzV').textContent = az.toFixed(0);
    document.getElementById('sunElV').textContent = el.toFixed(1);
}

/**
 * Updates the FPS / sample counter display.
 * @param {number} fps
 * @param {number} samples
 */
export function updateStats(fps, samples) {
    document.getElementById('fps').textContent  = fps.toFixed(1);
    document.getElementById('samp').textContent = samples;
}
