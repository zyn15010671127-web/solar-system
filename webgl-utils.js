// ============================================================
// webgl-utils.js — Angel 教材配套 WebGL 初始化工具
// WebGL 2.0 版本：setupWebGL(canvas) 返回 webgl2 上下文
// ============================================================
var WebGLUtils = (function () {

    function setupWebGL(canvas, attribs) {
        attribs = attribs || { antialias: true };
        var gl = canvas.getContext('webgl2', attribs);
        if (!gl) {
            console.error("WebGL 2.0 is not supported by this browser.");
            alert("WebGL 2.0 not supported. Please use Chrome/Edge/Firefox latest.");
        }
        resize(gl);
        window.addEventListener('resize', function () { resize(gl); });
        return gl;
    }

    function resize(gl) {
        var canvas = gl.canvas;
        var dpr = window.devicePixelRatio || 1;
        var w = canvas.clientWidth * dpr;
        var h = canvas.clientHeight * dpr;
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
        gl.viewport(0, 0, canvas.width, canvas.height);
    }

    return { setupWebGL: setupWebGL, resize: resize };
})();
