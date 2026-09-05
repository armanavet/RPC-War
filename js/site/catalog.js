/* ============================================================
   The game catalogue. Adding a game to the site means adding an
   entry here and dropping its files in js/games/<slug>/.

   Keep `blurb` to one short line — the card is not the manual.

   `kind` decides which page a game appears on. The two quick games
   and the four wargames want completely different visitors: one is a
   thing you play while the kettle boils, the other is an evening.
   Putting them in one list made the homepage read as a wall of
   equally-weighted options, and the five-minute games were the ones
   that suffered.

     'quick'  the homepage
     'war'    /wargames/
   ============================================================ */

export const GAMES = [

  {
    kind:  'quick',
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
    kind:  'quick',
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
  },
  {
    kind:  'war',
    slug:  'salient',
    title: 'Salient',
    blurb: 'Ground belongs to whoever pushes hardest on it. Take a unit by surrounding it.',
    tags:  ['2 players', '20 min', 'heavy'],
    href:  'games/salient/',
    art: `<svg viewBox="0 0 120 76" fill="none" aria-hidden="true">
        <rect x="4" y="6" width="112" height="64" rx="3" fill="var(--board-lite)"/>
        <path d="M4 6h112v26c-14 0-18 8-32 8s-18-9-32-9-20 7-34 7-14 0-14 0z" fill="var(--red)" opacity=".2"/>
        <path d="M4 70h112V44c-14 0-18-8-32-8s-18 9-32 9-20-7-34-7-14 0-14 0z" fill="var(--blue)" opacity=".2"/>
        <path d="M4 32c14 0 18 8 32 8s18-9 32-9 20 7 34 7 14 0 14 0" stroke="var(--wall)" stroke-width="2.4" fill="none"/>
        <circle cx="40" cy="24" r="6" fill="none" stroke="var(--even)" stroke-width="2.2"/>
        <circle cx="84" cy="52" r="6" fill="none" stroke="var(--even)" stroke-width="2.2"/>
        <g stroke="var(--red-hi)" stroke-width="1.6"><rect x="24" y="14" width="14" height="9" rx="1" fill="var(--surface)"/><path d="m25.6 15.6 10.8 5.8M36.4 15.6l-10.8 5.8"/></g>
        <g stroke="var(--blue-hi)" stroke-width="1.6"><rect x="72" y="52" width="14" height="9" rx="1" fill="var(--surface)"/><ellipse cx="79" cy="56.5" rx="4.6" ry="2.6" fill="none"/></g>
      </svg>`,
  },
  {
    kind:  'war',
    slug:  'tideline',
    title: 'Tideline',
    blurb: 'Ground you take stays taken. Your army cannot outrun its own territory.',
    tags:  ['2 players', '25 min', 'heavy'],
    href:  'games/tideline/',
    art: `<svg viewBox="0 0 120 76" fill="none" aria-hidden="true">
        <rect x="4" y="6" width="112" height="64" rx="3" fill="var(--board-lite)"/>
        <path d="M4 6h112v18H74v10H46v-8H4z" fill="var(--red)" opacity=".26"/>
        <path d="M4 70h112V52H74V42H46v8H4z" fill="var(--blue)" opacity=".26"/>
        <path d="M4 26h42v-8h28v10h42" stroke="var(--wall)" stroke-width="2.4" fill="none"/>
        <path d="M4 50h42v8h28V48h42" stroke="var(--wall)" stroke-width="2.4" fill="none"/>
        <g stroke="var(--accent)" stroke-width="1.8" stroke-dasharray="3 3">
          <rect x="47" y="29" width="12" height="8"/><rect x="61" y="39" width="12" height="8"/>
        </g>
        <circle cx="24" cy="38" r="6" fill="none" stroke="var(--even)" stroke-width="2.2"/>
        <circle cx="96" cy="38" r="6" fill="none" stroke="var(--even)" stroke-width="2.2"/>
      </svg>`,
  },
  {
    kind:  'war',
    slug:  'breakthrough',
    title: 'Breakthrough',
    blurb: 'Control does not move the line. Pressure does. Mass, crack a sector, pour through.',
    tags:  ['2 players', '25 min', 'heavy'],
    href:  'games/breakthrough/',
    art: `<svg viewBox="0 0 120 76" fill="none" aria-hidden="true">
        <rect x="4" y="6" width="112" height="64" rx="3" fill="var(--board-lite)"/>
        <path d="M4 6h112v28H70l-6 6-6-6H4z" fill="var(--red)" opacity=".2"/>
        <path d="M4 70h112V46H70l-6-6-6 6H4z" fill="var(--blue)" opacity=".2"/>
        <path d="M4 34h54M70 34h46" stroke="var(--wall)" stroke-width="2.4"/>
        <path d="M4 46h54M70 46h46" stroke="var(--wall)" stroke-width="2.4"/>
        <g fill="var(--even)"><rect x="44" y="24" width="4" height="10" rx="1"/>
          <rect x="52" y="20" width="4" height="14" rx="1"/><rect x="60" y="18" width="4" height="16" rx="1"/>
          <rect x="68" y="22" width="4" height="12" rx="1"/></g>
        <path d="M62 44v16m0 0-5-5m5 5 5-5" stroke="var(--blue-hi)" stroke-width="2.4"
              stroke-linecap="round" stroke-linejoin="round" transform="rotate(180 62 52)"/>
      </svg>`,
  },
  {
    kind:  'war',
    slug:  'barbican',
    title: 'Barbican',
    blurb: 'A siege. Nineteen men and no time against nine men and a wall.',
    tags:  ['2 players', '30 min', 'asymmetric'],
    href:  'games/barbican/',
    art: `<svg viewBox="0 0 120 76" fill="none" aria-hidden="true">
        <rect x="4" y="6" width="112" height="64" rx="3" fill="var(--board-lite)"/>
        <g stroke="var(--text)" stroke-width="2" fill="var(--surface)">
          <rect x="30" y="14" width="60" height="34"/>
          <rect x="26" y="10" width="12" height="42"/><rect x="82" y="10" width="12" height="42"/>
          <rect x="52" y="20" width="16" height="22"/>
        </g>
        <g fill="var(--red)"><rect x="44" y="17" width="6" height="7"/><rect x="70" y="17" width="6" height="7"/></g>
        <g fill="var(--blue)"><rect x="20" y="60" width="7" height="9"/><rect x="34" y="60" width="7" height="9"/>
          <rect x="48" y="60" width="7" height="9"/><rect x="62" y="60" width="7" height="9"/>
          <rect x="76" y="60" width="7" height="9"/><rect x="90" y="60" width="7" height="9"/></g>
        <path d="M60 58V50m0 0-4 4m4-4 4 4" stroke="var(--blue)" stroke-width="2.4"
              stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`,
  },
];
