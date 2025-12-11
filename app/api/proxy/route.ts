import { NextResponse } from 'next/server';

// --- 核心修改：切换回 Node.js Runtime 并设置最大超时 ---
// Vercel Hobby 免费版限制：Node.js 函数最大执行时间为 60秒。
// 相比 Edge Runtime 的 25秒首字节限制 (TTFB)，Node.js 允许我们实打实地等 60秒。
// 只要 Gemini 在 60秒内返回结果，这个代理就能工作。
export const maxDuration = 60; 
export const dynamic = 'force-dynamic'; // 确保不被静态缓存

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

    console.log(`[Node Proxy] Forwarding to: ${targetUrl}`);

    // 2. 发起后端请求
    // 使用 Node.js 的 fetch 等待上游响应
    const upstreamResponse = await fetch(targetUrl, {
      method: method || 'POST',
      headers: headers || {},
      body: body ? JSON.stringify(body) : undefined,
    });

    // 3. 处理响应
    // 尽管是 Node.js 环境，我们依然可以使用 Response 透传 body，
    // 这样代码结构最简洁，且能兼容流式或普通 JSON 返回。
    
    // 复制需要的 Headers
    const responseHeaders = new Headers();
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    
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
    console.error('[Node Proxy Internal Error]', error);
    return NextResponse.json(
        { error: 'Node Proxy Error: ' + error.message }, 
        { status: 500 }
    );
  }
}