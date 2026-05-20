/**
 * Gimbal.js
 *
 * Blender-style orientation gimbal drawn on a 2D canvas overlay.
 * Reads the camera basis vectors from Camera.getMatrices() each frame
 * and projects the three world axes into screen space.
 *
 * Axes:
 *   X (right)   — red
 *   Y (up)      — green
 *   Z (forward) — blue
 *
 * Negative halves drawn as darker, thinner lines (like Blender).
 */

class Gimbal {
    constructor(canvasId) {
        this._canvas = document.getElementById(canvasId);
        this._ctx    = this._canvas ? this._canvas.getContext('2d') : null;

        // Size derived from canvas element
        this._cx = this._canvas ? this._canvas.width  / 2 : 45;
        this._cy = this._canvas ? this._canvas.height / 2 : 45;
        this._r  = this._cx - 10;   // axis arm radius in pixels
    }

    /**
     * Draw the gimbal for the current camera orientation.
     * @param {Camera} camera
     */
    draw(camera) {
        if (!this._ctx) return;

        const { right, up, fwd } = camera.getMatrices();
        const ctx = this._ctx;
        const cx  = this._cx, cy = this._cy, r = this._r;

        ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);

        // Background circle
        ctx.beginPath();
        ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(15, 20, 30, 0.55)';
        ctx.fill();

        // Project a world-space unit vector to 2D gimbal space.
        // Camera right → gimbal X, camera up → gimbal Y (flipped), camera fwd → depth
        // We build a simple orthographic projection using the camera's own basis.
        const project = (wx, wy, wz) => {
            // Express the world axis in camera space via dot products
            const camX =  wx * right[0] + wy * right[1] + wz * right[2];
            const camY = -(wx * up[0]   + wy * up[1]   + wz * up[2]);   // flip Y for canvas
            return { x: cx + camX * r, y: cy + camY * r };
        };

        // World axes
        const axes = [
            { dir: [1, 0, 0], label: 'X', col: '#e74c3c' },
            { dir: [0, 1, 0], label: 'Y', col: '#2ecc71' },
            { dir: [0, 0, 1], label: 'Z', col: '#3498db' },
        ];

        // Compute projected tips and sort back-to-front (paint furthest first)
        const projected = axes.map(a => {
            const tip = project(a.dir[0], a.dir[1], a.dir[2]);
            const neg = project(-a.dir[0], -a.dir[1], -a.dir[2]);
            // Depth: dot with fwd (positive = pointing toward camera)
            const depth = a.dir[0]*fwd[0] + a.dir[1]*fwd[1] + a.dir[2]*fwd[2];
            return { ...a, tip, neg, depth };
        });

        // Sort so that axes pointing away from camera are drawn first (behind)
        projected.sort((a, b) => a.depth - b.depth);

        // Draw negative halves first (dimmer)
        for (const ax of projected) {
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(ax.neg.x, ax.neg.y);
            ctx.strokeStyle = ax.col + '44';   // 27% opacity
            ctx.lineWidth   = 1.5;
            ctx.stroke();
        }

        // Draw positive halves
        for (const ax of projected) {
            const alpha = 0.55 + 0.45 * Math.max(0, ax.depth);   // brighter if facing cam

            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(ax.tip.x, ax.tip.y);
            ctx.strokeStyle = ax.col;
            ctx.lineWidth   = 2.5;
            ctx.globalAlpha = alpha;
            ctx.stroke();
            ctx.globalAlpha = 1.0;

            // Dot at tip
            ctx.beginPath();
            ctx.arc(ax.tip.x, ax.tip.y, 3.5, 0, Math.PI * 2);
            ctx.fillStyle   = ax.col;
            ctx.globalAlpha = alpha;
            ctx.fill();
            ctx.globalAlpha = 1.0;

            // Label
            ctx.font        = 'bold 10px system-ui, sans-serif';
            ctx.fillStyle   = ax.col;
            ctx.globalAlpha = alpha;
            ctx.fillText(ax.label, ax.tip.x + 4, ax.tip.y + 4);
            ctx.globalAlpha = 1.0;
        }

        // Centre dot
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fill();
    }
}

export { Gimbal };
