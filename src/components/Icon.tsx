/* Pictogrammes en trait de 2px, tracés dans la couleur du texte. Toujours décoratifs :
   le sens est porté par le mot voisin. */

const paths = {
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  todo: <path d="M4 6h16M4 12h16M4 18h10" />,
  projects: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="2" />
      <rect x="13" y="4" width="7" height="7" rx="2" />
      <rect x="4" y="13" width="7" height="7" rx="2" />
      <rect x="13" y="13" width="7" height="7" rx="2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </>
  ),
  back: <path d="M15 6l-6 6 6 6" />,
  shield: (
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3l9.5 17h-19z" />
      <path d="M12 10v4.5M12 17.5v.1" />
    </>
  ),
  blocked: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),
  offline: <path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0M12 19.5v.1M3 3l18 18" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  retry: <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" />,
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, className = 'ico' }: { name: IconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {paths[name]}
    </svg>
  );
}
