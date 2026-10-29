// ============================================================
// initShaders.js — Angel & Shreiner 教材配套着色器编译工具
// 用法：program = initShaders(gl, "vertex-shader", "fragment-shader")
//   其中两个 id 对应 <script type="x-shader/x-vertex"> 元素
// WebGL 2.0 / GLSL ES 3.00 版本
// ============================================================
function initShaders(gl, vShaderId, fShaderId) {
    var vertexShader = getShader(gl, vShaderId, gl.VERTEX_SHADER);
    var fragmentShader = getShader(gl, fShaderId, gl.FRAGMENT_SHADER);

    var program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        var llog = gl.getProgramInfoLog(program);
        console.error("Link error:\n" + llog);
        var d = document.createElement('div');
        d.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#c00;color:#fff;padding:10px;z-index:9999;font:13px monospace;white-space:pre-wrap;';
        d.textContent = 'LINK ERROR:\n' + llog;
        document.body.appendChild(d);
    }
    gl.useProgram(program);
    return program;
}

function getShader(gl, id, type) {
    var shaderScript = document.getElementById(id);
    if (!shaderScript) {
        console.error("Could not find shader element: " + id);
        return null;
    }

    // 取 <script> 标签内的源码文本
    var src = "";
    var child = shaderScript.firstChild;
    while (child) {
        if (child.nodeType === 3) src += child.textContent;
        child = child.nextSibling;
    }

    var shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        var log = gl.getShaderInfoLog(shader);
        console.error("Shader compile error (" + id + "):\n" + log);
        // 也显示在页面上
        var d = document.createElement('div');
        d.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#c00;color:#fff;padding:10px;z-index:9999;font:13px monospace;white-space:pre-wrap;';
        d.textContent = 'SHADER ERROR [' + id + ']:\n' + log + '\n--- source head ---\n' + src.substring(0,200);
        document.body.appendChild(d);
    }
    return shader;
}
