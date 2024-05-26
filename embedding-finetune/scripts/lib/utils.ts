import { readdir } from "node:fs/promises";

interface DataDirFile {
  file: string;
}

/**
 * Read all files from a data dir
 */
export async function readDataDir<T>(dir: string): Promise<(T & DataDirFile)[]> {
  const files = await readdir(`data/${dir}`);
  const entries: T[] = await Promise.all(
    files.map((file) =>
      Bun.file(`data/${dir}/${file}`)
        .json()
        .then((entry) => ({ ...entry, file }))
    )
  );
  return entries;
}

/**
 * Extract markdown code blocks from a single string
 */
export function extractMarkdownCodeBlocks(text: string): string[] {
  const codeBlockRegex = /```md([\s\S]*?)```/g;
  const codeBlocks: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const codeBlock = match[1].trim();
    codeBlocks.push(codeBlock);
  }

  return codeBlocks;
}

/**
 * Run a block of code for each item in an array asynchronously
 */
export async function forEachAsync<T, U>(data: T[], block: (item: T, index: number) => Promise<U>): Promise<U[]> {
  const results: U[] = [];
  for (let i = 0; i < data.length; i++) {
    const result = await block(data[i], i);
    results.push(result);
  }
  return results;
}