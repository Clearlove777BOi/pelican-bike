import * as THREE from 'three';
import { clamp, lerp, smoothstep, TAU, rng } from '../lib/core.js';

export function createAudio() {
  let ac = null;
  let master = null;
  let started = false;
  let volume = 0.55;
  let muted = false;
  const nodes = {};

  const state = {
    ready: false,
    windGain: 0,
    chainGain: 0,
    creakGain: 0,
    surfGain: 0,
    gullGain: 0,
    bellGain: 0,
  };

  function noiseBuffer(seconds = 4) {
    const len = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(2, len, ac.sampleRate);
    const r = rng('audio-noise');
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = r() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
    return buf;
  }

  function loopSource(buffer, gain, rate = 1) {
    const src = ac.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.playbackRate.value = rate;
    const g = ac.createGain();
    g.gain.value = 0;
    src.connect(g);
    src.start();
    return { src, g };
  }

  function init() {
    if (started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC({ latencyHint: 'playback' });
    master = ac.createGain();
    master.gain.value = muted ? 0 : volume;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.02;
    comp.release.value = 0.35;
    master.connect(comp);
    comp.connect(ac.destination);
    nodes.master = master;
    nodes.comp = comp;

    const noise = noiseBuffer(5);

    const windFilter = ac.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 620;
    windFilter.Q.value = 0.6;
    const wind = loopSource(noise, null);
    wind.g.connect(windFilter);
    windFilter.connect(master);
    nodes.wind = { ...wind, filter: windFilter };

    const chainNoise = loopSource(noise, null, 1.4);
    const chainFilter = ac.createBiquadFilter();
    chainFilter.type = 'bandpass';
    chainFilter.frequency.value = 2400;
    chainFilter.Q.value = 2.4;
    const chainG = ac.createGain();
    chainG.gain.value = 0;
    chainNoise.g.connect(chainFilter);
    chainFilter.connect(chainG);
    chainG.connect(master);
    nodes.chain = { ...chainNoise, filter: chainFilter, out: chainG };

    const creakOsc = ac.createOscillator();
    creakOsc.type = 'sawtooth';
    creakOsc.frequency.value = 84;
    const creakFilter = ac.createBiquadFilter();
    creakFilter.type = 'bandpass';
    creakFilter.frequency.value = 340;
    creakFilter.Q.value = 6;
    const creakG = ac.createGain();
    creakG.gain.value = 0;
    creakOsc.connect(creakFilter);
    creakFilter.connect(creakG);
    creakG.connect(master);
    creakOsc.start();
    nodes.creak = { osc: creakOsc, filter: creakFilter, out: creakG };

    const surf = loopSource(noise, null, 0.6);
    const surfFilter = ac.createBiquadFilter();
    surfFilter.type = 'lowpass';
    surfFilter.frequency.value = 900;
    const surfG = ac.createGain();
    surfG.gain.value = 0;
    surf.g.connect(surfFilter);
    surfFilter.connect(surfG);
    surfG.connect(master);
    nodes.surf = { ...surf, filter: surfFilter, out: surfG };

    state.ready = true;
    started = true;
  }

  function resume() {
    if (!ac) init();
    if (ac && ac.state === 'suspended') ac.resume();
  }

  function setVolume(v) {
    volume = clamp(v);
    if (master) master.gain.setTargetAtTime(muted ? 0 : volume, ac.currentTime, 0.03);
  }

  function setMuted(m) {
    muted = !!m;
    if (master) master.gain.setTargetAtTime(muted ? 0 : volume, ac.currentTime, 0.03);
  }

  function update(dt, ctx) {
    if (!state.ready || !ac) return;
    const c = ac.currentTime;
    const s = ctx || {};
    const speed = clamp((s.speed || 0) / 1.2, 0, 2);
    const wind = clamp((s.wind != null ? s.wind : 1), 0, 2);

    const windTarget = (0.028 + speed * 0.052) * wind;
    state.windGain = windTarget;
    nodes.wind.g.gain.setTargetAtTime(windTarget, c, 0.4);
    nodes.wind.filter.frequency.setTargetAtTime(320 + speed * 680 + wind * 160, c, 0.5);

    const chainTarget = speed > 0.04 ? 0.006 + speed * 0.02 : 0;
    state.chainGain = chainTarget;
    nodes.chain.out.gain.setTargetAtTime(chainTarget, c, 0.18);
    nodes.chain.src.playbackRate.setTargetAtTime(0.8 + speed * 1.5, c, 0.2);
    nodes.chain.filter.frequency.setTargetAtTime(1600 + speed * 1900, c, 0.25);

    const creakTarget = (0.004 + speed * 0.014) * (0.5 + 0.5 * Math.sin(c * 1.7));
    state.creakGain = creakTarget;
    nodes.creak.out.gain.setTargetAtTime(Math.abs(creakTarget), c, 0.5);
    nodes.creak.osc.frequency.setTargetAtTime(64 + speed * 46, c, 0.6);
    nodes.creak.filter.frequency.setTargetAtTime(240 + speed * 320, c, 0.6);

    const surfTarget = 0.02 + wind * 0.026;
    state.surfGain = surfTarget;
    nodes.surf.out.gain.setTargetAtTime(surfTarget, c, 0.8);
    nodes.surf.filter.frequency.setTargetAtTime(620 + wind * 420, c, 0.8);
  }

  function chime() {
    if (!state.ready || !ac) return;
    const c = ac.currentTime;
    const partials = [[1660, 0.5, 0.5], [2490, 0.3, 0.38], [3320, 0.18, 0.3], [4850, 0.09, 0.22]];
    for (const [f, a, dec] of partials) {
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ac.createGain();
      g.gain.setValueAtTime(0, c);
      g.gain.linearRampToValueAtTime(a * 0.16, c + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, c + dec * 3.2);
      o.connect(g);
      g.connect(master);
      o.start(c);
      o.stop(c + dec * 3.4);
    }
    const n = ac.createBufferSource();
    n.buffer = noiseBuffer(0.3);
    const f = ac.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 4200;
    f.Q.value = 1.2;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.05, c);
    g.gain.exponentialRampToValueAtTime(0.0001, c + 0.16);
    n.connect(f);
    f.connect(g);
    g.connect(master);
    n.start(c);
    n.stop(c + 0.3);
  }

  function gullCry() {
    if (!state.ready || !ac) return;
    const c = ac.currentTime;
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    const base = 620 + Math.random() * 260;
    o.frequency.setValueAtTime(base, c);
    o.frequency.exponentialRampToValueAtTime(base * 1.9, c + 0.09);
    o.frequency.exponentialRampToValueAtTime(base * 0.78, c + 0.3);
    const f = ac.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1500;
    f.Q.value = 3.2;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, c);
    g.gain.linearRampToValueAtTime(0.05, c + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, c + 0.42);
    o.connect(f);
    f.connect(g);
    g.connect(master);
    o.start(c);
    o.stop(c + 0.45);
  }

  return { init, resume, setVolume, setMuted, update, chime, gullCry, state, get volume() { return volume; }, get muted() { return muted; } };
}
