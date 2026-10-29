# AP2 · 三维层级场景：太阳系

基于 **WebGL 2.0 + GLSL ES 3.00** 的太阳–行星–月球三级层级变换演示，使用 Angel & Shreiner 教材配套工具库（`initShaders.js` / `MV.js` / `webgl-utils.js`）。

## 一、运行方式

**本地运行**：直接双击 `index.html`（Chrome / Edge / Firefox）。纹理由 Canvas 程序化生成，无跨域问题，无需本地服务器。

**公网部署**（课程要求）：将整个文件夹 push 到 GitHub，开启 GitHub Pages，教师即可通过 URL 访问。

### 操作

| 按键 | 功能 |
|---|---|
| `O` | 切换正交 / 透视投影 |
| `空格` | 暂停 / 继续相机动画漫游 |
| `1` | 视点：全景（轨迹球自由旋转） |
| `2` | 视点：日食模拟（月球挡太阳） |
| `3` | 视点：月食模拟（地球阴影中的月球） |
| `A` | 手动对齐日地月共线 |
| 鼠标拖拽 | 虚拟轨迹球旋转视角（自动暂停漫游） |
| 滚轮 | 相机距离缩放 |

## 二、文件结构

```
solar-system/
├── index.html       页面 + 着色器（<script type="x-shader/..."> 标签）
├── mv.js            教材矩阵库 + 四元数
├── initShaders.js   教材配套着色器编译工具
├── webgl-utils.js   教材配套 WebGL 2.0 上下文初始化
├── solar.js         主渲染：层级变换、纹理、双投影、漫游、选做项
├── textures/        参考用真实纹理（备用）
└── README.md
```

## 三、技术栈说明（WebGL 2.0）

| 项目 | 实现 |
|---|---|
| 上下文 | `WebGLUtils.setupWebGL(canvas)` → `canvas.getContext('webgl2')` |
| 着色器 | GLSL ES 3.00，首行 `#version 300 es` |
| 顶点属性 | `in vec3`（替代 WebGL 1 的 `attribute`） |
| 片元输出 | `out vec4 fragColor`（替代 `gl_FragColor`） |
| 纹理采样 | `texture(uTex, vUV)`（替代 `texture2D`） |
| 编译流程 | 教材 `initShaders(gl, 'vertex-shader', 'fragment-shader')`，从 `<script>` 标签取源码 |

## 四、层级结构与变换顺序

层级树：

```
世界
└── 太阳 (原点, 自发光)
├── 水星 / 金星 / 火星 / 木星 / 天王星 (各自公转节点下: R_y(orbit)·T·R_x(tilt)·R_z(spin)·S)
├── 土星 (同上, 赤道面附加土星环)
└── 地球公转节点 (R_y(earthOrbit)·T(9,0,0))
    ├── 地球本体 (R_x(23.5°)·R_z(spin)·S(0.4))
    └── 月球节点 (R_x(5.14°)·R_y(moonOrbit)·T(1,0,0)·R_z(moonSpin)·S(0.15))
```

### 地球自转轴 23.5° 倾斜

```js
// 先在地球局部施加轴倾角，再叠加自转与缩放
var local = mult(
    rotate(axialTilt, [1,0,0]),                 // R_x(23.5°)：局部 Z 轴倾斜
    mult(rotate(spin, [0,0,1]), scale(size))    // R_z(spin)·S
);
// 外层再叠加公转轨道变换
var model = mult(
    rotate(earthOrbit, [0,1,0]),   // R_y(orbit)
    mult(translate(9,0,0), local)
);
```

**为什么顺序重要**：矩阵乘法不满足交换律。先 `R_x(tilt)`（局部倾斜）再 `T`、`R_y(orbit)`，倾斜是地球自身属性，公转只改变位置；若反过来，倾斜会作用在平移后的位置上，自转轴随公转而"甩动"。

## 五、手动矩阵构造（教材 Ch4 推导）

月球轨道面相对黄道面倾斜 5.14°。此处**不使用任何复合函数**，全部用 `MV.js` 基本变换手工 `mult` 组合：

```js
var moonTilt = rotate(5.14, [1,0,0]);           // 轨道面倾角矩阵
var moonOrbitMat = mult(
    rotate(moonOrbitAngle, [0,1,0]),
    translate(1.0, 0, 0)
);
var moonLocal = mult(
    rotate(moonSpin, [0,0,1]),
    scale(0.15, 0.15, 0.15)
);
var moonModelLocal = mult(moonTilt, mult(moonOrbitMat, moonLocal));
var moonModel = mult(earthOrbitMat, moonModelLocal);
```

**构造逻辑**：
- `R_x(5.14°)` 把月球轨道面绕 X 轴掀起 5.14°；
- `R_y(angle)·T(1,0,0)` 让月球在倾斜轨道面上绕地球公转；
- 右乘 `S` 缩放月球本体，左乘 `R_z(spin)` 自转；
- 最外层 `earthOrbitMat` 让月球跟随地球绕太阳公转——这就是"物体在物体之上"的依赖。

## 六、纹理与 UV 上下颠倒问题

