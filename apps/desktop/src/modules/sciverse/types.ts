export type SciverseSettingsState = {
  enabled: boolean;
  base_url: string;
  has_api_token: boolean;
  token_source: 'credential_store' | 'environment' | null;
};

export type SciverseConnectionStatus = {
  ok: boolean;
  base_url: string;
  field_count: number;
};

export type SciverseAgenticSearchRequest = {
  query: string;
  top_k?: number;
  sub_queries?: number;
  filters?: Record<string, unknown>;
};

export type SciverseAgenticSearchHit = {
  chunk_id?: string | null;
  chunk: string;
  doc_id: string;
  title: string;
  abstract?: string | null;
  score?: number | null;
  source_type?: string | null;
  offset?: number | null;
  page_no?: number | null;
  lang?: string | null;
  metadata_type?: string | null;
  author?: string[];
  publication_venue_name_unified?: string | null;
  publication_venue_type?: string | null;
  publication_published_date?: string | null;
  publication_published_year?: number | null;
  citation_count?: number | null;
  influential_citation_count?: number | null;
  primary_topic?: string | null;
  primary_topic_domain?: string | null;
  doi?: string | null;
  access_is_oa?: boolean | null;
  access_oa_url?: string | null;
  access_license?: string | null;
  file_name?: string | null;
};

export type SciversePaperImportRequest = {
  doc_id: string;
  title: string;
  doi?: string | null;
  access_oa_url?: string | null;
  resource_file_name?: string | null;
};

export type SciversePaperImportPreparation = {
  title: string;
  doc_id: string;
  doi?: string | null;
  authors: string[];
  abstract?: string | null;
  publication_year?: number | null;
  venue?: string | null;
  access_oa_url?: string | null;
  access_license?: string | null;
  pdf_path?: string | null;
  degradation_reason?: string | null;
  resource_attempts: string[];
};

export type SciverseAgenticSearchResponse = {
  hits: SciverseAgenticSearchHit[];
};

export type SciverseContentRequest = {
  doc_id: string;
  offset?: number;
  limit?: number;
};

export type SciverseContentResponse = {
  text: string;
  chars_returned: number;
  next_offset: number;
  more: boolean;
};

export type SciverseJsonResponse = Record<string, unknown>;

export type SciverseCatalogField = {
  name: string;
  label: string;
  type?: string;
  description?: string;
  enum_values?: string[];
};

export type SciversePaperMetadata = {
  unique_id?: string;
  doc_id?: string;
  title?: string;
  abstract?: string;
  author?: string[] | Array<{ name?: string }>;
  doi?: string;
  publication_published_year?: number | string;
  publication_venue_name_unified?: string;
  citation_count?: number;
  access_oa_url?: string;
  access_license?: string;
  file_name?: string;
  [key: string]: unknown;
};
