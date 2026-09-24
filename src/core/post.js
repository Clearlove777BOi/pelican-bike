import * as THREE from 'three';
import { clamp } from '../lib/core.js';

export function createPost(renderer, scene, camera) {
  const quality = { level: 'high' };
  const size = new THREE.Vector2(1, 1);
  let enabled = true;

  const quadGeo = new THREE.BufferGeometry();
  quadGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  quadGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(quadGeo, null);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);

  function makeRT(w, h, opts = {}) {
    const rt = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: !!opts.depth,
      samples: opts.samples || 0,
    });
    rt.texture.name = opts.name || 'post';
    return rt;
  }

  let sceneRT = null;
  let brightRT = null;
  let blurA = null;
  let blurB = null;
  let dofRT = null;
  let sceneDepth = null;

  const dofMat = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      tDepth: { value: null },
      uNear: { value: 0.4 },
      uFar: { value: 300 },
      uFocus: { value: 3 },
      uAperture: { value: 0.15 },
      uMaxCoC: { value: 0.012 },
      uTexel: { value: new THREE.Vector2() },
    },
    vertexShader: `varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform sampler2D tDepth;
      uniform float uNear, uFar, uFocus, uAperture, uMaxCoC;
      uniform vec2 uTexel;
      varying vec2 vUv;
      float lin(float d){ float z = d * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear)); }
      float coc(float z){
        float c = uAperture * uMaxCoC * abs(z - uFocus) / max(z, 0.05);
        return clamp(c, 0.0, uMaxCoC);
      }
      void main(){
        float dz = texture2D(tDepth, vUv).x;
        if (dz >= 0.9999) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
        float z = lin(dz);
        float c = coc(z);
        if (c < 0.0004) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
        vec3 acc = vec3(0.0);
        float wsum = 0.0;
        const int N = 24;
        for (int i = 0; i < N; i++) {
          float fi = float(i);
          float a = fi * 2.39996323 + vUv.x * 40.0;
          float r = sqrt((fi + 0.5) / float(N)) * c;
          vec2 off = vec2(cos(a), sin(a)) * r;
          vec2 uv = vUv + off;
          float sz = lin(texture2D(tDepth, uv).x);
          float sc = coc(sz);
          float w = (sz > z ? min(sc, c * 1.4 + 0.0006) : sc) >= length(off) ? 1.0 : 0.0;
          vec3 s = texture2D(tDiffuse, uv).rgb;
          acc += s * w;
          wsum += w;
        }
        if (wsum < 0.5) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
        gl_FragColor = vec4(acc / wsum, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });

  const brightMat = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, uThreshold: { value: 0.92 }, uKnee: { value: 0.5 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uThreshold; uniform float uKnee;
      varying vec2 vUv;
      void main(){
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        float k = smoothstep(uThreshold, uThreshold + uKnee, l);
        float comp = 1.0 / (1.0 + l * k / 8.0);
        gl_FragColor = vec4(c * k * comp, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });

  const blurMat = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2(1, 0) }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1.2 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform vec2 uDir; uniform vec2 uTexel; uniform float uRadius;
      varying vec2 vUv;
      void main(){
        float w[5];
        w[0] = 0.2270270270; w[1] = 0.1945945946; w[2] = 0.1216216216; w[3] = 0.0540540541; w[4] = 0.0162162162;
        vec2 stepv = uDir * uTexel * uRadius;
        vec3 acc = texture2D(tDiffuse, vUv).rgb * w[0];
        for (int i = 1; i < 5; i++) {
          vec2 o = stepv * float(i);
          acc += texture2D(tDiffuse, vUv + o).rgb * w[i];
          acc += texture2D(tDiffuse, vUv - o).rgb * w[i];
        }
        gl_FragColor = vec4(acc, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });

  const compositeMat = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      tBloom: { value: null },
      uBloom: { value: 0.6 },
      uExposure: { value: 0.94 },
      uVignette: { value: 0.42 },
      uGrain: { value: 0.024 },
      uTime: { value: 0 },
      uWarm: { value: 0.10 },
      uSaturation: { value: 1.18 },
      uContrast: { value: 1.22 },
      uFade: { value: 0 },
      uRes: { value: new THREE.Vector2() },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform sampler2D tBloom;
      uniform float uBloom, uExposure, uVignette, uGrain, uTime, uWarm, uSaturation, uContrast, uFade;
      uniform vec2 uRes;
      varying vec2 vUv;
      float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      void main(){
        vec2 uv = vUv;
        vec2 dc = uv - 0.5;
        float r2 = dot(dc, dc);
        vec3 c;
        c.r = texture2D(tDiffuse, uv - dc * r2 * 0.004).r;
        c.g = texture2D(tDiffuse, uv).g;
        c.b = texture2D(tDiffuse, uv + dc * r2 * 0.004).b;
        vec3 bloom = texture2D(tBloom, uv).rgb;
        c += bloom * uBloom;
        c *= uExposure;
        c *= vec3(1.0 + uWarm, 1.0, 1.0 - uWarm * 0.7);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSaturation);
        c = (c - 0.42) * uContrast + 0.42;
        // filmic shoulder: keep highlights from clipping to flat white
        c = c / (1.0 + max(c - 0.85, 0.0) * 0.55);
        float v = 1.0 - uVignette * smoothstep(0.12, 0.92, r2 * 2.0);
        c *= v;
        float t = uTime;
        float n = h12(uv * uRes + floor(t * 24.0) * 17.13) - 0.5;
        c += n * uGrain * (0.4 + 1.2 * l * (1.0 - l));
        c += (h12(uv * uRes * 1.7 + 3.1) - 0.5) / 255.0;
        c *= 1.0 - uFade;
        gl_FragColor = vec4(max(c, 0.0), 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });

  function setSize(w, h) {
    size.set(w, h);
    const pr = renderer.getPixelRatio();
    const W = Math.max(1, Math.floor(w * pr));
    const H = Math.max(1, Math.floor(h * pr));
    const samples = quality.level === 'high' ? 4 : 0;
    if (sceneRT) sceneRT.dispose();
    sceneDepth?.dispose();
    sceneDepth = new THREE.DepthTexture(W, H);
    sceneDepth.type = THREE.UnsignedIntType;
    sceneRT = new THREE.WebGLRenderTarget(W, H, {
      type: THREE.HalfFloatType, samples,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthTexture: sceneDepth, depthBuffer: true,
    });
    dofRT?.dispose();
    dofRT = makeRT(W, H, { name: 'dof' });
    const bw = Math.max(1, W >> 2), bh = Math.max(1, H >> 2);
    brightRT?.dispose();
    brightRT = makeRT(bw, bh, { name: 'bright' });
    blurA?.dispose();
    blurA = makeRT(bw, bh, { name: 'blurA' });
    blurB?.dispose();
    blurB = makeRT(bw, bh, { name: 'blurB' });
    for (const m of [dofMat, brightMat, blurMat, compositeMat]) {
      if (m.uniforms.uTexel) m.uniforms.uTexel.value.set(1 / W, 1 / H);
      if (m.uniforms.uRes) m.uniforms.uRes.value.set(W, H);
    }
    compositeMat.uniforms.uBloom.value = quality.level === 'high' ? 0.62 : quality.level === 'medium' ? 0.45 : 0;
  }

  function renderPass(mat, target, source) {
    quad.material = mat;
    mat.uniforms.tDiffuse.value = source;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCam);
  }

  let sceneStats = { calls: 0, triangles: 0, points: 0, lines: 0 };

  function render(ctx) {
    const cam = camera;
    if (!enabled || !sceneRT) {
      renderer.setRenderTarget(null);
      renderer.render(scene, cam);
      sceneStats = { ...renderer.info.render };
      return;
    }
    renderer.setRenderTarget(sceneRT);
    renderer.clear();
    renderer.render(scene, cam);
    // the fullscreen passes below would overwrite renderer.info, so keep the scene pass's numbers
    const info = renderer.info.render;
    sceneStats = { calls: info.calls, triangles: info.triangles, points: info.points, lines: info.lines };

    const dofOn = quality.level !== 'low' && (cam.userData.aperture || 0) > 0.02;
    let colorTex = sceneRT.texture;
    if (dofOn) {
      dofMat.uniforms.tDepth.value = sceneDepth;
      dofMat.uniforms.uNear.value = cam.near;
      dofMat.uniforms.uFar.value = cam.far;
      dofMat.uniforms.uFocus.value = cam.userData.focus || 3;
      dofMat.uniforms.uAperture.value = cam.userData.aperture || 0.1;
      dofMat.uniforms.uMaxCoC.value = 0.014;
      renderPass(dofMat, dofRT, sceneRT.texture);
      colorTex = dofRT.texture;
    }

    if (compositeMat.uniforms.uBloom.value > 0.001) {
      brightMat.uniforms.tDiffuse.value = colorTex;
      renderer.setRenderTarget(brightRT);
      quad.material = brightMat;
      renderer.render(quadScene, quadCam);

      blurMat.uniforms.tDiffuse.value = brightRT.texture;
      blurMat.uniforms.uDir.value.set(1, 0);
      blurMat.uniforms.uRadius.value = 1.4;
      renderer.setRenderTarget(blurA);
      quad.material = blurMat;
      renderer.render(quadScene, quadCam);

      blurMat.uniforms.tDiffuse.value = blurA.texture;
      blurMat.uniforms.uDir.value.set(0, 1);
      blurMat.uniforms.uRadius.value = 1.4;
      renderer.setRenderTarget(blurB);
      quad.material = blurMat;
      renderer.render(quadScene, quadCam);

      blurMat.uniforms.tDiffuse.value = blurB.texture;
      blurMat.uniforms.uDir.value.set(1, 0);
      blurMat.uniforms.uRadius.value = 2.6;
      renderer.setRenderTarget(blurA);
      quad.material = blurMat;
      renderer.render(quadScene, quadCam);

      blurMat.uniforms.tDiffuse.value = blurA.texture;
      blurMat.uniforms.uDir.value.set(0, 1);
      blurMat.uniforms.uRadius.value = 2.6;
      renderer.setRenderTarget(blurB);
      quad.material = blurMat;
      renderer.render(quadScene, quadCam);

      compositeMat.uniforms.tBloom.value = blurB.texture;
    } else {
      compositeMat.uniforms.tBloom.value = brightRT.texture;
    }

    compositeMat.uniforms.tDiffuse.value = colorTex;
    compositeMat.uniforms.uTime.value = ctx.realTime || 0;
    compositeMat.uniforms.uFade.value = clamp(ctx.fade || 0);
    renderer.setRenderTarget(null);
    quad.material = compositeMat;
    renderer.render(quadScene, quadCam);
    ctx.fade = 0;
    // report the scene pass, not the fullscreen quads
    const i2 = renderer.info.render;
    i2.calls = sceneStats.calls;
    i2.triangles = sceneStats.triangles;
    i2.points = sceneStats.points;
    i2.lines = sceneStats.lines;
  }

  function setQuality(level) {
    quality.level = level;
    setSize(size.x, size.y);
  }

  return {
    render, setSize, setQuality,
    set enabled(v) { enabled = !!v; },
    get enabled() { return enabled; },
    uniforms: compositeMat.uniforms,
    quality,
  };
}
