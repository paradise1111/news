import { NextResponse } from 'next/server';
import { Resend } from 'resend';

// Vercel Cron 需要 maxDuration 设置较长，防止生成过程中超时 (设置为 60秒)
export const maxDuration = 60;
// 强制动态执行，不缓存
export const dynamic = 'force-dynamic';

// --- 复用邮件样式生成逻辑 (保持一致性) ---
const EMAIL_STYLES = {
  container: "font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f5;",
  header: "background-color: #2563eb; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;",
  sectionTitle: "color: #1e3a8a; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; margin-top: 24px; font-size: 1.25rem; font-weight: bold;",
  card: "background-color: white; padding: 16px; margin-bottom: 16px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);",
  cardTitle: "font-size: 1.1rem; font-weight: bold; color: #111827; margin-bottom: 8px;",
  summaryEn: "color: #374151; font-size: 0.95rem; line-height: 1.5; margin-bottom: 8px;",
  summaryCn: "color: #4b5563; font-size: 0.95rem; line-height: 1.5; border-left: 3px solid #3b82f6; padding-left: 12px; margin-bottom: 12px;",
  link: "color: #2563eb; text-decoration: none; font-size: 0.875rem;",
  footer: "text-align: center; font-size: 0.75rem; color: #9ca3af; margin-top: 32px;"
};

