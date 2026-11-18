import * as THREE from 'three';
import { weatheredMetal } from './surface-detail.js';
import { loadQualityTexture } from './texture-quality.js';

function swept(build, coordinates, radius, kind, closed=false, segments=20) {
  const path=new THREE.CatmullRomCurve3(coordinates.map(p=>new THREE.Vector3(...p)),closed);
  build.add(new THREE.TubeGeometry(path,segments,radius,9,closed),build.material(kind),true);
}

export function radiator(build,z) {
  const {add,rod,box,material}=build;
  const paint=material('heater');
  for (let i=0; i<14; i++) {
    const center=z-.546+i*.084;
    // Each casting has a hollow throat and two bulbous manifold ends.
    const loop=[[-1.375,.208,center],[-1.385,.356,center],[-1.380,.665,center],
      [-1.362,.731,center],[-1.327,.749,center],[-1.296,.718,center],
      [-1.290,.606,center],[-1.293,.315,center],[-1.304,.203,center],[-1.342,.178,center]];
    swept(build,loop,.027,'heater',true,30);
    for(const y of [.207,.716]) {
      const boss = new THREE.SphereGeometry(1,14,10);
      boss.scale(.070,.050,.039).translate(-1.34,y,center);
      add(boss,paint,true);
      if(i<13) rod([-1.342,y,center+.013],[-1.342,y,center+.070],.025,'heater',.025,14);
    }
  }
  for(const offset of [-.63,.63]) {
    const end=z+offset;
    for(const y of [.207,.716]){
      rod([-1.342,y,end-.05],[-1.342,y,end+.042],.040,'rust',.040,6);
      rod([-1.342,y,end-.024],[-1.342,y,end+.010],.044,'pipe',.044,14);
    }
  }
  for(const offset of [-.37,.39]) {
    box(-1.421,.452,z+offset,.056,.152,.061,'iron');
    box(-1.381,.401,z+offset,.120,.029,.050,'pipe');
    rod([-1.411,.457,z+offset],[-1.347,.403,z+offset],.010,'iron');
  }
  swept(build,[[-1.342,.207,z+.65],[-1.342,.207,z+.747],
    [-1.354,.188,z+.795],[-1.370,.143,z+.797],[-1.370,.018,z+.797]],.020,'pipe');
  rod([-1.370,.018,z+.797],[-1.370,.059,z+.797],.029,'rust',.029,10);
  swept(build,[[-1.342,.716,z-.647],[-1.342,.716,z-.758],
    [-1.365,.682,z-.79],[-1.391,.671,z-.82],[-1.443,.671,z-.82]],.018,'pipe');
  rod([-1.35,.718,z-.74],[-1.322,.773,z-.74],.011,'iron',.011,12);
  const wheel=new THREE.TorusGeometry(.043,.006,8,22);
  wheel.rotateX(-Math.PI*.5).rotateZ(-.28).translate(-1.322,.770,z-.74);
  add(wheel,material('rust'),true);
  for(let i=0; i<3; i++) {
    const a=i*2*Math.PI/3;
    rod([-1.322,.770,z-.74],[-1.322+.041*Math.cos(a),.770-.012*Math.cos(a),z-.74+.041*Math.sin(a)],.004,'iron');
  }
}

export function intakeFixtures(build) {
  const {box,rod,add,material}=build;
  const steel=weatheredMetal(material('enamel'));
  // An open service cabinet in the intake room. The door, its return flanges
  // and the hinge barrels all occupy their own planes.
  const x=4.66,y=1.39,z=-3.01;
  box(x,y,z,.62,.83,.058,'iron');
  for(const s of [-1,1]) {
    box(x+s*.299,y,z+.063,.017,.83,.131,'enamel');
    box(x,y+s*.406,z+.061,.60,.018,.132,'enamel');
  }
  const hinge=new THREE.Matrix4().makeRotationY(-1.16);
  hinge.setPosition(x+.306,y,z+.125);
  function foldedPart(px,py,pz,w,h,d,mat) {
    const part=new THREE.BoxGeometry(w,h,d);
    part.translate(px,py,pz).applyMatrix4(hinge);
    add(part,mat,true);
  }
  foldedPart(.286,0,0,.569,.798,.013,steel);
  for(const py of [-.392,.392]) foldedPart(.29,py,-.013,.569,.014,.034,steel);
  foldedPart(.558,0,-.014,.016,.776,.036,steel);
  foldedPart(.484,-.02,.013,.024,.069,.024,material('iron'));
  const paper=loadQualityTexture('decor/debris.webp',{colorSpace:THREE.SRGBColorSpace});
  const card=new THREE.PlaneGeometry(.184,.132,3,3);
  const uv=card.attributes.uv, positions=card.attributes.position;
  for(let i=0;i<uv.count;i++) {
    const u=uv.getX(i),v=uv.getY(i);
    uv.setXY(i,.005+u*.238,.501+v*.245);
    positions.setZ(i,.002+.006*Math.pow(u*(1-v),3));
  }
  card.translate(.31,.14,.009).applyMatrix4(hinge);
  add(card,new THREE.MeshStandardMaterial({map:paper,color:0xc2b087,vertexColors:true,roughness:.97}));
  const ceramic=new THREE.MeshStandardMaterial({color:0xdacdb1,roughness:.42,vertexColors:true});
  function fuseFace(x0,y0){
    const shell=new THREE.LatheGeometry([[0,0],[.024,0],[.030,.006],[.031,.014],[.029,.019],
      [.026,.021],[.026,.028],[.022,.031],[0,.031]].map(([r,h])=>new THREE.Vector2(r,h)),20);
    shell.rotateX(Math.PI/2).translate(x0,y0,z+.086);
    add(shell,ceramic,true);
    rod([x0,y0,z+.111],[x0,y0,z+.12],.013,'rust',.013,16);
  }
  for(const p of [-.293,.287]) rod([x+.307,y+p-.048,z+.122],[x+.307,y+p+.048,z+.122],.015,'rust',.015,14);
  for(const row of [-.12,.14]) {
    box(x,y+row,z+.044,.46,.146,.033,'wire');
    for(let i=0;i<4;i++){
      const x0=x-.161+i*.105;
      box(x0,y+row,z+.066,.074,.112,.037,'heater');
      fuseFace(x0,y+row+.011);
      swept(build,[[x0,y+row-.049,z+.070],[x0+.012,y+row-.098,z+.063],
        [x0+.030,y+row-.122,z+.043],[x0+.035,y+row-.171,z+.042]],.005,'wire',false,10);
    }
  }
  for(const offset of [-.157,-.094]){
    swept(build,[[x+offset,y+.395,z+.049],[x+offset,y+.61,z+.046],
      [x+offset-.082,y+.72,z+.039],[x+offset-.107,2.81,z+.038],
      [x+offset-.18,3.002,z+.040],[x-.43,3.055,z+.046]],.018,'pipe');
    for(const centerY of [1.96,2.37,2.83]) {
      const correction=centerY>2.13?.105:0;
      box(x+offset-correction,centerY,z+.017,.092,.030,.036,'rust');
    }
  }
  // Loose cable falls in a soft catenary where its wall clip is gone.
  swept(build,[[2.605,2.78,-17.92],[2.597,2.40,-17.78],[2.557,2.17,-17.59],
    [2.529,2.09,-17.34],[2.546,2.21,-17.03],[2.601,2.62,-16.73],
    [2.614,2.71,-16.53],[2.614,2.69,-15.71]],.010,'wire',false,44);
  for(const center of [-17.92,-16.53,-15.71]) box(2.625,center===-17.92?2.78:2.70,center,.039,.066,.046,'rust');
}
