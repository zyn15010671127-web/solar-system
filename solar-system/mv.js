// ============================================================
// mv.js — 精简版 Angel 教材矩阵/向量库（兼容常用 API）
// 约定：mat4 按列主序存储（WebGL 风格），mult(A,B) = A*B
// ============================================================

function _(x) { return x; }

// ---------- 向量 ----------
function vec3(x, y, z) {
    if (x === undefined) return [0.0, 0.0, 0.0];
    if (Array.isArray(x)) return [x[0] || 0, x[1] || 0, x[2] || 0];
    return [x, y === undefined ? x : y, z === undefined ? x : z];
}
function vec4(x, y, z, w) {
    if (x === undefined) return [0.0, 0.0, 0.0, 0.0];
    if (Array.isArray(x)) {
        if (x.length === 3) return [x[0], x[1], x[2], y === undefined ? 1 : y];
        return [x[0] || 0, x[1] || 0, x[2] || 0, x[3] === undefined ? 1 : x[3]];
    }
    return [x, y === undefined ? 0 : y, z === undefined ? 0 : z, w === undefined ? 1 : w];
}

function dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function cross(a, b) {
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
}
function length(a) { return Math.sqrt(dot(a,a)); }
function normalize(a) {
    var l = length(a) || 1;
    return [a[0]/l, a[1]/l, a[2]/l];
}

// ---------- 矩阵 ----------
// 默认 4x4 单位矩阵（列主序：m[0..3] 是第一列）
function mat4() {
    var m = new Array(16);
    for (var i = 0; i < 16; i++) m[i] = (i % 5 === 0) ? 1 : 0;
    return m;
}
function mat3() {
    var m = new Array(9);
    for (var i = 0; i < 9; i++) m[i] = (i % 4 === 0) ? 1 : 0;
    return m;
}
function identity() { return mat4(); }

// C = A * B（A、B 列主序）
function mult(a, b) {
    if (a.length === 16 && b.length === 16) {
        var c = new Array(16);
        for (var i = 0; i < 4; i++) {
            for (var j = 0; j < 4; j++) {
                c[i + 4*j] =
                    a[i + 4*0]*b[0 + 4*j] +
                    a[i + 4*1]*b[1 + 4*j] +
                    a[i + 4*2]*b[2 + 4*j] +
                    a[i + 4*3]*b[3 + 4*j];
            }
        }
        return c;
    }
    // mat * vec4
    if (a.length === 16 && b.length === 4) {
        var v = [0,0,0,0];
        for (var i = 0; i < 4; i++) {
            v[i] = a[i+4*0]*b[0] + a[i+4*1]*b[1] + a[i+4*2]*b[2] + a[i+4*3]*b[3];
        }
        return v;
    }
}

// 平移矩阵 T(x,y,z)
function translate(x, y, z) {
    if (Array.isArray(x)) { z = x[2]; y = x[1]; x = x[0]; }
    var m = mat4();
    m[12] = x; m[13] = y; m[14] = z;
    return m;
}

// 缩放矩阵 S(sx,sy,sz)
function scale(x, y, z) {
    if (Array.isArray(x)) { z = x[2]; y = x[1]; x = x[0]; }
    if (y === undefined) y = x;
    if (z === undefined) z = x;
    var m = mat4();
    m[0] = x; m[5] = y; m[10] = z;
    return m;
}

// 绕轴旋转 angle（角度制），axis = [ax,ay,az]
function rotate(angle, axis) {
    var r = angle * Math.PI / 180.0;
    var c = Math.cos(r), s = Math.sin(r);
    var n = normalize(axis);
    var x = n[0], y = n[1], z = n[2];
    var m = mat4();
    m[0]  = x*x*(1-c)+c;   m[1]  = y*x*(1-c)+z*s; m[2]  = z*x*(1-c)-y*s; m[3]=0;
    m[4]  = x*y*(1-c)-z*s; m[5]  = y*y*(1-c)+c;   m[6]  = y*z*(1-c)+x*s; m[7]=0;
    m[8]  = x*z*(1-c)+y*s; m[9]  = y*z*(1-c)-x*s; m[10] = z*z*(1-c)+c;  m[11]=0;
    return m;
}

// 透视投影
function perspective(fovy, aspect, near, far) {
    var t = 1.0 / Math.tan(fovy * Math.PI / 360.0);
    var m = mat4();
    m[0] = t / aspect;
    m[5] = t;
    m[10] = (far + near) / (near - far);
    m[11] = -1.0;
    m[14] = (2.0 * far * near) / (near - far);
    m[15] = 0.0;
    return m;
}

