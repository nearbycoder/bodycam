import {PointLight, Vector3} from 'three';
import { createWeaponAnimation } from './weapon-animation.js';

export function weaponMotion(){
  const light=new PointLight(0xffcf99,0,5,2);
  const rig=createWeaponAnimation();
  function update(camera,state,aspect,sway,bob,time,dt){
    if(!state){light.intensity=0;rig.uniforms.discharge.value=0;return;}
    rig.update(camera,state,aspect,sway,bob,time,dt);
    const muzzle=rig.uniforms.muzzleUv.value;
    const x=(muzzle.x-.5)*2,y=(muzzle.y-.5)*2,lens=.865+.067*(x*x+y*y);
    const outlet=camera.userData.pulseOutlet??=new Vector3();
    outlet.set(.55*x*lens/camera.projectionMatrix.elements[0],.55*y*lens/camera.projectionMatrix.elements[5],-.55);
    light.position.copy(outlet).applyMatrix4(camera.matrixWorld);
    light.intensity=rig.uniforms.discharge.value*8;
  }
  return {light,uniforms:rig.uniforms,update};
}
