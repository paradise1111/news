
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

/**
 * 强化版 JSON 提取器
 */
const extractJson = (str: any): any => {
    if (typeof str !== 'string') return str;
    const text = str.trim();
    if (!text) throw new Error("AI 响应内容为空。");

    try { return JSON.parse(text); } catch (e) {}

    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
        try { return JSON.parse(jsonMatch[1].trim()); } catch (e) {}
    }

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
        const potentialJson = text.substring(start, end + 1);
        try { return JSON.parse(potentialJson); } catch (e) {
            const sanitized = potentialJson
                .replace(/,\s*([\]}])/g, '$1')
                .replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
            try { return JSON.parse(sanitized); } catch (e2) {}
        }
    }
    
    throw new Error(`JSON 解析失败。请尝试换一个模型（如 Flash 版本）。`);
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

/**
 * 通用请求方法：返回解析后的 JSON 对象或流式字符串
 */
const openAIFetch = async (
  baseUrl: string,
  apiKey: string,
  endpoint: string,
  body?: any,
  method: string = 'POST'
) => {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  // 确保 endpoint 不带重复斜杠
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const targetUrl = `${normalizedBase}${cleanEndpoint}`;

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
  
  // 非流式请求：直接返回 JSON 对象
  return await response.json();
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
    const res = await openAIFetch(baseUrl, apiKey, '/models', undefined, 'GET');
    // 标准 OpenAI 响应在 data 字段中
    if (res && Array.isArray(res.data)) {
        return res.data.map((m: any) => ({ id: m.id, name: m.id, status: 'unknown' }));
    }
    // 兼容某些直接返回数组的非标接口
    if (Array.isArray(res)) {
        return res.map((m: any) => ({ id: m?.id || m, name: m?.id || m, status: 'unknown' }));
    }
    return [];
  } catch (err: any) {
    console.error("Fetch models failed:", err);
    throw err;
  }
};

export const generateDailyDigest = async (config: AppConfig, onLog: (msg: string) => void): Promise<DigestData> => {
  const todayStr = new Date().toISOString().split('T')[0];
  onLog(`[第一步] 正在通过搜索寻找最新资讯...`);
  
  const discoveryPrompt = `Date: ${todayStr}. Task: List 15 recent global news links. Output ONLY valid JSON: {"candidates": [{"title": "String", "url": "String", "category": "social"}]}`;

  const discoveryRes = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', {
    model: config.model,
    messages: [{ role: "user", content: discoveryPrompt }],
    stream: false,
    temperature: 0.1
  });

  // 处理非流式返回的对象
  const discoveryRaw = discoveryRes.choices?.[0]?.message?.content || "";
  const discoveryData = extractJson(discoveryRaw);
  const candidates = (discoveryData.candidates || []) as { title: string, url: string, category: string }[];
  if (candidates.length === 0) throw new Error("未能获取任何有效的资讯链接。");

  onLog(`正在验证 ${candidates.length} 条链接的有效性...`);
  const validatedItems: { title: string, url: string, category: string }[] = [];
  const results = await Promise.all(candidates.map(async (item) => {
      const ok = await validateUrl(item.url);
      return ok ? item : null;
  }));
  results.forEach(r => { if(r) validatedItems.push(r); });

  if (validatedItems.length === 0) throw new Error("AI 生成的链接均无效。");
  onLog(`成功验证 ${validatedItems.length} 条有效链接。`);

  onLog(`[第二步] 正在生成日报精编 (流式解析)...`);
  const elaborationPrompt = `Create a daily digest JSON with social and health arrays. For each: {title, summary_cn, summary_en, ai_score, xhs_titles}. Use these links: ${validatedItems.map(v => v.url).join(', ')}`;

  const elaborationRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', {
    model: config.model,
    messages: [{ role: "user", content: elaborationPrompt }],
    stream: true,
    temperature: 0.5
  });

  // elaborationRaw 对于流式请求已经是拼接好的字符串
  return extractJson(elaborationRaw) as DigestData;
};
