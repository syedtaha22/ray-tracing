/**
 * Camera.js
 * Spherical camera state + vec3 math helpers + buildCamera().
 */

"use strict"; // Enable strict mode for better error checking and to prevent accidental globals.

export class Camera {
    constructor() {
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
        this.theta  = Math.atan2(5.0, 14.0);
        this.phi    = Math.atan2(1.0, Math.hypot(5, 14));
        this.radius = Math.hypot(5, 14, 1);
        this.target = [0.0, -0.5, 0.0];
        this.fov    = 2.0 * Math.atan(36.0 / (2.0 * 50.0)); // 50mm lens
    }

    orbit(dx, dy) {
        // Orbiting changes the theta and phi angles based on mouse movement (dx, dy).
        this.theta -= dx * 0.005;
        this.phi   += dy * 0.005;
    }

    pan(dx, dy) {
        // Panning moves the target point in the camera's right and up directions 
        // based on mouse movement (dx, dy).
        const { right, up } = this.getMatrices();
        const s = this.radius * 0.001;
        this.target = this._add(this.target, this._scale(right, -dx * s));
        this.target = this._add(this.target, this._scale(up,     dy * s));
    }

    zoom(delta) {
        // Zooming changes the radius based on scroll input (delta).
        this.radius *= 1.0 + delta * 0.001;
    }

    getMatrices() {
        // Clamp phi and radius to prevent singularities and extreme zoom.
        this.phi    = Math.max(-1.5, Math.min(1.5,  this.phi));
        this.radius = Math.max(1.0,  Math.min(80.0, this.radius));

        // Convert spherical coordinates (theta, phi, radius) to Cartesian coordinates (x, y, z).
        // x = r * cos(phi) * sin(theta)
        // y = r * sin(phi)
        // z = r * cos(phi) * cos(theta)
        const x = this.radius * Math.cos(this.phi) * Math.sin(this.theta);
        const y = this.radius * Math.sin(this.phi);
        const z = this.radius * Math.cos(this.phi) * Math.cos(this.theta);

        // Compute the camera position by adding the offset (x, y, z) to the target point.
        const pos   = this._add(this.target, [x, y, z]);
    
        // Compute the forward vector (fwd) as the normalized direction
        // from the camera position to the target.
        // This tells us where the camera is looking
        const fwd   = this._norm(this._sub(this.target, pos));

        // Compute the right vector (right) as the normalized cross product
        // of the forward vector and the world up vector [0, 1, 0].
        // This gives us the camera's right direction, which is perpendicular
        // to both the forward direction and the world up.
        // The right direction tells us how the camera is oriented horizontally.
        const right = this._norm(this._cross(fwd, [0, 1, 0]));

        // Compute the up vector (up) as the cross product of the right and forward vectors.
        // This gives us the camera's up direction, which is perpendicular to both
        // the forward and right directions. The up direction tells us how the camera
        // is oriented vertically.
        const up    = this._cross(right, fwd);

        return { pos, fwd, right, up };
    }

    // vec3 helper functions.

    // Norm: returns a unit vector in the same direction as v.
    // In other words, just normalizes the input vector.
    _norm(v)    { const l = Math.hypot(...v); return v.map(c => c / l); }

    // Basic vector math: add, subtract, scale, cross product.
    _sub(a, b)  { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
    _add(a, b)  { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
    _scale(v,s) { return v.map(c => c * s); }
    _cross(a,b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
}
