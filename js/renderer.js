/**
 * renderer.js
 * WebGL2 context wrapper: program compilation, FBO/VAO management,
 * uniform helpers, and the three render passes (trace -> atrous -> display).
 */

"use strict";

import { posArr, halfArr, matArr, activeArr, volMin, volMax } from './scene.js';
import { buildCamera, CAM_FOV } from './camera.js';
import { sunDir, sunColor, getSunPositionFromTime } from './sun.js';

// ---------------------------------------------------------------------------
// State (module-private, exposed via getters where callers need them)
// ---------------------------------------------------------------------------
let gl, W, H;
let progs    = null;
let quadVAO  = null;
let accumFBOs = null, atrousFBOs = null, normalFBO = null;

let frame       = 0;
let needReset   = false;
let contextLost = false;

// Render parameters — mutated by ui.js via the setters below
let sunAz        = 160;
let sunEl        = 8;
let exposure     = 1.2;
let denoiseStr   = 0.8;
let sunSize      = 1.0;
let sunIntensity = 1.0;
let useRealTime  = false;

// FPS bookkeeping
let fpsT = performance.now(), fpsN = 0;

// Uniform location cache
let _locCache = new WeakMap();

// ---------------------------------------------------------------------------
// Public setters (called by ui.js)
// ---------------------------------------------------------------------------
export function setSunAz(v)        { sunAz        = v; }
export function setSunEl(v)        { sunEl        = v; }
export function setExposure(v)     { exposure     = v; }
export function setDenoiseStr(v)   { denoiseStr   = v; }
export function setSunSize(v)      { sunSize      = v; }
export function setSunIntensity(v) { sunIntensity = v; }
export function setUseRealTime(v)  { useRealTime  = v; }
export function getSunAz()         { return sunAz; }
export function getSunEl()         { return sunEl; }
export function scheduleReset()    { needReset = true; }
export function getFrame()         { return frame; }
export function getCanvas()        { return gl && gl.canvas; }

// ---------------------------------------------------------------------------
// Uniform helpers
// ---------------------------------------------------------------------------
function L(p, n) {
    if (!_locCache.has(p)) _locCache.set(p, {});
    const cache = _locCache.get(p);
    if (cache[n] === undefined) cache[n] = gl.getUniformLocation(p, n);
    return cache[n];
}
function u1i(p, n, v)  { const l = L(p, n); if (l !== null) gl.uniform1i(l, v); }
function u1f(p, n, v)  { const l = L(p, n); if (l !== null) gl.uniform1f(l, v); }
function u2fv(p, n, v) { const l = L(p, n); if (l !== null) gl.uniform2fv(l, v); }
function u3fv(p, n, v) { const l = L(p, n); if (l !== null) gl.uniform3fv(l, v); }
function u1fv(p, n, v) { const l = L(p, n); if (l !== null) gl.uniform1fv(l, v); }
function u1iv(p, n, v) { const l = L(p, n); if (l !== null) gl.uniform1iv(l, v); }

// ---------------------------------------------------------------------------
// Scene + camera uniforms
// ---------------------------------------------------------------------------
function setSceneUniforms(p) {
    gl.useProgram(p);
    u3fv(p, 'u_pos',    posArr);
    u3fv(p, 'u_half',   halfArr);
    u1iv(p, 'u_mat',    matArr);
    u1fv(p, 'u_active', activeArr);
}

function setCamUniforms(p, cam) {
    gl.useProgram(p);
    u3fv(p, 'u_camPos',   cam.pos);
    u3fv(p, 'u_camFwd',   cam.fwd);
    u3fv(p, 'u_camRight', cam.right);
    u3fv(p, 'u_camUp',    cam.up);
    u1f(p,  'u_fov',      CAM_FOV);
    u1f(p,  'u_aspect',   W / H);
    u2fv(p, 'u_res',      [W, H]);
}

// ---------------------------------------------------------------------------
// Shader compilation
// ---------------------------------------------------------------------------
function compileShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s));
    return s;
}

function makeProgram(vsSrc, fsSrc) {
    const p = gl.createProgram();
    gl.attachShader(p, compileShader(gl.VERTEX_SHADER,   vsSrc));
    gl.attachShader(p, compileShader(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(p));
    return p;
}

// ---------------------------------------------------------------------------
// FBO helpers
// ---------------------------------------------------------------------------
function makeFBO(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE)
        console.error('FBO incomplete:', status);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex };
}

function deleteFBO(f) {
    if (!f) return;
    gl.deleteFramebuffer(f.fbo);
    gl.deleteTexture(f.tex);
}

function createFBOs() {
    accumFBOs && accumFBOs.forEach(deleteFBO);
    atrousFBOs && atrousFBOs.forEach(deleteFBO);
    deleteFBO(normalFBO);

    accumFBOs  = [makeFBO(W, H), makeFBO(W, H)];
    atrousFBOs = [makeFBO(W, H), makeFBO(W, H)];
    normalFBO  = makeFBO(W, H);
}

