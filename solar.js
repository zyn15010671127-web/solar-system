// ============================================================
// solar.js — AP2 太阳系 v2 (WebGL 2.0)
// 修复黑屏：着色器源码内联 JS 字符串，错误直接显示
// 新功能：太阳粒子特效 + 更精细 Canvas 纹理
// ============================================================

var gl, canvas, program, particleProgram;
var textures = {};
var sphereBuf = {}, ringBuf = {}, asteroidBuf = null, particleBuf = null;
var saturnRingBuf = null, saturnRingCount = 0;
var starBuf = null, starCount = 0;
var orbitBufs = {};

var PLANETS = [
    { name:'水星', orbit:5.0,  size:0.18, spin:0.5, orbitSpd:4.15, tilt:0.0,  color:[0.55,0.55,0.55], ring:false },
    { name:'金星', orbit:6.5,  size:0.35, spin:-0.2, orbitSpd:1.62, tilt:177.0,color:[0.92,0.82,0.55], ring:false },
    { name:'地球', orbit:9.0,  size:0.40, spin:1.0, orbitSpd:1.0,  tilt:23.5, color:null, ring:false, hasMoon:true },
    { name:'火星', orbit:11.5, size:0.28, spin:0.9, orbitSpd:0.53, tilt:25.0, color:[0.80,0.42,0.28], ring:false },
    { name:'木星', orbit:16.0, size:1.20, spin:2.0, orbitSpd:0.084,tilt:3.0,  color:[0.82,0.62,0.42], ring:false },
    { name:'土星', orbit:21.0, size:1.20, spin:1.8, orbitSpd:0.034,tilt:27.0, color:[0.90,0.80,0.60], ring:true },
    { name:'天王星',orbit:26.0,size:0.70, spin:1.2, orbitSpd:0.012,tilt:98.0, color:[0.55,0.80,0.90], ring:false }
];

var state = {
    orbitSpeed:1, spinSpeed:1, axialTilt:23.5,
    showOrbits:true, showAsteroids:true, showParticles:true,
    usePerspective:true, roaming:true, camMode:0, camDistance:35,
    // 初始轨迹球：相机倾斜 30° 俯视黄道面
    trackballQuat: quatFromAxisAngle([1,0,0], -25),
    sunAngle:0,
    planetAngles: PLANETS.map((_,i)=>i*0.8),
    planetSpins: PLANETS.map(()=>0),
    moonOrbit:0, moonSpin:0, startTime: performance.now()/1000
};

