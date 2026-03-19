#!/usr/bin/env node
/**
 * Parse Server MCP Server
 *
 * Model Context Protocol (MCP) Server for Parse Server
 * Enables AI assistants (Claude, GPT, etc.) to interact with Parse Server databases
 *
 * Usage:
 *   parse-mcp              # Run in stdio mode (Claude Desktop)
 *   parse-mcp http         # Run in HTTP mode (Claude CLI)
 *   parse-mcp --help       # Show help
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';
import Parse from 'parse/node';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

// Determine mode from command line arguments
const args = process.argv.slice(2);
const mode = args[0] || 'stdio';
const showHelp = args.includes('--help') || args.includes('-h');

// Show help message
if (showHelp) {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║          Parse Server MCP Server v1.0.0                        ║
╠════════════════════════════════════════════════════════════════╣
║  Model Context Protocol Server for Parse Server                ║
║  Enables AI assistants to interact with Parse databases        ║
╚════════════════════════════════════════════════════════════════╝

USAGE:
  parse-mcp              Run in stdio mode (for Claude Desktop)
  parse-mcp http         Run in HTTP mode (for Claude CLI)
  parse-mcp --help       Show this help message

ENVIRONMENT VARIABLES:
  PARSE_SERVER_URL       URL of your Parse Server (with mount point)
  APP_ID                 Parse Application ID
  MASTER_KEY             Parse Master Key
  MCP_PORT               Port for HTTP mode (default: 3001)

EXAMPLES:
  # Stdio mode (Claude Desktop)
  parse-mcp

  # HTTP mode (Claude CLI)
  parse-mcp http

  # With custom port
  MCP_PORT=4000 parse-mcp http

DOCUMENTATION:
  https://github.com/fentastic/parse-server-mcp
`);
  process.exit(0);
}

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try to load .env from multiple locations
const envPaths = [
  path.join(__dirname, '.env'),
  path.join(__dirname, '../.env'),
  path.join(process.cwd(), '.env')
];

let envLoaded = false;
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    config({ path: envPath });
    envLoaded = true;
    console.log(`[Config] Loaded .env from: ${envPath}`);
    break;
  }
}

if (!envLoaded) {
  console.warn('[Config] Warning: No .env file found. Using environment variables or defaults.');
}

// Configuration
const PARSE_SERVER_URL = process.env.PARSE_SERVER_URL || 'http://localhost:1338/api';
const APP_ID = process.env.APP_ID || 'your_app_id';
const MASTER_KEY = process.env.MASTER_KEY || '';
const MCP_PORT = parseInt(process.env.MCP_PORT || '3001');
const PARSE_PROJECT_PATH = process.env.PARSE_PROJECT_PATH || null;

/**
 * Validaciones específicas de Parse Server
 */
