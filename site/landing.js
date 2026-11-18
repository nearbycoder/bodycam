const menuButton = document.querySelector('.nav-toggle');
const navigation = document.querySelector('#main-links');
function showNavigation(open) {
  navigation.classList.toggle('is-open', open);
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
}
menuButton.hidden = false;
menuButton.addEventListener('click', () => showNavigation(!navigation.classList.contains('is-open')));
navigation.addEventListener('click', () => showNavigation(false));
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('.masthead') && navigation.classList.contains('is-open')) showNavigation(false);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && navigation.classList.contains('is-open')) {
    showNavigation(false);
    menuButton.focus();
  }
});
matchMedia('(max-width: 620px)').addEventListener('change', () => showNavigation(false));

for (const list of document.querySelectorAll('[data-tabs]')) {
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  function select(tab) {
    for (const item of tabs) {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
    }
  }
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', event => {
      const destinations = {
        ArrowLeft: (index + tabs.length - 1) % tabs.length,
        ArrowRight: (index + 1) % tabs.length,
        Home: 0,
        End: tabs.length - 1
      };
      if (!Object.hasOwn(destinations, event.key)) return;
      event.preventDefault();
      const next = tabs[destinations[event.key]];
      select(next);
      next.focus();
    });
  }
}

const hero = document.querySelector('#hero-video');
const motionButton = document.querySelector('#motion-toggle');
const dialog = document.querySelector('#footage-dialog');
const player = document.querySelector('#footage-player');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let enabled = !reducedMotion.matches && !navigator.connection?.saveData;
let heroVisible = true;
let attempt = 0;

function motionLabel() {
  motionButton.querySelector('.motion-symbol').textContent = enabled ? 'Ⅱ' : '▶';
  motionButton.querySelector('.motion-label').textContent = enabled ? 'Pause feed' : 'Play feed';
}

function syncHero() {
  const sequence = ++attempt;
  motionLabel();
  if (!enabled || !heroVisible || document.hidden || dialog.open) {
    hero.pause();
    return;
  }
  if (!hero.getAttribute('src')) hero.src = hero.dataset.file;
  hero.play().catch(error => {
    // A later visibility or preference change can interrupt a pending play.
    if (attempt !== sequence || error.name === 'AbortError') return;
    enabled = false;
    motionLabel();
  });
}

hero.addEventListener('playing', () => hero.classList.add('has-frame'));
hero.addEventListener('error', () => {
  enabled = false;
  hero.classList.remove('has-frame');
  motionButton.hidden = true;
});
motionButton.hidden = false;
motionButton.addEventListener('click', () => {
  enabled = !enabled;
  syncHero();
});
reducedMotion.addEventListener('change', () => {
  enabled = !reducedMotion.matches && !navigator.connection?.saveData;
  syncHero();
});
document.addEventListener('visibilitychange', syncHero);
if ('IntersectionObserver' in window) {
  new IntersectionObserver(([entry]) => {
    heroVisible = entry.isIntersecting;
    syncHero();
  }).observe(hero.closest('.hero'));
} else {
  syncHero();
}

if (typeof dialog.showModal === 'function') {
  for (const link of document.querySelectorAll('[data-footage]')) {
    link.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      document.querySelector('#footage-title').textContent = link.dataset.footage;
      player.src = link.href;
      dialog.showModal();
      syncHero();
      // Native controls remain available when a browser requires a second tap.
      player.play().catch(() => {});
    });
  }
  document.querySelector('#close-footage').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    player.pause();
    player.removeAttribute('src');
    player.load();
    syncHero();
  });
}
