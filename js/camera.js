/**
 * camera.js
 * Spherical camera state + vec3 math helpers + buildCamera().
 */

"use strict"; // Enable strict mode for better error checking and to prevent accidental globals.

// vec3 helper functions.

// Norm: returns a unit vector in the same direction as v.
// In other words, just normalizes the input vector.
export function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0]/l, v[1]/l, v[2]/l]; }

// Basic vector math: add, subtract, scale, cross product.
export function sub3(a, b)  { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
export function add3(a, b)  { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
export function scale3(v, s){ return [v[0]*s, v[1]*s, v[2]*s]; }
export function cross3(a, b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }

// Camera state
const focal_lenght_mm = 50.0; // focal length in mm
const sensor_width_mm = 36.0; // sensor width in mm
export const CAM_FOV = 2.0 * Math.atan(sensor_width_mm / (2.0 * focal_lenght_mm)); // FOV in radians
// export const CAM_FOV = 2.0 * Math.atan(36.0 / (2.0 * 50.0)); // 50 mm lens on 36 mm sensor

export const cam = {
    // Theta: horizontal angle around the target (in radians). 
    //  - 0 means looking along +Z, 
    //  - positive rotates to the right.
    // Phi: vertical angle from the target (in radians). 
    //  - 0 means looking at the same height as the target, 
    //  - positive rotates up.
    // Radius: distance from the target point. 
    //  - Minimum 1.0 to avoid singularity.
    // Target: the point the camera is looking at. 
    //  - Default is [0, -0.5, 0] to look slightly down at the origin.

    theta:  Math.atan2(5.0, 14.0),
    phi:    Math.atan2(1.0, Math.hypot(5, 14)),
    radius: Math.hypot(5, 14, 1),
    target: [0.0, -0.5, 0.0],
};

/**
 * Computes the camera basis from the current spherical state.
 * Returns { pos, fwd, right, up }.
 */
export function buildCamera() {
    // Clamp phi and radius to prevent singularities and extreme zoom.
    cam.phi    = Math.max(-1.5, Math.min(1.5, cam.phi));
    cam.radius = Math.max(1.0,  Math.min(80.0, cam.radius));

    // Convert spherical coordinates (theta, phi, radius) to Cartesian coordinates (x, y, z).
    // x = r * cos(phi) * sin(theta)
    // y = r * sin(phi)
    // z = r * cos(phi) * cos(theta)
    const x = cam.radius * Math.cos(cam.phi) * Math.sin(cam.theta);
    const y = cam.radius * Math.sin(cam.phi);
    const z = cam.radius * Math.cos(cam.phi) * Math.cos(cam.theta);

    // Compute the camera position by adding the offset (x, y, z) to the target point.
    const pos   = add3(cam.target, [x, y, z]);
    
    // Compute the forward vector (fwd) as the normalized direction
    // from the camera position to the target.
    // This tells us where the camera is looking
    const fwd   = norm3(sub3(cam.target, pos));

    // Compute the right vector (right) as the normalized cross product
    // of the forward vector and the world up vector [0, 1, 0].
    // This gives us the camera's right direction, which is perpendicular
    // to both the forward direction and the world up.
    // The right direction tells us how the camera is oriented horizontally.
    const right = norm3(cross3(fwd, [0, 1, 0]));

    // Compute the up vector (up) as the cross product of the right and forward vectors.
    // This gives us the camera's up direction, which is perpendicular to both
    // the forward and right directions. The up direction tells us how the camera
    // is oriented vertically.
    const up    = cross3(right, fwd);

    return { pos, fwd, right, up };
}
