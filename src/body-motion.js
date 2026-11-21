import {MathUtils,Vector2} from 'three';

const {clamp,damp}=MathUtils;
export function createBodyMotion(){
  const velocity=new Vector2();
  const state={stride:0,gait:0,sprint:0,focus:0,breath:0,turn:0,tilt:0,acceleration:0,landing:0,jolt:0,moving:false};
  const camera={lift:0,bank:0,pitch:0,yaw:0};
  let previousYaw=0,previousPitch=0,previousSpeed=0,previousHeight=0,verticalSpeed=0,eye=0;
  let chestImpulse=0,chestVelocity=0,rollImpulse=0,rollVelocity=0,yawImpulse=0,yawVelocity=0;
  let stepDrop=0,stepVelocity=0,breathClock=0,shake=0,shakeClock=0;
  function reset(position,yaw,pitch){
    previousYaw=yaw;previousPitch=pitch;previousHeight=eye=position.y;
    previousSpeed=verticalSpeed=chestImpulse=chestVelocity=rollImpulse=rollVelocity=0;
    yawImpulse=yawVelocity=stepDrop=stepVelocity=breathClock=shake=shakeClock=0;
    velocity.set(0,0);
    Object.assign(state,{stride:0,gait:0,sprint:0,focus:0,breath:0,turn:0,tilt:0,acceleration:0,landing:0,jolt:0,moving:false});
    camera.lift=camera.bank=camera.pitch=camera.yaw=0;
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

    // Damped chest-rig springs: pitch recoil, vest roll, heel-strike drop, and high-frequency jolt.
    chestVelocity+=(-265*chestImpulse-22*chestVelocity)*dt;
    chestImpulse+=chestVelocity*dt;
    rollVelocity+=(-190*rollImpulse-19*rollVelocity)*dt;
    rollImpulse+=rollVelocity*dt;
    yawVelocity+=(-230*yawImpulse-21*yawVelocity)*dt;
    yawImpulse+=yawVelocity*dt;
    stepVelocity+=(-310*stepDrop-26*stepVelocity)*dt;
    stepDrop+=stepVelocity*dt;

    shake*=Math.exp(-dt*16);
    shakeClock+=dt*57;
    const tremor=shake*Math.sin(shakeClock);
    const tremorB=shake*Math.cos(shakeClock*1.37);
    state.jolt=clamp(shake*2.4+Math.abs(chestImpulse)*6,0,1);

    // Subtle unlevelled chest-mount cant and organic strap micro-drift (settles when ADS).
    breathClock+=dt*1.62;
    state.breath=Math.sin(state.stride*.19+breathClock)*(.72+.28*state.gait);
    const free=1-focus*.78;
    const cant=.013*free+.0032*Math.sin(breathClock*.71)*free;
    const microPitch=(.0024*Math.sin(breathClock*1.31)+.0011*Math.sin(breathClock*3.17))*free;
    const microYaw=(.0021*Math.cos(breathClock*.93)+.0009*Math.sin(breathClock*2.41))*free;

    camera.bank=damp(camera.bank,clamp(-lateral*.009-state.turn*.015+cant,-.048,.048),8,dt)+rollImpulse+tremorB*.012;
    camera.pitch=chestImpulse+stepDrop*.38-state.acceleration*.010-state.landing*.012+microPitch+tremor*.009;
    camera.yaw=yawImpulse+microYaw+tremorB*.006;
    camera.lift=eye-position.y+stepDrop*.55+.0042*state.breath;
    previousYaw=yaw;previousPitch=pitch;previousSpeed=speed;previousHeight=position.y;verticalSpeed=climb;
    return speed;
  }
  function step(footIndex){
    const weight=.65+state.sprint*.75;
    const side=(footIndex&1)?1:-1;
    stepVelocity-=.19*weight;
    rollVelocity+=side*.16*weight;
    shake=Math.min(1,shake+.045*weight);
  }
  function shot(weapon){
    const carbine=weapon==='carbine';
    chestVelocity+=carbine?.26:.32;
    rollVelocity+=(Math.random()-.5)*(carbine?.24:.30);
    yawVelocity+=(Math.random()-.5)*(carbine?.12:.16);
    shake=Math.min(1,shake+(carbine?.22:.28));
  }
  function flinch(){
    const dir=Math.random()<.5?-1:1;
    chestVelocity-=.38;
    rollVelocity+=dir*.72;
    yawVelocity+=dir*.26;
    shake=Math.min(1,shake+.62);
  }
  return {state,camera,travel,step,shot,flinch,reset};
}
