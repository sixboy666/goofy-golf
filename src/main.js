// ============================================================
// main.js — renderer/lighting setup, screen flow, level select,
// ball skins, settings, pause and results.
// ============================================================

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LEVELS, THEMES } from './levels.js';
import { SKINS, isSkinOwned } from './skins.js';
import { Save } from './storage.js';
import { Sound } from './audio.js';
import { Game } from './gameplay.js';

// ============================================================
// Renderer / scene / camera / lights
// ============================================================
// Primary-pointer detection: phones/tablets are the "touch" tier.
// (pointer:coarse) is more accurate than ontouchstart, which also fires
// on touch-screen laptops that have plenty of GPU headroom.
const TOUCH = matchMedia('(pointer: coarse)').matches;

const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({
  // MSAA is one of the most expensive features on mobile tiled GPUs
  // (multiplies per-fragment cost + memory bandwidth). Phones skip it —
  // at 1.6x pixel ratio edges stay clean enough. Desktop keeps AA.
  canvas, antialias:!TOUCH, stencil:false, powerPreference:'high-performance'
});
renderer.shadowMap.enabled = true;
// PCF (not PCFSoft): the map is baked once per level, but the filtering
// runs per fragment every frame — plain PCF is visibly identical for this
// stylized look and measurably cheaper on mobile GPUs
renderer.shadowMap.type = THREE.PCFShadowMap;
// The course's static geometry never moves, so its shadow map is baked
// once per level instead of re-rendered every frame — this removes the
// entire shadow pass from the per-frame GPU workload. The ball uses a
// cheap blob shadow instead (see world.js / gameplay.js).
renderer.shadowMap.autoUpdate = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x13243a);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 220);
camera.position.set(0,12,14);

const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5c4a3c, 1.05);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff4df, 1.7);
sun.position.set(9,15,7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048,2048);
sun.shadow.camera.near=1; sun.shadow.camera.far=45;
sun.shadow.camera.left=-16; sun.shadow.camera.right=16;
sun.shadow.camera.top=16;  sun.shadow.camera.bottom=-16;
sun.shadow.bias=-0.0004; sun.shadow.normalBias=0.02;
scene.add(sun);

const fillLight = new THREE.DirectionalLight(0x9fc8ff, 0.35);
fillLight.position.set(-7,6,-8);
scene.add(fillLight);

// Image-based lighting: neutral studio reflections so metals, gloss
// and clearcoat materials read correctly. Generated lazily — touch
// devices skip IBL entirely to spend their fragment budget on 60fps
// (see the light tier in applyQuality).
let envTex = null;
function ensureEnv(){
  if(!envTex){
    const pmrem = new THREE.PMREMGenerator(renderer);
    envTex = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
    pmrem.dispose();
  }
  return envTex;
}

// cool rim light from behind for silhouette definition
const rimLight = new THREE.DirectionalLight(0xbfd8ff, 0.5);
rimLight.position.set(-6,9,-10);
scene.add(rimLight);

// soft depth cue — far ground melts into the sky color
scene.fog = new THREE.Fog(0x13243a, 22, 60);

// Re-fit the sun's shadow frustum tightly around each course so the
// 2048px shadow map resolves fine detail instead of empty space.
scene.add(sun.target);
function fitSunShadows(bounds){
  const m = 2.5;
  const cx=(bounds.minX+bounds.maxX)/2, cz=(bounds.minZ+bounds.maxZ)/2;
  const r=Math.max(bounds.maxX-bounds.minX, bounds.maxZ-bounds.minZ)/2 + m;
  sun.position.set(cx+9,15,cz+7);
  sun.target.position.set(cx,0,cz);
  sun.target.updateMatrixWorld();
  const sc=sun.shadow.camera;
  sc.left=-r; sc.right=r; sc.top=r; sc.bottom=-r;
  sc.near=4; sc.far=40;
  sc.updateProjectionMatrix();
  renderer.shadowMap.needsUpdate = true;   // re-bake after the frustum moved
}

// ============================================================
// State
// ============================================================
let game = null;
let currentScreen = 'loading';
let settingsReturn = null;      // screen to return to after in-game settings
let lastResult = null;
let needsFrame = true;          // one-shot render flag for 2D-only screens

const $ = id => document.getElementById(id);

