import * as THREE from 'three';
import { clamp, lerp, smoothstep, TAU, damp } from '../lib/core.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = new THREE.Vector3(0, 1, 0);

export function createRig(pelican, bicycle) {
  const group = new THREE.Group();
  group.name = 'rig';
  group.add(bicycle.group);
  group.add(pelican.group);

  // seat the pelican on the saddle: its root sits at the saddle top, not on the ground
  const saddleTop = new THREE.Vector3(
    bicycle.geo.seatTop.x + 0.055,
    bicycle.geo.seatTop.y + 0.152,
    0,
  );
  pelican.group.position.copy(saddleTop);
  pelican.group.rotation.y = 0;
  pelican.group.scale.setScalar(1.18);
  pelican.group.updateMatrixWorld(true);

  const state = {
    t: 0,
    speed: 0,
    targetSpeed: 1.0,
    pedalPhase: 0,
    wheelSpin: 0,
    lean: 0,
    steer: 0,
    bounce: 0,
    crab: 0,
    distance: 0,
    x: 0,
    z: 8.5,
    heading: -Math.PI / 2,
    wheelbase: bicycle.RB * 2,
    wheelRadius: bicycle.contact.radius,
  };

  const wheelFLocal = V(0, 0, 0);
  const wheelRLocal = V(-state.wheelbase, 0, 0);
  const roadCentreX = 0;

  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
  const _q = new THREE.Quaternion(), _e = new THREE.Euler();
  const _m = new THREE.Matrix4();

  const crankAxis = 0;
  function pedalCadence(speed) {
    const gearRatio = 48 / 16;
    const wheelCirc = TAU * state.wheelRadius;
    const wheelRps = speed / wheelCirc;
    const crankRps = wheelRps / gearRatio * 1.7;
    return crankRps;
  }

  function update(t, dt, ctx) {
    state.t = t;
    const s = ctx || {};
    state.targetSpeed = s.speedTarget != null ? s.speedTarget : state.targetSpeed;
    const noise = Math.sin(t * 0.7) * 0.05 + Math.sin(t * 1.9 + 1.1) * 0.03;
    const wobble = Math.sin(t * 0.31) * 0.06;
    const target = state.targetSpeed * (1 + noise * 0.12) + wobble * 0.08;
    state.speed = damp(state.speed, Math.max(0, target), 3.2, dt);

    const cadence = pedalCadence(state.speed);
    state.pedalPhase = (state.pedalPhase + cadence * dt) % 1;
    state.wheelSpin = (state.wheelSpin + (state.speed / (TAU * state.wheelRadius)) * dt) % 1;

    const leanAmt = s.lean != null ? s.lean : 0.35;
    const leanTarget = (Math.sin(t * 0.23) * 0.5 + Math.sin(t * 0.61 + 2.0) * 0.24) * leanAmt;
    state.lean = damp(state.lean, leanTarget, 1.6, dt);
    const steerTarget = (Math.sin(t * 0.19 + 0.7) * 0.5 + Math.sin(t * 0.47) * 0.3) * (s.steerAmt != null ? s.steerAmt : 0.5);
    state.steer = damp(state.steer, steerTarget, 1.5, dt);

    const bounceNoise = Math.sin(t * 3.1 * clamp(state.speed, 0.3, 1.6)) * 0.006 + Math.sin(t * 7.3) * 0.0035;
    state.bounce = damp(state.bounce, bounceNoise * (0.6 + state.speed * 0.6), 6, dt);
    state.crab = Math.sin(t * 0.13) * 0.6;

    // drive the rig along the road (the camera reads rig.group's world position)
    state.distance += state.speed * dt;
    state.x = roadCentreX + state.distance;
    const roadY = ctx && ctx.roadHeight ? ctx.roadHeight(state.x, state.z) : 0;
    const slope = ctx && ctx.roadSlope ? ctx.roadSlope(state.x, state.z) : 0;

    group.rotation.order = 'YXZ';
    group.rotation.y = state.crab * 0.05;
    group.rotation.x = -slope;
    group.rotation.z = state.lean * 0.5;
    group.position.set(state.x, roadY + 0.02 + state.bounce, state.z);
    group.updateMatrixWorld(true);

    const wheelOut = bicycle.update(t, dt, {
      speed: state.speed,
      pedalPhase: state.pedalPhase,
      wheelSpin: state.wheelSpin,
      steer: state.steer,
      bounce: 0,
      tilt: 0,
      headingFix: 0,
    });
    group.updateMatrixWorld(true);

    // everything the pelican needs is in WORLD space; the pelican converts to its own frame.
    const gripLWorld = wheelOut.gripLeft.clone();
    const gripRWorld = wheelOut.gripRight.clone();
    const pedalTargets = {
      left: wheelOut.pedalTargets.left.clone().applyMatrix4(bicycle.group.matrixWorld),
      right: wheelOut.pedalTargets.right.clone().applyMatrix4(bicycle.group.matrixWorld),
    };

    pelican.update(t, dt, {
      speed: state.speed,
      pedalPhase: state.pedalPhase,
      pedalTargets,
      gripLeft: gripLWorld,
      gripRight: gripRWorld,
      bodyLift: 0.02 + Math.sin(t * 0.9) * 0.006,
      bodyPitch: state.lean * -0.12 + Math.sin(t * 0.6) * 0.02,
      bodyRoll: state.lean * 0.16,
      bodyYaw: Math.sin(t * 0.22) * 0.06,
      neckCurl: 0.52 + Math.sin(t * 0.27) * 0.1,
      neckPitch: -0.04 + Math.sin(t * 0.4) * 0.03,
      neckYaw: Math.sin(t * 0.18) * 0.1,
      headPitch: 0.06 + Math.sin(t * 0.35) * 0.05,
      headYaw: Math.sin(t * 0.24 + 1) * 0.12,
      jawOpen: ctx && ctx.jawOpen != null ? ctx.jawOpen : 0,
      crestLift: Math.sin(t * 1.4) * 0.2 + 0.2,
      tailLift: 0.1 + Math.sin(t * 0.8) * 0.08,
      pouch: ctx && ctx.pouch != null ? ctx.pouch : 0.15,
      flap: ctx && ctx.flap != null ? ctx.flap : 0,
      wingFold: ctx && ctx.wingFold != null ? ctx.wingFold : 1,
      footLift: 0,
    });

    group.updateMatrixWorld(true);
    return state;
  }

  function worldContact() {
    const front = V(bicycle.contact.front.x, bicycle.contact.front.y, 0).applyMatrix4(bicycle.group.matrixWorld);
    const rear = V(bicycle.contact.rear.x, bicycle.contact.rear.y, 0).applyMatrix4(bicycle.group.matrixWorld);
    return { front, rear };
  }

  return { group, state, update, worldContact, wheels: bicycle.wheels };
}
