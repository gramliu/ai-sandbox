import { ChatAnthropic } from "@langchain/anthropic";
import type { Callbacks } from "@langchain/core/callbacks/manager";
import { TraceGroup } from "@langchain/core/callbacks/manager";
import type { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";

interface SummarizeDocumentsParams {
  mapPrompt: ChatPromptTemplate;
  reducePrompt: ChatPromptTemplate;
  maxTokens?: number;
  callbacks?: Callbacks;
}

interface Document {
  metadata?: Record<string, string>;
  text: string;
}

const model = new ChatAnthropic({
  model: "claude-3-haiku-20240307",
  temperature: 0,
  maxConcurrency: 10,
});

const embeddingModel = new ChatOpenAI({
  model: "gpt-4-turbo",
});

/**
 * Summarize an individual document
 */
async function mapDocument(
  document: Document,
  mapPrompt: ChatPromptTemplate,
  callbacks?: Callbacks
): Promise<Document> {
  const messages = await mapPrompt.formatMessages({
    text: document.text,
    metadata: JSON.stringify(document.metadata),
  });
  const response = await model.invoke(messages, {
    callbacks,
    tags: ["mapDocument"],
  });

  // Extract summary
  return {
    metadata: document.metadata,
    text: response.content.toString(),
  };
}

/**
 * Reduce multiple documents into a single document
 */
async function reduceDocuments(
  documents: Document[],
  reducePrompt: ChatPromptTemplate,
  callbacks?: Callbacks
): Promise<Document> {
  const serializedDocuments = documents
    .map((document) => document.text)
    .join("\n\n-----------------\n\n");
  const messages = await reducePrompt.formatMessages({
    text: serializedDocuments,
    metadata: JSON.stringify(documents[0].metadata),
  });

  const response = await model.invoke(messages, {
    callbacks,
    tags: ["reduceDocuments"],
  });

  // Extract summary
  return {
    text: response.content.toString(),
    metadata: documents[0].metadata,
  };
}

export async function getTotalTokenCount(
  documents: Document[],
  prompt: ChatPromptTemplate
): Promise<number> {
  const mergedContent = documents
    .map((document) => document.text)
    .reduce((acc, text) => `${acc}\n${text}`);
  const reduceText = (
    await prompt.formatMessages({ text: "", metadata: "" })
  ).reduce((acc, message) => acc + message.content.toString(), "");

  const totalTokenCount = await embeddingModel.getNumTokens(
    reduceText + mergedContent
  );
  return totalTokenCount;
}

export async function getTokenCount(text: string) {
  return await embeddingModel.getNumTokens(text);
}

/**
 * Split an array into `k` even groups
 */
function splitIntoGroups<T>(array: T[], k: number): T[][] {
  if (k < 1) {
    throw new Error("k must be at least 1");
  }

  // Initialize an array of k groups
  const groups: T[][] = Array.from({ length: k }, () => []);

  // Distribute elements into groups
  array.forEach((element, index) => {
    groups[index % k]?.push(element);
  });

  return groups;
}

/**
 * Split a string into [k] ~even substrings
 */
function splitIntoSubstrings(input: string, k: number): string[] {
  const n = input.length;
  const substringLength = Math.ceil(n / k);

  const substrings: string[] = [];

  // Generate the substrings
  for (let i = 0; i < n; i += substringLength) {
    const end = Math.min(i + substringLength, n);
    substrings.push(input.slice(i, end));
  }

  return substrings;
}

/**
 * Split a document if its pageContent exceeds the specified max tokens
 */
async function splitDocument(
  document: Document,
  maxTokens: number,
  prompt: ChatPromptTemplate
): Promise<Document[]> {
  const documentTokenCount = await getTotalTokenCount([document], prompt);
  if (documentTokenCount < maxTokens) {
    return [document];
  }

  // Split into smaller documents
  const splitCount = Math.ceil(documentTokenCount / maxTokens);
  const subDocumentContent = splitIntoSubstrings(document.text, splitCount);
  const subDocuments = subDocumentContent.map((content) => ({
    text: content,
    metadata: document.metadata,
  }));
  return subDocuments;
}

/**
 * Summarize multiple documents into a single one, via a recursive map-reduce strategy
 *
 * We are using this instead of LC's summarization chain because it doesn't handle the
 * case when mapping all inputs exceeds a single reduce context window
 */
export async function summarizeDocuments(
  documents: Document[],
  {
    mapPrompt,
    reducePrompt,
    maxTokens = 4_000,
    callbacks: parentCallbacks,
  }: SummarizeDocumentsParams
): Promise<Document> {
  let callbacks = parentCallbacks;
  const traceGroup = new TraceGroup("summarizeDocuments");
  if (!callbacks) {
    callbacks = await traceGroup.start();
  }

  try {
    const totalTokenCount = await getTotalTokenCount(documents, reducePrompt);
    console.log("Total token count:", totalTokenCount);
    if (totalTokenCount < maxTokens) {
      console.log("Reducing immediately");
      // No map step needed. Reduce immediately
      return reduceDocuments(documents, reducePrompt, callbacks);
    }

    // Break up any individual documents that exceed the context window
    const splitDocuments = (
      await Promise.all(
        documents.map((document) =>
          splitDocument(document, maxTokens, mapPrompt)
        )
      )
    ).flat();

    const mappedDocuments = await Promise.all(
      splitDocuments.map((document) =>
        mapDocument(document, mapPrompt, callbacks)
      )
    );
    const mappedTokenCount = await getTotalTokenCount(
      mappedDocuments,
      reducePrompt
    );
    if (mappedTokenCount < maxTokens) {
      // No need to recurse. Reduce immediately
      return reduceDocuments(mappedDocuments, reducePrompt, callbacks);
    }

    // Split into groups and recurse
    const numGroups = Math.ceil(mappedTokenCount / maxTokens);
    const groups = splitIntoGroups(mappedDocuments, numGroups);
    const summarizedGroups = await Promise.all(
      groups.map((group) =>
        summarizeDocuments(group, {
          mapPrompt,
          reducePrompt,
          maxTokens,
          callbacks,
        })
      )
    );

    // Final reduction
    return reduceDocuments(summarizedGroups, reducePrompt, callbacks);
  } finally {
    if (!parentCallbacks) {
      await traceGroup.end();
    }
  }
}