const ParseValidator = {
  validateClassName(name) {
    if (!name || typeof name !== 'string') {
      throw new Error('Class name must be a non-empty string');
    }
    if (name.startsWith('_') && !['_User', '_Role', '_Session'].includes(name)) {
      throw new Error('Custom classes cannot start with underscore (_)');
    }
    if (name.length < 2 || name.length > 128) {
      throw new Error('Class name must be between 2 and 128 characters');
    }
    return true;
  },

  validateFieldName(name) {
    if (!name || typeof name !== 'string') {
      throw new Error('Field name must be a non-empty string');
    }
    if (name.startsWith('_')) {
      throw new Error('Field names cannot start with underscore (_)');
    }
    if (name.length < 1 || name.length > 128) {
      throw new Error('Field name must be between 1 and 128 characters');
    }
    const reserved = ['objectId', 'createdAt', 'updatedAt', 'ACL'];
    if (reserved.includes(name)) {
      throw new Error(`Field name "${name}" is reserved`);
    }
    return true;
  },

  validateFieldType(type) {
    const validTypes = ['String', 'Number', 'Boolean', 'Date', 'Array', 'Object',
                       'Pointer', 'Relation', 'File', 'GeoPoint', 'Polygon', 'Bytes'];
    if (!validTypes.includes(type)) {
      throw new Error(`Invalid field type "${type}"`);
    }
    return true;
  },

  validatePointerField(fieldDef) {
    if (fieldDef.type === 'Pointer' && !fieldDef.targetClass) {
      throw new Error('Pointer fields must specify targetClass');
    }
    return true;
  },

  validateRelationField(fieldDef) {
    if (fieldDef.type === 'Relation' && !fieldDef.targetClass) {
      throw new Error('Relation fields must specify targetClass');
    }
    return true;
  },

  validateSchema(schema) {
    this.validateClassName(schema.className);

    if (schema.fields) {
      for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
        this.validateFieldName(fieldName);
        this.validateFieldType(fieldDef.type);
        this.validatePointerField(fieldDef);
        this.validateRelationField(fieldDef);
      }
    }
    return true;
  },

  recommendRelationType(fromClass, toClass, description) {
    const desc = description.toLowerCase();

    if (desc.includes('many to many') ||
        desc.includes('belongs to many') ||
        desc.includes('collection of')) {
      return 'Relation';
    }

    if (desc.includes('belongs to') ||
        desc.includes('parent') ||
        desc.includes('owner') ||
        desc.includes('single')) {
      return 'Pointer';
    }

    return 'Pointer'; // Default
  }
};

/**
 * Cliente HTTP directo a Parse API
 */
class ParseAPIClient {
  constructor(serverUrl, appId, masterKey) {
    this.serverUrl = serverUrl;
    this.appId = appId;
    this.masterKey = masterKey;
  }

  async request(method, endpoint, body = null) {
    let urlString;

    if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
      urlString = endpoint;
    } else {
      const baseUrl = this.serverUrl.endsWith('/') ? this.serverUrl : this.serverUrl + '/';
      const path = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
      urlString = baseUrl + path;
    }

    const url = new URL(urlString);