// ============================================================
// Screen management
// ============================================================
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>{
    s.classList.toggle('active', s.id===id);
  });
  currentScreen = id;
  needsFrame = true;   // render one frame so the backdrop is fresh
}

function toast(msg){
  const t = $('toast');
  t.innerHTML = `<span class="toast-msg">${msg}</span>`;
  clearTimeout(t._h);
  t._h = setTimeout(()=>t.innerHTML='', 2000);
}

// ============================================================
// Quality + adaptive resolution
// ============================================================
let maxDPR = 2;          // device pixel ratio cap for the current quality
let resScale = 1;        // dynamic scale factor (lowered on slow devices)
let frameEMA = 16.7;     // smoothed frame interval in ms
let lastAdjust = 0;      // cooldown so the scale doesn't oscillate

function applyResolution(){
  renderer.setPixelRatio(Math.max(0.55, maxDPR*resScale));
}

// Keeps a smoothed frame time and nudges the render resolution down
// on weaker GPUs (and back up when there is headroom). Rendering fewer
// pixels is the single most effective smoothness lever on phones.
function tuneResolution(now){
  if(now - lastAdjust < 500) return;
  if(frameEMA > 21 && resScale > 0.5){
    resScale = Math.max(0.5, resScale-0.12);
    applyResolution();
    lastAdjust = now;
  }else if(frameEMA < 15.5 && resScale < 1){
    resScale = Math.min(1, resScale+0.05);
    applyResolution();
    lastAdjust = now;
  }
}

function applyQuality(){
  const q = Save.getSettings().quality;
  if(q==='low'){
    maxDPR = 1;
    sun.shadow.mapSize.set(1024,1024);
  }else if(TOUCH){
    maxDPR = 1.6;
    sun.shadow.mapSize.set(1024,1024);
  }else{
    maxDPR = 2;
    sun.shadow.mapSize.set(2048,2048);
  }

  // fragment-cost tiers: phones run the PBR shader with ONE light and no
  // IBL — that removes 3 light loops + 2 envmap fetches per fragment
  // (roughly half the fragment ALU), the difference between 30fps and a
  // locked 60 on mid-range GPUs. A brighter hemisphere keeps the stylized
  // look full; desktop keeps the full 4-light + IBL setup.
  const fullTier = (q!=='low' && !TOUCH);
  fillLight.visible = fullTier;
  rimLight.visible = fullTier;
  hemi.intensity = fullTier ? 1.05 : 1.25;
  const wantEnv = fullTier ? ensureEnv() : null;
  if(scene.environment !== wantEnv){
    scene.environment = wantEnv;
    scene.traverse(o=>{ if(o.material) o.material.needsUpdate = true; });
  }

  if(sun.shadow.map){ sun.shadow.map.dispose(); sun.shadow.map = null; }
  applyResolution();
  renderer.shadowMap.needsUpdate = true;   // re-bake at the new map size
}

function resize(){
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w,h);
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
  needsFrame = true;   // 2D-only screens render one frame on demand
  if(game) game.reframe();   // keep the course framed after rotate/resize
}
window.addEventListener('resize', resize);
resize();
applyQuality();

// ============================================================
// Level select — stylized miniature course thumbnails
// ============================================================
const THUMB_COLORS = {
  toy:     {bg1:'#1f6e94', bg2:'#2fa2c9', slab:'#2f8fb4', carpet:'#7fd0ec', edge:'#eaf6fb', wall:'#e8566f'},
  street:  {bg1:'#374155', bg2:'#56627c', slab:'#4c5870', carpet:'#8190aa', edge:'#e8edf4', wall:'#d96c54'},
  candy:   {bg1:'#a64774', bg2:'#d974a2', slab:'#d96a98', carpet:'#f9b6cf', edge:'#fff1f7', wall:'#ffffff'},
  machine: {bg1:'#242c3a', bg2:'#3a4557', slab:'#343d4f', carpet:'#65748c', edge:'#8fa0b8', wall:'#39455c'},
  roof:    {bg1:'#4f7a2c', bg2:'#7ea84e', slab:'#6ea243', carpet:'#a6d875', edge:'#f2fbe8', wall:'#e8566f'}
};

