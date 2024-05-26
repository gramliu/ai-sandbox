import { ChatAnthropic } from "@langchain/anthropic";
import { SystemMessage } from "@langchain/core/messages";
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
} from "@langchain/core/prompts";
import { readdir } from "node:fs/promises";
import { readDataDir } from "./lib/utils";
import { existsSync } from "node:fs";

interface DataEntry {
  input: string;
  output: string;
  file: string;
}

interface NoteReference {
  id: string;
  text: string;
}

const prompt = `You will be given a journal entry note and a list of references. Your task is to identify which references, if any, are relevant to the provided note.
Please carefully read the note and the list of references. Identify which references are directly related to or mentioned in the note. 
List out the relevant reference IDs, if any, inside <relevant_references> tags. Each reference should be enclosed in its own <reference> tags.
Use the following format:
<relevant_references>
  <reference id="ABC123"/>
  <reference id="DEF456"/>
  ...
</relevant_references>

Remember, a reference should only be considered relevant if it is directly related to or mentioned in the content of the journal entry note. Do not include references that are only tangentially or speculatively related.
Provide your answer inside <relevant_references> tags:`;

const promptTemplate = new ChatPromptTemplate({
  promptMessages: [
    new SystemMessage(prompt),
    HumanMessagePromptTemplate.fromTemplate(
      "<note>\n{note}\n</note>\n\n<references>\n{references}\n</references>"
    ),
  ],
  inputVariables: ["note", "references"],
});

const model = new ChatAnthropic({
  model: "claude-3-haiku-20240307",
  temperature: 0,
  maxConcurrency: 10,
});

function extractReferenceIds(xml: string): string[] {
  const regex = /<reference\s+id="([^"]+)"/g;
  const ids: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    ids.push(match[1]);
  }

  return ids;
}

/**
 * Identify references for a synthetic note
 */
async function identifyNoteReferences(
  references: NoteReference[],
  note: string
) {
  const referencesString = references
    .map(({ id, text }) => `<reference id="${id}">\n${text}\n</reference>`)
    .join("\n");
  const messages = await promptTemplate.formatMessages({
    note,
    references: referencesString,
  });
  const response = await model.invoke(messages);
  const rawResponse = response.content.toString();
  const ids = extractReferenceIds(rawResponse);
  return ids;
}

/**
 * Identify references for all synthetic notes
 */
export async function identifyReferences() {
  const syntheticEntries = await readDataDir<DataEntry>("references");

  const suffixLength = ".json".length;
  const references = syntheticEntries.map(({ input, file }) => ({
    id: file.slice(0, file.length - suffixLength),
    text: input,
  }));

  let i = 0;
  for (const { output: note, file } of syntheticEntries) {
    console.log(`Processing entry ${i++} / ${syntheticEntries.length}...`);
    if (existsSync(`data/synthetic/${file}`)) {
      console.log(`Skipping ${file} as it already exists...`);
      continue;
    }
    const ids = await identifyNoteReferences(references, note);
    const noteId = file.slice(0, file.length - suffixLength);
    if (!ids.includes(noteId)) {
      ids.push(noteId);
    }
    await Bun.write(
      `data/synthetic/${file}`,
      JSON.stringify({ note, references: ids }, null, 2)
    );
  }
}
