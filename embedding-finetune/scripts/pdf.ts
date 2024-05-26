import { WebPDFLoader } from "langchain/document_loaders/web/pdf";
import { mkdir, existsSync } from "node:fs";

const zoteroKey = "rR1CGyc1FjYmluahv39SNu23";
const zoteroCollectionUrl =
  "https://api.zotero.org/users/11205826/collections/BDRRTS9S/items?limit=100";
const arxivInfoUrl = "https://export.arxiv.org/api/query";

interface ZoteroEntry {
  key: string;
  data: {
    url: string;
  };
}

async function fetchPdf(
  key: string,
  url: string,
  metadata?: Record<string, string>
) {
  const response = await fetch(url);
  const blob = await response.blob();
  const loader = new WebPDFLoader(blob);
  const docs = await loader.load();

  const text: string[] = [];
  for (const [i, doc] of docs.entries()) {
    text.push(doc.pageContent);
  }
  const entry = {
    key,
    url,
    metadata,
    text,
  };
  await Bun.write(`data/pdfs/${key}.json`, JSON.stringify(entry, null, 2));
}

function getTextEnclosedInTag(text: string, tag: string) {
  const start = text.indexOf(`<${tag}>`);
  const end = text.indexOf(`</${tag}>`);
  return text.slice(start + tag.length + 2, end);
}

async function getArxivMetadata(arxivId: string) {
  const arxivInfo = await fetch(`${arxivInfoUrl}?id_list=${arxivId}`).then(
    (res) => res.text()
  );
  const body = getTextEnclosedInTag(arxivInfo, "entry");
  const title = getTextEnclosedInTag(body, "title");
  const abstract = getTextEnclosedInTag(body, "summary");
  const published = getTextEnclosedInTag(body, "published");

  return {
    title,
    abstract,
    published,
  };
}

async function fetchArxivPdf(key: string, url: string) {
  const httpUrl = url.replace("https://", "http://").replace(".pdf", "").replace("/pdf/", "/abs/");
  const pdfUrl = httpUrl.replace("/abs/", "/pdf/");
  const arxivId = httpUrl.split("/abs/")[1].split("/")[0];
  const arxivMetadata = await getArxivMetadata(arxivId);

  return fetchPdf(key, pdfUrl, arxivMetadata);
}

/**
 * Fetch all PDFs from zotero
 */
export async function fetchPdfs() {
  const response = await fetch(zoteroCollectionUrl, {
    headers: {
      Authorization: `Bearer ${zoteroKey}`,
    },
  });
  const data = await response.json();
  const entries: { key: string; url: string }[] = data.map(
    ({ key, data: { url } }: ZoteroEntry) => ({ key, url })
  );

  for (const { key, url } of entries) {
    console.log(`Fetching ${key} from ${url}...`);
    if (existsSync(`data/_pdfs/${key}.json`)) {
      console.log(`Skipping ${key} as it already exists...`);
      continue;
    }
    if (url.includes("arxiv.org")) {
      await fetchArxivPdf(key, url);
    } else if (url.includes("huggingface.co/papers")) {
      const arxivUrl = url.replace("https://huggingface.co/papers", "http://arxiv.org/abs");
      await fetchArxivPdf(key, arxivUrl);
    } else if (url.endsWith(".pdf")) {
      await fetchPdf(key, url);
    }
  }
}
