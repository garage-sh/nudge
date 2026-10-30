/**
 * Draws the README's animated diagram, `flow.svg` and `flow-dark.svg`, beside this file:
 * Feedback and Incidents from several applications reach nudge, which triages the
 * Feedback, groups the Incidents, and dispatches both to the Destinations.
 *
 * Run it after changing the scene below: `node docs/assets/flow.mjs`.
 */
import { writeFileSync } from 'node:fs';

const WIDTH = 960;
const HEIGHT = 440;
/** One loop of the animation, in seconds. */
const DURATION = 13;
/** The share of the loop a token spends moving. */
const TRAVEL = 0.36;

const PALETTES = {
  light: {
    bg: '#f6f8f7',
    text: '#16201c',
    muted: '#5b6762',
    card: '#ffffff',
    line: '#dce2df',
    path: '#c4ccc8',
    accent: '#176a52',
    grey: '#9aa7a1',
    on: '#ffffff',
    danger: '#b42318',
    severity: ['#87938e', '#b7791f', '#d0531d', '#b4161b'],
    level: { info: '#87938e', warning: '#b7791f', error: '#d0531d', critical: '#b4161b' },
  },
  dark: {
    bg: '#131917',
    text: '#e6ece9',
    muted: '#9aa7a1',
    card: '#1a211e',
    line: '#2a3430',
    path: '#3a4641',
    accent: '#5cc4a0',
    grey: '#5b6762',
    on: '#1a211e',
    danger: '#f2867a',
    severity: ['#6f7c76', '#d9a03a', '#ec7a45', '#f0544f'],
    level: { info: '#6f7c76', warning: '#d9a03a', error: '#ec7a45', critical: '#f0544f' },
  },
};

/** The applications on the left: their name, and how they send. */
const SOURCES = [
  ['Web app', 'Widget'],
  ['Docs site', 'Widget'],
  ['Backend', 'SDK · HTTP API'],
  ['Nightly jobs', 'SDK'],
];
const SOURCE_Y = [78, 168, 258, 348];
const DESTINATIONS = ['Linear', 'GitHub Issues', 'Slack', 'Discord', 'Email', 'Webhook'];
const DESTINATION_Y = DESTINATIONS.map((_, i) => 70 + i * 56);
/** nudge: the path enters at `left`, leaves at `right`, at height `y`. */
const HUB = { left: 380, right: 580, y: 213 };
const HUB_BOX = { x: 380, y: 128, width: 200, height: 170 };

/**
 * The scene: each token, its source and Destination (`null`: it stops in nudge), when
 * it leaves, and its Severity (Feedback, 0 for Junk) or Level (Incident).
 */
const ITEMS = [
  { kind: 'feedback', source: 0, destination: 0, begin: 0, value: 3 },
  { kind: 'feedback', source: 1, destination: null, begin: 1.6, value: 0 },
  { kind: 'incident', source: 2, destination: 2, begin: 3.2, value: 'critical' },
  { kind: 'incident', source: 2, destination: null, begin: 3.55, value: 'critical' },
  { kind: 'incident', source: 2, destination: null, begin: 3.9, value: 'critical' },
  { kind: 'feedback', source: 0, destination: 1, begin: 5.8, value: 2 },
  { kind: 'incident', source: 3, destination: 5, begin: 7.4, value: 'warning' },
  { kind: 'feedback', source: 2, destination: 2, begin: 9, value: 4 },
  { kind: 'feedback', source: 1, destination: 3, begin: 10.6, value: 1 },
  { kind: 'incident', source: 3, destination: 4, begin: 11.8, value: 'error' },
];
/** The note under nudge when the repeated Occurrences are grouped (the 4th token). */
const GROUPED = { item: 3, label: '3 Occurrences, 1 Incident' };

/** The four bars of a Severity gauge inside a token: x, y and height around its center. */
const BARS = [
  [-8, 2, 3],
  [-3.5, 0, 5],
  [1, -2, 7],
  [5.5, -4, 9],
];

const bezierLength = (p0, p1, p2, p3, steps = 60) => {
  let total = 0;
  let previous = p0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const point = [0, 1].map(
      (axis) =>
        (1 - t) ** 3 * p0[axis] +
        3 * (1 - t) ** 2 * t * p1[axis] +
        3 * (1 - t) * t ** 2 * p2[axis] +
        t ** 3 * p3[axis],
    );
    total += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    previous = point;
  }
  return total;
};

