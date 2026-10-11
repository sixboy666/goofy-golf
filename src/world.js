// ============================================================
// world.js — builds the stylized miniature 3D golf course.
// Every object has REAL geometric thickness: slabs, walls,
// platforms, mechanisms and decorations are solid models.
// ============================================================

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BALL_R } from './physics.js';
import { SKINS } from './skins.js';

// ----------------------------------------------------------
// Theme palettes
// ----------------------------------------------------------
const PAL = {
  toy:{
    slab:0x2f8fb4, carpet:0x6fcbe8, edge:0xeaf6fb,
    wall:0xe8566f, cap:0xfff3d6, platform:0xf6c453, pcap:0xffe9a8,
    metal:0x5b6b80, pipe:0x19c3a4, bumper:0xff8fb1, ring:0xffffff,
    ground:0x244b63
  },
  street:{
    slab:0x4c5870, carpet:0x72819c, edge:0xe8edf4,
    wall:0xd96c54, cap:0xffe6d6, platform:0xb8a088, pcap:0xe8d8c4,
    metal:0x424c5e, pipe:0x2a9d8f, bumper:0x2a9d8f, ring:0xffffff,
    ground:0x2b3340
  },
  candy:{
    slab:0xd96a98, carpet:0xf7a8c4, edge:0xfff1f7,
    wall:0xffffff, cap:0xff9ec4, platform:0xffd16e, pcap:0xfff1b8,
    metal:0xb08caf, pipe:0x58c8e8, bumper:0x58c8e8, ring:0xffffff,
    ground:0x6e3a52
  },
  machine:{
    slab:0x343d4f, carpet:0x59677e, edge:0x8fa0b8,
    wall:0x39455c, cap:0xffb347, platform:0x6b7a94, pcap:0x9db0cc,
    metal:0x272f3d, pipe:0x19c3a4, bumper:0xffb347, ring:0x2f3848,
    ground:0x1e2530
  },
  roof:{
    slab:0x6ea243, carpet:0x9ed36a, edge:0xf2fbe8,
    wall:0xe8566f, cap:0xfff3d6, platform:0xd9a441, pcap:0xf2d090,
    metal:0x5b6b80, pipe:0x19c3a4, bumper:0xff8fab, ring:0xffffff,
    ground:0x3c5226
  }
};

function shadow(m, cast=true, receive=true){ m.castShadow = cast; m.receiveShadow = receive; return m; }

// ============================================================
export class World{
  constructor(scene, low=false){
    this.scene = scene;
    this.low = !!low;    // low-quality mode: fewer geometry segments
    this.group = null;
    this.level = null;
    this.anims = [];     // {update(t,dt)}
    this.gateArms = [];
    this.bumpAnims = [];
    this.springAnims = [];
    this.collectMeshes = [];
  }

  // --------------------------------------------------------
  load(level){
    this.dispose();
    this.level = level;
    this.pal = PAL[level.theme];
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.anims = []; this.gateArms = []; this.bumpAnims = [];
    this.springAnims = []; this.collectMeshes = [];
    this._mats = {}; this._geos = {};   // per-level material/geometry caches

    // big distant ground
    const gmat = new THREE.MeshStandardMaterial({color:this.pal.ground, roughness:1});
    const gplane = new THREE.Mesh(new THREE.PlaneGeometry(120,120), gmat);
    gplane.rotation.x = -Math.PI/2; gplane.position.y = -2.6;
    gplane.receiveShadow = true;
    this.group.add(gplane);

    const floors = level.floors || [{p:[0,0], s: level.base}];

    for(const f of floors) this._buildFloor(f);
    this._bounds = this._computeBounds(floors);

    for(const p of level.platforms||[]) this._buildPlatform(p);
    for(const w of level.walls||[]) this._buildWall(w);
    for(const g of level.gates||[]) this._buildGate(g);
    for(const b of level.bumpers||[]) this._buildBumper(b);
    for(const pad of level.pads||[]) this._buildPad(pad);
    for(const p of level.pipes||[]) this._buildPipe(p);
    for(const l of level.loops||[]) this._buildLoop(l);
    for(let i=0;i<(level.collect||[]).length;i++) this._buildCollect(level.collect[i], i);
    if(level.statue) this._buildStatue(level.statue);
    this._buildDecor(floors);
    this._buildCup();
    // place the cup at the hole (moving cups get re-synced every frame
    // by gameplay, but the initial placement matters for static holes —
    // without this the cup visual sat at the world origin)
    const hp = level.hole.pos || level.hole.move.points[0];
    const cupY = hp.length>=3 ? hp[1] : 0;
    this.cupGroup.position.set(hp[0], cupY, hp.length>=3 ? hp[2] : hp[1]);

    return this.group;
  }

