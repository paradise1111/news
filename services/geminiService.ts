
import { AppConfig, DigestData, ModelOption, DigestItem } from "../types";
import { DEFAULT_MODELS } from "../constants";

/**
 * 基础 URL 处理：尊重用户输入，仅做基础斜杠清理
 */
const normalizeBaseUrl = (url: string): string => {
  return url.trim().replace(/\/+$/, '');
};

/**
 * 通用 JSON 提取器：从 AI 的响应（可能包含 Markdown 标签）中提取有效 JSON
 */
const extractJson = (str: string): any => {
    if (typeof str !== 'string') return str;
    const text = str.trim();
    if (!text) throw new Error("AI 返回了空内容。");

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
        try {
            return JSON.parse(potentialJson);
        } catch (e) {
            const sanitized = potentialJson
                .replace(/,\s*([\]}])/g, '$1')
                .replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
            try { return JSON.parse(sanitized); } catch (e2) {}
        }
    }
    throw new Error(`无法解析 AI 输出。原始内容: ${text.substring(0, 100)}...`);
};

/**
 * 链接验证逻辑：通过现有代理发起请求，检查是否可用 (200 OK)
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
        
        const reader = response.body?.getReader();
        if (!reader) return false;
        
        const { value } = await reader.read();
        if (!value) return false;
        
        const chunk = new TextDecoder().decode(value);
        // 检查代理流中是否包含错误标识
        if (chunk.includes('event: error') || chunk.includes('"error":')) {
            return false;
        }
        return response.ok;
    } catch {
        return false;
    }
};

/**
 * 兼容 New API / OpenAI 格式的调用
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
      if (!reader) throw new Error("无法建立流式连接");
      
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

      if (hasError) throw new Error(errorMessage || "AI 接口调用失败");
      return fullContent;
  } else {
      const result = await response.json();
      if (result.error) throw new Error(result.error.message || "请求返回错误");
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
 * 核心生成逻辑：发现 -> 验证 -> 精编
 */
export const generateDailyDigest = async (config: AppConfig, onLog: (msg: string) => void): Promise<DigestData> => {
  const todayStr = new Date().toISOString().split('T')[0];

  // --- Step 1: Discovery (资讯发现) ---
  onLog(`[第一步] 正在通过 AI 搜索最新资讯候选项 (日期: ${todayStr})...`);
  
  const discoveryPrompt = `
    请检索 ${todayStr} 发生的重大社会新闻和健康资讯。
    要求：
    1. 找到至少 10 个“社会热点 (social)”和 10 个“健康生活 (health)”的候选链接。
    2. 必须提供真实的原始深层链接 (Deep Link)。
    3. 严禁捏造虚假 URL。
    4. 仅输出 JSON 格式：{"candidates": [{"title": "标题", "url": "真实链接", "category": "social/health"}]}
    禁止输出任何 Markdown 标签或解释文字。
  `;

  const discoveryRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', {
    model: config.model,
    messages: [
        { role: "system", content: "你是一个只输出 JSON 数据的资讯采集器。" },
        { role: "user", content: discoveryPrompt }
    ],
    stream: true,
    max_tokens: 2000,
    temperature: 0.3
  });

  const discoveryData = extractJson(discoveryRaw);
  const candidates = (discoveryData.candidates || []) as { title: string, url: string, category: string }[];

  if (candidates.length === 0) throw new Error("未能搜索到有效的新闻候选。");

  // --- Step 2: Verification (真实性校验) ---
  onLog(`[检查点] 正在对 ${candidates.length} 条链接进行连通性测试 (200 OK Check)...`);
  const validatedItems: { title: string, url: string, category: string }[] = [];
  
  // 并行验证链接
  const validationPromises = candidates.map(async (item, index) => {
      const isValid = await validateUrl(item.url);
      if (isValid) {
          validatedItems.push(item);
      }
  });

  await Promise.all(validationPromises);

  if (validatedItems.length === 0) {
      throw new Error("搜索到的链接经校验全部失效（可能是模型产生的幻觉链接）。请更换更高级的模型（如 Pro）重试。");
  }
  onLog(`校验完成：${validatedItems.length} 条链接真实有效。`);

  // --- Step 3: Elaboration (深度摘要生成) ---
  onLog(`[第二步] 正在基于验证过的 ${validatedItems.length} 条链接生成精编日报内容...`);
  
  const elaborationPrompt = `
    基于以下已验证真实的资讯链接，生成完整的 Daily Digest 日报数据。
    
    真实链接列表：
    ${validatedItems.map((v, i) => `${i+1}. [${v.category}] ${v.title} - URL: ${v.url}`).join('\n')}

    每条资讯的要求：
    - title: 专业的中文标题。
    - summary_cn: 100字左右的中文深度总结。
    - summary_en: 简洁的英文概括。
    - source_name: 来源媒体名称。
    - source_url: 必须使用提供的原始链接。
    - ai_score: 推荐权重 (60-99)。
    - ai_score_reason: 推荐理由。
    - tags: 2-3个相关标签。
    - xhs_titles: (仅限健康类) 3个小红书爆款标题。

    仅输出 JSON，结构如下：{"social": [...], "health": [...]}
    严禁包含 Markdown 代码块标记（如 \`\`\`json ）。
  `;

  const elaborationRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', {
    model: config.model,
    messages: [
        { role: "system", content: "你是一个专业的日报主编。请严格输出 JSON，不要有任何 Markdown 或前导说明文字。" },
        { role: "user", content: elaborationPrompt }
    ],
    stream: true,
    max_tokens: 6000,
    temperature: 0.7
  });

  const finalData = extractJson(elaborationRaw);
  onLog("所有流程已完成！日报已生成。");
  return finalData as DigestData;
};
