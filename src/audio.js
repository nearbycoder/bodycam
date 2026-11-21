export function cameraAudio(){
  const base=import.meta.env.BASE_URL;
  const route=new Audio(base+'art/route.m4a');
  route.preload='none';
  const recordings=new Map();
  let ctx,noise,micBus,master,ambientGain,enabled=false,ambientActive=false;
  async function loadRecording(name){
    try{
      const res=await fetch(base+'audio/'+name+'.wav');
      if(!res.ok)return;
      recordings.set(name,await ctx.decodeAudioData(await res.arrayBuffer()));
    }catch{/* Local percussion is available while a sample is offline. */}
  }
  function start(){
    if(!ctx){
      ctx=new AudioContext();
      // Bodycam MEMS microphone coloration: tight low roll-off, gritty mid-high presence,
      // and aggressive AGC limiting so indoor shots slam the mic and pump room tone.
      micBus=ctx.createGain();
      const hp=ctx.createBiquadFilter();
      hp.type='highpass'; hp.frequency.value=95; hp.Q.value=.7;
      const presence=ctx.createBiquadFilter();
      presence.type='peaking'; presence.frequency.value=2350; presence.Q.value=1.1; presence.gain.value=3.2;
      const comp=ctx.createDynamicsCompressor();
      comp.threshold.value=-18; comp.knee.value=8; comp.ratio.value=11;
      comp.attack.value=.0025; comp.release.value=.24;
      master=ctx.createGain();
      micBus.connect(hp).connect(presence).connect(comp).connect(master).connect(ctx.destination);

      noise=ctx.createBuffer(1,ctx.sampleRate*.55,ctx.sampleRate);
      const channel=noise.getChannelData(0);
      for(let i=0;i<channel.length;i++)channel[i]=Math.random()*2-1;

      // Subtle derelict room-tone + faint mic floor that ducks under loud transients.
      const roomLen=ctx.sampleRate*2.4;
      const roomBuf=ctx.createBuffer(1,roomLen,ctx.sampleRate);
      const roomData=roomBuf.getChannelData(0);
      let lp=0;
      for(let i=0;i<roomLen;i++){
        const w=Math.random()*2-1;
        lp=lp*.94+w*.06;
        roomData[i]=lp*1.8+w*.05;
      }
      const roomSrc=ctx.createBufferSource();
      roomSrc.buffer=roomBuf; roomSrc.loop=true;
      const roomFilter=ctx.createBiquadFilter();
      roomFilter.type='bandpass'; roomFilter.frequency.value=280; roomFilter.Q.value=.55;
      ambientGain=ctx.createGain();
      ambientGain.gain.value=0;
      roomSrc.connect(roomFilter).connect(ambientGain).connect(micBus);
      roomSrc.start();

      loadRecording('pistol');loadRecording('carbine');
    }
    master.gain.setValueAtTime(1,ctx.currentTime);
    syncAmbient();
    ctx.resume().catch(()=>{});
  }
  function syncAmbient(){
    if(!ambientGain||!ctx)return;
    const target=enabled&&ambientActive ? .055 : 0;
    ambientGain.gain.setTargetAtTime(target,ctx.currentTime,.08);
  }

  // Small mechanical sounds use shaped broadband transients. Shot recordings
  // retain the original clip's attack with a short indoor reflection tail.
  function transient(delay,length,level,frequency,endFrequency,type='lowpass'){
    const when=ctx.currentTime+delay;
    const source=ctx.createBufferSource(),gain=ctx.createGain(),filter=ctx.createBiquadFilter();
    source.buffer=noise;
    filter.type=type;filter.Q.value=type==='bandpass'?.67:.72;
    filter.frequency.setValueAtTime(frequency,when);
    filter.frequency.exponentialRampToValueAtTime(endFrequency,when+length);
    gain.gain.setValueAtTime(.0001,when);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0001,level),when+.003);
    gain.gain.exponentialRampToValueAtTime(.0001,when+length);
    source.connect(filter).connect(gain).connect(micBus);
    source.start(when,Math.random()*.12);source.stop(when+length+.008);
    source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
  }
  function shot(name,volume){
    const recorded=recordings.get(name);
    if(recorded){
      const source=ctx.createBufferSource(),gain=ctx.createGain();
      source.buffer=recorded;source.playbackRate.value=.95+Math.random()*.09;
      gain.gain.value=volume*(name==='carbine'?.88:.95);
      source.connect(gain).connect(micBus);source.start();
      source.onended=()=>{source.disconnect();gain.disconnect();};
    }else{
      transient(0,.13,.92*volume,5600,240);
      transient(.035,.18,.22*volume,1400,260);
    }
    // Faint brass shell & bolt snap tail audible on a chest-mounted mic.
    transient(.014,.032,.08*volume,4200,1900,'bandpass');
  }
  const cues={
    // Each handling cue is triggered by its visible pose crossing, using the
    // encounter clock. Pausing or switching cannot schedule future pose sounds.
    reload:[[0,.09,.09,1500,330,'bandpass']],
    reach:[[0,.07,.07,2050,410,'bandpass']],
    release:[[0,.045,.18,3150,730],[.018,.062,.07,1580,450,'bandpass']],
    shift:[[0,.087,.12,1750,390,'bandpass']],
    seat:[[0,.039,.21,2350,480],[.014,.078,.14,1150,290]],
    settle:[[0,.048,.15,3200,680,'bandpass']],
    holster:[[0,.10,.10,1400,290,'bandpass']],
    draw:[[0,.085,.10,1750,430,'bandpass']],
    torch:[[0,.028,.16,3800,1800,'bandpass']],
    hit:[[0,.048,.14,4800,1240,'bandpass'],[.028,.075,.09,2300,660,'bandpass']],
    break:[[0,.12,.30,3700,320],[.05,.16,.21,2030,300],[.16,.095,.13,3300,590,'bandpass']],
    shield:[[0,.16,.40,820,140],[.014,.13,.19,2900,440,'bandpass']],
    orb:[[0,.12,.18,2650,560,'bandpass'],[.053,.09,.12,1900,470]],
    alert:[[0,.09,.16,1550,1380,'bandpass'],[.15,.062,.11,1690,1330,'bandpass']],
    clear:[[0,.06,.10,1820,1050,'bandpass'],[.12,.075,.14,2050,1350,'bandpass']]
  };
  function effect(name,volume=1,weapon){
    if(!enabled||!ctx)return;
    if(name==='pistol'||name==='carbine'){shot(name,volume);return;}
    const tuning=weapon==='carbine'?.77:1;
    for(const [delay,length,level,from,to,type] of cues[name]??[]){
      transient(delay,length,volume*level,from*tuning,to*tuning,type);
    }
  }
  return {
    effect,
    get enabled(){return enabled;},
    setAmbient(active){
      ambientActive=Boolean(active);
      syncAmbient();
    },
    toggle(){
      enabled=!enabled;
      if(enabled)start();
      else{route.pause();if(master)master.gain.setValueAtTime(0,ctx.currentTime);syncAmbient();}
      return enabled;
    },
    sync(t,guided){
      if(!enabled||!guided){route.pause();return;}
      if(Math.abs(route.currentTime-t)>.28)route.currentTime=t;
      if(route.paused)route.play().catch(()=>{});
    },
    step(){
      if(!enabled||!ctx)return;
      // Gritty concrete grit heel-strike + faint chest-rig nylon brush.
      transient(0,.22,.24,1550+Math.random()*460,140);
      transient(.012,.09,.06,2900+Math.random()*700,820,'bandpass');
    }
  };
}
