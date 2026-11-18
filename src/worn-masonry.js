import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;

// The front arris has long intact stretches with chips at several different scales.
function fracture(t, seed) {
  const fret = Math.sin(t * 16.3 + seed) + .47 * Math.sin(t * 30.1 - seed) + .23 * Math.sin(t * 63.7 + 1.4 * seed);
  return clamp((fret + .23) * .74, 0, 1);
}

// Two sampled edges bound a strip. Keeping indices shared along each strip lets
// light roll over rounded surfaces while adjoining broken faces retain a hard edge.
function strip(build, rows, a, b, facing, kind, photoOrigin) {
  const positions = [], uvs = [], indices = [];
  for (const row of rows) {
    for (const point of [row[a],row[b]]) {
      positions.push(...point);
      uvs.push(photoOrigin === undefined ? 0 : point[2] - photoOrigin, point[1]);
    }
  }
  const normal = new THREE.Vector3(), along = new THREE.Vector3(), origin = new THREE.Vector3();
  const target = new THREE.Vector3(...facing);
  let orientation = 0;
  // A broken strip can taper to zero width before the first intact section.
  for(let i=0;i+1<rows.length && Math.abs(orientation)<1e-9;i++) {
    origin.fromArray(rows[i][a]);
    normal.fromArray(rows[i][b]).sub(origin);
    along.fromArray(rows[i+1][a]).sub(origin);
    orientation = normal.cross(along).dot(target);
  }
  const reverse = orientation < 0;
  for (let i = 0; i + 1 < rows.length; ++i) {
    const n = i * 2;
    if (reverse) indices.push(n, n+2, n+1, n+2, n+3, n+1);
    else indices.push(n, n+1, n+2, n+2, n+1, n+3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  build.add(geometry, build.material(kind), photoOrigin === undefined);
}

const revealAllowance = .115;

export const doorCutWidth = 1.03 + revealAllowance * 2;

export function doorPhotoExtent(center, side) {
  return center + side * doorCutWidth * .5;
}

export function doorway(build, center, seed, occluders) {
  for (const side of [-1,1]) {
    const edge = center + side * .515;
    const outer = doorPhotoExtent(center, side);
    const solid = new THREE.Mesh(new THREE.BoxGeometry(.25,2.23,revealAllowance));
    solid.position.set(1.575,1.115,edge + side * revealAllowance * .5);
    solid.updateMatrixWorld();
    occluders.push(solid);
    const face = center > -1 && side > 0 ? 'entrywall' :
      (center > -1 && side < 0 || center < -1 && side > 0) ? 'redwall' : 'plaster';
    const origin = face === 'entrywall' ? -.035 : face === 'redwall' ? -6.685 : undefined;
    const rows = [];
    for (let i=0; i<=65; ++i) {
      const y = i / 65 * 2.23;
      const damage = fracture(y, seed + side * 3.97);
      const chip = (.004 + damage * .068) * (1 + .34 * Math.exp(-y * 4));
      const loss = .002 + damage * .019;
      rows.push([
        [1.448,y,outer], [1.448,y,edge + side * (chip + .004)],
        [1.452 + .15 * chip,y,edge + side * .76 * chip], [1.461 + .70 * chip,y,edge + side * loss],
        [1.55,y,edge + side * .64 * loss], [1.68,y,edge + side * .52 * loss],
        [1.702,y,edge + side * (.01 + loss)], [1.702,y,outer],
      ]);
    }
    strip(build,rows,0,1,[-1,0,0],face,origin);
    strip(build,rows,1,2,[-1,0,-side],'door');
    strip(build,rows,2,3,[-1,0,-side],'stairs');
    for(let i=3;i<6;i++) strip(build,rows,i,i+1,[0,0,-side],'door');
    strip(build,rows,6,7,[1,0,0],'plaster');
    // The photo continues over the lintel on the wall above the jamb.
    const cap = [2.23,2.68,3.1].map(y => [[1.448,y,outer],[1.448,y,edge]]);
    strip(build,cap,0,1,[-1,0,0],face,origin);
  }

  const rows = [];
  for (let i=0; i<=34; i++) {
    const z = center - .515 + 1.03 * i / 34;
    const chip = .027 * fracture(z,seed);
    rows.push([[1.448,2.294,z],[1.448,2.233+chip,z],[1.464+chip,2.227,z],
      [1.69,2.227,z],[1.702,2.239+chip*.4,z]]);
  }
  strip(build,rows,0,1,[-1,0,0],'plaster');
  strip(build,rows,1,2,[-1,-1,0],'stairs');
  strip(build,rows,2,3,[0,-1,0],'door');
  strip(build,rows,3,4,[1,-1,0],'door');
}

export function windowSill(build, center, width, sill) {
  const rows = [], length = width + .11;
  const count = Math.ceil(length / .034);
  for(let i=0;i<=count;i++) {
    const z = center - length*.5 + length*i/count;
    const chip = fracture(z,center+2) * .022;
    rows.push([
      [-1.716,sill+.005,z], [-1.418 - .44*chip,sill+.005,z],
      [-1.398-chip,sill-.008-chip*.40,z], [-1.398-chip*.70,sill-.046+chip*.36,z],
      [-1.409-.52*chip,sill-.061,z], [-1.451,sill-.068,z],
    ]);
  }
  strip(build,rows,0,1,[0,1,0],'stairs');
  strip(build,rows,1,2,[1,1,0],'stairs');
  strip(build,rows,2,3,[1,0,0],'door');
  strip(build,rows,3,4,[1,-1,0],'stairs');
  strip(build,rows,4,5,[0,-1,0],'stairs');
  for(const [i,dir] of [[0,-1],[count,1]]) {
    const a=rows[i], back=[a[0][0],sill-.061,a[0][2]];
    strip(build,[[a[0],a[1]],[back,a[4]]],0,1,[0,0,dir],'stairs');
  }
}

export function stairNosing(build, x, y, z, width, direction, index) {
  const rows=[], count=Math.ceil(width/.034);
  for(let i=0;i<=count;i++){
    const dx=width*(i/count-.5);
    const scallop=fracture(dx,index*4.31)*.022;
    const footfall=Math.exp(-Math.pow((dx-.12)*1.74,2));
    const recess=.004*footfall+scallop;
    rows.push([[x+dx,y,z-direction*.052],[x+dx,y-.002*footfall,z-direction*(recess+.012)],
      [x+dx,y-.009-scallop*.28,z-direction*recess],[x+dx,y-.045-scallop*.32,z-direction*(.001+recess*.78)],
      [x+dx,y-.058,z-direction*(.018+recess*.7)],[x+dx,y-.058,z-direction*.052]]);
  }
  strip(build,rows,0,1,[0,1,0],'stairs');
  strip(build,rows,1,2,[0,1,direction],'stairs');
  strip(build,rows,2,3,[0,0,direction],'stairs');
  strip(build,rows,3,4,[0,-1,direction],'door');
  strip(build,rows,4,5,[0,-1,0],'stairs');
  // The riser sits behind the worn lip.
  build.box(x,y-.154,z-direction*.043,width,.19,.018,'stairs');
  for(const [i,side] of [[0,-1],[count,1]]){
    const r=rows[i];
    strip(build,[[r[0],r[1]],[r[5],r[3]]],0,1,[side,0,0],'stairs');
  }
}

// Outlines traced from the surviving topcoat in the stairwall photograph.
// Coordinates refer to the same square image sampled by the plaster material.
const flakeContours = [
  [464,58,470,75,468,89,474,93,474,103,472,101,465,101,462,108,456,113,452,106,445,108,442,105,440,96,433,97,429,93,428,100,423,99,422,83,425,80,422,76,419,85,417,85,415,79,411,85,411,89,417,90,417,93,422,97,420,105,414,112,414,118,421,123,425,123,434,114,435,121,432,123,433,128,430,134,419,139,417,134,411,131,404,131,401,126,375,127,375,124,380,122,381,116,391,116,391,124,414,123,414,120,408,119,403,113,400,108,401,105,396,103,397,99,395,99,396,95,392,87,393,83,385,86,382,92,377,89,377,86,384,81,384,76,391,77,391,72,398,73,405,67,415,69,415,76,419,76,422,73,420,66,424,65,424,58,420,58,415,64,410,63,403,66,394,56,396,49,401,49,403,52,421,51,425,54,426,50,424,50,423,44,430,32,440,32,444,27,453,29,465,28,472,36,472,45,467,56],
  [314,460,312,461,312,469,310,470,307,485,303,487,302,491,290,493,290,486,288,485,287,478,282,474,282,469,283,465,292,461,292,451,288,449,286,455,281,458,278,453,284,454,288,441,294,438,293,429,299,432,307,432,310,422,315,423,316,420,327,420,331,427,327,436,330,444,328,452,331,455,331,459,328,459,324,464],
  [451,268,449,268,450,279,448,280,448,285,442,282,432,284,429,279,412,279,410,276,403,274,404,269,426,269,428,271,444,269,444,264,438,261,441,250,445,248,449,254,458,237,456,233,460,232,468,234,468,238,473,240,476,246,478,263,480,259,486,258,489,258,492,263,501,263,501,268,490,267,488,272,481,268,476,273,472,273,472,275,476,274,478,280,472,277,471,281,464,280,461,284,456,284,453,281],
  [403,84,399,85,401,87,399,95,396,94,397,90,393,88,393,82,386,85,383,91,377,88,378,85,385,81,385,76,387,80,390,78,394,79,394,75,391,75,391,73,397,74,406,68,408,70,414,69,414,76,420,76,420,81,417,83,417,80,414,78,408,91,416,90,421,95,422,100,419,106,415,110,409,110,409,113,414,112,415,120,421,123,426,123,432,119,433,115,435,116,434,122,431,123,433,128,428,136,423,135,419,138,417,133,402,127,402,125,412,125,414,123,414,120,404,113,406,109,402,108,404,103,411,99,411,96,406,94,406,91,402,88],
];

function flake(build, position, normal, index, scale, turn) {
  const source=flakeContours[index], outline=[];
  for(let i=0;i<source.length;i+=2) outline.push(new THREE.Vector2(source[i],-source[i+1]));
  const bounds=new THREE.Box2().setFromPoints(outline),center=bounds.getCenter(new THREE.Vector2());
  const triangles=THREE.ShapeUtils.triangulateShape(outline,[]);
  const tangent=[normal[2],0,-normal[0]], cs=Math.cos(turn), sn=Math.sin(turn);
  const p=[],uv=[],indices=[],n=outline.length;
  for(let rim=0;rim<2;rim++) for(const v of outline){
    const u=(v.x-center.x)*scale, h=(v.y-center.y)*scale;
    const a=u*cs-h*sn, b=u*sn+h*cs;
    const lift=rim ? .004+scale*(.82+1.7*fracture(u*4,turn)+1.0*Math.max(0,b)) : .0008;
    p.push(position[0]+tangent[0]*a+normal[0]*lift,position[1]+b,position[2]+tangent[2]*a+normal[2]*lift);
    uv.push(2.5*v.x/512,2.5*(1+v.y/512));
  }
  for(const [a,b,c] of triangles) indices.push(a+n,b+n,c+n);
  for(let i=0;i<n;i++){
    const j=(i+1)%n;
    // The traced outer contour winds clockwise in the source photograph.
    indices.push(i,i+n,j+n,i,j+n,j);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2)); g.setIndex(indices);
  g.computeVertexNormals();
  build.add(g,build.material('stairwall'));
}

export function wallWear(build) {
  // The width of the loose screed shrinks to zero where the floor joint is sound.
  function screed(x,normal,from,to,seed){
    const count=Math.ceil((to-from)/.037), rows=[];
    for(let i=0;i<=count;i++){
      const z=from+(to-from)*i/count;
      const pocket=clamp(.29+.50*Math.sin(z*2.09+seed)+.32*Math.cos(z*3.67),0,1);
      const grain=fracture(z*.86,seed);
      const h=pocket*(.020+.118*grain),depth=pocket*(.006+.020*grain);
      rows.push([[x+normal*.001,.004+h,z],[x+normal*(.001+depth*.15),.003+h*.91,z],
        [x+normal*(.001+depth*.37),.003+h*.22,z],[x+normal*(.001+depth),.001,z]]);
    }
    strip(build,rows,0,1,[normal,1,0],'plaster');
    strip(build,rows,1,2,[normal,0,0],'stairwall');
    strip(build,rows,2,3,[normal,1,0],'stairs');
  }
  screed(-1.45,1,-12.8,3.44,.6);
  for(const [a,b] of [[-12.8,-7.82],[-6.59,-1.2],[.06,3.44]]) screed(1.446,-1,a,b,1.8);
  // Water lifted the finish below the sills and a leaking elbow on the stair.
  for(const [x,y,z,nx,nz,idx,s,r] of [
    [-1.45,.61,.85,1,0,0,.00155,.18],[-1.45,.46,1.00,1,0,1,.00115,-.63],
    [-1.45,.39,1.07,1,0,3,.00073,-.21],[-1.45,.35,-4.36,1,0,2,.00225,-.19],
    [-1.45,.59,-4.48,1,0,1,.00213,.41],[-1.45,1.56,-6.02,1,0,0,.0022,-.27],
    [-1.45,1.37,-6.12,1,0,3,.00175,-.69],[-1.45,1.21,-6.14,1,0,1,.00093,-.83],
    [3.86,.91,-3.049,0,1,0,.0032,.14],[3.69,.74,-3.049,0,1,3,.0018,.58],
    [4.01,.49,-3.049,0,1,1,.0019,-.55],[4.13,.48,-3.049,0,1,3,.0009,.51],
    [4.38,1.31,-9.699,0,1,2,.00316,.78],[4.51,1.46,-9.699,0,1,1,.00152,.3],
    [-3.448,1.26,-14.47,1,0,0,.00361,-.16],[-3.448,1.00,-14.60,1,0,2,.00176,.35],
    [-3.448,.90,-14.73,1,0,1,.00121,-.47],
  ]) flake(build,[x,y,z],[nx,0,nz],idx,s,r);
}
