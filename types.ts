export interface DigestItem {
  title: string;
  summary_en: string;
  summary_cn: string;
  source_url: string;
  source_name: string;
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