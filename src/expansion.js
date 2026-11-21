import * as THREE from 'three';
import { loadQualityTexture } from './texture-quality.js';
import {weatheredMetal} from './surface-detail.js';
import { construction } from './construction.js';
import { installRoofDaylight } from './roof-daylight.js';
import { plantDetails } from './plant-details.js';
import { fixtureLighting } from './fixture-light.js';
import { daylightGlazing } from './glazing.js';
import { fitScannedSurface, shadeScannedSurface } from './scanned-surfaces.js';
import { surface } from './materials.js';
import { parkCoupe, motorBay } from './vehicle.js';

const levelHeight = 3.2;
const floors = [
  {y:-3.2, code:'B1', name:'Utility basement', tint:0x71968a, band:[.30,.52,.45],
    rooms:['Pump room','Boiler room','Valve shop','Service stores']},
  {y:0, code:'G', name:'Works gallery', tint:0xb9a36c, band:[.64,.51,.30],
    rooms:['Motor bay','Switchgear',null,'Dispatch']},
  {y:3.2, code:'01', name:'Records gallery', tint:0x89a1ac, band:[.39,.54,.58],
    rooms:['Document intake','Archive stacks','Survey office','Map room']},
  {y:6.4, code:'02', name:'Roof plant', tint:0xa9a195, band:[.52,.51,.46], rooms:[]},
];
function inRect(x,z,r){
  if(r.angle){
    const dx=x-r.cx,dz=z-r.cz;
    x=r.cx+dx*r.cos-dz*r.sin;
    z=r.cz+dx*r.sin+dz*r.cos;
  }
  return x>=r.x0 && x<=r.x1 && z>=r.z0 && z<=r.z1;
}
const near = (a,b) => Math.abs(a-b)<.32;
const levelFor = y => Math.min(3,Math.max(0,Math.round(y/levelHeight)+1));

