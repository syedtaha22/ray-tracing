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
        // Sky shader now handles night itself - color only matters when sun is up
        const elRad = this.elevation * Math.PI / 180;
        const t     = Math.max(0, Math.min(1, this.elevation / 25.0));
        const i     = (3.5 + t * 2.5) * Math.max(0, Math.sin(elRad));
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
        const hours = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
        const t     = (hours - 6) / 12; // 0 at 6am, 1 at 6pm, negative at night

        // Full 360° azimuth rotation over 24 hours (180° = south at noon)
        this.azimuth = (hours / 24) * 360;

        // Elevation: full sine arc, peaks at solar noon (~90° max at equator)
        // Range -90 to +90 - negative means below horizon (night)
        this.elevation = Math.sin(t * Math.PI) * 75;
    }
}