// ============================================================
// 着色器源码（内联字符串，避免 DOM <script> 标签解析问题）
// ============================================================
var VERT_SRC = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;
in vec3 aTangent;
in vec2 aUV;
uniform mat4 uModel;
uniform mat4 uViewProj;
uniform mat3 uNormalMat;
uniform float uPointSize;
uniform float uOrbitSpinTime;  // >0 时按半径差异化旋转
out vec2 vUV;
out vec3 vNormal;
out vec3 vTangent;
out vec3 vWorldPos;
void main() {
    vec3 pos = aPosition;
    if (uOrbitSpinTime > 0.0) {
        float r = length(pos.xz);
        if (r > 0.01) {
            float ang = uOrbitSpinTime * 5.0 / (r*r); // 内圈快很多
            float c = cos(ang), s = sin(ang);
            pos.xz = mat2(c,-s,s,c) * pos.xz;
        }
    }
    vUV = aUV;
    vec4 wp = uModel * vec4(pos, 1.0);
    vWorldPos = wp.xyz;
    vNormal = normalize(uNormalMat * aNormal);
    vTangent = normalize(uNormalMat * aTangent);
    gl_Position = uViewProj * wp;
    gl_PointSize = uPointSize;
}`;

var FRAG_SRC = `#version 300 es
precision mediump float;
in vec2 vUV;
in vec3 vNormal;
in vec3 vTangent;
in vec3 vWorldPos;
uniform sampler2D uTex;
uniform sampler2D uNormalMap;
uniform vec3 uLightDir;
uniform float uIsEmissive;
uniform vec4 uFlatColor;
uniform float uUseFlatColor;
uniform float uUseNormalMap;
uniform float uCloudLayer;
uniform float uPointSize;
uniform float uTime;
out vec4 fragColor;
void main() {
    if (uUseFlatColor > 0.5) { fragColor = uFlatColor; return; }
    vec2 uv = vUV;
    if (uIsEmissive > 0.5) {
        uv.x += uTime * 0.02; // 太阳表面流动
    }
    vec3 tc = texture(uTex, uv).rgb;
    float ta = texture(uTex, uv).a;
    if (uCloudLayer > 0.5) {
        fragColor = vec4(tc, ta);
        return;
    }
    if (uIsEmissive > 0.5) { fragColor = vec4(tc, 1.0); return; }
    vec3 N = normalize(vNormal);
    if (uUseNormalMap > 0.5) {
        vec3 nMap = texture(uNormalMap, vUV).rgb * 2.0 - 1.0;
        vec3 T = normalize(vTangent - N * dot(N, vTangent));
        vec3 B = cross(N, T);
        N = normalize(T * nMap.x + B * nMap.y + N * nMap.z);
    }
    float d = max(dot(N, normalize(uLightDir)), 0.0);
    fragColor = vec4(tc * (0.35 + 0.65*d), 1.0);
}`;

var PVERT_SRC = `#version 300 es
in vec3 aStart;
in vec3 aVel;
in float aLife;
uniform float uTime;
uniform mat4 uViewProj;
out float vT;
void main() {
    float t = mod(uTime, aLife) / aLife;
    vT = t;
    vec3 pos = aStart + aVel * t;
    vec4 clip = uViewProj * vec4(pos, 1.0);
    gl_Position = clip;
    gl_PointSize = 6.0 * (1.0 - t) * 20.0 / clip.w;
}`;

var PFRAG_SRC = `#version 300 es
precision mediump float;
in float vT;
out vec4 fragColor;
void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d) * (1.0 - vT);
    fragColor = vec4(1.0, 0.5 + 0.3*(1.0-vT), 0.15, a);
}`;

// ============================================================
// 着色器编译
// ============================================================
function compileShader(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        var log = gl.getShaderInfoLog(s);
        showErr('SHADER COMPILE ERROR:\n' + log + '\n--- src head ---\n' + src.substring(0,300));
    }
    return s;
}
function makeProgram(vsSrc, fsSrc) {
    var p = gl.createProgram();
    gl.attachShader(p, compileShader(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compileShader(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        showErr('LINK ERROR:\n' + gl.getProgramInfoLog(p));
    }
    return p;
}
function showErr(msg) {
    console.error(msg);
    var d = document.createElement('div');
    d.className = 'err';
    d.textContent = msg;
    document.body.appendChild(d);
}

// ============================================================
// 网格
// ============================================================
function createSphere(latBands, lonBands, r) {
    var pos=[],nor=[],tan=[],uv=[],idx=[];
    for (var lat=0;lat<=latBands;lat++) {
        var th=lat*Math.PI/latBands, st=Math.sin(th), ct=Math.cos(th);
        for (var lon=0;lon<=lonBands;lon++) {
            var ph=lon*2*Math.PI/lonBands, sp=Math.sin(ph), cp=Math.cos(ph);
            var x=cp*st, y=ct, z=sp*st;
            pos.push(r*x,r*y,r*z); nor.push(x,y,z);
            // 切线：经度方向 = (-sin(phi), 0, cos(phi))
            tan.push(-sp, 0, cp);
            uv.push(lon/lonBands,1-lat/latBands);
        }
    }
    for (var lat=0;lat<latBands;lat++) for (var lon=0;lon<lonBands;lon++) {
        var a=lat*(lonBands+1)+lon, b=a+lonBands+1;
        idx.push(a,b,a+1, b,b+1,a+1);
    }
    return {pos:new Float32Array(pos),nor:new Float32Array(nor),tan:new Float32Array(tan),uv:new Float32Array(uv),idx:new Uint16Array(idx)};
}
function createRing(rIn,rOut,seg) {
    var pos=[],nor=[],uv=[],idx=[];
    for (var i=0;i<=seg;i++) {
        var a=i*2*Math.PI/seg, c=Math.cos(a), s=Math.sin(a);
        pos.push(rIn*c,0,rIn*s, rOut*c,0,rOut*s);
        nor.push(0,1,0, 0,1,0); uv.push(0,i/seg, 1,i/seg);
    }
    for (var i=0;i<seg;i++) { var a=i*2; idx.push(a,a+1,a+2, a+1,a+3,a+2); }
    return {pos:new Float32Array(pos),nor:new Float32Array(nor),uv:new Float32Array(uv),idx:new Uint16Array(idx)};
}

// ============================================================
// 精细 Canvas 纹理
// ============================================================
function makeTex(drawFn, w, h) {
    var c = document.createElement('canvas');
    c.width = w || 512; c.height = h || 256;
    var ctx = c.getContext('2d');
    drawFn(ctx, c.width, c.height);
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    return tex;
}

function noise(ctx,w,h,n,colors,rMin,rMax) {
    for (var i=0;i<n;i++) {
        ctx.fillStyle = colors[Math.floor(Math.random()*colors.length)];
        ctx.beginPath();
        ctx.arc(Math.random()*w, Math.random()*h, rMin+Math.random()*(rMax-rMin), 0, 7);
        ctx.fill();
    }
}

function drawSun(ctx,w,h) {
    // 基底：从亮黄到橙红的渐变
    var g = ctx.createLinearGradient(0,0,0,h);
    g.addColorStop(0,'#ffcc33');
    g.addColorStop(0.3,'#ff9922');
    g.addColorStop(0.5,'#ff7711');
    g.addColorStop(0.7,'#ff9922');
    g.addColorStop(1,'#ffcc33');
    ctx.fillStyle = g; ctx.fillRect(0,0,w,h);

    // 米粒组织：大量细小亮暗颗粒
    for (var i=0;i<8000;i++) {
        var x=Math.random()*w, y=Math.random()*h;
        var r=0.5+Math.random()*1.5;
        if (Math.random()>0.5) {
            ctx.fillStyle='rgba(255,230,100,0.3)';
        } else {
            ctx.fillStyle='rgba(200,80,0,0.25)';
        }
        ctx.beginPath(); ctx.arc(x,y,r,0,7); ctx.fill();
    }

    // 流动条纹
    ctx.globalAlpha=0.15;
    for (var i=0;i<20;i++) {
        ctx.strokeStyle=Math.random()>0.5?'#ffff88':'#cc5500';
        ctx.lineWidth=2+Math.random()*4;
        ctx.beginPath();
        var y0=Math.random()*h;
        ctx.moveTo(0,y0);
        for (var x=0;x<=w;x+=20) {
            ctx.lineTo(x, y0+Math.sin(x*0.02+i)*8);
        }
        ctx.stroke();
    }
    ctx.globalAlpha=1.0;

    // 耀斑：亮斑带光晕
    for (var i=0;i<20;i++) {
        var x=Math.random()*w, y=Math.random()*h;
        var r=5+Math.random()*12;
        var rg=ctx.createRadialGradient(x,y,0,x,y,r);
        rg.addColorStop(0,'rgba(255,255,220,0.95)');
        rg.addColorStop(0.4,'rgba(255,200,80,0.6)');
        rg.addColorStop(1,'rgba(255,100,0,0)');
        ctx.fillStyle=rg; ctx.beginPath(); ctx.arc(x,y,r,0,7); ctx.fill();
    }

    // 日珥喷发
    for (var i=0;i<5;i++) {
        var x=Math.random()*w;
        var rg=ctx.createLinearGradient(x,0,x,h);
        rg.addColorStop(0,'rgba(255,100,50,0.4)');
        rg.addColorStop(1,'rgba(255,100,50,0)');
        ctx.fillStyle=rg;
        ctx.fillRect(x-3,0,6,h);
    }

    // 黑子（少量、淡一点）
    for (var i=0;i<4;i++) {
        var x=Math.random()*w, y=h*0.2+Math.random()*h*0.6;
        var r=2+Math.random()*4;
        ctx.fillStyle='rgba(120,50,0,0.35)';
        ctx.beginPath(); ctx.arc(x,y,r,0,7); ctx.fill();
    }
}

// 太阳光晕纹理
function drawGlow(ctx,w,h) {
    ctx.clearRect(0,0,w,h);
    var g = ctx.createRadialGradient(w/2,h/2,0,w/2,h/2,w/2);
    g.addColorStop(0, 'rgba(255,200,80,0.35)');
    g.addColorStop(0.2, 'rgba(255,150,40,0.15)');
    g.addColorStop(1, 'rgba(255,100,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0,0,w,h);
}

function drawClouds(ctx,w,h) {
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0,0,w,h);
    // 大尺度云系
    for (var i=0;i<80;i++) {
        var x=Math.random()*w, y=Math.random()*h;
        var rx=20+Math.random()*60, ry=5+Math.random()*15;
        var alpha=0.3+Math.random()*0.5;
        ctx.fillStyle='rgba(255,255,255,'+alpha+')';
        ctx.beginPath();
        ctx.ellipse(x,y,rx,ry,0,0,7);
        ctx.fill();
    }
    // 小云块
    for (var i=0;i<200;i++) {
        ctx.fillStyle='rgba(255,255,255,'+(0.1+Math.random()*0.3)+')';
        ctx.beginPath();
        ctx.ellipse(Math.random()*w, Math.random()*h, 5+Math.random()*15, 2+Math.random()*5, 0, 0, 7);
        ctx.fill();
    }
}

function drawEarth(ctx,w,h) {
    var g = ctx.createLinearGradient(0,0,0,h);
    g.addColorStop(0,'#0a2a5a'); g.addColorStop(0.5,'#1a5a9f'); g.addColorStop(1,'#0a2a5a');
    ctx.fillStyle = g; ctx.fillRect(0,0,w,h);

    // 经纬度 → Canvas 坐标
    function px(lon) { return (lon+180)/360*w; }
    function py(lat) { return (90-lat)/180*h; }

    // 真实大陆轮廓（经纬度多边形）
    var continents = [
        // 北美洲
        [[-168,66],[-140,70],[-95,72],[-80,70],[-60,60],[-55,47],[-75,35],[-80,25],[-97,26],[-105,20],[-115,30],[-125,40],[-130,55],[-160,60]],
        // 中美洲
        [[-105,20],[-97,16],[-90,14],[-85,10],[-80,9],[-77,8],[-82,15],[-90,17],[-98,19]],
        // 南美洲
        [[-80,8],[-70,12],[-60,5],[-50,0],[-35,-8],[-40,-20],[-55,-35],[-65,-55],[-72,-50],[-75,-30],[-70,-15]],
        // 欧洲
        [[-10,36],[0,40],[10,43],[15,40],[25,40],[30,45],[40,45],[40,55],[30,60],[20,65],[10,60],[5,58],[-5,50],[-10,43]],
        // 非洲
        [[-17,15],[-15,25],[-5,35],[10,37],[20,32],[32,30],[43,12],[50,10],[40,-5],[35,-20],[25,-34],[18,-35],[12,-18],[10,0],[0,5],[-8,5],[-15,10]],
        // 亚洲
        [[40,45],[50,40],[60,25],[70,20],[78,8],[88,22],[95,15],[105,10],[110,20],[120,30],[130,35],[140,40],[145,45],[135,55],[120,60],[100,70],[80,72],[60,68],[50,60],[40,55]],
        // 印度
        [[68,24],[78,8],[88,22],[80,30],[72,25]],
        // 东南亚
        [[95,15],[105,10],[110,20],[118,15],[120,5],[110,0],[100,5],[95,10]],
        // 澳洲
        [[113,-22],[122,-18],[130,-12],[137,-12],[142,-11],[146,-18],[150,-25],[153,-30],[148,-38],[140,-38],[130,-32],[115,-34]],
        // 格陵兰
        [[-46,60],[-30,68],[-22,70],[-20,76],[-30,83],[-45,80],[-58,76],[-55,68]],
        // 马达加斯加
        [[44,-16],[50,-16],[47,-25],[44,-25]]
    ];

    // 画大陆（绿色低地 → 棕色高地）
    continents.forEach(function(poly) {
        ctx.beginPath();
        poly.forEach(function(pt, i) {
            var x = px(pt[0]), y = py(pt[1]);
            // 边缘噪声扰动
            x += (Math.random()-0.5)*4; y += (Math.random()-0.5)*4;
            i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
        });
        ctx.closePath();
        // 填充：绿色为主
        ctx.fillStyle = '#2d6a3e';
        ctx.fill();
        // 内部高地（棕色）
        ctx.save();
        ctx.clip();
        for (var i=0;i<30;i++) {
            ctx.fillStyle = Math.random()>0.5?'#3a7d44':'#6b5335';
            ctx.beginPath();
            ctx.ellipse(px(poly[0][0]+Math.random()*30), py(poly[0][1]+Math.random()*20), 10+Math.random()*25, 5+Math.random()*15, 0, 0, 7);
            ctx.fill();
        }
        ctx.restore();
    });

    // 青藏高原（白色/棕色高地）
    ctx.fillStyle = '#8b7355';
    ctx.beginPath(); ctx.ellipse(px(85), py(35), 40, 20, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#b8a88a';
    ctx.beginPath(); ctx.ellipse(px(88), py(34), 25, 12, 0, 0, 7); ctx.fill();

    // 撒哈拉沙漠（黄色）
    ctx.fillStyle = '#c2b280';
    ctx.beginPath(); ctx.ellipse(px(15), py(23), 45, 18, 0, 0, 7); ctx.fill();

    // 极地冰盖
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillRect(0,0,w,10);
    ctx.fillRect(0,h-10,w,10);
    // 格陵兰冰盖
    ctx.beginPath(); ctx.ellipse(px(-40), py(72), 20, 12, 0, 0, 7); ctx.fill();

    // 云层（半透明白色条带）
    for (var i=0;i<40;i++) {
        ctx.fillStyle = 'rgba(255,255,255,'+(0.1+Math.random()*0.2)+')';
        ctx.beginPath();
        ctx.ellipse(Math.random()*w, 10+Math.random()*(h-20), 15+Math.random()*25, 3+Math.random()*5, 0, 0, 7);
        ctx.fill();
    }
}

function drawMoon(ctx,w,h) {
    ctx.fillStyle='#9a9a9a'; ctx.fillRect(0,0,w,h);
    // 月海
    for (var i=0;i<10;i++) {
        ctx.fillStyle='rgba(60,60,60,0.4)';
        ctx.beginPath();
        ctx.ellipse(Math.random()*w, Math.random()*h, 20+Math.random()*40, 15+Math.random()*25, 0, 0, 7);
        ctx.fill();
    }
    // 陨石坑
    for (var i=0;i<150;i++) {
        var x=Math.random()*w, y=Math.random()*h, r=1+Math.random()*4;
        ctx.fillStyle='rgba(40,40,40,0.5)';
        ctx.beginPath(); ctx.arc(x,y,r,0,7); ctx.fill();
        ctx.fillStyle='rgba(200,200,200,0.3)';
        ctx.beginPath(); ctx.arc(x-r*0.3,y-r*0.3,r*0.6,0,7); ctx.fill();
    }
}

function drawPlanetColor(base, banded) {
    return function(ctx,w,h) {
        ctx.fillStyle = 'rgb('+Math.round(base[0]*255)+','+Math.round(base[1]*255)+','+Math.round(base[2]*255)+')';
        ctx.fillRect(0,0,w,h);
        if (banded) {
            for (var y=0;y<h;y+=8) {
                ctx.fillStyle = 'rgba('+Math.round(base[0]*150)+','+Math.round(base[1]*130)+','+Math.round(base[2]*100)+',0.3)';
                ctx.fillRect(0, y+Math.random()*4, w, 3+Math.random()*4);
            }
        }
        noise(ctx,w,h,500,['rgba(0,0,0,0.08)','rgba(255,255,255,0.08)'],1,3);
    };
}

// ============================================================
// 法线贴图：从高度图生成
// ============================================================
function heightToNormal(heightData, w, h, strength) {
    var out = new Uint8Array(w*h*4);
    for (var y=0;y<h;y++) {
        for (var x=0;x<w;x++) {
            var xm = (x-1+w)%w, xp=(x+1)%w;
            var ym = (y-1+h)%h, yp=(y+1)%h;
            var hl = heightData[y*w+xm], hr = heightData[y*w+xp];
            var hu = heightData[ym*w+x], hd = heightData[yp*w+x];
            var dx = (hr-hl)*strength, dy = (hd-hu)*strength;
            // 法线 = normalize(-dx, -dy, 1)
            var nx=-dx, ny=-dy, nz=1;
            var l=Math.sqrt(nx*nx+ny*ny+nz*nz);
            var i=(y*w+x)*4;
            out[i]=(nx/l*0.5+0.5)*255;
            out[i+1]=(ny/l*0.5+0.5)*255;
            out[i+2]=(nz/l*0.5+0.5)*255;
            out[i+3]=255;
        }
    }
    return out;
}

function makeNormalMapTexture(heightData, w, h, strength) {
    var data = heightToNormal(heightData, w, h, strength);
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
}

// 生成地球高度图：海洋低，大陆高，用真实大陆坐标
function earthHeightMap(w,h) {
    var d = new Float32Array(w*h);
    function px(lon) { return (lon+180)/360*w; }
    function py(lat) { return (90-lat)/180*h; }
    // 基础海洋
    for (var i=0;i<w*h;i++) d[i]=0.15+Math.random()*0.05;
    // 极地
    for (var y=0;y<8;y++) for (var x=0;x<w;x++) d[y*w+x]=0.9;
    for (var y=h-8;y<h;y++) for (var x=0;x<w;x++) d[y*w+x]=0.9;
    // 大陆多边形（与 drawEarth 对应）
    var polys = [
        [[-168,66],[-140,70],[-95,72],[-80,70],[-60,60],[-55,47],[-75,35],[-80,25],[-97,26],[-105,20],[-115,30],[-125,40],[-130,55],[-160,60]],
        [[-80,8],[-70,12],[-60,5],[-50,0],[-35,-8],[-40,-20],[-55,-35],[-65,-55],[-72,-50],[-75,-30],[-70,-15]],
        [[-10,36],[0,40],[10,43],[15,40],[25,40],[30,45],[40,45],[40,55],[30,60],[20,65],[10,60],[5,58],[-5,50],[-10,43]],
        [[-17,15],[-15,25],[-5,35],[10,37],[20,32],[32,30],[43,12],[50,10],[40,-5],[35,-20],[25,-34],[18,-35],[12,-18],[10,0],[0,5],[-8,5],[-15,10]],
        [[40,45],[50,40],[60,25],[70,20],[78,8],[88,22],[95,15],[105,10],[110,20],[120,30],[130,35],[140,40],[145,45],[135,55],[120,60],[100,70],[80,72],[60,68],[50,60],[40,55]],
        [[113,-22],[122,-18],[130,-12],[137,-12],[142,-11],[146,-18],[150,-25],[153,-30],[148,-38],[140,-38],[130,-32],[115,-34]],
        [[-46,60],[-30,68],[-22,70],[-20,76],[-30,83],[-45,80],[-58,76],[-55,68]]
    ];
    polys.forEach(function(poly) {
        var minLon=Math.min.apply(null,poly.map(p=>p[0])), maxLon=Math.max.apply(null,poly.map(p=>p[0]));
        var minLat=Math.min.apply(null,poly.map(p=>p[1])), maxLat=Math.max.apply(null,poly.map(p=>p[1]));
        for (var y=py(minLat); y<py(maxLat); y++) {
            for (var x=px(minLon); x<px(maxLon); x++) {
                // 点在多边形内判断（射线法）
                var inside=false;
                for (var i=0,j=poly.length-1;i<poly.length;j=i++) {
                    var xi=px(poly[i][0]), yi=py(poly[i][1]), xj=px(poly[j][0]), yj=py(poly[j][1]);
                    if (((yi>y)!=(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi)+xi)) inside=!inside;
                }
                if (inside) d[Math.round(y)*w+Math.round(x)] = 0.55+Math.random()*0.2;
            }
        }
    });
    // 青藏高原额外抬高（喜马拉雅）
    for (var y=py(28); y<py(40); y++) for (var x=px(75); x<px(100); x++) {
        if (y>=0&&y<h&&x>=0&&x<w) d[Math.round(y)*w+Math.round(x)]=0.8+Math.random()*0.15;
    }
    // 安第斯山脉（南美西海岸）
    for (var y=py(-55); y<py(10); y++) for (var x=px(-80); x<px(-68); x++) {
        if (y>=0&&y<h&&x>=0&&x<w) d[Math.round(y)*w+Math.round(x)]=0.7+Math.random()*0.1;
    }
    // 落基山脉（北美西部）
    for (var y=py(30); y<py(60); y++) for (var x=px(-125); x<px(-110); x++) {
        if (y>=0&&y<h&&x>=0&&x<w) d[Math.round(y)*w+Math.round(x)]=0.68+Math.random()*0.1;
    }
    // 阿尔卑斯（欧洲）
    for (var y=py(44); y<py(48); y++) for (var x=px(5); x<px(15); x++) {
        if (y>=0&&y<h&&x>=0&&x<w) d[Math.round(y)*w+Math.round(x)]=0.65+Math.random()*0.1;
    }
    return d;
}

// 月球高度图：陨石坑凹陷
function moonHeightMap(w,h) {
    var d = new Float32Array(w*h);
    for (var i=0;i<w*h;i++) d[i]=0.5+Math.random()*0.1;
    // 月海（略低）
    for (var k=0;k<8;k++) {
        var cx=Math.random()*w, cy=Math.random()*h, r=20+Math.random()*30;
        for (var y=Math.max(0,cy-r);y<Math.min(h,cy+r);y++)
            for (var x=Math.max(0,cx-r);x<Math.min(w,cx+r);x++) {
                var dist=Math.sqrt((x-cx)**2+(y-cy)**2);
                if (dist<r) d[y*w+x]-=0.1;
            }
    }
    // 陨石坑（凹陷+边缘隆起）
    for (var k=0;k<80;k++) {
        var cx=Math.random()*w, cy=Math.random()*h, r=2+Math.random()*6;
        for (var y=Math.max(0,cy-r);y<Math.min(h,cy+r);y++)
            for (var x=Math.max(0,cx-r);x<Math.min(w,cx+r);x++) {
                var dist=Math.sqrt((x-cx)**2+(y-cy)**2);
                if (dist<r) d[y*w+x]-=0.25*(1-dist/r);
                if (dist<r*1.2) d[y*w+x]+=0.08; // 边缘隆起
            }
    }
    return d;
}

// 通用噪声高度图
function noiseHeightMap(w,h,amp) {
    var d = new Float32Array(w*h);
    for (var i=0;i<w*h;i++) d[i]=0.5+Math.random()*amp;
    return d;
}

// ============================================================
// Buffer 工具
// ============================================================
function bindAttr(buf,name,size) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    var loc = gl.getAttribLocation(program, name);
    if (loc < 0) return;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
}
function bindAttrP(buf,name,size) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    var loc = gl.getAttribLocation(particleProgram, name);
    if (loc < 0) return;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
}

// ============================================================
// 初始化
// ============================================================
function init() {
    canvas = document.getElementById('glcanvas');
    gl = canvas.getContext('webgl2', {antialias:true});
    if (!gl) { showErr('WebGL 2.0 not supported'); return; }

    function resize() {
        var dpr = window.devicePixelRatio||1;
        canvas.width = canvas.clientWidth*dpr;
        canvas.height = canvas.clientHeight*dpr;
        gl.viewport(0,0,canvas.width,canvas.height);
    }
    resize(); window.addEventListener('resize', resize);

    program = makeProgram(VERT_SRC, FRAG_SRC);
    particleProgram = makeProgram(PVERT_SRC, PFRAG_SRC);

    // 球体
    var sph = createSphere(24,48,1);
    sphereBuf = {
        pos: gl.createBuffer(), nor: gl.createBuffer(), tan: gl.createBuffer(), uv: gl.createBuffer(), idx: gl.createBuffer(),
        count: sph.idx.length
    };
    gl.bindBuffer(gl.ARRAY_BUFFER, sphereBuf.pos); gl.bufferData(gl.ARRAY_BUFFER, sph.pos, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, sphereBuf.nor); gl.bufferData(gl.ARRAY_BUFFER, sph.nor, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, sphereBuf.tan); gl.bufferData(gl.ARRAY_BUFFER, sph.tan, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, sphereBuf.uv);  gl.bufferData(gl.ARRAY_BUFFER, sph.uv, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sphereBuf.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sph.idx, gl.STATIC_DRAW);

    // 土星环
    var rg = createRing(1.4, 2.6, 96);
    ringBuf = {pos:gl.createBuffer(),nor:gl.createBuffer(),uv:gl.createBuffer(),idx:gl.createBuffer(),count:rg.idx.length};
    gl.bindBuffer(gl.ARRAY_BUFFER, ringBuf.pos); gl.bufferData(gl.ARRAY_BUFFER, rg.pos, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, ringBuf.nor); gl.bufferData(gl.ARRAY_BUFFER, rg.nor, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, ringBuf.uv);  gl.bufferData(gl.ARRAY_BUFFER, rg.uv, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ringBuf.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, rg.idx, gl.STATIC_DRAW);

    // 土星环小陨石（在环轨道上随机分布）
    var satPts = [];
    for (var i=0;i<300;i++) {
        var r = 1.4+Math.random()*1.2, a = Math.random()*2*Math.PI;
        satPts.push(r*Math.cos(a), 0, r*Math.sin(a));
    }
    saturnRingBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, saturnRingBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(satPts), gl.STATIC_DRAW);
    saturnRingCount = 300;

    // 背景星空
    var stars = [];
    for (var i=0;i<2000;i++) {
        var theta = Math.random()*2*Math.PI;
        var phi = Math.acos(2*Math.random()-1);
        var r = 60+Math.random()*40;
        stars.push(r*Math.sin(phi)*Math.cos(theta), r*Math.cos(phi), r*Math.sin(phi)*Math.sin(theta));
    }
    starBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, starBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(stars), gl.STATIC_DRAW);
    starCount = 2000;

    // 小行星带（火星11.5和木星16之间）
    var ast = [];
    for (var i=0;i<600;i++) {
        var r = 12.5+Math.random()*1.0, a = Math.random()*2*Math.PI;
        ast.push(r*Math.cos(a), (Math.random()-0.5)*0.3, r*Math.sin(a));
    }
    asteroidBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, asteroidBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(ast), gl.STATIC_DRAW);
    asteroidBuf.count = 600;

    // 太阳粒子
    var N = 600, starts=[], vels=[], lifes=[];
    for (var i=0;i<N;i++) {
        // 随机球面方向
        var u=Math.random()*2-1, ph=Math.random()*2*Math.PI;
        var s=Math.sqrt(1-u*u);
        var dx=s*Math.cos(ph), dy=u, dz=s*Math.sin(ph);
        var r = 3.0; // 太阳表面
        starts.push(dx*r, dy*r, dz*r);
        var spd = 0.3+Math.random()*1.0;
        vels.push(dx*spd, dy*spd, dz*spd);
        lifes.push(1.5+Math.random()*2.5);
    }
    particleBuf = {
        start: gl.createBuffer(), vel: gl.createBuffer(), life: gl.createBuffer(), count: N
    };
    gl.bindBuffer(gl.ARRAY_BUFFER, particleBuf.start); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(starts), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, particleBuf.vel);   gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vels), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, particleBuf.life); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lifes), gl.STATIC_DRAW);

    // 轨道线
    PLANETS.forEach(function(p) {
        var pts=[];
        for (var i=0;i<=128;i++) { var a=i*2*Math.PI/128; pts.push(p.orbit*Math.cos(a),0,p.orbit*Math.sin(a)); }
        orbitBufs[p.name] = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, orbitBufs[p.name]);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STATIC_DRAW);
    });
    var moonPts=[];
    for (var i=0;i<=64;i++) { var a=i*2*Math.PI/64; moonPts.push(1.0*Math.cos(a),0,1.0*Math.sin(a)); }
    orbitBufs.moon = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, orbitBufs.moon);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(moonPts), gl.STATIC_DRAW);

    // 纹理（地球2K高清）
    textures.sun = makeTex(drawSun, 512, 256);
    textures.earth = makeTex(drawEarth, 2048, 1024);
    textures.earthClouds = makeTex(drawClouds, 1024, 512);
    textures.sunGlow = makeTex(drawGlow, 256, 128);
    textures.moon = makeTex(drawMoon, 512, 256);
    PLANETS.forEach(function(p) {
        if (p.name!=='地球' && p.color) p.tex = makeTex(drawPlanetColor(p.color, p.orbit>10), 512, 256);
    });

    // 法线贴图（凹凸感，高强度）
    textures.earthNormal = makeNormalMapTexture(earthHeightMap(512,256), 512, 256, 5.0);
    textures.moonNormal = makeNormalMapTexture(moonHeightMap(512,256), 512, 256, 3.0);
    PLANETS.forEach(function(p) {
        if (p.name!=='地球' && p.color) p.normalMap = makeNormalMapTexture(noiseHeightMap(256,128,0.15), 256, 128, 1.5);
    });

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0.01,0.01,0.03,1);

    setupEvents();
    requestAnimationFrame(tick);
}

// ============================================================
// 绘制
// ============================================================
function setCommon(modelMat, viewProj) {
    gl.uniformMatrix4fv(gl.getUniformLocation(program,'uViewProj'), false, new Float32Array(viewProj));
    gl.uniformMatrix4fv(gl.getUniformLocation(program,'uModel'), false, new Float32Array(modelMat));
    gl.uniformMatrix3fv(gl.getUniformLocation(program,'uNormalMat'), false,
        new Float32Array([modelMat[0],modelMat[1],modelMat[2], modelMat[4],modelMat[5],modelMat[6], modelMat[8],modelMat[9],modelMat[10]]));
    gl.uniform1f(gl.getUniformLocation(program,'uPointSize'), 1.0);
    gl.uniform1f(gl.getUniformLocation(program,'uOrbitSpinTime'), 0.0);
}

function drawSphere(modelMat, viewProj, tex, emissive, lightDir, normalMap) {
    gl.useProgram(program);
    setCommon(modelMat, viewProj);
    bindAttr(sphereBuf.pos,'aPosition',3);
    bindAttr(sphereBuf.nor,'aNormal',3);
    bindAttr(sphereBuf.tan,'aTangent',3);
    bindAttr(sphereBuf.uv,'aUV',2);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sphereBuf.idx);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(program,'uTex'), 0);
    gl.uniform1f(gl.getUniformLocation(program,'uCloudLayer'), 0.0);
    if (normalMap) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, normalMap);
        gl.uniform1i(gl.getUniformLocation(program,'uNormalMap'), 1);
        gl.uniform1f(gl.getUniformLocation(program,'uUseNormalMap'), 1.0);
    } else {
        gl.uniform1f(gl.getUniformLocation(program,'uUseNormalMap'), 0.0);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(gl.getUniformLocation(program,'uIsEmissive'), emissive);
    gl.uniform1f(gl.getUniformLocation(program,'uUseFlatColor'), 0);
    gl.uniform1f(gl.getUniformLocation(program,'uTime'), performance.now()/1000 - state.startTime);
    gl.uniform3fv(gl.getUniformLocation(program,'uLightDir'), new Float32Array(lightDir||[0,1,0]));
    gl.drawElements(gl.TRIANGLES, sphereBuf.count, gl.UNSIGNED_SHORT, 0);
}

function drawCloudLayer(modelMat, viewProj, cloudTex) {
    gl.useProgram(program);
    setCommon(modelMat, viewProj);
    bindAttr(sphereBuf.pos,'aPosition',3);
    bindAttr(sphereBuf.nor,'aNormal',3);
    bindAttr(sphereBuf.tan,'aTangent',3);
    bindAttr(sphereBuf.uv,'aUV',2);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sphereBuf.idx);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cloudTex);
    gl.uniform1i(gl.getUniformLocation(program,'uTex'), 0);
    gl.uniform1f(gl.getUniformLocation(program,'uCloudLayer'), 1.0);
    gl.uniform1f(gl.getUniformLocation(program,'uUseNormalMap'), 0.0);
    gl.uniform1f(gl.getUniformLocation(program,'uUseFlatColor'), 0);
    gl.uniform1f(gl.getUniformLocation(program,'uIsEmissive'), 1.0);
    gl.drawElements(gl.TRIANGLES, sphereBuf.count, gl.UNSIGNED_SHORT, 0);
}

function drawFlat(modelMat, viewProj, color, mode, count) {
    gl.useProgram(program);
    setCommon(modelMat, viewProj);
    bindAttr(sphereBuf.pos,'aPosition',3); // 占位
    gl.uniform1f(gl.getUniformLocation(program,'uUseFlatColor'), 1);
    gl.uniform4fv(gl.getUniformLocation(program,'uFlatColor'), new Float32Array(color));
    gl.drawArrays(mode, 0, count);
}

function drawParticles(viewProj, time) {
    if (!state.showParticles) return;
    gl.useProgram(particleProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(particleProgram,'uViewProj'), false, new Float32Array(viewProj));
    gl.uniform1f(gl.getUniformLocation(particleProgram,'uTime'), time);
    bindAttrP(particleBuf.start,'aStart',3);
    bindAttrP(particleBuf.vel,'aVel',3);
    bindAttrP(particleBuf.life,'aLife',1);
    gl.drawArrays(gl.POINTS, 0, particleBuf.count);
}

// ============================================================
// 渲染
// ============================================================
function render() {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    var aspect = canvas.width/canvas.height;
    var proj = state.usePerspective ? perspective(45,aspect,0.1,200)
                                    : ortho(-12*aspect,12*aspect,-12,12,0.1,200);

    var eye, at=[0,0,0], up=[0,1,0];
    if (state.camMode===0) {
        eye = quatRotateVec(state.trackballQuat, [0,0,state.camDistance]);
        up = quatRotateVec(state.trackballQuat, [0,1,0]);
    } else if (state.camMode===1) {
        var ep = earthPos(); eye=ep; at=[0,0,0];
    } else {
        var ep2 = earthPos(), mp = moonPos();
        eye=[ep2[0]*1.05, ep2[1]+0.3, ep2[2]*1.05]; at=mp;
    }
    var view = lookAt(eye, at, up);
    var vp = mult(proj, view);

    // 背景星空
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, starBuf);
    var loc=gl.getAttribLocation(program,'aPosition');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc,3,gl.FLOAT,false,0,0);
    setCommon(identity(), vp);
    gl.uniform1f(gl.getUniformLocation(program,'uUseFlatColor'),1);
    gl.uniform1f(gl.getUniformLocation(program,'uPointSize'), 1.5);
    gl.uniform4fv(gl.getUniformLocation(program,'uFlatColor'), new Float32Array([1,1,0.9,1.0]));
    gl.drawArrays(gl.POINTS, 0, starCount);

    // 太阳
    var sunModel = mult(rotate(state.sunAngle,[0,1,0]), scale(3,3,3));
    drawSphere(sunModel, vp, textures.sun, 1.0, [0,0,1]);

    // 太阳粒子
    drawParticles(vp, performance.now()/1000 - state.startTime);

    // 行星
    var earthOrbitMat=null;
    PLANETS.forEach(function(p,i) {
        var ang = state.planetAngles[i], spin = state.planetSpins[i];
        var orbitMat = mult(rotate(ang*180/Math.PI,[0,1,0]), translate(p.orbit,0,0));
        var tilt = p.name==='地球' ? state.axialTilt : p.tilt;
        var local = mult(rotate(tilt,[1,0,0]), mult(rotate(spin,[0,1,0]), scale(p.size,p.size,p.size)));
        var model = mult(orbitMat, local);
        var wp = mult(orbitMat,[0,0,0,1]);
        var ld=[-wp[0],-wp[1],-wp[2]];
        var ll=Math.sqrt(ld[0]**2+ld[1]**2+ld[2]**2)||1;
        ld=[ld[0]/ll,ld[1]/ll,ld[2]/ll];
        var tex = p.name==='地球'?textures.earth:p.tex;
        var nm = p.name==='地球'?textures.earthNormal:(p.normalMap||null);
        drawSphere(model, vp, tex, 0, ld, nm);

        // 云层：比地球大 4% 的半透明球体，独立自转
        if (p.name==='地球') {
            var cloudSpin = state.planetSpins[i] * 1.15 + 0.5; // 云层稍快
            var cloudModel = mult(orbitMat, mult(rotate(tilt,[1,0,0]),
                mult(rotate(cloudSpin,[0,1,0]), scale(p.size*1.04, p.size*1.04, p.size*1.04))));
            drawCloudLayer(cloudModel, vp, textures.earthClouds);
        }
        if (p.ring) {
            var rm = mult(orbitMat, rotate(p.tilt,[1,0,0]));
            gl.useProgram(program);
            setCommon(rm, vp);
            bindAttr(ringBuf.pos,'aPosition',3);
            bindAttr(ringBuf.nor,'aNormal',3);
            bindAttr(ringBuf.uv,'aUV',2);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ringBuf.idx);
            gl.uniform1f(gl.getUniformLocation(program,'uUseFlatColor'),1);
            gl.uniform4fv(gl.getUniformLocation(program,'uFlatColor'), new Float32Array([0.85,0.78,0.6,0.5]));
            gl.drawElements(gl.TRIANGLES, ringBuf.count, gl.UNSIGNED_SHORT, 0);
            // 环上小陨石点（内圈快外圈慢）
            setCommon(rm, vp);
            gl.uniform1f(gl.getUniformLocation(program,'uOrbitSpinTime'), performance.now()/1000 * 0.5);
            gl.bindBuffer(gl.ARRAY_BUFFER, saturnRingBuf);
            var loc = gl.getAttribLocation(program,'aPosition');
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc,3,gl.FLOAT,false,0,0);
            gl.uniform1f(gl.getUniformLocation(program,'uPointSize'), 3.0);
            gl.uniform4fv(gl.getUniformLocation(program,'uFlatColor'), new Float32Array([0.7,0.65,0.5,1.0]));
            gl.drawArrays(gl.POINTS, 0, saturnRingCount);
        }
        if (p.name==='地球') earthOrbitMat = orbitMat;
    });

    // 月球
    var moonTilt = rotate(5.14,[1,0,0]);
    var moonOrbitMat = mult(rotate(state.moonOrbit*180/Math.PI,[0,1,0]), translate(1.0,0,0));
    var moonLocal = mult(rotate(state.moonOrbit*180/Math.PI,[0,1,0]), scale(0.15,0.15,0.15));
    var moonModel = mult(earthOrbitMat, mult(moonTilt, mult(moonOrbitMat, moonLocal)));
    var mwp = mult(moonModel,[0,0,0,1]);
    var mld=[-mwp[0],-mwp[1],-mwp[2]];
    var mll=Math.sqrt(mld[0]**2+mld[1]**2+mld[2]**2)||1;
    mld=[mld[0]/mll,mld[1]/mll,mld[2]/mll];
    drawSphere(moonModel, vp, textures.moon, 0, mld, textures.moonNormal);

    // 轨道线
    if (state.showOrbits) {
        gl.useProgram(program);
        PLANETS.forEach(function(p) {
            gl.bindBuffer(gl.ARRAY_BUFFER, orbitBufs[p.name]);
            var loc=gl.getAttribLocation(program,'aPosition');
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc,3,gl.FLOAT,false,0,0);
            setCommon(identity(), vp);
            gl.uniform1f(gl.getUniformLocation(program,'uUseFlatColor'),1);
            gl.uniform4fv(gl.getUniformLocation(program,'uFlatColor'), new Float32Array([0.5,0.55,0.7,0.6]));
            gl.drawArrays(gl.LINE_STRIP, 0, 129);
        });
        // 月球轨道
        gl.bindBuffer(gl.ARRAY_BUFFER, orbitBufs.moon);
        var loc2=gl.getAttribLocation(program,'aPosition');
        gl.enableVertexAttribArray(loc2);
        gl.vertexAttribPointer(loc2,3,gl.FLOAT,false,0,0);
        setCommon(mult(earthOrbitMat, moonTilt), vp);
        gl.drawArrays(gl.LINE_STRIP, 0, 65);
    }

    // 小行星带
    if (state.showAsteroids) {
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, asteroidBuf);
        var loc3=gl.getAttribLocation(program,'aPosition');
        gl.enableVertexAttribArray(loc3);
        gl.vertexAttribPointer(loc3,3,gl.FLOAT,false,0,0);
        setCommon(identity(), vp);
        gl.uniform1f(gl.getUniformLocation(program,'uOrbitSpinTime'), performance.now()/1000 * 0.8);
        gl.uniform1f(gl.getUniformLocation(program,'uUseFlatColor'),1);
        gl.uniform1f(gl.getUniformLocation(program,'uPointSize'), 2.0);
        gl.uniform4fv(gl.getUniformLocation(program,'uFlatColor'), new Float32Array([0.7,0.7,0.75,1.0]));
        gl.drawArrays(gl.POINTS, 0, asteroidBuf.count);
    }
}

function earthPos() {
    var i = PLANETS.findIndex(p=>p.name==='地球');
    var a = state.planetAngles[i];
    return [6*Math.cos(a), 0, 6*Math.sin(a)];
}
function moonPos() {
    var ep = earthPos();
    return [ep[0]+Math.cos(state.moonOrbit), 0, ep[2]+Math.sin(state.moonOrbit)];
}

// ============================================================
// 动画
// ============================================================
var lastT = 0;
function tick(t) {
    var dt = Math.min((t-lastT)/1000, 0.05); lastT=t;
    if (state.roaming && state.camMode===0) {
        var q = quatFromAxisAngle([0,1,0], dt*10);
        state.trackballQuat = quatNormalize(quatMultiply(q, state.trackballQuat));
    }
    state.sunAngle += dt*10*state.spinSpeed;
    PLANETS.forEach(function(p,i) {
        state.planetAngles[i] += dt*p.orbitSpd*0.5*state.orbitSpeed;
        state.planetSpins[i] += dt*p.spin*20*state.spinSpeed;
    });
    state.moonOrbit += dt*1.5*state.orbitSpeed;
    render();
    requestAnimationFrame(tick);
}

// ============================================================
// 事件
// ============================================================
function setupEvents() {
    window.addEventListener('keydown', function(e) {
        var k = e.key.toLowerCase();
        if (k==='o') { state.usePerspective=!state.usePerspective;
            document.getElementById('projLabel').textContent = state.usePerspective?'透视':'正交'; }
        if (e.key===' ') { e.preventDefault(); state.roaming=!state.roaming;
            document.getElementById('roamLabel').textContent = state.roaming?'漫游中':'已暂停'; }
        if (k==='1') setCam(0);
        if (k==='2') setCam(1);
        if (k==='3') setCam(2);
        if (k==='a') state.moonOrbit = (state.camMode===1)?Math.PI:0;
    });

    var dragging=false, lastPt=null;
    canvas.addEventListener('mousedown', function(e) {
        dragging=true; lastPt=toTB(e); state.roaming=false;
        document.getElementById('roamLabel').textContent='已暂停（轨迹球）';
    });
    window.addEventListener('mouseup', function(){dragging=false;});
    window.addEventListener('mousemove', function(e) {
        if (!dragging||!lastPt) return;
        var cur=toTB(e);
        var ax=cross(lastPt,cur);
        var dotv=lastPt[0]*cur[0]+lastPt[1]*cur[1]+lastPt[2]*cur[2];
        var ang=2*Math.atan2(Math.sqrt(ax[0]**2+ax[1]**2+ax[2]**2), dotv);
        if (Math.abs(ang)>0.0001) {
            var q=quatFromAxisAngle(normalize(ax), ang*180/Math.PI);
            state.trackballQuat=quatNormalize(quatMultiply(q,state.trackballQuat));
        }
        lastPt=cur;
    });
    canvas.addEventListener('wheel', function(e) {
        e.preventDefault();
        state.camDistance=Math.max(5,Math.min(80,state.camDistance+e.deltaY*0.02));
    }, {passive:false});

    bind('orbitSpeed', v=>state.orbitSpeed=v);
    bind('spinSpeed', v=>state.spinSpeed=v);
    bind('axialTilt', v=>state.axialTilt=v);
    document.getElementById('showOrbits').onchange=e=>state.showOrbits=e.target.checked;
    document.getElementById('showAsteroids').onchange=e=>state.showAsteroids=e.target.checked;
    document.getElementById('showParticles').onchange=e=>state.showParticles=e.target.checked;
}
function toTB(e) {
    var r=canvas.getBoundingClientRect();
    var x=(e.clientX-r.left)/r.width*2-1;
    var y=1-(e.clientY-r.top)/r.height*2;
    var d=x*x+y*y;
    var z=d<1?Math.sqrt(1-d):0;
    if (d>1) { var l=Math.sqrt(d); x/=l; y/=l; }
    return [x,y,z];
}
function setCam(m) {
    state.camMode=m;
    var labels=['全景','日食视点','月食视点'];
    document.getElementById('camMode').textContent=labels[m];
    if (m===1) state.moonOrbit=Math.PI;
    if (m===2) state.moonOrbit=0;
}
function bind(id,fn) {
    var el=document.getElementById(id);
    el.oninput=function(){ fn(parseFloat(el.value));
        document.getElementById(id+'Val').textContent=el.value+(id==='axialTilt'?'°':'x'); };
}

window.addEventListener('load', function() {
    try { init(); } catch(e) { showErr('INIT ERROR: '+e.message+'\n'+e.stack); }
});
