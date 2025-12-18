
import { AppConfig, DigestData, ModelOption, DigestItem } from "../types";
import { DEFAULT_MODELS } from "../constants";

/**
 * 基础 URL 处理：完全尊重用户输入，仅去除末尾斜杠
 */
const normalizeBaseUrl = (url: string): string => {
  return url.trim().replace(/\/+$/, '');
};

/**
 * 健壮的 JSON 提取器：从 AI 的各类回复中精准提取 {} 结构
 */
const extractJson = (str: string): any => {
    if (typeof str !== 'string') return str;
    const text = str.trim();
    if (!text) throw new Error("AI 返回了空内容。");

    // 尝试直接解析
    try { return JSON.parse(text); } catch (e) {}

    // 清理可能存在的 Markdown 标签
    let cleaned = text
        .replace(/^[\s\S]*?```json/g, '')
        .replace(/```[\s\S]*?$/g, '')
        .trim();
    
    try { return JSON.parse(cleaned); } catch (e) {}

    // 寻找第一个 { 和最后一个 }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    
    if (start !== -1 && end !== -1 && end > start) {
        const potentialJson = text.substring(start, end + 1);
        try {
            return JSON.parse(potentialJson);
        } catch (e) {
            const sanitized = potentialJson
                .replace(/,\s*([\]}])/g, '$1')
                .replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
            try { return JSON.parse(sanitized); } catch (e2) {}
        }
    }
    throw new Error(`无法解析 JSON 数据。原始输出内容过长或格式错误。`);
};

/**
 * 链接有效性校验：通过现有的 /api/proxy 检查链接是否返回正常
 */
const validateUrl = async (url: string): Promise<boolean> => {
    try {
        const response = await fetch('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetUrl: url,
                method: 'GET',
                headers: { 
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' 
                }
            }),
        });
        
        // 代理返回的是流。我们尝试读取第一块数据。
        const reader = response.body?.getReader();
        if (!reader) return false;
        
        const { value } = await reader.read();
        if (!value) return false;
        
        const chunk = new TextDecoder().decode(value);
        // 如果代理返回了 error 事件或 JSON 错误，则视为失效
        if (chunk.includes('event: error') || chunk.includes('"error":')) {
            return false;
        }
        return response.ok;
    } catch {
        return false;
    }
};

/**
 * 通用 OpenAI 兼容调用函数
 */
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
      method,
      headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
      },
      body 
    }),
  });

  const contentType = response.headers.get('content-type') || '';
  
  if (contentType.includes('text/event-stream')) {
      const reader = response.body?.getReader();
      if (!reader) throw new Error("无法读取流式响应");
      
      const decoder = new TextDecoder();
      let fullContent = '';
      let hasError = false;
      let errorMessage = '';

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
                          errorMessage = parsed.error?.message || errorMessage || dataStr;
                      } else {
                          const delta = parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.text || '';
                          fullContent += delta;
                      }
                  } catch (e) {
                      if (!hasError) fullContent += dataStr;
                  }
              }
          }
      }

      if (hasError) throw new Error(errorMessage || "AI 调用异常");
      return fullContent;
  } else {
      const result = await response.json();
      if (result.error) throw new Error(result.error.message || "接口返回错误");
      return result;
  }
};

export const checkModelAvailability = async (apiKey: string, baseUrl: string, modelId: string) => {
  const start = Date.now();
  try {
    await openAIFetch(baseUrl, apiKey, '/chat/completions', {
      model: modelId,
      messages: [{ role: "user", content: "ping" }],
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
    return DEFAULT_MODELS.map(m => ({ ...m, status: 'unknown' } as ModelOption));
  } catch {
    return DEFAULT_MODELS.map(m => ({ ...m, status: 'unknown' } as ModelOption));
  }
};

/**
 * 增强型日报生成：Discovery -> Validation -> Elaboration
 */
export const generateDailyDigest = async (config: AppConfig, onLog: (msg: string) => void): Promise<DigestData> => {
  const todayStr = new Date().toISOString().split('T')[0];

  // --- 阶段 1: 发现 (Discovery) ---
  onLog(`[阶段 1] 正在检索资讯链接 (今日: ${todayStr})...`);
  const discoveryPrompt = `
    请作为资讯搜寻专家，检索 ${todayStr} 发生的全球重大新闻。
    要求：
    1. 找到 10 个“社会热点 (social)”链接和 10 个“健康生活 (health)”链接。
    2. 必须提供真实的、指向具体文章的原始深层链接（URL）。
    3. 请严格输出 JSON 格式，不要有任何 Markdown 或开场白。
    格式要求：{"candidates": [{"title": "标题", "url": "URL", "category": "social" | "health"}]}
  `;

  const discoveryRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', {
    model: config.model,
    messages: [
        { role: "system", content: "你是一个只输出 JSON 的资讯检索机器人。严禁输出任何非 JSON 文字。" },
        { role: "user", content: discoveryPrompt }
    ],
    stream: true,
    max_tokens: 2000,
    temperature: 0.2, // 降低随机性以减少虚假链接
    tools: [{ googleSearch: {} }] // 强制使用搜索工具
  });

  const discoveryData = extractJson(discoveryRaw);
  const candidates = (discoveryData.candidates || []) as { title: string, url: string, category: string }[];

  if (candidates.length === 0) throw new Error("未能搜索到有效的新闻候选。");

  // --- 阶段 2: 验证 (Validation) ---
  onLog(`[阶段 2] 正在校验 ${candidates.length} 条链接的真实性...`);
  const validatedItems: { title: string, url: string, category: string }[] = [];
  
  // 并发检查
  await Promise.all(candidates.map(async (item) => {
      const isValid = await validateUrl(item.url);
      if (isValid) {
          validatedItems.push(item);
      }
  }));

  if (validatedItems.length === 0) {
      throw new Error("模型提供的链接经校验全部失效。这通常是因为模型产生了幻觉（伪造了链接）。请尝试更换更高级的模型或重试。");
  }
  onLog(`[阶段 2] 校验通过：${validatedItems.length} 条链接真实有效。`);

  // --- 阶段 3: 精编 (Elaboration) ---
  onLog(`[阶段 3] 正在基于真实链接生成深度精编摘要...`);
  const elaborationPrompt = `
    请基于以下经校验的真实资讯链接，编写今日的 Daily Digest。
    
    真实资讯源列表：
    ${validatedItems.map((v, i) => `${i+1}. [${v.category}] ${v.title} | URL: ${v.url}`).join('\n')}

    输出要求：
    - 对每个链接进行深度内容摘要。
    - summary_cn: 100字左右的中文详细分析。
    - summary_en: 简洁的英文概括。
    - ai_score: 60-99的推荐指数。
    - ai_score_reason: 中文推荐理由。
    - xhs_titles: (仅健康类) 3个小红书爆款标题。
    - 请仅输出 JSON，不要 Markdown，不要前导词。

    JSON 结构参考：{"social": [...], "health": [...]}
  `;

  const elaborationRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', {
    model: config.model,
    messages: [
        { role: "system", content: "你是一个专业的日报编辑。请仅输出 JSON 格式。严禁包含任何前导词、后缀或 Markdown 格式代码块。确保 JSON 结构完整且可解析。" },
        { role: "user", content: elaborationPrompt }
    ],
    stream: true,
    max_tokens: 6000,
    temperature: 0.7
  });

  const finalData = extractJson(elaborationRaw);
  onLog("日报生成圆满完成！");
  return finalData as DigestData;
};
