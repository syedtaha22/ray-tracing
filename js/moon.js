/**
 * Moon.js
 *
 * Computes physically accurate moon position and phase from the real date.
 *
 * Algorithm: simplified lunar theory (accurate to ~1° - sufficient for
 * a sky renderer). Based on Jean Meeus "Astronomical Algorithms" Ch.47.
 *
 * Outputs passed to the shader as uniforms:
 *   u_moonDir      - normalised world-space direction to the moon
 *   u_moonPhase    - 0=new, 0.5=full, 1=new again  (continuous 0..1)
 *   u_moonBright   - luminance scale (full moon ≈ 1.0, new moon ≈ 0.0)
 *   u_moonUp       - 1 if moon is above horizon, else 0 (smooth transition)
 */

export class Moon {
    constructor() {
        this.direction  = [0, 1, 0]; // world-space unit vector to moon
        this.phase      = 0.5;       // 0–1, 0=new, 0.25=first quarter, 0.5=full
        this.brightness = 1.0;       // 0–1 luminance multiplier
        this.up         = 1.0;      // smooth 0–1 horizon transition
        this.elongationDeg = 180;

        // Manual override - when set, _compute() uses these instead of real date
        this.manualPhase  = null;  // 0..1 or null
        this.manualBright = null;  // 0..3 or null
        this.manualSize   = 1.0;   // angular size multiplier
        this.manualEl     = null;  // degrees or null
        this.manualAz     = null;  // degrees or null
    }

    /** Call once per frame. */
    update() {
        const now = new Date();
        this._compute(now);

        // Apply any manual overrides
        if (this.manualPhase  !== null) this.phase      = this.manualPhase;
        if (this.manualBright !== null) this.brightness = this.manualBright;
        if (this.manualEl !== null && this.manualAz !== null) {
            const el = this.manualEl * Math.PI / 180;
            const az = this.manualAz * Math.PI / 180;
            this.direction = [
                Math.cos(el) * Math.sin(az),
                Math.sin(el),
                Math.cos(el) * Math.cos(az),
            ];
            this.up = Math.max(0, Math.min(1, (Math.sin(el) + 0.04) / 0.08));
        }
    }