    const options = {
      method,
      headers: {
        'X-Parse-Application-Id': this.appId,
        'X-Parse-Master-Key': this.masterKey,
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Parse API Error (${response.status}): ${text}`);
    }

    return JSON.parse(text);
  }

  async getSchemas() {
    const result = await this.request('GET', '/schemas');
    return result.results || [];
  }

  async getSchema(className) {
    const schemas = await this.getSchemas();
    return schemas.find(s => s.className === className);
  }

  async createSchema(className, schema) {
    ParseValidator.validateSchema({ className, ...schema });
    return await this.request('POST', '/schemas', { className, ...schema });
  }

  async updateSchema(className, schema) {
    ParseValidator.validateSchema({ className, ...schema });
    return await this.request('PUT', `/schemas/${className}`, { className, ...schema });
  }

  async deleteSchema(className) {
    return await this.request('DELETE', `/schemas/${className}`);
  }

  async query(className, where = {}, options = {}) {
    const params = new URLSearchParams();
    if (where && Object.keys(where).length > 0) {
      params.set('where', JSON.stringify(where));
    }
    if (options.limit) params.set('limit', options.limit);
    if (options.skip) params.set('skip', options.skip);
    if (options.order) params.set('order', options.order);
    if (options.include) params.set('include', options.include);
    if (options.keys) params.set('keys', options.keys);

    return await this.request('GET', `/classes/${className}?${params}`);
  }

  async createObject(className, data) {
    return await this.request('POST', `/classes/${className}`, data);
  }

  async getObject(className, objectId) {
    return await this.request('GET', `/classes/${className}/${objectId}`);
  }

  async updateObject(className, objectId, data) {
    return await this.request('PUT', `/classes/${className}/${objectId}`, data);
  }

  async deleteObject(className, objectId) {
    return await this.request('DELETE', `/classes/${className}/${objectId}`);
  }
}

// Initialize Parse
Parse.initialize(APP_ID, MASTER_KEY);
Parse.serverURL = PARSE_SERVER_URL;

// Create API client
const apiClient = new ParseAPIClient(PARSE_SERVER_URL, APP_ID, MASTER_KEY);

/**
 * MCP Tools Definition
 */
const TOOLS = [
  {
    name: 'parse_list_schemas',
    description: 'List all Parse Server classes with their fields and permissions',
    inputSchema: {
      type: 'object',
      properties: {
        includeSystem: {
          type: 'boolean',
          description: 'Include system classes (_User, _Role, _Session, etc.)',
          default: false
        }
      }
    }
  },

  {
    name: 'parse_get_schema',
    description: 'Get detailed schema information for a specific Parse class',
    inputSchema: {
      type: 'object',
      properties: {
        className: {
          type: 'string',
          description: 'Name of the Parse class (e.g., "Article", "User", "_Role")'
        }
      },
      required: ['className']
    }
  },

  {
    name: 'parse_create_schema',
    description: `
Create a new Parse Server class with proper validation.

PARSE SERVER RULES:
- Class names: PascalCase (e.g., "UserProfile")
- Field names: camelCase (e.g., "firstName")
- Pointer: Use for N:1 or 1:1 relationships
- Relation: Use for N:M relationships

CLP FORMAT:
{
  "find": { "*": true },
  "get": { "*": true },
  "create": { "role:Admin": true }
}
`.trim(),
    inputSchema: {
      type: 'object',
      properties: {
        className: {
          type: 'string',
          description: 'Class name in PascalCase'
        },
        fields: {
          type: 'object',
          description: 'Field definitions',
          additionalProperties: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['String', 'Number', 'Boolean', 'Date', 'Array', 'Object',
                       'Pointer', 'Relation', 'File', 'GeoPoint', 'Polygon', 'Bytes']
              },
              targetClass: { type: 'string' },
              required: { type: 'boolean' },
              defaultValue: {}
            },
            required: ['type']
          }
        },
        classLevelPermissions: {
          type: 'object',
          description: 'Class-level permissions (CLP)'
        },
        dryRun: {
          type: 'boolean',
          description: 'Validate without creating',
          default: false
        }
      },
      required: ['className', 'fields']
    }
  },

  {
    name: 'parse_update_schema',
    description: 'Update an existing Parse Server class schema',
    inputSchema: {
      type: 'object',
      properties: {
        className: {
          type: 'string',
          description: 'Class name in PascalCase'
        },
        fields: {
          type: 'object',
          description: 'Field definitions to add or update'
        },
        classLevelPermissions: {
          type: 'object',
          description: 'Class-level permissions (CLP) to update'
        }
      },
      required: ['className']
    }
  },

  {
    name: 'parse_query',
    description: 'Query objects from a Parse class with support for Pointer and Relation',
    inputSchema: {
      type: 'object',
      properties: {
        className: { type: 'string' },
        where: { type: 'object', default: {} },
        limit: { type: 'number', default: 100 },
        skip: { type: 'number', default: 0 },
        order: { type: 'string' },
        include: { type: 'string' },
        keys: { type: 'string' }
      },
      required: ['className']
    }
  },

  {
    name: 'parse_create_object',
    description: 'Create a new object in a Parse class',
    inputSchema: {
      type: 'object',
      properties: {
        className: { type: 'string' },
        data: { type: 'object' }
      },
      required: ['className', 'data']
    }
  },

  {
    name: 'parse_get_object',
    description: 'Get a specific object by ID from a Parse class',
    inputSchema: {
      type: 'object',
      properties: {
        className: { type: 'string' },
        objectId: { type: 'string' }
      },
      required: ['className', 'objectId']
    }
  },

  {
    name: 'parse_update_object',
    description: 'Update an existing object in a Parse class',
    inputSchema: {
      type: 'object',
      properties: {
        className: { type: 'string' },
        objectId: { type: 'string' },
        data: { type: 'object' }
      },
      required: ['className', 'objectId', 'data']
    }
  },

  {
    name: 'parse_delete_object',
    description: 'Delete an object from a Parse class',
    inputSchema: {
      type: 'object',
      properties: {
        className: { type: 'string' },
        objectId: { type: 'string' }
      },
      required: ['className', 'objectId']
    }
  },

  {
    name: 'parse_recommend_relation',
    description: 'Get AI recommendation for relationship type: Pointer vs Relation',
    inputSchema: {
      type: 'object',
      properties: {
        fromClass: { type: 'string' },
        toClass: { type: 'string' },
        description: { type: 'string' }
      },
      required: ['fromClass', 'toClass', 'description']
    }
  },

  {
    name: 'parse_validate_schema',
    description: 'Validate a Parse schema without creating it',
    inputSchema: {
      type: 'object',
      properties: {
        schema: {
          type: 'object',
          properties: {
            className: { type: 'string' },
            fields: { type: 'object' },
            classLevelPermissions: { type: 'object' }
          },
          required: ['className', 'fields']
        }
      },
      required: ['schema']
    }
  },

  {
    name: 'parse_create_migration',
    description: 'Generate a Parse Server migration file from a schema definition. If projectPath is provided or PARSE_PROJECT_PATH is set, the file will be created directly in the migrations folder.',
    inputSchema: {
      type: 'object',
      properties: {
        schema: {
          type: 'object',
          properties: {
            className: { type: 'string' },
            fields: { type: 'object' },
            classLevelPermissions: { type: 'object' }
          },
          required: ['className', 'fields']
        },
        migrationName: { type: 'string', description: 'Migration file name (e.g., "add_user_profile")' },
        projectPath: { type: 'string', description: 'Optional: Path to Parse Server project (overrides PARSE_PROJECT_PATH env var)' }
      },
      required: ['schema', 'migrationName']
    }
  }
];

/**
 * Tool Handlers
 */
const toolHandlers = {
  async parse_list_schemas(args) {
    const schemas = await apiClient.getSchemas();
    const filtered = args.includeSystem ? schemas : schemas.filter(s => !s.className.startsWith('_'));

    const formatted = filtered.map(schema => ({
      className: schema.className,
      fieldCount: Object.keys(schema.fields || {}).length,
      fields: Object.fromEntries(
        Object.entries(schema.fields || {}).map(([name, def]) => [
          name,
          { type: def.type, targetClass: def.targetClass, required: def.required }
        ])
      )
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ total: formatted.length, schemas: formatted }, null, 2)
      }]
    };
  },

  async parse_get_schema(args) {
    const schema = await apiClient.getSchema(args.className);
    if (!schema) {
      throw new Error(`Class "${args.className}" not found`);
    }

    const fields = {};
    const pointers = [];
    const relations = [];

    for (const [name, def] of Object.entries(schema.fields || {})) {
      fields[name] = { type: def.type, required: def.required };
      if (def.type === 'Pointer') pointers.push({ name, targetClass: def.targetClass });
      if (def.type === 'Relation') relations.push({ name, targetClass: def.targetClass });
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          className: schema.className,
          fields,
          pointers,
          relations,
          permissions: schema.classLevelPermissions || {}
        }, null, 2)
      }]
    };
  },

  async parse_create_schema(args) {
    if (args.dryRun) {
      ParseValidator.validateSchema(args);
      return {
        content: [{
          type: 'text',
          text: `✅ Schema validation passed for "${args.className}"\n\nDry run mode - not created.`
        }]
      };
    }

    await apiClient.createSchema(args.className, {
      fields: args.fields,
      classLevelPermissions: args.classLevelPermissions
    });

    return {
      content: [{
        type: 'text',
        text: `✅ Class "${args.className}" created successfully.`
      }]
    };
  },

  async parse_update_schema(args) {
    const updateData = {};
    if (args.fields) updateData.fields = args.fields;
    if (args.classLevelPermissions) updateData.classLevelPermissions = args.classLevelPermissions;

    await apiClient.updateSchema(args.className, updateData);

    return {
      content: [{
        type: 'text',
        text: `✅ Class "${args.className}" updated successfully.`
      }]
    };
  },

  async parse_query(args) {
    const result = await apiClient.query(args.className, args.where, {
      limit: args.limit,
      skip: args.skip,
      order: args.order,
      include: args.include,
      keys: args.keys
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          className: args.className,
          count: result.results?.length || 0,
          results: result.results || []
        }, null, 2)
      }]
    };
  },

  async parse_create_object(args) {
    const result = await apiClient.createObject(args.className, args.data);
    return {
      content: [{
        type: 'text',
        text: `✅ Object created in "${args.className}"\n\nobjectId: ${result.objectId}`
      }]
    };
  },

  async parse_get_object(args) {
    const result = await apiClient.getObject(args.className, args.objectId);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  },

  async parse_update_object(args) {
    await apiClient.updateObject(args.className, args.objectId, args.data);
    return {
      content: [{
        type: 'text',
        text: `✅ Object ${args.objectId} updated in "${args.className}"`
      }]
    };
  },

  async parse_delete_object(args) {
    await apiClient.deleteObject(args.className, args.objectId);
    return {
      content: [{
        type: 'text',
        text: `✅ Object ${args.objectId} deleted from "${args.className}"`
      }]
    };
  },

  async parse_recommend_relation(args) {
    const recommendation = ParseValidator.recommendRelationType(
      args.fromClass,
      args.toClass,
      args.description
    );

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          fromClass: args.fromClass,
          toClass: args.toClass,
          recommended: recommendation,
          reasoning: recommendation === 'Pointer'
            ? 'Use Pointer for N:1 or 1:1 relationships where one object "belongs to" another'
            : 'Use Relation for N:M relationships where objects can have many related objects on both sides'
        }, null, 2)
      }]
    };
  },

  async parse_validate_schema(args) {
    try {
      ParseValidator.validateSchema(args.schema);
      return {
        content: [{
          type: 'text',
          text: `✅ Schema validation PASSED for "${args.schema.className}"`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ Schema validation FAILED: ${error.message}`
        }]
      };
    }
  },

  async parse_create_migration(args) {
    const { schema, migrationName, projectPath: argProjectPath } = args;

    // Determine project path
    const projectPath = argProjectPath || PARSE_PROJECT_PATH;

    // Generate migration file content
    const timestamp = Date.now();
    const filename = `${timestamp}_${migrationName}.js`;

    const migrationContent = `/**
 * Parse Server Migration: ${migrationName}
 * Generated: ${new Date().toISOString()}
 */

'use strict';

module.exports = {
  description: '${migrationName}',

  async up({ createSchema, addField, addIndex }) {
    await createSchema('${schema.className}', {
      fields: ${JSON.stringify(schema.fields, null, 6)},
      classLevelPermissions: ${JSON.stringify(schema.classLevelPermissions || {}, null, 6)}
    });
  },

  async down({ deleteSchema }) {
    await deleteSchema('${schema.className}');
  }
};
`;

    // If project path is provided, write the file directly
    if (projectPath) {
      try {
        const migrationsDir = path.join(projectPath, 'migrations');

        // Create migrations directory if it doesn't exist
        if (!fs.existsSync(migrationsDir)) {
          fs.mkdirSync(migrationsDir, { recursive: true });
        }

        const filePath = path.join(migrationsDir, filename);
        fs.writeFileSync(filePath, migrationContent, 'utf8');

        return {
          content: [{
            type: 'text',
            text: `✅ Migration file created:\n\n📁 Path: ${filePath}\n\nTo run the migration:\n   cd ${projectPath}\n   npm run migrate`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `❌ Error creating migration file: ${error.message}\n\nHere is the content:\n\n${migrationContent}\n\nSave as: ${filename}`
          }]
        };
      }
    }

    // No project path provided, return content only
    return {
      content: [{
        type: 'text',
        text: `✅ Migration file generated:\n\n${migrationContent}\n\nSave as: migrations/${filename}\n\nTip: Set PARSE_PROJECT_PATH environment variable to create files automatically.`
      }]
    };
  }
};

