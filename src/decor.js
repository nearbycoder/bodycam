import * as THREE from 'three';
import { loadQualityTexture, cloneQualityTexture } from './texture-quality.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const halfTurn = Math.PI / 2;

function putPaint(scene, load) {
  const tags = [
    ['loops', 1.437, 1.49, -9.92, -halfTurn, 3.53, 1.59],
    ['oxblood', -1.437, 1.40, -11.86, halfTurn, 1.85, 1.17],
    ['chalk', -1.436, 2.09, -11.78, halfTurn, .73, .30],
    ['chalk', -1.437, 1.80, -2.15, halfTurn, .32, .16],
    ['loops', -1.437, 1.39, 2.45, halfTurn, 1.20, 1.25],
    ['mural', 1.02, 1.61, -19.337, 0, 3.10, 1.53],
    ['chalk', -3.437, 2.08, -15.95, halfTurn, 1.15, .62],
    ['upper', 2.637, 4.86, -15.33, -halfTurn, 3.20, 1.48],
    ['oxblood', .99, 4.70, -13.017, Math.PI, 2.69, 1.42],
    ['bubble', 1.63, 4.78, -19.337, 0, 1.8, 1.02],
    ['room-tag', 3.60, 1.58, -9.686, 0, 2.5, 1.45],
    ['pencil', 5.466, .98, -2.16, -halfTurn, .38, .21]
  ];
  const materials = new Map();
  for (const [name, x,y,z, angle,w,h] of tags) {
    if (!materials.has(name)) {
      materials.set(name, new THREE.MeshStandardMaterial({
        map: load(name), transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, roughness: 1,
      }));
    }
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w,h), materials.get(name));
    plane.position.set(x,y,z);
    plane.rotation.y = angle;
    plane.receiveShadow = true;
    scene.add(plane);
  }
}

