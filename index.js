#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import * as z from 'zod/v4'

const API_URL = process.env.SKUNKWORKS_API_URL
const API_TOKEN = process.env.SKUNKWORKS_API_TOKEN

if (!API_URL || !API_TOKEN) {
  console.error('SKUNKWORKS_API_URL and SKUNKWORKS_API_TOKEN must both be set.')
  process.exit(1)
}

// Thin HTTP client over the app's own API — every tool here is a real
// account-level operation using the same Bearer-token auth path
// requireAuth.ts added for agents, so it has full read/write access, same
// as a signed-in user (except editing/deleting an entry, which is still
// author-only — enforced server-side, not by anything in this file).
async function api(method, path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

function text(value) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] }
}

const server = new McpServer({ name: 'skunkworks-logs', version: '0.1.0' })

server.registerTool(
  'list_drains',
  { description: 'List the drains (engineering logs) this account belongs to.', inputSchema: z.object({}) },
  async () => text(await api('GET', '/api/drains'))
)

server.registerTool(
  'create_drain',
  {
    description: 'Create a new drain.',
    inputSchema: z.object({
      title: z.string(),
      visibility: z.enum(['private', 'shared']),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }),
  },
  async (args) => text(await api('POST', '/api/drains', args))
)

server.registerTool(
  'invite_member',
  {
    description: "Invite someone (by email) to a shared drain. Owner-only.",
    inputSchema: z.object({ dbName: z.string(), email: z.string() }),
  },
  async ({ dbName, email }) => text(await api('POST', `/api/drains/${dbName}/invite`, { email }))
)

server.registerTool(
  'list_entries',
  {
    description: 'List entries in a drain, newest first. Use `before` (an entry id from the previous page) to paginate.',
    inputSchema: z.object({ dbName: z.string(), limit: z.number().optional(), before: z.string().optional() }),
  },
  async ({ dbName, limit, before }) => {
    const qs = new URLSearchParams({ ...(limit ? { limit: String(limit) } : {}), ...(before ? { before } : {}) })
    return text(await api('GET', `/api/drains/${dbName}/entries?${qs}`))
  }
)

server.registerTool(
  'append_entry',
  {
    description: 'Add a new log entry to a drain, attributed to this account.',
    inputSchema: z.object({ dbName: z.string(), content: z.string() }),
  },
  async ({ dbName, content }) => text(await api('POST', `/api/drains/${dbName}/entries`, { content }))
)

server.registerTool(
  'edit_entry',
  {
    description: "Edit an existing entry. Only works on entries this account originally created.",
    inputSchema: z.object({ dbName: z.string(), entryId: z.string(), content: z.string() }),
  },
  async ({ dbName, entryId, content }) =>
    text(await api('PATCH', `/api/drains/${dbName}/entries/${entryId}`, { content }))
)

server.registerTool(
  'delete_entry',
  {
    description: "Delete an entry. Only works on entries this account originally created.",
    inputSchema: z.object({ dbName: z.string(), entryId: z.string() }),
  },
  async ({ dbName, entryId }) => text(await api('DELETE', `/api/drains/${dbName}/entries/${entryId}`))
)

server.registerTool(
  'summarize_day',
  {
    description: 'Ask the AI to summarize a set of entries (e.g. one day) into a single posted summary entry.',
    inputSchema: z.object({ dbName: z.string(), entryIds: z.array(z.string()) }),
  },
  async ({ dbName, entryIds }) => text(await api('POST', `/api/drains/${dbName}/summarize`, { entryIds }))
)

const transport = new StdioServerTransport()
await server.connect(transport)
