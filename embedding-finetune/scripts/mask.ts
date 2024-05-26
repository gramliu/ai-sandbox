import { ChatAnthropic } from "@langchain/anthropic";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
} from "@langchain/core/prompts";
import { existsSync } from "node:fs";
import {
  extractMarkdownCodeBlocks,
  forEachAsync,
  readDataDir,
} from "./lib/utils";
import { ChatOpenAI } from "langchain/chat_models/openai";

const model = new ChatOpenAI({
  model: "gpt-4o",
  temperature: 0,
  maxConcurrency: 10,
});

const prompt = `You will be provided with a long summary of a research paper. Please read it carefully. Then, write a brief 4-5 sentences talking about the general field that the paper explores. Do not mention any specific names of new algorithms, methods, or terms that the paper introduces. Instead, describe the concepts in general terms only. For example, if the paper introduces a new method called "WebArena", do not mention "WebArena" anywhere in your brief summary.

FOCUS on methods rather than names and terms.

Write your brief summary inside <summary> tags.`;

const promptTemplate = new ChatPromptTemplate({
  promptMessages: [
    new SystemMessage(prompt),
    HumanMessagePromptTemplate.fromTemplate(
      `<reference id="{id}">\n<metadata>\n{metadata}\n</metadata>\n<text>\n{text}\n</text>\n</reference>`
    ),
  ],
  inputVariables: ["text", "metadata", "id"],
});

interface SummaryEntry {
  text: string;
  metadata: Record<string, string>;
  file: string;
}

async function generateMaskedSummary(
  metadata: Record<string, string>,
  text: string,
  id: string
): Promise<string> {
  const messages = await promptTemplate.formatMessages({
    metadata: JSON.stringify(metadata, null, 2),
    text,
    id,
  });

  const response = await model.invoke(messages);
  return response.content.toString();
}

/**
 * Generate masked summaries of notes (with specific keywords stripped)
 */
export async function generateMaskedSummaries() {
  const summaries = await readDataDir<SummaryEntry>("summaries");

  forEachAsync(summaries, async ({ text, metadata, file }, i) => {
    console.log(`Processing entry ${i++} / ${summaries.length}...`);
    if (existsSync(`data/masked/${file}`)) {
      console.log(`Skipping ${file} as it already exists...`);
      return;
    }

    const id = file.slice(0, file.length - ".json".length);
    const input = `<reference id="${id}">\n<metadata>\n${JSON.stringify(
      metadata,
      null,
      2
    )}\n</metadata>\n<text>\n${text}\n</text>\n</reference>`;
    const summary = await generateMaskedSummary(metadata, text, id);
    await Bun.write(
      `data/masked/${file}`,
      JSON.stringify({ input, output: summary }, null, 2)
    );
  });
}
