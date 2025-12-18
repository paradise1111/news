
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

    // 尝试直接解析
    try { return JSON.parse(text); } catch (e) {}

    // 尝试 Markdown 提取
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
        try { return JSON.parse(jsonMatch[1].trim()); } catch (e) {}
    }

    // 暴力搜索大括号
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
    
    throw new Error(`JSON 解析失败。响应原文内容不足或格式错误。`);
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
 * 通用请求方法：支持流式保活
 */
const openAIFetch = async (
  baseUrl: string,
  apiKey: string,
  endpoint: string,
  body?: any,
  method: string = 'POST'
) => {
  const normalizedBase = normalizeBaseUrl(baseUrl);
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
  
  if (contentType.includes('text/event-stream') || body?.stream === true) {
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
    if (res && Array.isArray(res.data)) {
        return res.data.map((m: any) => ({ id: m.id, name: m.id, status: 'unknown' }));
    }
    if (Array.isArray(res)) {
        return res.map((m: any) => ({ id: m?.id || m, name: m?.id || m, status: 'unknown' }));
    }
    return [];
  } catch (err: any) {
    throw err;
  }
};

export const generateDailyDigest = async (config: AppConfig, onLog: (msg: string) => void): Promise<DigestData> => {
  const todayStr = new Date().toISOString().split('T')[0];
  
  // 第一步：寻找资讯 (改为流式，防止 504)
  onLog(`[第一步] 正在搜寻最新资讯 (使用流式传输以防超时)...`);
  const discoveryPrompt = `Today is ${todayStr}. Task: Find 12 highly relevant news articles about AI breakthroughs, global economy, and longevity health. Output JSON ONLY: {"candidates": [{"title": "...", "url": "...", "category": "..."}]}`;

  const discoveryRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', {
    model: config.model,
    messages: [{ role: "user", content: discoveryPrompt }],
    stream: true, // 关键：使用流式防止网关超时
    temperature: 0.1
  }) as string;

  const discoveryData = extractJson(discoveryRaw);
  const candidates = (discoveryData.candidates || []) as { title: string, url: string, category: string }[];
  if (candidates.length === 0) throw new Error("未能搜寻到有效资讯，请检查模型是否有搜索权限或更换模型。");

  // 验证链接
  onLog(`正在验证 ${candidates.length} 条资讯链接的连通性...`);
  const validatedItems: { title: string, url: string, category: string }[] = [];
  const results = await Promise.all(candidates.slice(0, 10).map(async (item) => {
      const ok = await validateUrl(item.url);
      return ok ? item : null;
  }));
  results.forEach(r => { if(r) validatedItems.push(r); });

  if (validatedItems.length === 0) throw new Error("模型生成的链接均为死链，请换一个更强的模型（如 Pro 版）。");
  onLog(`成功获取 ${validatedItems.length} 条实时有效资讯。`);

  // 第二步：深度精编
  onLog(`[第二步] 正在基于原文进行深度精编与翻译...`);
  const elaborationPrompt = `Generate a daily digest JSON based on these links: ${validatedItems.map(v => v.url).join(', ')}. Format: {"social": [DigestItem], "health": [DigestItem]}. Each item: {title, summary_cn, summary_en, ai_score, ai_score_reason, xhs_titles: [3 strings], tags: [3 strings]}`;

  const elaborationRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', {
    model: config.model,
    messages: [{ role: "user", content: elaborationPrompt }],
    stream: true,
    temperature: 0.3
  }) as string;

  const finalData = extractJson(elaborationRaw) as DigestData;
  
  // 补齐字段防止渲染崩溃
  if (!finalData.social) finalData.social = [];
  if (!finalData.health) finalData.health = [];
  
  return finalData;
};
