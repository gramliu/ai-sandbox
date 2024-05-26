import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { Ollama } from "@langchain/community/llms/ollama";
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
} from "@langchain/core/prompts";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getTokenCount, summarizeDocuments } from "./lib/summarizeDocuments";
import samplePaper from "./scratch/sample.json"
import { forEachAsync, readDataDir } from "./lib/utils";

interface PdfEntry {
  key: string;
  url: string;
  metadata: Record<string, string>;
  text: string[];
}

interface SummaryEntry {
  text: string;
  file: string;
  metadata: Record<string, string>;
}

const ollama = new Ollama({
  baseUrl: "http://localhost:11434",
  model: "llama3",
});

const summaryPrompt = `You are an expert in summarizing academic papers. 
Your goal is to create a summary of an academic paper parsed from a PDF.
Make sure to include the key findings, highlights, and keywords from the text.

Additionally, the academic paper will also be used as the basis for future blogs and articles.
Provide some example questions and answers that could be asked about the paper and how it could be used or applied.
Make these questions very specific.

Your final output should be a summary of the paper, keywords, and a list of example questions the user
could ask about the paper, formatted in Markdown text.`;

const reducePrompt = `You are an expert in summarizing academic papers.
We have provided some partial summaries covering some parts of a paper.
Your goal is to create a consolidated summary of the paper.
Make sure to include the key findings, highlights, and keywords from the text.

Additionally, the academic paper will also be used as the basis for future blogs and articles.
Provide some example questions and answers that could be asked about the paper and how it could be used or applied.
Make these questions very specific.

Your final output should be a summary of the paper, keywords, and a list of example questions the user
could ask about the paper, formatted in Markdown text.`;

const sampleMetadata = JSON.stringify(samplePaper.metadata, null, 2);
const sampleText = samplePaper.text;
const sampleSummary = samplePaper.summary;

const summaryPromptTemplate = new ChatPromptTemplate({
  promptMessages: [
    new SystemMessage(summaryPrompt),
    new HumanMessage(`<metadata>\n${sampleMetadata}\n</metadata>\n<text>\n${sampleText}</text>`),
    new AIMessage(sampleSummary),
    HumanMessagePromptTemplate.fromTemplate(
      "<metadata>\n{metadata}\n</metadata>\n<text>\n{text}</text>"
    ),
  ],
  inputVariables: ["text", "metadata"],
});

const reducePromptTemplate = new ChatPromptTemplate({
  promptMessages: [
    new SystemMessage(reducePrompt),
    new HumanMessage(`<metadata>\n${sampleMetadata}\n</metadata>\n<text>\n${sampleText}</text>`),
    new AIMessage(sampleSummary),
    HumanMessagePromptTemplate.fromTemplate(
      "<metadata>\n{metadata}\n</metadata>\n<text>\n{text}</text>"
    ),
  ],
  inputVariables: ["text", "metadata"],
});

async function summarizeFile(entry: PdfEntry) {
  const documents = entry.text.map((text) => ({
    text,
    metadata: entry.metadata ?? {},
  }));
  console.log("Summarizing PDF", entry.metadata?.title);
  return summarizeDocuments(documents, {
    mapPrompt: summaryPromptTemplate,
    reducePrompt: reducePromptTemplate,
    maxTokens: 80_000,
  });
}

export async function summarizePdfs() {
  const entries = await readDataDir<PdfEntry>("pdfs");
  for (const entry of entries) {
    const { key } = entry;
    console.log("Summarizing", key);
    if (existsSync(`data/summaries/${key}.json`)) {
      console.log(`Skipping ${key} as it already exists...`);
      continue;
    }
    const summary = await summarizeFile(entry);
    await Bun.write(
      `data/summaries/${entry.key}.json`,
      JSON.stringify(summary, null, 2)
    );
  }
}

export async function findSmallest() {
  const files = await readdir("data/pdfs");
  const entries: { key: string, textTokens: number, summaryTokens: number }[] = await Promise.all(
    files.map(async (file) => {
      const base: PdfEntry = await Bun.file(`data/pdfs/${file}`).json()
      const summary: SummaryEntry = await Bun.file(`data/summaries/${file}`).json()
      const [textTokens, summaryTokens] = await Promise.all([
        getTokenCount(base.text.join(" ")),
        getTokenCount(summary.text),
      ]);
      return { key: base.key, textTokens, summaryTokens };
    })
  );
  entries.sort((a, b) => (a.textTokens + a.summaryTokens) - (b.textTokens + b.summaryTokens));
  for (const entry of entries.slice(0, 5)) {
    console.log(entry.key, entry.textTokens + entry.summaryTokens, entry.textTokens, entry.summaryTokens);
  }
}

export async function getTotalSummaryTokens() {
  const files = await readDataDir<SummaryEntry>("summaries");
  const tokens = await forEachAsync(files, ({ text }) => getTokenCount(text));
  console.log(tokens.reduce((a, b) => a + b, 0));
}