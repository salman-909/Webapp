import { NextRequest, NextResponse } from 'next/server';

// Run on standard Serverless Node.js runtime for full outbound compatibility and reliable web streaming
export const runtime = 'nodejs';
// Force dynamic rendering to prevent Next.js from caching event streams
export const dynamic = 'force-dynamic';

// Mimic VS Code Cline headers to bypass datacenter blocking policies on AI proxy gateways
const CLAUDE_CLI_HEADERS = {
  'User-Agent': 'cline',
  'HTTP-Referer': 'https://github.com/cline/cline',
  'Referer': 'https://github.com/cline/cline',
  'X-Title': 'Cline',
};

// Translate Anthropic SSE events into standard OpenAI choices/delta SSE events
async function* translateAnthropicStream(responseBody: ReadableStream<Uint8Array>) {
  if (!responseBody) return;
  let reader;
  
  try {
    reader = responseBody.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('data:')) {
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') continue;

          try {
            const data = JSON.parse(dataStr);
            if (data.type === 'content_block_delta' && data.delta?.text) {
              const token = data.delta.text;
              // Construct OpenAI SSE compatible line
              const openAiLine = `data: ${JSON.stringify({
                choices: [{ delta: { content: token } }]
              })}\n\n`;
              yield encoder.encode(openAiLine);
            }
          } catch (e) {
            // Ignore parsing errors for partial lines
          }
        }
      }
    }
    yield encoder.encode('data: [DONE]\n\n');
  } catch (err) {
    console.error('Error translating stream:', err);
  } finally {
    if (reader) {
      try {
        reader.releaseLock();
      } catch (e) {}
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKey, baseUrl, model, messages, stream = true } = body;

    // Fallback to environment variables
    const finalApiKey = apiKey || process.env.AGENTROUTER_API_KEY;
    
    // Normalize Base URL: remove trailing slashes
    let finalBaseUrl = (baseUrl || process.env.AGENTROUTER_BASE_URL || 'https://agentrouter.org').trim().replace(/\/+$/, '');
    
    // If the base URL ends with /v1, strip it so we can append endpoints consistently
    if (finalBaseUrl.endsWith('/v1')) {
      finalBaseUrl = finalBaseUrl.slice(0, -3);
    }

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
        if (!response.body) {
          return NextResponse.json({ error: 'Response body from AgentRouter is empty.' }, { status: 500 });
        }

        // Stream translation: convert Anthropic format to OpenAI compatible format
        const transformedStream = new ReadableStream({
          async start(controller) {
            try {
              for await (const chunk of translateAnthropicStream(response.body!)) {
                controller.enqueue(chunk);
              }
            } catch (err) {
              console.error('Error in transformedStream start:', err);
            } finally {
              controller.close();
            }
          },
        });

        return new NextResponse(transformedStream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
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
      const targetUrl = `${finalBaseUrl}/v1/chat/completions`;

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
        if (!response.body) {
          return NextResponse.json({ error: 'Response body from AgentRouter is empty.' }, { status: 500 });
        }
        return new NextResponse(response.body, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
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
