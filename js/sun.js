/**
 * sun.js
 * Sun direction vector, atmospheric colour approximation,
 * and real-time sun-position from local clock.
 */
"use strict";

export class Sun {
    constructor() {
        this.azimuth   = 160;
        this.elevation = 8;
        this.size      = 1.0;
        this.intensity = 1.0;
    }

    get direction() {
        // Azimuth: Describes the sun's rotation around the vertical axis.
        //  - 0° means it's in the north, 
        //  - 90° means it's in the east, 
        //  - 180° means it's in the south, 
        //  - 270° means it's in the west.
        // Elevation: Describes how high the sun is in the sky. 
        //  - 0° means it's on the horizon, 
        //  - 90° means it's directly overhead.

        // Convert degrees to radians for trigonometric functions.
        const a = this.azimuth   * Math.PI / 180;
        const e = this.elevation * Math.PI / 180;

        // Convert spherical coordinates (azimuth, elevation) to Cartesian coordinates (x, y, z).
        // x = cos(elevation) * sin(azimuth)
        // y = sin(elevation)
        // z = cos(elevation) * cos(azimuth)
        return [
            Math.cos(e) * Math.sin(a),
            Math.sin(e),
            Math.cos(e) * Math.cos(a),
        ];
    }

    /**
     * Atmospheric colour approximation.
     * Lower elevations scatter more -> warmer / redder sun.
     * 
     * The numbers here, are interpolated by considering
     * Desired sun colors at various elevations, and then 
     * finding a simple formula that approximates them.
     * 
     * @returns {number[]} RGB intensity triplet
     */
    get color() {
        const t = Math.max(0, Math.min(1, this.elevation / 25.0));
        const i = 3.5 + t * 2.5;
        return [i, (0.48 + t * 0.28) * i, (0.07 + t * 0.48) * i];
    }

    /**
     * Derives azimuth + elevation from the browser's local clock.
     * Sunrise ~06:00, solar noon ~12:00, sunset ~18:00.
     * 
     * In the real world, the sun's position also depends on the 
     * date and geographic location, but here, for the sake
     * of simplicity, I just assume a fixed 24-hour cycle with a 
     * smooth sine wave for elevation.
     * 
     * @returns {{ azimuth: number, elevation: number }}
     */
    syncToRealTime() {
        // Get the current local time from the browser.
        const now   = new Date();

        // Convert the time to a decimal hour format (e.g., 14.5 for 2:30 PM).
        const hours = now.getHours() + now.getMinutes() / 60.0;
        const t     = (hours - 6) / 12; // 0 = sunrise, 1 = sunset

        // Azimuth: 15deg per hour, starting at 0° (north) at 00:00.
        this.azimuth   = (hours * 15) % 360;
        
        // Elevation: sine arc between 06:00–18:00, negative at night
        this.elevation = (t < 0 || t > 1) ? 0 : Math.sin(t * Math.PI) * 60;
    }
}
