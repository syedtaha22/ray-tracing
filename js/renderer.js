/**
 * renderer.js
 * WebGL2 context wrapper: program compilation, FBO/VAO management,
 * uniform helpers, and the three render passes (trace -> atrous -> display).
 */

"use strict";

// Tuning constants - edit here to adjust quality vs. performance
const ATROUS_PASSES = 4;  // denoiser iterations (try 3)

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl     = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
        if (!this.gl) throw new Error('WebGL 2 is not available.\nTry Chrome or Firefox on a desktop GPU.');
        if (!this.gl.getExtension('EXT_color_buffer_float'))
            throw new Error('EXT_color_buffer_float not supported.\nTry Chrome 90+ or Firefox 86+ on desktop.');

        this.W = canvas.width;
        this.H = canvas.height;

        this._progs     = null;
        this._quadVAO   = null;
        this._accumFBOs = null;
        this._atrousFBOs = null;
        this._normalFBO = null;
        this._locCache  = new WeakMap();

        this.frame      = 0;
        this.needReset  = false;
        this.exposure   = 1.2;
        this.denoiseStr = 0.8;

        // Path tracer controls
        this.maxBounces  = 6;
        this.shadowsOn   = 1;     // 1 = on, 0 = off

        // World atmosphere controls
        this.volDensity  = 0.055; // base scattering density
        this.volHeight   = 0.12;  // exponential falloff rate
        this.volScatter  = 5.5;   // scatter multiplier
    }

    // -------------------------------------------------------------------------
    // Init - call once after shaders are loaded
    // -------------------------------------------------------------------------
    init(shaders) {
        this._locCache = new WeakMap(); // clear stale locations on re-init
        const gl = this.gl;
        this._progs = {
            trace:   this._makeProgram(shaders.VS, shaders.FS_TRACE),
            normal:  this._makeProgram(shaders.VS, shaders.FS_NORMAL),
            atrous:  this._makeProgram(shaders.VS, shaders.FS_ATROUS),
            display: this._makeProgram(shaders.VS, shaders.FS_DISPLAY),
        };
        this._createQuadVAO();
        this._createFBOs();
    }

    resize(W, H) {
        this.W = W;
        this.H = H;
        this.scheduleReset();
    }

    scheduleReset() { this.needReset = true; }

    // -------------------------------------------------------------------------
    // Per-frame render - call from requestAnimationFrame
    // -------------------------------------------------------------------------
    render(camera, scene, sun, moon) {
        const gl = this.gl;

        if (this.needReset) {
            this._createFBOs();
            this._renderNormals(camera, scene);
            this.frame    = 0;
            this.needReset = false;
        }

        const cam = camera.getMatrices();
        const { W, H } = this;

        // Stop rendering after 500 samples per pixel
        if (this.frame >= 500) {
            return;
        }

        // --- Pass 1: path trace ---------------------------------------------
        const src = this.frame % 2, dst = 1 - src;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._accumFBOs[dst].fbo);
        gl.viewport(0, 0, W, H);
        gl.useProgram(this._progs.trace);
        gl.bindVertexArray(this._quadVAO);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._accumFBOs[src].tex);

        this._u1i(this._progs.trace, 'u_prev',         0);
        this._u1i(this._progs.trace, 'u_frame',        this.frame);
        this._u1f(this._progs.trace, 'u_time',         performance.now() / 1000.0);
        this._u3fv(this._progs.trace, 'u_sunDir',      sun.direction);
        this._u3fv(this._progs.trace, 'u_sunColor',    sun.color);
        this._u1f(this._progs.trace, 'u_sunSize',      sun.size);
        this._u1f(this._progs.trace, 'u_sunIntensity', sun.intensity);
        this._u3fv(this._progs.trace, 'u_moonDir',     moon.direction);
        this._u1f(this._progs.trace,  'u_moonPhase',   moon.phase);
        this._u1f(this._progs.trace,  'u_moonBright',  moon.brightness);
        this._u1f(this._progs.trace,  'u_moonUp',      moon.up);
        this._u1f(this._progs.trace,  'u_moonSize',    moon.manualSize);
        this._u1i(this._progs.trace, 'u_maxBounces',   this.maxBounces);
        this._u1i(this._progs.trace, 'u_shadowsOn',    this.shadowsOn);
        this._u1f(this._progs.trace, 'u_volDensity',   this.volDensity);
        this._u1f(this._progs.trace, 'u_volHeight',    this.volHeight);
        this._u1f(this._progs.trace, 'u_volScatter',   this.volScatter);
        this._u3fv(this._progs.trace, 'u_volMin',      scene.volMin);
        this._u3fv(this._progs.trace, 'u_volMax',      scene.volMax);
        this._setCamUniforms(this._progs.trace, cam, camera.fov);
        this._setSceneUniforms(this._progs.trace, scene);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // --- Pass 2: A-Trous denoiser (4 iterations) ------------------------
        let curTex = this._accumFBOs[dst].tex;
        for (let step = 0; step < ATROUS_PASSES; step++) {
            const adst = step % 2;
            gl.bindFramebuffer(gl.FRAMEBUFFER, this._atrousFBOs[adst].fbo);
            gl.viewport(0, 0, W, H);
            gl.useProgram(this._progs.atrous);
            gl.bindVertexArray(this._quadVAO);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, curTex);
            gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._normalFBO.tex);
            this._u1i(this._progs.atrous, 'u_color',    0);
            this._u1i(this._progs.atrous, 'u_normal',   1);
            this._u1i(this._progs.atrous, 'u_step',     step);
            this._u1f(this._progs.atrous, 'u_strength', this.denoiseStr);
            this._u2fv(this._progs.atrous, 'u_res',     [W, H]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            curTex = this._atrousFBOs[adst].tex;
        }

        // --- Pass 3: tone-map + display -------------------------------------
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, W, H);
        gl.useProgram(this._progs.display);
        gl.bindVertexArray(this._quadVAO);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, curTex);
        this._u1i(this._progs.display, 'u_tex',      0);
        this._u1f(this._progs.display, 'u_exposure', this.exposure);
        this._u1f(this._progs.display, 'u_sunElevation', sun.elevation);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);

        this.frame++;
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------
    _renderNormals(camera, scene) {
        const gl  = this.gl;
        const cam = camera.getMatrices();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._normalFBO.fbo);
        gl.viewport(0, 0, this.W, this.H);
        gl.useProgram(this._progs.normal);
        gl.bindVertexArray(this._quadVAO);
        this._u1f(this._progs.normal, 'u_time', performance.now() / 1000.0);
        this._setCamUniforms(this._progs.normal, cam, camera.fov);
        this._setSceneUniforms(this._progs.normal, scene);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
    }

    _setCamUniforms(p, cam, fov) {
        this._u3fv(p, 'u_camPos',   cam.pos);
        this._u3fv(p, 'u_camFwd',   cam.fwd);
        this._u3fv(p, 'u_camRight', cam.right);
        this._u3fv(p, 'u_camUp',    cam.up);
        this._u1f(p,  'u_fov',      fov);
        this._u1f(p,  'u_aspect',   this.W / this.H);
        this._u2fv(p, 'u_res',      [this.W, this.H]);
    }

    _setSceneUniforms(p, scene) {
        this._u3fv(p, 'u_pos',    scene.posArr);
        this._u3fv(p, 'u_half',   scene.halfArr);
        this._u1iv(p, 'u_mat',    scene.matArr);
        this._u1fv(p, 'u_active', scene.activeArr);
    }

    _createQuadVAO() {
        const gl = this.gl;
        if (this._quadVAO) gl.deleteVertexArray(this._quadVAO);
        this._quadVAO = gl.createVertexArray();
        gl.bindVertexArray(this._quadVAO);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
        Object.values(this._progs).forEach(p => {
            const loc = gl.getAttribLocation(p, 'a_pos');
            if (loc >= 0) {
                gl.enableVertexAttribArray(loc);
                gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
            }
        });
        gl.bindVertexArray(null);
    }

    _createFBOs() {
        this._accumFBOs  && this._accumFBOs.forEach(f => this._deleteFBO(f));
        this._atrousFBOs && this._atrousFBOs.forEach(f => this._deleteFBO(f));
        this._normalFBO  && this._deleteFBO(this._normalFBO);
        this._accumFBOs  = [this._makeFBO(), this._makeFBO()];
        this._atrousFBOs = [this._makeFBO(), this._makeFBO()];
        this._normalFBO  = this._makeFBO();
    }

    _makeFBO() {
        const gl  = this.gl;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, this.W, this.H, 0, gl.RGBA, gl.HALF_FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { fbo, tex };
    }

    _deleteFBO(f) {
        this.gl.deleteFramebuffer(f.fbo);
        this.gl.deleteTexture(f.tex);
    }

    _makeProgram(vsSrc, fsSrc) {
        const gl = this.gl;
        const p  = gl.createProgram();
        gl.attachShader(p, this._compileShader(gl.VERTEX_SHADER,   vsSrc));
        gl.attachShader(p, this._compileShader(gl.FRAGMENT_SHADER, fsSrc));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
        return p;
    }

    _compileShader(type, src) {
        const gl = this.gl;
        const s  = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
    }

    // Uniform helpers with location cache
    _loc(p, n) {
        if (!this._locCache.has(p)) this._locCache.set(p, {});
        const c = this._locCache.get(p);
        if (c[n] === undefined) c[n] = this.gl.getUniformLocation(p, n);
        return c[n];
    }
    _u1i(p,n,v)  { const l=this._loc(p,n); if(l!==null) this.gl.uniform1i(l,v); }
    _u1f(p,n,v)  { const l=this._loc(p,n); if(l!==null) this.gl.uniform1f(l,v); }
    _u2fv(p,n,v) { const l=this._loc(p,n); if(l!==null) this.gl.uniform2fv(l,v); }
    _u3fv(p,n,v) { const l=this._loc(p,n); if(l!==null) this.gl.uniform3fv(l,v); }
    _u1fv(p,n,v) { const l=this._loc(p,n); if(l!==null) this.gl.uniform1fv(l,v); }
    _u1iv(p,n,v) { const l=this._loc(p,n); if(l!==null) this.gl.uniform1iv(l,v); }
}