function debris(scene, map) {
  // All loose paper and masonry share one draw call and a texture atlas.
  let state = 1827023;
  function random() {
    state = (Math.imul(state,1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  }
  const between = (low, high) => low + random() * (high-low);
  const vertices = [], uvs = [], tints = [], indices = [];
  function vertex(point,u,v,col,row,shade) {
    const index=vertices.length/3;
    vertices.push(...point);
    uvs.push((col+.014+.972*u)/4,1-(row+.014+.972*v)/4);
    tints.push(shade,shade,shade);
    return index;
  }
  function quad(a,b,c,d) { indices.push(a,b,d,b,c,d); }
  const shadowPoints = [], shadowUvs = [];
  function contact(x,y,z,rx,rz) {
    for (const [u,v] of [[0,0],[0,1],[1,0],[1,0],[0,1],[1,1]]) {
      shadowPoints.push(x+(u-.5)*rx*2,y+.0025,z+(v-.5)*rz*2);
      shadowUvs.push(u,v);
    }
  }
  function illumination(x,z) {
    const run=(x+1.45);
    const depth=run*1.07;
    const windowZ=z-run*.42;
    if (depth<.87 || depth>2.66 || x>1.45 || x< -1.45) return 1;
    for (const center of [0,-4.45,-8.9]) {
      const a= Math.abs(windowZ-center);
      if(a<1.28 && a>.045 && Math.abs(depth-1.79)>.046) return 2.4;
    }
    return 1;
  }
  function rock(x,y,z,r) {
    const chunky = r>.019 && random()<.38;
    const count = chunky ? Math.floor(between(6,10)) : Math.floor(between(4,8));
    const angle=between(-Math.PI,Math.PI), c=Math.cos(angle), s=Math.sin(angle);
    const stretch=between(.77,1.64), squeeze=between(.54,1);
    const h=r*(chunky ? between(.53,1.05) : between(.14,.42));
    const dx=between(-.20,.20), dz=between(-.20,.20), slope=between(-.26,.26);
    const col=Math.floor(random()*4), light=between(.64,1.1)*illumination(x,z);
    const exposure=between(.19,.36), u0=between(.38,.62), v0=between(.38,.62);
    const ring=[];
    for(let n=0;n<count;n++) {
      const a=(n+between(-.16,.16))*2*Math.PI/count;
      const rad=between(.73,1.12);
      const u=Math.sin(a)*rad, v=Math.cos(a)*rad;
      const cap=chunky ? between(.51,.83) : between(.77,.98);
      ring.push({u,v,cap,shoulder:between(.44,.69),y:between(.89,1.09)+u*slope});
    }
    function point(u,v,elevation) {
      return [x+r*(c*u*stretch-s*v*squeeze),y+h*elevation,z+r*(s*u*stretch+c*v*squeeze)];
    }
    function sample(n,level) {
      const v=ring[n], r0=level===0 ? .90 : level===1 ? 1 : v.cap;
      const u=v.u*r0+(level===2 ? dx : 0), w=v.v*r0+(level===2 ? dz : 0);
      const elevation=level===0 ? .032 : level===1 ? v.shoulder : v.y;
      return vertex(point(u,w,elevation),u0+exposure*u,v0+exposure*w,col,0,light*(.74+.23*elevation));
    }
    const mid=vertex(point(dx,dz,1.08),u0+dx*exposure,v0+dz*exposure,col,0,light);
    const cap=ring.map((v,n)=>sample(n,2));
    if(chunky) {
      // A rounded, weathered shoulder under the angular fracture plane.
      const skirt=ring.map((v,n)=>sample(n,0)), shoulder=ring.map((v,n)=>sample(n,1));
      const bevel=ring.map((v,n)=>sample(n,2));
      for(let n=0;n<count;n++){
        const next=(n+1)%count;
        quad(skirt[n],skirt[next],shoulder[next],shoulder[n]);
        quad(shoulder[n],shoulder[next],bevel[next],bevel[n]);
      }
    } else {
      // Thin pieces of detached plaster keep their sharp, freshly broken rims.
      for(let n=0;n<count;n++){
        const next=(n+1)%count;
        quad(sample(n,0),sample(next,0),sample(next,2),sample(n,2));
      }
    }
    for(let n=0;n<count;n++) indices.push(mid,cap[n],cap[(n+1)%count]);
    if (r>.035) contact(x,y,z,r*stretch*1.48,r*1.30);
  }
  function paper(x,y,z,scale) {
    const width=between(.145,.255)*scale, depth=width*between(.69,1.50);
    const ang=between(-Math.PI,Math.PI), c=Math.cos(ang), s=Math.sin(ang);
    y+=between(.004,.013);
    const col=Math.floor(random()*4), shade=between(.61,.96)*illumination(x,z);
    const crease=between(.20,.75), rise=between(.006,.047)*scale;
    const curl=between(-.008,.048)*scale, torn=between(.018,.15);
    const n=4, grid=[];
    for(let j=0;j<=n;j++) for(let i=0;i<=n;i++) {
      let u=i/n, v=j/n;
      if (i===0) u+=between(0,torn);
      else if(i===n) u-=between(0,.04);
      if (j===0) v+=between(0,.045);
      else if(j===n) v-=between(0,.065);
      const a=(u-.5)*width,b=(v-.5)*depth;
      const fold=Math.exp(-Math.abs(u+v*.29-crease)*8)*rise*(.22+.78*v);
      const lift=Math.max(0,curl*Math.pow(1-u,3)*(1-v));
      grid.push(vertex([x+c*a-s*b,y+fold+lift,z+s*a+c*b],u,v,col,1,shade));
    }
    for(let j=0;j<n;j++) for(let i=0;i<n;i++) {
      const q=j*(n+1)+i;
      quad(grid[q],grid[q+n+1],grid[q+n+2],grid[q+1]);
    }
    contact(x,y-.004,z,width*.68,depth*.68);
  }

  for (let i=0;i<470;i++) {
    const z=between(-13.3,3.3);
    const x=random()<.71 ? (random()<.5?-1:1)*between(.97,1.41) : between(-1.4,1.4);
    rock(x,0,z,.008+Math.pow(random(),2.1)*.091);
  }
  for (const [x,z,spread] of [[1.23,-5.92,.52],[-1.18,-8.19,.64],[1.18,-11.83,.73],[-1.16,-1.1,.47]]) {
    for (let i=0;i<42;i++) {
      const offset=between(-1,1);
      const xx=THREE.MathUtils.clamp(x+between(-.32,.32),-1.39,1.39);
      rock(xx,.018*(1-offset*offset),z+offset*spread,between(.03,.12));
    }
  }
  for (let i=0;i<104;i++) paper(between(-1.37,1.37),0,between(-13.14,3.34),between(.62,1.45));
  for (let i=0;i<97;i++) {
    const x=between(-3.33,2.55), z=between(-19.17,-13.17);
    rock(x,0,z,between(.012,.102));
    if (i%3===0) paper(x,0,z,between(.8,1.38));
  }
  // Loose plaster along the edge of the upper landing and around the base of the first flight.
  for (let i=0;i<52;i++) {
    rock(between(-3.28,2.5),3.2,between(-14.54,-13.17),between(.013,.075));
    rock(between(-3.3,-2.65),0,between(-14.43,-13.53),between(.018,.09));
  }
  // Concrete chips collect against the stringers on the switchback.
  for (let step=0;step<10;step++) {
    for (let j=0;j<5;j++) {
      const z=-14.6-(step+between(.17,.82))*.325;
      rock(between(-3.37,-2.9),.16*(step+1),z,between(.016,.078));
      rock(between(-1.47,-1.15),3.2-.16*step,z,between(.014,.068));
    }
  }
  for (let i=0;i<38;i++) rock(between(-3.36,-.15),1.6,between(-19.19,-17.91),between(.01,.063));
  for (const center of [-.55,-7.2]) {
    for (let i=0; i<92; ++i) {
      const x=between(1.63,4.52),z=center+between(-1.28,1.26);
      rock(x,0,z,between(.013,.12));
      if (i%4===0) paper(x,0,z,between(.63,1.35));
    }
  }
  contact(1.28,0,-17.51,.76,.69);
  contact(.38,0,-17.03,.44,.66);
  contact(4.56,0,-.97,.88,1.27);
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(tints,3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({
    map, vertexColors:true, side:THREE.DoubleSide, roughness:.94,
  }));
  mesh.name='Loose plaster and folded sheets';
  mesh.receiveShadow=true;
  scene.add(mesh);

  const size=32,data=new Uint8Array(size*size*4);
  for(let j=0;j<size;j++) for(let i=0;i<size;i++){
    const d=Math.hypot((i+.5)/size*2-1,(j+.5)/size*2-1);
    data[(j*size+i)*4+3]=Math.round(91*Math.pow(Math.max(0,1-d*d),2));
  }
  const shadowMap=new THREE.DataTexture(data,size,size);
  shadowMap.magFilter=THREE.LinearFilter;
  shadowMap.minFilter=THREE.LinearFilter;
  shadowMap.needsUpdate=true;
  const shadows=new THREE.BufferGeometry();
  shadows.setAttribute('position',new THREE.Float32BufferAttribute(shadowPoints,3));
  shadows.setAttribute('uv',new THREE.Float32BufferAttribute(shadowUvs,2));
  const contactMesh=new THREE.Mesh(shadows,new THREE.MeshBasicMaterial({map:shadowMap,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1}));
  scene.add(contactMesh);
}

function landingFurniture(scene, atlas) {
  const chair=new THREE.Group();
  chair.rotation.y=.45;
  chair.position.set(1.28,0,-17.51);
  scene.add(chair);
  // Upholstery varies across the surface. The crest and the far wing are both torn.
  function fabric(col) {
    const texture=cloneQualityTexture(atlas);
    texture.repeat.set(.245,.245);
    texture.offset.set(col*.25+.0025,.2525);
    return new THREE.MeshStandardMaterial({map:texture,roughness:.97,side:THREE.DoubleSide});
  }
  const teal=fabric(0),wool=fabric(1),shadowGreen=fabric(2),wood=fabric(3);
  function round(parent, size, pos, mat, radius,rot=0) {
    const geom=new RoundedBoxGeometry(...size,2,radius);
    const m=new THREE.Mesh(geom,mat);
    m.position.set(...pos);m.rotation.z=rot;m.castShadow=m.receiveShadow=true;parent.add(m);
    return m;
  }
  for (const x of [-.38,.38]) for (const z of [-.32,.35]) {
    round(chair,[.083,.18,.095],[x,.08,z],wood,.012);
  }
  round(chair,[.98,.28,.91],[0,.258,.0],teal,.045);
  round(chair,[.79,.17,.70],[0,.444,.073],shadowGreen,.07,-.021);
  round(chair,[.775,.10,.69],[0,.513,.08],teal,.042,-.023);
  for (const side of [-1,1]){
    round(chair,[.135,.37,.86],[.439*side,.495,-.01],teal,.048);
    const arm=round(chair,[.145,.083,.84],[.438*side,.681,-.015],shadowGreen,.035);
    arm.rotation.x=.047;
  }
  const crest=[[-.45,.53],[-.49,1.12],[-.43,1.02],[-.35,1.04],[-.31,1.01],[-.22,1.03],[-.17,1.10],[-.07,1.075],[.04,1.09],[.14,1.045],[.29,1.005],[.38,1.02],[.47,1.13],[.45,.50]];
  const outline=new THREE.Shape(crest.map(([x,y])=>new THREE.Vector2(x,y)));
  const backGeometry=new THREE.ExtrudeGeometry(outline,{depth:.095,bevelEnabled:true,bevelSize:.013,bevelThickness:.015,bevelSegments:1});
  const backUV=backGeometry.getAttribute('uv'), backPos=backGeometry.getAttribute('position');
  for(let i=0;i<backPos.count;i++) {
    backUV.setXY(i,THREE.MathUtils.clamp(backPos.getX(i)+.50,0,1),THREE.MathUtils.clamp((backPos.getY(i)-.48)*1.45,0,1));
  }
  const back=new THREE.Mesh(backGeometry,teal);
  back.position.z=-.41; back.rotation.x=-.065;back.castShadow=true;chair.add(back);
  for (const [x,y,z] of [[-.42,.56,.13],[.43,.59,-.08],[-.12,.84,-.36],[.31,.32,.455]]) {
    round(chair,[.035,.024,.013],[x,y,z],shadowGreen,.009,.3);
  }

  const roll=new THREE.Group();
  roll.position.set(.38,.315,-17.03); roll.rotation.y=.18;scene.add(roll);
  // The carpet is rolled round a hollow centre, with exposed seams on both ends.
  const pts=[],uv=[];
  const angular=84,len=.92;
  function point(t,side) {
    const a=t*Math.PI*2*3.35;
    const r=.044+(.282-.044)*t;
    const rough=1+.033*Math.cos(a*3+.71)+.018*Math.sin(a*7);
    return [Math.sin(a)*r*rough,Math.cos(a)*r*.94,side*len*.5+.016*Math.sin(a*3)];
  }
  function face(v0,v1,v2,v3){
    for (const v of [v0,v1,v2,v0,v2,v3]) pts.push(...v);
    uv.push(0,0,1,0,1,1,0,0,1,1,0,1);
  }
  for(let i=0;i<angular;i++){
    const t0=i/angular,t1=(i+1)/angular;
    const al=point(t0,-1),ar=point(t0,1),bl=point(t1,-1),br=point(t1,1);
    face(al,ar,br,bl);
    for (const side of [-1,1]) {
      const a=point(t0,side),b=point(t1,side);
      const aa=[a[0]*.92,a[1]*.92,a[2]],bb=[b[0]*.92,b[1]*.92,b[2]];
      face(a,b,bb,aa);
    }
  }
  const carpet=new THREE.BufferGeometry();
  carpet.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));
  carpet.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));carpet.computeVertexNormals();
  roll.add(new THREE.Mesh(carpet,wool));
  for (const z of [-.30,.28]) {
    const binding=new THREE.Mesh(new THREE.TorusGeometry(.275,.011,6,28),wood);
    binding.position.z=z;binding.scale.y=.93;roll.add(binding);
  }
  const flap = round(roll,[.26,.036,.80],[.09,.258,-.02],wool,.015,.31);
  flap.rotation.x=-.068;

  // Broken timber supports a rumpled length of black sheeting below the room window.
  const junk=new THREE.Group();
  junk.position.set(4.56,.016,-.97); junk.rotation.y=.13;
  scene.add(junk);
  for (let i=0;i<5;i++) {
    const beam=round(junk,[.12,.068,1.9-i*.097],[-.46+i*.19,.055+i*.014,-.08],wood,.009);
    beam.rotation.y=.23*Math.sin(i*2.1);
  }
  const sheet=new THREE.PlaneGeometry(1.28,2.30,23,33);
  sheet.rotateX(-Math.PI*.5);
  const verts=sheet.getAttribute('position');
  for (let i=0;i<verts.count;i++) {
    const x=verts.getX(i), z=verts.getZ(i);
    const envelope=Math.max(0,1-Math.pow(Math.abs(x/.68),3))*Math.max(0,1-Math.pow(Math.abs(z/1.19),4));
    const crest=.068*Math.sin(18*x+3*z)+.042*Math.cos(31*z+2*x)+.028*Math.sin(56*x*z+6*z);
    verts.setY(i,.035+envelope*(.32+crest+.12*Math.sin(4*z)));
  }
  sheet.computeVertexNormals();
  const tarp=new THREE.Mesh(sheet,new THREE.MeshStandardMaterial({color:0x1c1b1a,roughness:.30,metalness:.13,side:THREE.DoubleSide}));
  junk.add(tarp);
}

export function addDecor(scene) {
  function load(name) {
    const texture=loadQualityTexture('decor/'+name+'.webp');
    texture.colorSpace=THREE.SRGBColorSpace;
    texture.anisotropy=8;
    return texture;
  }
  putPaint(scene,load);
  const atlas=load('debris');
  debris(scene,atlas);
  landingFurniture(scene,atlas);
}
