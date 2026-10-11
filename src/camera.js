// ============================================================
// camera.js — slightly elevated third-person mini-golf camera.
// Modes: overview (route framing), follow (rolling ball),
// focus (brief cinematic push-in when the ball drops).
// ============================================================

import * as THREE from 'three';

const UP = new THREE.Vector3(0,1,0);

export class CamRig{
  constructor(camera){
    this.camera = camera;
    this.mode = 'overview';
    this.camPos = new THREE.Vector3(0,10,12);
    this.look = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._lookDesired = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this.focusT = 0;
  }

  // frame the whole route before the first shot
  frameLevel(bounds, tee, hole){
    const cx=(bounds.minX+bounds.maxX)/2;
    const cz=(bounds.minZ+bounds.maxZ)/2;
    const W=bounds.maxX-bounds.minX, D=bounds.maxZ-bounds.minZ;
    const span = Math.max(W,D);
    // narrow (portrait) screens have a tiny horizontal FOV — pull the
    // camera back so the course never crops on phones; landscape/PC keeps
    // the original tighter framing
    const fitK = Math.max(1, 1.05/Math.max(this.camera.aspect, 0.4));
    const dist = span * 1.05 * fitK;
    // angle the view a little toward the tee so the ball is easy to grab
    this._overviewCenter = new THREE.Vector3(cx,0.25,cz);
    this._overviewPos = new THREE.Vector3(cx, dist*0.72, cz + dist*0.85);
    this._overviewPos.x += (tee[0]-cx)*0.2;
    this.camPos.copy(this._overviewPos);
    this.look.copy(this._overviewCenter);
    this.mode = 'overview';
    cameraSnap(this.camera, this.camPos, this.look);
  }

  setOverview(){ this.mode='overview'; this.focusT=0; }
  setFollow(){ this.mode='follow'; }
  setFocus(){ this.mode='focus'; this.focusT=0; }

  update(dt, ballPos, vel, cupPos){
    let k = 3.2;

    if(this.mode==='overview'){
      this._desired.copy(this._overviewPos);
      this._lookDesired.copy(this._overviewCenter);
      // drift the look slightly toward the ball
      this._tmp.set(ballPos.x,0.15,ballPos.z);
      this._lookDesired.lerp(this._tmp, 0.18);
      k = 2.0;
    }
    else if(this.mode==='follow'){
      const speed = vel.length();
      // keep a stable elevated chase offset
      this._desired.set(ballPos.x, 6.4, ballPos.z + 7.2);
      this._lookDesired.copy(ballPos);
      // look slightly ahead along travel
      this._lookDesired.x += vel.x*0.16;
      this._lookDesired.z += vel.z*0.16;
      this._lookDesired.y += 0.25 + Math.min(0.6,speed*0.05);
      k = 4.5;
    }
    else{ // focus on the cup
      this.focusT += dt;
      const a = Math.sin(this.focusT*0.8)*0.5;
      this._desired.set(cupPos.x + 2.6, cupPos.y + 3.1, cupPos.z + 3.4);
      this._lookDesired.set(cupPos.x, cupPos.y+0.2, cupPos.z);
      this._desired.x += a*0.4;
      k = 3.0;
    }

    const f = 1 - Math.exp(-k*dt);
    this.camPos.lerp(this._desired, f);
    this.look.lerp(this._lookDesired, f);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.look);
  }
}

function cameraSnap(camera, pos, look){
  camera.position.copy(pos);
  camera.lookAt(look);
}
