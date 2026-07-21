import { invoke } from '@tauri-apps/api/core';

import type {
  SciverseAgenticSearchRequest,
  SciverseAgenticSearchResponse,
  SciverseConnectionStatus,
  SciverseContentRequest,
  SciverseContentResponse,
  SciverseJsonResponse,
  SciversePaperImportPreparation,
  SciversePaperImportRequest,
  SciverseSettingsState
} from '../types';

export function getSciverseSettings() {
  return invoke<SciverseSettingsState>('get_sciverse_settings');
}

export function revealSciverseApiToken() {
  return invoke<string>('reveal_sciverse_api_token');
}

export function saveSciverseSettings(request: {
  enabled: boolean;
  baseUrl?: string;
  apiToken?: string;
  clearApiToken?: boolean;
}) {
  return invoke<SciverseSettingsState>('save_sciverse_settings', {
    request: {
      enabled: request.enabled,
      base_url: request.baseUrl ?? null,
      api_token: request.apiToken || null,
      clear_api_token: request.clearApiToken ?? false
    }
  });
}

export function testSciverseConnection() {
  return invoke<SciverseConnectionStatus>('test_sciverse_connection');
}

export function searchSciverse(request: SciverseAgenticSearchRequest) {
  return invoke<SciverseAgenticSearchResponse>('sciverse_agentic_search', {
    request: {
      query: request.query,
      top_k: request.top_k ?? 10,
      sub_queries: request.sub_queries ?? null,
      filters: request.filters ?? null
    }
  });
}

export function readSciverseContent(request: SciverseContentRequest) {
  return invoke<SciverseContentResponse>('sciverse_read_content', { request });
}

export function getSciverseMetaCatalog() {
  return invoke<SciverseJsonResponse>('sciverse_meta_catalog');
}

export function searchSciverseMetadata(payload: SciverseJsonResponse) {
  return invoke<SciverseJsonResponse>('sciverse_meta_search', { request: { payload } });
}

export function getSciversePaperRelations(payload: SciverseJsonResponse) {
  return invoke<SciverseJsonResponse>('sciverse_meta_paper_relations', { request: { payload } });
}

export function getSciversePaperSchema() {
  return invoke<SciverseJsonResponse>('sciverse_paper_schema');
}

export function searchSciversePaperSchema(payload: SciverseJsonResponse) {
  return invoke<SciverseJsonResponse>('sciverse_paper_schema_search', { request: { payload } });
}

export function prepareSciversePaperImport(request: SciversePaperImportRequest) {
  return invoke<SciversePaperImportPreparation>('prepare_sciverse_paper_import', {
    request: {
      doc_id: request.doc_id,
      title: request.title,
      doi: request.doi ?? null,
      access_oa_url: request.access_oa_url ?? null,
      resource_file_name: request.resource_file_name ?? null
    }
  });
}
