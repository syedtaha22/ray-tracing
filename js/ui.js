"use strict";

export class UI {
    constructor(renderer, sun) {
        this._renderer    = renderer;
        this._sun         = sun;
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

        // Show local time
        const now = new Date();
        const hh  = String(now.getHours()).padStart(2, '0');
        const mm  = String(now.getMinutes()).padStart(2, '0');
        const el  = document.getElementById('realTimeDisplay');
        if (el) el.textContent = hh + ':' + mm;
    }

    updateMoonInfo(moon) {
        const el = document.getElementById('moonInfo');
        if (!el) return;
        const phaseName = UI._phaseName(moon.phase);
        const pct       = Math.round(moon.brightness * 100);
        el.textContent  = `☽  ${phaseName}  •  ${pct}% illuminated`;
    }

    static _phaseName(phase) {
        // phase 0=new, 0.125=waxing crescent, 0.25=first quarter ...
        const names = [
            'New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
            'Full Moon', 'Waning Gibbous',  'Last Quarter',  'Waning Crescent',
        ];
        const idx = Math.round(phase * 8) % 8;
        return names[idx];
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

        // Path tracer controls
        this._wire('bounces', 'bouncesV', 0, v => { this._renderer.maxBounces = v; this._renderer.scheduleReset(); });
        this._wire('volDens',    'volDensV',    3, v => { this._renderer.volDensity = v;  this._renderer.scheduleReset(); });
        this._wire('volHeight',  'volHeightV',  2, v => { this._renderer.volHeight  = v;  this._renderer.scheduleReset(); });
        this._wire('volScatter', 'volScatterV', 1, v => { this._renderer.volScatter = v;  this._renderer.scheduleReset(); });

        document.getElementById('shadowsOn').addEventListener('change', e => {
            this._renderer.shadowsOn = e.target.checked ? 1 : 0;
            this._renderer.scheduleReset();
        });

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

    _wire(id, valId, dec, cb) {
        document.getElementById(id).addEventListener('input', e => {
            const v = parseFloat(e.target.value);
            if (valId) document.getElementById(valId).textContent = v.toFixed(dec);
            cb(v);
        });
    }




}
