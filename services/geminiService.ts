
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
    if (!text) throw new Error("AI 响应内容完全为空。");

    try { return JSON.parse(text); } catch (e) {}

    let cleaned = text
        .replace(/^[\s\S]*?```json/g, '')
        .replace(/```[\s\S]*?$/g, '')
        .trim();
    
    try { return JSON.parse(cleaned); } catch (e) {}

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    
    if (start !== -1 && end !== -1 && end > start) {
        const potentialJson = text.substring(start, end + 1);
        try { return JSON.parse(potentialJson); } catch (e) {
            const sanitized = potentialJson.replace(/,\s*([\]}])/g, '$1').replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
            try { return JSON.parse(sanitized); } catch (e2) {}
        }
    }
    throw new Error(`JSON 解析失败。原始内容: ${text.substring(0, 100)}...`);
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

  const isPost = method.toUpperCase() === 'POST';
  // 关键：移除 safetySettings 以兼容 OpenAI 格式中转
  const finalBody = isPost ? body : undefined;

  const response = await fetch('/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetUrl,
      method,
      headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
      },
      body: finalBody 
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({ error: response.statusText }));
    // 优先抛出上游的详细错误
    const msg = errData.error?.message || errData.error || `HTTP ${response.status}`;
    throw new Error(msg);
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

              if (trimmed.startsWith('event: error')) {
                  hasError = true;
              } else if (trimmed.startsWith('data: ')) {
                  const dataStr = trimmed.substring(6);
                  if (dataStr === '[DONE]') continue;
                  
                  try {
                      const parsed = JSON.parse(dataStr);
                      if (hasError) {
                          lastErrorMessage = parsed.error?.message || parsed.error || lastErrorMessage;
                      } else {
                          const content = parsed.choices?.[0]?.delta?.content 
                                       || parsed.choices?.[0]?.delta?.text
                                       || parsed.choices?.[0]?.text 
                                       || "";
                          fullContent += content;
                      }
                  } catch (e) {
                      if (!hasError && !dataStr.startsWith('{')) fullContent += dataStr;
                  }
              }
          }
      }

      if (hasError) throw new Error(lastErrorMessage || "流式传输中断");
      if (!fullContent) throw new Error("模型返回内容为空。");
      return fullContent;
  } 
  
  const result = await response.json();
  return result.choices?.[0]?.message?.content || result;
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
  onLog(`[第一步] 正在请求模型发现资讯链接...`);
  
  // 优化 Prompt：减少激进词汇，强调 JSON 格式
  const discoveryPrompt = `
    Role: News Editor. Date: ${todayStr}.
    Task: Search for 10 global news and 10 health updates.
    Requirements:
    1. Provide REAL deep-links (not homepage).
    2. Format as JSON ONLY: {"candidates": [{"title": "News Title", "url": "https://...", "category": "social"}]}
  `;

  const discoveryRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', {
    model: config.model,
    messages: [{ role: "user", content: discoveryPrompt }],
    stream: true,
    max_tokens: 2000,
    temperature: 0.3
  });

  const discoveryData = extractJson(discoveryRaw);
  const candidates = (discoveryData.candidates || []) as { title: string, url: string, category: string }[];
  if (candidates.length === 0) throw new Error("未找到有效资讯列表。");

  onLog(`[检查点] 正在验证 ${candidates.length} 条链接...`);
  const validatedItems: { title: string, url: string, category: string }[] = [];
  const results = await Promise.all(candidates.map(async (item) => {
      const ok = await validateUrl(item.url);
      return ok ? item : null;
  }));
  results.forEach(r => { if(r) validatedItems.push(r); });

  if (validatedItems.length === 0) throw new Error("AI 提供的链接均为无效或无法访问。");
  onLog(`成功验证 ${validatedItems.length} 条有效链接。`);

  onLog(`[第二步] 正在生成日报精编...`);
  const elaborationPrompt = `
    Analyze these links and create a report with summary_cn (150 chars), summary_en, ai_score, and xhs_titles.
    Links: ${validatedItems.map(v => v.url).join(', ')}
    Format: JSON.
  `;

  const elaborationRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', {
    model: config.model,
    messages: [{ role: "user", content: elaborationPrompt }],
    stream: true,
    max_tokens: 4000,
    temperature: 0.6
  });

  return extractJson(elaborationRaw) as DigestData;
};