  // --------------------------------------------------------
  // Cached factories: identical materials/geometries are shared
  // across the whole course, cutting GPU state changes.
  // --------------------------------------------------------
  _m(color, opts={}){
    const key = color+'|'+JSON.stringify(opts);
    let m = this._mats[key];
    if(!m){
      m = new THREE.MeshStandardMaterial({ color, roughness:0.7, metalness:0.05, ...opts });
      this._mats[key] = m;
    }
    return m;
  }

  _g(key, make){
    let g = this._geos[key];
    if(!g){ g = make(); this._geos[key] = g; }
    return g;
  }

  // segment count scaler for low-quality mode
  seg(n){ return this.low ? Math.max(6, Math.round(n*0.55)) : n; }

  _buildFloor(f){
    const [w,d] = f.s; const [cx,cz] = f.p; const pal=this.pal;
    // solid slab (real thickness)
    const slab = shadow(new THREE.Mesh(
      new RoundedBoxGeometry(w+0.02, 0.64, d+0.02, 2, 0.05),
      this._m(pal.slab,{roughness:0.9})));
    slab.position.set(cx,-.32,cz);
    this.group.add(slab);
    // carpet top, slightly inset — mowed-stripe fairway texture gives the
    // fine surface detail that reads as "golf" at a glance
    const stripeKey = pal.carpet+'|fairway|'+Math.max(2,Math.round(w/1.1));
    let carpetMat = this._mats[stripeKey];
    if(!carpetMat){
      carpetMat = new THREE.MeshStandardMaterial({
        color:pal.carpet, roughness:0.95, metalness:0.02,
        map:fairwayTexture(Math.max(2,Math.round(w/1.1)))});
      this._mats[stripeKey] = carpetMat;
    }
    const top = shadow(new THREE.Mesh(
      new THREE.BoxGeometry(w-0.14, 0.05, d-0.14), carpetMat), false, true);
    top.position.set(cx,-.01,cz);
    this.group.add(top);
    // edge trim strips
    const trimMat = this._m(pal.edge,{roughness:.6});
    const th = 0.07, tw = 0.1;
    const strips = [
      {p:[cx,0.005,cz-d/2+tw/2], s:[w,th,tw]},
      {p:[cx,0.005,cz+d/2-tw/2], s:[w,th,tw]},
      {p:[cx-w/2+tw/2,0.005,cz], s:[tw,th,d]},
      {p:[cx+w/2-tw/2,0.005,cz], s:[tw,th,d]}
    ];
    for(const s of strips){
      const m = shadow(new THREE.Mesh(new THREE.BoxGeometry(...s.s), trimMat), false, true);
      m.position.set(...s.p); this.group.add(m);
    }
  }

  _buildPlatform(p){
    const pal=this.pal;
    const box = shadow(new THREE.Mesh(
      new RoundedBoxGeometry(...p.s, 2, 0.04),
      this._m(pal.platform,{roughness:.75})));
    box.position.set(...p.p);
    this.group.add(box);
    // top inset cap
    const cap = shadow(new THREE.Mesh(
      new THREE.BoxGeometry(p.s[0]-0.1,0.04,p.s[2]-0.1),
      this._m(pal.pcap,{roughness:.9})), false, true);
    cap.position.set(p.p[0], p.p[1]+p.s[1]/2+0.01, p.p[2]);
    this.group.add(cap);
    // support legs down to ground when elevated
    if(p.p[1] > 0.5){
      const legMat = this._m(pal.metal,{roughness:.5,metalness:.4});
      const lx = p.s[0]/2-0.25, lz = p.s[2]/2-0.25;
      const legH = p.p[1]-p.s[1]/2;
      for(const dx of [-lx,lx]) for(const dz of [-lz,lz]){
        const leg = shadow(new THREE.Mesh(
          new THREE.CylinderGeometry(0.07,0.09,legH,10), legMat));
        leg.position.set(p.p[0]+dx, legH/2, p.p[2]+dz);
        this.group.add(leg);
      }
    }
  }

  _buildWall(w){
    const pal=this.pal;
    const h = w.s[1];
    const body = shadow(new THREE.Mesh(
      new RoundedBoxGeometry(...w.s, 2, 0.06),
      this._m(pal.wall,{roughness:.7})));
    body.position.set(...w.p);
    this.group.add(body);
    // top cap
    const cap = shadow(new THREE.Mesh(
      new RoundedBoxGeometry(w.s[0]+0.08,0.09,w.s[2]+0.08,2,0.04),
      this._m(pal.cap,{roughness:.55})));
    cap.position.set(w.p[0], w.p[1]+h/2+0.045, w.p[2]);
    this.group.add(cap);
  }

