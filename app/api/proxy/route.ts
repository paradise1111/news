import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    // 1. 解析前端传来的请求参数
    const { url, method, headers, body } = await req.json();

    if (!url) {
      return NextResponse.json({ error: "Missing URL parameter" }, { status: 400 });
    }

    // 2. 由 Next.js 服务端发起实际请求 (服务端无 CORS 限制)
    console.log(`[Server Proxy] Forwarding ${method} request to: ${url}`);
    
    const upstreamResponse = await fetch(url, {
      method: method || 'GET',
      headers: headers || {},
      body: body ? JSON.stringify(body) : undefined,
    });

    // 3. 读取上游响应
    const textData = await upstreamResponse.text();
    
    let jsonData;
    try {
        jsonData = JSON.parse(textData);
    } catch (e) {
        // 如果返回的不是 JSON (比如 HTML 错误页)，则保留文本
        jsonData = null;
    }

    // 4. 将上游的状态码和数据原样返回给前端
    if (!upstreamResponse.ok) {
        console.error(`[Server Proxy Error] ${upstreamResponse.status} from upstream.`);
        return NextResponse.json(
            jsonData || { error: textData || upstreamResponse.statusText }, 
            { status: upstreamResponse.status }
        );
    }

    return NextResponse.json(jsonData || { data: textData });

  } catch (error: any) {
    console.error("[Server Proxy Internal Error]", error);
    return NextResponse.json({ error: `Proxy Connection Failed: ${error.message}` }, { status: 500 });
  }
}