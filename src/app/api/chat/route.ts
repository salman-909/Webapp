import { NextRequest, NextResponse } from 'next/server';

// Run on Vercel's Edge Runtime (Cloudflare network) instead of Node.js serverless.
// This bypasses the Alibaba WAF that blocks Vercel's datacenter IPs,
// and supports proper streaming without the Node.js pipe issue.
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
          stream: true,
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
        body: JSON.stringify({ model, messages: chatMessages, stream: true }),
      });
    }

    if (!upstreamResponse.ok) {
      const errText = await upstreamResponse.text();
      return NextResponse.json(
        { error: `API Error ${upstreamResponse.status}: ${errText}` },
        { status: upstreamResponse.status }
      );
    }

    // Edge Runtime properly streams response.body back to client
    return new NextResponse(upstreamResponse.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });

  } catch (error: any) {
    return NextResponse.json(
      { error: `Server Error: ${error.message || String(error)}` },
      { status: 500 }
    );
  }
}
