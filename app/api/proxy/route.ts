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
    // 即使上游 Gemini 在“思考”或“搜索”导致长时间不返回数据，
    // 我们也会每秒发送一个心跳包 (: keep-alive)，防止 Vercel 认为连接超时 (504)。
    
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        
        // 1. 立即发送首字节，满足 Vercel Edge 的 TTFB 要求
        controller.enqueue(encoder.encode(": start_stream\n\n"));

        // 2. 设置心跳定时器 (每 5 秒发送一次注释行)
        // SSE 协议中以冒号开头的行是注释，客户端会忽略，但能保持连接
        const intervalId = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          } catch (e) {
            // 如果连接已关闭，停止定时器
            clearInterval(intervalId);
          }
        }, 5000);

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
            // 发送错误事件
            const errData = JSON.stringify({ error: `Upstream ${upstreamRes.status}: ${errText}` });
            controller.enqueue(encoder.encode(`event: error\ndata: ${errData}\n\n`));
          } else {
            // 读取完整响应文本
            const result = await upstreamRes.text();
            
            // 将整个 JSON 响应作为字符串再次序列化，确保它占用 SSE 的一行 data
            // 客户端收到后需要进行两次解析：JSON.parse(sseData) -> jsonString -> JSON.parse(jsonString) -> object
            const safePayload = JSON.stringify(result);
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