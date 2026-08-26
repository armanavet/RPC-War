/* ============================================================
   The game catalogue. Adding a game to the site means adding an
   entry here and dropping its files in js/games/<slug>/.

   Keep `blurb` to one short line — the card is not the manual.
   ============================================================ */

export const GAMES = [

  {
    slug:  'slipstream',
    title: 'Slipstream',
    blurb: 'Pieces slide until something stops them, on a board that keeps closing in.',
    tags:  ['2 players', '3 min'],
    href:  'games/slipstream/',
    art: `<svg viewBox="0 0 120 76" fill="none" aria-hidden="true">
        <rect x="8" y="6" width="104" height="64" rx="4" fill="var(--board-lite)"/>
        <rect x="8" y="6" width="104" height="10" fill="var(--surface-3)"/>
        <rect x="8" y="60" width="104" height="10" fill="var(--surface-3)"/>
        <rect x="8" y="6" width="10" height="64" fill="var(--surface-3)"/>
        <rect x="102" y="6" width="10" height="64" fill="var(--surface-3)"/>
        <rect x="40" y="26" width="10" height="10" fill="var(--board-dark)"/>
        <rect x="72" y="42" width="10" height="10" fill="var(--board-dark)"/>
        <g fill="var(--accent)" opacity=".5">
          <circle cx="34" cy="49" r="2"/><circle cx="44" cy="49" r="2"/>
          <circle cx="54" cy="49" r="2"/><circle cx="64" cy="49" r="2"/>
        </g>
        <circle cx="26" cy="49" r="7" fill="var(--blue)"/>
        <circle cx="74" cy="49" r="7" fill="var(--red)"/>
      </svg>`,
  },
  {
    slug:  'rps-chess',
    title: 'RPS Chess',
    blurb: 'Every piece moves like a king. Every capture is rock, paper, scissors.',
    tags:  ['2 players', '5 min'],
    href:  'games/rps-chess/',
    art: `<svg viewBox="0 0 120 76" fill="none" aria-hidden="true">
        <defs><clipPath id="rpsBoard"><rect x="10" y="8" width="100" height="60" rx="4"/></clipPath></defs>
        <g clip-path="url(#rpsBoard)">
          <rect x="10" y="8" width="100" height="60" fill="var(--board-lite)"/>
          <g fill="var(--board-dark)">
            <rect x="10" y="8"  width="25" height="15"/><rect x="60" y="8"  width="25" height="15"/>
            <rect x="35" y="23" width="25" height="15"/><rect x="85" y="23" width="25" height="15"/>
            <rect x="10" y="38" width="25" height="15"/><rect x="60" y="38" width="25" height="15"/>
            <rect x="35" y="53" width="25" height="15"/><rect x="85" y="53" width="25" height="15"/>
          </g>
        </g>
        <circle cx="44" cy="30" r="17" fill="var(--blue)"/>
        <circle cx="76" cy="47" r="17" fill="var(--red)"/>
        <g stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
          <path d="M38.3 21.8h7.8l4.6 4.6v11.8H38.3z"/>
          <path d="M46.1 21.8v4.6h4.6M40.8 30h6.5M40.8 33.4h6.5"/>
          <circle cx="70.7" cy="52.7" r="2.5"/><circle cx="81.3" cy="52.7" r="2.5"/>
          <path d="M72.5 50.9 82 39M79.5 50.9 70 39"/>
        </g>
      </svg>`,
  },
  {
    slug:  'anvil',
    title: 'Anvil',
    blurb: 'Hold the middle four squares. The only way to move anyone is to shove them.',
    tags:  ['2 players', '7 min'],
    href:  'games/anvil/',
    art: `<svg viewBox="0 0 120 76" fill="none" aria-hidden="true">
        <rect x="18" y="6" width="84" height="64" rx="4" fill="var(--board-lite)"/>
        <g fill="var(--board-dark)">
          <rect x="18" y="6"  width="14" height="16"/><rect x="46" y="6"  width="14" height="16"/>
          <rect x="74" y="6"  width="14" height="16"/><rect x="32" y="22" width="14" height="16"/>
          <rect x="60" y="22" width="14" height="16"/><rect x="88" y="22" width="14" height="16"/>
          <rect x="18" y="38" width="14" height="16"/><rect x="46" y="38" width="14" height="16"/>
          <rect x="74" y="38" width="14" height="16"/><rect x="32" y="54" width="14" height="16"/>
          <rect x="60" y="54" width="14" height="16"/><rect x="88" y="54" width="14" height="16"/>
        </g>
        <rect x="46" y="22" width="28" height="32" fill="none" stroke="var(--accent)" stroke-width="2.5"/>
        <circle cx="53" cy="30" r="6" fill="var(--blue)"/>
        <circle cx="67" cy="30" r="6" fill="var(--blue)"/>
        <circle cx="53" cy="46" r="6" fill="var(--red)"/>
        <path d="M88 62h11m-4-4 4 4-4 4" stroke="var(--text-3)" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`,
  },  {
    slug:  'cairn',
    title: 'Cairn',
    blurb: 'A stack moves as far as it is tall. Whoever lands on top owns everything underneath.',
    tags:  ['2 players', '10 min'],
    href:  'games/cairn/',
    art: `<svg viewBox="0 0 120 76" fill="none" aria-hidden="true">
        <rect x="10" y="6" width="100" height="64" rx="4" fill="var(--board-lite)"/>
        <g fill="var(--board-dark)">
          <rect x="10" y="6"  width="20" height="16"/><rect x="50" y="6"  width="20" height="16"/>
          <rect x="90" y="6"  width="20" height="16"/><rect x="30" y="22" width="20" height="16"/>
          <rect x="70" y="22" width="20" height="16"/><rect x="10" y="38" width="20" height="16"/>
          <rect x="50" y="38" width="20" height="16"/><rect x="90" y="38" width="20" height="16"/>
          <rect x="30" y="54" width="20" height="16"/><rect x="70" y="54" width="20" height="16"/>
        </g>
        <g>
          <ellipse cx="38" cy="52" rx="11" ry="5" fill="var(--red)"/>
          <ellipse cx="38" cy="45" rx="11" ry="5" fill="var(--red)"/>
          <ellipse cx="38" cy="38" rx="11" ry="5" fill="var(--blue)"/>
          <ellipse cx="38" cy="38" rx="11" ry="5" fill="none" stroke="#fff" stroke-width="1.6"/>
        </g>
        <g>
          <ellipse cx="80" cy="52" rx="11" ry="5" fill="var(--blue)"/>
          <ellipse cx="80" cy="45" rx="11" ry="5" fill="var(--red)"/>
          <ellipse cx="80" cy="45" rx="11" ry="5" fill="none" stroke="#fff" stroke-width="1.6"/>
        </g>
      </svg>`,
  },];
