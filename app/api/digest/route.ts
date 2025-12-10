import { NextResponse } from 'next/server';
import { Resend } from 'resend';

// 注意：你需要先运行 `npm install resend`
// 并在 .env.local 中配置 RESEND_API_KEY
const resend = new Resend(process.env.RESEND_API_KEY);

// 复用常量样式 (为了后端独立性，这里重新定义一遍，或者您可以从 @/constants 导入)
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
    <html>
    <body style="margin: 0; padding: 0; background-color: #f4f4f5;">
      <div style="${EMAIL_STYLES.container}">
        <div style="${EMAIL_STYLES.header}">
          <h1 style="margin:0; font-size: 24px;">Daily Pulse 日报</h1>
          <p style="margin: 5px 0 0 0; opacity: 0.9;">${new Date().toLocaleDateString()}</p>
        </div>
        
        <div style="${EMAIL_STYLES.sectionTitle}">社交热点</div>
        ${data.social ? renderItems(data.social) : '<p>无相关内容</p>'}
        
        <div style="${EMAIL_STYLES.sectionTitle}">健康前沿</div>
        ${data.health ? renderItems(data.health) : '<p>无相关内容</p>'}
        
        <div style="${EMAIL_STYLES.footer}">
          由 Gemini 2.5 生成 • 自动资讯摘要
        </div>
      </div>
    </body>
    </html>
  `;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { recipient, digestData } = body;

    if (!recipient || !digestData) {
      return NextResponse.json({ error: 'Missing recipient or data' }, { status: 400 });
    }

    const htmlContent = generateEmailHtml(digestData);

    const data = await resend.emails.send({
      from: 'Daily Pulse <onboarding@resend.dev>', // 这里需要改成您在 Resend 验证过的域名
      to: [recipient],
      subject: `Daily Pulse - ${new Date().toLocaleDateString()}`,
      html: htmlContent,
    });

    return NextResponse.json({ success: true, id: data.id });

  } catch (error) {
    console.error('Email sending failed:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}