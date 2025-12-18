
import { AppConfig, DigestData, ModelOption, DigestItem } from "../types";
import { DEFAULT_MODELS } from "../constants";

const normalizeBaseUrl = (url: string): string => {
  let clean = url.trim().replace(/\/+$/, '');
  if (!clean) return '';
  if (!clean.includes('/v1') && !clean.match(/googleapis\.com/)) {
    clean += '/v1';
  }
  return clean;
};

const extractJson = (str: string): any => {
    if (typeof str !== 'string') return str;
    const text = str.trim();
    if (!text) throw new Error("AI 响应为空。");

    try { return JSON.parse(text); } catch (e) {}

    // 处理带 Markdown 代码块的情况
    let cleaned = text
        .replace(/^[\s\S]*?```json/g, '')
        .replace(/```[\s\S]*?$/g, '')
        .trim();
    
    try { return JSON.parse(cleaned); } catch (e) {}

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    
    if (start !== -1 && end !== -1 && end > start) {
        const potentialJson = text.substring(start, end + 1);
        try { return JSON.parse(potentialJson); } catch (e) {}
    }
    throw new Error(`JSON 解析失败: ${text.substring(0, 50)}...`);
};

const validateUrl = async (url: string): Promise<boolean> => {
    if (!url || !url.startsWith('http')) return false;
    try {
        const response = await fetch('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetUrl: url,
                method: 'GET',
                headers: { 'User-Agent': 'Mozilla/5.0' }
            }),
        });
        return response.ok;
    } catch { return false; }
};

const openAIFetch = async (
  baseUrl: string,
  apiKey: string,
  endpoint: string,
  body?: any,
  method: string = 'POST'
) => {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const targetUrl = endpoint.startsWith('http') ? endpoint : `${normalizedBase}${endpoint}`;

  const response = await fetch('/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetUrl,
      method: method.toUpperCase(),
      headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
      },
      body: body
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(errData.error?.message || errData.error || `HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  
  if (contentType.includes('text/event-stream')) {
      const reader = response.body?.getReader();
      if (!reader) throw new Error("无法读取流数据");
      const decoder = new TextDecoder();
      let fullContent = '';
      let hasError = false;
      let lastErrorMessage = '';

      while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith(':')) continue;
              if (trimmed.startsWith('event: error')) { hasError = true; continue; }
              if (trimmed.startsWith('data: ')) {
                  const dataStr = trimmed.substring(6);
                  if (dataStr === '[DONE]') continue;
                  try {
                      const parsed = JSON.parse(dataStr);
                      if (hasError) {
                          lastErrorMessage = parsed.error?.message || parsed.error || lastErrorMessage;
                      } else {
                          const content = parsed.choices?.[0]?.delta?.content || "";
                          fullContent += content;
                      }
                  } catch (e) {}
              }
          }
      }
      if (hasError) throw new Error(lastErrorMessage || "流式传输中断");
      return fullContent;
  } 
  
  const result = await response.json();
  // 兼容直接返回 content 或包裹在 choices 里的情况
  return result.choices?.[0]?.message?.content || result.content || JSON.stringify(result);
};

export const checkModelAvailability = async (apiKey: string, baseUrl: string, modelId: string) => {
  const start = Date.now();
  try {
    await openAIFetch(baseUrl, apiKey, '/chat/completions', {
      model: modelId,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 5,
      stream: false
    });
    return { available: true, latency: Date.now() - start };
  } catch (error: any) {
    return { available: false, error: error.message };
  }
};

export const verifyAndFetchModels = async (apiKey: string, baseUrl: string): Promise<ModelOption[]> => {
  try {
    const data = await openAIFetch(baseUrl, apiKey, '/models', undefined, 'GET');
    if (data && Array.isArray(data.data)) {
        return data.data.map((m: any) => ({ id: m.id, name: m.id, status: 'unknown' }));
    }
    return [];
  } catch (err: any) {
    throw err;
  }
};

export const generateDailyDigest = async (config: AppConfig, onLog: (msg: string) => void): Promise<DigestData> => {
  const todayStr = new Date().toISOString().split('T')[0];
  onLog(`[第一步] 正在获取资讯链接 (非流式)...`);
  
  const discoveryPrompt = `You are a news curator. Date: ${todayStr}. Task: Provide 10 news and 10 health links. 
  Output format: {"candidates": [{"title": "Title", "url": "URL", "category": "social"}]}`;

  const discoveryRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', {
    model: config.model,
    messages: [{ role: "user", content: discoveryPrompt }],
    stream: false, // 改为非流式更稳定
    response_format: { type: "json_object" }, // 强制 JSON
    max_tokens: 2000,
    temperature: 0.1
  });

  const discoveryData = extractJson(discoveryRaw);
  const candidates = (discoveryData.candidates || []) as { title: string, url: string, category: string }[];
  if (candidates.length === 0) throw new Error("未获得资讯链接列表。");

  onLog(`正在验证 ${candidates.length} 条链接的可访问性...`);
  const validatedItems: { title: string, url: string, category: string }[] = [];
  const results = await Promise.all(candidates.map(async (item) => {
      const ok = await validateUrl(item.url);
      return ok ? item : null;
  }));
  results.forEach(r => { if(r) validatedItems.push(r); });

  if (validatedItems.length === 0) throw new Error("AI 生成的链接均无法访问。");
  onLog(`验证成功: ${validatedItems.length} 条链接。`);

  onLog(`[第二步] 正在分析内容并编写日报 (流式)...`);
  const elaborationPrompt = `Create a digest in JSON format with social and health arrays. For each: {title, summary_cn(150 chars), summary_en, ai_score, ai_score_reason, xhs_titles}. Links: ${validatedItems.map(v => v.url).join(', ')}`;

  const elaborationRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', {
    model: config.model,
    messages: [{ role: "user", content: elaborationPrompt }],
    stream: true,
    response_format: { type: "json_object" },
    max_tokens: 6000,
    temperature: 0.5
  });

  return extractJson(elaborationRaw) as DigestData;
};
