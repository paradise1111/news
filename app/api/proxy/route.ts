
import { NextResponse } from 'next/server';

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

    // 判断是否需要流式处理：只有 POST 请求且明确开启了 stream 模式
    const isStreamRequest = method?.toUpperCase() === 'POST' && body?.stream === true;

    if (!isStreamRequest) {
      // --- 非流式普通请求 (GET /models 等) ---
      console.log(`[Edge Proxy] Simple Fetch: ${targetUrl}`);
      const simpleRes = await fetch(targetUrl, {
        method: method || 'GET',
        headers: headers || {},
        body: body ? JSON.stringify(body) : undefined,
      });

      const resBody = await simpleRes.arrayBuffer();
      const resHeaders = new Headers(simpleRes.headers);
      resHeaders.set('Access-Control-Allow-Origin', '*');

      return new Response(resBody, {
        status: simpleRes.status,
        headers: resHeaders
      });
    }

    // --- 流式请求 (Chat Completions) ---
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(": start_stream\n\n"));
        
        let intervalId: any = null;
        try {
          console.log(`[Edge Proxy] Stream Fetching: ${targetUrl}`);
          intervalId = setInterval(() => {
             try { controller.enqueue(encoder.encode(": keep-alive\n\n")); } catch { /* ignore */ }
          }, 5000);

          const upstreamRes = await fetch(targetUrl, {
            method: 'POST',
            headers: headers || {},
            body: JSON.stringify(body),
          });

          if (intervalId) clearInterval(intervalId);

          if (!upstreamRes.ok) {
            const errText = await upstreamRes.text();
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: errText })}\n\n`));
            controller.close();
            return;
          }

          if (upstreamRes.body) {
              const reader = upstreamRes.body.getReader();
              while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  controller.enqueue(value);
              }
          }
        } catch (err: any) {
           if (intervalId) clearInterval(intervalId);
           controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`));
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