// ---------------------------------------------------------------------------
// Quad VAO
// ---------------------------------------------------------------------------
function createQuadVAO() {
    if (quadVAO) gl.deleteVertexArray(quadVAO);
    quadVAO = gl.createVertexArray();
    gl.bindVertexArray(quadVAO);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

    Object.values(progs).forEach(p => {
        const loc = gl.getAttribLocation(p, 'a_pos');
        if (loc >= 0) {
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        }
    });

    gl.bindVertexArray(null);
}

// ---------------------------------------------------------------------------
// Normals pass
// ---------------------------------------------------------------------------
function renderNormals(cam) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, normalFBO.fbo);
    gl.viewport(0, 0, W, H);
    gl.useProgram(progs.normal);
    gl.bindVertexArray(quadVAO);
    setCamUniforms(progs.normal, cam);
    setSceneUniforms(progs.normal);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
}

// ---------------------------------------------------------------------------
// WebGL init (call after shaders are loaded)
// ---------------------------------------------------------------------------
export function initWebGL(glCtx, width, height, shaders) {
    gl = glCtx;
    W  = width;
    H  = height;

    progs = {
        trace:   makeProgram(shaders.VS, shaders.FS_TRACE),
        normal:  makeProgram(shaders.VS, shaders.FS_NORMAL),
        atrous:  makeProgram(shaders.VS, shaders.FS_ATROUS),
        display: makeProgram(shaders.VS, shaders.FS_DISPLAY),
    };

    createQuadVAO();
    createFBOs();
    _locCache = new WeakMap();
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------
export function resize(width, height) {
    W = width;
    H = height;
    scheduleReset();
}

// ---------------------------------------------------------------------------
// Main render loop (call via requestAnimationFrame)
// ---------------------------------------------------------------------------
export function renderFrame(onFpsUpdate, onSunUpdate) {
    if (contextLost) return;

    const cam = buildCamera();

    if (needReset) {
        createFBOs();
        renderNormals(cam);
        frame    = 0;
        needReset = false;
    }

    // Real-time sun sync
    if (useRealTime) {
        const sunPos = getSunPositionFromTime();
        sunAz = sunPos.azimuth;
        sunEl = Math.max(0, sunPos.elevation);
        onSunUpdate && onSunUpdate(sunAz, sunEl);
    }

    const sd = sunDir(sunAz, sunEl);
    const sc = sunColor(sunEl);

    // --- Pass 1: path trace -------------------------------------------------
    const src = frame % 2, dst = 1 - src;
    gl.bindFramebuffer(gl.FRAMEBUFFER, accumFBOs[dst].fbo);
    gl.viewport(0, 0, W, H);
    gl.useProgram(progs.trace);
    gl.bindVertexArray(quadVAO);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, accumFBOs[src].tex);
    u1i(progs.trace, 'u_prev',         0);
    u1i(progs.trace, 'u_frame',        frame);
    u3fv(progs.trace, 'u_sunDir',      sd);
    u3fv(progs.trace, 'u_sunColor',    sc);
    u1f(progs.trace, 'u_sunSize',      sunSize);
    u1f(progs.trace, 'u_sunIntensity', sunIntensity);
    u3fv(progs.trace, 'u_volMin',      volMin);
    u3fv(progs.trace, 'u_volMax',      volMax);
    setCamUniforms(progs.trace, cam);
    setSceneUniforms(progs.trace);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // --- Pass 2: A-Trous denoiser (4 iterations) ----------------------------
    let curTex = accumFBOs[dst].tex;
    for (let step = 0; step < 4; step++) {
        const adst = step % 2;
        gl.bindFramebuffer(gl.FRAMEBUFFER, atrousFBOs[adst].fbo);
        gl.viewport(0, 0, W, H);
        gl.useProgram(progs.atrous);
        gl.bindVertexArray(quadVAO);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, curTex);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, normalFBO.tex);
        u1i(progs.atrous, 'u_color',    0);
        u1i(progs.atrous, 'u_normal',   1);
        u1i(progs.atrous, 'u_step',     step);
        u1f(progs.atrous, 'u_strength', denoiseStr);
        u2fv(progs.atrous, 'u_res',     [W, H]);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        curTex = atrousFBOs[adst].tex;
    }

    // --- Pass 3: tone-map + display -----------------------------------------
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(progs.display);
    gl.bindVertexArray(quadVAO);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, curTex);
    u1i(progs.display, 'u_tex',      0);
    u1f(progs.display, 'u_exposure', exposure);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);

    // FPS counter
    frame++;
    fpsN++;
    const now = performance.now();
    if (now - fpsT > 500) {
        onFpsUpdate && onFpsUpdate(fpsN / ((now - fpsT) / 1000), frame);
        fpsN = 0;
        fpsT = now;
    }
}

// ---------------------------------------------------------------------------
// Context loss handling
// ---------------------------------------------------------------------------
export function onContextLost()     { contextLost = true; }
export function onContextRestored() { contextLost = false; }
