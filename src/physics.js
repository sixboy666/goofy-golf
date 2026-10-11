// ============================================================
// physics.js — custom mini-golf ball physics
// Rolling, slopes, friction, bounces, rotating gates,
// spring pads, cushions, teleport pipes, loop tracks,
// moving cup with speed-based capture.
// ============================================================

import * as THREE from 'three';

export const BALL_R = 0.14;
const G = 11.5;                 // tuned gravity (slightly snappier than real)
const AIR_DRAG = 0.06;
const ROLL_FRICTION = 0.21;     // carpet friction mu
const REST_SPEED = 0.30;

const UP = new THREE.Vector3(0,1,0);

// ---------- collider factories ----------
function aabb(center, size, kind='wall', extra={}){
  return { type:'aabb',
    min: new THREE.Vector3(center[0]-size[0]/2, center[1]-size[1]/2, center[2]-size[2]/2),
    max: new THREE.Vector3(center[0]+size[0]/2, center[1]+size[1]/2, center[2]+size[2]/2),
    kind, e: 0.55, ...extra };
}

function obb(center, size, rot=[0,0,0], kind='ground', extra={}){
  const e = new THREE.Euler(rot[0],rot[1],rot[2],'YXZ');
  const q = new THREE.Quaternion().setFromEuler(e);
  return { type:'obb',
    center: new THREE.Vector3(...center),
    half: new THREE.Vector3(size[0]/2,size[1]/2,size[2]/2),
    q, inv: q.clone().invert(),
    kind, e: 0.55, ...extra };
}

// ============================================================
export class PhysicsWorld{

  compile(level){
    this.level = level;
    this.statics = [];   // AABB / OBB
    this.gates = [];
    this.bumpers = [];
    this.springs = [];
    this.pipes = [];
    this.loops = [];
    this.collects = level.collect ? level.collect.map(c=>({
      p:new THREE.Vector3(c[0],c[1] ?? 0.5, c[2]), taken:false
    })) : [];

    // ---- floors (base slabs) ----
    const floors = level.floors || [{p:[0,0], s: level.base}];
    for(const f of floors){
      const [w,d] = f.s;
      this.statics.push(aabb([f.p[0],-0.3,f.p[1]],[w,0.6,d],'ground',{fric:0.21}));

      // ---- automatic perimeter walls ----
      if(level.autoWalls !== false){
        const wh = 0.45, wt = 0.24, y = wh/2;
        this.statics.push(aabb([f.p[0],y,f.p[1]-d/2],[w+wt,wh,wt],'wall',{e:0.5}));
        this.statics.push(aabb([f.p[0],y,f.p[1]+d/2],[w+wt,wh,wt],'wall',{e:0.5}));
        this.statics.push(aabb([f.p[0]-w/2,y,f.p[1]],[wt,wh,d],'wall',{e:0.5}));
        this.statics.push(aabb([f.p[0]+w/2,y,f.p[1]],[wt,wh,d],'wall',{e:0.5}));
      }
    }

    // ---- platforms ----
    for(const pl of level.platforms || []){
      this.statics.push(aabb(pl.p, pl.s, 'ground',{fric:pl.fric ?? 0.2}));
    }

    // ---- walls ----
    for(const w of level.walls || []){
      this.statics.push(aabb(w.p, w.s, 'wall',{e:w.e ?? 0.55}));
    }

    // ---- ramps (wedge: thin OBB approximates the slope surface) ----
    for(const r of level.ramps || []){
      this.statics.push(obb(r.p, r.s, r.r || [0,0,0], 'ground',{fric:r.fric ?? 0.15}));
    }

    // ---- spring / bounce pads ----
    for(const pad of level.pads || []){
      const dir = new THREE.Vector3(...(pad.dir||[0,1,0])).normalize();
      const coll = pad.rot
        ? obb(pad.p, pad.s, pad.rot, pad.kind, {})
        : aabb(pad.p, pad.s, pad.kind, {});
      coll.launchDir = dir;
      coll.power = pad.power ?? 10;
      coll.index = this.springs.length;
      this.springs.push(coll);
      this.statics.push(coll);
    }

    // ---- rotating gates ----
    for(const g of level.gates || []){
      const half = new THREE.Vector3(g.length/2, g.height/2, g.thick/2);
      this.gates.push({
        axle: new THREE.Vector3(g.axle[0], g.baseY + g.height/2, g.axle[1]),
        half, speed: g.speed, phase: g.phase ?? 0,
        q: new THREE.Quaternion(),
        kind:'gate', e: 0.5
      });
    }

    // ---- cylindrical bumpers / cushions ----
    for(const b of level.bumpers || []){
      this.bumpers.push({
        c:new THREE.Vector3(b.p[0], b.h ?? 0.55, b.p[2]),
        r:b.r ?? 0.5, e:0.9, index:this.bumpers.length
      });
    }

    // ---- teleport pipes ----
    for(const p of level.pipes || []){
      const c = new THREE.Vector3(...p.ins);
      this.pipes.push({
        min:new THREE.Vector3(c.x-p.inSize[0]/2,c.y-p.inSize[1]/2,c.z-p.inSize[2]/2),
        max:new THREE.Vector3(c.x+p.inSize[0]/2,c.y+p.inSize[1]/2,c.z+p.inSize[2]/2),
        out:new THREE.Vector3(...p.out),
        dir:new THREE.Vector3(...p.outDir).normalize(),
        cd:0, index:this.pipes.length
      });
    }

    // ---- loop tracks ----
    for(const l of level.loops || []){
      const rho = l.radius;
      const axisVec = l.axis === 'x' ? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,0,1);
      const bottom = new THREE.Vector3(l.center[0], l.center[1], l.center[2]);
      this.loops.push({
        bottom,
        C: bottom.clone().addScaledVector(UP, rho),
        axisVec,
        halfWidth: (l.width ?? 1.5)/2,
        radius: rho,
        cd: 0
      });
    }

