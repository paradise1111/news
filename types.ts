
export interface DigestItem {
  title: string;
  summary_en: string;
  summary_cn: string; // Longer, detailed summary
  source_url: string;
  source_name: string;
  ai_score: number; // 0-100
  ai_score_reason: string; // IN CHINESE
  xhs_titles?: string[]; // Array of 3 viral titles for Red Note
  tags: string[];
}

export interface DigestData {
  social: DigestItem[];
  health: DigestItem[];
}

export interface AppConfig {
  apiKey: string;
  baseUrl: string; // Optional custom base URL
  model: string;
}

export enum AppStatus {
  CONFIG = 'CONFIG',
  READY = 'READY',
  PROCESSING = 'PROCESSING',
  COMPLETE = 'COMPLETE',
  ERROR = 'ERROR'
}

export interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

export interface ModelOption {
  id: string;
  name: string;
  status?: 'unknown' | 'testing' | 'available' | 'unavailable'; // For UI testing
  latency?: number;
}
