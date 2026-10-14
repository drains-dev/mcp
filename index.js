#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import * as z from 'zod/v4'

const API_URL = process.env.DRAINS_API_URL
const API_TOKEN = process.env.DRAINS_API_TOKEN

if (!API_URL || !API_TOKEN) {
  console.error('DRAINS_API_URL and DRAINS_API_TOKEN must both be set.')
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

const server = new McpServer({
  name: 'skunkworks-logs',
  version: '0.1.0',
  // Surfaced to the model in the MCP initialize response — most clients
  // (including Claude) feed this to the model as context on how to use
  // the server, so this is the actual place to document conventions the
  // tool descriptions alone don't cover (id formats, entry text syntax).
  instructions: `
Full read/write access to this account's drains, same as signing in via the
browser — except editing or deleting an entry only works on entries this
account originally created (mirrors what a real signed-in user could do).

Entry/drain ids returned by any tool here are always the bare id with no
"entry:"/"drain-" storage prefix — pass them back exactly as given to other
tools (e.g. entryId from list_entries straight into summarize_day).

Entry content is plain text, but two inline conventions render as real,
clickable pills once saved — write them exactly like this:
- "@user@example.com" mentions a person (must look like a real email).
- "[[dbName]]" references another drain; "[[dbName#entryId]]" references a
  specific entry (entryId is what list_entries/append_entry returned).
There is no existence check on either at write time — an invalid reference
just renders as a broken/locked pill later, not an error now.
`.trim(),
})

server.registerTool(
  'list_drains',
  { description: 'List the drains (logs) this account belongs to.', inputSchema: z.object({}) },
  async () => text(await api('GET', '/api/drains'))
)

server.registerTool(
  'create_drain',
  {
    description: 'Create a new drain. It starts private and becomes shared when someone is invited (invite_member).',
    inputSchema: z.object({
      title: z.string(),
      // Ignored by the server since sharing is derived from membership; kept
      // optional so older prompts that still pass it don't fail validation.
      visibility: z.enum(['private', 'shared']).optional(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }),
  },
  async (args) => text(await api('POST', '/api/drains', args))
)

server.registerTool(
  'update_drain',
  {
    description: 'Update a drain\'s title, description, or tags. Any member can update; only set the fields being changed.',
    inputSchema: z.object({
      dbName: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }),
  },
  async ({ dbName, ...meta }) => text(await api('PATCH', `/api/drains/${dbName}`, meta))
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
  'list_members',
  {
    description: 'List the email addresses with access to a shared drain.',
    inputSchema: z.object({ dbName: z.string() }),
  },
  async ({ dbName }) => text(await api('GET', `/api/drains/${dbName}/members`))
)

server.registerTool(
  'remove_member',
  {
    description: "Remove someone's access to a shared drain. Owner-only; the owner can't remove themselves this way.",
    inputSchema: z.object({ dbName: z.string(), email: z.string() }),
  },
  async ({ dbName, email }) => text(await api('DELETE', `/api/drains/${dbName}/members`, { email }))
)

server.registerTool(
  'list_entries',
  {
    description: 'List entries in a drain, newest first. Each entry includes `streams` (the stream slugs it is filed in). Use `before` (an entry id from the previous page) to paginate.',
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
    description:
      'Add a new log entry to a drain, attributed to this account. Write "@user@example.com" to mention someone or "[[dbName]]"/"[[dbName#entryId]]" to reference another drain/entry — both render as real pills, see server instructions for the exact syntax. Pass `streams` (names, e.g. ["HCI"]) to file it into streams — topics inside the drain; missing streams are created. Check list_streams first and reuse existing names.',
    inputSchema: z.object({ dbName: z.string(), content: z.string(), streams: z.array(z.string()).max(10).optional() }),
  },
  async ({ dbName, content, streams }) => text(await api('POST', `/api/drains/${dbName}/entries`, { content, streams }))
)

server.registerTool(
  'list_streams',
  {
    description:
      "List a drain's streams (topics within it) with how many entries each has. Use before append_entry so new entries go into an existing stream instead of a near-duplicate.",
    inputSchema: z.object({ dbName: z.string() }),
  },
  async ({ dbName }) => text(await api('GET', `/api/drains/${dbName}/streams`))
)

server.registerTool(
  'edit_entry',
  {
    description:
      "Edit an existing entry. Only works on entries this account originally created. Same @mention/[[reference]] syntax as append_entry applies.",
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
