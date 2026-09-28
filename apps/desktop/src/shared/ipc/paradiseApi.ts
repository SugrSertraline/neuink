import { invoke } from '@tauri-apps/api/core';
import type { World } from '@/shared/types/paradise';
export type ParadiseSave = { revision: number; world: World };
export const readParadise = (root: string) => invoke<ParadiseSave | null>('read_paradise', { request: { root } });
export const saveParadise = (root: string, expectedRevision: number, world: World) =>
  invoke<ParadiseSave>('save_paradise', { request: { root, expected_revision: expectedRevision, world } });