/**
 * Stdio Mode - For Claude Desktop
 */
async function runStdioMode() {
  console.error('');
  console.error('╔════════════════════════════════════════════════════════════════╗');
  console.error('║          Parse Server MCP Server - Stdio Mode                 ║');
  console.error('╠════════════════════════════════════════════════════════════════╣');
  console.error(`║  Parse Server:     ${PARSE_SERVER_URL.padEnd(57)}║`);
  console.error(`║  App ID:           ${APP_ID.padEnd(57)}║`);
  console.error('╚════════════════════════════════════════════════════════════════╝');
  console.error('');

  const server = new Server(
    {
      name: 'parse-server-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(async (request) => {
    if (request.method === 'tools/list') {
      return { tools: TOOLS };
    }

    if (request.method === 'tools/call') {
      const { name, arguments: args } = request.params;
      const handler = toolHandlers[name];

      if (!handler) {
        throw new Error(`Unknown tool: ${name}`);
      }

      return await handler(args || {});
    }

    throw new Error('Unknown method');
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * HTTP Mode - For Claude CLI
 */
async function runHTTPMode() {
  const app = express();
  app.use(express.json());

  const server = new Server(
    {
      name: 'parse-server-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // SSE endpoint for MCP
  app.get('/sse', async (req, res) => {
    console.log('📡 New SSE connection');
    const transport = new SSEServerTransport('/messages', res);
    await server.connect(transport);
    console.log('✅ MCP Server connected via SSE');
  });

  // POST endpoint for MCP (for clients that don't use SSE)
  app.post('/mcp', async (req, res) => {
    const { method, params } = req.body;

    if (method === 'tools/list') {
      res.json({ tools: TOOLS });
    } else if (method === 'tools/call') {
      const { name, arguments: args } = params;
      const handler = toolHandlers[name];

      if (!handler) {
        return res.status(404).json({ error: `Unknown tool: ${name}` });
      }

      try {
        const result = await handler(args || {});
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    } else {
      res.status(400).json({ error: 'Unknown method' });
    }
  });

  // Health check
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      server: 'parse-server-mcp',
      version: '1.0.0',
      parse: {
        url: PARSE_SERVER_URL,
        appId: APP_ID
      }
    });
  });

  // Info endpoint
  app.get('/', (req, res) => {
    res.json({
      name: 'Parse Server MCP Server',
      version: '1.0.0',
      endpoints: {
        sse: '/sse',
        mcp: '/mcp',
        health: '/health'
      },
      tools: TOOLS.map(t => ({ name: t.name, description: t.description }))
    });
  });

  app.listen(MCP_PORT, () => {
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║          Parse Server MCP Server - HTTP Mode                  ║');
    console.log('╠════════════════════════════════════════════════════════════════╣');
    console.log(`║  Server running on: http://localhost:${MCP_PORT}                ║`);
    console.log(`║  SSE Endpoint:     http://localhost:${MCP_PORT}/sse               ║`);
    console.log(`║  MCP Endpoint:     http://localhost:${MCP_PORT}/mcp               ║`);
    console.log(`║  Health Check:     http://localhost:${MCP_PORT}/health            ║`);
    console.log('╠════════════════════════════════════════════════════════════════╣');
    console.log(`║  Parse Server:     ${PARSE_SERVER_URL}                          ║`);
    console.log(`║  App ID:           ${APP_ID}                                     ║`);
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');
  });
}

/**
 * Main entry point
 */
async function main() {
  try {
    if (mode === 'http') {
      await runHTTPMode();
    } else {
      await runStdioMode();
    }
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