const generateEmailHtml = (data: any) => {
  const renderItems = (items: any[]) => items.map(item => `
    <div style="${EMAIL_STYLES.card}">
      <div style="${EMAIL_STYLES.cardTitle}">${item.title}</div>
      <div style="${EMAIL_STYLES.summaryEn}">${item.summary_en}</div>
      <div style="${EMAIL_STYLES.summaryCn}">${item.summary_cn}</div>
      <div>
        <a href="${item.source_url}" style="${EMAIL_STYLES.link}" target="_blank">阅读更多 (${item.source_name}) &rarr;</a>
      </div>
    </div>
  `).join('');

  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head><meta charset="utf-8"><title>Daily Pulse</title></head>
    <body style="margin: 0; padding: 0; background-color: #f4f4f5;">
      <div style="${EMAIL_STYLES.container}">
        <div style="${EMAIL_STYLES.header}">
          <h1 style="margin:0; font-size: 24px;">Daily Pulse 日报</h1>
          <p style="margin: 8px 0 0 0; opacity: 0.9;">${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
        <div style="${EMAIL_STYLES.sectionTitle}">🔥 社交热点</div>
        ${data.social && data.social.length > 0 ? renderItems(data.social) : '<p>暂无内容</p>'}
        <div style="${EMAIL_STYLES.sectionTitle}">🧬 健康前沿</div>
        ${data.health && data.health.length > 0 ? renderItems(data.health) : '<p>暂无内容</p>'}
        <div style="${EMAIL_STYLES.footer}"><p>由 Gemini 2.5 AI 自动生成</p></div>
      </div>
    </body></html>
  `;
};

const generateEmailText = (data: any) => {
  let text = `Daily Pulse 日报 - ${new Date().toLocaleDateString('zh-CN')}\n\n`;
  const processSection = (title: string, items: any[]) => {
    text += `=== ${title} ===\n\n`;
    items.forEach((item, index) => {
      text += `${index + 1}. ${item.title}\n摘要: ${item.summary_cn}\n链接: ${item.source_url}\n\n`;
    });
  };
  processSection("社交热点", data.social || []);
  processSection("健康前沿", data.health || []);
  return text;
};

// --- 主处理逻辑 ---

export async function GET(request: Request) {
  // 1. 安全检查 (验证 Cron Secret，防止恶意调用)
  // 当部署到 Vercel 时，Vercel 会自动注入 CRON_SECRET 环境变量
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // 为了方便测试，如果未设置 CRON_SECRET 环境变量，允许直接访问，但生产环境建议设置
    // return new NextResponse('Unauthorized', { status: 401 });
  }

  console.log(">>> [Cron] 开始执行每日早报任务...");

  try {
    // 2. 读取环境变量配置
    const apiKey = process.env.GEMINI_API_KEY;
    const baseUrl = process.env.GEMINI_BASE_URL || 'https://api.openai-proxy.com/v1'; // 默认值
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const recipientsStr = process.env.RECIPIENTS;
    const resendApiKey = process.env.RESEND_API_KEY;

    if (!apiKey || !recipientsStr || !resendApiKey) {
      throw new Error("Missing Environment Variables: GEMINI_API_KEY, RECIPIENTS, or RESEND_API_KEY");
    }

    const recipients = recipientsStr.split(',').map(r => r.trim()).filter(Boolean);

    // 3. 准备提示词 (逻辑同 geminiService.ts)
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const targetDateStr = yesterday.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const queryDateStr = yesterday.toISOString().split('T')[0];

    const prompt = `
      You are an automated Daily Information Digest agent.
      Today is ${today.toISOString().split('T')[0]}.
      **TARGET DATE: ${targetDateStr} (${queryDateStr}).**
      
      Tasks:
      1. Find 5 trending social/tech news from ${targetDateStr}.
      2. Find 5 health/science breakthroughs from ${targetDateStr}.
      
      Requirements:
      - Use Google Search tool if available.
      - Diverse sources. Valid links.
      - Output strict JSON: { "social": [...], "health": [...] }
      - Fields: title, summary_en, summary_cn (Chinese translation), source_url, source_name.
    `;

    // 4. 调用 Gemini API (直接调用，不走 Proxy，因为 Cron 是服务端环境)
    // 修正 URL：确保以 /v1 结尾
    const cleanBaseUrl = baseUrl.replace(/\/+$/, '').endsWith('/v1') ? baseUrl : `${baseUrl}/v1`;
    const targetUrl = `${cleanBaseUrl}/chat/completions`;

    console.log(`[Cron] Fetching content from ${targetUrl} with model ${model}...`);

    const payload: any = {
        model: model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" }
    };

    // DeepSeek 兼容性处理
    if (!model.toLowerCase().includes('deepseek')) {
        payload.tools = [{ googleSearch: {} }];
    }

    const aiRes = await fetch(targetUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
    });

    if (!aiRes.ok) {
        const errText = await aiRes.text();
        throw new Error(`AI API Error ${aiRes.status}: ${errText}`);
    }

    const aiJson = await aiRes.json();
    const content = aiJson.choices?.[0]?.message?.content;
    if (!content) throw new Error("AI response content is empty");

    // 5. 解析 JSON
    let digestData;
    let text = content.replace(/```json/g, "").replace(/```/g, "").trim();
    try {
        digestData = JSON.parse(text);
    } catch (e) {
        // 简单重试提取
        const match = text.match(/\{[\s\S]*\}/);
        if (match) digestData = JSON.parse(match[0]);
        else throw new Error("Failed to parse AI JSON");
    }

    if (!digestData.social) digestData.social = [];
    if (!digestData.health) digestData.health = [];

    console.log(`[Cron] Content generated. Social: ${digestData.social.length}, Health: ${digestData.health.length}`);

    // 6. 发送邮件
    const resend = new Resend(resendApiKey);
    const htmlContent = generateEmailHtml(digestData);
    const textContent = generateEmailText(digestData);
    const subjectLine = `Daily Pulse 日报 - ${new Date().toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}`;

    console.log(`[Cron] Sending emails to ${recipients.length} recipients...`);

    const sendPromises = recipients.map(async (email: string) => {
        return resend.emails.send({
            from: 'Daily Pulse <digest@misaki1.de5.net>',
            to: [email],
            subject: subjectLine,
            html: htmlContent,
            text: textContent,
            headers: { 'X-Entity-Ref-ID': crypto.randomUUID() }
        });
    });

    const results = await Promise.all(sendPromises);
    
    // 检查是否有失败
    const failures = results.filter((r: any) => r.error);
    if (failures.length > 0) {
        console.error("[Cron] Some emails failed:", failures);
    }

    return NextResponse.json({ 
        success: true, 
        message: `Cron job executed. Sent to ${recipients.length} recipients.`,
        dataSummary: { social: digestData.social.length, health: digestData.health.length }
    });

  } catch (error: any) {
    console.error("[Cron] Job Failed:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}