function makeSign(label,code,accent,sideText='EAST ANNEX'){
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=176;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#282e2c';ctx.fillRect(0,0,640,176);ctx.fillStyle=accent;
  ctx.fillRect(4,4,16,168);
  ctx.font='bold 24px monospace';ctx.fillStyle='#c0c2b3';ctx.fillText(code+'   /   '+sideText,40,45);
  ctx.font='bold 55px Arial, sans-serif';ctx.fillStyle='#e0dfc9';ctx.fillText(label.toUpperCase(),38,120,569);
  ctx.fillStyle='#8b8e80';for(const x of [9,630])for(const y of [10,166]){
    ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fill();
  }
  for(let k=0;k<1400;k++){
    const x=(k*107+k*k)%640,y=(k*61+k*k*13)%176;
    ctx.fillStyle=k%3?'rgba(16,21,20,.15)':'rgba(218,215,193,.2)';ctx.fillRect(x,y,k%5+1,1);
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
  return new THREE.MeshStandardMaterial({map:texture,roughness:.86, emissive:0x777765,emissiveMap:texture,emissiveIntensity:.10});
}

// A different painted dado, damp line and window projection identify each floor.
// All positions are world-space so light and paint continue across joined walls.
function annexSkin(kind,floor){
  const structure = {wall:'plaster',slab:'floor',membrane:'stairs',lid:'ceiling',concrete:'stairs',wood:'door'};
  if(structure[kind]){
    const m=surface(structure[kind]).clone();
    const scan = {slab:'floor', lid:'wall', concrete:'wall', membrane:'bitumen', wall:'plaster'}[kind];
    if(scan)fitScannedSurface(m,scan);
    m.onBeforeCompile=shader=>{
      shader.uniforms.storey={value:floor.y};shader.uniforms.paintTone={value:new THREE.Vector3(...floor.band)};
      shader.vertexShader='varying vec3 annexPoint;\n'+shader.vertexShader.replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nannexPoint=(modelMatrix*vec4(transformed,1.)).xyz;');
      shader.fragmentShader='varying vec3 annexPoint;uniform vec3 paintTone;uniform float storey;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`
        #include <color_fragment>
        vec3 p=annexPoint;
        float height=p.y-storey;
        float mottling=clamp(dot(diffuseColor.rgb,vec3(.31,.57,.12))*3.,0.,1.);
        ${kind==='slab'?`
        vec2 section=floor((p.xz+vec2(.31,.0))/vec2(1.58,3.28));
        vec2 edge=abs(fract((p.xz+vec2(.31,.0))/vec2(1.58,3.28))-.5);
        float joint=smoothstep(.486,.499,max(edge.x,edge.y));
        float variation=fract(sin(dot(section,vec2(17.93,67.18)))*5718.);
        diffuseColor.rgb*=.86+.18*variation-.30*joint;
        ` : ''}
        ${kind==='wall'?`
        float worn=smoothstep(.18,.87,mottling+sin(p.x*35.+p.z*41.+p.y*27.)*.075);
        float dado=(1.-smoothstep(1.20,1.23,height)) * smoothstep(.03,.06,height);
        diffuseColor.rgb*=mix(vec3(1.),paintTone*1.33,dado*(1.-worn*.62));
        float border=1.-smoothstep(.012,.024,abs(height-1.248));
        diffuseColor.rgb*=1.-border*(1.-worn*.5)*.58;
        diffuseColor.rgb*=.55+.45*smoothstep(0.,.29,height+.12*worn);
        ` : ''}
      `);
      shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
        ${kind==='slab'?`
        if(storey<6.3 && abs(height)<.06 && p.x>5.73 && p.x<23.01){
          vec3 reflection=reflect(normalize(p-cameraPosition),vec3(0.,1.,0.));
          vec2 spot=p.xz+reflection.xz*(2.893-height)/max(reflection.y,.001);
          bool inHall=spot.y> -8.9 && spot.y< -5.5;
          float rightRoom=step(14.36,spot.x);
          float roomNo=rightRoom+2.*step(-5.50,spot.y);
          float roomZ=spot.y< -8.9 ? -12.425 : -1.8;
          float west=7.93+8.73*rightRoom, east=12.26+8.74*rightRoom;
          float lampX=inHall ? clamp(7.45+4.2*floor((spot.x-7.45)/4.2+.5),7.45,20.05)
                             : (abs(spot.x-east)<abs(spot.x-west)?east:west);
          bool lit=inHall ? (abs(lampX-11.65)>.1 || storey>0.)
                          : (lampX==west || mod(roomNo+floor(storey/3.2+.5)+1.,3.)>.5);
          float distLamp=length(vec2(max(0.,abs(spot.x-lampX)-(inHall?.90:.82)),spot.y-(inHall?-7.2:roomZ)));
          float wetSheen=clamp((.63-roughnessFactor)*1.83,.02,.86);
          if(lit)outgoingLight+=vec3(.93,1.,.95)*.47*exp(-distLamp*6.)*wetSheen*step(.03,reflection.y);
        }
        `:''}
        float endWall=min(abs(p.z+15.75),abs(p.z-1.70));
        float reach=p.z< -8.9 ? p.z+15.75 : 1.70-p.z;
        float windowX=mod(p.x-6.18+reach*.41,4.12)-2.06;
        vec2 ray=vec2(windowX,height+reach*.74-2.10);
        vec2 field=1.-smoothstep(vec2(1.30,.57),vec2(1.53,.81),abs(ray));
        float pane=smoothstep(.008,.052,min(abs(windowX),abs(ray.y+.085)));
        float spill=field.x*field.y*(.26+.74*pane)*smoothstep(-.05,.06,reach)*(1.-smoothstep(3.3,3.9,reach));
        if(storey>-.1 && storey<6.3)
          outgoingLight+=diffuseColor.rgb*vec3(1.00,1.09,1.20)*(spill*7.5+.45*exp(-endWall*.88));
        #include <opaque_fragment>
      `);
      if(scan)shadeScannedSurface(shader,scan);
    };
    m.customProgramCacheKey=()=> 'annex-skin-'+kind;
    return m;
  }
  const coatings={
    painted:[floor.tint,.72,.20], sheet:[0x5b6261,.64,.49], duct:[0x848b87,.54,.57],
    steel:[0x353d3d,.61,.66], pipework:[0x786c55,.76,.44], valve:[0x965c40,.74,.33],
    filing:[0x626d61,.81,.27], archive:[0x918571,.96,.02], ceramic:[0xc1c3ac,.55,.07],
    rubber:[0x262a29,.91,.04], panel:[0x37423e,.76,.22]
  };
  if(coatings[kind]){
    const [color,roughness,metalness]=coatings[kind];
    const m=new THREE.MeshStandardMaterial({color,roughness,metalness});
    if(metalness>.17)return weatheredMetal(m);
    m.onBeforeCompile=shader=>{
      shader.vertexShader='varying vec3 metalPoint;\n'+shader.vertexShader.replace('#include <worldpos_vertex>','#include <worldpos_vertex>\n metalPoint=(modelMatrix*vec4(transformed,1.)).xyz;');
      shader.fragmentShader='varying vec3 metalPoint;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`
        #include <color_fragment>
        vec3 v=metalPoint;
        vec2 uv=v.xz*.73+vec2(v.y*1.19,-v.y*.64);
        float patina=sin(uv.x*18.+sin(uv.y*20.3))*.042+sin(uv.y*63.+uv.x*53.)*.023;
        float scuff=sin(v.y*52.+v.x*1.6+v.z*.38+.68*sin(uv.y*11.));
        diffuseColor.rgb*=.92+patina+.12*smoothstep(.92,1.,scuff);
      `);
    };
    m.customProgramCacheKey=()=> 'annex-painted-metal';

    return m;
  }
  if(kind==='pane')return daylightGlazing(true);
  if(kind==='tube'||kind==='amber'){
    return new THREE.MeshBasicMaterial({color:kind==='tube'?new THREE.Color(2.5,2.62,2.55):new THREE.Color(3.0,.72,.15)});
  }
}

export function buildAnnex(scene,occluders,addAreaLight){
  const zonesByFloor=[[],[],[],[]],obstaclesByFloor=[[],[],[],[]],targets=[];
  const lights=fixtureLighting(),firstOccluder=occluders.length;
  const floorGroups=[], eastStairGroup=new THREE.Group();
  eastStairGroup.name='East stair shaft';
  scene.add(eastStairGroup);
  const sky=loadQualityTexture('architecture/roof-sky.jpg');
  sky.colorSpace=THREE.SRGBColorSpace;
  sky.mapping=THREE.EquirectangularReflectionMapping;
  scene.background=sky;scene.backgroundRotation.y=Math.PI;
  const muralTextures=new Map();
  function mural(parent,name,x,h,z,yaw,w,height) {
    if(!muralTextures.has(name)){
      const map=loadQualityTexture('decor/'+name+'.webp');
      map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=8;
      muralTextures.set(name,new THREE.MeshStandardMaterial({map,transparent:true,depthWrite:false,roughness:1,polygonOffset:true,polygonOffsetFactor:-1}));
    }
    const plane=new THREE.Mesh(new THREE.PlaneGeometry(w,height),muralTextures.get(name));
    plane.position.set(x,h,z);plane.rotation.y=yaw;parent.add(plane);
  }
  const shadowCanvas=document.createElement('canvas');
  shadowCanvas.width=shadowCanvas.height=96;
  const sc=shadowCanvas.getContext('2d');
  for(let i=0;i<22;i++){
    const inset=i*1.21;
    sc.fillStyle='rgba(4,7,6,.048)';
    sc.fillRect(inset,inset,96-inset*2,96-inset*2);
  }
  const shadowInk=new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1});

  const zone=(x0,x1,z0,z1,y,name)=>zonesByFloor[levelFor(y)].push({x0,x1,z0,z1,y,name});
  const anchor=(x,y,z)=>targets.push({x,y,z});
  // Interior dimensions. Junction volumes bridge the .20m thick wall at a door.
  const x0=5.73,x1=23.0,join=14.26,thick=.20;
  const hallBack=-8.90,hallFront=-5.50,rear=-15.75,front=1.70;
  const stairX=23.20,first=24.96,last=29.0,outer=30.62;
  const midZ=-7.2,floorToRoof=3.08;
  for(const floor of floors){
    const y=floor.y;
    const interior=y<6.4;
    const shade=(x,h,z)=>{
      if(!interior)return .78+.28*Math.min(1,Math.max(0,(h-y)*.9));
      const spill=Math.exp(-Math.min(Math.abs(z-rear),Math.abs(z-front))*.46);
      const contact=Math.max(0,Math.min(h-y,(y+floorToRoof)-h));
      return (y<0?.42:.62)+.31*spill+.12*Math.min(1,contact*2.);
    };
    const floorGroup=new THREE.Group();
    floorGroup.name=floor.name;
    scene.add(floorGroup);
    floorGroups.push(floorGroup);
    const roof=interior?null:floorGroup;
    const {box,rod,finish,add,material}=construction(floorGroup,{
      occluders,spacing:1.23,light:shade,createMaterial:kind=>annexSkin(kind,floor)
    });
    const sign=(parent,label,x,h,z,angle,w=1.20,sideText)=>{
      const mat=makeSign(label,floor.code,'#'+floor.tint.toString(16).padStart(6,'0'),sideText);
      const plaque=new THREE.Mesh(new THREE.PlaneGeometry(w,w*176/640),mat);
      plaque.position.set(x,h,z);plaque.rotation.y=angle;parent.add(plaque);
    };
    const deck=(xa,xb,za,zb,height,kind='slab')=>box((xa+xb)/2,height-.08,(za+zb)/2,xb-xa,.16,zb-za,kind);
    function wall(axis,plane,from,to,out,holes=[],height=floorToRoof,kind='wall',bottom=y){
      const slab=(lo,hi,base,top)=>{
        if(hi-lo<.001||top-base<.001)return;
        if(axis==='x')box(plane+out*thick*.5,(base+top)*.5,(lo+hi)*.5,thick,top-base,hi-lo,kind);
        else box((lo+hi)*.5,(base+top)*.5,plane+out*thick*.5,hi-lo,top-base,thick,kind);
      };
      let edge=from;
      for(const [u,w,base,head] of [...holes].sort((a,b)=>a[0]-b[0])){
        slab(edge,u-w/2,bottom,bottom+height);slab(u-w/2,u+w/2,bottom,bottom+base);
        slab(u-w/2,u+w/2,bottom+head,bottom+height);edge=u+w/2;
      }
      slab(edge,to,bottom,bottom+height);
    }
    function obstacle(x,z,w,d,angle=0){
      const rec={x0:x-w*.5,x1:x+w*.5,z0:z-d*.5,z1:z+d*.5,y,angle};
      if(angle){rec.cx=x;rec.cz=z;rec.cos=Math.cos(angle);rec.sin=Math.sin(angle);}
      obstaclesByFloor[levelFor(y)].push(rec);
      if(roof)return;
      const shadow=new THREE.PlaneGeometry(w+.89,d+.86).rotateX(-Math.PI/2).rotateY(angle);
      shadow.translate(x+.045,y+.004,z+.085);
      add(shadow,shadowInk);
    }
    function hatch(x,z,h,angle,w=1.75){
      // Angle 0 is a door in a wall running along X.
      const tangent=[Math.cos(angle),Math.sin(angle)];
      for(const t of [-w/2,w/2]){
        box(x+t*tangent[0],y+h*.5,z+t*tangent[1],.084,h,.084,'painted');
      }
      box(x,y+h-.03,z,angle===0?w+.09:.09,.085,angle===0?.09:w+.09,'painted');
    }
    function fluorescent(x,z,length=1.50,on=true,targetBox=box,targetRod=rod){
      if(on)lights.strip(x,y+2.893,z,length);
      targetBox(x,y+2.96,z,length+.16,.11,.20,'sheet');
      for(const a of [-.052,.052]){
        targetRod([x-length/2,y+2.893,z+a],[x+length/2,y+2.893,z+a],.017,on?'tube':'ceramic',.017,12);
        for(const side of [-1,1])targetBox(x+side*(length/2-.015),y+2.904,z+a,.041,.063,.046,'ceramic');
      }
    }
    const machinery=plantDetails({add,material},occluders);
    function cabinet(x,z,count=3){
      machinery.cabinet(x,y,z,count);
      obstacle(x,z,.607*count,.64);
    }
    function shelf(x,z,count=2){
      machinery.shelf(x,y,z,count);
      obstacle(x,z,1.79*count,.60);
    }
    function table(x,z){
      box(x,y+.87,z,2.46,.13,.88,'wood');box(x,y+.24,z,2.12,.055,.59,'sheet');
      for(const a of [-1,1])for(const b of [-1,1])box(x+a*1.08,y+.41,z+b*.33,.065,.82,.06,'steel');
      machinery.bench(x,y,z);
      obstacle(x,z,2.4,.85);
    }
    function tank(x,z,r,h){
      machinery.vessel(x,y,z,r,h);
      obstacle(x,z,r*2,r*2);
      // Tanks use a compact proxy in the same list as the architectural blocks.
      const proxy=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,12));
      proxy.position.set(x,y+.15+h*.5,z);proxy.updateMatrixWorld();occluders.push(proxy);
    }
    function switchboard(x,z){
      machinery.switchboard(x,y,z);
      obstacle(x,z,2.45,.66);
    }
    function roofUnit(x,z,w,d){
      machinery.condenser(x,y,z,w,d);
      obstacle(x,z,w+.10,d+.13);
    }
    const doorway=(center,width)=>[center,width,0,2.44];
    if(interior){
      const midZ=(hallBack+hallFront)/2;
      zone(x0,x1,hallBack,hallFront,y,floor.name);
      deck(x0,x1,hallBack,hallFront,y);
      deck(x0,x1,hallBack,hallFront,y+levelHeight-.08,'lid');
      const eastDoor=doorway(midZ,2.02);
      wall('x',x1,hallBack,hallFront,1,[eastDoor]);
      zone(x1,stairX,hallBack+.69,hallFront-.69,y,'East stair');
      deck(x1,stairX,midZ-1.01,midZ+1.01,y);
      sign(floorGroup,'East stair',x1-.02,y+2.70,midZ,-Math.PI/2,1.35);
      if(y===0){
        mural(floorGroup,'upper',10.67,y+1.55,hallFront-.014,Math.PI,3.75,1.48);
        mural(floorGroup,'chalk',14.75,y+1.68,hallBack+.015,0,1.72,.78);
      }else if(y<0){
        mural(floorGroup,'pencil',12.05,y+1.63,hallBack+.015,0,1.35,.79);
        mural(floorGroup,'loops',20.9,y+1.40,hallFront-.015,Math.PI,1.63,.95);
      }else mural(floorGroup,'room-tag',12.61,y+1.41,hallBack+.015,0,2.06,1.18);
      const groundLink=y===0;
      if(groundLink){
        zone(5.48,x0,-8.03,-6.37,y,'Works gallery');
        deck(5.48,x0,-8.03,-6.37,y);
        // Original side-room wall contains the opening.
        sign(floorGroup,'Works gallery',5.46,y+2.65,midZ,-Math.PI/2,1.44);
      }else wall('x',x0,hallBack,hallFront,-1);
      for(const x of [7.45,11.65,15.85,20.05])fluorescent(x,midZ,1.8,x!==11.65||y>0);
      // Inspection drains and distribution boxes break up the run of wet concrete.
      for(const x of [8.12,13.5,19.10]){
        box(x,y+.008,hallFront-.40,.89,.014,.40,'steel');
        for(let j=0;j<10;j++)box(x-.388+j*.086,y+.019,hallFront-.40,.03,.01,.34,'duct');
      }
      for(const x of [7.18,15.94]){
        box(x,y+1.45,hallBack+.099,.42,.67,.17,'filing');
        box(x,y+1.36,hallBack+.188,.29,.34,.035,'panel');
        box(x-.07,y+1.67,hallBack+.195,.049,.044,.03,'amber');
        rod([x,y+1.76,hallBack+.1],[x,y+2.82,hallBack+.1],.035,'pipework');
      }
      for(const a of [.0,.19,.32])rod([x0,y+2.86,hallBack+.30+a],[x1,y+2.86,hallBack+.30+a],a===0?.075:.041,'pipework');
      for(let x=6.6;x<x1;x+=2.17){
        box(x,y+2.77,hallBack+.43,.076,.045,.70,'steel');
        box(x,y+2.89,hallBack+.70,.051,.23,.041,'steel');
      }
      for(const [i,label] of floor.rooms.entries()){
        const xa=i%2?join+thick:x0, xb=i%2?x1:join;
        const back=i<2, zs=back?rear:hallFront+thick, ze=back?hallBack-thick:front;
        const doorX=i%2?18.72:9.65, hallEdge=back?hallBack:hallFront, dir=back?-1:1;
        if(!label){wall('z',hallEdge,xa,xb,dir);continue;}
        const doorWidth=i===0&&y===0?2.62:1.66;
        wall('z',hallEdge,xa,xb,dir,[doorway(doorX,doorWidth)]);
        zone(doorX-doorWidth/2,doorX+doorWidth/2,Math.min(hallEdge,hallEdge+thick*dir),Math.max(hallEdge,hallEdge+thick*dir),y,label);
        deck(doorX-doorWidth/2,doorX+doorWidth/2,Math.min(hallEdge,hallEdge+thick*dir),Math.max(hallEdge,hallEdge+thick*dir),y);
        hatch(doorX,hallEdge,2.44,0,doorWidth);
        sign(floorGroup,label,doorX,y+2.73,hallEdge-dir*.027,back?0:Math.PI,1.56);
        zone(xa,xb,zs,ze,y,label);deck(xa,xb,zs,ze,y);
        deck(xa,xb,zs,ze,y+levelHeight-.08,'lid');
        const link=i===0&&y===3.2;
        if(i%2===0){
          wall('x',xa,zs,ze,-1,link?[[-11.20,1.50,0,2.41]]:[]);
          wall('x',xb,zs,ze,1);
        }else if(!floor.rooms[i-1])wall('x',xa,zs,ze,-1);
        if(i%2===1)wall('x',xb,zs,ze,1);
        const winZ=back?zs:ze;
        const windows=y<0?[]:[xa+2.51,xb-1.86].map(c=>[c,2.64,1.29,2.91]);
        wall('z',winZ,xa,xb,dir,windows);
        for(const [cx,w,lo,hi] of windows){
          box(cx,y+(lo+hi)/2,winZ+dir*.155,w,hi-lo,.025,'pane');
          for(const u of [-.5,0,.5])box(cx+u*w,y+(lo+hi)/2,winZ+dir*.117,.035,hi-lo,.051,'steel');
          box(cx,y+2.015,winZ+dir*.117,w,.033,.055,'steel');
          box(cx,y+lo-.022,winZ,w+.13,.06,.41,'concrete');
        }
        fluorescent(xa+2.2,(zs+ze)*.50,1.64);
        fluorescent(xb-2,(zs+ze)*.50,1.64,(i+levelFor(y))%3!==0);
        const propZ=back?zs+1.10:ze-1.1;
        if(y<0){
          if(i<2){tank(xa+1.7,propZ+.42,.73,1.94);tank(xa+4.12,propZ+.42,.79,2.07);switchboard(xb-1.5,propZ);}
          else if(i===2){table(xa+2.6,propZ);cabinet(xb-1.65,propZ);}
          else {shelf(xa+2.6,propZ);shelf(xb-1.8,propZ-2.1,1);}
        }else if(y===0){
          if(i===0){
            table(xb-1.65,propZ);cabinet(xb-.84,zs+3.30,2);
            const car=motorBay;
            obstacle(car.x,car.z,car.width,car.length,car.yaw);
            for(const [offset,width,length,top] of [[1.42,2.18,1.51,.67],[0,2.34,1.60,1.29],[-1.51,2.26,1.5,.90]]){
              const proxy=new THREE.Mesh(new THREE.BoxGeometry(width,top,length));
              proxy.position.set(car.x+offset*Math.sin(car.yaw),top*.5,car.z+offset*Math.cos(car.yaw));
              proxy.rotation.y=car.yaw;proxy.updateMatrixWorld();occluders.push(proxy);
            }
            for(const dx of [-1.55,1.55]){
              const strip=new THREE.BoxGeometry(.064,.009,5.14);
              strip.translate(dx,.006,0).rotateY(car.yaw).translate(car.x,0,car.z);add(strip,material('painted'));
            }
            addAreaLight({
              color:0xfaf7ed, intensity:6.4, width:3.9, height:.47,
              position:new THREE.Vector3(car.x-1.75,2.66,car.z-.75),
              target:new THREE.Vector3(car.x,.64,car.z),
              minY:-.5, maxY:3.4, range:16
            });
            parkCoupe(floorGroup, {
              bounds:new THREE.Box3(new THREE.Vector3(xa,y,zs),new THREE.Vector3(xb,y+floorToRoof,ze)).expandByScalar(thick+.10),
              openings:[[ze,doorway(doorX,doorWidth)],...windows.map(cut=>[winZ,cut])]
            });
          }
          else if(i===1){switchboard(xa+2.28,propZ);switchboard(xb-2.24,propZ);}
          else {table(xb-2.2,propZ);shelf(xa+2.35,propZ);}
        }else if(i===1){
          shelf(xa+2.3,propZ);shelf(xb-2.13,propZ);shelf(xa+2.25,propZ+3.15);
        }else if(i===0){cabinet(xb-2.1,propZ,4);table(xa+2.38,propZ);}
        else{table(xa+2.21,propZ-.8);cabinet(xb-2.0,propZ,4);}
        if(i<2||i===3)anchor(xb-2.25,y,back?ze-2.55:zs+2.8);
      }
      // Complete the cross-wall thickness between adjacent doorway bays.
      for(const [z,dir] of [[hallBack,-1],[hallFront,1]])wall('z',z,join,join+thick,dir);
      if(y===3.2){
        const za=-12.30,zb=-10.10;
        zone(1.25,1.50,-11.95,-10.45,y,'Link gallery');
        zone(1.50,5.53,za,zb,y,'Link gallery');
        zone(5.53,x0,-11.95,-10.45,y,'Document intake');
        deck(1.25,x0,za,zb,y);deck(1.50,5.53,za,zb,y+levelHeight-.08,'lid');
        wall('z',za,1.5,5.53,-1);wall('z',zb,1.5,5.53,1);
        fluorescent(3.56,-11.2,1.2);
        sign(floorGroup,'Records',1.224,y+2.66,-11.20,-Math.PI/2,1.30);
      }
    }else{
      zone(x0,x1,rear,front,y,floor.name);deck(x0,x1,rear,front,y,'membrane');
      for(const [axis,p,lo,hi,out] of [['z',rear,x0,x1,-1],['z',front,x0,x1,1],['x',x0,rear,front,-1],['x',x1,rear,hallBack,1],['x',x1,hallFront,front,1]]){
        wall(axis,p,lo,hi,out,[],.92,'wall');
        if(axis==='z')box((lo+hi)/2,y+.95,p+out*.10,hi-lo,.095,.34,'concrete');
        else box(p+out*.10,y+.95,(lo+hi)/2,.34,.095,hi-lo,'concrete');
      }
      wall('x',x1,hallBack,hallFront,1,[[midZ,2.02,0,2.46]]);
      zone(x1,stairX,midZ-1.01,midZ+1.01,y,'East stair');
      deck(x1,stairX,midZ-1.01,midZ+1.01,y);
      sign(floorGroup,'Roof plant',x1+.225,y+2.68,midZ,Math.PI/2,1.5);
      roofUnit(10.3,-12.8,3.90,1.96);roofUnit(16.55,-12.80,3.91,1.96);roofUnit(12.90,-2.18,3.4,1.75);
      // Roof services feed around the plant and continue up a compact aerial mast.
      for(const z of [-13.37,-12.84]){
        rod([11.94,y+.52,z],[14.85,y+.52,z],.115,'duct');
        for(const x of [12.38,13.65,14.43])rod([x-.03,y+.52,z],[x+.03,y+.52,z],.145,'steel');
      }
      const poleX=20.85,poleZ=-14.26;
      box(poleX,y+.24,poleZ,.67,.47,.67,'concrete');
      rod([poleX,y+.42,poleZ],[poleX,y+5.65,poleZ],.055,'duct',.032,12);
      for(const h of [3.02,3.70,4.68,5.05]){
        rod([poleX-.69,y+h,poleZ],[poleX+.69,y+h,poleZ],.022,'pipework');
        rod([poleX,y+h,poleZ-.29],[poleX,y+h,poleZ+.31],.02,'duct');
      }
      for(const dx of [-1.45,1.45])rod([poleX,y+3.6,poleZ],[poleX+dx,y+.2,poleZ+.88],.008,'steel');
      obstacle(poleX,poleZ,.67,.67);
      for(const x of [7.66,8.45,9.24]){
        const z=-4.4;
        box(x,y+.018,z,.58,.036,.58,'rubber');
        rod([x,y+.034,z],[x,y+.091,z],.276,'sheet',.260,28);
        rod([x,y+.085,z],[x,y+1.16,z],.215,'duct',.204,32);
        for(const h of [.19,.74,1.13])rod([x,y+h-.009,z],[x,y+h+.009,z],.222,'sheet',.222,32);
        for(let k=0;k<3;k++){
          const a=k*2*Math.PI/3,dx=Math.cos(a),dz=Math.sin(a);
          rod([x+dx*.19,y+1.13,z+dz*.19],[x+dx*.229,y+1.295,z+dz*.229],.016,'steel',.016,10);
        }
        // A folded rain cap stands off the flue on three brackets. Its open
        // edge exposes the dark exhaust throat below instead of a solid cylinder.
        const profile=[[.003,.175],[.042,.168],[.289,.047],[.346,.009],[.348,0],[.336,-.007],[.287,.022],[.031,.153]];
        const cap=new THREE.LatheGeometry(profile.map(([r,h])=>new THREE.Vector2(r,h)),40);
        cap.translate(x,y+1.234,z);add(cap,material('sheet'),true);
        rod([x,y+1.157,z],[x,y+1.166,z],.188,'rubber',.188,32);
      }
      for(const z of [-.46,.01]){
        rod([7.6,y+.26,z],[20.9,y+.26,z],.075,'pipework');
        for(let x=8.6;x<21;x+=2.8)box(x,y+.10,z,.14,.20,.21,'concrete');
      }
      anchor(9.05,y,-8.60);anchor(18.93,y,-3.36);
    }
    finish();
    if(roof)installRoofDaylight(scene,floorGroup,sky);

    // The shaft has a landing at every floor, plus an intermediate landing
    // joining two opposing flights. Built in its own group so floors can cull cleanly.
    const stair=construction(eastStairGroup,{
      occluders,spacing:1.23,light:shade,createMaterial:kind=>annexSkin(kind,floor)
    });
    const stairDeck=(xa,xb,za,zb,height,kind='slab')=>stair.box((xa+xb)/2,height-.08,(za+zb)/2,xb-xa,.16,zb-za,kind);
    const stairWall=(axis,plane,from,to,out,height=levelHeight,kind='wall',bottom=y)=>{
      if(axis==='x')stair.box(plane+out*thick*.5,bottom+height*.5,(from+to)*.5,thick,height,to-from,kind);
      else stair.box((from+to)*.5,bottom+height*.5,plane+out*thick*.5,to-from,height,thick,kind);
    };
    zone(stairX,first,hallBack,hallFront,y,'East stair');
    stairDeck(stairX,first,hallBack,hallFront,y,'concrete');
    sign(eastStairGroup,floor.name,stairX+.72,y+1.70,hallBack+.012,0,1.28,'EAST STAIR');
    for(const [z,out] of [[hallBack,-1],[hallFront,1]])stairWall('z',z,stairX,outer,out,levelHeight,'concrete');
    stairWall('x',outer,hallBack,hallFront,1,levelHeight,'wall');
    fluorescent(stairX+1.09,midZ,.94,true,stair.box,stair.rod);
    if(y<6.4){
      const rise=1.60,flightWidth=1.59,n=11,run=(last-first)/n;
      stairDeck(last,outer,hallBack,hallFront,y+rise,'concrete');
      for(let j=0;j<n;j++){
        const cx=first+run*(j+.5);
        for(const [z,high] of [[-8.065,y+rise*(j+1)/n],[-6.335,y+3.2-rise*j/n]]){
          stair.box(cx,high-.125,z,run+.0006,.25,flightWidth,'concrete');
          stair.box(cx-run*.5+.022,high+.002,z,.041,.009,flightWidth-.035,'painted');
        }
      }
      const rail=(z,a,b)=>{
        for(let j=0;j<=4;j++){
          const f=j/4,cx=THREE.MathUtils.lerp(first,last,f),h=THREE.MathUtils.lerp(a,b,f);
          stair.box(cx,h+.44,z,.03,.89,.03,'steel');
        }
        for(const h of [.48,.90])stair.rod([first,a+h,z],[last,b+h,z],.025,'pipework');
      };
      rail(-7.29,y+.08,y+1.6);rail(-7.11,y+3.2,y+1.67);
    }else{
      stairDeck(stairX,outer,hallBack,hallFront,y+3.18,'lid');
      for(let j=0;j<3;j++)stair.box(first,y+.465,hallBack+.09+j*.74,.04,.93,.04,'steel');
      stair.rod([first,y+.93,hallBack+.09],[first,y+.93,-7.34],.027,'pipework');
    }
    stair.finish();
  }

  lights.finish([...floorGroups,eastStairGroup],occluders.slice(firstOccluder));

  // Two-way ramps select a compatible elevation on the stacked flights.
  function stairHeight(x,z,feet){
    if(x<first||x>outer||z<hallBack||z>hallFront)return null;
    const fraction=(x-first)/(last-first);
    for(let i=0;i<floors.length-1;i++){
      const floor=floors[i];
      let h;
      if(x>=last)h=floor.y+1.60;
      else if(z<=-7.27)h=floor.y+1.60*fraction;
      else if(z>=-7.13)h=floor.y+3.20-1.60*fraction;
      else continue;
      if(near(feet,h))return h;
    }
    return null;
  }
  function ground(x,z,feet){
    const slope=stairHeight(x,z,feet);
    if(slope!==null)return slope;
    const idx=levelFor(feet);
    const fZones=zonesByFloor[idx];
    let area=null;
    for(let i=0;i<fZones.length;i++){
      const r=fZones[i];
      if(near(r.y,feet)&&inRect(x,z,r)){area=r;break;}
    }
    if(!area)return null;
    const fObs=obstaclesByFloor[idx];
    for(let i=0;i<fObs.length;i++){
      if(inRect(x,z,fObs[i]))return null;
    }
    return area.y;
  }
  function sector({x,y,z}){
    const feet=y-1.58;
    if(x>=stairX && x<=outer && z>=hallBack && z<=hallFront)return 'East stair';
    const fZones=zonesByFloor[levelFor(feet)];
    for(let i=0;i<fZones.length;i++){
      const r=fZones[i];
      if(near(r.y,feet)&&inRect(x,z,r))return r.name;
    }
    return undefined;
  }
  // Begin on the intake floor, then offer the connected basement, records and roof.
  targets.sort((a,b)=>[0,-3.2,3.2,6.4].indexOf(a.y)-[0,-3.2,3.2,6.4].indexOf(b.y));
  return {
    ground,sector,targets,
    groups:{floors:floorGroups,eastStair:eastStairGroup},
    setFixturePulse:lights.setPulse
  };
}
