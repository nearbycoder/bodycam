const bindings = [
  ['Move / look','Left / right stick','WASD / mouse'],
  ['Fire','RT','Left click / Space'],
  ['Focus aim','LT','Right click'],
  ['Reload','X','R'],
  ['Switch weapon','RB','1 / 2'],
  ['Scan for a drone','Y','Q'],
  ['Sprint','Click left stick','Hold Shift'],
  ['Floor plan','View','Tab'],
  ['Pause / resume','Menu','Esc']
];
export function createMenu(onAction){
  const el=id=>document.getElementById(id);
  let screen='', index=0, controller=false, data={}, options=[];
  const buttons=()=>Array.from(el('actions').children);
  function highlight(){
    buttons().forEach((button,i)=>button.dataset.focus=String(i===index));
  }
  function move(delta){
    if(!options.length)return;
    index=(index+delta+options.length)%options.length;
    highlight(); buttons()[index]?.scrollIntoView({block:'nearest'});
  }
  function show(next,context={},initial=0){
    screen=next;data=context;index=initial;
    el('feed').dataset.screen=next || (context.archive?'archivePlay':'live');
    el('menu').hidden=!next;
    el('manual').hidden=next!=='controls';el('graphics').hidden=next!=='graphics';
    if(!next){options=[];return;}
    const resume=context.started?'Resume operation':'Deploy';
    const audio=context.audio?'Audio · On':'Audio · Off';
    const configs={
      home:['OPERATION BLACKOUT','BODYCAM','Disable the rogue security drones across four floors of the annex.',
        [['deploy',resume],['controls','Field manual'],['graphics','Graphics'],['archive','Camera archive'],['site','Operation website']]],
      pause:['TRANSMISSION PAUSED','Paused',context.reason||context.sector,
        [['deploy','Resume operation'],['map','Floor plan'],['controls','Field manual'],['graphics','Graphics'],['audio',audio],['home','Main menu']]],
      controls:['UNIT 4417 / FIELD MANUAL','Controls','',
        [['back','Return'],['audio',audio],['layout',controller?'Show keyboard bindings':'Show Xbox bindings']]],
      graphics:['CAMERA SETTINGS','Graphics','',[['back','Return']]],
      archive:['UNIT 4417 / ARCHIVE','Recordings','Revisit the original corridor walk.',
        [['guide','Reconstructed route'],['film','Original footage'],['back','Return']]],
      down:['CAMERA SIGNAL LOST','Offline','Disabled drones stay offline when you redeploy.',
        [['respawn','Redeploy'],['home','Main menu']]],
      won:['ANNEX SECURE','All clear',`${context.total} drones disabled · ${context.score} points`,
        [['restart','Play again'],['home','Main menu']]]
    };
    const [eyebrow,title,subtitle,rows]=configs[next];
    options=rows;el('eyebrow').textContent=eyebrow;el('title').textContent=title;el('subtitle').textContent=subtitle;
    el('subtitle').hidden=!subtitle;
    el('actions').replaceChildren(...rows.map(([action,label],i)=>{
      const control=document.createElement(action==='site'?'a':'button');
      if(action==='site')control.href=import.meta.env.BASE_URL;
      else{
        control.type='button';
        control.onclick=()=>onAction(action);
      }
      control.dataset.action=action;
      control.append(document.createTextNode(label));
      const symbol=document.createElement('span');symbol.textContent=i===0?(controller?'Ⓐ':'↵'):'›';control.append(symbol);
      control.onpointermove=event=>{if(event.movementX||event.movementY){index=i;highlight();}};
      control.onfocus=()=>{index=i;highlight();};
      return control;
    }));
    if(next==='controls'){
      el('manual').replaceChildren(...bindings.map(([action,pad,keyboard])=>{
        const row=document.createElement('p'),key=document.createElement('b');
        key.textContent=controller?pad:keyboard;row.append(action,key);return row;
      }));
    }
    el('menu-input').textContent=next==='graphics'?(controller?'D-PAD ← →  RESOLUTION     B  BACK':'← →  RESOLUTION     ESC  BACK'):controller?'XBOX  /  D-PAD SELECT     A CONFIRM     B BACK':next==='home'?'ENTER TO SELECT     /     XBOX: PRESS A TO CONNECT':'↑ ↓ SELECT     ENTER CONFIRM';
    highlight();
  }
  function setLayout(value){
    if(controller===value)return;controller=value;
    if(screen)show(screen,data,index);
  }
  return {show,move, get screen(){return screen;}, get index(){return index;},
    setLayout, toggleLayout(){setLayout(!controller);},
    accept(){buttons()[index]?.click();}
  };
}
