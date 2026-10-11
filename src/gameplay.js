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
const MIN_SHOT  = 1.0;       // minimum release speed
const FIXED_DT  = 1/60;
const DOTS_MAX  = 26;

// scratch vector reused every frame (no per-frame allocation)
const _cupTmp = new THREE.Vector3();
const _velTmp = new THREE.Vector3();   // aim velocity scratch

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

    this._aim = { active:false, pid:null, drag:new THREE.Vector2(), power:0,
                  dir:new THREE.Vector3(1,0,0), hit:false,
                  sx:0, sy:0, gx:0, gz:0 };
    this._drainTimer = null;      // pending hole-out result callback
    this._lastPredict = 0;        // throttle aim prediction to ~40Hz
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
    // cancel any pending hole-out callback from the previous attempt
    if(this._drainTimer){ clearTimeout(this._drainTimer); this._drainTimer = null; }
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
    this._groundY = 0;
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
    this.$('hud-hint').textContent = level.hint || 'Drag anywhere, release to shoot!';
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

  // re-fit the overview camera after a viewport size/orientation change
  reframe(){
    if(!this.level || this.rig.mode!=='overview') return;
    this.rig.frameLevel(this.world.bounds, this.level.tee,
      this.level.hole.pos || this.level.hole.move.points[0]);
  }

  // stop everything pending — used when leaving to menus mid-level
  abortLevel(){
    if(this._drainTimer){ clearTimeout(this._drainTimer); this._drainTimer = null; }
    this._cancelAim();
  }

  destroy(){
    this.abortLevel();
    if(this._unbind) this._unbind();
    this.scene.remove(this.dots);
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
      color: 0xffffff, size: 0.15, transparent:true, opacity:0.95,
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
      attr.setXYZ(i, points[i].x, points[i].y+0.06, points[i].z);
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
    if(this._aim.active) return;                          // already dragging
    if(e.button !== undefined && e.button > 0) return;   // left button / touch only
    e.preventDefault();
    const pt = this._groundPoint(e.clientX, e.clientY);
    if(!pt) return;
    // drag ANYWHERE: press-and-pull like a slingshot, no need to touch the ball.
    // This keeps the control usable on small phone screens and with a mouse.
    try{ this.canvas.setPointerCapture(e.pointerId); }catch(_){}
    this._aim.active = true;
    this._aim.hit = true;
    this._aim.pid = e.pointerId;
    this._aim.sx = e.clientX; this._aim.sy = e.clientY;  // pixel origin (power)
    this._aim.gx = pt.x;    this._aim.gz = pt.z;         // world origin (direction)
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
    if(!this._aim.active || e.pointerId !== this._aim.pid) return;
    const pt = this._groundPoint(e.clientX, e.clientY);
    if(!pt) return;
    // direction = opposite of the pull, in world space
    const ddx = pt.x - this._aim.gx;
    const ddz = pt.z - this._aim.gz;
    const distW = Math.hypot(ddx,ddz);
    // power = pixel drag distance, so the feel is identical at any
    // screen size, zoom level, mouse or finger
    const rect = this.canvas.getBoundingClientRect();
    const maxPx = Math.min(rect.width, rect.height)*0.32;
    const px = Math.hypot(e.clientX-this._aim.sx, e.clientY-this._aim.sy);
    const t = Math.min(1, px/maxPx);
    this._aim.power = MIN_SHOT + (MAX_POWER-MIN_SHOT)*t;
    this._aim.drag.set(ddx,ddz);
    if(distW > 0.02){
      this._aim.dir.set(-ddx/distW, 0, -ddz/distW);
    }else if(px > 6){
      // fallback: use pixel delta (screen up ≈ world -z for this camera)
      const pdx = e.clientX-this._aim.sx, pdy = e.clientY-this._aim.sy;
      const pl = Math.hypot(pdx,pdy);
      this._aim.dir.set(-pdx/pl, 0, -pdy/pl);
    }
    this._updateAimVisuals(t);
  }

  _updateAimVisuals(t){
    // power bar
    const wrap = this.$('power-wrap');
    wrap.classList.add('show');
    this.$('power-fill').style.width = (t*100).toFixed(1)+'%';

    if(Save.getSettings().aim){
      // pointermove can fire at 120Hz — throttle the (expensive) prediction
      const now = performance.now();
      if(now - this._lastPredict < 25 && this.dots.visible) return;
      this._lastPredict = now;
      const vel = _velTmp.copy(this._aim.dir).multiplyScalar(this._aim.power);
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

  _onUp(e){
    if(!this._aim.active) return;
    if(e && e.pointerId !== undefined && e.pointerId !== this._aim.pid) return;
    this._aim.active = false;
    this._aim.pid = null;
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
    this.world.pulseStatue(this.levelTime);

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
      // gentle pulse so the aim dots read as alive
      if(this.dots.visible)
        this.dots.material.size = 0.15 + Math.sin(this.levelTime*9)*0.02;
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
    const cup = this.phys.cupPosition(this.levelTime, _cupTmp);
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
    // tracked so a restart / exit during the celebrate window cancels it
    this._drainTimer = setTimeout(()=>{
      this._drainTimer = null;
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

    // blob shadow tracks the ball's ground position
    const sh = this.world.ballShadow;
    if(sh){
      if(this.state.grounded) this._groundY = this.state.pos.y - BALL_R;
      const h = Math.max(0, this.state.pos.y - BALL_R - this._groundY);
      const k = Math.max(0.3, 1 - h*0.22);       // fades/shrinks with height
      sh.visible = this.phase !== 'celebrate';
      // +0.045 keeps the blob above the visual carpet/cap surfaces
      // (carpet top ~+0.015, platform cap ~+0.03) so it never z-fights
      sh.position.set(this.state.pos.x, this._groundY + 0.045, this.state.pos.z);
      sh.scale.setScalar(k);
      sh.material.opacity = 0.5*k;
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
    const p = this.phys.cupPosition(time, _cupTmp);
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
  // dark outline ring — keeps the dot readable on light carpets
  ctx.beginPath(); ctx.arc(32,32,26,0,Math.PI*2);
  ctx.fillStyle='rgba(35,26,18,0.9)'; ctx.fill();
  // vivid orange body — pops against every ground theme
  ctx.beginPath(); ctx.arc(32,32,21,0,Math.PI*2);
  ctx.fillStyle='#ff7a1a'; ctx.fill();
  // hot white core
  const g=ctx.createRadialGradient(32,32,2,32,32,11);
  g.addColorStop(0,'rgba(255,255,255,0.95)');
  g.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=g;
  ctx.beginPath(); ctx.arc(32,32,11,0,Math.PI*2); ctx.fill();
  _dotTex = new THREE.CanvasTexture(c);
  return _dotTex;
}
