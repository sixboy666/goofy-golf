// ============================================================
// gameplay.js — drag-to-shoot controls, fixed-step simulation,
// aim preview dots, event feedback and hole-out flow.
// ============================================================

import * as THREE from 'three';
import { PhysicsWorld, BALL_R } from './physics.js';
import { World } from './world.js';
import { CamRig } from './camera.js';
import { Save } from './storage.js';
import { Sound, vibrate } from './audio.js';

const MAX_POWER = 11.5;     // release speed at full drag
const DRAG_SCALE = 0.95;     // world units of drag for full power
const MIN_SHOT  = 1.0;       // minimum release speed
const FIXED_DT  = 1/60;
const DOTS_MAX  = 26;

export class Game{
  constructor({renderer, scene, camera, canvas, lowq=false}, hooks={}){
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
    this.hooks = hooks;

    this.world = new World(scene, lowq);
    this.phys = new PhysicsWorld();
    this.rig = new CamRig(camera);

    this.paused = false;
    this.level = null;
    this.phase = 'aim';       // aim | rolling | celebrate
    this.strokes = 0;
    this.treasures = 0;
    this.levelTime = 0;
    this.settleT = 0;
    this.celebrateT = 0;
    this.acc = 0;

    this._aim = { active:false, drag:new THREE.Vector2(), power:0,
                  dir:new THREE.Vector3(1,0,0), hit:false };
    this._lastRest = new THREE.Vector3();
    this._ray = new THREE.Raycaster();
    this._plane = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
    this._hitPt = new THREE.Vector3();
    this._ballScreen = new THREE.Vector3();
    this._rollQ = new THREE.Quaternion();
    this._rollAxis = new THREE.Vector3();

    this._buildAimDots();
    this._bindInput();

    // cached DOM
    this.$ = id => document.getElementById(id);
  }

  // ----------------------------------------------------------
  // level lifecycle
  // ----------------------------------------------------------
  startLevel(level, skinId){
    this.level = level;
    this.phys.compile(level);

    // world.load() disposes the previous course and adds the new group
    this.world.load(level);
    this.world.buildBall(skinId ?? Save.getSkin());
    this.scene.add(this.world.ball);   // reparent ball to scene (both at identity)

    const tee = new THREE.Vector3(level.tee[0], BALL_R, level.tee[1]);
    this.state = this.phys.resetState(tee);
    this._lastRest.copy(tee);

    this.strokes = 0;
    this.treasures = 0;
    this.levelTime = 0;
    this.settleT = 0;
    this.acc = 0;
    this.phase = 'aim';

    this._syncCup(0);
    this.rig.frameLevel(this.world.bounds, level.tee,
      level.hole.pos || level.hole.move.points[0]);
    // let the host re-fit light shadow frustums tightly around this course
    this.hooks.onLevelStart && this.hooks.onLevelStart(this.world.bounds);

    this.$('hud-level').textContent = level.name;
    this.$('hud-strokes').textContent = '0';
    this.$('hud-par').textContent = String(level.par);
    this.$('hud-collect').textContent = '0/3';
    this.$('hud-collect-chip').classList.remove('done');
    this.$('hud-hint').textContent = level.hint || 'Drag the ball back, then release!';
    this._hidePower();
    this.dots.visible = false;
  }

  resetLevel(){
    if(!this.level) return;
    Sound.tap();
    this.startLevel(this.level, Save.getSkin());
  }

  setPaused(p){
    this.paused = p;
    if(p && this._aim.active) this._cancelAim();
  }

  destroy(){
    if(this.world){
      this.scene.remove(this.world.group);
      this.scene.remove(this.world.ball);
      this.world.dispose();
    }
  }

  // ----------------------------------------------------------
  // aim preview dots
  // ----------------------------------------------------------
  _buildAimDots(){
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(DOTS_MAX*3);
    geo.setAttribute('position', new THREE.BufferAttribute(arr,3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff, size: 0.115, transparent:true, opacity:0.92,
      depthWrite:false, sizeAttenuation:true,
      map: dotTexture(), alphaTest:0.02
    });
    this.dots = new THREE.Points(geo, mat);
    this.dots.visible = false;
    this.dots.frustumCulled = false;
    this.scene.add(this.dots);
  }

  _showDots(points){
    const attr = this.dots.geometry.attributes.position;
    const n = Math.min(points.length, DOTS_MAX);
    for(let i=0;i<n;i++){
      attr.setXYZ(i, points[i].x, points[i].y+0.015, points[i].z);
    }
    attr.needsUpdate = true;
    this.dots.geometry.setDrawRange(0,n);
    this.dots.visible = true;
  }

