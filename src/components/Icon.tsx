import type { SVGProps } from 'react';

const paths: Record<string, string> = {
  back: 'M15 18l-6-6 6-6',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3',
  select: 'M5 3l14 8-6 2-3 6z',
  pan: 'M8 13V5.5a1.5 1.5 0 013 0V12m0-1V4.5a1.5 1.5 0 013 0V12m0-6.5a1.5 1.5 0 013 0V13m-9 0V9.5a1.5 1.5 0 00-3 0V14a7 7 0 007 7h1a7 7 0 007-7v-3.5a1.5 1.5 0 00-3 0',
  pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z',
  stamp: 'M9 3h6v5l-1 3h4a2 2 0 012 2v3H4v-3a2 2 0 012-2h4L9 8zM4 20h16',
  magnet: 'M6 3v8a6 6 0 0012 0V3h-4v8a2 2 0 01-4 0V3zM6 7h4M14 7h4',
  alignLeft: 'M4 3v18M8 7h12M8 17h7',
  alignRight: 'M20 3v18M4 7h12M9 17h7',
  alignTop: 'M3 4h18M7 8v12M17 8v7',
  alignBottom: 'M3 20h18M7 4v12M17 9v7',
  alignCenterX: 'M12 3v18M6 7h12M8 17h8',
  alignCenterY: 'M3 12h18M7 6v12M17 8v8',
  distributeX: 'M3 3v18M21 3v18M9 8h6v8H9z',
  distributeY: 'M3 3h18M3 21h18M8 9h8v6H8z',
  eraser: 'M20 20H8l-5-5 10-10 8 8-7 7M6.5 11.5l6 6',
  text: 'M4 7V4h16v3M9 20h6M12 4v16',
  zoomIn: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35M11 8v6M8 11h6',
  zoomOut: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35M8 11h6',
  fit: 'M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4M8 9h8v6H8z',
  fullscreen: 'M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3',
  fullscreenExit: 'M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3',
  download: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12',
  play: 'M6 4l14 8-14 8z',
  pause: 'M7 4h3v16H7zM14 4h3v16h-3z',
  edit: 'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4z',
  trash: 'M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M10 11v6M14 11v6',
  copy: 'M20 9h-9a2 2 0 00-2 2v9a2 2 0 002 2h9a2 2 0 002-2v-9a2 2 0 00-2-2zM5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1',
  clipboard: 'M9 2h6v4H9zM15 4h2a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6a2 2 0 012-2h2',
  paste: 'M9 2h6v4H9zM15 4h2a2 2 0 012 2v4M9 4H7a2 2 0 00-2 2v14a2 2 0 002 2h4M13 12h8v10h-8z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 018 0v4',
  unlock: 'M5 11h14v10H5zM8 11V7a4 4 0 017.9-1',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  eyeOff: 'M17.9 17.9A10 10 0 0112 20c-7 0-11-8-11-8a18 18 0 015.1-5.9M9.9 4.2A9 9 0 0112 4c7 0 11 8 11 8a18 18 0 01-2.2 3.2M1 1l22 22',
  grid: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
  shuffle: 'M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
  dice: 'M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zM8.5 8.5h.01M15.5 15.5h.01M12 12h.01',
  card: 'M6 2h12a2 2 0 012 2v16a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2z',
  sort: 'M3 6h11M3 12h8M3 18h5M17 6v12M13.5 14.5L17 18l3.5-3.5',
  deck: 'M8 2h11a2 2 0 012 2v13M5 5h11a2 2 0 012 2v13a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z',
  board: 'M3 3h18v18H3zM3 12h18M12 3v18',
  token: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 15a3 3 0 100-6 3 3 0 000 6z',
  pawn: 'M12 2.5a3 3 0 012 5.2l-.5.8H15v2h-1.5c0 3 1.5 5 3.5 6.5v2.5H7V17c2-1.5 3.5-3.5 3.5-6.5H9v-2h1.5l-.5-.8a3 3 0 012-5.2z',
  meeple:
    'M12 3a2.5 2.5 0 012.5 2.5c0 .9-.4 1.5-1 2 2.5.3 6.5 1 6.5 2.5 0 1.2-1.5 1.5-4 1.2.3 2.5 1.5 5 3 7.8H15l-3-3.5L9 21H5c1.5-2.8 2.7-5.3 3-7.8-2.5.3-4 0-4-1.2 0-1.5 4-2.2 6.5-2.5-.6-.5-1-1.1-1-2A2.5 2.5 0 0112 3z',
  timer: 'M12 22a8 8 0 100-16 8 8 0 000 16zM12 10v4l2.5 2M9 2h6M12 2v4',
  counter: 'M4 5h16v14H4zM8 12h3M9.5 10.5v3M14 12h2',
  holder: 'M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2',
  label: 'M4 7V4h16v3M9 20h6M12 4v16',
  button: 'M4 8h16a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4a2 2 0 012-2zM7 12h6',
  bolt: 'M13 2L3 14h9l-1 8 10-12h-9z',
  pin: 'M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z',
  checkbox: 'M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zM8 12l3 3 5-6',
  shapes: 'M3 3h7v7H3zM17.5 3.5a3.5 3.5 0 110 7 3.5 3.5 0 010-7zM6.5 14l4 7h-8zM14 14h7v7h-7z',
  bag: 'M9 3h6l-1.5 4h-3zM10.5 7C6 9 4 13 4 16.5A4.5 4.5 0 008.5 21h7a4.5 4.5 0 004.5-4.5C20 13 18 9 13.5 7M9.5 7.8h5',
  image: 'M3 3h18v18H3zM8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM21 15l-5-5L5 21',
  reset: 'M1 4v6h6M3.5 15a9 9 0 102.1-9.4L1 10',
  rotate: 'M23 4v6h-6M20.5 15a9 9 0 11-2.1-9.4L23 10',
  flip: 'M12 3v18M16 7l4 5-4 5M8 7l-4 5 4 5',
  save: 'M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2zM17 21v-8H7v8M7 3v5h8',
  draw: 'M12 5v14M19 12l-7 7-7-7',
  check: 'M20 6L9 17l-5-5',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  front: 'M12 19V5M5 12l7-7 7 7',
  backward: 'M12 5v14M19 12l-7 7-7-7',
  library: 'M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 006.5 22H20V2H6.5A2.5 2.5 0 004 4.5z',
  help: 'M12 22a10 10 0 100-20 10 10 0 000 20zM9.1 9a3 3 0 015.8 1c0 2-3 3-3 3M12 17h.01',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  menu: 'M4 6h16M4 12h16M4 18h16',
  chevronLeft: 'M15 18l-6-6 6-6',
  chevronRight: 'M9 18l6-6-6-6',
  home: 'M3 10.5L12 3l9 7.5M5 9v11a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V9',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  tiles: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  chevronUp: 'M18 15l-6-6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  close: 'M18 6L6 18M6 6l12 12',
  tools: 'M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.8-3.8a6 6 0 01-7.9 7.9l-6.9 6.9a2.1 2.1 0 01-3-3l6.9-6.9a6 6 0 017.9-7.9z',
  cardZoom: 'M3 4a2 2 0 012-2h8a2 2 0 012 2v5M3 4v14a2 2 0 002 2h5M17 21a4 4 0 100-8 4 4 0 000 8zM22 22l-2.2-2.2',
  move: 'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20',
  moveOff: 'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h7M15 12h7M12 2v7M12 15v7M4 4l16 16',
  swap: 'M7 4L3 8l4 4M3 8h14M17 12l4 4-4 4M21 16H7',
  palette:
    'M12 22a10 10 0 110-20c5.5 0 10 4 10 9a5 5 0 01-5 5h-1.5a1.5 1.5 0 00-1 2.6A1.5 1.5 0 0112 22zM7.5 11.5h.01M10.5 7.5h.01M15.5 7.5h.01',
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={paths[name]} />
    </svg>
  );
}
