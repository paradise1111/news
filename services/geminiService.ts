
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
    if (!text) throw new Error("AI 响应内容完全为空，请检查模型可用性或降低安全过滤等级。");

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
    throw new Error(`JSON 解析失败。原始内容开头: ${text.substring(0, 100)}`);
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

  // 关键修复：仅在非 GET/HEAD 请求时构造 body
  const isPost = method.toUpperCase() === 'POST';
  const finalBody = isPost ? {
      ...body,
      safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
      ]
  } : undefined;

  const response = await fetch('/api/proxy', {
    method: 'POST', // 代理始终用 POST 通讯
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetUrl,
      method, // 这里传递给上游的真实方法（GET 或 POST）
      headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
      },
      body: finalBody 
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
      if (!fullContent) throw new Error("模型响应为空，可能被安全策略拦截。");
      return fullContent;
  } 
  
  const result = await response.json();
  // 某些接口直接返回结果，某些包裹在 choices 中
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
  
  const discoveryPrompt = `请提供 ${todayStr} 发生的全球 10 条社会热点和 10 条健康资讯。必须包含真实的原始 URL，严禁捏造。仅输出 JSON 格式：{"candidates": [{"title": "标题", "url": "URL", "category": "social"}]}`;

  const discoveryRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', {
    model: config.model,
    messages: [{ role: "user", content: discoveryPrompt }],
    stream: true,
    max_tokens: 4000,
    temperature: 0.3
  });

  const discoveryData = extractJson(discoveryRaw);
  const candidates = (discoveryData.candidates || []) as { title: string, url: string, category: string }[];
  if (candidates.length === 0) throw new Error("未找到资讯链接。");

  onLog(`[检查点] 正在验证 ${candidates.length} 条链接...`);
  const validatedItems: { title: string, url: string, category: string }[] = [];
  const results = await Promise.all(candidates.map(async (item) => {
      const ok = await validateUrl(item.url);
      return ok ? item : null;
  }));
  results.forEach(r => { if(r) validatedItems.push(r); });

  if (validatedItems.length === 0) throw new Error("链接验证全部失败。");
  onLog(`成功验证 ${validatedItems.length} 条链接。`);

  onLog(`[第二步] 正在生成日报精编...`);
  const elaborationPrompt = `根据以下源链接编写日报，包含 summary_cn (150字), summary_en, ai_score, xhs_titles。源：${validatedItems.map(v => v.url).join(',')}`;

  const elaborationRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', {
    model: config.model,
    messages: [{ role: "user", content: elaborationPrompt }],
    stream: true,
    max_tokens: 6000,
    temperature: 0.6
  });

  return extractJson(elaborationRaw) as DigestData;
};
