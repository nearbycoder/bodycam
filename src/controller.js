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
  let selected = null, last = [], lastNav = 0, repeatAt = 0, current;
  function sample(now) {
    let pads;
    try { pads = Array.from(navigator.getGamepads?.() || []).filter(p => p?.connected); }
    catch { pads = []; }
    const pad = pads.find(p => p.index === selected) || pads.find(p => p.mapping === 'standard') || pads[0];
    const disconnected = selected !== null && !pads.some(p => p.index === selected);
    if (!pad) {
      current = null; selected = null; last = []; lastNav = 0;
      return { connected: false, disconnected };
    }
    if (pad.index !== selected) { last = []; lastNav = 0; }
    selected = pad.index;
    current = pad;
    const buttons = pad.buttons.map(b => b.pressed || b.value > .35);
    const pressed = i => !!buttons[i] && !last[i];
    const [x,y] = stick(pad.axes,0), [lookX,lookY] = stick(pad.axes,2);
    const nav = buttons[12] || y < -.6 ? -1 : buttons[13] || y > .6 ? 1 : 0;
    let navigate = 0;
    if (nav && (nav !== lastNav || now >= repeatAt)) {
      navigate = nav;
      repeatAt = now + (nav === lastNav ? 155 : 385);
    }
    const input = {
      connected: true, disconnected, x, y, lookX, lookY, navigate,
      accept: pressed(0), back: pressed(1), reload: pressed(2), scan: pressed(3),
      weapon: pressed(5), map: pressed(8), nextDeck: pressed(15)||pressed(5), prevDeck: pressed(14)||pressed(4), pause: pressed(9), sprint: pressed(10), aim: pad.buttons[6]?.value || 0,
      fire: !!buttons[7], activity: buttons.some(Boolean) || !!(x || y || lookX || lookY)
    };
    last = buttons; lastNav = nav;
    return input;
  }
  function vibrate(strong, weak, duration) {
    const actuator = current?.vibrationActuator;
    try { actuator?.playEffect?.('dual-rumble',{duration,strongMagnitude:strong,weakMagnitude:weak})?.catch(()=>{}); }
    catch { /* Haptics are optional on the host platform. */ }
  }
  return {sample,vibrate};
}