    // -------------------------------------------------------------------------
    // Core computation
    // -------------------------------------------------------------------------
    _compute(date) {
        // Julian Day Number
        const jd = this._julianDay(date);

        // Days since J2000.0
        const T = (jd - 2451545.0) / 36525.0; // Julian centuries

        // Sun's ecliptic longitude (degrees)
        // Mean longitude of sun
        const L0  = 280.46646 + 36000.76983 * T;
        // Mean anomaly of sun
        const M   = (357.52911 + 35999.05029 * T - 0.0001537 * T*T) * Math.PI / 180;
        // Sun's equation of centre
        const Csun = (1.914602 - 0.004817*T - 0.000014*T*T) * Math.sin(M)
                   + (0.019993 - 0.000101*T) * Math.sin(2*M)
                   +  0.000289 * Math.sin(3*M);
        const sunLon = (L0 + Csun) % 360; // ecliptic longitude of sun, degrees

        // Moon's ecliptic longitude (degrees)
        // Mean longitude
        const Lm  = 218.3164477 + 481267.88123421 * T;
        // Mean elongation
        const D   = (297.8501921 + 445267.1114034 * T) * Math.PI / 180;
        // Mean anomaly of moon
        const Mm  = (134.9633964 + 477198.8675055 * T) * Math.PI / 180;
        // Argument of latitude
        const F   = (93.2720950  + 483202.0175233 * T) * Math.PI / 180;

        // Main perturbation terms (Meeus Table 47.a, top terms)
        const dLon = 6.288774 * Math.sin(Mm)
                   + 1.274027 * Math.sin(2*D - Mm)
                   + 0.658314 * Math.sin(2*D)
                   + 0.213618 * Math.sin(2*Mm)
                   - 0.185116 * Math.sin(M)
                   - 0.114332 * Math.sin(2*F);

        const moonLon = (Lm + dLon) % 360;

        // Moon latitude (simplified)
        const dLat = 5.128122 * Math.sin(F)
                   + 0.280602 * Math.sin(Mm + F)
                   + 0.277693 * Math.sin(Mm - F)
                   + 0.173237 * Math.sin(2*D - F);
        const moonLat = dLat; // degrees

        // Phase
        // Elongation = angular separation between moon and sun on ecliptic
        let elongation = ((moonLon - sunLon) % 360 + 360) % 360;
        // phase 0=new, 0.5=full - continuous
        this.phase = elongation / 360;

        // Brightness: cos curve, full moon = 1, new moon ≈ 0
        // phase 0.5 = full → cos(0) = 1; phase 0 = new → cos(π) = -1 → clamp to 0
        const phaseAngle = Math.abs(elongation - 180) * Math.PI / 180; // 0 at full, π at new
        this.brightness  = Math.pow(Math.max(0, Math.cos(phaseAngle)), 0.6);

        // Convert ecliptic → equatorial → horizontal (az/el)
        // Obliquity of ecliptic
        const eps  = (23.439291111 - 0.013004167 * T) * Math.PI / 180;
        const lonR = moonLon * Math.PI / 180;
        const latR = moonLat * Math.PI / 180;

        // Ecliptic → equatorial
        const sinDec = Math.sin(latR)*Math.cos(eps) + Math.cos(latR)*Math.sin(eps)*Math.sin(lonR);
        const dec    = Math.asin(Math.max(-1, Math.min(1, sinDec)));
        const y      = Math.sin(lonR)*Math.cos(eps) - Math.tan(latR)*Math.sin(eps);
        const x      = Math.cos(lonR);
        const ra     = Math.atan2(y, x); // radians

        // Greenwich Sidereal Time (radians)
        const GST  = (280.46061837 + 360.98564736629*(jd-2451545.0)) * Math.PI / 180;
        // Hour angle (using Greenwich - approximate, no observer longitude needed
        // for a sky renderer that just needs relative moon position)
        const HA   = GST - ra;

        // Horizontal coordinates
        // Using a mid-latitude observer (30°N) as a reasonable default -
        // the exact latitude doesn't matter much for a renderer, it just
        // shifts the elevation slightly
        const lat  = 24.8607 * Math.PI / 180; // Karachi latitude
        const sinEl = Math.sin(lat)*Math.sin(dec) + Math.cos(lat)*Math.cos(dec)*Math.cos(HA);
        const el    = Math.asin(Math.max(-1, Math.min(1, sinEl)));
        const az    = Math.atan2(
            Math.sin(HA),
            Math.cos(HA)*Math.sin(lat) - Math.tan(dec)*Math.cos(lat)
        ) + Math.PI; // 0=N, π/2=E, π=S

        // World-space direction
        // Same convention as Sun.js: x=east, y=up, z=south
        this.direction = [
            Math.cos(el) * Math.sin(az),
            Math.sin(el),
            Math.cos(el) * Math.cos(az),
        ];

        // Smooth horizon transition
        this.up = Math.max(0, Math.min(1, (Math.sin(el) + 0.04) / 0.08));

        // Store elongation for the shader's phase terminator
        this.elongationDeg = elongation;
    }

    _julianDay(date) {
        // Standard Julian Day from calendar date
        const Y = date.getUTCFullYear();
        const M = date.getUTCMonth() + 1;
        const D = date.getUTCDate()
                + date.getUTCHours()   / 24
                + date.getUTCMinutes() / 1440
                + date.getUTCSeconds() / 86400;

        const A = Math.floor(Y / 100);
        const B = 2 - A + Math.floor(A / 4);
        return Math.floor(365.25 * (Y + 4716))
             + Math.floor(30.6001 * (M + 1))
             + D + B - 1524.5;
    }
}
