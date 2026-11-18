import {MathUtils,Vector2} from 'three';

const {clamp,damp}=MathUtils;
export function createBodyMotion(){
  const velocity=new Vector2();
  const state={stride:0,gait:0,sprint:0,focus:0,breath:0,turn:0,tilt:0,acceleration:0,landing:0,moving:false};
  const camera={lift:0,bank:0,pitch:0};
  let previousYaw=0,previousPitch=0,previousSpeed=0,previousHeight=0,verticalSpeed=0,eye=0;
  let chestImpulse=0,chestVelocity=0,breathClock=0;
  function reset(position,yaw,pitch){
    previousYaw=yaw;previousPitch=pitch;previousHeight=eye=position.y;
    previousSpeed=verticalSpeed=chestImpulse=chestVelocity=breathClock=0;velocity.set(0,0);
    Object.assign(state,{stride:0,gait:0,sprint:0,focus:0,breath:0,turn:0,tilt:0,acceleration:0,landing:0,moving:false});
    camera.lift=camera.bank=camera.pitch=0;
  }
  function travel(world,position,dt,strafe,forward,yaw,pitch,focus,running){
    const distance=Math.hypot(strafe,forward);
    const requestedSpeed=focus>.5?1.45:running?4.6:2.75;
    const rate=requestedSpeed/Math.max(1,distance);
    const vx=rate*(strafe*Math.cos(yaw)-forward*Math.sin(yaw));
    const vz=rate*(-strafe*Math.sin(yaw)-forward*Math.cos(yaw));
    velocity.x=damp(velocity.x,vx,distance>.025?13:20,dt);
    velocity.y=damp(velocity.y,vz,distance>.025?13:20,dt);
    const x=position.x,z=position.z;
    world.move(position,velocity.x*dt,velocity.y*dt);
    const delta=Math.max(.001,dt),dx=position.x-x,dz=position.z-z;
    if(Math.abs(dx)<Math.abs(velocity.x*dt)*.45)velocity.x=dx/delta;
    if(Math.abs(dz)<Math.abs(velocity.y*dt)*.45)velocity.y=dz/delta;
    const speed=Math.hypot(dx,dz)/delta;
    state.acceleration=damp(state.acceleration,clamp((speed-previousSpeed)/(delta*12),-1,1),11,dt);
    state.sprint=damp(state.sprint,running?clamp((speed-2.2)/1.7,0,1):0,10,dt);
    state.gait=damp(state.gait,clamp(speed/1.6,0,1),11,dt);
    state.stride+=dt*(4.8+.89*speed)*Math.min(1,speed/.42);
    state.focus=focus;state.moving=speed>.10;
    const turnDelta=Math.atan2(Math.sin(previousYaw-yaw),Math.cos(previousYaw-yaw));
    state.turn=damp(state.turn,clamp(turnDelta/(delta*3.1),-1,1),9,dt);
    state.tilt=damp(state.tilt,clamp((previousPitch-pitch)/(delta*2.3),-1,1),9,dt);
    const climb=(position.y-previousHeight)/delta;
    const settle=Math.max(0,Math.abs(verticalSpeed)-Math.abs(climb))*.55;
    state.landing=Math.max(state.landing*Math.exp(-dt*9),clamp(settle,0,1));
    eye=damp(eye,position.y,16,dt);
    const lateral=(dx*Math.cos(yaw)-dz*Math.sin(yaw))/delta;
    camera.bank=damp(camera.bank,clamp(-lateral*.007-state.turn*.011,-.035,.035),8,dt);
    // A damped chest impulse gives each shot a short return instead of a camera snap.
    chestVelocity+=(-245*chestImpulse-23*chestVelocity)*dt;
    chestImpulse+=chestVelocity*dt;
    camera.pitch=chestImpulse-state.acceleration*.008-state.landing*.008;
    breathClock+=dt*1.58;
    state.breath=Math.sin(state.stride*.19+breathClock)*(.7+.3*state.gait);
    camera.lift=eye-position.y+.0035*state.breath;
    previousYaw=yaw;previousPitch=pitch;previousSpeed=speed;previousHeight=position.y;verticalSpeed=climb;
    return speed;
  }
  function shot(weapon){chestVelocity+=weapon==='carbine'?.19:.24;}
  return {state,camera,travel,shot,reset};
}
