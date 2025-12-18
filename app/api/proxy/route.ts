
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

    const isStreamRequest = method?.toUpperCase() === 'POST' && body?.stream === true;

    if (!isStreamRequest) {
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

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        
        try {
          const upstreamRes = await fetch(targetUrl, {
            method: 'POST',
            headers: headers || {},
            body: JSON.stringify(body),
          });

          if (!upstreamRes.ok) {
            const errText = await upstreamRes.text();
            // 将上游的错误包装成 SSE 错误事件发送
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