function levelThumbnail(level, canvas){
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const c = THUMB_COLORS[level.theme] || THUMB_COLORS.toy;

  // background
  const bg = ctx.createLinearGradient(0,0,0,H);
  bg.addColorStop(0,c.bg1); bg.addColorStop(1,c.bg2);
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

  // ---- world bounds from floors ----
  const floors = level.floors || [{p:[0,0],s:level.base}];
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const f of floors){
    minX=Math.min(minX,f.p[0]-f.s[0]/2); maxX=Math.max(maxX,f.p[0]+f.s[0]/2);
    minZ=Math.min(minZ,f.p[1]-f.s[1]/2); maxZ=Math.max(maxZ,f.p[1]+f.s[1]/2);
  }
  const pad = Math.max(W,H)*0.10;
  const sx=(W-pad*2)/(maxX-minX || 1), sz=(H-pad*2)/(maxZ-minZ || 1);
  const s=Math.min(sx,sz);
  const ox=W/2-((minX+maxX)/2)*s, oy=H/2-((minZ+maxZ)/2)*s;
  const X=x=>ox+x*s, Y=z=>oy+z*s;
  // Normalize a 2D [x,z] or 3D [x,y,z] position to [x,z].
  const P2=p=>p.length>=3?[p[0],p[2]]:[p[0],p[1]];

  function rr(px,py,pw,ph,r){
    r=Math.min(r,pw/2,ph/2);
    ctx.beginPath();
    ctx.moveTo(px+r,py);
    ctx.arcTo(px+pw,py,px+pw,py+ph,r);
    ctx.arcTo(px+pw,py+ph,px,py+ph,r);
    ctx.arcTo(px,py+ph,px,py,r);
    ctx.arcTo(px,py,px+pw,py,r);
    ctx.closePath();
  }

  // floors: slab + carpet
  for(const f of floors){
    const [w,d]=f.s;
    ctx.fillStyle=c.slab;
    rr(X(f.p[0]-w/2)-2, Y(f.p[1]-d/2)-2, w*s+4, d*s+4, 7); ctx.fill();
    ctx.fillStyle=c.carpet;
    rr(X(f.p[0]-w/2)+3, Y(f.p[1]-d/2)+3, w*s-6, d*s-6, 5); ctx.fill();
    ctx.strokeStyle=c.edge; ctx.lineWidth=1.5; ctx.stroke();
  }

  // walls (explicit only)
  for(const w of level.walls||[]){
    const [wx,wz]=P2(w.p);
    ctx.fillStyle=c.wall;
    rr(X(wx-w.s[0]/2), Y(wz-w.s[2]/2), Math.max(3,w.s[0]*s), Math.max(3,w.s[2]*s), 2);
    ctx.fill();
  }

  // ramps
  for(const r of level.ramps||[]){
    const [rx,rz]=P2(r.p);
    ctx.save();
    ctx.translate(X(rx),Y(rz));
    ctx.rotate((r.r&&r.r[1])||0);
    ctx.fillStyle='rgba(255,255,255,0.55)';
    rr(-r.s[0]*s/2,-r.s[2]*s/2,r.s[0]*s,r.s[2]*s,2); ctx.fill();
    ctx.restore();
  }

  // pipes: entry + exit linked
  for(const p of level.pipes||[]){
    ctx.strokeStyle='rgba(25,195,164,0.85)'; ctx.lineWidth=2;
    ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(X(p.ins[0]),Y(p.ins[2])); ctx.lineTo(X(p.out[0]),Y(p.out[2])); ctx.stroke();
    ctx.setLineDash([]);
    for(const q of [p.ins,p.out]){
      ctx.fillStyle='#19c3a4';
      rr(X(q[0])-5,Y(q[2])-5,10,10,3); ctx.fill();
    }
  }

  // loops
  for(const l of level.loops||[]){
    ctx.strokeStyle='#fff3d6'; ctx.lineWidth=3;
    ctx.beginPath(); ctx.arc(X(l.center[0]),Y(l.center[2]),l.radius*s,0,Math.PI*2); ctx.stroke();
  }

  // gates
  for(const g of level.gates||[]){
    const a=g.phase||0;
    const dx=Math.cos(a)*g.length/2*s, dz=Math.sin(a)*g.length/2*s;
    ctx.strokeStyle='#ffc93c'; ctx.lineWidth=3.5; ctx.lineCap='round';
    ctx.beginPath();
    ctx.moveTo(X(g.axle[0])-dx,Y(g.axle[1])-dz);
    ctx.lineTo(X(g.axle[0])+dx,Y(g.axle[1])+dz);
    ctx.stroke();
    ctx.fillStyle='#fff';
    ctx.beginPath(); ctx.arc(X(g.axle[0]),Y(g.axle[1]),2.5,0,Math.PI*2); ctx.fill();
  }

  // bumpers
  for(const b of level.bumpers||[]){
    const [bx,bz]=P2(b.p);
    ctx.fillStyle='#ff8fb1';
    ctx.beginPath(); ctx.arc(X(bx),Y(bz),(b.r||0.5)*s,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; ctx.stroke();
  }

  // pads
  for(const p of level.pads||[]){
    ctx.save();
    if(p.rot) ctx.translate(X(p.p[0]),Y(p.p[2])) , ctx.rotate(p.rot);
    const px=p.rot?0:X(p.p[0])-p.s[0]*s/2;
    const py=p.rot?0:Y(p.p[2])-p.s[2]*s/2;
    ctx.fillStyle = p.kind==='spring' ? '#ffc93c' : '#ff5f8f';
    rr(px,py,Math.max(6,p.s[0]*s),Math.max(6,p.s[2]*s),2); ctx.fill();
    ctx.restore();
  }

  // collectibles
  ctx.fillStyle='#ffe066';
  for(const t of level.collect||[]){
    drawStar(ctx, X(t[0]), Y(t[2]), 3.2);
  }

  // moving cup path
  if(level.hole.move){
    ctx.strokeStyle='rgba(255,255,255,0.5)'; ctx.setLineDash([3,3]); ctx.lineWidth=1.5;
    ctx.beginPath();
    level.hole.move.points.forEach((p,i)=>{
      const [qx,qz]=P2(p);
      if(i) ctx.lineTo(X(qx),Y(qz)); else ctx.moveTo(X(qx),Y(qz));
    });
    ctx.stroke(); ctx.setLineDash([]);
  }

  // tee marker
  ctx.strokeStyle='#ffffff'; ctx.lineWidth=2.5;
  ctx.beginPath(); ctx.arc(X(level.tee[0]),Y(level.tee[1]),5,0,Math.PI*2); ctx.stroke();

  // cup + flag
  const hp = level.hole.pos ? P2(level.hole.pos) : P2(level.hole.move.points[0]);
  const hx=X(hp[0]), hy=Y(hp[1]);
  ctx.fillStyle='#20283a';
  ctx.beginPath(); ctx.arc(hx,hy,4.5,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle='#e84a5f'; ctx.lineWidth=1.6;
  ctx.beginPath(); ctx.moveTo(hx,hy-1); ctx.lineTo(hx,hy-9); ctx.stroke();
  ctx.fillStyle='#e84a5f';
  ctx.beginPath(); ctx.moveTo(hx,hy-9); ctx.lineTo(hx+6,hy-7); ctx.lineTo(hx,hy-5); ctx.fill();
}

function drawStar(ctx,x,y,r){
  ctx.beginPath();
  for(let i=0;i<10;i++){
    const a=-Math.PI/2+i*Math.PI/5;
    const rr2=i%2?r*0.45:r;
    ctx[i?'lineTo':'moveTo'](x+Math.cos(a)*rr2,y+Math.sin(a)*rr2);
  }
  ctx.closePath(); ctx.fill();
}

function buildLevelGrid(){
  const grid = $('level-grid');
  grid.innerHTML='';
  $('levels-stars').innerHTML = '&#9733; '+Save.totalStars();

  LEVELS.forEach(level=>{
    const unlocked = Save.isUnlocked(level.id);
    const stars = Save.getStars(level.id);

    const card = document.createElement('div');
    card.className = 'level-card'+(unlocked?'':' locked');

    const thumb = document.createElement('div');
    thumb.className='level-thumb';
    const cv = document.createElement('canvas');
    cv.width=280; cv.height=194;
    levelThumbnail(level, cv);
    thumb.appendChild(cv);
    card.appendChild(thumb);

    const num = document.createElement('div');
    num.className='level-num'; num.textContent=level.id;
    card.appendChild(num);

    if(!unlocked){
      const lock=document.createElement('div');
      lock.className='level-lock'; lock.innerHTML='&#128274;';
      card.appendChild(lock);
    }

    const info=document.createElement('div');
    info.className='level-info';
    info.innerHTML =
      `<div class="level-name">${level.name}</div>
       <div class="level-meta">
         <span class="level-par">Par ${level.par}</span>
         <span class="level-stars">
           ${[1,2,3].map(i=>`<span class="${i<=stars?'got':''}">&#9733;</span>`).join('')}
         </span>
       </div>`;
    card.appendChild(info);

    if(unlocked){
      card.addEventListener('click',()=>{
        Sound.ui();
        enterLevel(level);
      });
    }
    grid.appendChild(card);
  });
}

// ============================================================
// Skins
// ============================================================
// skins.js stores colors as numeric hex (for THREE); canvas needs CSS strings.
function cssColor(n){ return '#'+n.toString(16).padStart(6,'0'); }

function skinPreview(skin, canvas){
  const ctx=canvas.getContext('2d');
  const W=canvas.width,H=canvas.height;
  ctx.clearRect(0,0,W,H);
  const col=cssColor(skin.color), ring=cssColor(skin.ring);
  const cx=W/2,cy=H/2+4,r=W*0.30;
  const g=ctx.createRadialGradient(cx-r*0.4,cy-r*0.45,r*0.1,cx,cy,r);
  if(skin.style==='metal'){ g.addColorStop(0,'#ffffff'); g.addColorStop(0.5,col); g.addColorStop(1,'#7a5c10'); }
  else if(skin.style==='glow'){ g.addColorStop(0,'#ffffff'); g.addColorStop(0.6,col); g.addColorStop(1,col); }
  else { g.addColorStop(0,'#ffffff'); g.addColorStop(0.55,col); g.addColorStop(1,shade(col,-30)); }
  ctx.fillStyle=g;
  if(skin.style==='glass') ctx.globalAlpha=.82;
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
  ctx.globalAlpha=1;
  // dimples
  ctx.fillStyle='rgba(0,0,0,0.12)';
  for(const [dx,dy] of [[-.3,.1],[.05,-.25],[.3,.15],[-.05,.28]]){
    ctx.beginPath(); ctx.arc(cx+dx*r,cy+dy*r,r*0.09,0,Math.PI*2); ctx.fill();
  }
  // ring
  ctx.strokeStyle=ring; ctx.lineWidth=2;
  ctx.beginPath(); ctx.ellipse(cx,cy+r*0.55,r*0.92,r*0.28,0,0,Math.PI*2); ctx.stroke();
  if(skin.style==='glow'){
    ctx.strokeStyle=ring; ctx.globalAlpha=.5; ctx.lineWidth=4;
    ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.stroke();
    ctx.globalAlpha=1;
  }
}

function shade(hex, amt){
  const n=parseInt(hex.slice(1),16);
  let r=(n>>16)+amt, g=((n>>8)&255)+amt, b=(n&255)+amt;
  r=Math.max(0,Math.min(255,r)); g=Math.max(0,Math.min(255,g)); b=Math.max(0,Math.min(255,b));
  return '#'+((r<<16)|(g<<8)|b).toString(16).padStart(6,'0');
}

function buildSkins(){
  const grid=$('skin-grid');
  grid.innerHTML='';
  const total=Save.totalStars();
  $('skins-stars').innerHTML='&#9733; '+total;

  SKINS.forEach(skin=>{
    const owned=isSkinOwned(skin,total);
    const selected=Save.getSkin()===skin.id;
    const card=document.createElement('div');
    card.className='skin-card'+(owned?'':' locked')+(selected?' selected':'');

    const cv=document.createElement('canvas');
    cv.width=140; cv.height=140;
    skinPreview(skin,cv);
    card.appendChild(cv);

    const name=document.createElement('div');
    name.className='skin-name'; name.textContent=skin.name;
    card.appendChild(name);

    if(!owned){
      const need=document.createElement('div');
      need.className='skin-need'; need.innerHTML=`&#9733; ${skin.need}`;
      card.appendChild(need);
    }else if(selected){
      const sel=document.createElement('div');
      sel.className='skin-sel'; sel.textContent='EQUIPPED';
      card.appendChild(sel);
    }

    card.addEventListener('click',()=>{
      if(!owned){ Sound.ui(); toast(`Earn ${skin.need} stars to unlock ${skin.name}!`); return; }
      Save.setSkin(skin.id);
      Sound.pop();
      buildSkins();
    });
    grid.appendChild(card);
  });
}

