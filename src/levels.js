// ============================================================
// levels.js — 12 hand-designed mini-golf holes
//
// Coordinate system: x = right, z = toward camera (+) / far (-).
// Tee [x,z], ball y = ball radius.
// Each entry uses the schema compiled by physics.js:
//   base / floors, walls, platforms, ramps, pads, gates,
//   bumpers, pipes, loops, collect, hole{pos|move}, par
// ============================================================

export const THEMES = {
  toy:     'Toy Factory',
  street:  'Mini Main Street',
  candy:   'Candy Kitchen',
  machine: 'Machine Workshop',
  roof:    'Rooftop Playground'
};

export const LEVELS = [

  // ------------------------------------------------ 1
  {
    id:1, name:'Warm-Up Swing', theme:'toy',
    base:[7,9],
    tee:[0,3.2],
    hole:{pos:[-1.6,0,-3.3]},
    par:2,
    walls:[
      {p:[1.3,-0.8], s:[2.0,.5,.25]},
    ],
    collect:[[1.8,0.5,1.6],[-2.2,0.5,0.1],[0.4,0.5,-2.3]],
    hint:'Drag the ball BACK, then let go to putt!'
  },

  // ------------------------------------------------ 2
  {
    id:2, name:'Bumper Dodge', theme:'street',
    base:[7,10],
    tee:[0,3.5],
    hole:{pos:[1.4,0,-3.6]},
    par:3,
    bumpers:[
      {p:[-1.3,1.0], r:0.5},
      {p:[1.4,-0.6], r:0.5},
      {p:[-0.3,-2.3], r:0.45}
    ],
    collect:[[2.3,0.6,2.2],[-2.3,0.6,-0.8],[1.6,0.6,-2.9]],
    hint:'Bouncy bumpers always pop you at a clean angle.'
  },

  // ------------------------------------------------ 3
  {
    id:3, name:'Spring Training', theme:'toy',
    base:[7,11],
    tee:[0,4],
    pads:[
      {p:[0,0.15,-0.4], s:[1.7,.3,1.7], kind:'spring',
       dir:[0,0.72,-0.69], power:8.5}
    ],
    platforms:[
      {p:[0,1.35,-4.6], s:[3.4,.3,2.2]}
    ],
    walls:[
      {p:[-1.6,1.78,-4.6], s:[.2,.35,2.2]},
      {p:[ 1.6,1.78,-4.6], s:[.2,.35,2.2]},
      {p:[0,1.78,-5.6], s:[3.4,.35,.2]}
    ],
    hole:{pos:[0,1.5,-4.7]},
    par:3,
    collect:[[1.7,0.5,2.1],[-1.6,0.5,-0.2],[1.2,1.9,-4.3]],
    hint:'Roll onto the SPRING PAD to fly to the high platform!'
  },

  // ------------------------------------------------ 4
  {
    id:4, name:'Spin Class', theme:'machine',
    base:[6,10],
    tee:[0,3.5],
    gates:[
      {axle:[0,-1], baseY:0, length:4.4, height:.5, thick:.22, speed:0.8}
    ],
    hole:{pos:[0,-3.6]},
    par:3,
    statue:[-2.2,2.6],
    collect:[[1.7,0.6,2.3],[-1.7,0.6,0.0],[1.2,0.6,-2.7]],
    hint:'Time your shot through the gap in the spinning gate.'
  },

  // ------------------------------------------------ 5
  {
    id:5, name:'Cushion Shot', theme:'candy',
    base:[7,10],
    tee:[0,3.5],
    walls:[
      {p:[1.4,0.28,-1.2], s:[2.6,.56,.4]}
    ],
    pads:[
      {p:[-1.85,0.35,-3], s:[.3,.7,2.2], kind:'bounce', power:5.5},
      {p:[-0.2,0.35,-3.9], s:[1.8,.7,.3], kind:'bounce', power:5.5,
       rot:[0,Math.PI/4,0]}
    ],
    hole:{pos:[1.5,0,-3.3]},
    par:3,
    collect:[[2.1,0.6,1.5],[-2.1,0.6,-1.6],[2.0,0.6,-3.4]],
    hint:'The cup is hidden — bank the ball off a cushion!'
  },

  // ------------------------------------------------ 6
  {
    id:6, name:'Warp Way', theme:'machine',
    base:[7,10],
    floors:[
      {p:[0,3], s:[5,4]},
      {p:[0,-3], s:[5,4]}
    ],
    tee:[0,3.4],
    pipes:[
      {ins:[0,0.4,0.5], inSize:[1,.8,1],
       out:[0,0.35,-1.4], outDir:[0,0,-1]}
    ],
    hole:{pos:[0,-3.4]},
    par:2,
    collect:[[1.6,0.6,3.2],[-1.6,0.6,2.3],[1.5,0.6,-3.1]],
    hint:'Dive into the pipe — or dare to leap the gap!'
  },

  // ------------------------------------------------ 7
  {
    id:7, name:'Loop the Loop', theme:'roof',
    base:[6,12],
    tee:[0,4.4],
    loops:[
      {center:[0,0,0], axis:'z', radius:1.1, width:1.3}
    ],
    walls:[
      {p:[-2.1,0.3,0], s:[.25,.6,7.6]},
      {p:[ 2.1,0.3,0], s:[.25,.6,7.6]}
    ],
    hole:{pos:[0,-4.4]},
    par:2,
    collect:[[1.7,0.6,3.4],[0,0.7,1.4],[-1.7,0.6,-3.3]],
    hint:'Hit it HARD — a full loop needs real speed!'
  },

  // ------------------------------------------------ 8
  {
    id:8, name:'Swinging Cup', theme:'street',
    base:[7,10],
    tee:[0,3.5],
    walls:[
      {p:[0,0.28,0.4], s:[.25,.56,2.4]}
    ],
    bumpers:[
      {p:[-1.9,-1.2], r:0.45},
      {p:[ 1.9,-1.2], r:0.45}
    ],
    hole:{
      move:{points:[[-2.2,-3],[2.2,-3]], period:4}
    },
    par:3,
    collect:[[2.1,0.6,2.0],[-2.1,0.6,0.4],[0,0.7,-2.2]],
    hint:'The cup moves! Lead your shot and time the capture.'
  },

  // ------------------------------------------------ 9
  {
    id:9, name:'Toybox Tower', theme:'toy',
    base:[7,12],
    tee:[0,4.5],
    pads:[
      {p:[0,0.15,0.5], s:[1.7,.3,1.7], kind:'spring',
       dir:[0,0.72,-0.69], power:8.5}
    ],
    platforms:[
      {p:[0,1.35,-3.7], s:[3.6,.3,2.2]}
    ],
    bumpers:[
      {p:[-1,-3.9], h:2.05, r:0.45},
      {p:[ 1,-4.3], h:2.05, r:0.45}
    ],
    walls:[
      {p:[-1.7,1.78,-3.7], s:[.2,.35,2.2]},
      {p:[ 1.7,1.78,-3.7], s:[.2,.35,2.2]},
      {p:[0,1.78,-4.75], s:[3.6,.35,.2]}
    ],
    hole:{pos:[-0.4,1.5,-4.5]},
    par:4,
    collect:[[1.9,0.6,2.6],[-1.9,0.6,1.0],[1.3,2,-3.3]],
    hint:'Spring up, then thread the bumpers on the tower top!'
  },

  // ------------------------------------------------ 10
  {
    id:10, name:'Rush Hour Ruse', theme:'street',
    base:[7,12],
    tee:[0,4.5],
    gates:[
      {axle:[0,0.6], baseY:0, length:4.4, height:.5, thick:.22, speed:0.85}
    ],
    bumpers:[
      {p:[-1.4,-2.4], r:0.5},
      {p:[ 1.4,-3.3], r:0.5}
    ],
    hole:{pos:[0,-4.6]},
    par:4,
    statue:[2.3,3.6],
    collect:[[2.0,0.6,3.2],[-2.0,0.6,0.0],[1.4,0.6,-3.9]],
    hint:'Slip the gate, then dance between the street bumpers.'
  },

  // ------------------------------------------------ 11
  {
    id:11, name:'Sugar Rush', theme:'candy',
    base:[7,10],
    floors:[
      {p:[0,3], s:[6,4]},
      {p:[0,-3], s:[6,4]}
    ],
    tee:[0,3.4],
    pipes:[
      {ins:[0,0.4,0.6], inSize:[1,.8,1],
       out:[0,0.35,-1.4], outDir:[0,0,-1]}
    ],
    pads:[
      {p:[-2.1,0.35,-3.1], s:[.3,.7,2.2], kind:'bounce', power:5.5}
    ],
    hole:{
      move:{points:[[-1.8,-3.4],[1.8,-3.4]], period:4}
    },
    par:4,
    collect:[[1.9,0.6,3.0],[-1.9,0.6,2.1],[0,0.7,-2.3]],
    hint:'Pipe across, use the cushion if needed, catch the moving cup!'
  },

  // ------------------------------------------------ 12
  {
    id:12, name:'Grand Goofin', theme:'roof',
    base:[7,15.5],
    tee:[0,5.6],
    loops:[
      {center:[0,0,1.8], axis:'z', radius:1.1, width:1.3}
    ],
    walls:[
      {p:[-2.1,0.3,1.8], s:[.25,.6,3.4]},
      {p:[ 2.1,0.3,1.8], s:[.25,.6,3.4]}
    ],
    gates:[
      {axle:[0,-2], baseY:0, length:4.4, height:.5, thick:.22, speed:0.9}
    ],
    pads:[
      {p:[0,0.15,-3.4], s:[1.7,.3,1.7], kind:'spring',
       dir:[0,0.72,-0.69], power:8.5}
    ],
    platforms:[
      {p:[0,1.35,-6.4], s:[3.6,.3,2.6]}
    ],
    walls2:[],
    wallsExtra:[
      {p:[-1.7,1.78,-6.4], s:[.2,.35,2.6]},
      {p:[ 1.7,1.78,-6.4], s:[.2,.35,2.6]},
      {p:[0,1.78,-7.65], s:[3.6,.35,.2]}
    ],
    hole:{
      move:{points:[[-1.2,1.5,-6.4],[1.2,1.5,-6.4]], period:4}
    },
    par:5,
    statue:[2.3,4.6],
    collect:[[2.0,0.6,4.6],[-2.0,0.6,3.0],[1.2,2,-5.6]],
    hint:'The big finale: LOOP, time the gate, SPRING, catch the cup!'
  }
];

// Merge the extra walls key on level 12 (kept inline for clarity).
LEVELS[11].walls = LEVELS[11].walls.concat(LEVELS[11].wallsExtra);
delete LEVELS[11].wallsExtra; delete LEVELS[11].walls2;

// ============================================================
// Star rating
// ============================================================
export function starsForStrokes(strokes, par){
  if(strokes <= par-1) return 3;
  if(strokes <= par)   return 2;
  return 1;
}
