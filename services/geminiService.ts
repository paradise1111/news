
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
 * 终极 JSON 提取器：处理截断、杂质和多重嵌套
 */
const extractJson = (str: any): any => {
    if (typeof str !== 'string') return str;
    let text = str.trim();
    if (!text) throw new Error("AI 响应内容为空。");

    // 快捷解析
    try { return JSON.parse(text); } catch (e) {}

    // Markdown 提取
    const markdownRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
    let match;
    while ((match = markdownRegex.exec(text)) !== null) {
        try { return JSON.parse(match[1].trim()); } catch (e) {}
    }

    // 深度搜索第一个 { 和匹配的最后一个 }
    const start = text.indexOf('{');
    if (start !== -1) {
        let end = text.lastIndexOf('}');
        
        // 尝试自动修复截断（如果只有开头没结尾，通常发生在流中断）
        if (end === -1 || end < start) {
            // 如果是列表类，尝试补齐
            if (text.includes('"candidates"')) text += ']}';
            else if (text.includes('"social"')) text += ']}';
            else text += '}';
            end = text.lastIndexOf('}');
        }

        if (end !== -1 && end > start) {
            const potentialJson = text.substring(start, end + 1);
            try { return JSON.parse(potentialJson); } catch (e) {
                // 清理常见干扰项
                const cleaned = potentialJson
                    .replace(/,\s*([\]}])/g, '$1') // 移除末尾逗号
                    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ""); // 移除不可见字符
                try { return JSON.parse(cleaned); } catch (e2) {
                    console.error("Failed to parse cleaned JSON:", cleaned);
                }
            }
        }
    }
    
    throw new Error(`无法从 AI 响应中解析出有效的 JSON 数据。这通常是由于网络中断或模型输出过慢导致的截断。请尝试换用 gemini-1.5-flash 或 gemini-2.0-flash-exp 以获得更快的响应。`);
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

  try {
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
  } catch (netErr: any) {
    if (netErr.name === 'TypeError') {
        throw new Error("网络连接失败。请检查 Base URL 是否正确，或 API 代理是否在线。");
    }
    throw netErr;
  }
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
  
  onLog(`[第一步] 正在搜寻资讯 (极速流式模式)...`);
  const discoveryPrompt = `Date: ${todayStr}. Find 6-8 IMPORTANT specific news links for: AI breakthroughs, Global economy, Longevity research.
  Return JSON ONLY: {"candidates": [{"title": "Title", "url": "Full Link", "category": "social/health"}]}.`;

  const discoveryRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', {
    model: config.model,
    messages: [
        { role: "system", content: "JSON only. No preamble." },
        { role: "user", content: discoveryPrompt }
    ],
    stream: true,
    temperature: 0,
    tools: config.model.includes('gemini') ? [{ googleSearch: {} }] : undefined
  }) as string;

  const discoveryData = extractJson(discoveryRaw);
  const candidates = (discoveryData.candidates || []) as { title: string, url: string, category: string }[];
  
  if (candidates.length === 0) throw new Error("未找到资讯，建议尝试更快的 Flash 模型。");

  onLog(`正在验证 ${candidates.length} 条资讯链接...`);
  const validatedItems: { title: string, url: string, category: string }[] = [];
  const results = await Promise.all(candidates.slice(0, 8).map(async (item) => {
      const cleanUrl = item.url.trim().replace(/[\[\]\s]/g, '');
      const ok = await validateUrl(cleanUrl);
      return ok ? { ...item, url: cleanUrl } : null;
  }));
  results.forEach(r => { if(r) validatedItems.push(r); });

  if (validatedItems.length === 0) throw new Error("未能获取到实时有效资讯。请尝试使用 Pro 版本模型或具有更好搜索能力的模型。");
  onLog(`成功验证 ${validatedItems.length} 条有效实时资讯。`);

  onLog(`[第二步] 正在进行深度精编与翻译...`);
  const elaborationPrompt = `Links: ${validatedItems.map(v => v.url).join(', ')}. Create daily digest JSON. Fields: title, summary_cn (2 sentences), summary_en (1 sentence), ai_score (0-100), ai_score_reason, xhs_titles (3 titles), tags (3 tags). Format: {"social": [], "health": []}`;

  const elaborationRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', {
    model: config.model,
    messages: [{ role: "user", content: elaborationPrompt }],
    stream: true,
    temperature: 0.2
  }) as string;

  const finalData = extractJson(elaborationRaw) as DigestData;
  if (!finalData.social) finalData.social = [];
  if (!finalData.health) finalData.health = [];
  
  return finalData;
};