    // hole helper
    this.hole = level.hole;
  }

  // current cup position (supports moving cup)
  cupPosition(time, out){
    const h = this.hole;
    if(h.move){
      out.copy(this._movingPos(h, time));
    }else{
      out.set(h.pos[0], h.pos[1] ?? 0, h.pos[2]);
    }
    return out;
  }

  _movingPos(h, t){
    const m = h.move;
    const pts = m.points;
    const segT = m.period / pts.length;
    const cyc = (t % (m.period*2)) ;
    // ping-pong across the path
    const u = cyc < m.period ? cyc : (m.period*2 - cyc);
    const i = Math.min(pts.length-2, Math.floor(u/segT));
    const f = (u - i*segT)/segT;
    const a = pts[i], b = pts[i+1];
    this._v1 = this._v1 || new THREE.Vector3();
    return this._v1.set(
      a[0]+(b[0]-a[0])*f,
      (a[1]!==undefined?a[1]:0),
      a[2]+(b[2]-a[2])*f
    );
  }

  resetMechanisms(){
    for(const p of this.pipes) p.cd = 0;
    for(const l of this.loops) l.cd = 0;
    for(const c of this.collects) c.taken = false;
  }

  resetState(pos){
    return {
      pos: pos.clone(),
      vel: new THREE.Vector3(),
      grounded:false,
      groundN: UP.clone(),
      onGate:false,
      loop:null,
      loopCD:0,
      rimPrev: 99,
      events:[],
      time:0
    };
  }

  // ============================================================
  updateGates(time){
    for(const g of this.gates){
      const ang = g.phase + g.speed * time;
      g.q.setFromAxisAngle(UP, ang);
    }
  }

  step(state, dt, time){
    state.events.length = 0;
    state.time = time;
    const h = dt;

    // gate orientations
    this.updateGates(time);

    if(state.loop){
      this._stepLoop(state, h);
      return;
    }

    // ---- forces ----
    state.vel.y -= G*h;
    // air drag
    state.vel.multiplyScalar(1 - AIR_DRAG*h*(state.grounded?0:1));

    // ---- integrate ----
    state.pos.addScaledVector(state.vel, h);

    // ---- collisions ----
    state.grounded = false;
    state.onGate = false;
    for(let iter=0; iter<3; iter++){
      for(const c of this.statics){
        this._collideCollider(state, c);
      }
      for(const g of this.gates){
        this._collideGate(state, g);
      }
      for(const b of this.bumpers){
        this._collideBumper(state, b);
      }
    }

    // ---- rolling friction & rest ----
    if(state.grounded){
      const n = state.groundN;
      const vn = state.vel.dot(n);
      const tv = state.vel.clone().addScaledVector(n, -vn);
      const sp = tv.length();
      const mu = state.onGate ? 0.25 : ROLL_FRICTION;
      const decel = mu * G * h;
      if(sp > 0){
        const ns = Math.max(0, sp - decel);
        tv.multiplyScalar(ns/sp);
        state.vel.copy(tv).addScaledVector(n, vn);
      }
      // put to sleep on near-flat ground
      if(state.vel.length() < REST_SPEED && n.y > 0.9 && !state.onGate){
        state.vel.set(0,0,0);
      }
    }

    // ---- cooldowns ----
    if(state.loopCD>0) state.loopCD -= h;
    for(const p of this.pipes) if(p.cd>0) p.cd -= h;

    // ---- triggers ----
    this._checkLoops(state, h);
    this._checkPipes(state);
    this._checkCollects(state);
    this._checkHole(state);
  }

  // ---------- collider dispatch ----------
  _collideCollider(state, c){
    const contact = c.type==='aabb'
      ? sphereVsAABB(state.pos, c.min, c.max, BALL_R)
      : sphereVsOBB(state.pos, c.center, c.half, c.q, c.inv, BALL_R);
    if(!contact) return;

    state.pos.addScaledVector(contact.n, contact.depth + 0.001);
    const n = contact.n;

    if(c.kind === 'spring' || c.kind === 'bounce'){
      this._respondPad(state, c, n);
      if(n.y > 0.5) state.grounded = true, state.groundN.copy(n);
      return;
    }

    const vn = state.vel.dot(n);
    if(vn < 0){
      const e = n.y > 0.55 ? 0.12 : c.e;
      state.vel.addScaledVector(n, -(1+e)*vn);
      if(n.y > 0.5){
        state.grounded = true; state.groundN.copy(n);
      }else{
        const s = Math.min(1, -vn/9);
        if(s > 0.12){
          state.events.push({type:'wall', strength:s});
        }
      }
    }else if(n.y > 0.5){
      state.grounded = true; state.groundN.copy(n);
    }
  }

  _respondPad(state, c, n){
    const vn = state.vel.dot(n);
    if(c.kind === 'spring'){
      if(vn < 0) state.vel.addScaledVector(n, -vn); // strip velocity into the pad
      state.vel.addScaledVector(c.launchDir, c.power);
      state.events.push({type:'spring', strength:1, index:c.index});
    }else{
      // bouncy cushion: true geometric reflection, high restitution
      if(vn < 0){
        state.vel.addScaledVector(n, -(1+0.92)*vn);
        // guaranteed lively minimum speed
        const sp = state.vel.length();
        if(sp < c.power) state.vel.multiplyScalar(c.power/sp);
        state.events.push({type:'bounce', strength:Math.min(1,-vn/6), index:c.index});
      }
    }
  }

  _collideGate(state, g){
    const contact = sphereVsOBB(state.pos, g.axle, g.half, g.q, null, BALL_R);
    if(!contact) return;
    state.pos.addScaledVector(contact.n, contact.depth + 0.002);
    const n = contact.n;
    const vn = state.vel.dot(n);
    if(vn < 0){
      state.vel.addScaledVector(n, -(1+g.e)*vn);
      // surface velocity of the rotating arm
      const wvec = UP.clone().multiplyScalar(g.speed);
      const rvec = state.pos.clone().sub(g.axle);
      const surfV = new THREE.Vector3().crossVectors(wvec, rvec);
      state.vel.addScaledVector(surfV, 0.85);
      state.onGate = true;
      if(n.y>0.5){ state.grounded = true; state.groundN.copy(n); }
      else state.events.push({type:'gate', strength:Math.min(1,-vn/8)});
    }
  }

  _collideBumper(state, b){
    const d = state.pos.clone().sub(b.c); d.y = 0;
    const dist = d.length();
    if(dist > b.r + BALL_R) return;
    let n;
    if(dist < 1e-4) n = new THREE.Vector3(1,0,0); else n = d.multiplyScalar(1/dist);
    const depth = b.r + BALL_R - dist;
    state.pos.addScaledVector(n, depth + 0.002);
    const vn = state.vel.dot(n);
    if(vn < 0){
      state.vel.addScaledVector(n, -(1+b.e)*vn);
      // guaranteed playful minimum kick
      const after = state.vel.dot(n);
      if(after < 4.2) state.vel.addScaledVector(n, 4.2 - after);
      state.events.push({type:'bumper', strength:Math.min(1,-vn/6), index:b.index});
    }
  }

  // ---------- loop track ----------
  _checkLoops(state, h){
    if(state.loopCD>0) return;
    for(const l of this.loops){
      if(l.cd>0) continue;
      const rel = state.pos.clone().sub(l.C);
      const alongAxis = rel.dot(l.axisVec);
      if(Math.abs(alongAxis) > l.halfWidth + 0.25) continue;
      // distance from bottom anchor
      const toBottom = state.pos.clone().sub(l.bottom); toBottom.y = 0;
      const horiz = toBottom.length();
      if(horiz < 1.0 && state.pos.y < 0.9){
        const f = new THREE.Vector3().crossVectors(l.axisVec, UP).normalize();
        // choose forward = horizontal travel direction
        const vDot = state.vel.x*f.x + state.vel.z*f.z;
        if(Math.abs(vDot) > 1.4){
          if(vDot < 0) f.negate();
          const sp = Math.abs(vDot);
          // axis coord clamp toward center line
          state.pos.addScaledVector(l.axisVec, -alongAxis*0.6);
          state.loop = { loop:l, theta:0, thdot:sp, f };
        }
      }
    }
  }

  _stepLoop(state, h){
    const data = state.loop;
    const l = data.loop;
    const th = data.theta;

    // tangential gravity
    const acc = -G * Math.sin(th)/l.radius;
    data.thdot += acc*h;
    data.theta += data.thdot*h;

    const t2 = data.theta;

    // required inward normal force: N = v²/rho - g cos(theta)
    const N = data.thdot*data.thdot/l.radius - G*Math.cos(t2);
    if(N < 0){
      // detach! ball falls free (goofy)
      this._writeLoopPos(state, t2);
      const tangent = data.f.clone().multiplyScalar(Math.cos(t2)).addScaledVector(UP, Math.sin(t2));
      state.vel.copy(tangent.multiplyScalar(data.thdot));
      l.cd = 0.7;
      state.loop = null;
      state.loopCD = 0.4;
      state.events.push({type:'loopFail'});
      return;
    }

    if(t2 >= Math.PI*2){
      // full loop complete -> exit at bottom
      state.pos.copy(l.bottom).addScaledVector(UP, BALL_R);
      state.vel.copy(data.f).multiplyScalar(Math.max(data.thdot, 3));
      l.cd = 0.9;
      state.loop = null;
      state.loopCD = 0.9;
      state.grounded = true;
      state.groundN.copy(UP);
      state.events.push({type:'loopDone'});
      return;
    }

    this._writeLoopPos(state, t2);
    // side constraint along axis
    const rel = state.pos.clone().sub(l.C);
    const along = rel.dot(l.axisVec);
    if(Math.abs(along) > l.halfWidth){
      state.pos.addScaledVector(l.axisVec, (along>0?-1:1)*(Math.abs(along)-l.halfWidth));
    }
  }

  _writeLoopPos(state, theta){
    const l = state.loop.loop;
    const f = state.loop.f;
    state.pos.copy(l.C)
      .addScaledVector(f, l.radius*Math.sin(theta))
      .addScaledVector(UP, -l.radius*Math.cos(theta));
  }

  // ---------- pipes ----------
  _checkPipes(state){
    for(const p of this.pipes){
      if(p.cd>0) continue;
      const q = state.pos;
      if(q.x>p.min.x && q.x<p.max.x && q.y>p.min.y && q.y<p.max.y && q.z>p.min.z && q.z<p.max.z){
        const sp = Math.max(state.vel.length(), 5.5);
        state.pos.copy(p.out);
        state.vel.copy(p.dir).multiplyScalar(sp);
        p.cd = 0.9;
        state.loopCD = 0;
        state.events.push({type:'pipe', index:p.index});
      }
    }
  }

  // ---------- collectibles ----------
  _checkCollects(state){
    for(let i=0;i<this.collects.length;i++){
      const c = this.collects[i];
      if(c.taken) continue;
      if(c.p.distanceToSquared(state.pos) < 0.42*0.42){
        c.taken = true;
        state.events.push({type:'collect', index:i});
      }
    }
  }

  // ---------- cup capture / rim ----------
  _checkHole(state){
    const cup = this.cupPosition(state.time, this._v2 || (this._v2=new THREE.Vector3()));
    const dx = state.pos.x - cup.x, dz = state.pos.z - cup.z;
    const d = Math.hypot(dx,dz);
    const capR = 0.27, rimR = 0.36;

    // rim-out: crossing the rim too fast -> kick away
    if(state.rimPrev > rimR && d < rimR){
      const sp = state.vel.length();
      if(sp > 7){
        const n = new THREE.Vector3(dx,0,dz).normalize();
        const vn = state.vel.x*n.x+state.vel.z*n.z;
        if(vn < 0){
          const e = 0.45;
          state.vel.x -= (1+e)*vn*n.x;
          state.vel.z -= (1+e)*vn*n.z;
          state.vel.multiplyScalar(0.92);
          state.events.push({type:'rim'});
        }
      }
    }
    state.rimPrev = d;

    // capture: inside the trigger cylinder, slow enough, roughly at cup level
    const sp = state.vel.length();
    if(d < capR && sp < 7 && Math.abs(state.pos.y - (cup.y+BALL_R)) < 0.45){
      state.pos.set(cup.x, cup.y+BALL_R, cup.z);
      state.vel.set(0,0,0);
      state.events.push({type:'drain'});
    }
  }

  // ============================================================
  // Trajectory prediction — static geometry only.
  // Stops at walls, special zones, or max prediction time.
  // ============================================================
  predict(level, pos0, vel0, maxPoints=26){
    const p = pos0.clone();
    const v = vel0.clone();
    const pts = [];
    const h = 1/90;
    let grounded = false;
    let wallBounces = 0;
    const specialZones = this._specialZones(level);

    for(let i=0;i<55;i++){
      v.y -= G*h;
      p.addScaledVector(v,h);
      grounded = false;
      for(const c of this.statics){
        const contact = c.type==='aabb'
          ? sphereVsAABB(p,c.min,c.max,BALL_R)
          : sphereVsOBB(p,c.center,c.half,c.q,c.inv,BALL_R);
        if(contact){
          p.addScaledVector(contact.n, contact.depth+0.001);
          const vn = v.dot(contact.n);
          if(vn<0){
            if(contact.n.y>0.55){
              v.addScaledVector(contact.n,-(1+0.12)*vn);
              grounded = true;
            }else{
              v.addScaledVector(contact.n,-(1+0.5)*vn);
              wallBounces++;
            }
          }
        }
      }
      if(grounded){
        const sp = Math.hypot(v.x,v.z);
        if(sp>0){
          const ns = Math.max(0, sp - ROLL_FRICTION*G*h);
          v.x *= ns/sp; v.z *= ns/sp;
        }
      }
      // stop inside special mechanism zones (prediction would be guesswork)
      let inSpecial = false;
      for(const z of specialZones){
        if(p.x>z.min.x&&p.x<z.max.x&&p.y>z.min.y&&p.y<z.max.y&&p.z>z.min.z&&p.z<z.max.z){ inSpecial=true; break; }
      }
      if(i%2===0) pts.push(p.clone());
      if(inSpecial) break;
      if(wallBounces>=1){ pts.push(p.clone()); break; }
      if(pts.length>=maxPoints) break;
    }
    return pts;
  }

  _specialZones(){
    if(this._zones) return this._zones;
    const zones = [];
    // springs / pads
    for(const s of this.springs){
      const z = {min:new THREE.Vector3(),max:new THREE.Vector3()};
      if(s.type==='aabb'){ z.min.copy(s.min); z.max.copy(s.max); }
      else{
        // OBB approximate AABB
        for(let i=0;i<3;i++){
          const a = s.center.getComponent(i)-s.half.getComponent(i);
          const b = s.center.getComponent(i)+s.half.getComponent(i);
          z.min.setComponent(i,a-0.15); z.max.setComponent(i,b+0.15);
        }
      }
      zones.push(z);
    }
    // pipes
    for(const p of this.pipes) zones.push({min:p.min,max:p.max});
    // loops: bounding box around whole ring
    for(const l of this.loops){
      zones.push({
        min:new THREE.Vector3(l.C.x-l.radius-0.3,l.bottom.y-0.3,l.C.z-l.radius-0.3),
        max:new THREE.Vector3(l.C.x+l.radius+0.3,l.C.y+l.radius+0.3,l.C.z+l.radius+0.3)
      });
    }
    // gates
    for(const g of this.gates){
      zones.push({
        min:new THREE.Vector3(g.axle.x-g.half.x-0.1,g.axle.y-g.half.y,g.axle.z-g.half.x-0.1),
        max:new THREE.Vector3(g.axle.x+g.half.x+0.1,g.axle.y+g.half.y,g.axle.z+g.half.x+0.1)
      });
    }
    // hole
    const cup = this.cupPosition(0,new THREE.Vector3());
    zones.push({
      min:new THREE.Vector3(cup.x-0.4,cup.y-0.3,cup.z-0.4),
      max:new THREE.Vector3(cup.x+0.4,cup.y+0.6,cup.z+0.4)
    });
    this._zones = zones;
    return zones;
  }
}

