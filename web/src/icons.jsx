// Ícones vetoriais das alternativas (tema exploração espacial).
// Desenhados em viewBox 64×64 com `currentColor`; os detalhes usam preto translúcido,
// então funcionam sobre qualquer cor de fundo.

const SOMBRA = { fill: '#000', fillOpacity: 0.28 };

function Foguete() {
  return (
    <g transform="rotate(40 32 32)">
      <path d="M27.5 51.5C28.2 56.5 29.8 60 32 63.5 34.2 60 35.8 56.5 36.5 51.5Z" opacity=".55" />
      <path d="M24 44h16l-2.6 6.5H26.6Z" opacity=".8" />
      <path d="M20 31.5 10.5 42v10.5L20 46.5Z" />
      <path d="M44 31.5 53.5 42v10.5L44 46.5Z" />
      <path d="M32 5c8.5 6.4 12.5 16.6 12.5 29v10h-25V34C19.5 21.6 23.5 11.4 32 5Z" />
      <path d="M32 5c4.6 3.4 7.8 8 9.7 13.5H22.3C24.2 13 27.4 8.4 32 5Z" {...SOMBRA} />
      <circle cx="32" cy="28.5" r="6.2" {...SOMBRA} />
      <circle cx="32" cy="28.5" r="3.6" />
      <rect x="30.4" y="37" width="3.2" height="7" rx="1.6" {...SOMBRA} />
    </g>
  );
}

function Satelite() {
  return (
    <g transform="rotate(-28 32 32)">
      <rect x="3" y="26" width="18" height="12" rx="1.6" />
      <rect x="43" y="26" width="18" height="12" rx="1.6" />
      <path d="M9 26v12M15 26v12M3 32h18M49 26v12M55 26v12M43 32h18" stroke="#000" strokeOpacity=".3" strokeWidth="1.4" />
      <rect x="20" y="30.5" width="6" height="3" />
      <rect x="38" y="30.5" width="6" height="3" />
      <rect x="25" y="21" width="14" height="22" rx="2.6" />
      <rect x="25" y="27" width="14" height="3.2" {...SOMBRA} />
      <rect x="25" y="35" width="14" height="3.2" {...SOMBRA} />
      <rect x="30.8" y="16.5" width="2.4" height="5" />
      <path d="M22.5 11.5Q32 23 41.5 11.5Z" />
      <path d="M32 15V5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="32" cy="4.5" r="2.4" />
      <path d="M28 47.5v6M36 47.5v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".6" />
    </g>
  );
}

function Planeta() {
  const anel = 'rotate(-18 32 32)';
  return (
    <g>
      <path d="M4.5 32a27.5 9 0 0 1 55 0" transform={anel} fill="none" stroke="currentColor" strokeWidth="3.4" opacity=".55" />
      <circle cx="32" cy="32" r="15" />
      <path d="M32 17a15 15 0 0 1 0 30 10.5 15 0 0 0 0-30Z" {...SOMBRA} />
      <path d="M18.6 27.5Q32 31 45.4 27.5M17.6 36.5Q32 40 46.4 36.5" fill="none" stroke="#000" strokeOpacity=".18" strokeWidth="2.6" />
      <path d="M4.5 32a27.5 9 0 0 0 55 0" transform={anel} fill="none" stroke="#000" strokeOpacity=".35" strokeWidth="6.5" />
      <path d="M4.5 32a27.5 9 0 0 0 55 0" transform={anel} fill="none" stroke="currentColor" strokeWidth="3.4" />
      <circle cx="54.5" cy="11" r="3.6" />
      <circle cx="55.6" cy="10" r="1.1" {...SOMBRA} />
    </g>
  );
}

function Cometa() {
  return (
    <g>
      <path d="M34.5 15.5 3.5 57 48.5 29.5Z" opacity=".28" />
      <path d="M36.5 20.5 11.5 49.5 43.5 27.5Z" opacity=".55" />
      <circle cx="42" cy="22" r="14.5" opacity=".22" />
      <circle cx="42" cy="22" r="10.5" />
      <circle cx="45.5" cy="18.5" r="3.2" fill="#fff" fillOpacity=".55" />
      <path d="M13 6.5l1.6 4.9 4.9 1.6-4.9 1.6L13 19.5l-1.6-4.9-4.9-1.6 4.9-1.6Z" />
      <path d="M55 45l1 3 3 1-3 1-1 3-1-3-3-1 3-1Z" opacity=".8" />
    </g>
  );
}

const DESENHOS = [Foguete, Satelite, Planeta, Cometa];
export const NOMES_ICONES = ['Foguete', 'Satélite', 'Planeta', 'Cometa'];
export const CORES = ['c0', 'c1', 'c2', 'c3'];

export function Icone({ i, className = 'forma' }) {
  const Desenho = DESENHOS[i] || DESENHOS[0];
  return (
    <svg className={className} viewBox="0 0 64 64" fill="currentColor" role="img" aria-label={NOMES_ICONES[i]}>
      <Desenho />
    </svg>
  );
}

/** Logotipo: órbita estilizada com um satélite. */
export function Logo({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="lg-orbita" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffd166" />
          <stop offset="1" stopColor="#ff7a45" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="13" fill="url(#lg-orbita)" />
      <ellipse cx="32" cy="32" rx="28" ry="11" transform="rotate(-25 32 32)" fill="none" stroke="#9fd3ff" strokeWidth="3" />
      <circle cx="55" cy="20.5" r="4.5" fill="#fff" />
    </svg>
  );
}
