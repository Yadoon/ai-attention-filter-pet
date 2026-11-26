export type PetMood = 'idle' | 'eating' | 'spitting';

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
  const overlay =
    mood === 'eating'
      ? `<span class="mood-fx mood-fx-spark">⚡</span>`
      : mood === 'spitting'
        ? `<span class="mood-fx mood-fx-sweat">💧</span>`
        : '';

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
  if (mood === 'spitting') {
    return `<span class="pet-visual ${className}">
      <svg class="pet-svg" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="14" cy="17" r="2.8" fill="#fcd34d"/>
        <circle cx="26" cy="17" r="2.8" fill="#fcd34d"/>
        <path d="M14 27 Q20 22 26 27" stroke="#fcd34d" stroke-width="2.4" stroke-linecap="round"/>
      </svg>
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
