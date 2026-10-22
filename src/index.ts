export type * from './types.js';
export * from './core.js';
export { ingestImage, downloadBlob } from './assets.js';
export { Renderer, mapPointToSurface, mapPointToProduct } from './render.js';
// Admin/customer remain separate entry points: importing the core does not load either interface.
