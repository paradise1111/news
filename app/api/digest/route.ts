import { NextResponse } from 'next/server';
import { Resend } from 'resend';

// 复用常量样式
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

// 辅助函数：生成 HTML 字符串
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
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Daily Pulse</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f4f4f5; -webkit-font-smoothing: antialiased;">
      <div style="${EMAIL_STYLES.container}">
        <div style="${EMAIL_STYLES.header}">
          <h1 style="margin:0; font-size: 24px; line-height: 1.2;">Daily Pulse 日报</h1>
          <p style="margin: 8px 0 0 0; opacity: 0.9; font-size: 14px;">${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
        
        <div style="${EMAIL_STYLES.sectionTitle}">🔥 社交热点</div>
        ${data.social && data.social.length > 0 ? renderItems(data.social) : '<p style="color:#666; padding:10px;">暂无相关内容</p>'}
        
        <div style="${EMAIL_STYLES.sectionTitle}">🧬 健康前沿</div>
        ${data.health && data.health.length > 0 ? renderItems(data.health) : '<p style="color:#666; padding:10px;">暂无相关内容</p>'}
        
        <div style="${EMAIL_STYLES.footer}">
          <p>由 Gemini 2.5 AI 生成 • 自动资讯摘要</p>
          <p style="margin-top:5px;">如需退订，请直接回复邮件。</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

// 新增辅助函数：生成纯文本字符串 (对抗垃圾邮件过滤器关键)
const generateEmailText = (data: any) => {
  let text = `Daily Pulse 日报 - ${new Date().toLocaleDateString('zh-CN')}\n\n`;

  const processSection = (title: string, items: any[]) => {
    text += `=== ${title} ===\n\n`;
    if (!items || items.length === 0) {
      text += "暂无内容\n\n";
      return;
    }
    items.forEach((item, index) => {
      text += `${index + 1}. ${item.title}\n`;
      text += `摘要: ${item.summary_cn}\n`;
      text += `来源: ${item.source_name}\n`;
      text += `链接: ${item.source_url}\n\n`;
    });
  };

  processSection("社交热点", data.social);
  processSection("健康前沿", data.health);
  
  text += "\n----------------\n由 Gemini 2.5 AI 生成\n";
  return text;
};

export async function POST(request: Request) {
  try {
    // 优先读取环境变量
    const resendApiKey = process.env.RESEND_API_KEY || 're_hC872nsy_5TcCgN2rjpKiRe6KfKMdA3NK';
    const resend = new Resend(resendApiKey);

    const body = await request.json();
    const { recipients, digestData } = body;

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0 || !digestData) {
      return NextResponse.json({ error: 'Missing recipients list or data' }, { status: 400 });
    }

    // 1. 准备内容 (HTML 和 纯文本)
    const htmlContent = generateEmailHtml(digestData);
    const textContent = generateEmailText(digestData);
    const subjectLine = `Daily Pulse 日报 - ${new Date().toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}`;

    // 2. 遍历发送 (解决 "只显示收件人一个人" 问题)
    // 使用 Promise.all 并行处理，提高效率，但要注意 Resend 的速率限制 (通常每秒几封没问题)
    const sendPromises = recipients.map(async (recipientEmail) => {
        try {
            const { data, error } = await resend.emails.send({
                from: 'Daily Pulse <digest@misaki1.de5.net>', 
                to: [recipientEmail], // 这里只传单个收件人
                subject: subjectLine,
                html: htmlContent,
                text: textContent, // 必填：纯文本版本，极大降低进入垃圾箱的概率
                headers: {
                    'X-Entity-Ref-ID': crypto.randomUUID(), // 增加唯一头，避免被识别为重复垃圾邮件
                }
            });
            
            if (error) {
                console.error(`Failed to send to ${recipientEmail}:`, error);
                return { email: recipientEmail, status: 'failed', error };
            }
            return { email: recipientEmail, status: 'success', id: data?.id };
        } catch (e: any) {
            console.error(`Exception sending to ${recipientEmail}:`, e);
            return { email: recipientEmail, status: 'error', message: e.message };
        }
    });

    const results = await Promise.all(sendPromises);
    
    // 统计结果
    const successCount = results.filter(r => r.status === 'success').length;
    const failCount = results.length - successCount;

    if (successCount === 0 && failCount > 0) {
         // 如果全部失败，返回 500
         return NextResponse.json({ error: 'All emails failed to send', details: results }, { status: 500 });
    }

    return NextResponse.json({ 
        success: true, 
        message: `Sent ${successCount} emails, ${failCount} failed.`,
        details: results 
    });

  } catch (error: any) {
    console.error('Email dispatch error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}