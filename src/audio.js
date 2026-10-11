// ============================================================
// audio.js — synthesized sound effects + goofy background music
// ============================================================

import { Save } from './storage.js';

class AudioEngine {
  constructor(){
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.musicTimer = null;
    this.musicStep = 0;
  }

  init(){
    if(this.ctx){
      if(this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.8;
    this.sfxGain.connect(this.master);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.32;
    this.musicGain.connect(this.master);
  }

  get enabled(){ return this.ctx && Save.getSettings().sfx; }

  // ------------- primitive helpers -------------
  _blip({freq=440, end=null, dur=0.12, type='sine', vol=0.3, attack=0.005, decay=null, dest=null}){
    if(!this.enabled) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if(end) osc.frequency.exponentialRampToValueAtTime(Math.max(1,end), t+dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t+attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
    osc.connect(g); g.connect(dest || this.sfxGain);
    osc.start(t); osc.stop(t+dur+0.02);
  }

  _noise({dur=0.1, vol=0.25, freq=1200, q=1, type='bandpass'}){
    if(!this.enabled) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for(let i=0;i<len;i++) data[i] = (Math.random()*2-1) * (1 - i/len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
    src.connect(filt); filt.connect(g); g.connect(this.sfxGain);
    src.start(t);
  }

  // ------------- game sounds -------------
  /** Club striking ball. power 0..1 */
  putt(power=0.5){
    this._noise({dur:0.07, vol:0.25+power*0.35, freq:900+power*900, q:1.2});
    this._blip({freq:160+power*120, end:70, dur:0.1, type:'triangle', vol:0.25+power*0.2});
  }

  /** Ball knock against wall. pitch varies with impact speed. */
  wall(strength=0.5){
    this._blip({freq:220+strength*160, end:120, dur:0.09, type:'square', vol:Math.min(0.3,0.08+strength*0.22)});
    this._noise({dur:0.05, vol:0.06+strength*0.1, freq:700, q:2});
  }

  /** Springy boing. */
  boing(){
    if(!this.enabled) return;
    this._blip({freq:180, end:760, dur:0.28, type:'sine', vol:0.4});
    this._blip({freq:360, end:1500, dur:0.22, type:'triangle', vol:0.18});
    window.setTimeout(()=>this._blip({freq:1400, end:900, dur:0.1, type:'sine', vol:0.12}), 120);
  }

  /** Bumper / cushion pop. */
  pop(){
    this._blip({freq:500, end:900, dur:0.11, type:'sine', vol:0.32});
    this._blip({freq:250, end:450, dur:0.1, type:'triangle', vol:0.2});
  }

  /** Teleport swirl. */
  pipe(){
    this._blip({freq:300, end:1400, dur:0.22, type:'sawtooth', vol:0.16});
    window.setTimeout(()=>this._blip({freq:1400, end:500, dur:0.16, type:'sine', vol:0.2}), 190);
  }

  /** Treasure pickup ding. */
  collect(){
    this._blip({freq:880, dur:0.09, type:'sine', vol:0.28});
    window.setTimeout(()=>this._blip({freq:1320, dur:0.14, type:'sine', vol:0.26}), 70);
  }

  /** Ball drops into the cup. */
  drain(){
    this._blip({freq:600, end:180, dur:0.25, type:'sine', vol:0.3});
    this._noise({dur:0.18, vol:0.12, freq:500, type:'lowpass'});
  }

  /** Successful hole fanfare. */
  fanfare(starCount=3){
    if(!this.enabled) return;
    const notes = [523.25,659.25,783.99,1046.5];
    notes.forEach((f,i)=>window.setTimeout(()=>this._blip({freq:f, dur:0.22, type:'triangle', vol:0.3}), i*110));
    if(starCount>=3){
      window.setTimeout(()=>this._blip({freq:1318.5, dur:0.4, type:'sine', vol:0.26}), 460);
      window.setTimeout(()=>this._blip({freq:1568, dur:0.45, type:'sine', vol:0.22}), 560);
    }
  }

  holeInOne(){
    if(!this.enabled) return;
    [523,659,784,1047,1319,1568].forEach((f,i)=>
      window.setTimeout(()=>this._blip({freq:f,dur:0.25,type:'triangle',vol:0.3}),i*80));
  }

  /** Little rotating-gate tap. */
  tap(){ this._blip({freq:340,end:200,dur:0.07,type:'square',vol:0.12}); }

  ui(){
    this._blip({freq:660,end:880,dur:0.07,type:'triangle',vol:0.18});
  }

  silly(){
    // goofy spring wobble used on funny fails
    this._blip({freq:500,end:120,dur:0.35,type:'sine',vol:0.22});
  }

  // ------------- background music -------------
  startMusic(){
    this.init();
    if(!Save.getSettings().music || !this.ctx) return;
    if(this.musicTimer) return;
    this.musicGain.gain.setTargetAtTime(0.32, this.ctx.currentTime, 0.1);
    // Cheerful wandering melody in C major, marimba-ish plucks + soft bass
    const lead = [
      523,0,659,784, 659,0,523,587,
      659,0,784,880, 784,0,659,523,
      587,0,659,784, 880,0,784,659,
      523,0,587,659, 523,0,0,0
    ];
    const bass = [
      131,0,0,0, 196,0,0,0,
      165,0,0,0, 196,0,0,0,
      131,0,0,0, 175,0,0,0,
      165,0,196,0, 131,0,0,0
    ];
    const stepDur = 190; // ms
    this.musicStep = 0;
    const tick = ()=>{
      const i = this.musicStep % lead.length;
      if(lead[i]) this._musicNote(lead[i], stepDur/1000*0.9, 0.16, 'triangle');
      if(bass[i]) this._musicNote(bass[i], stepDur/1000*1.6, 0.14, 'sine');
      this.musicStep++;
    };
    tick();
    this.musicTimer = window.setInterval(tick, stepDur);
  }

  stopMusic(){
    if(this.musicTimer){ clearInterval(this.musicTimer); this.musicTimer = null; }
    if(this.ctx && this.musicGain) this.musicGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
  }

  refreshMusic(){
    if(Save.getSettings().music) this.startMusic(); else this.stopMusic();
  }

  _musicNote(freq, dur, vol, type){
    if(!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type; osc.frequency.value = freq;
    g.gain.setValueAtTime(0,t);
    g.gain.linearRampToValueAtTime(vol,t+0.015);
    g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    osc.connect(g); g.connect(this.musicGain);
    osc.start(t); osc.stop(t+dur+0.03);
  }
}

// ------------- vibration helper -------------
export function vibrate(ms){
  if(Save.getSettings().vibe && navigator.vibrate){
    navigator.vibrate(ms);
  }
}

export const Sound = new AudioEngine();
