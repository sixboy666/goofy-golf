// ============================================================
// storage.js — persistent progress (localStorage)
// ============================================================

const KEY = 'goofy-golf-save-v1';

const DEFAULT_SAVE = {
  unlocked: 1,            // highest unlocked level id
  best: {},               // levelId -> minimum strokes
  stars: {},              // levelId -> 0..3
  treasures: {},          // levelId -> 0..3 collected
  skin: 0,                // selected ball skin id
  settings: {
    music: true,
    sfx: true,
    vibe: true,
    quality: 'high',
    aim: true
  }
};

class SaveSystem {
  constructor(){
    this.data = structuredClone(DEFAULT_SAVE);
    this.load();
  }

  load(){
    try{
      const raw = localStorage.getItem(KEY);
      if(raw){
        const parsed = JSON.parse(raw);
        this.data = deepMerge(structuredClone(DEFAULT_SAVE), parsed);
      }
    }catch(e){
      console.warn('Save load failed, starting fresh', e);
    }
  }

  save(){
    try{
      localStorage.setItem(KEY, JSON.stringify(this.data));
    }catch(e){
      console.warn('Save failed', e);
    }
  }

  isUnlocked(id){ return id <= this.data.unlocked; }

  getBest(id){ return this.data.best[id] ?? null; }

  getStars(id){ return this.data.stars[id] ?? 0; }

  getTreasures(id){ return this.data.treasures[id] ?? 0; }

  totalStars(){
    let s = 0;
    for(const k in this.data.stars) s += this.data.stars[k];
    return s;
  }

  /** Record a finished hole. Returns {newBest, newUnlock} */
  recordResult(levelId, strokes, starCount, treasures){
    const d = this.data;
    let newBest = false;
    const prevBest = d.best[levelId];
    if(prevBest == null || strokes < prevBest){
      d.best[levelId] = strokes;
      newBest = true;
    }
    const prevStars = d.stars[levelId] ?? 0;
    if(starCount > prevStars) d.stars[levelId] = starCount;
    const prevT = d.treasures[levelId] ?? 0;
    if(treasures > prevT) d.treasures[levelId] = treasures;

    let newUnlock = false;
    if(levelId >= d.unlocked){
      d.unlocked = levelId + 1;
      newUnlock = true;
    }
    this.save();
    return {newBest, newUnlock, prevBest};
  }

  getSkin(){ return this.data.skin; }
  setSkin(id){ this.data.skin = id; this.save(); }

  getSettings(){ return this.data.settings; }
  updateSetting(key, value){
    this.data.settings[key] = value;
    this.save();
  }

  resetAll(){
    this.data = structuredClone(DEFAULT_SAVE);
    this.save();
  }
}

function deepMerge(base, over){
  for(const k of Object.keys(over)){
    if(over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && typeof base[k] === 'object'){
      deepMerge(base[k], over[k]);
    }else{
      base[k] = over[k];
    }
  }
  return base;
}

export const Save = new SaveSystem();
