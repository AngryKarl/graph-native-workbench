import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ModelProviderClient,
  ModelProviderError,
  type ModelProtocol,
} from '@graphwork/core';

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

async function fakeProvider(
  handler: (request: IncomingMessage, response: ServerResponse, payload: Record<string, unknown>) => void,
): Promise<string> {
  const server = createServer(async (request, response) => handler(request, response, await body(request)));
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fake provider did not bind a TCP port.');
  return `http://127.0.0.1:${address.port}`;
}

function client(protocol: ModelProtocol, baseUrl: string, apiKey = 'test-secret') {
  return new ModelProviderClient({ id: 'test', label: 'Test provider', protocol, baseUrl, apiKey });
}

describe('model provider protocols', () => {
  const tools = [{ id: 'source.search', description: 'Search approved sources.' }];

  it('normalizes OpenAI-compatible chat output and usage', async () => {
    const baseUrl = await fakeProvider((request, response, payload) => {
      expect(request.url).toBe('/v1/chat/completions');
      expect(request.headers.authorization).toBe('Bearer test-secret');
      expect(payload).toMatchObject({ model: 'test-chat', stream: false });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        id: 'chat-1',
        model: 'test-chat-resolved',
        choices: [{ message: { role: 'assistant', content: '{"answer":"ready"}' } }],
        usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      }));
    });
    const result = await client('openai-compatible', `${baseUrl}/v1`).generate({
      model: 'test-chat',
      prompt: 'health check',
    });
    expect(result.text).toBe('{"answer":"ready"}');
    expect(result.usage).toMatchObject({
      providerId: 'test',
      protocol: 'openai-compatible',
      model: 'test-chat-resolved',
      inputTokens: 7,
      outputTokens: 3,
      totalTokens: 10,
      requestId: 'chat-1',
    });
    expect(JSON.stringify(result)).not.toContain('test-secret');
  });

  it('round-trips OpenAI-compatible tool calls', async () => {
    let round = 0;
    const baseUrl = await fakeProvider((_request, response, payload) => {
      round += 1;
      const messages = payload.messages as Array<Record<string, unknown>>;
      if (round === 1) {
        expect(payload.tools).toEqual([expect.objectContaining({
          function: expect.objectContaining({ name: 'graphwork_tool_1' }),
        })]);
        response.end(JSON.stringify({
          id: 'chat-tool-1',
          choices: [{ message: { content: null, tool_calls: [{
            id: 'call-1',
            type: 'function',
            function: { name: 'graphwork_tool_1', arguments: '{"query":"graphs"}' },
          }] } }],
        }));
        return;
      }
      expect(messages.at(-2)).toMatchObject({ role: 'assistant', tool_calls: [expect.objectContaining({ id: 'call-1' })] });
      expect(messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call-1', content: '{"items":["result"]}' });
      response.end(JSON.stringify({
        id: 'chat-tool-2',
        choices: [{ message: { content: '{"answer":"done"}' } }],
      }));
    });
    const provider = client('openai-compatible', baseUrl);
    const first = await provider.generate({ model: 'test', prompt: 'research', tools });
    expect(first.toolCalls).toEqual([{ id: 'call-1', toolId: 'source.search', input: { query: 'graphs' } }]);
    const second = await provider.generate({
      model: 'test',
      prompt: 'research',
      tools,
      exchanges: [{
        text: first.text,
        calls: first.toolCalls,
        results: [{ callId: 'call-1', toolId: 'source.search', output: { items: ['result'] } }],
      }],
    });
    expect(second.text).toBe('{"answer":"done"}');
  });

  it('normalizes Anthropic Messages output and headers', async () => {
    const baseUrl = await fakeProvider((request, response, payload) => {
      expect(request.url).toBe('/v1/messages');
      expect(request.headers['x-api-key']).toBe('test-secret');
      expect(request.headers['anthropic-version']).toBe('2023-06-01');
      expect(payload).toMatchObject({ model: 'test-claude', max_tokens: 64 });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        id: 'msg-1',
        model: 'test-claude-resolved',
        content: [{ type: 'text', text: 'ready' }],
        usage: { input_tokens: 5, output_tokens: 1 },
      }));
    });
    const result = await client('anthropic-messages', `${baseUrl}/v1`).generate({
      model: 'test-claude',
      prompt: 'health check',
      maxOutputTokens: 64,
    });
    expect(result.text).toBe('ready');
    expect(result.usage).toMatchObject({ inputTokens: 5, outputTokens: 1, totalTokens: 6 });
  });

  it('round-trips Anthropic tool use blocks', async () => {
    let round = 0;
    const baseUrl = await fakeProvider((_request, response, payload) => {
      round += 1;
      const messages = payload.messages as Array<Record<string, unknown>>;
      if (round === 1) {
        expect(payload.tools).toEqual([expect.objectContaining({ name: 'graphwork_tool_1' })]);
        response.end(JSON.stringify({
          id: 'message-tool-1',
          content: [{ type: 'tool_use', id: 'use-1', name: 'graphwork_tool_1', input: { query: 'graphs' } }],
          usage: { input_tokens: 4, output_tokens: 2 },
        }));
        return;
      }
      expect(messages.at(-2)).toMatchObject({ role: 'assistant', content: [expect.objectContaining({ type: 'tool_use', id: 'use-1' })] });
      expect(messages.at(-1)).toMatchObject({ role: 'user', content: [expect.objectContaining({ type: 'tool_result', tool_use_id: 'use-1' })] });
      response.end(JSON.stringify({ id: 'message-tool-2', content: [{ type: 'text', text: '{"answer":"done"}' }] }));
    });
    const provider = client('anthropic-messages', baseUrl);
    const first = await provider.generate({ model: 'test', prompt: 'research', tools });
    expect(first.toolCalls).toEqual([{ id: 'use-1', toolId: 'source.search', input: { query: 'graphs' } }]);
    const second = await provider.generate({
      model: 'test', prompt: 'research', tools,
      exchanges: [{ text: '', calls: first.toolCalls, results: [{ callId: 'use-1', toolId: 'source.search', output: 'result' }] }],
    });
    expect(second.text).toBe('{"answer":"done"}');
  });

  it('normalizes Gemini GenerateContent output and headers', async () => {
    const baseUrl = await fakeProvider((request, response, payload) => {
      expect(request.url).toBe('/v1beta/models/test-gemini:generateContent');
      expect(request.headers['x-goog-api-key']).toBe('test-secret');
      expect(payload).toMatchObject({
        generationConfig: { responseMimeType: 'application/json' },
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        responseId: 'gemini-1',
        modelVersion: 'test-gemini-resolved',
        candidates: [{ content: { parts: [{ text: 'ready' }] } }],
        usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1, totalTokenCount: 5 },
      }));
    });
    const result = await client('gemini-generate-content', `${baseUrl}/v1beta`).generate({
      model: 'test-gemini',
      prompt: 'health check',
    });
    expect(result.text).toBe('ready');
    expect(result.usage).toMatchObject({
      model: 'test-gemini-resolved',
      requestId: 'gemini-1',
      totalTokens: 5,
    });
  });

  it('round-trips Gemini function calls and responses', async () => {
    let round = 0;
    const baseUrl = await fakeProvider((_request, response, payload) => {
      round += 1;
      const contents = payload.contents as Array<Record<string, unknown>>;
      if (round === 1) {
        expect(payload.tools).toEqual([{ functionDeclarations: [expect.objectContaining({ name: 'graphwork_tool_1' })] }]);
        response.end(JSON.stringify({
          responseId: 'gemini-tool-1',
          candidates: [{ content: { parts: [{ functionCall: { name: 'graphwork_tool_1', args: { query: 'graphs' } } }] } }],
        }));
        return;
      }
      expect(contents.at(-2)).toMatchObject({ role: 'model', parts: [expect.objectContaining({ functionCall: expect.any(Object) })] });
      expect(contents.at(-1)).toMatchObject({ role: 'user', parts: [expect.objectContaining({ functionResponse: expect.any(Object) })] });
      response.end(JSON.stringify({
        responseId: 'gemini-tool-2',
        candidates: [{ content: { parts: [{ text: '{"answer":"done"}' }] } }],
      }));
    });
    const provider = client('gemini-generate-content', baseUrl);
    const first = await provider.generate({ model: 'test', prompt: 'research', tools });
    expect(first.toolCalls).toEqual([{
      id: 'gemini-tool-1:1', toolId: 'source.search', input: { query: 'graphs' },
    }]);
    const second = await provider.generate({
      model: 'test', prompt: 'research', tools,
      exchanges: [{ text: '', calls: first.toolCalls, results: [{ callId: first.toolCalls[0]!.id, toolId: 'source.search', output: 'result' }] }],
    });
    expect(second.text).toBe('{"answer":"done"}');
  });

  it('returns a stable authentication error without exposing credentials', async () => {
    const baseUrl = await fakeProvider((_request, response) => {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'invalid credential test-secret' } }));
    });
    const failure = client('openai-compatible', baseUrl).generate({ model: 'test', prompt: 'hello' });
    await expect(failure).rejects.toMatchObject({
      code: 'authentication',
      providerId: 'test',
      status: 401,
    });
    await expect(failure).rejects.not.toThrow(/test-secret/);
  });

  it('aborts oversized model-provider responses', async () => {
    const baseUrl = await fakeProvider((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      for (let index = 0; index < 33; index += 1) response.write(Buffer.alloc(64 * 1024));
      response.end();
    });
    await expect(client('openai-compatible', baseUrl).generate({
      model: 'test',
      prompt: 'hello',
    })).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('does not send API keys to non-local plaintext endpoints', () => {
    expect(() => client('openai-compatible', 'http://provider.example/v1')).toThrow(
      expect.objectContaining({ code: 'invalid_configuration' }),
    );
  });

  it('rejects credentials embedded in provider URLs', () => {
    expect(() => client('openai-compatible', 'https://user:password@provider.example/v1'))
      .toThrow(expect.objectContaining({ code: 'invalid_configuration' }));
  });
});
