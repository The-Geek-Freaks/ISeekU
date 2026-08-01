import React from 'react';

/**
 * The 16x16 Status icon, drawn rather than shipped as bitmaps.
 *
 * ICQ's own icons are its artwork, so these are an original interpretation of
 * the same idea: the flower for reachable Statuses, and the shapes ICQ used to
 * distinguish the rest — a crescent for Away, a clock for N/A, a bar for DND,
 * an outline for Invisible.
 *
 * SVG rather than PNG because a Status icon is drawn hundreds of times in a
 * Contact List, needs to stay crisp when the Owner scales the list, and should
 * not cost a network round trip or a build step.
 *
 * The geometry is snapped to the 16px grid on purpose: at this size a half
 * pixel is the difference between a crisp icon and a smudged one.
 */

/**
 * The flower's colours, measured from a real ICQ asset rather than guessed.
 *
 * Extracted pixel-by-pixel from the ICQ 2001b splash screen
 * (guidebookgallery.org/pics/splashes/icq/2001b.png): the petals are #00FF00,
 * the one odd petal is #FF0000, and the centre is #FFFF00 — pure 8-bit
 * primaries, which is exactly what a late-90s Windows application would use.
 *
 * An earlier version of this file used #4DAB27 and #FC021E, taken from the
 * icq.com *website* palette of 2006. That was a real mistake worth recording:
 * a brand's website colours are not its application's colours, and the muted
 * greens made the flower read as 2006 rather than 2001.
 */
const PALETTE = {
  online: '#00FF00',
  chat: '#7FFF00',
  away: '#FFD700',
  na: '#FF8C00',
  occupied: '#FF4500',
  dnd: '#FF0000',
  invisible: '#808080',
  offline: '#808080',
};

/** VERIFIED from the 2001b splash: petal, odd petal, centre. */
const FLOWER = { petal: '#00FF00', oddPetal: '#FF0000', centre: '#FFFF00' };

/** Petal positions for the flower, at 45-degree steps around the centre. */
const PETALS = [
  [8, 3], [11.5, 4.5], [13, 8], [11.5, 11.5],
  [8, 13], [4.5, 11.5], [3, 8], [4.5, 4.5],
];

/**
 * The flower, as used for the Statuses where the Owner is reachable.
 * One petal is red — the detail everybody remembers about the ICQ logo.
 */
function Flower({ colour, dim }) {
  return (
    <g opacity={dim ? 0.45 : 1}>
      {PETALS.map(([cx, cy], i) => (
        <circle
          key={`${cx}-${cy}`}
          cx={cx}
          cy={cy}
          r="2.4"
          // The single odd petal. On the real logo it sits top-right of the
          // centre, and it is the detail everyone remembers.
          fill={i === 1 ? FLOWER.oddPetal : colour}
        />
      ))}
      <circle cx="8" cy="8" r="2.6" fill={FLOWER.centre} />
    </g>
  );
}

function Crescent({ colour }) {
  // A disc with a second disc punched out of it — the Away moon.
  return (
    <g>
      <mask id="icq-crescent">
        <rect width="16" height="16" fill="#000" />
        <circle cx="8" cy="8" r="6" fill="#fff" />
        <circle cx="11" cy="6" r="5" fill="#000" />
      </mask>
      <circle cx="8" cy="8" r="6" fill={colour} mask="url(#icq-crescent)" />
    </g>
  );
}

function Clock({ colour }) {
  return (
    <g>
      <circle cx="8" cy="8" r="6" fill={colour} />
      <circle cx="8" cy="8" r="6" fill="none" stroke="#00000055" strokeWidth="1" />
      <path d="M8 4.5V8l2.5 2" stroke="#fff" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </g>
  );
}

function Busy({ colour, bar }) {
  return (
    <g>
      <circle cx="8" cy="8" r="6" fill={colour} />
      <rect x="4.5" y="7" width="7" height="2" fill="#fff" rx="0" />
      {bar && <rect x="4.5" y="7" width="7" height="2" fill="#fff" />}
    </g>
  );
}

function Ghost({ colour }) {
  // Outline only: present, but not showing.
  return <circle cx="8" cy="8" r="5.5" fill="none" stroke={colour} strokeWidth="1.5" strokeDasharray="2 1.5" />;
}

function Dot({ colour }) {
  return <circle cx="8" cy="8" r="5.5" fill={colour} />;
}

/**
 * @param {object} props
 * @param {string} props.status  one of the eight ICQ Statuses
 * @param {number} [props.size]  defaults to the authentic 16px
 * @param {string} [props.title] accessible label; defaults to the Status name
 */
export default function StatusIcon({ status = 'offline', size = 16, title, className }) {
  const colour = PALETTE[status] || PALETTE.offline;

  let shape;
  switch (status) {
    case 'online':
      shape = <Flower colour={colour} />;
      break;
    case 'chat':
      // Free For Chat: the flower, plus the little speech mark that said
      // "actually come and talk to me".
      shape = (
        <>
          <Flower colour={colour} />
          <path d="M10 10h5v3.5h-1.5L12 15v-1.5h-2z" fill="#fff" stroke="#2861D4" strokeWidth="0.8" />
        </>
      );
      break;
    case 'away':
      shape = <Crescent colour={colour} />;
      break;
    case 'na':
      shape = <Clock colour={colour} />;
      break;
    case 'occupied':
      shape = <Busy colour={colour} />;
      break;
    case 'dnd':
      shape = <Busy colour={colour} bar />;
      break;
    case 'invisible':
      shape = <Ghost colour={colour} />;
      break;
    case 'offline':
    default:
      shape = <Flower colour={colour} dim />;
      break;
  }

  return (
    <svg
      className={className ? `icq-status-icon ${className}` : 'icq-status-icon'}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      // Rendered at 16px where a half pixel is visible; keep the edges hard.
      shapeRendering={size <= 16 ? 'crispEdges' : 'auto'}
      role="img"
      aria-label={title || status}
    >
      <title>{title || status}</title>
      {shape}
    </svg>
  );
}

export { PALETTE as STATUS_COLOURS, FLOWER };
