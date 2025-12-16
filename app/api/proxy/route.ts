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

    // --- 核心修改：使用 SSE (Server-Sent Events) 保持连接活跃 ---
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        
        // 1. 立即发送首字节，满足 Vercel Edge 的 TTFB 要求
        controller.enqueue(encoder.encode(": start_stream\n\n"));
        
        // Add a micro-delay to ensure headers are flushed to client before we potentially block on fetch
        await new Promise(r => setTimeout(r, 50));

        // 2. 设置心跳定时器 (每 3 秒发送一次注释行) - Increased frequency
        const intervalId = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          } catch (e) {
            clearInterval(intervalId);
          }
        }, 3000);

        try {
          console.log(`[Edge Proxy] Starting Long-Poll Fetch: ${targetUrl}`);
          
          const upstreamRes = await fetch(targetUrl, {
            method: method || 'POST',
            headers: headers || {},
            body: body ? JSON.stringify(body) : undefined,
          });

          // 收到上游响应后，停止心跳
          clearInterval(intervalId);

          if (!upstreamRes.ok) {
            const errText = await upstreamRes.text();
            // Try to parse error as JSON if possible to make it cleaner
            let errDataStr;
            try {
                const errJson = JSON.parse(errText);
                errDataStr = JSON.stringify(errJson);
            } catch {
                errDataStr = JSON.stringify({ error: `Upstream ${upstreamRes.status}: ${errText}` });
            }
            controller.enqueue(encoder.encode(`event: error\ndata: ${errDataStr}\n\n`));
          } else {
            const result = await upstreamRes.text();
            // IMPORTANT: If result is empty, send explicit empty JSON string to prevent client "null" concatenation
            const safeResult = result || "{}"; 
            
            // 将整个 JSON 响应作为字符串再次序列化
            const safePayload = JSON.stringify(safeResult);
            controller.enqueue(encoder.encode(`data: ${safePayload}\n\n`));
          }
        } catch (err: any) {
           clearInterval(intervalId);
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