  _buildGate(g){
    const pal=this.pal;
    const grp = new THREE.Group();
    grp.position.set(g.axle[0], g.baseY, g.axle[1]);

    // base pedestal
    const base = shadow(new THREE.Mesh(
      this._g('gate-base', ()=>new THREE.CylinderGeometry(0.24,0.3,0.14,this.seg(20))),
      this._m(pal.metal,{roughness:.45,metalness:.5})));
    base.position.y = 0.07; grp.add(base);
    // post
    const postH = g.height/2 + 0.12;
    const post = shadow(new THREE.Mesh(
      this._g('gate-post', ()=>new THREE.CylinderGeometry(0.07,0.07,1,12)),
      this._m(pal.cap,{roughness:.4,metalness:.3})));
    post.scale.y = postH; post.position.y = postH/2; grp.add(post);
    // warning knob
    const knob = shadow(new THREE.Mesh(
      this._g('gate-knob', ()=>new THREE.SphereGeometry(0.1,this.seg(16),this.seg(12))),
      this._m(0xff5a5a,{emissive:0x661111,emissiveIntensity:.6})));
    knob.position.y = postH + 0.06; grp.add(knob);

    // rotating arm
    const armPivot = new THREE.Group();
    armPivot.position.y = g.height/2;
    const arm = shadow(new THREE.Mesh(
      new RoundedBoxGeometry(g.length,g.height,g.thick,2,0.05),
      this._m(pal.wall,{roughness:.65})));
    armPivot.add(arm);
    // hazard stripes via two small yellow caps
    for(const sx of [-g.length/2+0.18, g.length/2-0.18]){
      const stripe = shadow(new THREE.Mesh(
        new THREE.BoxGeometry(0.22,g.height+0.02,g.thick+0.02),
        this._m(0xffc93c)));
      stripe.position.x = sx; armPivot.add(stripe);
    }
    grp.add(armPivot);
    this.group.add(grp);
    this.gateArms.push(armPivot);
  }

  _buildBumper(b){
    const pal=this.pal;
    const r = b.r ?? 0.5, h = 0.55;
    const baseY = b.h !== undefined ? b.h - h/2 : 0;
    const grp = new THREE.Group();
    grp.position.set(b.p[0], baseY, b.p[2]);

    const body = shadow(new THREE.Mesh(
      this._g('bump-body'+r, ()=>new THREE.CylinderGeometry(r,r,h,this.seg(28))),
      this._m(pal.bumper,{roughness:.45})));
    body.position.y = h/2; grp.add(body);
    // rounded top
    const dome = shadow(new THREE.Mesh(
      this._g('bump-dome'+r, ()=>new THREE.SphereGeometry(r,this.seg(24),this.seg(12),0,Math.PI*2,0,Math.PI/2)),
      this._m(pal.ring,{roughness:.35})));
    dome.scale.y = 0.55; dome.position.y = h; grp.add(dome);
    // foot ring
    const ring = shadow(new THREE.Mesh(
      this._g('bump-ring'+r, ()=>new THREE.TorusGeometry(r,0.05,8,this.seg(28))),
      this._m(pal.metal,{roughness:.5,metalness:.3})));
    ring.rotation.x = Math.PI/2; ring.position.y = 0.06; grp.add(ring);

    this.group.add(grp);
    this.bumpAnims.push({grp, t:1});
  }

