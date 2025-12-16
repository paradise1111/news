
export interface DigestItem {
  title: string;
  summary_en: string;
  summary_cn: string;
  source_url: string;
  source_name: string;
  ai_score: number; // 0-100 Score based on Novelty, Fun, Virality, Heat
  ai_score_reason: string; // Brief explanation for the score
  xiaohongshu_advice?: string; // Specific content creation angle/title for Red Note
  tags: string[];   // e.g. ["🔥 Viral", "🧠 Deep"]
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
