import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

// Whitelisted Claude Code headers
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
    const { apiKey, baseUrl, model, messages, stream = true } = body;

    // Fallback to environment variables
    const finalApiKey = apiKey || process.env.AGENTROUTER_API_KEY;
    const finalBaseUrl = (baseUrl || process.env.AGENTROUTER_BASE_URL || 'https://agentrouter.org').trim().replace(/\/+$/, '');

    if (!finalApiKey) {
      return NextResponse.json({ error: 'API key is required.' }, { status: 400 });
    }

    // Determine if it is a Claude model
    const isClaudeModel = model.startsWith('claude-');

    if (isClaudeModel) {
      // Configuration Method 1: Anthropic Messages endpoint
      const targetUrl = `${finalBaseUrl}/v1/messages`;

      // Format messages: extract system messages to root parameter
      const systemMessages = messages.filter((m: any) => m.role === 'system');
      const systemPrompt = systemMessages.map((m: any) => m.content).join('\n\n');
      
      const chatMessages = messages.filter((m: any) => m.role !== 'system').map((m: any) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }));

      const headers = {
        'content-type': 'application/json',
        'x-api-key': finalApiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'interleaved-thinking-2025-05-14,redact-thinking-2026-02-12,context-management-2025-06-27,prompt-caching-scope-2026-01-05,claude-code',
        ...CLAUDE_CLI_HEADERS,
      };

      const payload = {
        model,
        messages: chatMessages,
        system: systemPrompt || undefined,
        max_tokens: 4000,
        stream,
      };

      const response = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return NextResponse.json(
          { error: `AgentRouter Anthropic API Error (${response.status}): ${errorText}` },
          { status: response.status }
        );
      }

      if (stream) {
        return new NextResponse(response.body, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'X-Accel-Buffering': 'no',
          },
        });
      } else {
        const data = await response.json();
        const text = data.content?.[0]?.text || '';
        return NextResponse.json({
          choices: [{
            message: { role: 'assistant', content: text },
            finish_reason: 'stop'
          }]
        });
      }
    } else {
      // Configuration Method 2: OpenAI Compatible route
      // Ensure target URL ends with /v1 or appropriate path
      let targetUrl = finalBaseUrl;
      if (!targetUrl.includes('/v1')) {
        targetUrl = `${targetUrl}/v1`;
      }
      targetUrl = `${targetUrl}/chat/completions`;

      const headers = {
        'content-type': 'application/json',
        'Authorization': `Bearer ${finalApiKey}`,
        ...CLAUDE_CLI_HEADERS,
      };

      const response = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages,
          stream,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return NextResponse.json(
          { error: `AgentRouter OpenAI API Error (${response.status}): ${errorText}` },
          { status: response.status }
        );
      }

      if (stream) {
        return new NextResponse(response.body, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'X-Accel-Buffering': 'no',
          },
        });
      } else {
        const data = await response.json();
        return NextResponse.json(data);
      }
    }
  } catch (error: any) {
    console.error('Error in chat proxy route:', error);
    return NextResponse.json(
      { error: `Internal Server Error: ${error.message || error}` },
      { status: 500 }
    );
  }
}
