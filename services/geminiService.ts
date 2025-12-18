
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
 * 强化版 JSON 提取器：支持清理、修复截断、提取 Markdown 块
 */
const extractJson = (str: any): any => {
    if (typeof str !== 'string') return str;
    let text = str.trim();
    if (!text) throw new Error("AI 响应内容为空。");

    // 1. 尝试直接解析
    try { return JSON.parse(text); } catch (e) {}

    // 2. 尝试从 Markdown 代码块中提取
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
        try { return JSON.parse(jsonMatch[1].trim()); } catch (e) {}
        text = jsonMatch[1].trim(); // 如果 JSON 代码块内还有杂质，继续往下走
    }

    // 3. 寻找第一个 { 和最后一个 }
    const start = text.indexOf('{');
    let end = text.lastIndexOf('}');
    
    // 如果没有找到闭合括号，尝试修复截断的 JSON (常见于长响应被切断)
    if (start !== -1 && end === -1) {
        text = text.substring(start) + ']}'; // 暴力闭合数组和对象
        end = text.lastIndexOf('}');
    }

    if (start !== -1 && end !== -1 && end > start) {
        let potentialJson = text.substring(start, end + 1);
        try { return JSON.parse(potentialJson); } catch (e) {
            // 尝试二次清理：移除多余逗号、非法转义
            const sanitized = potentialJson
                .replace(/,\s*([\]}])/g, '$1') // 移除尾随逗号
                .replace(/[\u0000-\u001F\u007F-\u009F]/g, ""); // 移除不可见字符
            try { return JSON.parse(sanitized); } catch (e2) {
                console.error("JSON Sanitization failed:", sanitized);
            }
        }
    }
    
    console.error("Raw AI Content that failed parsing:", str);
    throw new Error(`JSON 解析失败。模型返回的内容格式不符合预期，请尝试更换更强大的模型（如 Pro 版）。`);
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
      max_tokens: 10,
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
  
  // 第一步：寻找资讯
  onLog(`[第一步] 正在搜寻今日最新资讯 (流式传输模式)...`);
  
  const discoveryPrompt = `You are a professional news curator. Today's date is ${todayStr}. 
  Task: Find 8-10 high-quality, real, and specific news articles from the last 24 hours about: 
  1. AI breakthroughs (Global)
  2. Economic trends (Global)
  3. Longevity or new medical research.
  
  Requirement:
  - Must provide the direct, deep article URLs.
  - No homepages (like bbc.com). 
  - Format your output strictly as a JSON object, starting with '{' and ending with '}'.
  
  JSON Structure:
  {"candidates": [{"title": "News Title", "url": "Article URL", "category": "social/health"}]}`;

  const discoveryRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', {
    model: config.model,
    messages: [
        { role: "system", content: "You must output ONLY valid JSON code. No explanation text before or after the JSON." },
        { role: "user", content: discoveryPrompt }
    ],
    stream: true,
    temperature: 0.1,
    // 如果模型支持 googleSearch，在此处尝试启用
    tools: config.model.includes('gemini') ? [{ googleSearch: {} }] : undefined
  }) as string;

  const discoveryData = extractJson(discoveryRaw);
  const candidates = (discoveryData.candidates || []) as { title: string, url: string, category: string }[];
  
  if (candidates.length === 0) {
      throw new Error("模型未能找到任何相关资讯链接，请尝试使用带搜索功能的模型。");
  }

  // 验证链接
  onLog(`搜寻完成，正在对 ${candidates.length} 条链接进行连通性验证...`);
  const validatedItems: { title: string, url: string, category: string }[] = [];
  const results = await Promise.all(candidates.slice(0, 10).map(async (item) => {
      // 对 URL 进行基础清洗，防止 AI 拼接错误
      const cleanUrl = item.url.trim().replace(/[\[\]\s]/g, '');
      const ok = await validateUrl(cleanUrl);
      return ok ? { ...item, url: cleanUrl } : null;
  }));
  results.forEach(r => { if(r) validatedItems.push(r); });

  if (validatedItems.length === 0) {
      throw new Error("模型提供的资讯链接均无法访问。这通常是因为模型‘幻觉’了链接，请更换更强大的模型或具有联网搜索能力的模型。");
  }
  onLog(`验证成功，已锁定 ${validatedItems.length} 条有效实时资讯。`);

  // 第二步：深度精编
  onLog(`[第二步] 正在对选定资讯进行深度精编与双语翻译...`);
  const elaborationPrompt = `Create a high-quality daily digest JSON based on these validated links: ${validatedItems.map(v => v.url).join(', ')}.
  
  For each link, generate a DigestItem including:
  - title: Engaging Chinese title.
  - summary_cn: 2-3 sentences of deep insight in Chinese.
  - summary_en: 1 concise sentence summary in English.
  - ai_score: A score from 0 to 100 based on global impact.
  - ai_score_reason: Short Chinese reason for the score.
  - xhs_titles: 3 viral-style catchy titles (for Red Note).
  - tags: 3 relevant hashtags.
  
  JSON Output Format: {"social": [DigestItem], "health": [DigestItem]}`;

  const elaborationRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', {
    model: config.model,
    messages: [
        { role: "system", content: "Always output valid JSON without preamble." },
        { role: "user", content: elaborationPrompt }
    ],
    stream: true,
    temperature: 0.3
  }) as string;

  const finalData = extractJson(elaborationRaw) as DigestData;
  
  // 补齐字段防止渲染崩溃
  if (!finalData.social) finalData.social = [];
  if (!finalData.health) finalData.health = [];
  
  return finalData;
};