// ============================================================
// Settings
// ============================================================
function syncSettingsUI(){
  const s=Save.getSettings();
  $('set-music').checked=s.music;
  $('set-sfx').checked=s.sfx;
  $('set-vibe').checked=s.vibe;
  $('set-aim').checked=s.aim;
  document.querySelectorAll('#set-quality button').forEach(b=>{
    b.classList.toggle('on', b.dataset.q===s.quality);
  });
}

function bindSettings(){
  $('set-music').addEventListener('change',e=>{
    Save.updateSetting('music',e.target.checked);
    e.target.checked ? Sound.startMusic() : Sound.stopMusic();
  });
  $('set-sfx').addEventListener('change',e=>Save.updateSetting('sfx',e.target.checked));
  $('set-vibe').addEventListener('change',e=>Save.updateSetting('vibe',e.target.checked));
  $('set-aim').addEventListener('change',e=>Save.updateSetting('aim',e.target.checked));
  document.querySelectorAll('#set-quality button').forEach(b=>{
    b.addEventListener('click',()=>{
      Save.updateSetting('quality',b.dataset.q);
      applyQuality();
      syncSettingsUI();
      Sound.ui();
    });
  });
}

// ============================================================
// Gameplay entry / exit
// ============================================================
function enterLevel(level){
  if(!game){
    game = new Game({renderer,scene,camera,canvas,
      lowq: Save.getSettings().quality==='low'},{
      onFinish: showResult,
      onLevelStart: fitSunShadows
    });
  }
  clearResultTimers();
  showScreen('hud');
  game.setPaused(false);
  game.startLevel(level, Save.getSkin());
  // adaptation warm-up: the first frames compile shaders (one-time GPU
  // stalls). Ignore them so the EMA doesn't wrongly drop the resolution,
  // and restart from a healthy baseline each level.
  frameEMA = 16.7;
  lastAdjust = performance.now() + 800;
}