  _buildPad(pad){
    const pal=this.pal;
    const grp = new THREE.Group();
    grp.position.set(pad.p[0], pad.p[1], pad.p[2]);
    if(pad.rot) grp.rotation.set(...pad.rot);

    if(pad.kind === 'spring'){
      // solid base block
      const base = shadow(new THREE.Mesh(
        new RoundedBoxGeometry(pad.s[0],0.2,pad.s[2],2,0.05),
        this._m(0xff7a59,{roughness:.6})));
      base.position.y = 0; grp.add(base);
      // three coils
      const coilMat = this._m(pal.metal,{metalness:.7,roughness:.3});
      const coilPos = [[0,0],[-0.42,0],[0.42,0]];
      for(const [cx] of coilPos){
        for(let i=0;i<3;i++){
          const ring = shadow(new THREE.Mesh(
            this._g('coil', ()=>new THREE.TorusGeometry(0.12,0.025,6,this.seg(18))), coilMat));
          ring.rotation.x = Math.PI/2;
          ring.position.set(cx, 0.14+i*0.08, 0);
          grp.add(ring);
        }
      }
      // top plate
      const plate = shadow(new THREE.Mesh(
        new RoundedBoxGeometry(pad.s[0]*0.8,0.08,pad.s[2]*0.8,2,0.04),
        this._m(0xffc93c,{roughness:.5})));
      plate.position.y = 0.4; grp.add(plate);
      // direction arrow showing launch way
      const d = pad.dir;
      const arrow = shadow(new THREE.Mesh(
        new THREE.ConeGeometry(0.11,0.22,16),
        this._m(0xe8455a)));
      const dv = new THREE.Vector3(...d).normalize();
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dv);
      arrow.position.copy(dv).multiplyScalar(0.35).add(new THREE.Vector3(0,0.42,0));
      grp.add(arrow);
      this.springAnims.push({grp, t:1, plate});
    }else{
      // bouncy cushion — solid rounded block
      const body = shadow(new THREE.Mesh(
        new RoundedBoxGeometry(...pad.s, 2, 0.08),
        this._m(pal.bumper,{roughness:.4})));
      body.position.y = pad.s[1]/2; grp.add(body);
      // white soft face
      const face = shadow(new THREE.Mesh(
        new RoundedBoxGeometry(pad.s[0]*0.8,pad.s[1]*0.6,pad.s[2]*0.8,2,0.06),
        this._m(0xffffff,{roughness:.85})));
      face.position.y = pad.s[1]/2;
      grp.add(face);
      this.springAnims.push({grp, t:1, plate:body});
    }
    this.group.add(grp);
  }

  _buildPipe(p){
    const pal=this.pal;
    const mkTube = (pos, faceDir)=>{
      const grp = new THREE.Group();
      grp.position.copy(pos);
      const len = 0.95, r = 0.42;
      // solid tube
      const tube = shadow(new THREE.Mesh(
        this._g('pipe-tube', ()=>new THREE.CylinderGeometry(r,r,len,this.seg(24),1,true)),
        this._m(pal.pipe,{roughness:.4,metalness:.2,side:THREE.DoubleSide})));
      tube.rotation.x = Math.PI/2; grp.add(tube);
      // rim at the opening
      const rim = shadow(new THREE.Mesh(
        this._g('pipe-rim', ()=>new THREE.TorusGeometry(r,0.07,10,this.seg(28))),
        this._m(pal.cap,{roughness:.4})));
      rim.position.z = faceDir*len/2; grp.add(rim);
      // dark inner
      const inner = new THREE.Mesh(
        this._g('pipe-inner', ()=>new THREE.CircleGeometry(r-0.06,this.seg(24))),
        new THREE.MeshStandardMaterial({color:0x101820,roughness:1}));
      inner.position.z = faceDir*(len/2-0.04);
      if(faceDir<0) inner.rotation.y = Math.PI;
      grp.add(inner);
      // support foot
      const foot = shadow(new THREE.Mesh(
        this._g('pipe-foot', ()=>new RoundedBoxGeometry(r*1.4,0.2,r*1.2,1,0.04)),
        this._m(pal.metal,{roughness:.5,metalness:.4})));
      foot.position.y = -r-0.02; grp.add(foot);
      this.group.add(grp);
    };
    mkTube(new THREE.Vector3(...p.ins).add(new THREE.Vector3(0,0,0.25)), 1);
    mkTube(new THREE.Vector3(...p.out).add(new THREE.Vector3(0,0,-0.25)), -1);
  }

  _buildLoop(l){
    const pal=this.pal;
    const grp = new THREE.Group();
    const rho = l.radius;
    grp.position.set(l.center[0], rho, l.center[2]);
    if(l.axis === 'x') grp.rotation.y = Math.PI/2;

    // solid band the ball rides (custom rectangular-section ring)
    const band = shadow(new THREE.Mesh(
      loopBandGeometry(rho, l.width, 0.09, this.seg(56)),
      this._m(pal.metal,{roughness:.55,metalness:.35,side:THREE.DoubleSide})));
    grp.add(band);

    // two safety rails (real tube thickness)
    for(const z of [-l.width/2, l.width/2]){
      const rail = shadow(new THREE.Mesh(
        this._g('loop-rail'+rho, ()=>new THREE.TorusGeometry(rho,0.065,8,this.seg(56))),
        this._m(pal.wall,{roughness:.5})));
      rail.position.z = z; grp.add(rail);
    }

    // support posts to the ground
    for(const th of [Math.PI*0.32, Math.PI*0.68]){
      const x = rho*Math.sin(th);
      const yTop = -rho*Math.cos(th);
      const h = yTop;
      const post = shadow(new THREE.Mesh(
        new THREE.CylinderGeometry(0.06,0.07,h,10),
        this._m(pal.metal,{roughness:.5,metalness:.4})));
      post.position.set(x, yTop/2 - rho, 0);
      grp.add(post);
    }
    this.group.add(grp);
  }

  _buildCollect(c, i){
    const grp = new THREE.Group();
    grp.position.set(c[0], c[1] ?? 0.55, c[2]);
    const gold = shadow(new THREE.Mesh(
      this._g('collect-oct', ()=>new THREE.OctahedronGeometry(0.17,0)),
      this._m(0xffd24a,{metalness:.75,roughness:.22,emissive:0x664400,emissiveIntensity:.25})));
    grp.add(gold);
    // little orbit ring
    const ring = new THREE.Mesh(
      this._g('collect-ring', ()=>new THREE.TorusGeometry(0.24,0.015,6,this.seg(24))),
      this._m(0xfff3b0,{emissive:0x553300,emissiveIntensity:.4}));
    ring.rotation.x = Math.PI/2; grp.add(ring);

    this.group.add(grp);
    this.collectMeshes.push(grp);
    this.anims.push({update(t){
      grp.rotation.y = t*2.4 + i;
      grp.position.y = (c[1] ?? .55) + Math.sin(t*3+i)*0.07;
      ring.rotation.z = t*2;
    }});
  }

  // --------------------------------------------------------
  // Smug gatekeeper statue (visual only — never collides)
  // --------------------------------------------------------
  _buildStatue(s){
    const pal=this.pal;
    const grp = new THREE.Group();
    grp.position.set(s[0],0,s[1]);

    const ped = shadow(new THREE.Mesh(
      new RoundedBoxGeometry(0.55,0.22,0.55,2,0.05),
      this._m(pal.metal,{roughness:.6})));
    ped.position.y=.11; grp.add(ped);

    const body = shadow(new THREE.Mesh(
      new THREE.CylinderGeometry(0.17,0.23,0.5,16),
      this._m(pal.cap,{roughness:.7})));
    body.position.y=.48; grp.add(body);
    // head
    const head = shadow(new THREE.Mesh(
      new THREE.SphereGeometry(0.17,20,16),
      this._m(0xffe0c3,{roughness:.6})));
    head.position.y=.85; grp.add(head);
    // bellhop hat
    const hat = shadow(new THREE.Mesh(
      new THREE.CylinderGeometry(0.12,0.16,0.14,16),
      this._m(pal.wall,{roughness:.55})));
    hat.position.y=1.02; grp.add(hat);
    // eyes
    const eyeMat = this._m(0x202830,{roughness:.3});
    for(const dx of [-0.06,0.06]){
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.028,8,8), eyeMat);
      e.position.set(dx,.88,.15); grp.add(e);
    }
    // smug grin
    const grin = new THREE.Mesh(
      new THREE.TorusGeometry(0.06,0.012,6,14,Math.PI),
      this._m(0xc84a4a));
    grin.position.set(0,.81,.16); grin.rotation.z = Math.PI; grp.add(grin);
    // stop paddle held at side
    const stick = shadow(new THREE.Mesh(
      new THREE.CylinderGeometry(0.018,0.018,0.5,8),
      this._m(pal.metal)));
    stick.position.set(.3,.5,.02); grp.add(stick);
    const paddle = shadow(new THREE.Mesh(
      new THREE.CylinderGeometry(0.11,0.11,0.03,18),
      this._m(0xe8455a,{emissive:0x330000,emissiveIntensity:.4})));
    paddle.rotation.x = Math.PI/2; paddle.position.set(.3,.78,.03); grp.add(paddle);

    this.group.add(grp);
    this.statue = grp;
    this.statuePulseT = -10;
    const self=this;
    this.anims.push({update(t){
      const p = Math.max(0, 1-(t-self.statuePulseT)/1.4);
      grp.rotation.z = Math.sin(t*2.2)*0.05 + Math.sin(t*14)*0.12*p;
      grp.rotation.y = Math.sin(t*1.6)*0.1 + Math.sin(t*9)*0.25*p;
    }});
  }

  pulseStatue(t){ if(this.statue) this.statuePulseT = t; }

  // --------------------------------------------------------
  // Cup + flag
  // --------------------------------------------------------
  _buildCup(){
    const pal=this.pal;
    const grp = new THREE.Group();
    // dark shaft (visible depth through the top opening)
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.155,0.14,0.4,20,1,true),
      new THREE.MeshStandardMaterial({color:0x141a22,roughness:.9,side:THREE.DoubleSide}));
    shaft.position.y=-.18; grp.add(shaft);
    const bottom = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14,0.14,0.03,20),
      new THREE.MeshStandardMaterial({color:0x0c1016,roughness:1}));
    bottom.position.y=-.38; grp.add(bottom);
    // rim ring with real thickness
    const rim = shadow(new THREE.Mesh(
      new THREE.TorusGeometry(0.17,0.028,10,28),
      this._m(pal.cap,{roughness:.4,metalness:.2})));
    rim.rotation.x=Math.PI/2; rim.position.y=.005; grp.add(rim);
    // flag pole
    const pole = shadow(new THREE.Mesh(
      new THREE.CylinderGeometry(0.016,0.016,0.9,8),
      this._m(0xf2f6fa,{roughness:.4})));
    pole.position.set(.17,.45,0); grp.add(pole);
    // waving flag
    const flag = shadow(new THREE.Mesh(
      new THREE.BoxGeometry(0.3,0.2,0.02),
      this._m(pal.wall,{roughness:.6})));
    flag.position.set(.34,.78,0); grp.add(flag);
    this.cupGroup = grp;
    this.flagMesh = flag;
    this.group.add(grp);
  }

  // --------------------------------------------------------
  // Decorations per theme
  // --------------------------------------------------------
  _buildDecor(floors){
    const b = this._bounds;
    const W = b.maxX-b.minX, D = b.maxZ-b.minZ;
    const cx = (b.minX+b.maxX)/2, cz=(b.minZ+b.maxZ)/2;
    const fn = {
      toy:this._decorToy, street:this._decorStreet, candy:this._decorCandy,
      machine:this._decorMachine, roof:this._decorRoof
    }[this.level.theme];
    fn.call(this, W,D,cx,cz);
  }

  _add(mesh, x,y,z){ mesh.position.set(x,y,z); this.group.add(mesh); return mesh; }

  _decorToy(W,D,cx,cz){
    const pal=this.pal;
    // giant toy blocks at the two far corners
    const cols=[0xe8566f,0x58c8e8,0xf6c453];
    [[-1,-1],[1,-1]].forEach(([sx],i)=>{
      const s=0.55;
      const b = shadow(new THREE.Mesh(
        new RoundedBoxGeometry(s,s,s,2,0.06),
        this._m(cols[i],{roughness:.55})));
      this._add(b, cx+sx*(W/2-s-0.25), s/2, cz-D/2+s+0.25);
    });
    // wind-up key at a side
    const keyMat = this._m(0xffd24a,{metalness:.6,roughness:.3});
    const rod = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.04,.04,.5,10),keyMat));
    this._add(rod, cx-W/2+.45,.25,cz+D*0.05);
    const key = shadow(new THREE.Mesh(new THREE.TorusGeometry(.13,.035,8,18),keyMat));
    this._add(key, cx-W/2+.45,.55,cz+D*0.05);
  }

  _decorStreet(W,D,cx,cz){
    const pal=this.pal;
    // little shops beyond the back wall
    const shopCols=[0xe8b36b,0x8fc3e8,0xe88f9e];
    for(let i=-1;i<=1;i++){
      const w=1.35,h=1.5;
      const b = shadow(new THREE.Mesh(
        new THREE.BoxGeometry(w,h,0.9),
        this._m(shopCols[i+1],{roughness:.8})));
      this._add(b, cx+i*1.5, h/2-0.62, cz-D/2-0.7);
      // awning
      const aw = shadow(new THREE.Mesh(
        new THREE.BoxGeometry(w+0.15,0.1,0.5),
        this._m(i%2?0xffffff:0xe8566f,{roughness:.7})));
      this._add(aw, cx+i*1.5, 0.55, cz-D/2-0.25);
      // door
      const door = new THREE.Mesh(new THREE.BoxGeometry(.35,.7,.03),
        this._m(0x4c5870,{roughness:.8}));
      this._add(door, cx+i*1.5, -0.2, cz-D/2-0.245);
    }
    // street lamp
    const lampMat=this._m(pal.metal,{metalness:.5,roughness:.4});
    const pole = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.04,.05,1.5,10),lampMat));
    this._add(pole, cx+W/2-.45,.75,cz+D*0.1);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(.12,14,10),
      this._m(0xffe9a8,{emissive:0xffcc55,emissiveIntensity:.9}));
    this._add(bulb, cx+W/2-.45,1.5,cz+D*0.1);
  }

  _decorCandy(W,D,cx,cz){
    // lollipops along the sides
    const cols=[0xe8455a,0x58c8e8,0x7ee04f];
    [-1,1].forEach((sx,i)=>{
      const stick = shadow(new THREE.Mesh(
        new THREE.CylinderGeometry(.025,.025,.7,8),
        this._m(0xfff3d6,{roughness:.7})));
      this._add(stick, cx+sx*(W/2-.4),.35,cz-D*0.18);
      const pop = shadow(new THREE.Mesh(
        new THREE.TorusGeometry(.17,.06,10,22),
        this._m(cols[i+1],{roughness:.4})));
      this._add(pop, cx+sx*(W/2-.4),.78,cz-D*0.18);
    });
    // gumdrops at the far side
    for(let i=0;i<2;i++){
      const g = shadow(new THREE.Mesh(
        new THREE.SphereGeometry(.2,16,10,0,Math.PI*2,0,Math.PI/2),
        this._m(cols[i],{roughness:.45})));
      this._add(g, cx-0.6+i*1.2,.0,cz-D/2+.45);
    }
  }

  _decorMachine(W,D,cx,cz){
    const pal=this.pal;
    // spinning gear on a side wall
    const grp=new THREE.Group();
    grp.position.set(cx-W/2+.3,.7,cz-D*0.12);
    const gearMat=this._m(pal.cap,{metalness:.4,roughness:.4});
    const ring = shadow(new THREE.Mesh(new THREE.TorusGeometry(.27,.08,8,20),gearMat));
    grp.add(ring);
    for(let i=0;i<8;i++){
      const t=shadow(new THREE.Mesh(new THREE.BoxGeometry(.12,.08,.1),gearMat));
      const a=i/8*Math.PI*2;
      t.position.set(Math.cos(a)*.34,Math.sin(a)*.34,0);
      t.rotation.z=a;
      grp.add(t);
    }
    this.group.add(grp);
    this.anims.push({update(t){ grp.rotation.z=-t*.8; }});
    // pipe run along the other side
    const pipeMat=this._m(pal.pipe,{roughness:.4,metalness:.3});
    const run = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.1,.1,D*.6,14),pipeMat));
    this._add(run, cx+W/2-.25,.55,cz);
  }

  _decorRoof(W,D,cx,cz){
    // beach umbrella on a far corner
    const pole=shadow(new THREE.Mesh(
      new THREE.CylinderGeometry(.03,.03,.9,8),
      this._m(0x8a99ad,{metalness:.4,roughness:.4})));
    this._add(pole,cx-W/2+.6,.45,cz-D/2+.7);
    const top=shadow(new THREE.Mesh(
      new THREE.ConeGeometry(.45,.35,20),
      this._m(0xff8fb1,{roughness:.6})));
    this._add(top,cx-W/2+.6,1.05,cz-D/2+.7);
    // little AC unit
    const unit=shadow(new THREE.Mesh(
      new RoundedBoxGeometry(.6,.4,.5,2,.05),
      this._m(0xdbe4ee,{roughness:.7})));
    this._add(unit,cx+W/2-.55,.2,cz-D/2+.6);
    const fan=new THREE.Mesh(new THREE.TorusGeometry(.16,.03,8,18),
      this._m(0x5b6b80,{roughness:.5}));
    fan.position.set(cx+W/2-.55,.25,cz-D/2+.34);
    this.group.add(fan);
    const blade=new THREE.Mesh(new THREE.BoxGeometry(.24,.03,.015),
      this._m(0x9db0cc));
    blade.position.copy(fan.position);
    this.group.add(blade);
    this.anims.push({update(t){ blade.rotation.z=t*6; fan.rotation.z=t*6; }});
  }

  // --------------------------------------------------------
  // Ball with selected skin
  // --------------------------------------------------------
  buildBall(skinId){
    const skin = SKINS[skinId] || SKINS[0];
    const grp = new THREE.Group();
    // MeshPhysicalMaterial adds clearcoat highlights; the environment map
    // (set in main.js) makes metal/gloss skins really pop. One ball = cheap.
    let mat;
    if(skin.style==='metal'){
      mat = new THREE.MeshPhysicalMaterial({color:skin.color,metalness:.95,roughness:.16,
        clearcoat:.6,clearcoatRoughness:.2});
    }else if(skin.style==='glow'){
      mat = new THREE.MeshPhysicalMaterial({color:skin.color,emissive:skin.color,
        emissiveIntensity:.55,roughness:.5});
    }else if(skin.style==='glass'){
      mat = new THREE.MeshPhysicalMaterial({color:skin.color,transparent:true,opacity:.6,
        roughness:.08,metalness:0,emissive:skin.color,emissiveIntensity:.12,
        clearcoat:1,clearcoatRoughness:.06});
    }else{
      mat = new THREE.MeshPhysicalMaterial({color:skin.color,roughness:.32,
        clearcoat:.8,clearcoatRoughness:.25});
    }
    const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R,32,24), mat);
    grp.add(ball);
    // seam ring
    const seam = new THREE.Mesh(
      new THREE.TorusGeometry(BALL_R*1.005,.012,8,32),
      new THREE.MeshStandardMaterial({color:skin.ring,roughness:.4}));
    seam.rotation.x = Math.PI/2;
    grp.add(seam);
    // cheap blob shadow under the ball — the baked static shadow map
    // doesn't cover the (always moving) ball, so we fake it here instead
    // of re-rendering the whole shadow map every frame.
    const bs = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62,0.62),
      new THREE.MeshBasicMaterial({map:blobTexture(), transparent:true,
        depthWrite:false, opacity:0.5}));
    bs.rotation.x = -Math.PI/2;
    bs.renderOrder = 2;
    this.group.add(bs);
    this.ballShadow = bs;
    this.group.add(grp);
    this.ball = grp;
    this.ballMesh = ball;
    return grp;
  }

  // --------------------------------------------------------
  // Per-frame decorative updates
  // --------------------------------------------------------
  update(dt, time){
    for(const a of this.anims) a.update(time,dt);
    // flag wave
    if(this.flagMesh){
      this.flagMesh.scale.y = 1 + Math.sin(time*6)*0.12;
      this.flagMesh.rotation.y = Math.sin(time*4)*0.15;
    }
    // bumper squash recovery
    for(const b of this.bumpAnims){
      if(b.t<1){
        b.t = Math.min(1,b.t+dt*4);
        const k = 1 - b.t;
        b.grp.scale.set(1+0.25*k,1-0.22*k,1+0.25*k);
      }
    }
    // spring plate compression
    for(const s of this.springAnims){
      if(s.t<1){
        s.t = Math.min(1,s.t+dt*3.2);
        const k = 1 - s.t;
        if(s.plate) s.plate.position.y = s.plate.userData.baseY - 0.22*k*(0.5+0.5*Math.sin(s.t*Math.PI));
      }
    }
  }

  popBumper(i){ const b=this.bumpAnims[i]; if(b){b.t=0;} }
  fireSpring(i){
    const s=this.springAnims[i];
    if(s){ s.t=0; if(s.plate) s.plate.userData.baseY = s.plate.position.y; }
  }
  takeCollect(i){ if(this.collectMeshes[i]) this.collectMeshes[i].visible=false; }

  syncGate(index, quaternion){
    if(this.gateArms[index]) this.gateArms[index].quaternion.copy(quaternion);
  }

  _computeBounds(floors){
    let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
    for(const f of floors){
      const [w,d]=f.s;
      minX=Math.min(minX,f.p[0]-w/2); maxX=Math.max(maxX,f.p[0]+w/2);
      minZ=Math.min(minZ,f.p[1]-d/2); maxZ=Math.max(maxZ,f.p[1]+d/2);
    }
    return {minX,maxX,minZ,maxZ};
  }

  get bounds(){ return this._bounds; }

  dispose(){
    if(this.group){
      this.scene.remove(this.group);
      this.group.traverse(o=>{
        if(o.geometry) o.geometry.dispose();
        if(o.material){
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          ms.forEach(m=>{ if(m.map) m.map.dispose(); m.dispose(); });
        }
      });
      this.group = null;
    }
  }
}

