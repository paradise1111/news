
import { GoogleGenAI, Type } from "@google/genai";
import { AppConfig, DigestData, ModelOption } from "../types";
import { DEFAULT_MODELS } from "../constants";

// Correct implementation using @google/genai as per senior engineer guidelines
const getAIInstance = () => {
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

// Fix: checkModelAvailability updated to use @google/genai and simplified parameters
export const checkModelAvailability = async (modelId: string) => {
  const start = Date.now();
  const ai = getAIInstance();
  try {
    await ai.models.generateContent({
      model: modelId,
      contents: "hi",
      config: { maxOutputTokens: 5 }
    });
    return { available: true, latency: Date.now() - start };
  } catch (error: any) {
    return { available: false, error: error.message };
  }
};

// Fix: verifyAndFetchModels updated to return default models as per API constraints
export const verifyAndFetchModels = async (): Promise<ModelOption[]> => {
  return DEFAULT_MODELS.map(m => ({ ...m, status: 'unknown' } as ModelOption));
};

// Fix: Corrected onLog signature to accept optional type argument, fixing line 277 error.
// Also refactored to use @google/genai generateContent with responseSchema for robust JSON extraction.
export const generateDailyDigest = async (
  config: AppConfig, 
  onLog: (msg: string, type?: 'info' | 'success' | 'error') => void
): Promise<DigestData> => {
  const modelToUse = config.model || 'gemini-3-pro-preview';
  onLog(`正在初始化 (模型: ${modelToUse})...`);

  const ai = getAIInstance();
  const todayStr = new Date().toISOString().split('T')[0];
  
  const prompt = `
    Task: Act as an expert News Editor. Generate a daily news digest in JSON.
    Date: ${todayStr}.
    
    ### STRICT CONSTRAINTS
    1. **QUANTITY**: Exactly 6-10 items for "social", exactly 6-10 items for "health".
    2. **LANGUAGE**: 
       - summary_cn & ai_score_reason MUST be in Chinese.
       - title & summary_en MUST be in English.
    3. **LINKS**: No broken links.
  `;

  try {
    onLog("正在获取热点资讯并生成日报...");
    
    const response = await ai.models.generateContent({
      model: modelToUse,
      contents: prompt,
      config: {
        systemInstruction: "You are a JSON-only API. Do not include any preamble, thoughts, or markdown code blocks in your response. Just raw JSON.",
        tools: [{ googleSearch: {} }],
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
                  summary_en: { type: Type.STRING },
                  summary_cn: { type: Type.STRING },
                  source_url: { type: Type.STRING },
                  source_name: { type: Type.STRING },
                  ai_score: { type: Type.NUMBER },
                  ai_score_reason: { type: Type.STRING },
                  tags: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ["title", "summary_en", "summary_cn", "source_url", "source_name", "ai_score", "ai_score_reason", "tags"]
              }
            },
            health: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  summary_en: { type: Type.STRING },
                  summary_cn: { type: Type.STRING },
                  source_url: { type: Type.STRING },
                  source_name: { type: Type.STRING },
                  ai_score: { type: Type.NUMBER },
                  ai_score_reason: { type: Type.STRING },
                  xhs_titles: { type: Type.ARRAY, items: { type: Type.STRING } },
                  tags: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ["title", "summary_en", "summary_cn", "source_url", "source_name", "ai_score", "ai_score_reason", "xhs_titles", "tags"]
              }
            }
          },
          required: ["social", "health"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("AI 返回了空响应。");
    
    const data = JSON.parse(text);
    onLog("日报生成成功。", 'success');
    return data as DigestData;
  } catch (error: any) {
    // Correctly calling onLog with 2 arguments as now allowed by the signature
    onLog(`生成失败: ${error.message}`, 'error');
    throw error;
  }
};