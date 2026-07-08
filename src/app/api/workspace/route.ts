import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

// Define the root of the workspace
const WORKSPACE_ROOT = process.cwd();

// Helper function to recursively read files in a directory
async function getFiles(dir: string, baseDir: string = ''): Promise<{ name: string; path: string }[]> {
  const absoluteDir = path.join(WORKSPACE_ROOT, baseDir);
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  
  let files: { name: string; path: string }[] = [];

  const ignoreList = [
    'node_modules',
    '.next',
    '.git',
    'package-lock.json',
    '.env',
    '.env.local',
    'favicon.ico',
    '.gitattributes',
  ];

  for (const entry of entries) {
    if (ignoreList.includes(entry.name)) {
      continue;
    }

    const relativePath = baseDir ? `${baseDir}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const subFiles = await getFiles(dir, relativePath);
      files = files.concat(subFiles);
    } else {
      files.push({
        name: entry.name,
        path: relativePath,
      });
    }
  }

  return files;
}

export async function GET() {
  try {
    const files = await getFiles(WORKSPACE_ROOT);
    return NextResponse.json({ files });
  } catch (error: any) {
    console.error('Error listing files:', error);
    return NextResponse.json({ error: 'Failed to list workspace files' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { filePath } = body;

    if (!filePath) {
      return NextResponse.json({ error: 'filePath is required' }, { status: 400 });
    }

    // Security check: ensure filePath is within the workspace directory
    const resolvedPath = path.resolve(WORKSPACE_ROOT, filePath);
    if (!resolvedPath.startsWith(WORKSPACE_ROOT)) {
      return NextResponse.json({ error: 'Access denied: Path is outside workspace.' }, { status: 403 });
    }

    // Check if file exists
    try {
      const stats = await fs.stat(resolvedPath);
      if (!stats.isFile()) {
        return NextResponse.json({ error: 'Path is not a file.' }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: 'File does not exist.' }, { status: 404 });
    }

    // Read file contents (limit length to prevent context explosion if it's too large, say 100KB)
    const content = await fs.readFile(resolvedPath, 'utf-8');
    const stats = await fs.stat(resolvedPath);
    
    return NextResponse.json({
      name: path.basename(resolvedPath),
      path: filePath,
      size: stats.size,
      content: content,
    });
  } catch (error: any) {
    console.error('Error reading file:', error);
    return NextResponse.json({ error: `Failed to read file: ${error.message || error}` }, { status: 500 });
  }
}
