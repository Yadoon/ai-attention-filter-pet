export type PetMood = 'idle' | 'eating' | 'spitting' | 'listening' | 'disgusted';

export type PetSkinId = 'pikachu' | 'classic';

export type PetLayoutMode = 'mascot' | 'orb';

export interface PetSkinTheme {
  orbBackground: string;
  orbBorder: string;
  orbHoverBorder: string;
  orbEatBorder: string;
  orbShadow: string;
  counterBg: string;
  counterColor: string;
  bubbleBg: string;
  bubbleColor: string;
}

export interface PetSkin {
  id: PetSkinId;
  name: string;
  layout: PetLayoutMode;
  badgeIcon: string;
  eatPrefix: string;
  theme: PetSkinTheme;
  renderVisual: (mood: PetMood, className?: string) => string;
}

export const DEFAULT_PET_SKIN_ID: PetSkinId = 'pikachu';

function getAssetUrl(path: string): string {
  try {
    if (typeof browser !== 'undefined' && browser.runtime?.getURL) {
      return browser.runtime.getURL(path as '/pets/pikachu.png');
    }
  } catch {
    // Fallback for unit test environment without extension runtime.
  }
  return path;
}

function renderPikachuVisual(mood: PetMood, className = 'pet-face'): string {
  const src = getAssetUrl('/pets/pikachu.png');
  let overlay = '';

  if (mood === 'eating') {
    // Crisp golden electric sparks crackling off both cheeks
    overlay = `<svg class="mood-svg mood-svg-eat" viewBox="0 0 100 100" fill="none">
      <path d="M12 42 L22 36 L18 46 L27 42" stroke="#FACC15" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M88 40 L78 35 L82 45 L73 41" stroke="#FACC15" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="20" cy="24" r="3" fill="#FEF08A"/>
      <circle cx="82" cy="22" r="2.5" fill="#FEF08A"/>
    </svg>`;
  } else if (mood === 'spitting') {
    // Classic anime sweat drop sliding down temple
    overlay = `<svg class="mood-svg mood-svg-spit" viewBox="0 0 100 100" fill="none">
      <path d="M74 18 Q82 30 74 36 Q66 30 74 18 Z" fill="#38BDF8" stroke="#0284C7" stroke-width="1.8"/>
      <circle cx="72" cy="27" r="1.6" fill="#E0F2FE"/>
    </svg>`;
  } else if (mood === 'listening') {
    // Soft pulsing soundwave arcs + floating musical note
    overlay = `<svg class="mood-svg mood-svg-listen" viewBox="0 0 100 100" fill="none">
      <path class="wave-1" d="M76 26 Q85 34 76 42" stroke="#A78BFA" stroke-width="2.6" stroke-linecap="round"/>
      <path class="wave-2" d="M83 20 Q95 34 83 48" stroke="#C4B5FD" stroke-width="2.2" stroke-linecap="round"/>
      <path class="note-float" d="M18 28 L18 14 L29 11 L29 24" stroke="#C084FC" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
      <circle class="note-float" cx="15" cy="29" r="3.4" fill="#C084FC"/>
      <circle class="note-float" cx="26" cy="25" r="3.4" fill="#C084FC"/>
    </svg>`;
  } else if (mood === 'disgusted') {
    // Pure visual anime disgust: gloomy vertical forehead lines + jagged broken soundwave + red anger vein
    overlay = `<svg class="mood-svg mood-svg-disgust" viewBox="0 0 100 100" fill="none">
      <!-- Gloomy vertical shadow lines -->
      <g class="gloom-lines" stroke="#64748B" stroke-width="2.2" stroke-linecap="round" opacity="0.9">
        <line x1="36" y1="8" x2="36" y2="25"/>
        <line x1="43" y1="5" x2="43" y2="23"/>
        <line x1="50" y1="7" x2="50" y2="24"/>
        <line x1="57" y1="6" x2="57" y2="22"/>
      </g>
      <!-- Red anime anger cross -->
      <g class="anger-mark" stroke="#F43F5E" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M75 16 Q79 20 75 24"/>
        <path d="M87 16 Q83 20 87 24"/>
        <path d="M77 14 Q81 18 85 14"/>
        <path d="M77 26 Q81 22 85 26"/>
      </g>
      <!-- Jagged discordant noise wave -->
      <path class="noise-wave" d="M6 34 L12 26 L16 38 L22 24 L26 35" stroke="#FB7185" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  return `<span class="pet-visual ${className}">
    <img class="pet-sprite" src="${src}" alt="皮卡丘" draggable="false" />
    ${overlay}
  </span>`;
}

function renderClassicVisual(mood: PetMood, className = 'pet-face'): string {
  if (mood === 'eating') {
    return `<span class="pet-visual ${className}">
      <svg class="pet-svg" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M11 16 L16 19 L11 22" stroke="#7dd3fc" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M29 16 L24 19 L29 22" stroke="#7dd3fc" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
        <ellipse cx="20" cy="27" rx="6.5" ry="5.5" fill="#fb7185"/>
        <path d="M15 26 Q20 29 25 26" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
    </span>`;
  }
  if (mood === 'spitting' || mood === 'disgusted') {
    const color = mood === 'disgusted' ? '#c084fc' : '#fcd34d';
    return `<span class="pet-visual ${className}">
      <svg class="pet-svg" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M11 14 L16 17 L11 20" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M29 14 L24 17 L29 20" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M13 27 Q16.5 23 20 27 Q23.5 31 27 27" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>
      </svg>
    </span>`;
  }
  if (mood === 'listening') {
    return `<span class="pet-visual ${className}">
      <svg class="pet-svg" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="14" cy="17" r="3" fill="#a78bfa"/>
        <circle cx="26" cy="17" r="3" fill="#a78bfa"/>
        <path d="M16 25 Q20 28 24 25" stroke="#a78bfa" stroke-width="2.2" stroke-linecap="round"/>
      </svg>
      <span class="mood-fx mood-fx-listen">🎧</span>
    </span>`;
  }
  return `<span class="pet-visual ${className}">
    <svg class="pet-svg" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="14" cy="17" r="3" fill="#7dd3fc"/>
      <circle cx="26" cy="17" r="3" fill="#7dd3fc"/>
      <circle cx="15" cy="16" r="1" fill="#fff"/>
      <circle cx="27" cy="16" r="1" fill="#fff"/>
      <path d="M15 25 Q20 29 25 25" stroke="#7dd3fc" stroke-width="2.4" stroke-linecap="round"/>
    </svg>
  </span>`;
}

export const PET_SKINS: readonly PetSkin[] = [
  {
    id: 'pikachu',
    name: '皮卡丘桌宠',
    layout: 'mascot',
    badgeIcon: '⚡',
    eatPrefix: '⚡ 皮卡嚼嚼',
    theme: {
      orbBackground: 'transparent',
      orbBorder: 'transparent',
      orbHoverBorder: 'transparent',
      orbEatBorder: 'transparent',
      orbShadow: 'none',
      counterBg: '#ef4444',
      counterColor: '#ffffff',
      bubbleBg: 'rgba(250, 204, 21, 0.96)',
      bubbleColor: '#451a03',
    },
    renderVisual: renderPikachuVisual,
  },
  {
    id: 'classic',
    name: '守护球',
    layout: 'orb',
    badgeIcon: '🐾',
    eatPrefix: '嚼嚼',
    theme: {
      orbBackground: 'radial-gradient(circle at 30% 25%, #1e293b, #0f172a 75%)',
      orbBorder: 'rgba(56, 189, 248, 0.45)',
      orbHoverBorder: 'rgba(125, 211, 252, 0.85)',
      orbEatBorder: '#38bdf8',
      orbShadow: '0 10px 26px rgba(2, 6, 23, 0.5)',
      counterBg: '#0284c7',
      counterColor: '#ffffff',
      bubbleBg: 'rgba(14, 165, 233, 0.95)',
      bubbleColor: '#082f49',
    },
    renderVisual: renderClassicVisual,
  },
];

export function isPetSkinId(value: unknown): value is PetSkinId {
  return typeof value === 'string' && PET_SKINS.some((skin) => skin.id === value);
}

export function getPetSkin(id?: string): PetSkin {
  return PET_SKINS.find((skin) => skin.id === id) ?? PET_SKINS[0];
}
