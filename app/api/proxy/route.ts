import { NextResponse } from 'next/server';

// --- 核心修改：切换到 Edge Runtime ---
// Edge Runtime 没有 10s/60s 的执行时间限制，只要连接保持活跃（Streaming）即可
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
    // 1. 解析请求体
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

    console.log(`[Edge Proxy] Forwarding to: ${targetUrl}`);

    // 2. 发起后端请求 (Edge fetch)
    const upstreamResponse = await fetch(targetUrl, {
      method: method || 'POST',
      headers: headers || {},
      body: body ? JSON.stringify(body) : undefined,
    });

    // 3. 关键修改：直接透传 Stream (流)
    // 我们不再使用 await upstreamResponse.text() 等待整个响应，
    // 而是直接把 upstreamResponse.body (ReadableStream) 传回给客户端。
    // 这样可以绕过 Vercel 的 60秒 响应超时限制。
    
    // 复制需要的 Headers
    const responseHeaders = new Headers();
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    
    // 传递 Content-Type (通常是 application/json 或 text/event-stream)
    const contentType = upstreamResponse.headers.get('Content-Type');
    if (contentType) {
        responseHeaders.set('Content-Type', contentType);
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders
    });

  } catch (error: any) {
    console.error('[Edge Proxy Internal Error]', error);
    return NextResponse.json(
        { error: 'Edge Proxy Error: ' + error.message }, 
        { status: 500 }
    );
  }
}