"use strict";

export class UI {
    constructor(renderer, sun, moon) {
        this._renderer    = renderer;
        this._sun         = sun;
        this._moon        = moon;
        this._useRealTime = false;

        this._initAccordion();
        this._bindGlobal();
        this._bindSun();
        this._bindMoon();
        this._bindRender();
        this._bindAtmosphere();
        this._bindButtons();
    }

    // Public

    get useRealTime() { return this._useRealTime; }

    updateStats(fps, samples) {
        document.getElementById('fps').textContent  = fps.toFixed(1);
        document.getElementById('samp').textContent = samples;
    }

    syncSunDisplay() {
        this._set('sunAz', 'sunAzV', this._sun.azimuth,   0);
        this._set('sunEl', 'sunElV', this._sun.elevation, 1);

        const now = new Date();
        const hh  = String(now.getHours()).padStart(2, '0');
        const mm  = String(now.getMinutes()).padStart(2, '0');
        const el  = document.getElementById('realTimeDisplay');
        if (el) el.textContent = hh + ':' + mm;
    }

    updateMoonInfo(moon) {
        const el = document.getElementById('moonInfo');
        if (!el) return;
        const name = UI._phaseName(moon.phase);
        const pct  = Math.round(moon.brightness * 100);
        el.textContent = `☽  ${name}  ·  ${pct}% lit`;
    }

    // Accordion

    _initAccordion() {
        document.querySelectorAll('.accord-hd').forEach(btn => {
            btn.addEventListener('click', () => {
                const accord = btn.closest('.accord');
                // Locked sections still open/close - just inputs are disabled
                accord.classList.toggle('open');
            });
        });
    }

    // Global controls

    _bindGlobal() {
        document.getElementById('useRealTime').addEventListener('change', e => {
            this._useRealTime = e.target.checked;
            this._applyRealTimeLock(this._useRealTime);
            this._renderer.scheduleReset();
        });
    }

    _applyRealTimeLock(locked) {
        // Lock sun and moon sections - still openable, inputs disabled
        ['accord-sun', 'accord-moon'].forEach(id => {
            document.getElementById(id).classList.toggle('locked', locked);
        });

        if (locked) {
            // Clear manual moon overrides so real-time takes over
            this._moon.manualPhase  = null;
            this._moon.manualBright = null;
            this._moon.manualEl     = null;
            this._moon.manualAz     = null;
        }
    }

    // Sun

    _bindSun() {
        this._wire('sunAz', 'sunAzV', 0, v => {
            if (this._useRealTime) return;
            this._sun.azimuth = v;
            this._renderer.scheduleReset();
        });
        this._wire('sunEl', 'sunElV', 1, v => {
            if (this._useRealTime) return;
            this._sun.elevation = v;
            this._renderer.scheduleReset();
        });
        this._wire('sunInt',  'sunIntV',  1, v => { this._sun.intensity = v; this._renderer.scheduleReset(); });
        this._wire('sunSize', 'sunSizeV', 1, v => { this._sun.size      = v; this._renderer.scheduleReset(); });
    }

    // Moon

    _bindMoon() {
        this._wire('moonPhase', 'moonPhaseV', 2, v => {
            if (this._useRealTime) return;
            this._moon.manualPhase = v;
            const nameEl = document.getElementById('moonPhaseName');
            if (nameEl) nameEl.textContent = UI._phaseName(v);
            this._renderer.scheduleReset();
        });
        this._wire('moonBright', 'moonBrightV', 1, v => {
            if (this._useRealTime) return;
            this._moon.manualBright = v;
            this._renderer.scheduleReset();
        });
        this._wire('moonSize', 'moonSizeV', 1, v => {
            this._moon.manualSize = v;
            this._renderer.scheduleReset();
        });
        this._wire('moonEl', 'moonElV', 0, v => {
            if (this._useRealTime) return;
            this._moon.manualEl = v;
            this._renderer.scheduleReset();
        });
        this._wire('moonAz', 'moonAzV', 0, v => {
            if (this._useRealTime) return;
            this._moon.manualAz = v;
            this._renderer.scheduleReset();
        });
    }

    // Render

    _bindRender() {
        this._wire('expo',    'expoV',    2, v => { this._renderer.exposure   = v; });
        this._wire('denoise', 'denoiseV', 2, v => { this._renderer.denoiseStr = v; });
        this._wire('bounces', 'bouncesV', 0, v => { this._renderer.maxBounces = v; this._renderer.scheduleReset(); });
        document.getElementById('shadowsOn').addEventListener('change', e => {
            this._renderer.shadowsOn = e.target.checked ? 1 : 0;
            this._renderer.scheduleReset();
        });
    }

    // Atmosphere

    _bindAtmosphere() {
        this._wire('volDens',    'volDensV',    3, v => { this._renderer.volDensity = v;  this._renderer.scheduleReset(); });
        this._wire('volHeight',  'volHeightV',  2, v => { this._renderer.volHeight  = v;  this._renderer.scheduleReset(); });
        this._wire('volScatter', 'volScatterV', 1, v => { this._renderer.volScatter = v;  this._renderer.scheduleReset(); });
    }

    // Buttons

    _bindButtons() {
        document.getElementById('reset').addEventListener('click',
            () => this._renderer.scheduleReset()
        );
        document.getElementById('save').addEventListener('click', () => {
            const a    = document.createElement('a');
            a.download = `pathtrace_${this._renderer.frame}spp.png`;
            a.href     = this._renderer.canvas.toDataURL('image/png');
            a.click();
        });
    }

    // Helpers

    _wire(id, valId, dec, cb) {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', e => {
            const v = parseFloat(e.target.value);
            const vEl = document.getElementById(valId);
            if (vEl) vEl.textContent = v.toFixed(dec);
            cb(v);
        });
    }

    _set(inputId, valId, value, dec) {
        const inp = document.getElementById(inputId);
        const val = document.getElementById(valId);
        if (inp) inp.value            = value;
        if (val) val.textContent      = value.toFixed(dec);
    }

    static _phaseName(phase) {
        const names = [
            'New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
            'Full Moon', 'Waning Gibbous',  'Last Quarter',  'Waning Crescent',
        ];
        return names[Math.round(phase * 8) % 8];
    }
}