function exitToLevels(){
  if(game){ game.abortLevel(); game.setPaused(false); }
  clearResultTimers();
  buildLevelGrid();
  showScreen('levels');
}

// ============================================================
// Pause / result
// ============================================================
function pauseGame(){
  if(!game || currentScreen!=='hud') return;
  game.setPaused(true);
  Sound.ui();
  showScreen('pause');
}
function resumeGame(){
  if(game) game.setPaused(false);
  Sound.ui();
  showScreen('hud');
}

// star-pop timers — cancelled if the player leaves the result screen early
let resultTimers = [];
function clearResultTimers(){
  resultTimers.forEach(clearTimeout);
  resultTimers = [];
}

function showResult(res){
  lastResult = res;
  clearResultTimers();
  const level = game.level;

  $('result-title').textContent = res.strokes===1 ? 'HOLE IN ONE!' : 'Hole Complete!';
  $('r-strokes').textContent=res.strokes;
  $('r-par').textContent=res.par;
  $('r-collect').textContent=res.treasures+'/3';
  $('r-best').textContent=Save.getBest(level.id);

  const rec=$('result-record');
  if(res.newBest && res.prevBest!=null){
    rec.textContent='NEW BEST!'; rec.classList.add('show');
  }else if(res.strokes===1){
    rec.textContent='INCREDIBLE!'; rec.classList.add('show');
  }else rec.classList.remove('show');

  // next button
  const next=$('btn-next');
  if(level.id>=LEVELS.length){
    next.textContent='All Done!';
    next.disabled=true;
  }else{
    next.innerHTML='Next &#8594;';
    next.disabled=false;
  }

  // star pop
  const stars=document.querySelectorAll('#result-stars .r-star');
  stars.forEach(s=>s.classList.remove('lit','pop'));
  stars.forEach((s,i)=>{
    resultTimers.push(setTimeout(()=>{
      if(i<res.stars){ s.classList.add('lit','pop'); Sound.pop(); }
    }, 350+i*320));
  });

  showScreen('result');
}

