export function cameraAudio(){
  const base=import.meta.env.BASE_URL;
  const route=new Audio(base+'art/route.m4a');
  route.preload='none';
  const recordings=new Map();
  let ctx,noise,master,enabled=false;
  async function loadRecording(name){
    try{
      const res=await fetch(base+'audio/'+name+'.wav');
      if(!res.ok)return;
      recordings.set(name,await ctx.decodeAudioData(await res.arrayBuffer()));
    }catch{/* Local percussion is available while a sample is offline. */}
  }
  function start(){
    if(!ctx){
      ctx=new AudioContext();master=ctx.createGain();master.connect(ctx.destination);
      noise=ctx.createBuffer(1,ctx.sampleRate*.55,ctx.sampleRate);
      const channel=noise.getChannelData(0);
      for(let i=0;i<channel.length;i++)channel[i]=Math.random()*2-1;
      loadRecording('pistol');loadRecording('carbine');
    }
    master.gain.setValueAtTime(1,ctx.currentTime);ctx.resume().catch(()=>{});
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
    source.connect(filter).connect(gain).connect(master);
    source.start(when,Math.random()*.12);source.stop(when+length+.008);
    source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
  }
  function shot(name,volume){
    const recorded=recordings.get(name);
    if(recorded){
      const source=ctx.createBufferSource(),gain=ctx.createGain();
      source.buffer=recorded;source.playbackRate.value=.96+Math.random()*.08;
      gain.gain.value=volume*(name==='carbine'?.73:.80);
      source.connect(gain).connect(master);source.start();
      source.onended=()=>{source.disconnect();gain.disconnect();};
    }else{
      transient(0,.13,.87*volume,5300,240);
      transient(.035,.16,.18*volume,1400,260);
    }
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
    hit:[[0,.048,.13,4800,1240,'bandpass'],[.028,.075,.09,2300,660,'bandpass']],
    break:[[0,.12,.27,3700,320],[.05,.15,.19,2030,300],[.16,.093,.12,3300,590,'bandpass']],
    shield:[[0,.15,.34,820,150],[.014,.12,.15,2900,440,'bandpass']],
    orb:[[0,.12,.17,2650,560,'bandpass'],[.053,.09,.11,1900,470]],
    alert:[[0,.09,.15,1550,1380,'bandpass'],[.15,.062,.10,1690,1330,'bandpass']],
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
    toggle(){
      enabled=!enabled;
      if(enabled)start();
      else{route.pause();if(master)master.gain.setValueAtTime(0,ctx.currentTime);}
      return enabled;
    },
    sync(t,guided){
      if(!enabled||!guided){route.pause();return;}
      if(Math.abs(route.currentTime-t)>.28)route.currentTime=t;
      if(route.paused)route.play().catch(()=>{});
    },
    step(){
      if(enabled&&ctx)transient(0,.25,.23,1400+Math.random()*430,130);
    }
  };
}
