import * as THREE from 'three';

const up=new THREE.Vector3(0,1,0), forward=new THREE.Vector3(0,0,1);
const direction=new THREE.Vector3(),delta=new THREE.Vector3();
const rod=new THREE.CylinderGeometry(1,1,1,6);
const pelletShape=new THREE.IcosahedronGeometry(.065,1);
const chipShape=new THREE.TetrahedronGeometry(1);
const markShape=new THREE.PlaneGeometry(1,1);

function texture(size,paint){
  const pixels=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    pixels.set(paint((x+.5)*2/size-1,(y+.5)*2/size-1),4*(y*size+x));
  }
  const tex=new THREE.DataTexture(pixels,size,size);
  tex.minFilter=tex.magFilter=THREE.LinearFilter;tex.needsUpdate=true;
  return tex;
}

function eddy(x,y){
  return .50+.19*Math.sin(4*x+2*Math.cos(3*y))+.14*Math.sin(8*y-2*x)
    +.09*Math.cos(14*x+17*y)+.04*Math.sin(28*y+5*Math.sin(19*x));
}
const hazeMap=texture(96,(x,y)=>{
  const density=Math.max(0,1-Math.hypot(x,y))*eddy(x,y);
  return [239,231,214,Math.min(255,Math.round(430*density*density))];
});
const flashMap=texture(80,(x,y)=>{
  const r=Math.hypot(x,y),a=Math.atan2(y,x);
  const tips=.39+.25*Math.pow(.5+.5*Math.cos(5*a+.6*Math.sin(3*a)),7)+.19*Math.sin(a+2.);
  const core=Math.exp(-15*r),flame=Math.max(0,1-r/tips);
  return [255,Math.round(140+112*core),Math.round(61+168*core),
    Math.round(255*Math.min(1,core+Math.pow(flame,1.8)))];
});
const markMap=texture(96,(x,y)=>{
  const r=Math.hypot(x,y),a=Math.atan2(y,x);
  const edge=.48+.11*Math.sin(5*a+1)+.081*Math.sin(9*a)+.058*Math.cos(17*a+1);
  const grain=eddy(3*x,3*y),chip=Math.max(0,1-Math.abs(r-edge)*8);
  const value=Math.min(255,41+grain*43+chip*(72+43*(y-x)));
  const coverage=THREE.MathUtils.clamp((edge+.12-r)*7,0,1);
  return [value,value*.95,value*.84,Math.round(205*coverage)];
});