// ============================================================
// Sphere vs AABB
// ============================================================
function sphereVsAABB(p, min, max, r){
  const qx = clamp(p.x,min.x,max.x);
  const qy = clamp(p.y,min.y,max.y);
  const qz = clamp(p.z,min.z,max.z);
  let dx = p.x-qx, dy = p.y-qy, dz = p.z-qz;
  let len2 = dx*dx+dy*dy+dz*dz;

  if(len2 > r*r) return null;

  if(len2 < 1e-10){
    // center is inside the box: push out along the smallest face
    const dMinX = p.x-min.x, dMaxX = max.x-p.x;
    const dMinY = p.y-min.y, dMaxY = max.y-p.y;
    const dMinZ = p.z-min.z, dMaxZ = max.z-p.z;
    const m = Math.min(dMinX,dMaxX,dMinY,dMaxY,dMinZ,dMaxZ);
    let nx=0,ny=0,nz=0;
    if(m===dMinX) nx=-1; else if(m===dMaxX) nx=1;
    else if(m===dMinY) ny=-1; else if(m===dMaxY) ny=1;
    else if(m===dMinZ) nz=-1; else nz=1;
    return { n:new THREE.Vector3(nx,ny,nz), depth:m+r };
  }

  const len = Math.sqrt(len2);
  return { n:new THREE.Vector3(dx/len,dy/len,dz/len), depth:r-len };
}

