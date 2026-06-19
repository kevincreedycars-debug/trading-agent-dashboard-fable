import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const N8N_BASE_URL = process.env.N8N_BASE_URL;
const N8N_API_KEY = process.env.N8N_API_KEY;

if (!N8N_BASE_URL) {
  throw new Error('Missing required environment variable: N8N_BASE_URL');
}

if (!N8N_API_KEY) {
  throw new Error('Missing required environment variable: N8N_API_KEY');
}

function n8nUrl(path: string): string {
  const base = N8N_BASE_URL!.replace(/\/$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}/api/v1${cleanPath}`;
}

async function n8nRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(n8nUrl(path), {
    ...init,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'X-N8N-API-KEY': N8N_API_KEY!,
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  let body: unknown = text;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Keep body as text for diagnostics.
  }

  if (!response.ok) {
    throw new Error(`n8n API error ${response.status}: ${JSON.stringify(body)}`);
  }

  return body;
}

const server = new McpServer({
  name: 'trading-agent-n8n-mcp',
  version: '0.1.0',
});

server.tool(
  'n8n_list_workflows',
  'List workflows from the connected n8n workspace. Read-only.',
  {
    limit: z.number().int().positive().max(250).optional().describe('Maximum workflows to return.'),
  },
  async ({ limit }) => {
    const query = limit ? `?limit=${limit}` : '';
    const data = await n8nRequest(`/workflows${query}`);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }
);

server.tool(
  'n8n_get_workflow',
  'Fetch one workflow by n8n workflow ID. Read-only.',
  {
    workflowId: z.string().min(1).describe('The n8n workflow ID.'),
  },
  async ({ workflowId }) => {
    const data = await n8nRequest(`/workflows/${encodeURIComponent(workflowId)}`);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }
);

server.tool(
  'n8n_get_execution',
  'Fetch one n8n execution by execution ID. Read-only.',
  {
    executionId: z.string().min(1).describe('The n8n execution ID.'),
  },
  async ({ executionId }) => {
    const data = await n8nRequest(`/executions/${encodeURIComponent(executionId)}`);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }
);

server.tool(
  'n8n_list_executions',
  'List recent n8n executions. Read-only.',
  {
    limit: z.number().int().positive().max(100).optional().describe('Maximum executions to return.'),
  },
  async ({ limit }) => {
    const query = limit ? `?limit=${limit}` : '';
    const data = await n8nRequest(`/executions${query}`);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
