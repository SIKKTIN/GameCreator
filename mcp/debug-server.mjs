#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { scanConstDirectory } from '../server/lua-enum-parser.mjs';

const tools = [
  { name: 'scan_const_directory', description: '扫描 Lua 枚举目录并返回文件、组、成员、排序数组和动态 ID 信息。', inputSchema: { type: 'object', properties: { projectPath: { type: 'string' }, enumPath: { type: 'string' } }, required: ['projectPath', 'enumPath'] } },
  { name: 'inspect_path', description: '检查本地工程目录和枚举目录是否存在，并列出 Lua 文件。', inputSchema: { type: 'object', properties: { projectPath: { type: 'string' }, enumPath: { type: 'string' } }, required: ['projectPath', 'enumPath'] } },
];

const result = (id, value) => ({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] } });
const error = (id, message) => ({ jsonrpc: '2.0', id, error: { code: -32000, message } });

async function inspectPath(projectPath, enumPath) {
  const root = path.resolve(projectPath);
  const directory = path.resolve(root, enumPath);
  const files = (await fs.readdir(directory, { withFileTypes: true })).filter((item) => item.isFile() && item.name.endsWith('.lua')).map((item) => item.name).sort();
  return { projectPath: root, enumPath: directory, projectExists: true, enumDirectoryExists: true, luaFiles: files, fileCount: files.length };
}

async function callTool(name, args) {
  if (name === 'scan_const_directory') return await scanConstDirectory(args.projectPath, args.enumPath);
  if (name === 'inspect_path') return await inspectPath(args.projectPath, args.enumPath);
  throw new Error(`未知调试工具: ${name}`);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let request;
  try { request = JSON.parse(line); } catch { process.stdout.write(JSON.stringify(error(null, '无效 JSON')) + '\n'); return; }
  if (request.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'gamecreator-debug', version: '0.1.0' } } }) + '\n');
  } else if (request.method === 'tools/list') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { tools } }) + '\n');
  } else if (request.method === 'tools/call') {
    try { process.stdout.write(JSON.stringify(result(request.id, await callTool(request.params?.name, request.params?.arguments ?? {}))) + '\n'); }
    catch (err) { process.stdout.write(JSON.stringify(error(request.id, err instanceof Error ? err.message : '调试工具执行失败')) + '\n'); }
  } else if (request.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {} }) + '\n');
});
