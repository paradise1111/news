import { NextResponse } from 'next/server';

// 切换到 Edge Runtime 以支持流式传输
export const runtime = 'edge';

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function POST(req: Request) {
  try {
    const bodyText = await req.text();
    let payload;
    try {
        payload = JSON.parse(bodyText);
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { targetUrl, method, headers, body } = payload;

    if (!targetUrl) {
      return NextResponse.json({ error: 'Missing targetUrl parameter' }, { status: 400 });
    }

    // --- 核心修改：流式透传与心跳保活 ---
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        
        // 1. 立即发送首字节，满足 Vercel Edge 的 TTFB 要求，防止立即超时
        controller.enqueue(encoder.encode(": start_stream\n\n"));
        
        // 用于控制心跳的定时器
        // In Edge runtime, setInterval returns a number, not NodeJS.Timeout
        let intervalId: any = null;

        try {
          console.log(`[Edge Proxy] Fetching: ${targetUrl} (Stream Mode)`);
          
          // 启动心跳 (每 5 秒一次)，防止在 fetch 等待期间连接断开
          intervalId = setInterval(() => {
             try { controller.enqueue(encoder.encode(": keep-alive\n\n")); } catch { /* ignore */ }
          }, 5000);

          const upstreamRes = await fetch(targetUrl, {
            method: method || 'POST',
            headers: headers || {},
            body: body ? JSON.stringify(body) : undefined,
          });

          // 收到响应头后，清除心跳，准备传输真实数据
          if (intervalId) clearInterval(intervalId);

          if (!upstreamRes.ok) {
            const errText = await upstreamRes.text();
            let errDataStr;
            try {
                const errJson = JSON.parse(errText);
                errDataStr = JSON.stringify(errJson);
            } catch {
                errDataStr = JSON.stringify({ error: `Upstream ${upstreamRes.status}: ${errText}` });
            }
            controller.enqueue(encoder.encode(`event: error\ndata: ${errDataStr}\n\n`));
            controller.close();
            return;
          }

          // 2. 处理上游响应
          const contentType = upstreamRes.headers.get('content-type') || '';
          
          if (contentType.includes('text/event-stream') && upstreamRes.body) {
              // --- 情况 A: 上游也是流式 (Streaming) ---
              // 直接管道透传，这是解决 524 错误的关键
              const reader = upstreamRes.body.getReader();
              while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  controller.enqueue(value);
              }
          } else {
              // --- 情况 B: 上游是普通 JSON (Non-Streaming) ---
              // 等待全部接收并包装成 SSE 发送
              const text = await upstreamRes.text();
              // 我们手动伪造一个 SSE 事件，让前端统一用一种方式解析
              const fakeSse = `data: ${JSON.stringify(text)}\n\n`; 
              controller.enqueue(encoder.encode(fakeSse));
          }

        } catch (err: any) {
           if (intervalId) clearInterval(intervalId);
           const errData = JSON.stringify({ error: 'Proxy Fetch Error: ' + err.message });
           controller.enqueue(encoder.encode(`event: error\ndata: ${errData}\n\n`));
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error: any) {
    console.error('[Proxy Init Error]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}