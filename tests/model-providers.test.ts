import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ModelProviderClient,
  ModelProviderError,
  type ModelProtocol,
} from '@graph-native/core';

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

  it('does not send API keys to non-local plaintext endpoints', () => {
    expect(() => client('openai-compatible', 'http://provider.example/v1')).toThrow(
      expect.objectContaining({ code: 'invalid_configuration' }),
    );
  });
});
