const canvas = document.getElementById("sun");
if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  /* still paint a static disc */
}

const gl =
  canvas && canvas.getContext("webgl2", { antialias: true, alpha: true });

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
  if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
}

if (!gl) {
  resize();
  const ctx = canvas.getContext("2d");
  const paint = () => {
    const { width: w, height: h } = canvas;
    const g = ctx.createRadialGradient(w * 0.72, h * 0.18, 20, w * 0.55, h * 0.4, w * 0.8);
    g.addColorStop(0, "rgba(255, 224, 138, 0.95)");
    g.addColorStop(0.35, "rgba(234, 176, 57, 0.45)");
    g.addColorStop(1, "rgba(18, 14, 8, 0)");
    ctx.fillStyle = "#120e08";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };
  resize();
  paint();
  addEventListener("resize", () => {
    resize();
    paint();
  });
} else {
  const vs = `#version 300 es
  in vec2 a;
  void main(){ gl_Position = vec4(a,0.0,1.0); }`;
  const fs = `#version 300 es
  precision highp float;
  out vec4 o;
  uniform vec2 r;
  uniform vec2 m;
  uniform float t;
  void main(){
    vec2 uv = gl_FragCoord.xy / r;
    vec2 p = uv * 2.0 - 1.0;
    p.x *= r.x / r.y;
    vec2 sun = vec2(0.62, 0.48);
    vec2 mp = (m / r) * 2.0 - 1.0;
    mp.x *= r.x / r.y;
    sun += (mp - sun) * 0.08;
    float d = length(p - sun);
    float disc = smoothstep(0.42, 0.08, d);
    float haze = exp(-d * 2.4);
    float rays = 0.0;
    for (int i = 0; i < 6; i++) {
      float a = float(i) * 1.047 + t * 0.05;
      vec2 dir = vec2(cos(a), sin(a));
      float line = abs(dot(normalize(p - sun + 0.0001), dir));
      rays += smoothstep(0.18, 0.0, line) * exp(-d * 1.6);
    }
    vec3 gold = vec3(0.918, 0.690, 0.224);
    vec3 flare = vec3(1.0, 0.878, 0.541);
    vec3 soil = vec3(0.071, 0.055, 0.031);
    vec3 col = mix(soil, gold, haze * 0.85);
    col = mix(col, flare, disc * 0.9 + rays * 0.12);
    o = vec4(col, 1.0);
  }`;
  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "a");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uR = gl.getUniformLocation(prog, "r");
  const uM = gl.getUniformLocation(prog, "m");
  const uT = gl.getUniformLocation(prog, "t");
  const mouse = { x: 0, y: 0 };
  addEventListener("pointermove", (e) => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    mouse.x = e.clientX * dpr;
    mouse.y = (innerHeight - e.clientY) * dpr;
  });
  resize();
  mouse.x = canvas.width * 0.7;
  mouse.y = canvas.height * 0.75;
  const start = performance.now();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function frame(now) {
    gl.uniform2f(uR, canvas.width, canvas.height);
    gl.uniform2f(uM, mouse.x, mouse.y);
    gl.uniform1f(uT, reduce ? 0 : (now - start) / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!reduce) requestAnimationFrame(frame);
  }
  addEventListener("resize", resize);
  requestAnimationFrame(frame);
}
