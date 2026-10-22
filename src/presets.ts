import type { ModelBinding, ModelPreset } from './types.js';

// Small preset facts shared by the builder and the lazily loaded 3D module, so the admin bundle does not pull in the mesh generators.

/** Default product sizes in millimeters (garments: chest width, body length, depth; mug: diameter, height). */
export const DEFAULT_PRESET_SIZE: Readonly<Record<ModelPreset, { width: number; height: number; depth: number }>> = {
  tshirt: { width: 520, height: 700, depth: 230 },
  hoodie: { width: 560, height: 690, depth: 250 },
  sweater: { width: 540, height: 670, depth: 240 },
  cap: { width: 200, height: 110, depth: 210 },
  mug: { width: 82, height: 95, depth: 82 },
  cushion: { width: 450, height: 450, depth: 170 },
  box: { width: 140, height: 90, depth: 60 },
  card: { width: 70, height: 100, depth: 1.2 },
};

/** Default looseness of a preset in the 3D pull tool: fabrics are soft, solid objects such as mugs are rigid (0). */
export const PRESET_SOFTNESS: Readonly<Record<ModelPreset, number>> = { tshirt: .7, hoodie: .55, sweater: .6, cushion: .75, cap: .25, mug: 0, box: 0, card: 0 };

/** A sensible first placement for a print surface on a preset part. */
export function defaultModelBinding(preset: ModelPreset, surfaceId: string, part: string): ModelBinding {
  if (preset === 'mug') return { surfaceId, part, x: .75, y: .5 };
  if (part.endsWith('sleeve')) return { surfaceId, part, x: .5, y: .3 };
  const chest: Partial<Record<ModelPreset, number>> = { tshirt: .33, hoodie: .38, sweater: .34, cap: .5 };
  return { surfaceId, part, x: .5, y: chest[preset] ?? .5 };
}
