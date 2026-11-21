// Xbox layout for controllers exposed through the browser's standard mapping.
const DEAD_ZONE = .16;
function stick(axes, offset) {
  const x = axes[offset] || 0, y = axes[offset + 1] || 0;
  const length = Math.hypot(x, y);
  if (length <= DEAD_ZONE) return [0, 0];
  const gain = Math.min(1, (length - DEAD_ZONE) / (1 - DEAD_ZONE)) / length;
  return [x * gain, y * gain];
}

export function createController() {
  let selected = null, last = [], buttons = [], lastNav = 0, repeatAt = 0, current;
  const idle = { connected: false, disconnected: false };
  const input = {
    connected: true, disconnected: false, x: 0, y: 0, lookX: 0, lookY: 0, navigate: 0,
    accept: false, back: false, reload: false, scan: false, weapon: false, torch: false, map: false,
    nextDeck: false, prevDeck: false, pause: false, sprint: false, aim: 0, fire: false, activity: false
  };
  function sample(now) {
    let raw;
    try { raw = navigator.getGamepads?.(); }
    catch { raw = null; }
    let pad = null, selectedAlive = false, standard = null, first = null;
    if (raw) {
      for (let i = 0; i < raw.length; i++) {
        const p = raw[i];
        if (!p?.connected) continue;
        if (p.index === selected) { pad = p; selectedAlive = true; break; }
        if (!standard && p.mapping === 'standard') standard = p;
        if (!first) first = p;
      }
      if (!pad) pad = standard || first;
    }
    const disconnected = selected !== null && !selectedAlive;
    if (!pad) {
      current = null; selected = null; last.length = 0; lastNav = 0;
      idle.disconnected = disconnected;
      return idle;
    }
    if (pad.index !== selected) { last.length = 0; lastNav = 0; }
    selected = pad.index;
    current = pad;
    const padButtons = pad.buttons, len = padButtons.length;
    if (buttons.length !== len) buttons = new Array(len);
    let anyButton = false;
    for (let i = 0; i < len; i++) {
      const b = padButtons[i];
      const down = b.pressed || b.value > .35;
      buttons[i] = down;
      if (down) anyButton = true;
    }
    const pressed = i => !!buttons[i] && !last[i];
    const [x,y] = stick(pad.axes,0), [lookX,lookY] = stick(pad.axes,2);
    const nav = buttons[12] || y < -.6 ? -1 : buttons[13] || y > .6 ? 1 : 0;
    let navigate = 0;
    if (nav && (nav !== lastNav || now >= repeatAt)) {
      navigate = nav;
      repeatAt = now + (nav === lastNav ? 155 : 385);
    }
    input.disconnected = disconnected;
    input.x = x; input.y = y; input.lookX = lookX; input.lookY = lookY; input.navigate = navigate;
    input.accept = pressed(0); input.back = pressed(1); input.reload = pressed(2); input.scan = pressed(3);
    input.weapon = pressed(5); input.torch = pressed(4); input.map = pressed(8);
    input.nextDeck = pressed(15) || pressed(5); input.prevDeck = pressed(14) || pressed(4);
    input.pause = pressed(9); input.sprint = pressed(10);
    input.aim = padButtons[6]?.value || 0;
    input.fire = !!buttons[7];
    input.activity = anyButton || !!(x || y || lookX || lookY);
    if (last.length !== len) last = new Array(len);
    for (let i = 0; i < len; i++) last[i] = buttons[i];
    lastNav = nav;
    return input;
  }
  function vibrate(strong, weak, duration) {
    const actuator = current?.vibrationActuator;
    try { actuator?.playEffect?.('dual-rumble',{duration,strongMagnitude:strong,weakMagnitude:weak})?.catch(()=>{}); }
    catch { /* Haptics are optional on the host platform. */ }
  }
  return {sample,vibrate};
}