/** A token's path, the distance to nudge, and the whole distance. */
function route(source, destination) {
  const sy = SOURCE_Y[source];
  const { left, right, y } = HUB;
  let d = `M224 ${sy} C304 ${sy} 300 ${y} ${left} ${y}`;
  const toHub = bezierLength([224, sy], [304, sy], [300, y], [left, y]);
  if (destination === null) {
    const middle = (left + right) / 2;
    return { d: `${d} L${middle} ${y}`, toHub, total: toHub + (middle - left) };
  }
  const ty = DESTINATION_Y[destination];
  d += ` L${right} ${y} C660 ${y} 656 ${ty} 736 ${ty}`;
  const out = bezierLength([right, y], [660, y], [656, ty], [736, ty]);
  return { d, toHub, total: toHub + (right - left) + out };
}

/** A key time, without trailing zeros. */
const k = (x) => String(Number(x.toFixed(4)));

const animate = (attribute, values, times, begin) =>
  `<animate attributeName="${attribute}" values="${values}" keyTimes="${times}" dur="${DURATION}s" begin="${begin}s" repeatCount="indefinite"/>`;

const incidentMark = (p, color, cx = 0, cy = 0) => [
  `<circle${cx ? ` cx="${cx}"` : ''}${cy ? ` cy="${cy}"` : ''} r="10" fill="${color}"/>`,
  `<rect x="${cx - 1.5}" y="${cy - 6}" width="3" height="7.5" rx="1.5" fill="${p.on}"/>`,
  `<circle${cx ? ` cx="${cx}"` : ''} cy="${cy + 4.5}" r="1.7" fill="${p.on}"/>`,
];

