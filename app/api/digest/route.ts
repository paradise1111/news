
import { NextResponse } from 'next/server';
import { Resend } from 'resend';

export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

const generateId = () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

// --- SATURATED EMAIL STYLE (Sync with Cron) ---
const EMAIL_STYLES = {
  body: "background-color: #f1f5f9; margin: 0; padding: 0; -webkit-font-smoothing: antialiased;",
  container: "width: 100%; max-width: 600px; margin: 0 auto; background-color: #f1f5f9; padding-bottom: 40px;",
  header: "background-color: #312e81; color: #ffffff; padding: 40px 20px; text-align: center;",
  headerTag: "display: inline-block; border: 1px solid #818cf8; padding: 2px 8px; font-family: sans-serif; font-size: 10px; letter-spacing: 2px; color: #c7d2fe; margin-bottom: 10px;",
  headerTitle: "font-family: 'Times New Roman', serif; font-size: 42px; font-weight: 900; margin: 0; letter-spacing: -1px; line-height: 1;",
  headerMeta: "font-family: sans-serif; color: #a5b4fc; font-size: 10px; margin-top: 10px; letter-spacing: 2px; text-transform: uppercase;",
  sectionTitle: "background-color: #1e293b; color: #ffffff; padding: 15px; font-family: sans-serif; font-size: 18px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-top: 30px; margin-bottom: 20px; text-align: center;",
  card: "background-color: #ffffff; border-bottom: 4px solid #312e81; padding: 25px; margin-bottom: 20px;",
  metaRow: "margin-bottom: 15px;",
  scoreBadge: "background-color: #312e81; color: #ffffff; font-family: monospace; font-size: 14px; font-weight: bold; padding: 4px 8px; display: inline-block;",
  scoreReason: "font-family: serif; color: #312e81; font-weight: bold; font-size: 12px; border: 1px solid #312e81; padding: 3px 6px; display: inline-block; margin-left: 5px;",
  title: "font-family: 'Times New Roman', serif; font-size: 24px; font-weight: 900; line-height: 1.2; color: #0f172a; margin: 0 0 10px 0;",
  xhsBox: "background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; margin: 15px 0;",
  xhsHeader: "color: #b91c1c; font-family: sans-serif; font-weight: bold; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px;",
  xhsItem: "font-family: serif; font-weight: bold; font-size: 16px; color: #7f1d1d; display: block; margin-bottom: 5px;",
  summaryCn: "font-family: 'Times New Roman', serif; font-size: 16px; line-height: 1.6; color: #1e293b; font-weight: bold; margin-bottom: 8px; display: block; border-left: 2px solid #e2e8f0; padding-left: 10px;",
  summaryEn: "font-family: sans-serif; font-size: 12px; line-height: 1.5; color: #64748b; font-style: italic; display: block; padding-left: 10px; margin-bottom: 20px;",
  linkBtn: "background-color: #0f172a; color: #ffffff !important; text-decoration: none; padding: 10px 20px; font-family: sans-serif; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; display: inline-block;",
  footer: "padding: 40px 20px; text-align: center; font-family: sans-serif; font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 2px;"
};