// ============================================================
// Global actions
// ============================================================
document.addEventListener('click', e=>{
  const btn=e.target.closest('[data-action]');
  if(!btn) return;
  const act=btn.dataset.action;

  switch(act){
    case 'play': {
      Sound.ui();
      const id=Math.min(Save.data.unlocked, LEVELS.length);
      const level=LEVELS.find(l=>l.id===id) || LEVELS[0];
      enterLevel(level);
      break;
    }
    case 'levels': Sound.ui(); buildLevelGrid(); showScreen('levels'); break;
    case 'skins': Sound.ui(); buildSkins(); showScreen('skins'); break;
    case 'settings':
      Sound.ui(); settingsReturn = currentScreen==='hud' ? 'pause' : 'menu';
      syncSettingsUI(); showScreen('settings'); break;
    case 'back-menu':
      Sound.ui();
      if(currentScreen==='settings' && settingsReturn==='pause' && game){
        showScreen('pause');
        settingsReturn=null;
      }else{
        showScreen('menu');
      }
      break;
    case 'reset-save':
      if(confirm('Reset all levels, stars and ball unlocks? This cannot be undone.')){
        Save.resetAll();
        applyQuality();
        syncSettingsUI();
        buildSkins(); buildLevelGrid();
        toast('Progress reset. Fresh start!');
        Sound.silly();
      }
      break;

    // HUD
    case 'pause': pauseGame(); break;
    case 'resume': resumeGame(); break;
    case 'restart':
      if(game){
        game.setPaused(false);
        game.resetLevel();
        showScreen('hud');
      }
      break;
    case 'to-levels': exitToLevels(); break;
    case 'pause-settings':
      settingsReturn='pause'; syncSettingsUI(); showScreen('settings'); break;

    // result
    case 'replay':
      Sound.ui();
      if(game){ game.setPaused(false); game.resetLevel(); showScreen('hud'); }
      break;
    case 'next': {
      if(!game) break;
      const nextLevel=LEVELS.find(l=>l.id===game.level.id+1);
      if(nextLevel){ Sound.ui(); enterLevel(nextLevel); }
      break;
    }
  }
});