export function makeImpactEffects(parent){
  const trails=[],flashes=[],puffs=[],chips=[],marks=[],bolts=[];
  const chipMaterials=[
    new THREE.MeshStandardMaterial({color:0xa09685,roughness:.96}),
    new THREE.MeshStandardMaterial({color:0x686965,metalness:.47,roughness:.48}),
    new THREE.MeshBasicMaterial({color:new THREE.Color(1.75,.86,.32)})
  ];
  function pool(count,list,make) {
    for(let i=0;i<count;i++){
      const mesh=make(i);parent.add(mesh);mesh.visible=false;
      list.push({mesh,life:0,duration:1,velocity:new THREE.Vector3()});
    }
  }
  function slot(list){
    // Prefer an unused slot. At capacity replace the effect nearest its end.
    return list.find(fx=>!fx.mesh.visible)??list.reduce((a,b)=>a.life<b.life?a:b);
  }
  function sprite(map,additive=false){
    return new THREE.Sprite(new THREE.SpriteMaterial({map,transparent:true,depthWrite:false,
      blending:additive?THREE.AdditiveBlending:THREE.NormalBlending}));
  }
  pool(5,trails,()=>new THREE.Mesh(rod,new THREE.MeshBasicMaterial({color:0xd5ad76,
    transparent:true,depthWrite:false,blending:THREE.AdditiveBlending})));
  pool(4,flashes,()=>sprite(flashMap,true));
  pool(32,puffs,()=>sprite(hazeMap));
  pool(70,chips,()=>new THREE.Mesh(chipShape,chipMaterials[0]));
  pool(32,marks,()=>new THREE.Mesh(markShape,new THREE.MeshBasicMaterial({
    map:markMap,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1
  })));
  const pelletMaterial=new THREE.MeshStandardMaterial({color:0xb2602e,emissive:0x854622,
    metalness:.4,roughness:.55});
  pool(24,bolts,()=>{
    const group=new THREE.Group();
    group.add(new THREE.Mesh(pelletShape,pelletMaterial));
    const marker=sprite(flashMap,true);marker.material.color.set(0xe4a46c);
    marker.scale.setScalar(.13);group.add(marker);
    return group;
  });

  function puff(point,velocity,radius,duration,opacity){
    const fx=slot(puffs);
    fx.mesh.position.copy(point);fx.velocity.copy(velocity);
    fx.mesh.material.rotation=Math.random()*Math.PI*2;
    fx.mesh.scale.setScalar(radius*.5);fx.mesh.material.opacity=opacity;
    fx.mesh.visible=true;fx.life=fx.duration=duration;fx.radius=radius;fx.opacity=opacity;
  }

  function shot(from,to,heading,weapon){
    const flash=slot(flashes);
    flash.mesh.position.copy(from).addScaledVector(heading,.048);
    flash.mesh.material.rotation=Math.random()*Math.PI*2;flash.mesh.material.opacity=.88;
    flash.mesh.scale.setScalar((weapon==='carbine'?.21:.15)*(.8+Math.random()*.4));
    flash.mesh.visible=true;flash.life=.036;
    direction.copy(heading).multiplyScalar(.34);
    direction.y+=.24;
    puff(flash.mesh.position,direction,.095,.38,.26);

    // A fleeting streak appears over a short part of the shot. The full sightline
    // stays clear so a long corridor does not fill with bright lines.
    const length=from.distanceTo(to);
    if(length<1.5)return;
    const trail=slot(trails);
    const segment=Math.min(1.25,length*.17),along=length*(.3+Math.random()*.36);
    direction.subVectors(to,from).normalize();
    trail.mesh.position.copy(from).addScaledVector(direction,along);
    trail.mesh.quaternion.setFromUnitVectors(up,direction);
    trail.mesh.scale.set(.0065,segment,.0065);
    trail.mesh.material.opacity=.38;trail.mesh.visible=true;trail.life=.04;
  }

  function impact(point,normal,kind,scale=1){
    const metal=kind==='metal';
    const dustVelocity=direction.copy(normal).multiplyScalar(.23);
    dustVelocity.y+=.18;
    puff(point,dustVelocity,scale*(metal?.15:.32),metal?.26:.62,metal?.22:.57);
    const count=Math.round(scale*(metal?12:8));
    for(let i=0;i<count;i++){
      const chip=slot(chips);
      const hot=metal&&i%3===0;
      chip.mesh.material=chipMaterials[hot?2:metal?1:0];
      chip.mesh.position.copy(point).addScaledVector(normal,.015);
      chip.mesh.rotation.set(Math.random()*6,Math.random()*6,Math.random()*6);
      const radius=(hot?.006:.016)*(Math.random()+.48)*scale;
      chip.mesh.scale.set(radius,radius*(hot?2.9:.67),radius*.59);
      chip.velocity.set(Math.random()-.5,Math.random()-.30,Math.random()-.5).normalize();
      if(chip.velocity.dot(normal)<0)chip.velocity.reflect(normal);
      chip.velocity.addScaledVector(normal,.28).multiplyScalar((.48+Math.random()*2.1)*scale);
      chip.life=chip.duration=(hot?.16:.33)+Math.random()*.19;chip.mesh.visible=true;
    }
    if(kind==='plaster'){
      const mark=slot(marks);
      mark.mesh.position.copy(point).addScaledVector(normal,.007);
      mark.mesh.quaternion.setFromUnitVectors(forward,normal);
      mark.mesh.rotateZ(Math.random()*6.28);
      mark.mesh.scale.setScalar(.088+Math.random()*.045);
      mark.mesh.material.opacity=.86;mark.mesh.visible=true;mark.life=22;
    }
  }

  function launch(origin,heading,travel){
    const bolt=bolts.find(b=>!b.mesh.visible);
    if(!bolt||travel<.05)return;
    bolt.mesh.position.copy(origin);
    bolt.mesh.quaternion.setFromUnitVectors(forward,heading);
    bolt.velocity.copy(heading).multiplyScalar(3.35);
    bolt.life=travel/3.35;bolt.mesh.visible=true;
  }

  function update(dt,player,onImpact){
    for(const fx of flashes)if(fx.mesh.visible){
      fx.life-=dt;fx.mesh.material.opacity=Math.max(0,fx.life/.036)*.88;
      if(fx.life<=0)fx.mesh.visible=false;
    }
    for(const fx of trails)if(fx.mesh.visible){
      fx.life-=dt;fx.mesh.material.opacity=.38*Math.max(0,fx.life/.04);
      if(fx.life<=0)fx.mesh.visible=false;
    }
    for(const fx of puffs)if(fx.mesh.visible){
      fx.life-=dt;const remaining=Math.max(0,fx.life/fx.duration);
      fx.mesh.position.addScaledVector(fx.velocity,dt);fx.velocity.y+=dt*.18;
      fx.mesh.material.rotation+=dt*.35;
      fx.mesh.material.opacity=fx.opacity*remaining*remaining;
      fx.mesh.scale.setScalar(fx.radius*(1.8-1.30*remaining));
      if(fx.life<=0)fx.mesh.visible=false;
    }
    for(const fx of chips)if(fx.mesh.visible){
      fx.life-=dt;fx.velocity.y-=dt*4.4;
      fx.mesh.position.addScaledVector(fx.velocity,dt);fx.mesh.rotation.x+=dt*9;fx.mesh.rotation.z+=dt*6;
      if(fx.life<=0)fx.mesh.visible=false;
    }
    for(const fx of marks)if(fx.mesh.visible){
      fx.life-=dt;fx.mesh.material.opacity=.86*Math.min(1,Math.max(0,fx.life/2.5));
      if(fx.life<=0)fx.mesh.visible=false;
    }
    for(const bolt of bolts)if(bolt.mesh.visible){
      const travel=Math.min(bolt.life,dt);
      delta.subVectors(player,bolt.mesh.position);
      const along=THREE.MathUtils.clamp(delta.dot(bolt.velocity)/bolt.velocity.lengthSq(),0,travel);
      direction.copy(bolt.mesh.position).addScaledVector(bolt.velocity,along);
      const contact=direction.distanceToSquared(player)<.33*.33;
      bolt.mesh.position.addScaledVector(bolt.velocity,contact?along:travel);
      bolt.mesh.rotateZ(dt*4);bolt.life-=dt;
      if(contact||bolt.life<=0){
        bolt.mesh.visible=false;
        if(contact)onImpact();
        else{
          delta.copy(bolt.velocity).normalize().negate();
          impact(bolt.mesh.position,delta,'metal',.38);
        }
      }
    }
  }
  function clear(){
    for(const list of [trails,flashes,puffs,chips,marks,bolts])for(const fx of list)fx.mesh.visible=false;
  }
  return {shot,impact,launch,update,clear};
}
