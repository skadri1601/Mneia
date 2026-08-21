import type { ErasedToolDefinition } from './registry.js';
import { assertTool } from './tools/assert.js';
import { checkpointTool } from './tools/checkpoint.js';
import { handoffCreateTool, handoffInboxTool, handoffReceiveTool } from './tools/handoff.js';
import { rehydrateTool } from './tools/rehydrate.js';
import { retireTool } from './tools/retire.js';
import { searchTool } from './tools/search.js';
import { sessionsTool } from './tools/sessions.js';
import { teamTool } from './tools/team.js';

export const LINKED_TOOLS: readonly ErasedToolDefinition[] = [
  rehydrateTool,
  assertTool,
  retireTool,
  checkpointTool,
  searchTool,
  handoffCreateTool,
  handoffReceiveTool,
  handoffInboxTool,
  teamTool,
  sessionsTool,
];
