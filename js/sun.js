/**
 * sun.js
 * Sun direction vector, atmospheric colour approximation,
 * and real-time sun-position from local clock.
 */

"use strict";

/**
 * Converts azimuth (degrees) + elevation (degrees) -> unit direction vec3.
 */
export function sunDir(az, el) {
    // Azimuth: Describes the sun's rotation around the vertical axis.
    //  - 0° means it's in the north, 
    //  - 90° means it's in the east, 
    //  - 180° means it's in the south, 
    //  - 270° means it's in the west.
    // Elevation: Describes how high the sun is in the sky. 
    //  - 0° means it's on the horizon, 
    //  - 90° means it's directly overhead.

    // Convert degrees to radians for trigonometric functions.
    const a = az * Math.PI / 180;
    const e = el * Math.PI / 180;

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
 * @param {number} el  Sun elevation in degrees
 * @returns {number[]} RGB intensity triplet
 */
export function sunColor(el) {
    // 
    const t = Math.max(0.0, Math.min(1.0, el / 25.0));
    const baseIntensity = 3.5 + t * 2.5;
    return [
        baseIntensity,
        (0.48 + t * 0.28) * baseIntensity,
        (0.07 + t * 0.48) * baseIntensity,
    ];
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
export function getSunPositionFromTime() {
    // Get the current local time from the browser.
    const now   = new Date();

    // Convert the time to a decimal hour format (e.g., 14.5 for 2:30 PM).
    const hours = now.getHours() + now.getMinutes() / 60.0;

    // Azimuth: 15deg per hour, starting at 0° (north) at 00:00.
    const azimuth = (hours * 15.0) % 360.0;

    // Elevation: sine arc between 06:00–18:00, negative at night
    const t = (hours - 6.0) / 12.0; // 0 at sunrise, 1 at sunset
    const elevation = (t < 0.0 || t > 1.0)
        ? -10.0
        : Math.sin(t * Math.PI) * 60.0; // peak 60° at noon

    return { azimuth, elevation };
}
