import { NextResponse } from 'next/server';

// 切换回默认的 Node.js Runtime，它比 Edge Runtime 支持更长的执行时间
// export const runtime = 'edge'; // REMOVED

// 尝试将超时时间设置为 Vercel Hobby 层的最大允许值 (通常是 10s 或 60s，取决于具体环境)
// Pro 用户可以支持更长
export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

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

    console.log(`[Node Proxy] Forwarding ${method || 'GET'} to: ${targetUrl}`);

    // 2. 发起后端请求 (Node.js fetch)
    const upstreamResponse = await fetch(targetUrl, {
      method: method || 'GET',
      headers: headers || {},
      body: body ? JSON.stringify(body) : undefined,
    });

    // 3. 处理响应
    const responseText = await upstreamResponse.text();
    
    // 尝试解析 JSON，如果失败则返回 null，后续直接返回文本
    let responseJson;
    try {
        responseJson = JSON.parse(responseText);
    } catch {
        responseJson = null;
    }

    if (!upstreamResponse.ok) {
        console.error(`[Upstream Error] ${upstreamResponse.status}:`, responseText.slice(0, 200));
        return NextResponse.json(
            responseJson || { error: responseText || upstreamResponse.statusText }, 
            { status: upstreamResponse.status }
        );
    }

    // 成功返回
    return NextResponse.json(responseJson || { data: responseText });

  } catch (error: any) {
    console.error('[Node Proxy Internal Error]', error);
    return NextResponse.json(
        { 
            error: 'Proxy Error: ' + error.message,
            hint: '如果是 504 Gateway Timeout，说明模型生成时间超过了 Vercel Serverless Function 的限制 (通常免费版为 10-60秒)。' 
        }, 
        { status: 500 }
    );
  }
}