// 正交投影
function ortho(left, right, bottom, top, near, far) {
    var m = mat4();
    m[0] = 2/(right-left);
    m[5] = 2/(top-bottom);
    m[10] = -2/(far-near);
    m[12] = -(right+left)/(right-left);
    m[13] = -(top+bottom)/(top-bottom);
    m[14] = -(far+near)/(far-near);
    return m;
}

// 观察矩阵
function lookAt(eye, at, up) {
    eye = vec3(eye); at = vec3(at); up = vec3(up);
    var z = normalize([eye[0]-at[0], eye[1]-at[1], eye[2]-at[2]]);
    var x = normalize(cross(up, z));
    var y = cross(z, x);
    var m = mat4();
    m[0]=x[0]; m[4]=y[0]; m[8]=z[0];
    m[1]=x[1]; m[5]=y[1]; m[9]=z[1];
    m[2]=x[2]; m[6]=y[2]; m[10]=z[2];
    m[12] = -dot(x, eye);
    m[13] = -dot(y, eye);
    m[14] = -dot(z, eye);
    return m;
}

function transpose(a) {
    var m = mat4();
    for (var i = 0; i < 4; i++)
        for (var j = 0; j < 4; j++)
            m[i+4*j] = a[j+4*i];
    return m;
}

// ---------- 四元数（用于虚拟轨迹球） ----------
// q = [x, y, z, w]
function quat() { return [0, 0, 0, 1]; }
function quatIdentity() { return [0, 0, 0, 1]; }
function quatFromAxisAngle(axis, angleDeg) {
    var n = normalize(axis);
    var r = angleDeg * Math.PI / 180.0 * 0.5;
    var s = Math.sin(r);
    return [n[0]*s, n[1]*s, n[2]*s, Math.cos(r)];
}
function quatMultiply(a, b) {
    var ax=a[0],ay=a[1],az=a[2],aw=a[3];
    var bx=b[0],by=b[1],bz=b[2],bw=b[3];
    return [
        aw*bx + ax*bw + ay*bz - az*by,
        aw*by - ax*bz + ay*bw + az*bx,
        aw*bz + ax*by - ay*bx + az*bw,
        aw*bw - ax*bx - ay*by - az*bz
    ];
}
function quatNormalize(q) {
    var l = Math.sqrt(q[0]*q[0]+q[1]*q[1]+q[2]*q[2]+q[3]*q[3]) || 1;
    return [q[0]/l, q[1]/l, q[2]/l, q[3]/l];
}
function quatRotateVec(q, v) {
    // v' = q * [v,0] * q^-1
    var u = [q[0], q[1], q[2]];
    var s = q[3];
    // 2*dot(u,v)*u + (s² - dot(u,u))*v + 2*s*cross(u,v)
    var dotuv = u[0]*v[0]+u[1]*v[1]+u[2]*v[2];
    var dotuu = q[0]*q[0]+q[1]*q[1]+q[2]*q[2];
    var c = cross(u, v);
    return [
        2*dotuv*u[0] + (s*s-dotuu)*v[0] + 2*s*c[0],
        2*dotuv*u[1] + (s*s-dotuu)*v[1] + 2*s*c[1],
        2*dotuv*u[2] + (s*s-dotuu)*v[2] + 2*s*c[2]
    ];
}
function quatToMat4(q) {
    var x=q[0], y=q[1], z=q[2], w=q[3];
    var m = mat4();
    m[0] = 1-2*(y*y+z*z); m[4] = 2*(x*y-z*w);     m[8]  = 2*(x*z+y*w);
    m[1] = 2*(x*y+z*w);   m[5] = 1-2*(x*x+z*z); m[9]  = 2*(y*z-x*w);
    m[2] = 2*(x*z-y*w);    m[6] = 2*(y*z+x*w);   m[10]= 1-2*(x*x+y*y);
    return m;
}

// 导出（浏览器全局）
if (typeof window !== 'undefined') {
    window.vec3 = vec3; window.vec4 = vec4;
    window.mat4 = mat4; window.mat3 = mat3;
    window.identity = identity;
    window.mult = mult;
    window.translate = translate;
    window.scale = scale;
    window.rotate = rotate;
    window.perspective = perspective;
    window.ortho = ortho;
    window.lookAt = lookAt;
    window.dot = dot; window.cross = cross;
    window.normalize = normalize; window.length = length;
    window.transpose = transpose;
    window.quat = quat; window.quatIdentity = quatIdentity;
    window.quatFromAxisAngle = quatFromAxisAngle;
    window.quatMultiply = quatMultiply;
    window.quatNormalize = quatNormalize;
    window.quatRotateVec = quatRotateVec;
    window.quatToMat4 = quatToMat4;
}
