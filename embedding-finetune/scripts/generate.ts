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

const model = new ChatAnthropic({
  model: "claude-3-haiku-20240307",
  temperature: 0,
  maxConcurrency: 10,
});

const syntheticStrong = await Bun.file(
  "scripts/scratch/synthetic_strong.md"
).text();
const syntheticWeak = await Bun.file(
  "scripts/scratch/synthetic_weak.md"
).text();
const syntheticWeakv2 = await Bun.file(
  "scripts/scratch/synthetic_weakv2.md"
).text();

/**
 * Build the chat prompt given a few-shot synthetic template
 */
async function buildSyntheticTemplate(
  syntheticTemplate: string
): Promise<ChatPromptTemplate> {
  const [system, human1, ai1, human2, ai2] =
    extractMarkdownCodeBlocks(syntheticTemplate);
  return new ChatPromptTemplate({
    promptMessages: [
      new SystemMessage(system),
      new HumanMessage(human1),
      new AIMessage(ai1),
      new HumanMessage(human2),
      new AIMessage(ai2),
      HumanMessagePromptTemplate.fromTemplate(
        `<reference id="{id}">\n<metadata>\n{metadata}\n</metadata>\n<text>\n{text}\n</text>\n</reference>`
      ),
    ],
    inputVariables: ["text", "metadata", "id"],
  });
}

async function buildSyntheticv2Template(
  syntheticTemplate: string
): Promise<ChatPromptTemplate> {
  const [system, human1, ai1, human2, ai2] =
    extractMarkdownCodeBlocks(syntheticTemplate);
  return new ChatPromptTemplate({
    promptMessages: [
      new SystemMessage(system),
      new HumanMessage(human1),
      new AIMessage(ai1),
      new HumanMessage(human2),
      new AIMessage(ai2),
      HumanMessagePromptTemplate.fromTemplate(`{text}`),
    ],
    inputVariables: ["text"],
  });
}

const strongTemplate = await buildSyntheticTemplate(syntheticStrong);
const weakTemplate = await buildSyntheticTemplate(syntheticWeak);
const weakv2Template = await buildSyntheticv2Template(syntheticWeakv2);

export interface SummaryEntry {
  text: string;
  metadata: Record<string, string>;
  file: string;
}

interface DataEntry {
  input: string;
  output: string;
  file: string;
}

export async function generateNoteSample(
  metadata: Record<string, string>,
  text: string,
  id: string
): Promise<[string, string]> {
  const strongMessages = await strongTemplate.formatMessages({
    metadata: JSON.stringify(metadata, null, 2),
    text,
    id,
  });
  const weakMessages = await weakTemplate.formatMessages({
    metadata: JSON.stringify(metadata, null, 2),
    text,
    id,
  });

  const [strongResponse, weakResponse] = await Promise.all([
    model.invoke(strongMessages),
    model.invoke(weakMessages),
  ]);
  return [strongResponse.content.toString(), weakResponse.content.toString()];
}

export async function generateWeakv2Sample(text: string): Promise<string> {
  const weakv2Messages = await weakv2Template.formatMessages({
    text,
  });

  const weakv2Response = await model.invoke(weakv2Messages);
  return weakv2Response.content.toString();
}

/**
 * Generate synthetic samples for all notes in the summaries directory
 */
export async function generateNoteSamples() {
  const summaries = await readDataDir<SummaryEntry>("summaries");

  forEachAsync(summaries, async ({ text, metadata, file }, i) => {
    console.log(`Processing entry ${i++} / ${summaries.length}...`);
    if (existsSync(`data/synthetic/strong/${file}`)) {
      console.log(`Skipping ${file} as it already exists...`);
      return;
    }

    const id = file.slice(0, file.length - ".json".length);
    const input = `<reference id="${id}">\n<metadata>\n${JSON.stringify(
      metadata,
      null,
      2
    )}\n</metadata>\n<text>\n${text}\n</text>\n</reference>`;

    const [strong, weak] = await generateNoteSample(metadata, text, id);

    await Bun.write(
      `data/synthetic/strong/${file}`,
      JSON.stringify({ input, output: strong }, null, 2)
    );
    await Bun.write(
      `data/synthetic/weak/${file}`,
      JSON.stringify({ input, output: weak }, null, 2)
    );
  });
}

/**
 * Generate synthetic samples for all notes based on masked summaries
 */
export async function generateWeakv2Samples() {
  const summaries = await readDataDir<DataEntry>("masked");

  forEachAsync(summaries, async ({ output: text, file }, i) => {
    console.log(`Processing entry ${i++} / ${summaries.length}...`);
    if (existsSync(`data/synthetic/weakv2/${file}`)) {
      console.log(`Skipping ${file} as it already exists...`);
      return;
    }

    const weakv2 = await generateWeakv2Sample(text);
    await Bun.write(
      `data/synthetic/weakv2/${file}`,
      JSON.stringify({ input: text, output: weakv2 }, null, 2)
    );
  });
}