// ============================================================
// Sphere vs OBB (inv may be null for unit-length axis quats)
// ============================================================
function sphereVsOBB(p, center, half, q, inv, r){
  const local = p.clone().sub(center);
  if(inv) local.applyQuaternion(inv);
  else local.applyQuaternion(q.clone().invert());

  const lx = clamp(local.x,-half.x,half.x);
  const ly = clamp(local.y,-half.y,half.y);
  const lz = clamp(local.z,-half.z,half.z);
  let dx = local.x-lx, dy=local.y-ly, dz=local.z-lz;
  const len2 = dx*dx+dy*dy+dz*dz;
  if(len2 > r*r) return null;

  let ln;
  if(len2 < 1e-10){
    const d = [half.x-Math.abs(local.x), half.y-Math.abs(local.y), half.z-Math.abs(local.z)];
    const i = d.indexOf(Math.min(...d));
    const ax = new THREE.Vector3(i===0?Math.sign(local.x)||1:0, i===1?Math.sign(local.y)||1:0, i===2?Math.sign(local.z)||1:0);
    ln = ax;
    var depth = d[i]+r;
  }else{
    const len = Math.sqrt(len2);
    ln = new THREE.Vector3(dx/len,dy/len,dz/len);
    depth = r-len;
  }
  const n = ln.applyQuaternion(q);
  // normalize in case of quaternion drift
  if(n.lengthSq()>0) n.normalize();
  return { n, depth };
}

function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