const generateEmailHtml = (data: any) => {
  const renderItems = (items: any[]) => items.map((item, idx) => `
    <div style="${EMAIL_STYLES.card}">
      <div style="${EMAIL_STYLES.metaRow}">
         <span style="${EMAIL_STYLES.scoreBadge}">${item.ai_score}</span>
         <span style="${EMAIL_STYLES.scoreReason}">${item.ai_score_reason || '高热度'}</span>
         <span style="float: right; font-family: sans-serif; font-size: 10px; color: #94a3b8; letter-spacing: 1px;">NEWS / 0${idx + 1}</span>
      </div>
      
      <h2 style="${EMAIL_STYLES.title}">${item.title}</h2>

      ${item.xhs_titles && item.xhs_titles.length > 0 ? `
          <div style="${EMAIL_STYLES.xhsBox}">
            <div style="${EMAIL_STYLES.xhsHeader}">⚡ RED NOTE STRATEGY</div>
            ${item.xhs_titles.map((t: string) => `<span style="${EMAIL_STYLES.xhsItem}">• ${t}</span>`).join('')}
          </div>
      ` : ''}
      
      <div style="${EMAIL_STYLES.summaryCn}">
        ${item.summary_cn}
      </div>
      
      <div style="${EMAIL_STYLES.summaryEn}">
        ${item.summary_en}
      </div>
      
      <div>
        <a href="${item.source_url}" target="_blank" style="${EMAIL_STYLES.linkBtn}">Read Source &rarr;</a>
      </div>
    </div>
  `).join('');

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Hajimi Daily</title>
    </head>
    <body style="${EMAIL_STYLES.body}">
      <center>
      <div style="${EMAIL_STYLES.container}">
        <div style="${EMAIL_STYLES.header}">
          <span style="${EMAIL_STYLES.headerTag}">DAILY INTELLIGENCE</span>
          <h1 style="${EMAIL_STYLES.headerTitle}">HAJIMI<span style="color:#818cf8">.</span>DAILY</h1>
          <div style="${EMAIL_STYLES.headerMeta}">
             ${new Date().toLocaleDateString('zh-CN')} &bull; CURATED BY AI
          </div>
        </div>
        
        <div style="${EMAIL_STYLES.sectionTitle}">Global Trends</div>
        ${data.social && data.social.length > 0 ? renderItems(data.social) : '<div style="padding:20px;">No items found.</div>'}
        
        <div style="${EMAIL_STYLES.sectionTitle}">Life & Health</div>
        ${data.health && data.health.length > 0 ? renderItems(data.health) : '<div style="padding:20px;">No items found.</div>'}
        
        <div style="${EMAIL_STYLES.footer}">
          Generated by Hajimi Automation System<br/>
          Strictly verified sources from last 48 hours.
        </div>
      </div>
      </center>
    </body>
    </html>
  `;
};

const generateEmailText = (data: any) => {
  let text = `HAJIMI DAILY\nDATE: ${new Date().toLocaleDateString()}\n\n`;
  const processSection = (title: string, items: any[]) => {
    text += `=== ${title} ===\n\n`;
    items.forEach((item, index) => {
      text += `${index + 1}. ${item.title}\n`;
      text += `[${item.ai_score}] ${item.ai_score_reason}\n`;
      if (item.xhs_titles) {
          item.xhs_titles.forEach((t: string) => text += `  ⚡ ${t}\n`);
      }
      text += `摘要: ${item.summary_cn}\n`;
      text += `Link: ${item.source_url}\n\n`;
    });
  };
  processSection("GLOBAL", data.social || []);
  processSection("HEALTH", data.health || []);
  text += "\n----------------\nGenerated by Hajimi Automation\n";
  return text;
};

export async function POST(request: Request) {
  try {
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) return NextResponse.json({ error: 'Missing Mailer API Key' }, { status: 500 });
    const resend = new Resend(resendApiKey);

    const body = await request.json();
    const { recipients, digestData } = body;

    if (!recipients || !digestData) return NextResponse.json({ error: 'Missing data' }, { status: 400 });

    const htmlContent = generateEmailHtml(digestData);
    const textContent = generateEmailText(digestData);
    const subjectLine = `Hajimi Daily #${new Date().toISOString().split('T')[0]}`;

    console.log(`Sending to ${recipients.length} recipients...`);

    const results = [];
    for (const recipientEmail of recipients) {
        try {
            const { data, error } = await resend.emails.send({
                from: 'Hajimi <digest@misaki1.de5.net>', 
                to: [recipientEmail], 
                subject: subjectLine,
                html: htmlContent,
                text: textContent,
                headers: { 'X-Entity-Ref-ID': generateId() }
            });
            results.push({ email: recipientEmail, status: error ? 'failed' : 'success', id: data?.id, error });
        } catch (e: any) {
            results.push({ email: recipientEmail, status: 'error', message: e.message });
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    return NextResponse.json({ success: true, details: results });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
