/** Inline stroke icons drawn on a 24 × 24 grid. No icon font or external sprite is loaded. */
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;

const paths = {
  pointer: 'M5.5 3.5 18.5 10l-5.6 1.9-2 5.6z',
  hand: 'M7 11.5V6.8a1.5 1.5 0 0 1 3 0v4.2M10 10.5V5a1.5 1.5 0 0 1 3 0v5.5M13 10.5V6.5a1.5 1.5 0 0 1 3 0v5M16 10a1.5 1.5 0 0 1 3 0v4a7 7 0 0 1-7 7h-.8a6 6 0 0 1-4.7-2.3l-3-3.9a1.6 1.6 0 0 1 2.4-2.1L7 14',
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  zoomIn: `${circle(11, 11, 7)}M20 20l-3.9-3.9M11 8v6M8 11h6`,
  zoomOut: `${circle(11, 11, 7)}M20 20l-3.9-3.9M8 11h6`,
  fit: 'M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15',
  shrink: 'M4 14h6v6M20 10h-6V4M14 10l6.5-6.5M3.5 20.5 10 14',
  upload: 'M12 15V4M7.5 8.5 12 4l4.5 4.5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3',
  image: `M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z${circle(9, 9.5, 1.7)}M21 15.5l-4.6-4.6L7 20`,
  layers: 'm12 3 9 5-9 5-9-5zM3 13l9 5 9-5',
  trash: 'M4 7h16M9.5 7V4.5h5V7M6 7l1 13h10l1-13M10 11v5.5M14 11v5.5',
  replace: 'M19.5 10A8 8 0 0 0 5 7.5L4 8.7M4 4v4.7h4.7M4.5 14a8 8 0 0 0 14.5 2.5l1-1.2M20 20v-4.7h-4.7',
  center: `M5 5h14v14H5z${circle(12, 12, 2.2)}M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5`,
  alignLeft: 'M4 3v18M8 6.5h11v4H8zM8 13.5h7v4H8z',
  alignHCenter: 'M12 3v18M6 6.5h12v4H6zM8 13.5h8v4H8z',
  alignRight: 'M20 3v18M5 6.5h11v4H5zM9 13.5h7v4H9z',
  alignTop: 'M3 4h18M6.5 8v11h4V8zM13.5 8v7h4V8z',
  alignVCenter: 'M3 12h18M6.5 6h4v12h-4zM13.5 8h4v8h-4z',
  alignBottom: 'M3 20h18M6.5 5v11h4V5zM13.5 9v7h4V9z',
  rotateCw: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
  rotateCcw: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v5h5',
  eye: `M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z${circle(12, 12, 3)}`,
  eyeOff: 'M10.6 5.6c.5-.1.9-.1 1.4-.1 6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.3 3.1M6.6 6.6A16 16 0 0 0 2.5 12s3.5 6.5 9.5 6.5c1.9 0 3.6-.6 5-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  checkCircle: `${circle(12, 12, 9)}M8 12.3l2.8 2.7 5.4-5.5`,
  download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  chevronLeft: 'm15 6-6 6 6 6',
  chevronRight: 'm9 6 6 6-6 6',
  chevronDown: 'm6 9 6 6 6-6',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  duplicate: 'M10 8h9a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 20h-9a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 10 8zM15.5 8V5.5A1.5 1.5 0 0 0 14 4H5a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 5 16h3.5',
  keyboard: 'M4.5 6h15A2 2 0 0 1 21.5 8v8a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9',
  sun: `${circle(12, 12, 4)}M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4`,
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  info: `${circle(12, 12, 9)}M12 11v5.5M12 7.6h.01`,
  warning: 'M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0zM12 9.5v4M12 17h.01',
  lock: 'M6.5 11h11a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5v-6A1.5 1.5 0 0 1 6.5 11zM8 11V8a4 4 0 0 1 8 0v3',
  move: 'M12 3v18M3 12h18M9 5.5l3-3 3 3M9 18.5l3 3 3-3M5.5 9l-3 3 3 3M18.5 9l3 3-3 3',
  resize: 'M15 3.5h5.5V9M9 20.5H3.5V15M20.5 3.5 14 10M3.5 20.5 10 14',
  shirt: 'M8.5 3.5 4 5.8 2.5 10.5l3.6 1.2V20.5h11.8v-8.8l3.6-1.2L20 5.8l-4.5-2.3a3.6 3.6 0 0 1-7 0z',
  crop: 'M6 2.5V16a2 2 0 0 0 2 2h13.5M18 21.5V8a2 2 0 0 0-2-2H2.5',
  unlink: 'M9 15l-1.6 1.6a3.5 3.5 0 0 1-5-5L4 10M15 9l1.6-1.6a3.5 3.5 0 0 1 5 5L20 14M8 2.5v3M2.5 8h3M16 21.5v-3M21.5 16h-3',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  sliders: `M4 6h9M17.5 6H20M4 12h3M11.5 12H20M4 18h11M19.5 18H20${circle(15.3, 6, 2.2)}${circle(9.3, 12, 2.2)}${circle(17.3, 18, 2.2)}`,
  checklist: 'M10 6.5h10M10 12h10M10 17.5h10M3.5 6.5l1.3 1.3 2.4-2.6M3.5 12l1.3 1.3 2.4-2.6M3.5 17.5l1.3 1.3 2.4-2.6',
  send: 'M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z',
  play: 'M7.5 4.8v14.4a.8.8 0 0 0 1.2.7l11.3-7.2a.8.8 0 0 0 0-1.4L8.7 4.1a.8.8 0 0 0-1.2.7z',
  rectangle: 'M4 6.5h16v11H4z',
  ellipse: 'M3 12a9 6.5 0 1 0 18 0a9 6.5 0 1 0-18 0',
  diamond: 'm12 3 9 9-9 9-9-9z',
  polygon: 'M12 3l8.5 6.2-3.3 10.3H6.8L3.5 9.2z',
  help: `${circle(12, 12, 9)}M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.6M12 16.8h.01`,
  more: `${circle(5.5, 12, 1)}${circle(12, 12, 1)}${circle(18.5, 12, 1)}`,
  panel: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 4v16',
  grid: 'M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z',
  cube: 'm12 2.8 8 4.6v9.2l-8 4.6-8-4.6V7.4zM4 7.4l8 4.6 8-4.6M12 12v9.2',
  orbit: `M20.5 12c0 1.9-3.8 3.5-8.5 3.5S3.5 13.9 3.5 12 7.3 8.5 12 8.5c2 0 3.8.3 5.2.8M15.6 6.8l2 2.4-2.9 1M12 3.5v17`,
  camera: `M8.5 6.5 10 4.5h4l1.5 2H19a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 18.5H5A1.5 1.5 0 0 1 3.5 17V8A1.5 1.5 0 0 1 5 6.5z${circle(12, 12.3, 3.4)}`,
  globe: `${circle(12, 12, 9)}M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9S14.4 18.5 12 21c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3z`,
} as const;

export type IconName = keyof typeof paths;

const SVG = 'http://www.w3.org/2000/svg';

export function icon(name: IconName, size = 18, className = 'mdt-icon'): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', className);
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', paths[name]);
  svg.append(path);
  return svg;
}
