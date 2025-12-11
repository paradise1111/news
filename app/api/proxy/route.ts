import { NextRequest, NextResponse } from 'next/server';

// 使用 Edge Runtime，速度更快，且支持标准的 Web Fetch API
export const runtime = 'edge';

// 处理预检请求 (CORS)
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

export async function POST(req: NextRequest) {
  try {
    // 1. 解析前端传来的数据
    const bodyText = await req.text();
    let payload;
    try {
        payload = JSON.parse(bodyText);
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { targetUrl, method, headers, body } = payload;

    if (!targetUrl) {
      return NextResponse.json({ error: 'Missing target URL parameter' }, { status: 400 });
    }

    console.log(`[Edge Proxy] ${method || 'GET'} -> ${targetUrl}`);

    // 2. 服务器端发起请求 (支持 HTTP 和 HTTPS)
    // Edge Runtime 的 fetch API 更加健壮
    const upstreamResponse = await fetch(targetUrl, {
      method: method || 'GET',
      headers: headers || {},
      body: body ? JSON.stringify(body) : undefined,
    });

    // 3. 获取结果 (先拿文本，防止 JSON 解析挂掉)
    const data = await upstreamResponse.text();

    // 4. 返回给前端
    return new NextResponse(data, {
      status: upstreamResponse.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*', // 再次确保前端能收到
      },
    });

  } catch (error: any) {
    console.error("[Edge Proxy Error]", error);
    return NextResponse.json(
        { error: 'Proxy Request Failed: ' + error.message }, 
        { 
            status: 500,
            headers: { 'Access-Control-Allow-Origin': '*' }
        }
    );
  }
}