  // ----------------------------------------------------------
  // input
  // ----------------------------------------------------------
  _bindInput(){
    this.canvas.style.touchAction = 'none';
    const down = e => this._onDown(e);
    const move = e => this._onMove(e);
    const up   = e => this._onUp(e);
    this._unbind = () => {
      this.canvas.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    this.canvas.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  _ballScreenPos(){
    this._ballScreen.copy(this.state.pos).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (this._ballScreen.x*0.5+0.5)*rect.width,
      y: (-this._ballScreen.y*0.5+0.5)*rect.height
    };
  }

  _onDown(e){
    if(this.paused || this.phase!=='aim' || !this.state) return;
    const b = this._ballScreenPos();
    const dx=e.clientX-(this.canvas.getBoundingClientRect().left+b.x);
    const dy=e.clientY-(this.canvas.getBoundingClientRect().top+b.y);
    if(Math.hypot(dx,dy) > 84) return;   // must grab near the ball
    this._aim.active = true;
    this._aim.hit = true;
    Sound.tap();
  }

  _groundPoint(clientX, clientY){
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX-rect.left)/rect.width)*2-1,
      -((clientY-rect.top)/rect.height)*2+1);
    this._ray.setFromCamera(ndc, this.camera);
    this._plane.constant = -this.state.pos.y;
    return this._ray.ray.intersectPlane(this._plane, this._hitPt) ? this._hitPt : null;
  }

  _onMove(e){
    if(!this._aim.active) return;
    const pt = this._groundPoint(e.clientX, e.clientY);
    if(!pt) return;
    // drag = where the finger is relative to the ball
    const ddx = pt.x - this.state.pos.x;
    const ddz = pt.z - this.state.pos.z;
    const dist = Math.hypot(ddx,ddz);
    const t = Math.min(1, dist/DRAG_SCALE);
    this._aim.power = MIN_SHOT + (MAX_POWER-MIN_SHOT)*t;
    this._aim.drag.set(ddx,ddz);
    if(dist > 0.02){
      // the shot flies opposite to the drag
      this._aim.dir.set(-ddx/dist, 0, -ddz/dist);
    }
    this._updateAimVisuals(t);
  }

  _updateAimVisuals(t){
    // power bar
    const wrap = this.$('power-wrap');
    wrap.classList.add('show');
    this.$('power-fill').style.width = (t*100).toFixed(1)+'%';

    if(Save.getSettings().aim){
      const vel = this._aim.dir.clone().multiplyScalar(this._aim.power);
      const pts = this.phys.predict(this.level, this.state.pos, vel, DOTS_MAX);
      if(pts.length > 1) this._showDots(pts); else this.dots.visible=false;
    }
  }

  _hidePower(){
    this.$('power-wrap').classList.remove('show');
    this.$('power-fill').style.width = '0%';
    this.dots.visible = false;
  }

  _cancelAim(){
    this._aim.active=false;
    this._aim.power=0;
    this._hidePower();
  }

  _onUp(){
    if(!this._aim.active) return;
    this._aim.active = false;
    const power = this._aim.power;

    if(power < MIN_SHOT+0.35){
      this._cancelAim();
      return;
    }

    // ---- strike ----
    this.strokes++;
    this.$('hud-strokes').textContent = String(this.strokes);
    this.state.vel.copy(this._aim.dir).multiplyScalar(power);

    Sound.putt(power/MAX_POWER);
    vibrate(14);
    this.world.pulseStatue();

    this.phase = 'rolling';
    this.settleT = 0;
    this.rig.setFollow();
    this._hidePower();
  }

  // ----------------------------------------------------------
  // per-frame update
  // ----------------------------------------------------------
  update(rawDt){
    if(this.paused || !this.state) return;
    const dt = Math.min(rawDt, 0.05);
    this.levelTime += dt;

    if(this.phase==='aim'){
      // mechanisms still animate (moving cup / gate timing!) but ball stays put
      this.state.events.length = 0;
      this.phys.updateGates(this.levelTime);
      this._syncMechanismsVisual();
      this._syncCup(this.levelTime);
    }
    else if(this.phase==='rolling'){
      // fixed-step simulation
      this.acc += dt;
      let steps=0;
      while(this.acc >= FIXED_DT && steps<4){
        this.phys.step(this.state, FIXED_DT, this.levelTime);
        this._handleEvents(this.state.events);
        this.acc -= FIXED_DT;
        steps++;
        if(this.phase!=='rolling') break;
      }
      if(steps===0){
        // keep gate visuals fresh between physics steps
        this.phys.updateGates(this.levelTime);
      }
      this._syncMechanismsVisual();
      this._syncCup(this.levelTime);
      this._syncBallMesh(dt);
      this._checkRest(dt);
      this._checkOutOfBounds();
    }
    else if(this.phase==='celebrate'){
      this.celebrateT += dt;
      this._syncMechanismsVisual();
      this._syncCup(this.levelTime);
      // little sink wobble of the ball already handled by snap; keep mesh low
      this._syncBallMesh(dt);
    }

    this.world.update(dt, this.levelTime);
    const cup = this.phys.cupPosition(this.levelTime, new THREE.Vector3());
    this.rig.update(dt, this.state.pos, this.state.vel, cup);
  }

  _checkRest(dt){
    const sp = this.state.vel.lengthSq();
    const still = sp < 1e-6;
    if(still && this.state.grounded){
      this.settleT += dt;
      if(this.settleT > 0.45){
        this.phase = 'aim';
        this._lastRest.copy(this.state.pos);
        this.rig.setOverview();
        this.settleT = 0;
      }
    }else{
      this.settleT = 0;
    }
  }

  _checkOutOfBounds(){
    if(this.state.pos.y < -5){
      Sound.silly();
      vibrate([30,40,30]);
      this.state.pos.copy(this._lastRest);
      this.state.vel.set(0,0,0);
      this.state.loop = null;
      this.phase = 'aim';
      this.rig.setOverview();
    }
  }

  // ----------------------------------------------------------
  // event -> sound / visual feedback
  // ----------------------------------------------------------
  _handleEvents(events){
    for(const ev of events){
      switch(ev.type){
        case 'wall':
          Sound.wall(ev.strength);
          vibrate(6 + ev.strength*10);
          break;
        case 'gate':
          Sound.wall((ev.strength??0.5)*0.8);
          vibrate(8);
          break;
        case 'spring':
          Sound.boing();
          this.world.fireSpring(ev.index);
          vibrate(18);
          break;
        case 'bounce':
          if((ev.strength??0) > 0.3) Sound.pop(); else Sound.wall(0.3);
          vibrate(10);
          break;
        case 'bumper':
          Sound.pop();
          this.world.popBumper(ev.index);
          vibrate(14);
          break;
        case 'pipe':
          Sound.pipe();
          vibrate(12);
          break;
        case 'collect':
          Sound.collect();
          this.world.takeCollect(ev.index);
          this.treasures++;
          this.$('hud-collect').textContent = `${Math.min(3,this.treasures)}/3`;
          if(this.treasures>=3) this.$('hud-collect-chip').classList.add('done');
          vibrate(16);
          break;
        case 'rim':
          Sound.wall(0.85);
          Sound.silly();
          vibrate(20);
          break;
        case 'loopDone':
          Sound.boing();
          vibrate([12,30,12]);
          break;
        case 'loopFail':
          Sound.silly();
          vibrate([20,40,20]);
          break;
        case 'drain':
          this._onDrain();
          break;
      }
    }
  }

  _onDrain(){
    Sound.drain();
    vibrate(24);
    this.phase = 'celebrate';
    this.celebrateT = 0;
    this.rig.setFocus();

    const got = Math.min(3,this.treasures);
    setTimeout(()=>{
      const stars = starsForStrokes(this.strokes, this.level.par);
      const res = Save.recordResult(this.level.id, this.strokes, stars, got);
      if(this.strokes===1) Sound.holeInOne();
      else Sound.fanfare(stars);
      this.hooks.onFinish && this.hooks.onFinish({
        strokes:this.strokes, par:this.level.par, stars,
        treasures:got, ...res
      });
    }, 1250);
  }

  // ----------------------------------------------------------
  // visual sync
  // ----------------------------------------------------------
  _syncBallMesh(dt){
    const g = this.world.ball;
    g.position.copy(this.state.pos);

    const speed = this.state.vel.length();
    if(speed > 0.02 && !this.state.loop){
      // rolling rotation: axis = up x velocity
      this._rollAxis.set(this.state.vel.z, 0, -this.state.vel.x).normalize();
      const ang = speed*dt/BALL_R;
      this._rollQ.setFromAxisAngle(this._rollAxis, ang);
      this.world.ballMesh.quaternion.premultiply(this._rollQ);
    }

    if(this.phase==='aim'){
      // gentle idle bob so the ball feels alive / grabbable
      const b = 1 + Math.sin(this.levelTime*3.1)*0.012;
      g.scale.setScalar(b);
    }else{
      g.scale.setScalar(1);
    }
  }

  _syncMechanismsVisual(){
    for(let i=0;i<this.phys.gates.length;i++){
      this.world.syncGate(i, this.phys.gates[i].q);
    }
  }

  _syncCup(time){
    if(!this.level.hole.move) return;
    const p = this.phys.cupPosition(time, new THREE.Vector3());
    this.world.cupGroup.position.set(p.x, p.y, p.z);
  }
}

// ----------------------------------------------------------
// star rating (mirrors levels.js; kept local to avoid cycles)
// ----------------------------------------------------------
function starsForStrokes(strokes, par){
  if(strokes <= par-1) return 3;
  if(strokes <= par) return 2;
  return 1;
}

// soft round sprite for the prediction dots
let _dotTex = null;
function dotTexture(){
  if(_dotTex) return _dotTex;
  const c = document.createElement('canvas');
  c.width=c.height=64;
  const ctx=c.getContext('2d');
  const g=ctx.createRadialGradient(32,32,2,32,32,30);
  g.addColorStop(0,'rgba(255,255,255,1)');
  g.addColorStop(0.7,'rgba(255,255,255,0.9)');
  g.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=g;
  ctx.beginPath(); ctx.arc(32,32,30,0,Math.PI*2); ctx.fill();
  _dotTex = new THREE.CanvasTexture(c);
  return _dotTex;
}
