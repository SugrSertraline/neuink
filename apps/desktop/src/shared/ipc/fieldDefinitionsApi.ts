import { invoke } from '@tauri-apps/api/core';

export type FieldKind = 'text' | 'number' | 'date' | 'select' | 'multi_select' | 'boolean';
export type DatePrecision = 'year' | 'month' | 'day';
export type FieldDefinition = { name: string; kind: FieldKind; options: string[]; hidden: boolean; date_precision?: DatePrecision };
export const readFieldDefinitions = (root: string) => invoke<FieldDefinition[]>('field_definitions', { request: { root, action: 'read' } });
export const saveFieldDefinitions = (root: string, expected: FieldDefinition[], definitions: FieldDefinition[], rename?: [string, string]) =>
  invoke<FieldDefinition[]>('field_definitions', { request: { root, action: 'save', expected, definitions, rename } });

export const updateEntryField = (root: string, entryId: string, definition: FieldDefinition, expected: string | null, value: string | null) =>
  invoke('update_entry_field', { request: { root, entry_id: entryId, definition, expected, value } });
