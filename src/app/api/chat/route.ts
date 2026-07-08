import { NextRequest, NextResponse } from 'next/server';

// Edge Runtime uses Vercel's edge network (not datacenter Node.js IPs)
// which bypasses the Alibaba WAF that was blocking serverless function IPs.
export const runtime = 'edge';

const CLAUDE_CLI_HEADERS = {
  'User-Agent': 'claude-cli/2.1.119 (external, cli)',
  'x-stainless-arch': 'x64',
  'x-stainless-lang': 'js',
  'x-stainless-os': 'win32',
  'x-stainless-runtime': 'node',
  'x-stainless-runtime-version': '24.12.0',
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKey, baseUrl, model, messages } = body;

    const finalApiKey = apiKey || process.env.AGENTROUTER_API_KEY;
    if (!finalApiKey) {
      return NextResponse.json({ error: 'API key is required.' }, { status: 400 });
    }

    let cleanBaseUrl = (baseUrl || process.env.AGENTROUTER_BASE_URL || 'https://agentrouter.org').trim();
    if (!cleanBaseUrl.startsWith('http')) cleanBaseUrl = 'https://' + cleanBaseUrl;
    cleanBaseUrl = cleanBaseUrl.replace(/\/+$/, '');
    const apiBase = cleanBaseUrl.endsWith('/v1') ? cleanBaseUrl : `${cleanBaseUrl}/v1`;

    const isClaudeModel = (model as string).startsWith('claude-');

    let upstreamResponse: Response;

    if (isClaudeModel) {
      const systemMessages = (messages as any[]).filter(m => m.role === 'system');
      const systemPrompt = systemMessages.map(m => m.content).join('\n\n');
      const chatMessages = (messages as any[])
        .filter(m => m.role !== 'system' && m.content?.trim())
        .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

      upstreamResponse = await fetch(`${apiBase}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': finalApiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'interleaved-thinking-2025-05-14,redact-thinking-2026-02-12,context-management-2025-06-27,prompt-caching-scope-2026-01-05,claude-code',
          ...CLAUDE_CLI_HEADERS,
        },
        body: JSON.stringify({
          model,
          messages: chatMessages,
          ...(systemPrompt ? { system: systemPrompt } : {}),
          max_tokens: 4000,
          stream: false,
        }),
      });
    } else {
      const chatMessages = (messages as any[]).filter(m => m.content?.trim());
      upstreamResponse = await fetch(`${apiBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Authorization': `Bearer ${finalApiKey}`,
          ...CLAUDE_CLI_HEADERS,
        },
        body: JSON.stringify({ model, messages: chatMessages, stream: false }),
      });
    }

    const responseText = await upstreamResponse.text();

    // Detect WAF HTML response (contains Alibaba WAF markers)
    if (responseText.includes('aliyun_waf') || responseText.includes('aliyunCaptcha') || responseText.startsWith('<!doctype')) {
      return NextResponse.json(
        { error: 'Request blocked by upstream WAF. Please check agentrouter.org status or contact support.' },
        { status: 503 }
      );
    }

    if (!upstreamResponse.ok) {
      return NextResponse.json(
        { error: `API Error ${upstreamResponse.status}: ${responseText}` },
        { status: upstreamResponse.status }
      );
    }

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      return NextResponse.json(
        { error: `Unexpected response from API: ${responseText.slice(0, 300)}` },
        { status: 502 }
      );
    }

    if (isClaudeModel) {
      const text = data.content?.find((b: any) => b.type === 'text')?.text || '';
      return NextResponse.json({
        choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }]
      });
    }

    return NextResponse.json(data);

  } catch (error: any) {
    return NextResponse.json(
      { error: `Server Error: ${error.message || String(error)}` },
      { status: 500 }
    );
  }
}
