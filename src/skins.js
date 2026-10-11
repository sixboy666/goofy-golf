// ============================================================
// skins.js — unlockable ball appearances
// Each skin: base color, ring color, material style, star price.
// ============================================================

export const SKINS = [
  { id:0, name:'Classic',    color:0xffffff, ring:0xe8455a, need:0,  style:'standard' },
  { id:1, name:'Bubblegum',  color:0xff8fc6, ring:0xffffff, need:3,  style:'standard' },
  { id:2, name:'Ocean',      color:0x3aa8ff, ring:0xffffff, need:7,  style:'standard' },
  { id:3, name:'Lime Pop',   color:0x7ee04f, ring:0xffc93c, need:12, style:'standard' },
  { id:4, name:'Goldie',     color:0xffd24a, ring:0xff9a1f, need:18, style:'metal'    },
  { id:5, name:'Nightball',  color:0x2a1f56, ring:0xb388ff, need:24, style:'glow'     },
  { id:6, name:'Goop',       color:0x7cffb0, ring:0x19c3a4, need:30, style:'glass'    }
];

export function isSkinOwned(skin, totalStars){ return totalStars >= skin.need; }
