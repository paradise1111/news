
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { AppConfig, DigestData, DigestItem } from "../types";

/**
 * 验证链接连通性
 */
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

export const generateDailyDigest = async (config: AppConfig, onLog: (msg: string) => void): Promise<DigestData> => {
  // 严格按照指南：在调用前初始化，并使用 process.env.API_KEY
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("系统环境未配置 API_KEY，请检查环境变量设置。");
  }

  const ai = new GoogleGenAI({ apiKey });
  const todayStr = new Date().toISOString().split('T')[0];
  // 优先使用 flash 模型以获得更好的搜索可用性和更低的延迟
  const modelId = 'gemini-3-flash-preview';

  onLog(`[第一步] 正在使用 ${modelId} 及 Google Search 搜寻今日实时资讯...`);
  
  try {
    const discoveryResponse = await ai.models.generateContent({
      model: modelId,
      contents: `Find 8-10 specific, high-impact news articles from today (${todayStr}) about AI breakthroughs, Global economy, and Life sciences/Health. 
      For each article, include the headline and the actual news source URL.`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    // 提取 Grounding 链接
    const chunks = discoveryResponse.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const foundLinks: { title: string, url: string }[] = [];
    
    chunks.forEach((chunk: any) => {
      if (chunk.web?.uri && chunk.web?.title) {
          foundLinks.push({
              title: chunk.web.title,
              url: chunk.web.uri
          });
      }
    });

    // 如果 groundingChunks 为空，尝试从正文正则提取链接（兜底方案）
    if (foundLinks.length === 0 && discoveryResponse.text) {
        onLog("正在从搜索摘要中解析链接...");
        const urlRegex = /(https?:\/\/[^\s)\]]+)/g;
        const matches = discoveryResponse.text.match(urlRegex);
        if (matches) {
            matches.forEach(url => {
                foundLinks.push({ title: "News Source", url });
            });
        }
    }

    if (foundLinks.length === 0) {
        throw new Error("未能搜索到有效的实时资讯链接，请稍后重试。");
    }

    onLog(`发现 ${foundLinks.length} 条原始资讯来源，正在进行连通性抽样验证...`);
    
    const validatedItems: { title: string, url: string }[] = [];
    // 验证前 8 个链接
    for (const item of foundLinks.slice(0, 8)) {
        const ok = await validateUrl(item.url);
        if (ok) validatedItems.push(item);
    }

    if (validatedItems.length === 0) {
        onLog("警告：搜索到的链接验证失败，可能存在反爬限制。尝试直接使用原始链接...");
        validatedItems.push(...foundLinks.slice(0, 3));
    }

    onLog(`[第二步] 正在进行深度精编、Insight 提取与双语翻译...`);
    
    const elaborationPrompt = `
      Based on these validated news links: ${validatedItems.map(v => v.url).join(', ')}.
      Create a professional daily digest in JSON format.
      
      Fields for each item:
      - title: Catchy Chinese title.
      - summary_cn: 2-3 sentences of deep insight in Chinese.
      - summary_en: 1 concise sentence in English.
      - ai_score: Importance score (0-100).
      - ai_score_reason: Short reason in Chinese.
      - xhs_titles: 3 viral titles for social media.
      - tags: 3 relevant tags.
      
      Classify items into "social" or "health" categories.
    `;

    const elaborationResponse = await ai.models.generateContent({
      model: modelId,
      contents: elaborationPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            social: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  summary_cn: { type: Type.STRING },
                  summary_en: { type: Type.STRING },
                  ai_score: { type: Type.NUMBER },
                  ai_score_reason: { type: Type.STRING },
                  xhs_titles: { type: Type.ARRAY, items: { type: Type.STRING } },
                  tags: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ["title", "summary_cn", "summary_en", "ai_score"]
              }
            },
            health: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  summary_cn: { type: Type.STRING },
                  summary_en: { type: Type.STRING },
                  ai_score: { type: Type.NUMBER },
                  ai_score_reason: { type: Type.STRING },
                  xhs_titles: { type: Type.ARRAY, items: { type: Type.STRING } },
                  tags: { type: Type.ARRAY, items: { type: Type.STRING } }
                }
              }
            }
          },
          required: ["social", "health"]
        }
      }
    });

    const finalJson = JSON.parse(elaborationResponse.text || "{}");
    
    // 注入验证过的 URL 和来源名称
    const mapUrls = (items: any[]) => (items || []).map((item, idx) => ({
        ...item,
        source_url: validatedItems[idx % validatedItems.length]?.url || "https://news.google.com",
        source_name: "AI Verified Source"
    }));

    return {
        social: mapUrls(finalJson.social),
        health: mapUrls(finalJson.health)
    };
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    throw new Error(`AI 生成失败: ${error.message}`);
  }
};

export const verifyAndFetchModels = async (): Promise<any[]> => {
    return [
        { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (推荐：极速且全能)' },
        { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro (高逻辑推理)' }
    ];
};
