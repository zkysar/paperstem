import { model12 } from './model12.js';
import type { DeviceImporter } from './types.js';

export const importers: Record<string, DeviceImporter> = {
  [model12.id]: model12,
};

export function resolveImporter(id: string): DeviceImporter | undefined {
  return importers[id];
}

export function availableImporterIds(): string[] {
  return Object.keys(importers);
}