三张主纹理（太阳/地球/月球）+ 五颗行星纯色纹理，均由 Canvas 程序化生成，通过 `gl.texImage2D` 上传。

### 为什么需要 `UNPACK_FLIP_Y_WEBGL`

- WebGL 纹理坐标：`(0,0)` 在**左下角**，v 向上递增；
- Canvas 2D 坐标：原点在**左上角**，y 向下递增。

不翻转时，Canvas 顶部（北极冰盖）被当作纹理 `v=0`（底部）采样，贴到球面上后北极出现在底部、大陆上下颠倒。

修复（`solar.js` 中 `makeCanvasTexture`）：

```js
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
```

球体 UV 生成时 `uv = (lon/lonBands, 1 - lat/latBands)`，与翻转后的纹理方向匹配。

## 七、双投影对比（按 `O` 键切换）

| | 透视 `perspective(45°, aspect, 0.1, 200)` | 正交 `ortho(-s, s, -s, s, 0.1, 200)` |
|---|---|---|
| 平行线 | 远处会聚到灭点 | 始终平行 |
| 近大远小 | 近处天体大、远处小 | 所有天体按真实尺寸绘制 |
| 轨道线 | 远处透视压缩成椭圆 | 始终是正圆 |
| 视觉 | 人眼真实感 | CAD / 工程制图风格 |

## 八、相机漫游与接管

- **漫游**：全景视点下，轨迹球四元数绕世界 Y 轴自动旋转，相机绕原点一周；
- **暂停/继续**：空格切换；
- **鼠标接管**：拖拽即暂停漫游，进入轨迹球手动控制；
- **视点模式**：`1` 全景 / `2` 日食 / `3` 月食，切到日月食视点自动对齐日地月共线。

---

## 九、选做项

### E1：完整太阳系（≥6 颗行星 + 土星环 + 小行星带）

包含 **7 颗行星**：水星、金星、地球、火星、木星、土星、天王星。

- 每颗行星独立的公转/自转/轴倾角参数（`PLANETS` 数组）；
- **土星环**：扁平三角形带（内半径 1.4、外半径 2.6），随土星轴倾角 27° 倾斜，环上 300 个小陨石点按 1/r² 差异化旋转；
- **小行星带**：火星（11.5）与木星（16）之间，600 个 `gl.POINTS`，半径 12.5–13.5 随机分布，同样按 1/r² 差异化旋转；
- 参数面板可开关小行星带与轨道线。

### E2：日食 / 月食模拟

| 按键 | 视点 | 现象 |
|---|---|---|
| `2` | 相机在地球，看向太阳 | 对齐后月球在地球-太阳之间，看到月球挡住太阳 = **日食** |
| `3` | 相机在地球夜侧，看向月球 | 对齐后月球在地球背阳面，看到月球进入地球阴影 = **月食** |
| `A` | 手动对齐 | 让 `moonOrbit = π`（日食）或 `0`（月食），使日-地-月共线 |

**光影说明**：片元着色器中，行星光照方向 = `normalize(-worldPos)`（从行星指向太阳）。日食时月球位于地球-太阳连线上，其背光面（朝向地球的一面）几乎无光照，呈现剪影；月食时月球进入地球阴影锥，漫反射光照强度骤降。

### E3：虚拟轨迹球（Virtual Trackball）

用教材 Virtual Trackball 思想替代简单的方位角/俯仰角拖拽：

```js
// 1. 屏幕坐标归一化到 [-1,1]
var x = (e.clientX - rect.left)/rect.width*2 - 1;
var y = 1 - (e.clientY - rect.top)/rect.height*2;
// 2. 映射到虚拟球面 z = sqrt(1 - x² - y²)
var z = (x*x+y*y) < 1 ? Math.sqrt(1 - x*x - y*y) : 0;
// 3. prev → curr 的旋转轴 = cross(prev, curr)
var axis = cross(lastPt, curr);
var dotv = dot(lastPt, curr);
var angle = 2 * Math.atan2(|axis|, dotv);
// 4. 四元数累积：trackballQuat = q_new * trackballQuat
state.trackballQuat = quatNormalize(quatMultiply(q, state.trackballQuat));
// 5. eye/up 由四元数旋转默认方向得到
eye = quatRotateVec(trackballQuat, [0,0,camDistance]);
up  = quatRotateVec(trackballQuat, [0,1,0]);
```

**为什么用四元数**：避免欧拉角万向节死锁，旋转累积平滑无跳变，符合教材 Virtual Trackball 模型。

## 十、参数面板

| 参数 | 作用 |
|---|---|
| 公转速度 | 缩放所有行星公转与月球绕地速度 |
| 自转速度 | 缩放所有行星自转速度 |
| 轴倾角 | 实时调整地球 `R_x(tilt)`（0–45°） |
| 轨道线 | 显示/隐藏所有行星与月球轨道 |
| 小行星带 | 显示/隐藏 600 个小行星点 |

## 十一、待补截图

运行后截屏 2–3 张放入 `screenshots/`：
1. `perspective.png` — 全景透视模式
2. `orthographic.png` — 正交模式对比
3. `eclipse.png` — 日食/月食视点