// ============================================================
// Audio init on first gesture + music
// ============================================================
function firstGesture(){
  try{
    Sound.init();
    if(Save.getSettings().music) Sound.startMusic();
  }catch(err){ /* audio may be blocked */ }
  window.removeEventListener('pointerdown', firstGesture);
}
window.addEventListener('pointerdown', firstGesture);

// ============================================================
// Desktop convenience: keyboard shortcuts + no context menu
// ============================================================
window.addEventListener('keydown', e=>{
  if(e.key === 'Escape'){
    if(currentScreen==='hud') pauseGame();
    else if(currentScreen==='pause') resumeGame();
  }else if((e.key==='r' || e.key==='R') && currentScreen==='hud' && game){
    game.resetLevel();
  }
});
window.addEventListener('contextmenu', e=>{
  if(e.target === canvas) e.preventDefault();
});

// ============================================================
// Main loop
// ============================================================
// Screens whose UI fully covers the canvas don't need continuous
// rendering — a single frame on switch keeps the backdrop correct
// and saves a lot of battery in menus.
const FLAT_SCREENS = new Set(['loading','menu','levels','skins','settings','pause','result']);

let lastT = performance.now();
function loop(now){
  const rawMs = now - lastT;
  lastT = now;
  const dt = Math.min(0.05, rawMs/1000);

  if(currentScreen==='hud' && game) game.update(dt);

  if(FLAT_SCREENS.has(currentScreen)){
    if(needsFrame){ renderer.render(scene,camera); needsFrame = false; }
  }else{
    renderer.render(scene,camera);
  }

  // adaptive resolution — only measured while actually playing
  if(currentScreen==='hud'){
    frameEMA = frameEMA*0.92 + Math.min(rawMs,100)*0.08;
    tuneResolution(now);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ============================================================
// Boot: fonts + loading progress, then menu
// ============================================================
bindSettings();
syncSettingsUI();

const fill=$('loading-fill');
let prog=0;
const loadInt=setInterval(()=>{
  prog=Math.min(95,prog+8+Math.random()*14);
  fill.style.width=prog+'%';
},90);

Promise.race([
  document.fonts ? document.fonts.ready : Promise.resolve(),
  new Promise(r=>setTimeout(r,1600))
]).then(()=>new Promise(r=>setTimeout(r,300))).then(()=>{
  clearInterval(loadInt);
  fill.style.width='100%';
  setTimeout(()=>{
    showScreen('menu');
  },400);
});
