import { NextRequest, NextResponse } from 'next/server';

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
    const { apiKey, baseUrl, model, messages } = body;

    // API key check
    const finalApiKey = apiKey || process.env.AGENTROUTER_API_KEY;
    if (!finalApiKey) {
      return NextResponse.json({ error: 'API key is required.' }, { status: 400 });
    }

    // Normalize Base URL
    let cleanBaseUrl = (baseUrl || process.env.AGENTROUTER_BASE_URL || 'https://agentrouter.org').trim();
    if (!cleanBaseUrl.startsWith('http://') && !cleanBaseUrl.startsWith('https://')) {
      cleanBaseUrl = 'https://' + cleanBaseUrl;
    }
    cleanBaseUrl = cleanBaseUrl.replace(/\/+$/, '');

    // Ensure exactly one /v1 suffix
    let apiBase = cleanBaseUrl;
    if (!apiBase.endsWith('/v1')) {
      apiBase = `${apiBase}/v1`;
    }

    const isClaudeModel = model.startsWith('claude-');

    if (isClaudeModel) {
      const targetUrl = `${apiBase}/messages`;

      const systemMessages = messages.filter((m: any) => m.role === 'system');
      const systemPrompt = systemMessages.map((m: any) => m.content).join('\n\n');
      const chatMessages = messages
        .filter((m: any) => m.role !== 'system')
        .filter((m: any) => m.content && m.content.trim() !== '')
        .map((m: any) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        }));

      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': finalApiKey,
          'anthropic-version': '2023-06-01',
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

      const responseText = await response.text();

      if (!response.ok) {
        return NextResponse.json(
          { error: `API Error ${response.status}: ${responseText}` },
          { status: response.status }
        );
      }

      let data: any;
      try {
        data = JSON.parse(responseText);
      } catch {
        return NextResponse.json({ error: `Unexpected response: ${responseText}` }, { status: 502 });
      }

      const text = data.content?.find((b: any) => b.type === 'text')?.text || '';
      return NextResponse.json({
        choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }]
      });

    } else {
      const targetUrl = `${apiBase}/chat/completions`;

      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Authorization': `Bearer ${finalApiKey}`,
          ...CLAUDE_CLI_HEADERS,
        },
        body: JSON.stringify({ model, messages, stream: false }),
      });

      const responseText = await response.text();

      if (!response.ok) {
        return NextResponse.json(
          { error: `API Error ${response.status}: ${responseText}` },
          { status: response.status }
        );
      }

      let data: any;
      try {
        data = JSON.parse(responseText);
      } catch {
        return NextResponse.json({ error: `Unexpected response: ${responseText}` }, { status: 502 });
      }

      return NextResponse.json(data);
    }

  } catch (error: any) {
    return NextResponse.json(
      { error: `Server Error: ${error.message || String(error)}` },
      { status: 500 }
    );
  }
}