// ============================================================
// Mowed-stripe fairway texture (multiplies against carpet color)
// ============================================================
let _fairwayCanvas = null;
function fairwayTexture(repeatX){
  if(!_fairwayCanvas){
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const ctx = c.getContext('2d');
    // alternating near-white bands so the base carpet color tints through
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,256,64);
    ctx.fillStyle = '#e2e2e2'; ctx.fillRect(0,0,128,64);
    _fairwayCanvas = c;
  }
  const t = new THREE.CanvasTexture(_fairwayCanvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, 1);
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ============================================================
// Soft radial blob texture for the ball's fake shadow
// ============================================================
let _blobTex = null;
function blobTexture(){
  if(_blobTex) return _blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64,64,4,64,64,62);
  g.addColorStop(0,'rgba(0,0,0,0.85)');
  g.addColorStop(0.55,'rgba(0,0,0,0.45)');
  g.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0,0,128,128);
  _blobTex = new THREE.CanvasTexture(c);
  return _blobTex;
}

// ============================================================
// Custom rectangular-section ring geometry for loop tracks
// ============================================================
function loopBandGeometry(radius, width, thick, seg){
  const w=width/2;
  const pos=[]; const idx=[];
  for(let i=0;i<=seg;i++){
    const th=i/seg*Math.PI*2;
    const s=Math.sin(th), c=Math.cos(th);
    // radial outward vector in XY
    const rx=s, ry=-c;
    const cx=radius*s, cy=-radius*c;
    // 4 corners: inner-top (±w), outer-bottom (±w)
    pos.push(cx,cy,-w);
    pos.push(cx,cy, w);
    pos.push(cx+rx*thick,cy+ry*thick, w);
    pos.push(cx+rx*thick,cy+ry*thick,-w);
  }
  for(let i=0;i<seg;i++){
    const a=i*4, b=(i+1)*4;
    // inner surface
    idx.push(a,b,b+1, a,b+1,a+1);
    // outer
    idx.push(a+2,a+3,b+3, a+2,b+3,b+2);
    // side +
    idx.push(a+1,b+1,b+2, a+1,b+2,a+2);
    // side -
    idx.push(a+3,b+3,b, a+3,b,a);
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