function draw(p) {
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img" aria-label="Feedback from users and Incidents from servers, sent by several Projects, reach nudge, which triages the Feedback, groups the Incidents, and dispatches both to Linear, GitHub Issues, Slack, Discord, email and webhooks">`,
    `<rect width="${WIDTH}" height="${HEIGHT}" rx="16" fill="${p.bg}"/>`,
    `<g font-family="'Instrument Sans', ui-sans-serif, -apple-system, 'Segoe UI', Roboto, sans-serif" fill="${p.text}">`,
  ];
  for (const [x, label] of [
    [24, 'Your applications'],
    [380, 'Your Instance'],
    [736, 'Destinations'],
  ]) {
    out.push(
      `<text x="${x}" y="36" font-size="13" font-weight="600" fill="${p.muted}">${label}</text>`,
    );
  }
  const { left, right, y: hubY } = HUB;
  const dashed = `fill="none" stroke="${p.path}" stroke-width="1.5" stroke-dasharray="4 5"`;
  for (const y of SOURCE_Y) {
    out.push(`<path d="M224 ${y} C304 ${y} 300 ${hubY} ${left} ${hubY}" ${dashed}/>`);
  }
  for (const y of DESTINATION_Y) {
    out.push(`<path d="M${right} ${hubY} C660 ${hubY} 656 ${y} 736 ${y}" ${dashed}/>`);
  }

  // The tokens, drawn first: nudge's box hides them while they cross it.
  const pulses = [];
  const rings = [];
  const notes = [];
  for (const { kind, source, destination, begin, value } of ITEMS) {
    const { d, toHub, total } = route(source, destination);
    // A token that stops in nudge moves at the speed of one that goes through.
    const end = destination === null ? (TRAVEL * total) / route(source, 0).total : TRAVEL;
    const atHub = (end * toHub) / total;
    const lit = `0;${k(atHub + 0.02)};${k(atHub + 0.021)};1`;
    out.push('<g opacity="0">');
    if (kind === 'feedback') {
      const color = value ? p.severity[value - 1] : p.danger;
      out.push(
        `<rect x="-14" y="-9" width="28" height="18" rx="5" fill="${p.grey}">${animate('fill', `${p.grey};${p.grey};${color};${color}`, lit, begin)}</rect>`,
      );
      BARS.forEach(([x, y, height], i) => {
        const opacity = i < value ? 0.95 : 0.35;
        out.push(
          `<rect x="${x}" y="${y}" width="3" height="${height}" rx="1" fill="${p.on}" opacity="0">${animate('opacity', `0;0;${opacity};${opacity}`, lit, begin)}</rect>`,
        );
      });
      if (destination === null)
        notes.push({ begin, atHub, label: 'Junk, not dispatched', color: p.danger });
    } else {
      out.push(...incidentMark(p, p.level[value]));
    }
    out.push(
      `<animateMotion path="${d}" keyPoints="0;1;1" keyTimes="0;${k(end)};1" calcMode="linear" dur="${DURATION}s" begin="${begin}s" repeatCount="indefinite"/>`,
      animate('opacity', '0;1;1;0;0', `0;0.015;${k(end - 0.015)};${k(end)};1`, begin),
      '</g>',
    );
    pulses.push({ begin, atHub });
    if (destination !== null) {
      const color = kind === 'feedback' ? p.severity[value - 1] : p.level[value];
      rings.push({ destination, color, begin, end });
    }
  }
  notes.push({ ...pulses[GROUPED.item], label: GROUPED.label, color: p.muted });

  SOURCES.forEach(([name, sends], i) => {
    const y = SOURCE_Y[i] - 30;
    out.push(
      `<rect x="24" y="${y}" width="200" height="60" rx="10" fill="${p.card}" stroke="${p.line}"/>`,
      `<text x="42" y="${y + 27}" font-size="15" font-weight="600">${name}</text>`,
      `<text x="42" y="${y + 46}" font-size="12.5" fill="${p.muted}">${sends}</text>`,
    );
  });

  const box = HUB_BOX;
  out.push(
    `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="14" fill="${p.card}" stroke="${p.accent}" stroke-width="1.5"/>`,
  );
  for (const { begin, atHub } of pulses) {
    out.push(
      `<rect x="${box.x - 4}" y="${box.y - 4}" width="${box.width + 8}" height="${box.height + 8}" rx="17" fill="none" stroke="${p.accent}" stroke-width="2" opacity="0">${animate('opacity', '0;0;0.6;0;0', `0;${k(atHub)};${k(atHub + 0.01)};${k(atHub + 0.06)};1`, begin)}</rect>`,
    );
  }
  for (const { begin, atHub, label, color } of notes) {
    const times = `0;${k(atHub + 0.02)};${k(atHub + 0.035)};${k(atHub + 0.13)};${k(atHub + 0.15)};1`;
    out.push(
      `<text x="480" y="${box.y + box.height + 24}" text-anchor="middle" font-size="12.5" font-weight="500" fill="${color}" opacity="0">${label}${animate('opacity', '0;0;1;1;0;0', times, begin)}</text>`,
    );
  }
  for (const [x, y, height] of [
    [424, 175, 8],
    [431, 170, 13],
    [438, 165, 18],
    [445, 160, 23],
  ]) {
    out.push(`<rect x="${x}" y="${y}" width="5" height="${height}" rx="1.5" fill="${p.accent}"/>`);
  }
  out.push(
    '<text x="460" y="182" font-size="24" font-weight="700" letter-spacing="-0.5">nudge</text>',
    '<text x="480" y="220" text-anchor="middle" font-size="12.5" font-weight="600">Feedback</text>',
    `<text x="480" y="237" text-anchor="middle" font-size="12" fill="${p.muted}">triaged by the Judge</text>`,
    '<text x="480" y="263" text-anchor="middle" font-size="12.5" font-weight="600">Incidents</text>',
    `<text x="480" y="280" text-anchor="middle" font-size="12" fill="${p.muted}">grouped, given a Level</text>`,
  );

  DESTINATIONS.forEach((name, i) => {
    const y = DESTINATION_Y[i] - 22;
    out.push(
      `<rect x="736" y="${y}" width="200" height="44" rx="10" fill="${p.card}" stroke="${p.line}"/>`,
      `<text x="754" y="${y + 27}" font-size="14.5" font-weight="600">${name}</text>`,
    );
  });
  for (const { destination, color, begin, end } of rings) {
    const y = DESTINATION_Y[destination] - 22;
    out.push(
      `<rect x="736" y="${y}" width="200" height="44" rx="10" fill="none" stroke="${color}" stroke-width="2" opacity="0">${animate('opacity', '0;0;1;0;0', `0;${k(end - 0.01)};${k(end + 0.005)};${k(end + 0.08)};1`, begin)}</rect>`,
    );
  }

  // The legend: what each token stands for.
  const ly = HEIGHT - 26;
  out.push(`<rect x="24" y="${ly - 9}" width="28" height="18" rx="5" fill="${p.severity[2]}"/>`);
  BARS.forEach(([x, y, height], i) => {
    out.push(
      `<rect x="${38 + x}" y="${ly + y}" width="3" height="${height}" rx="1" fill="${p.on}" opacity="${i < 3 ? 0.95 : 0.35}"/>`,
    );
  });
  out.push(
    `<text x="62" y="${ly + 4.5}" font-size="12.5" fill="${p.muted}">Feedback, colored by its Severity</text>`,
    ...incidentMark(p, p.level.critical, 290, ly),
    `<text x="308" y="${ly + 4.5}" font-size="12.5" fill="${p.muted}">Incident, colored by its Level</text>`,
    '</g></svg>',
  );
  return `${out.join('\n')}\n`;
}

const here = new URL('.', import.meta.url);
writeFileSync(new URL('flow.svg', here), draw(PALETTES.light));
writeFileSync(new URL('flow-dark.svg', here), draw(PALETTES.dark));
