
import { NextResponse } from 'next/server';

export const runtime = 'nodejs'; // 切换为 nodejs 以支持更长的运行时间
export const maxDuration = 60;   // 设置最大时长为 60 秒

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

    const normalizedMethod = (method || 'GET').toUpperCase();
    const isStreamRequest = normalizedMethod === 'POST' && body?.stream === true;
    
    const finalBody = (normalizedMethod === 'GET' || normalizedMethod === 'HEAD') 
      ? undefined 
      : (body ? JSON.stringify(body) : undefined);

    if (!isStreamRequest) {
      const upstreamRes = await fetch(targetUrl, {
        method: normalizedMethod,
        headers: headers || {},
        body: finalBody,
      });

      if (!upstreamRes.ok) {
          const errorText = await upstreamRes.text();
          let errorJson;
          try {
              errorJson = JSON.parse(errorText);
          } catch {
              errorJson = { error: errorText };
          }
          return NextResponse.json(errorJson, { status: upstreamRes.status });
      }

      const resBody = await upstreamRes.arrayBuffer();
      const resHeaders = new Headers(upstreamRes.headers);
      resHeaders.set('Access-Control-Allow-Origin', '*');

      return new Response(resBody, {
        status: upstreamRes.status,
        headers: resHeaders
      });
    }

    // 处理流式请求
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        
        try {
          const upstreamRes = await fetch(targetUrl, {
            method: 'POST',
            headers: headers || {},
            body: finalBody,
          });

          if (!upstreamRes.ok) {
            const errText = await upstreamRes.text();
            controller.enqueue(encoder.encode(`event: error\ndata: ${errText}\n\n`));
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
